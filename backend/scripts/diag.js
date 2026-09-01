#!/usr/bin/env node
// Path: scripts/diag.js
/**
 * @fileoverview `npm run diag` — consulta o log em arquivo pelo terminal.
 *
 * É o consumidor de investigação do `src/utils/log-diario.js`, e o caminho pelo qual um
 * agente responde "o que quebrou". O outro consumidor é a aba Diagnóstico do painel de
 * administração, que serve à pergunta do dia a dia; este serve à pergunta profunda, porque
 * o arquivo tem TUDO e o banco tem só o resumo.
 *
 * A lógica de agregação não mora aqui, e sim em `src/utils/diag-consulta.js`, que é puro e
 * testado. Aqui fica leitura de disco, argumentos e formatação.
 *
 * Uso:
 *   npm run diag -- erros [--desde 24h] [--limite 20]
 *   npm run diag -- lento [--desde 24h] [--limite 15]
 *   npm run diag -- status [--desde 1h]
 *   npm run diag -- saude [--desde 24h] [--intervalo 5m]
 *   npm run diag -- linhas [--desde 1h] [--filtro texto] [--limite 50]
 *   (--dir <caminho> para ler um diretório de log que não seja o configurado)
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  parseJanela, parseIntervalo, diasDaJanela, parseLinha, agruparErros,
  resumirLatencia, resumirStatus, resumirAmostras, ehErro,
} from '../src/utils/diag-consulta.js';

const COMANDOS = new Set(['erros', 'lento', 'status', 'saude', 'linhas']);

function lerArgumentos(argv) {
  const [comando, ...resto] = argv;
  const op = { comando, desde: '24h', limite: null, filtro: null, dir: null, intervalo: null };
  for (let i = 0; i < resto.length; i += 1) {
    const a = resto[i];
    if (a === '--desde') op.desde = resto[++i];
    else if (a === '--limite') op.limite = parseInt(resto[++i], 10);
    else if (a === '--filtro') op.filtro = resto[++i];
    else if (a === '--dir') op.dir = resto[++i];
    else if (a === '--intervalo') op.intervalo = resto[++i];
  }
  return op;
}

function ajuda() {
  process.stdout.write(`
diag — consulta o log em arquivo do EBGeo

  npm run diag -- erros  [--desde 24h] [--limite 20]   erros agrupados por assinatura
  npm run diag -- lento  [--desde 24h] [--limite 15]   latência por rota (p50/p95/máx)
  npm run diag -- status [--desde 1h]                  contagem por faixa de status
  npm run diag -- saude  [--desde 24h] [--intervalo 5m] buracos na amostra de saúde
  npm run diag -- linhas [--desde 1h] [--filtro texto] despejo cru filtrado

  --dir <caminho>   lê outro diretório de log (default: o de LOG_DIR)
  janela: 30m, 24h, 7d
  --intervalo: 30s, 5m, 1h (sem isto, ele é INFERIDO da própria série)
`);
}

/**
 * Lê os registros da janela.
 *
 * Abre só os arquivos dos dias que a janela toca, e depois filtra por `time`: sem o
 * segundo passo, `--desde 1h` às 00h30 devolveria o dia de ontem inteiro.
 */
function lerRegistros(dir, desdeMs, agora) {
  const inicio = new Date(agora.getTime() - desdeMs);
  const registros = [];
  let arquivosLidos = 0;

  for (const dia of diasDaJanela(inicio, agora)) {
    const alvo = path.join(dir, `ebgeo-${dia}.jsonl`);
    if (!fs.existsSync(alvo)) continue;
    arquivosLidos += 1;
    for (const linha of fs.readFileSync(alvo, 'utf8').split('\n')) {
      const reg = parseLinha(linha);
      if (!reg) continue;
      if (typeof reg.time === 'number' && reg.time < inicio.getTime()) continue;
      registros.push(reg);
    }
  }
  return { registros, arquivosLidos, inicio };
}

const hora = (t) => (typeof t === 'number' ? new Date(t).toLocaleString('pt-BR') : '?');

/**
 * Uma duração em ms como o operador a leria em voz alta.
 *
 * Arredonda para a unidade que ainda distingue alguma coisa: num buraco de seis horas, o
 * segundo não informa nada e só atrapalha a comparação entre dois buracos.
 */
function duracao(ms) {
  if (!Number.isFinite(ms)) return '?';
  const seg = Math.round(ms / 1000);
  if (seg < 60) return `${seg}s`;
  const min = Math.floor(seg / 60);
  // A unidade menor só aparece quando ela distingue alguma coisa: "5min 0s" faz o leitor
  // conferir duas vezes um número que é redondo.
  if (min < 60) return seg % 60 ? `${min}min ${seg % 60}s` : `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h}h ${min % 60}min` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
}

function imprimirErros(registros, limite) {
  const grupos = agruparErros(registros);
  if (!grupos.length) {
    process.stdout.write('Nenhum erro na janela.\n');
    return;
  }
  process.stdout.write(`${grupos.length} assinatura(s) de erro, ${grupos.reduce((s, g) => s + g.total, 0)} ocorrência(s):\n\n`);
  for (const g of grupos.slice(0, limite)) {
    process.stdout.write(`[${String(g.total).padStart(5)}x] ${g.assinatura}\n`);
    process.stdout.write(`         primeira ${hora(g.primeira)}   última ${hora(g.ultima)}\n`);
    const e = g.exemplo.err;
    if (e && e.stack) {
      process.stdout.write(`         ${String(e.stack).split('\n').slice(0, 3).join('\n         ')}\n`);
    }
    process.stdout.write('\n');
  }
  if (grupos.length > limite) process.stdout.write(`... e mais ${grupos.length - limite} assinatura(s). Use --limite.\n`);
}

function imprimirLento(registros, limite) {
  const linhas = resumirLatencia(registros);
  if (!linhas.length) {
    process.stdout.write('Nenhuma requisição com duração na janela.\n');
    return;
  }
  process.stdout.write('     n     p50     p95     máx  rota\n');
  for (const l of linhas.slice(0, limite)) {
    process.stdout.write(
      `${String(l.n).padStart(6)}  ${String(l.p50).padStart(5)}ms ${String(l.p95).padStart(5)}ms ${String(l.max).padStart(5)}ms  ${l.rota}\n`
    );
  }
}

function imprimirStatus(registros) {
  const { total, porFaixa } = resumirStatus(registros);
  process.stdout.write(`${total} requisição(ões) na janela\n`);
  for (const faixa of Object.keys(porFaixa).sort()) {
    const n = porFaixa[faixa];
    process.stdout.write(`  ${faixa}: ${String(n).padStart(6)}  (${((n / total) * 100).toFixed(1)}%)\n`);
  }
  const erros = registros.filter(ehErro).length;
  process.stdout.write(`\n${erros} registro(s) de erro. Detalhe: npm run diag -- erros\n`);
}

/**
 * A saúde do PROCESSO pela série de amostras, e sobretudo pelos buracos dela.
 *
 * A ordem das linhas é a decisão desta função, e não é estética. Primeiro a ÚLTIMA amostra,
 * porque a distância dela até agora é o único número que fala do presente (se ela passou do
 * intervalo, o processo pode estar fora NESTE momento); depois a série; a lista de buracos
 * por último, que é histórico. Um relatório que abrisse pela lista enterraria o "pode estar
 * fora agora" no meio de vinte linhas de passado.
 *
 * As duas ausências saem com todas as letras em vez de virarem zero: ver `resumirAmostras`.
 */
function imprimirSaude(registros, opcoes) {
  const r = resumirAmostras(registros, opcoes);

  if (r.situacao === 'sem-amostras') {
    process.stdout.write('NENHUMA AMOSTRA DE SAÚDE NA JANELA: o instrumento não produziu nada.\n');
    process.stdout.write('Isto NÃO é "nenhuma queda", é ausência de medição, e as causas são outras:\n');
    process.stdout.write('  amostrador desligado (HEALTH_SAMPLE=off), log em arquivo desligado\n');
    process.stdout.write('  (LOG_TO_FILE), diretório de log errado, ou processo que não subiu na janela.\n');
    if (r.semHorario) {
      process.stdout.write(`\n${r.semHorario} linha(s) de amostra sem horário: existem, mas não têm lugar na série.\n`);
    }
    return;
  }

  process.stdout.write(`Última amostra: ${hora(r.ultima)}  (há ${duracao(r.desdeUltimaMs)})\n`);
  if (r.ultimaAtrasada) {
    process.stdout.write('  ATENÇÃO: passou do intervalo. O processo pode estar FORA agora, e nenhuma\n');
    process.stdout.write('  amostra vai dizer isso: um amostrador dentro do processo não testemunha a\n');
    process.stdout.write('  própria morte. Confira se ele está de pé.\n');
  }
  process.stdout.write(`Primeira amostra: ${hora(r.primeira)}\n`);
  process.stdout.write(`${r.total} amostra(s) na janela.\n`);

  if (r.intervaloMs) {
    const comoSoube = r.intervaloOrigem === 'informado'
      ? 'informado em --intervalo'
      : 'INFERIDO da mediana das distâncias, não lido da configuração';
    process.stdout.write(`Intervalo considerado: ${duracao(r.intervaloMs)} (${comoSoube})\n`);
  }

  if (r.desconhecidoAntesMs) {
    process.stdout.write(`Antes da primeira amostra: ${duracao(r.desconhecidoAntesMs)} de janela DESCONHECIDA\n`);
    process.stdout.write('  (não é buraco medido: pode ser processo que ainda não tinha subido).\n');
  }

  if (r.situacao === 'amostra-unica') {
    process.stdout.write('\nUMA AMOSTRA SÓ: não há distância entre amostras, então não dá para inferir o\n');
    process.stdout.write('intervalo nem afirmar nada sobre buraco. Alargue a janela com --desde.\n');
  } else if (r.faltantes === 0) {
    process.stdout.write(`\nNenhuma amostra faltando entre a primeira e a última (${r.esperadas} esperada(s)).\n`);
  } else {
    process.stdout.write(`\nFALTARAM ${r.faltantes} amostra(s) de ${r.esperadas} esperada(s), em ${r.buracos.length} buraco(s):\n`);
    for (const b of r.buracos) {
      process.stdout.write(`  [${String(b.faltantes).padStart(4)} faltando] ${hora(b.inicio)} → ${hora(b.fim)}  (${duracao(b.duracaoMs)})\n`);
    }
    process.stdout.write(`Maior buraco: ${duracao(r.maiorBuraco.duracaoMs)}, a partir de ${hora(r.maiorBuraco.inicio)}\n`);
  }

  if (r.falhasDoAmostrador || r.bancoFora || r.semHorario) process.stdout.write('\n');
  if (r.falhasDoAmostrador) {
    process.stdout.write(`${r.falhasDoAmostrador} amostra(s) em que o PRÓPRIO amostrador falhou. Detalhe: npm run diag -- erros\n`);
  }
  if (r.bancoFora) {
    process.stdout.write(`${r.bancoFora} amostra(s) com o banco fora (erro ou prazo). Detalhe: npm run diag -- erros\n`);
  }
  if (r.semHorario) {
    process.stdout.write(`${r.semHorario} linha(s) de amostra sem horário, fora da série.\n`);
  }
}

function imprimirLinhas(registros, filtro, limite) {
  const alvo = filtro ? registros.filter((r) => JSON.stringify(r).includes(filtro)) : registros;
  for (const reg of alvo.slice(-limite)) {
    process.stdout.write(`${JSON.stringify(reg)}\n`);
  }
  process.stdout.write(`\n(${alvo.length} linha(s) casaram; mostrando as ${Math.min(limite, alvo.length)} últimas)\n`);
}

async function main() {
  const op = lerArgumentos(process.argv.slice(2));

  if (!COMANDOS.has(op.comando)) {
    ajuda();
    process.exit(op.comando ? 1 : 0);
  }

  const janela = parseJanela(op.desde);
  if (janela === null) {
    process.stderr.write(`Janela inválida: "${op.desde}". Use algo como 30m, 24h ou 7d.\n`);
    process.exit(1);
  }

  // Mesmo contrato da janela: forma não reconhecida RECLAMA. Cair no intervalo inferido
  // calado responderia com um número de faltantes sobre uma premissa que ninguém pediu.
  const intervalo = op.intervalo === null ? null : parseIntervalo(op.intervalo);
  if (op.intervalo !== null && intervalo === null) {
    process.stderr.write(`Intervalo inválido: "${op.intervalo}". Use algo como 30s, 5m ou 1h.\n`);
    process.stderr.write('O sufixo é obrigatório: um número nu seria ambíguo com HEALTH_SAMPLE_INTERVAL_MS, que é em ms.\n');
    process.exit(1);
  }

  // O config é importado tarde e só quando `--dir` não foi dado: ele exige DATABASE_URL e
  // JWT_SECRET na avaliação do módulo, e um diagnóstico de log não pode depender de o banco
  // estar configurado — a hora em que se lê log é justamente a hora em que algo não está.
  let dir = op.dir;
  if (!dir) {
    try {
      dir = (await import('../src/config.js')).default.log.dir;
    } catch {
      dir = './data/logs';
    }
  }

  if (!fs.existsSync(dir)) {
    process.stderr.write(`Diretório de log não encontrado: ${path.resolve(dir)}\n`);
    process.stderr.write('Confira LOG_DIR, ou passe --dir <caminho>.\n');
    process.exit(1);
  }

  const agora = new Date();
  const { registros, arquivosLidos, inicio } = lerRegistros(dir, janela, agora);
  process.stdout.write(`# ${path.resolve(dir)} | ${arquivosLidos} arquivo(s) | desde ${inicio.toLocaleString('pt-BR')} | ${registros.length} linha(s)\n\n`);

  if (op.comando === 'erros') imprimirErros(registros, op.limite || 20);
  else if (op.comando === 'lento') imprimirLento(registros, op.limite || 15);
  else if (op.comando === 'status') imprimirStatus(registros);
  else if (op.comando === 'saude') {
    // As DUAS pontas da janela vão junto: o começo, para nomear como DESCONHECIDO o trecho
    // anterior à primeira amostra, e o agora, porque a distância até a última amostra é o
    // sinal do presente. Sem elas o resumo saberia só o que aconteceu entre amostras.
    imprimirSaude(registros, { intervaloMs: intervalo, agora: agora.getTime(), inicio: inicio.getTime() });
  } else imprimirLinhas(registros, op.filtro, op.limite || 50);
}

main().catch((err) => {
  process.stderr.write(`diag falhou: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});

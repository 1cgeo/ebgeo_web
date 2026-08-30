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
 *   npm run diag -- linhas [--desde 1h] [--filtro texto] [--limite 50]
 *   (--dir <caminho> para ler um diretório de log que não seja o configurado)
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  parseJanela, diasDaJanela, parseLinha, agruparErros,
  resumirLatencia, resumirStatus, ehErro,
} from '../src/utils/diag-consulta.js';

const COMANDOS = new Set(['erros', 'lento', 'status', 'linhas']);

function lerArgumentos(argv) {
  const [comando, ...resto] = argv;
  const op = { comando, desde: '24h', limite: null, filtro: null, dir: null };
  for (let i = 0; i < resto.length; i += 1) {
    const a = resto[i];
    if (a === '--desde') op.desde = resto[++i];
    else if (a === '--limite') op.limite = parseInt(resto[++i], 10);
    else if (a === '--filtro') op.filtro = resto[++i];
    else if (a === '--dir') op.dir = resto[++i];
  }
  return op;
}

function ajuda() {
  process.stdout.write(`
diag — consulta o log em arquivo do EBGeo

  npm run diag -- erros  [--desde 24h] [--limite 20]   erros agrupados por assinatura
  npm run diag -- lento  [--desde 24h] [--limite 15]   latência por rota (p50/p95/máx)
  npm run diag -- status [--desde 1h]                  contagem por faixa de status
  npm run diag -- linhas [--desde 1h] [--filtro texto] despejo cru filtrado

  --dir <caminho>   lê outro diretório de log (default: o de LOG_DIR)
  janela: 30m, 24h, 7d
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
  else imprimirLinhas(registros, op.filtro, op.limite || 50);
}

main().catch((err) => {
  process.stderr.write(`diag falhou: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});

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
 * A LEITURA É EM FLUXO, E O COMANDO NÃO TEM TETO DE REGISTROS. As duas metades da frase são
 * decisão, e a segunda é a que se perde ao "reusar o leitor da rota": `diag.service.js`
 * retém um anel de 200 mil linhas porque ele responde dentro de um processo que também
 * atende sync, e uma resposta sua pode ser truncada. Aqui não: o comando vê o arquivo
 * INTEIRO, e é isso que faz `diag -- saude` contar buracos numa janela longa. Importar
 * aquele anel para cá mudaria respostas em silêncio, trocando o conjunto por uma amostra sem
 * dizer que virou amostra.
 *
 * O que saiu foi o `readFileSync().split('\n')`, que era teto de outro tipo, e mais duro:
 * acima de 512 MiB de string o node levanta `ERR_STRING_TOO_LONG`, o que na densidade deste
 * log dá algo entre dois e dois milhões e meio de linhas num dia, sem escape por reduzir a
 * janela, porque o arquivo era lido e parseado INTEIRO antes do filtro por tempo (medido:
 * 382 ms com `--desde 5m` contra 433 ms com `24h`). Medido nesta máquina, num arquivo de
 * 108 MB com 402 mil linhas: pico de 410 a 488 MB de working set antes, 60 a 78 MB depois.
 *
 * TODA AGREGAÇÃO É INCREMENTAL, com duas exceções declaradas. A latência precisa da amostra
 * porque percentil por posto exige a distribuição, mas guarda NÚMEROS (`criarResumoDeLatencia`),
 * não registros. E `erros` faz DUAS passadas pelo arquivo, porque a fusão das duas linhas de
 * uma requisição falha (`fundirPorRequisicao`) precisa saber se existe linha rica para aquele
 * `reqId` em QUALQUER lugar da janela, inclusive depois da linha que está sendo lida; a
 * primeira passada só indexa esses `reqId`, e a segunda agrega. O preço é ler o arquivo duas
 * vezes (medido: 572 ms antes, 720 ms depois, no mesmo arquivo de 108 MB), e a alternativa
 * seria segurar toda linha com `reqId` até o fim, que é a memória que este trabalho existe
 * para tirar.
 *
 * OS DOIS ÚLTIMOS COMANDOS LEEM O BANCO, e não o arquivo. `defeitos` e `pilha` consultam as
 * tabelas do lote B (`defeitos` e `defeito_ocorrencias`), o que os obriga a importar o
 * `config.js` e o pool, SEMPRE e não só quando falta `--dir`. A assimetria é declarada aqui
 * porque ela inverte a promessa dos cinco primeiros: os de log respondem com o banco fora, e
 * estes dois não podem, porque a resposta É o banco. Quem estiver diagnosticando um Postgres
 * caído tem `erros`, que agrega o mesmo assunto a partir do `.jsonl`.
 *
 * `--json` VALE PARA TODOS OS SETE, e o contrato dele é curto: UM documento JSON no stdout e
 * NADA MAIS ali. As notas que o modo humano escreve (o cabeçalho com o diretório, as
 * ressalvas sobre indício e premissa) ou viram campo do documento ou saem no stderr. É o que
 * torna a saída consumível por `| jq` e por um agente sem nenhum recorte de texto, que é o
 * consumidor que esta ferramenta existe para servir (ver `docs/wiki/observabilidade.md`).
 *
 * Uso:
 *   npm run diag -- erros [--desde 24h] [--limite 20]
 *   npm run diag -- lento [--desde 24h] [--limite 15]
 *   npm run diag -- status [--desde 24h]
 *   npm run diag -- saude [--desde 24h] [--intervalo 5m]
 *   npm run diag -- linhas [--desde 24h] [--filtro texto] [--limite 50]
 *   npm run diag -- defeitos [--desde 24h] [--estado aberto] [--origem store] [--novos]
 *   npm run diag -- defeitos --id <uuid>
 *   npm run diag -- pilha --id <uuid> --mapas <dir>
 *   (--dir <caminho> para ler um diretório de log que não seja o configurado)
 *   (--json em qualquer um deles)
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  parseJanela, parseIntervalo, diasDaJanela, parseLinha, resumirAmostras, ehErro,
  criarAgrupadorDeErros, criarIndiceDeRequisicoesComErro, criarCensoDeEnderecos,
  criarResumoDeLatencia, criarResumoDeStatus, MAX_ENDERECOS_PRINCIPAIS,
} from '../src/utils/diag-consulta.js';
import { MARCADOR_AMOSTRA } from '../src/utils/amostra-de-saude.js';
// Os DOIS vocabulários entram por import e nunca como literal: são os mesmos que o Joi da
// rota valida e que o CHECK do banco impõe, e os dois arquivos têm zero imports por
// contrato, então trazê-los aqui não arrasta `config.js` nem o pool para dentro dos cinco
// comandos que rodam sem banco. Uma cópia à mão desta lista envelheceria na próxima origem
// nova, e envelheceria falhando FECHADO: o comando recusaria um valor que o banco aceita.
import { ESTADOS_DE_DEFEITO } from '../src/modules/diag/estados-de-defeito.js';
import { ORIGENS_DE_ERRO } from '../src/modules/diag/origens-de-erro.js';
import {
  analisarPilha, resolverQuadros, localizarReleaseDeMapas,
} from './diag/pilha.js';
import { resolver as resolverPosicao } from './diag/mapa-de-fonte.js';

const COMANDOS = new Set(['erros', 'lento', 'status', 'saude', 'linhas', 'defeitos', 'pilha']);

/**
 * Os que consultam o Postgres, e por isso NÃO respondem com o banco fora.
 *
 * A separação é usada em UM lugar só (o despacho de `main`) e mesmo assim é constante
 * nomeada: ela é a fronteira entre a promessa dos cinco comandos de log ("funciona quando
 * nada mais funciona") e a destes dois, e um `op.comando === 'defeitos' || ...` solto no
 * meio do fluxo seria exatamente a lista fechada que esta casa proíbe, com o mesmo modo de
 * falha (o comando de banco que alguém acrescentar depois cairia no ramo do arquivo e
 * morreria procurando `.jsonl`).
 */
const COMANDOS_DE_BANCO = new Set(['defeitos', 'pilha']);

function lerArgumentos(argv) {
  const [comando, ...resto] = argv;
  const op = {
    comando, desde: '24h', limite: null, filtro: null, dir: null, intervalo: null,
    json: false, estado: null, origem: null, release: null, pagina: null, novos: false,
    id: null, mapas: null, limiteBruto: null,
  };
  for (let i = 0; i < resto.length; i += 1) {
    const a = resto[i];
    if (a === '--desde') op.desde = resto[++i];
    // O TEXTO CRU DO `--limite` É GUARDADO ao lado do número, e ele é o que distingue os
    // TRÊS estados que o número sozinho colapsa: não passado, passado e válido, passado e
    // lixo. Sem ele, `--limite abc` (NaN) e `--limite 0` caem no mesmo `|| 20` do default,
    // e o comando responde OUTRA pergunta em silêncio, que é a mesma classe do
    // `--desde 24hs` que `parseJanela` existe para recusar.
    else if (a === '--limite') { op.limiteBruto = resto[++i]; op.limite = parseInt(op.limiteBruto, 10); }
    else if (a === '--filtro') op.filtro = resto[++i];
    else if (a === '--dir') op.dir = resto[++i];
    else if (a === '--intervalo') op.intervalo = resto[++i];
    else if (a === '--json') op.json = true;
    else if (a === '--estado') op.estado = resto[++i];
    else if (a === '--origem') op.origem = resto[++i];
    else if (a === '--release') op.release = resto[++i];
    else if (a === '--pagina') op.pagina = resto[++i];
    else if (a === '--novos') op.novos = true;
    else if (a === '--id') op.id = resto[++i];
    else if (a === '--mapas') op.mapas = resto[++i];
  }
  return op;
}

/**
 * A ajuda, e o DESTINO dela é argumento porque `--json` o muda.
 *
 * Sob `--json` o contrato é que o stdout carregue UM documento e nada mais; um texto de
 * ajuda ali quebraria todo `| jq` no exato caso em que o operador errou o comando, que é
 * quando ele mais precisa ler o erro. Escrever no stderr mantém as duas coisas: a ajuda
 * chega ao terminal e o stdout continua parseável (vazio).
 *
 * @param {{write: (s: string) => unknown}} destino
 */
function ajuda(destino) {
  destino.write(`
diag — consulta o log em arquivo e as tabelas de defeito do EBGeo

  npm run diag -- erros  [--desde 24h] [--limite 20]   erros agrupados por assinatura
  npm run diag -- lento  [--desde 24h] [--limite 15]   latência por rota (p50/p95/máx)
  npm run diag -- status [--desde 24h]                 contagem por faixa de status
  npm run diag -- saude  [--desde 24h] [--intervalo 5m] buracos na amostra de saúde
  npm run diag -- linhas [--desde 24h] [--filtro texto] despejo cru filtrado
  npm run diag -- defeitos [--desde 24h] [--estado x] [--origem y] [--release h]
                           [--pagina p] [--novos] [--limite 50] [--id <uuid>]
  npm run diag -- pilha --id <uuid> --mapas <dir>      desminifica a pilha crua

  --dir <caminho>   lê outro diretório de log (default: o de LOG_DIR)
  --json            UM documento JSON no stdout e nada mais ali
  janela: 30m, 24h, 7d (o default de TODO comando é 24h; os colchetes acima mostram esse
          default, não uma sugestão por comando)
  --intervalo: 30s, 5m, 1h (sem isto, ele é INFERIDO da própria série)
  --filtro: casa a LINHA COMO ESTÁ NO DISCO, então nome de campo ("time", "msg")
            casa toda linha que o tenha. Procure pelo valor.

  defeitos e pilha LEEM O BANCO (precisam de DATABASE_URL); os outros cinco leem
  arquivo e respondem com o Postgres fora.
  --estado: ${ESTADOS_DE_DEFEITO.join(' | ')}
  --origem: ${ORIGENS_DE_ERRO.join(' | ')}
  --mapas: o diretório da build (com release.json) ou o que contém as builds. A
           pilha é resolvida SÓ contra a release que a produziu; sem ela, saída 2.
`);
}

/**
 * Percorre os registros da janela, um a um, e não devolve nenhum.
 *
 * Abre só os arquivos dos dias que a janela toca, e depois filtra por `time`: sem o
 * segundo passo, `--desde 1h` às 00h30 devolveria o dia de ontem inteiro.
 *
 * NADA É ACUMULADO AQUI, e é isso que separa esta função da que ela substituiu. Quem chama
 * decide o que reter, e nenhum dos cinco comandos retém a janela: erros e status são
 * contadores, saúde fica só com as linhas de amostra (uma a cada poucos minutos), latência
 * fica com números e `linhas` com um anel do tamanho do `--limite`.
 *
 * A LINHA CRUA VAI JUNTO com o registro, e não é conveniência: é o texto que existe no
 * disco, e é contra ele que `--filtro` casa. Re-serializar o objeto para filtrar produz um
 * texto que nunca existiu em lugar nenhum.
 *
 * @param {string} dir
 * @param {number} desdeMs
 * @param {Date} agora
 * @param {(reg: Object, linha: string) => void} aoRegistro
 * @returns {Promise<{arquivosLidos: number, linhas: number, inicio: Date}>}
 */
export async function percorrerRegistros(dir, desdeMs, agora, aoRegistro) {
  const inicio = new Date(agora.getTime() - desdeMs);
  let arquivosLidos = 0;
  let linhas = 0;

  for (const dia of diasDaJanela(inicio, agora)) {
    const alvo = path.join(dir, `ebgeo-${dia}.jsonl`);
    if (!fs.existsSync(alvo)) continue;
    arquivosLidos += 1;
    const entrada = fs.createReadStream(alvo, 'utf8');
    const leitor = readline.createInterface({ input: entrada, crlfDelay: Infinity });
    try {
      for await (const linha of leitor) {
        const reg = parseLinha(linha);
        if (!reg) continue;
        if (typeof reg.time === 'number' && reg.time < inicio.getTime()) continue;
        linhas += 1;
        aoRegistro(reg, linha);
      }
    } finally {
      leitor.close();
      entrada.destroy();
    }
  }
  return { arquivosLidos, linhas, inicio };
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

/**
 * Os endereços de UM grupo, e o formato muda com o número deles porque a pergunta muda.
 *
 * Com um só, a linha é curta e é a que dispara a nota da ambiguidade adiante. Com vários, um
 * por linha e alinhados, porque aí o que se lê é a COMPARAÇÃO entre as contagens.
 *
 * Grupo sem endereço nenhum não escreve nada, e a explicação sai UMA vez, depois da lista:
 * o campo nasceu em 2026-08-31 e vai faltar na maioria das linhas existentes, então uma
 * frase por grupo seria a mesma frase vinte vezes no mesmo relatório.
 */
function imprimirEnderecosDoGrupo(g) {
  const { distintos, principais } = g.enderecos;
  if (!distintos) return;
  if (distintos === 1) {
    process.stdout.write(`         1 endereço só, em ${principais[0].total} das ${g.total} ocorrência(s): ${principais[0].ip}\n`);
    return;
  }
  process.stdout.write(`         ${distintos} endereço(s) distinto(s):\n`);
  for (const e of principais) {
    process.stdout.write(`           ${String(e.total).padStart(5)}x  ${e.ip}\n`);
  }
  if (distintos > MAX_ENDERECOS_PRINCIPAIS) {
    process.stdout.write(`           ... e mais ${distintos - MAX_ENDERECOS_PRINCIPAIS}, fora dos ${MAX_ENDERECOS_PRINCIPAIS} maiores\n`);
  }
}

/**
 * A nota do endereço, que sai UMA vez e NOMEIA AS DUAS LEITURAS em vez de escolher uma.
 *
 * "Um endereço só" sobre muitas ocorrências pode ser um atacante único ou pode ser
 * `TRUST_PROXY_HOPS` em desacordo com o número de proxies à frente, caso em que toda linha
 * registra o endereço do proxy e o campo vira constante. O `fileoverview` de `clientAddress`
 * (`middleware/request-logger.js`) teme esse caso em voz alta e nada o vigiava; esta é a
 * primeira coisa do produto capaz de acusá-lo, e ela só pode acusar porque tem o CENSO da
 * janela inteira, que é a evidência que nenhum grupo carrega sozinho.
 *
 * Afirmar uma das duas leituras seria inventar veredito, que é a mesma classe de erro da nota
 * de disco em `imprimirNotaDeDisco`, logo abaixo, e pela mesma razão a redação descreve o
 * mecanismo e devolve o juízo a quem lê.
 */
function imprimirNotaDeEndereco(censo, algumGrupoConcentrado) {
  if (!censo.linhas) {
    process.stdout.write('\nNenhuma linha desta janela registra endereço, então nada se afirma sobre origem. O\n');
    process.stdout.write('campo `ip` nasceu em 2026-08-31 na linha de requisição, e linha fora do ciclo HTTP\n');
    process.stdout.write('(o sweep do WS, um job, a amostra de saúde) não o tem nem vai ter.\n');
    return;
  }
  process.stdout.write(`\nNa janela inteira: ${censo.distintos} endereço(s) distinto(s) em ${censo.linhas} linha(s) com endereço.\n`);
  if (!algumGrupoConcentrado) return;

  process.stdout.write('UM ENDEREÇO SÓ NUM GRUPO TEM DUAS LEITURAS, e este comando não escolhe entre elas: pode\n');
  process.stdout.write('ser um endereço único insistindo, ou pode ser TRUST_PROXY_HOPS em desacordo com o número\n');
  process.stdout.write('de proxies à frente, caso em que TODA linha registra o endereço do proxy e o campo vira\n');
  process.stdout.write('constante. O censo acima é o que separa as duas, e é INDÍCIO, não veredito:\n');
  if (censo.distintos === 1) {
    process.stdout.write(`  a janela INTEIRA tem um endereço (${censo.principais[0].ip}), que é o que a hipótese do\n`);
    process.stdout.write('  proxy prevê e também o que um serviço com um cliente só produz. Confira TRUST_PROXY_HOPS\n');
    process.stdout.write('  contra o número de proxies do deploy antes de tratar o endereço como origem.\n');
    return;
  }
  process.stdout.write(`  a janela tem ${censo.distintos} endereços distintos, então o campo NÃO é constante aqui e a\n`);
  process.stdout.write('  concentração é do grupo, não do instrumento.\n');
}

function imprimirErros(grupos, limite, censo) {
  if (!grupos.length) {
    process.stdout.write('Nenhum erro na janela.\n');
    return;
  }
  process.stdout.write(`${grupos.length} assinatura(s) de erro, ${grupos.reduce((s, g) => s + g.total, 0)} ocorrência(s):\n\n`);
  const mostrados = grupos.slice(0, limite);
  for (const g of mostrados) {
    process.stdout.write(`[${String(g.total).padStart(5)}x] ${g.assinatura}\n`);
    process.stdout.write(`         primeira ${hora(g.primeira)}   última ${hora(g.ultima)}\n`);
    imprimirEnderecosDoGrupo(g);
    const e = g.exemplo.err;
    if (e && e.stack) {
      process.stdout.write(`         ${String(e.stack).split('\n').slice(0, 3).join('\n         ')}\n`);
    }
    process.stdout.write('\n');
  }
  if (grupos.length > limite) process.stdout.write(`... e mais ${grupos.length - limite} assinatura(s). Use --limite.\n`);
  // A ambiguidade é do grupo com UM endereço e MAIS DE UMA ocorrência: uma ocorrência só não
  // tem o que concentrar. O limiar é esse e não um número escolhido a dedo, que seria palpite
  // com cara de medição.
  imprimirNotaDeEndereco(censo, mostrados.some((g) => g.enderecos.distintos === 1 && g.total > 1));
}

function imprimirLento(linhas, limite) {
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

function imprimirStatus({ total, porFaixa }, erros) {
  process.stdout.write(`${total} requisição(ões) na janela\n`);
  for (const faixa of Object.keys(porFaixa).sort()) {
    const n = porFaixa[faixa];
    process.stdout.write(`  ${faixa}: ${String(n).padStart(6)}  (${((n / total) * 100).toFixed(1)}%)\n`);
  }
  process.stdout.write(`\n${erros} registro(s) de erro. Detalhe: npm run diag -- erros\n`);
}

/**
 * A nota que diz o que a leitura de disco significa, e sobretudo o que ela NÃO significa.
 *
 * Ela sai UMA vez, depois da lista, e em duas versões conforme o estado do campo na janela.
 * Repeti-la por buraco treinaria o olho a pular a lista inteira; omiti-la deixaria um número
 * de MB solto ao lado de um incidente, que é um convite a concluir causa.
 *
 * A REDAÇÃO É DELIBERADA: ela descreve o mecanismo (o destino de arquivo se desliga sozinho e
 * a série some com o processo vivo) e devolve o juízo a quem lê. "O log parou por disco
 * cheio" seria mais curta e mandaria consertar a coisa errada quando o processo tiver morrido
 * por outro motivo com o volume apertado por coincidência.
 */
function imprimirNotaDeDisco(r) {
  if (r.amostrasComDisco) {
    process.stdout.write('\nO disco acima é o que a amostra ANTERIOR a cada buraco registrou, e é INDÍCIO, não\n');
    process.stdout.write('veredito: quando o volume do log enche, o destino de arquivo se desliga sozinho e a\n');
    process.stdout.write('série some do .jsonl com o processo VIVO, produzindo um buraco igual ao da queda.\n');
    process.stdout.write('Compare o livre com o total e julgue: nem o comando nem a amostra afirmam a causa.\n');
    return;
  }
  process.stdout.write('\nNenhuma amostra desta janela traz leitura de disco (o campo é novo, ou a medição não\n');
  process.stdout.write('estava disponível), então o buraco continua AMBÍGUO: processo morto e log em arquivo\n');
  process.stdout.write('desligado por falta de espaço produzem a mesma série, e daqui não dá para separar.\n');
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
 * As TRÊS ausências saem com todas as letras em vez de virarem zero: nenhuma amostra, uma
 * amostra só, e intervalo INESTIMÁVEL com a série de pé (ver `resumirAmostras`). A terceira
 * foi acrescentada em 2026-09-01 e é a que custou: `faltantes` e `esperadas` chegam `null`,
 * esta função imprimia "FALTARAM null amostra(s) de null esperada(s)" e caía na linha
 * seguinte desreferenciando `maiorBuraco`, saindo com código 1. Um ramo que não existe não é
 * um ramo silencioso, é um `TypeError` na frente do operador durante o incidente.
 *
 * E TODA AFIRMAÇÃO SOBRE FALTANTE CARREGA A PREMISSA (`premissa`), inclusive a
 * tranquilizadora. "Nenhuma amostra faltando" sozinha foi a frase que mentiu: ela lê como
 * saúde medida, quando é só uma divisão pelo intervalo que o próprio comando inferiu.
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
    // O silêncio que ainda está aberto tem a MESMA ambiguidade dos buracos fechados, e a
    // mesma testemunha possível: a última amostra. Sem juízo aqui também, só o número.
    if (r.discoNaUltima) {
      process.stdout.write(`  Nela o disco do log estava em ${r.discoNaUltima.livreMb} MB livres de ${r.discoNaUltima.totalMb} MB (indício,\n`);
      process.stdout.write('  não veredito: log em arquivo desligado produz este mesmo silêncio).\n');
    }
  }
  process.stdout.write(`Primeira amostra: ${hora(r.primeira)}\n`);
  process.stdout.write(`${r.total} amostra(s) na janela.\n`);

  if (r.intervaloMs) {
    const comoSoube = r.intervaloOrigem === 'informado'
      ? 'informado em --intervalo'
      : `INFERIDO do p${r.intervaloPercentil} de ${r.intervaloBase} distância(s), não lido da configuração`;
    process.stdout.write(`Intervalo considerado: ${duracao(r.intervaloMs)} (${comoSoube})\n`);
    if (r.estimativaFragil) {
      process.stdout.write(`  ESTIMATIVA FRÁGIL: com ${r.intervaloBase} distância(s), o p${r.intervaloPercentil} É a MENOR delas, então um\n`);
      process.stdout.write('  único reinício rápido decide este número. Confirme com --intervalo.\n');
    }
  }

  if (r.desconhecidoAntesMs) {
    process.stdout.write(`Antes da primeira amostra: ${duracao(r.desconhecidoAntesMs)} de janela DESCONHECIDA\n`);
    process.stdout.write('  (não é buraco medido: pode ser processo que ainda não tinha subido).\n');
  }

  // A premissa vai DENTRO da frase, e não numa linha acima que o olho pula: "nenhuma amostra
  // faltando" sozinha é a frase que mentiu, porque ela lê como saúde medida quando é só uma
  // divisão por um intervalo que o próprio comando chutou.
  const premissa = r.intervaloOrigem === 'informado'
    ? `supondo o intervalo de ${duracao(r.intervaloMs)} que você informou`
    : `supondo intervalo de ${duracao(r.intervaloMs)}, INFERIDO do p${r.intervaloPercentil} de ${r.intervaloBase} distância(s)`;

  if (r.situacao === 'amostra-unica') {
    process.stdout.write('\nUMA AMOSTRA SÓ: não há distância entre amostras, então não dá para inferir o\n');
    process.stdout.write('intervalo nem afirmar nada sobre buraco. Alargue a janela com --desde.\n');
  } else if (r.faltantes === null) {
    // O terceiro estado. Ele nasce de duas séries diferentes (uma distância só, ou distâncias
    // todas de duração zero), e das duas o número de faltantes fica em ABERTO: imprimi-lo
    // como zero seria a mesma mentira tranquilizadora, e imprimi-lo como `null` era o que
    // derrubava o comando na linha seguinte.
    process.stdout.write('\nNÃO FOI POSSÍVEL ESTIMAR O INTERVALO, e por isso NADA se afirma sobre buraco.\n');
    process.stdout.write(`A série tem ${r.distancias} distância(s) entre amostras, ${r.distanciasUteis} com duração maior que zero,\n`);
    process.stdout.write('e a inferência exige duas: uma distância dividida por si mesma dá zero faltantes\n');
    process.stdout.write('por aritmética, não por medição.\n');
    process.stdout.write('Isto NÃO é "nada faltou". Passe --intervalo (5m, ou o que estiver em\n');
    process.stdout.write('HEALTH_SAMPLE_INTERVAL_MS, que é em ms) para a conta sair sobre premissa declarada.\n');
    if (r.desdeUltimaMs !== null) {
      process.stdout.write(`Sem intervalo também não dá para dizer se a última amostra (há ${duracao(r.desdeUltimaMs)})\n`);
      process.stdout.write('está atrasada, e é por isso que o aviso do presente saiu mudo lá em cima.\n');
    }
  } else if (r.faltantes === 0) {
    process.stdout.write(`\nNenhuma amostra faltando entre a primeira e a última, ${premissa}\n`);
    process.stdout.write(`(${r.total} amostra(s), ${r.esperadas} esperada(s) sob essa premissa).\n`);
    if (r.estimativaFragil) {
      process.stdout.write('  Mas a estimativa é frágil (veja a linha do intervalo): esta tranquilidade vale o\n');
      process.stdout.write('  que vale a premissa. Confirme com --intervalo antes de concluir que está tudo bem.\n');
    }
  } else {
    // A premissa vai junto TAMBÉM aqui, e não só na linha tranquilizadora: uma estimativa
    // baixa demais infla esta contagem, e quem lê precisa poder desconfiar do número sem
    // procurar de onde ele veio.
    process.stdout.write(`\nFALTARAM ${r.faltantes} amostra(s) de ${r.esperadas} esperada(s), em ${r.buracos.length} buraco(s), ${premissa}:\n`);
    for (const b of r.buracos) {
      process.stdout.write(`  [${String(b.faltantes).padStart(4)} faltando] ${hora(b.inicio)} → ${hora(b.fim)}  (${duracao(b.duracaoMs)})\n`);
      // A leitura vai LOGO ABAIXO do buraco a que pertence, porque ela é daquela amostra e de
      // nenhuma outra. Sem leitura na janela inteira não se escreve nada por buraco: a nota
      // sai uma vez, adiante.
      if (b.disco) {
        process.stdout.write(`       disco na amostra anterior: ${b.disco.livreMb} MB livres de ${b.disco.totalMb} MB\n`);
      } else if (r.amostrasComDisco) {
        process.stdout.write('       disco na amostra anterior: sem leitura nessa amostra\n');
      }
    }
    process.stdout.write(`Maior buraco: ${duracao(r.maiorBuraco.duracaoMs)}, a partir de ${hora(r.maiorBuraco.inicio)}\n`);
    imprimirNotaDeDisco(r);
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

/**
 * O despejo cru, e ele é CRU dos dois lados: o que se casa e o que se imprime é a linha COMO
 * ELA ESTÁ NO DISCO.
 *
 * Até 2026-09-01 o filtro casava contra `JSON.stringify(reg)`, um texto re-serializado que
 * nunca existiu em arquivo nenhum, e a linha impressa era essa mesma re-serialização. Casar
 * o disco é mais rápido (nenhum objeto é re-serializado) e é a única versão em que o
 * resultado do comando é conferível com um `grep` no mesmo arquivo.
 *
 * A DIFERENÇA APARECE NO ESCAPE, e é a única que aparece: `JSON.parse` seguido de
 * `JSON.stringify` normaliza `"café"` para `"café"`, então o filtro antigo casava a
 * forma que o disco NÃO tem e não casava a que ele tem. Nome de campo casa dos dois jeitos,
 * porque ele é texto na linha também, e é disso que trata a nota do fim.
 *
 * @param {string[]} linhas - as últimas que casaram, em ordem cronológica
 * @param {number} casaram - quantas casaram ao todo (antes do corte)
 * @param {number} naJanela - quantas linhas a janela tem
 * @param {string|null} filtro
 */
function imprimirLinhas(linhas, casaram, naJanela, filtro) {
  for (const linha of linhas) process.stdout.write(`${linha}\n`);
  process.stdout.write(`\n(${casaram} linha(s) casaram; mostrando as ${linhas.length} últimas)\n`);

  // O filtro que casa TUDO não estreitou nada, e quem digitou um nome de campo (`time`,
  // `level`, `msg`) merece saber por que, em vez de concluir que o comando está quebrado ou,
  // pior, que aquelas 402 mil linhas têm todas a ver com o que ele procura.
  if (filtro && naJanela > 0 && casaram === naJanela) {
    process.stdout.write(`\nO filtro casou TODAS as ${naJanela} linha(s) da janela, ou seja, não estreitou nada. O texto\n`);
    process.stdout.write('conferido é a linha como ela está no disco, e ali o NOME de cada campo também é texto:\n');
    process.stdout.write('"time", "level" e "msg" aparecem em toda linha que os tenha. Procure pelo VALOR (um\n');
    process.stdout.write('endereço, um uuid, um trecho de mensagem), não pelo nome do campo.\n');
  }
}

/**
 * O ÚNICO documento que o modo `--json` escreve no stdout.
 *
 * O ENVELOPE TEM TRÊS CAMPOS FIXOS e o resto é a estrutura do comando, espalhada na raiz:
 *
 *   `comando`   — qual dos sete respondeu. Uma saída salva em arquivo perde o comando que a
 *                 produziu, e sem ele `total` e `itens` não dizem de que assunto se trata;
 *   `janela`    — o recorte, e a PROCEDÊNCIA dele (ver a chamada em `main`);
 *   `gerado_em` — quando. Em EPOCH MS, como toda data desta família (o `time` do pino, o
 *                 `primeiraEm` das rotas de defeito). Duas unidades de tempo no mesmo
 *                 documento é conversão errada esperando para acontecer, e ISO aqui ao lado
 *                 de epoch nos itens seria exatamente isso.
 *
 * `null, 2` E NÃO UMA LINHA SÓ, de propósito: o consumidor é um agente ou um `| jq`, e os
 * dois leem indentado; um documento de uma linha com centenas de kB é ilegível no terminal
 * quando alguém esquece o `| jq` e não ganha nada em troca.
 *
 * O `\n` FINAL EXISTE porque um documento sem quebra deixa o prompt colado na última chave.
 *
 * @param {string} comando
 * @param {Object|null} janela
 * @param {Object} estrutura
 */
function escreverJson(comando, janela, estrutura) {
  // O ENVELOPE VEM DEPOIS DO ESPALHAMENTO, e a ordem é a guarda: com ele antes, uma
  // estrutura que um dia ganhasse um campo `janela` (ou `comando`, ou `gerado_em`)
  // SOBRESCREVERIA a procedência, calada, e o documento passaria a mentir sobre de onde
  // veio. Invertida, a procedência sempre ganha. E a colisão não passa em silêncio pelo
  // outro lado: um campo do comando desaparecendo do documento é defeito igual, só que
  // mais difícil de notar, então ela LANÇA em vez de escolher um vencedor.
  for (const chave of ['comando', 'janela', 'gerado_em']) {
    if (Object.hasOwn(estrutura, chave)) {
      throw new Error(`estrutura de "${comando}" colide com o campo de envelope "${chave}"`);
    }
  }
  process.stdout.write(`${JSON.stringify({
    ...estrutura, comando, janela, gerado_em: Date.now(),
  }, null, 2)}\n`);
}

/* ------------------------------------------------------------------------------------- *
 *  `defeitos` e `pilha`: a metade que lê o BANCO.
 * ------------------------------------------------------------------------------------- */

/**
 * O pool, aberto TARDE e uma vez só.
 *
 * `src/database/index.js` cria o pool na avaliação do módulo e importa `config.js`, que
 * exige `DATABASE_URL` e `JWT_SECRET`. Um `import` no topo deste arquivo faria os CINCO
 * comandos de log passarem a exigir banco configurado, que é exatamente a propriedade que o
 * comentário de `--dir` existe para preservar: a hora de ler log é a hora em que alguma
 * coisa não está de pé.
 */
let bancoAberto = null;

async function abrirBanco() {
  if (!bancoAberto) bancoAberto = await import('../src/database/index.js');
  return bancoAberto;
}

/**
 * Fecha o pool, senão o processo NÃO SAI.
 *
 * O `pg-promise` mantém as conexões do pool vivas, e um handle aberto segura o loop de
 * eventos: sem isto o comando imprime a resposta inteira e fica pendurado no terminal, que
 * se lê como consulta lenta. `pgp.end()` devolve `undefined` em algumas versões, então nada
 * de encadear nele (o mesmo cuidado está em `scripts/models3d-adotar.js`).
 */
async function fecharBanco() {
  if (!bancoAberto) return;
  await Promise.resolve(bancoAberto.pgp.end()).catch(() => {});
  bancoAberto = null;
}

/** UUID v4 canônico, o formato que a coluna `id` de `defeitos` tem. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Corta um texto no comprimento pedido, marcando o corte.
 *
 * A MARCA É OBRIGATÓRIA e é a razão de a função existir: uma mensagem de erro cortada em
 * silêncio no meio de uma frase se lê como a mensagem INTEIRA, e quem procura o texto no
 * código não acha. O `--json` nunca corta nada, e é lá que está o valor completo.
 */
function cortar(texto, tamanho) {
  const t = texto === null || texto === undefined ? '' : String(texto).replace(/\s+/g, ' ');
  return t.length <= tamanho ? t : `${t.slice(0, tamanho - 1)}…`;
}

/** `hora()` com os milissegundos, que a linha do tempo de migalhas precisa para ordenar. */
function horaFina(t) {
  if (typeof t !== 'number') return '?';
  return `${hora(t)}.${String(new Date(t).getMilliseconds()).padStart(3, '0')}`;
}

/**
 * A tabela de defeitos, uma linha por assinatura.
 *
 * O ID SAI CURTO (oito caracteres) e isso é uma aposta declarada: ele serve para o olho
 * reconhecer a linha, e `--id` exige o UUID inteiro, que sai no `--json`. Imprimir os 36 na
 * tabela empurraria a mensagem, que é a coluna que se lê de fato, para fora da largura do
 * terminal.
 *
 * A CONTAGEM DE ANTES DO CORTE VEM JUNTO pelo mesmo motivo do `totalAssinaturas` da rota:
 * "50 defeitos" é indistinguível de "50 de 400", e quem lê conclui que viu tudo.
 */
function imprimirDefeitos({ totalDefeitos, itens }, limite) {
  if (!itens.length) {
    process.stdout.write('Nenhum defeito na janela com estes filtros.\n');
    return;
  }
  process.stdout.write(`${totalDefeitos} defeito(s) na janela; mostrando ${itens.length}.\n\n`);
  process.stdout.write(
    `${'estado'.padEnd(10)} ${'ocorr'.padStart(7)}  ${'origem'.padEnd(12)} ${'1ª release'.padEnd(14)} ${'últ. release'.padEnd(14)} ${'página'.padEnd(10)} ${'mensagem'.padEnd(44)} id\n`
  );
  for (const d of itens) {
    process.stdout.write(
      `${cortar(d.estado, 10).padEnd(10)} ${String(d.ocorrencias).padStart(7)}  `
      + `${cortar(d.origem, 12).padEnd(12)} ${cortar(d.primeiraRelease, 14).padEnd(14)} `
      + `${cortar(d.ultimaRelease, 14).padEnd(14)} ${cortar(d.pagina, 10).padEnd(10)} `
      + `${cortar(d.mensagem, 44).padEnd(44)} ${String(d.id).slice(0, 8)}\n`
    );
  }
  if (totalDefeitos > itens.length) {
    process.stdout.write(`\n... e mais ${totalDefeitos - itens.length}, fora do --limite de ${limite}.\n`);
  }
  process.stdout.write('\nDetalhe de um: npm run diag -- defeitos --id <uuid>   (o uuid inteiro sai no --json)\n');
}

/**
 * UM defeito com suas ocorrências, e as MIGALHAS como linha do tempo.
 *
 * A LINHA DO TEMPO É O MOTIVO DE A TELA EXISTIR. A linha agregada responde "o quê e quantas
 * vezes"; a ocorrência responde "em qual aba, em qual página, com qual requisição"; e a
 * migalha responde "o que a pessoa tinha acabado de fazer", que é a única das três que
 * costuma explicar o defeito. Ela sai em ordem CRONOLÓGICA (como o cliente a montou), com o
 * horário fino, porque migalhas de um mesmo gesto caem no mesmo segundo e a ordem é a
 * informação.
 */
function imprimirUmDefeito(d, ocorrencias) {
  process.stdout.write(`${d.id}   [${d.estado}]   ${d.ocorrencias} ocorrência(s)\n`);
  process.stdout.write(`assinatura : ${d.assinatura}\n`);
  process.stdout.write(`mensagem   : ${d.mensagem}\n`);
  process.stdout.write(`origem     : ${d.origem ?? '-'}   página: ${d.pagina ?? '-'}   atlas: ${d.atlasId ?? '-'}\n`);
  process.stdout.write(`release    : primeira ${d.primeiraRelease ?? '-'} → última ${d.ultimaRelease ?? '-'}\n`);
  process.stdout.write(`visto      : ${hora(d.primeiraEm)} → ${hora(d.ultimaEm)}\n`);
  process.stdout.write(`url        : ${d.url ?? '-'}\n`);
  process.stdout.write(`usuário    : ${d.username ?? '(anônimo)'}   sessão: ${d.sessaoId ?? '-'}\n`);
  if (d.estado === 'resolvido' || d.estado === 'regrediu') {
    process.stdout.write(
      `resolvido  : ${hora(d.resolvidoEm)} por ${d.resolvidoPorUsername ?? '?'} na release ${d.resolvidoNaRelease ?? '(não anotada)'}`
      + `${d.resolvidoNoCommit ? ` (commit ${d.resolvidoNoCommit})` : ''}\n`
    );
  }
  if (d.stackBruta) {
    process.stdout.write('\npilha crua (da PRIMEIRA vez; desminifique com: npm run diag -- pilha --id <uuid> --mapas <dir>):\n');
    for (const linha of String(d.stackBruta).split(/\r?\n/).slice(0, 6)) {
      process.stdout.write(`  ${linha}\n`);
    }
  }

  if (!ocorrencias.length) {
    process.stdout.write('\nNenhuma ocorrência guardada. Isto NÃO é "nunca ocorreu": a tabela de ocorrências\n');
    process.stdout.write('nasceu depois da de defeitos, e a poda por idade apaga as duas juntas.\n');
    return;
  }
  process.stdout.write(`\n${ocorrencias.length} ocorrência(s) guardada(s), da mais recente para a mais antiga:\n`);
  for (const o of ocorrencias) {
    process.stdout.write(`\n  ${hora(o.em)}   release ${o.release ?? '-'}   página ${o.pagina ?? '-'}   sessão ${o.sessaoId ?? '-'}\n`);
    if (o.rota || o.statusCode || o.reqId) {
      process.stdout.write(`      rota ${o.rota ?? '-'}   status ${o.statusCode ?? '-'}   req ${o.reqId ?? '-'}\n`);
    }
    const migalhas = Array.isArray(o.migalhas) ? o.migalhas : [];
    if (!migalhas.length) continue;
    process.stdout.write('      migalhas:\n');
    for (const m of migalhas) {
      process.stdout.write(`        ${horaFina(m.t).padEnd(26)} ${cortar(m.tipo, 12).padEnd(12)} ${m.texto ?? ''}\n`);
    }
  }
}

/**
 * A pilha desminificada, quadro a quadro.
 *
 * O QUADRO CRU VAI JUNTO DO RESOLVIDO, indentado embaixo, e não é redundância: é a evidência
 * de onde a resposta veio. Sem ele, um mapeamento errado (coluna deslocada por um, mapa de
 * outro chunk com o mesmo nome) é indistinguível de um certo, e a saída deste comando é
 * justamente o tipo de coisa que se copia para um relatório sem conferir.
 *
 * OS TRÊS MOTIVOS DE NÃO RESOLVER SAEM COM NOMES DIFERENTES (ver `resolverQuadros`), porque
 * "não achei o `.map`" e "achei e a posição não cai em segmento nenhum" mandam procurar
 * coisas opostas: a primeira é build publicada sem mapa, a segunda é coluna ou mapa errados.
 */
function imprimirPilha(quadros) {
  for (const q of quadros) {
    if (q.motivo === 'sem-quadro') {
      process.stdout.write(`${q.bruta}\n`);
      continue;
    }
    if (q.resolvido) {
      // A COLUNA SAI 1-BASED AQUI, e só aqui. O `.map` é 0-based nas duas coordenadas, mas
      // a LINHA já sai 1-based (o formato conta a partir de zero e a referência humana
      // conta a partir de um), então imprimir a coluna crua ao lado dela produziria
      // `arquivo:10:6` com DOIS sistemas de contagem na mesma referência, e um editor abre
      // isso na coluna errada. O `--json` continua 0-based em `colunaOriginal`, porque lá o
      // consumidor é código e a convenção do formato é a que vale; a diferença está escrita
      // no cabeçalho de `scripts/diag/mapa-de-fonte.js`.
      const coluna = q.colunaOriginal + 1;
      process.stdout.write(`  ${q.fonte}:${q.linhaOriginal}:${coluna}${q.nome ? ` (${q.nome})` : ''}\n`);
    } else {
      const marca = q.motivo === 'sem-mapa' ? '[sem mapa]' : '[sem segmento]';
      process.stdout.write(`  ${marca} ${q.arquivo ?? q.url}:${q.linha}:${q.coluna}${q.erroDoMapa ? `  (${q.erroDoMapa})` : ''}\n`);
    }
    process.stdout.write(`      ← ${q.bruta.trim()}\n`);
  }
}

/**
 * A explicação da recusa, ESCRITA UMA VEZ e usada pelas duas saídas.
 *
 * Ela sai no stderr no modo humano e vai dentro do documento no `--json`, e é a mesma string
 * nos dois porque duas redações da mesma recusa divergem no dia em que alguém melhorar uma:
 * é o argumento que este repositório aplica a `denialNotice` no cliente e ao par de frases do
 * 360, e vale igual aqui.
 */
const EXPLICACAO_DA_RECUSA = 'NADA foi resolvido, de propósito: os endereços desta pilha só significam alguma coisa '
  + 'lidos contra o bundle que a produziu. Contra outra build a resolução NÃO falha, ela devolve '
  + 'funções e linhas plausíveis e ERRADAS, que é pior que pilha nenhuma.';

/**
 * O bloco que sai quando NENHUMA build declara a release da pilha.
 *
 * ELE É A PEÇA CENTRAL DO COMANDO, e não um caso de erro. Ver o cabeçalho de
 * `scripts/diag/pilha.js`: resolver contra outra build não falha, devolve nomes e linhas
 * plausíveis e errados, e um relatório assim custa mais que pilha nenhuma. As candidatas vão
 * junto porque elas separam os dois diagnósticos ("digitei o caminho errado" e "a build foi
 * podada"), e a pilha crua vai junto porque ela é o que o operador ainda pode usar.
 */
function imprimirPilhaSemRelease(release, raiz, candidatas, stackBruta) {
  process.stderr.write(`NENHUMA BUILD SOB ${path.resolve(raiz)} DECLARA A RELEASE "${release}".\n`);
  process.stderr.write(`${EXPLICACAO_DA_RECUSA}\n`);
  if (candidatas.length) {
    process.stderr.write(`\nO que há ali (${candidatas.length}):\n`);
    for (const c of candidatas) process.stderr.write(`  ${c.release}   ${c.diretorio}\n`);
  } else {
    process.stderr.write('\nNenhum release.json foi encontrado ali, nem na raiz nem um nível abaixo. Aponte\n');
    process.stderr.write('--mapas para o dist/ de uma build ou para o diretório que contém as builds.\n');
  }
  process.stderr.write('\npilha crua:\n');
  process.stdout.write(`${stackBruta}\n`);
}

/**
 * Busca um defeito pelo id, validando o formato ANTES de ir ao banco.
 *
 * A VALIDAÇÃO É NA BORDA porque o desfecho sem ela é ilegível: `id` é UUID, e um texto que
 * não seja UUID levanta `22P02` no driver, que chega ao terminal como um erro de sintaxe de
 * entrada para tipo uuid, sem relação aparente com o argumento que o operador digitou. É a
 * mesma razão pela qual `audit_trail.target_id` nasceu TEXT (ver `backend/CLAUDE.md`).
 *
 * @returns {Promise<{defeito: Object|null, erro: string|null}>}
 */
async function buscarDefeito(id) {
  if (!id) return { defeito: null, erro: 'Falta --id <uuid>.' };
  if (!UUID.test(id)) return { defeito: null, erro: `--id não é um uuid: "${id}".` };
  // A CONSULTA E O MAPEAMENTO VÊM DO SERVIÇO, como a listagem logo abaixo: `obterDefeito` é
  // a mesma função que a rota usaria, sobre o mesmo mapeador. Enquanto o módulo esteve
  // congelado isto morou fora de `src/`, com uma cópia do SELECT e do mapeamento de colunas;
  // a cópia morreu quando o SQL voltou para casa, e é isso que garante que `defeitos` e
  // `defeitos --id` respondam o MESMO objeto sobre o mesmo defeito, que é a comparação que
  // um agente faz para se orientar.
  //
  // O `abrirBanco()` continua aqui e não é redundante: ele é o que REGISTRA o módulo do
  // banco para `fecharBanco()`, e sem o par o pool fica aberto e o comando pendura o
  // terminal depois de imprimir a resposta inteira.
  await abrirBanco();
  const { obterDefeito } = await import('../src/modules/diag/defeitos.service.js');
  const defeito = await obterDefeito(id);
  if (!defeito) {
    return {
      defeito: null,
      erro: `Nenhum defeito com id ${id}. A poda por idade apaga defeito e ocorrências juntos,`
        + ' então um id que a listagem mostrou minutos atrás pode ter envelhecido.',
    };
  }
  return { defeito, erro: null };
}

/**
 * `defeitos`: a listagem, ou UM defeito com suas ocorrências.
 *
 * A LISTAGEM VEM INTEIRA DE `listarDefeitos` (`src/modules/diag/defeitos.service.js`), a
 * mesma função que serve `GET /diag/defeitos`. Nem o SQL, nem os filtros, nem o mapeamento
 * de colunas são reescritos aqui: uma segunda verdade sobre o que "defeito aberto na janela"
 * significa faria a tela e o comando divergirem no dia em que um dos dois fosse consertado,
 * e o comando é o que um agente lê.
 *
 * @returns {Promise<{codigo: number, estrutura: Object|null}>}
 */
async function comandoDefeitos(op) {
  const limite = op.limite || 50;

  if (op.id !== null) {
    const { defeito, erro } = await buscarDefeito(op.id);
    if (!defeito) {
      process.stderr.write(`${erro}\n`);
      return { codigo: 1, estrutura: null };
    }
    const { listarOcorrencias } = await import('../src/modules/diag/defeitos.service.js');
    const { itens } = await listarOcorrencias(defeito.id);
    return { codigo: 0, estrutura: { defeito, ocorrencias: itens }, imprimir: () => imprimirUmDefeito(defeito, itens) };
  }

  const { listarDefeitos } = await import('../src/modules/diag/defeitos.service.js');
  const r = await listarDefeitos({
    desde: op.desde,
    estado: op.estado,
    origem: op.origem,
    release: op.release,
    pagina: op.pagina,
    novos: op.novos,
    limite,
  });
  const filtros = {
    estado: op.estado, origem: op.origem, release: op.release, pagina: op.pagina, novos: op.novos, limite,
  };
  return {
    codigo: 0,
    estrutura: { totalDefeitos: r.totalDefeitos, itens: r.itens, filtros },
    imprimir: () => imprimirDefeitos(r, limite),
  };
}

/**
 * `pilha`: desminifica `stack_bruta` contra os `.map` da release que a produziu.
 *
 * OS CÓDIGOS DE SAÍDA SÃO TRÊS E SIGNIFICAM COISAS DIFERENTES: 0 resolveu (ainda que alguns
 * quadros fiquem sem mapa), 1 é erro de uso ou defeito inexistente, e 2 é a recusa
 * deliberada, quando nenhuma build sob `--mapas` declara a release. O 2 existe separado
 * justamente para que um roteiro possa distinguir "não deu para responder" de "respondi", em
 * vez de tratar a recusa como falha genérica.
 *
 * @returns {Promise<{codigo: number, estrutura: Object|null}>}
 */
async function comandoPilha(op) {
  const { defeito, erro } = await buscarDefeito(op.id);
  if (!defeito) {
    process.stderr.write(`${erro}\n`);
    return { codigo: 1, estrutura: null };
  }
  if (!defeito.stackBruta) {
    process.stderr.write(`O defeito ${defeito.id} não tem pilha crua (\`stack_bruta\` nula), então não há o que desminificar.\n`);
    process.stderr.write('Ela só é gravada quando o relato do cliente a traz, e fica fixada na PRIMEIRA vez.\n');
    return { codigo: 1, estrutura: null };
  }

  // `primeira_release` É OPCIONAL, e sem ela não há PERGUNTA a fazer ao disco. Cair na
  // recusa genérica produzia a frase 'NENHUMA BUILD ... DECLARA A RELEASE "null"', que
  // manda o operador procurar uma build chamada null; e passar `null` à busca casaria com
  // qualquer `release.json` que também não declarasse a sua, ou seja, resolveria contra uma
  // build arbitrária, que é exatamente o que este comando existe para não fazer. Código 1
  // e não 2: o 2 significa "a build não está aqui", e aqui o que falta é o dado.
  if (!defeito.primeiraRelease) {
    process.stderr.write(`O defeito ${defeito.id} não tem release do primeiro avistamento (\`primeira_release\` nula).\n`);
    process.stderr.write('A pilha crua só pode ser lida contra o bundle que a produziu, e sem esse campo não\n');
    process.stderr.write('há como saber qual foi. Ela é gravada quando o relato traz a release, e relato sem\n');
    process.stderr.write('ela deixa a coluna vazia para sempre: a pilha crua fica fixada no PRIMEIRO avistamento.\n');
    return { codigo: 1, estrutura: null };
  }

  const quadros = analisarPilha(defeito.stackBruta);
  const { diretorio, candidatas } = localizarReleaseDeMapas(op.mapas, defeito.primeiraRelease);
  const cabecalho = {
    defeito: { id: defeito.id, estado: defeito.estado, mensagem: defeito.mensagem, ocorrencias: defeito.ocorrencias },
    release: defeito.primeiraRelease,
    mapas: path.resolve(op.mapas),
    candidatas,
  };

  if (!diretorio) {
    return {
      codigo: 2,
      estrutura: {
        ...cabecalho,
        diretorio: null,
        // A RECUSA É UM CAMPO, e não a ausência de `diretorio`, porque o consumidor do
        // `--json` é um roteiro: ele precisa de algo que se leia como decisão declarada, não
        // de um nulo que se possa interpretar como "não consegui". A explicação vem da mesma
        // constante que o modo humano imprime.
        recusa: { motivo: 'release-nao-encontrada', explicacao: EXPLICACAO_DA_RECUSA },
        stackBruta: defeito.stackBruta,
        quadros,
      },
      imprimir: () => imprimirPilhaSemRelease(defeito.primeiraRelease, op.mapas, candidatas, defeito.stackBruta),
    };
  }

  const resolvidos = resolverQuadros(quadros, diretorio, resolverPosicao);
  return {
    codigo: 0,
    estrutura: { ...cabecalho, diretorio, quadros: resolvidos },
    imprimir: () => {
      process.stdout.write(`# defeito ${defeito.id} [${defeito.estado}] | release ${defeito.primeiraRelease} | ${diretorio}\n\n`);
      imprimirPilha(resolvidos);
    },
  };
}

/**
 * Roda `defeitos` ou `pilha`, decide a saída e FECHA O POOL, sempre.
 *
 * O `finally` NÃO É HIGIENE, É O QUE FAZ O COMANDO TERMINAR: uma conexão de pool aberta
 * segura o loop de eventos, e sem ele o processo imprime a resposta inteira e fica pendurado
 * no terminal, o que se lê como consulta lenta e não como handle esquecido.
 *
 * O CÓDIGO DE SAÍDA VAI EM `process.exitCode`, NUNCA `process.exit()`: o segundo mataria o
 * processo antes de o `pgp.end()` terminar, deixando conexões penduradas no Postgres a cada
 * invocação. Com `exitCode`, o processo sai sozinho quando o último handle fecha, carregando
 * o código.
 *
 * A VALIDAÇÃO DE `--estado` E `--origem` É AQUI, contra os vocabulários importados, e ela
 * RECLAMA em vez de repassar: um valor não reconhecido chega ao SQL como filtro de igualdade
 * e devolve LISTA VAZIA, que se lê como "nenhum defeito assim" quando na verdade é um erro de
 * digitação. É o mesmo argumento de `parseJanela` devolver `null` no que não entende.
 */
async function comandoDeBanco(op, janela) {
  for (const [bandeira, valor, aceitos] of [
    ['--estado', op.estado, ESTADOS_DE_DEFEITO],
    ['--origem', op.origem, ORIGENS_DE_ERRO],
  ]) {
    if (valor !== null && !aceitos.includes(valor)) {
      process.stderr.write(`${bandeira} inválido: "${valor}". Aceitos: ${aceitos.join(', ')}.\n`);
      process.stderr.write('Um valor não reconhecido não filtraria nada, devolveria lista VAZIA e se leria como\n');
      process.stderr.write('"nenhum defeito assim", que é a resposta errada com cara de resposta.\n');
      process.exitCode = 1;
      return;
    }
  }

  // `--mapas` É ARGUMENTO DE ARQUIVO, então ele é cobrado ANTES do pool: abrir conexão para
  // descobrir que falta uma bandeira é trabalho jogado fora e, pior, com o Postgres fora do ar
  // trocaria a frase certa ("falta --mapas") pela errada ("não consegui abrir o banco").
  if (op.comando === 'pilha' && !op.mapas) {
    process.stderr.write('Falta --mapas <dir>: o diretório da build (com release.json) ou o que contém as builds.\n');
    process.exitCode = 1;
    return;
  }

  // O POOL É ABERTO AQUI, ANTES DO DESPACHO, e não onde ele é usado. Foi um defeito real e
  // ele é o tipo que se descobre pelo sintoma errado: `comandoDefeitos` chegava ao banco pelo
  // `listarDefeitos` do serviço, que importa `database/index.js` por conta própria, então o
  // pool nascia sem `bancoAberto` nunca ter sido preenchido, o `finally` abaixo não fechava
  // nada e o comando imprimia a resposta INTEIRA e ficava pendurado no terminal. Quem usa o
  // pool e quem o fecha precisam ser a mesma decisão, e ela é esta linha.
  try {
    await abrirBanco();
  } catch (err) {
    process.stderr.write(`Não foi possível abrir o banco: ${err.message}\n`);
    process.stderr.write('`defeitos` e `pilha` leem as tabelas, e não o log: eles exigem DATABASE_URL e JWT_SECRET.\n');
    process.stderr.write('Para diagnosticar com o Postgres fora, use os comandos de log (erros, lento, status, saude, linhas).\n');
    process.exitCode = 1;
    return;
  }

  try {
    const r = op.comando === 'pilha' ? await comandoPilha(op) : await comandoDefeitos(op);
    process.exitCode = r.codigo;
    if (!r.estrutura) return;
    if (op.json) {
      // `pilha` não tem janela nenhuma (ela responde sobre UMA linha, achada por id), e
      // `null` diz isso melhor que uma janela inventada de 24h que não filtrou coisa alguma.
      const janelaDoComando = op.comando === 'pilha' || op.id !== null
        ? null
        : { desde: op.desde, desdeMs: janela, inicio: Date.now() - janela, fim: Date.now() };
      escreverJson(op.comando, janelaDoComando, r.estrutura);
      return;
    }
    r.imprimir();
  } finally {
    await fecharBanco();
  }
}

async function main() {
  const op = lerArgumentos(process.argv.slice(2));

  if (!COMANDOS.has(op.comando)) {
    ajuda(op.json ? process.stderr : process.stdout);
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

  // Mesmo contrato de `--desde` e `--intervalo`: forma não reconhecida RECLAMA. `parseInt`
  // aceita `12abc` e devolve 12, e devolve NaN em `abc`; os dois, mais o zero, caíam no
  // default calado e faziam o comando cortar a lista num tamanho que ninguém pediu.
  if (op.limiteBruto !== null && !/^[1-9][0-9]*$/.test(String(op.limiteBruto).trim())) {
    process.stderr.write(`Limite inválido: "${op.limiteBruto}". Use um inteiro maior que zero.\n`);
    process.stderr.write('Zero é um número fácil de digitar e não é um limite: ele cairia no default e o\n');
    process.stderr.write('comando cortaria a lista num tamanho que você não pediu, sem dizer nada.\n');
    process.exit(1);
  }

  if (COMANDOS_DE_BANCO.has(op.comando)) {
    // O DESVIO É AQUI, DEPOIS DA JANELA E ANTES DO DIRETÓRIO. Depois da janela porque
    // `defeitos` usa a mesma gramática de `--desde` e o mesmo erro serve aos dois; antes do
    // diretório porque estes dois não leem `.jsonl` nenhum, e cair no `existsSync` de
    // LOG_DIR faria um `diag -- defeitos` morrer por falta de um diretório de log que ele
    // não vai abrir.
    await comandoDeBanco(op, janela);
    return;
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
  const relatorio = await coletar(op, dir, janela, agora);
  const { arquivosLidos, linhas, inicio } = relatorio.leitura;

  if (op.json) {
    // O CABEÇALHO HUMANO VIRA `janela`, e não some. Ele carrega o diretório resolvido, a
    // contagem de arquivos e a de linhas, que são o que torna a resposta FALSIFICÁVEL: sem
    // eles, um `assinaturas: []` de um diretório errado é indistinguível de uma janela
    // limpa, e o consumidor desta saída (um agente) não tem terminal para desconfiar.
    escreverJson(op.comando, {
      desde: op.desde,
      desdeMs: janela,
      inicio: inicio.getTime(),
      fim: agora.getTime(),
      dir: path.resolve(dir),
      arquivos: arquivosLidos,
      linhas,
    }, relatorio.estrutura(inicio, agora, intervalo));
    return;
  }

  process.stdout.write(`# ${path.resolve(dir)} | ${arquivosLidos} arquivo(s) | desde ${inicio.toLocaleString('pt-BR')} | ${linhas} linha(s)\n\n`);
  relatorio.imprimir(inicio, agora, intervalo);
}

/**
 * O resumo de saúde pronto para o envelope, com o `janela` DELE renomeado.
 *
 * ESTE É O ÚNICO CHOQUE DE NOME DO PRODUTO, e ele era silencioso: `resumirAmostras` devolve
 * um campo `janela` (`{ inicio, fim }`, as pontas que ele recebeu), e o envelope de `--json`
 * tem outro `janela`, com a procedência inteira (diretório, arquivos, linhas). Enquanto o
 * envelope era escrito ANTES do espalhamento, o resumo o SOBRESCREVIA, e o documento de
 * `saude --json` saía sem dizer de qual diretório veio nem quantas linhas leu, ou seja, sem
 * a única metade que o torna falsificável. Nada ficava vermelho.
 *
 * Renomear é melhor que descartar: as duas pontas continuam sendo o que o resumo usou para
 * decidir o que é buraco e o que é desconhecido, e um leitor que compare `janelaDaSerie` com
 * `janela` está fazendo a conferência certa. Quem lança na colisão é `escreverJson`, e foi
 * ele que achou este caso.
 */
function estruturaDeSaude(amostras, opcoes) {
  const { janela: janelaDaSerie, ...resto } = resumirAmostras(amostras, opcoes);
  return { ...resto, janelaDaSerie };
}

/**
 * Uma passada por comando (duas em `erros`), com o acumulador que aquele comando precisa.
 *
 * O DESPACHO É AQUI, ANTES DA LEITURA, e não depois: é o que permite a cada comando reter só
 * o seu. Um leitor único que devolvesse a lista para todos obrigaria os cinco a pagar a
 * memória do mais caro, que é justamente o defeito que saiu.
 *
 * A impressão fica numa função de retorno em vez de acontecer aqui porque o CABEÇALHO (com a
 * contagem de linhas) vem antes do corpo e só se conhece depois da leitura.
 */
async function coletar(op, dir, janela, agora) {
  if (op.comando === 'erros') {
    // PRIMEIRA PASSADA: só os `reqId` que têm linha rica. Ver o `fileoverview`.
    const indice = criarIndiceDeRequisicoesComErro();
    await percorrerRegistros(dir, janela, agora, (reg) => indice.ver(reg));
    const agrupador = criarAgrupadorDeErros(indice.resultado());
    const censo = criarCensoDeEnderecos();
    const leitura = await percorrerRegistros(dir, janela, agora, (reg) => {
      agrupador.ver(reg);
      // O censo é da JANELA, não dos erros: é ele que diz se o endereço é constante no
      // arquivo inteiro, que é o que desambigua um grupo de endereço único.
      censo.ver(reg);
    });
    const grupos = agrupador.grupos();
    const limiteDeErros = op.limite || 20;
    return {
      leitura,
      imprimir: () => imprimirErros(grupos, limiteDeErros, censo.resultado()),
      // O `--limite` É RESPEITADO TAMBÉM AQUI, e a alternativa (mandar tudo, já que JSON não
      // tem largura de terminal) foi recusada: o mesmo comando com os mesmos argumentos tem
      // de responder à mesma pergunta nos dois modos, senão comparar as duas saídas deixa de
      // provar qualquer coisa. O que NÃO se perde é a contagem de antes do corte, que vai
      // ao lado.
      estrutura: () => ({
        totalDeAssinaturas: grupos.length,
        totalDeOcorrencias: grupos.reduce((soma, g) => soma + g.total, 0),
        limite: limiteDeErros,
        assinaturas: grupos.slice(0, limiteDeErros),
        enderecos: censo.resultado(),
      }),
    };
  }

  if (op.comando === 'lento') {
    const resumo = criarResumoDeLatencia();
    const leitura = await percorrerRegistros(dir, janela, agora, (reg) => resumo.ver(reg));
    const rotas = resumo.resultado();
    const limiteDeRotas = op.limite || 15;
    return {
      leitura,
      imprimir: () => imprimirLento(rotas, limiteDeRotas),
      estrutura: () => ({ totalDeRotas: rotas.length, limite: limiteDeRotas, rotas: rotas.slice(0, limiteDeRotas) }),
    };
  }

  if (op.comando === 'status') {
    const resumo = criarResumoDeStatus();
    let erros = 0;
    const leitura = await percorrerRegistros(dir, janela, agora, (reg) => {
      resumo.ver(reg);
      if (ehErro(reg)) erros += 1;
    });
    const contagem = resumo.resultado();
    return {
      leitura,
      imprimir: () => imprimirStatus(contagem, erros),
      estrutura: () => ({ ...contagem, erros }),
    };
  }

  if (op.comando === 'saude') {
    // O ÚNICO comando que retém registros, e retém só as linhas de AMOSTRA: uma a cada
    // poucos minutos por processo, ou seja, centenas num dia contra centenas de milhares de
    // linhas de requisição. `resumirAmostras` precisa da série inteira (ela mede DISTÂNCIAS
    // entre pontos consecutivos e um percentil sobre elas), e essa série é pequena por
    // construção. Filtrar aqui, e não lá dentro, é o que impede o resto de entrar.
    const amostras = [];
    const leitura = await percorrerRegistros(dir, janela, agora, (reg) => {
      if (reg.amostra === MARCADOR_AMOSTRA) amostras.push(reg);
    });
    return {
      leitura,
      // As DUAS pontas da janela vão junto: o começo, para nomear como DESCONHECIDO o trecho
      // anterior à primeira amostra, e o agora, porque a distância até a última amostra é o
      // sinal do presente. Sem elas o resumo saberia só o que aconteceu entre amostras.
      imprimir: (inicio, fim, intervalo) => imprimirSaude(
        amostras, { intervaloMs: intervalo, agora: fim.getTime(), inicio: inicio.getTime() }
      ),
      // `resumirAmostras` É CHAMADO DE NOVO AQUI, e não reaproveitado do `imprimir`: os dois
      // modos são exclusivos (só um deles roda numa invocação), então não há cálculo em
      // dobro, e amarrar os dois a um resultado compartilhado obrigaria `imprimirSaude` a
      // receber o resumo pronto, mudando a assinatura que
      // `tests/unit/diag-saude-impressao.test.js` exercita pelo comando de verdade.
      estrutura: (inicio, fim, intervalo) => estruturaDeSaude(
        amostras, { intervaloMs: intervalo, agora: fim.getTime(), inicio: inicio.getTime() }
      ),
    };
  }

  // `linhas`: um anel do tamanho do `--limite`, e nada mais. Guardar tudo para mostrar as 50
  // últimas era o caso mais caro de todos, e o mais fácil de não notar.
  const limite = op.limite || 50;
  const anel = new Array(limite);
  let casaram = 0;
  const leitura = await percorrerRegistros(dir, janela, agora, (reg, linha) => {
    if (op.filtro && !linha.includes(op.filtro)) return;
    anel[casaram % limite] = linha;
    casaram += 1;
  });
  const corte = casaram % limite;
  const ultimas = casaram > limite
    ? [...anel.slice(corte, limite), ...anel.slice(0, corte)]
    : anel.slice(0, casaram);
  return {
    leitura,
    imprimir: () => imprimirLinhas(ultimas, casaram, leitura.linhas, op.filtro),
    // AS LINHAS VÃO COMO TEXTO CRU dentro do documento, e não reparseadas em objeto. É a
    // mesma decisão do `--filtro`: o que este comando entrega é o que existe no disco, e
    // reparsear entregaria uma normalização (do escape, principalmente) que nenhum arquivo
    // tem. Quem quiser os objetos tem `jq -R 'fromjson'` sobre elas.
    estrutura: () => ({ casaram, naJanela: leitura.linhas, filtro: op.filtro, linhas: ultimas }),
  };
}

/**
 * Este arquivo é comando E módulo: os testes importam `percorrerRegistros` para medir a
 * leitura sem dirigir o comando inteiro, e sem esta guarda o simples import executaria
 * `main()` com os argumentos do corredor de testes.
 *
 * A COMPARAÇÃO É DE CAMINHO RESOLVIDO, e ela é frouxa quanto à caixa no Windows de
 * propósito: o npm pode entregar o drive em caixa diferente da que `import.meta.url`
 * resolve, e um falso negativo aqui não daria erro nenhum, apenas um comando que não faz
 * nada. Quem vigia isso é `tests/unit/diag-saude-impressao.test.js`, que dirige o comando de
 * verdade por `spawnSync` e ficaria vermelho na hora.
 */
function ehEntrada() {
  const esteArquivo = fileURLToPath(import.meta.url);
  const chamado = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return process.platform === 'win32'
    ? chamado.toLowerCase() === esteArquivo.toLowerCase()
    : chamado === esteArquivo;
}

if (ehEntrada()) {
  main().catch((err) => {
    process.stderr.write(`diag falhou: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}

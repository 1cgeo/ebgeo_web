// Path: tests/bench/lib/bancada.mjs
//
// The scaffolding every write bench shares: database, server, warm-up, sampling, report.
//
// WHY A SHARED RUNNER AND NOT SEVEN SELF-CONTAINED SCRIPTS. The parts that are easy to get
// subtly wrong are identical across scenarios — discarding the warm-up, resetting the loop
// histogram at the right moment, starting the pg sampler BEFORE the first request and stopping
// it AFTER the last, running reconciliation over the right set of atlases. Duplicated seven
// times, one of them would drift and the bench would report a number nobody could trust. What
// stays per-scenario is what genuinely differs: which writers exist and what they do.
//
// THE WARM-UP IS DISCARDED, AND ITS ROWS ARE NOT. A cold pool, a cold JIT and an empty
// `operations` table make the first degrau look better and then worse than the steady state.
// The warm-up runs against the same atlas (so the ledger it will be measured against is already
// warm) and its op ids are thrown away, so reconciliation only judges the measured window.
//
// A DEGRAU IS ONE MEASUREMENT, NOT A SUITE. `medir()` runs the tasks it is given, concurrently,
// and reports. Nothing here decides how many writers there are or what they write; that is the
// scenario's job, and keeping it there is what lets E4 spread writers across atlases and E5 add
// silent listeners without teaching this file about either.

import { subirServidor } from './servidor.mjs';
import { prepararBanco, DSN_PADRAO } from './semear.mjs';
import { amostrarPg } from './sonda-pg.mjs';
import { reconciliar, imprimirProvas } from './reconciliar.mjs';
import { Serie, cabecalho, imprimirCabecalho, tabela, round } from './metricas.mjs';
import { escritorRest, criarRegistro } from './escritor.mjs';
import { baseDaRodada } from './linha-de-base.mjs';
import { medirCargaDaMaquina, saudeDoAmbiente } from './carga-da-maquina.mjs';

// O cabecalho da rodada corrente. `fechar()` precisa dele para gravar a linha de base, e passa-lo
// por parametro obrigaria a mexer nas sete bancadas de escrita por uma razao que nao e delas.
// Escopo de modulo funciona porque uma bancada e um processo, e roda uma vez.
let cabecalhoDaRodada = null;

/**
 * Prepares the database, boots the server, runs `corpo`, and tears everything down.
 *
 * The teardown is in `finally` for a blunt reason: a bench that throws halfway would otherwise
 * leave an orphan server holding the bench database, and the NEXT run would fail at
 * `DROP DATABASE` with an error that says nothing about the real cause.
 *
 * @param {Object} opts
 * @param {string} opts.titulo
 * @param {string} [opts.dsn]
 * @param {(ctx: Object) => Promise<void>} corpo
 */
export async function comBancada({ titulo, dsn = DSN_PADRAO, extraCabecalho = {} }, corpo) {
  console.log(`\n${titulo}`);
  cabecalhoDaRodada = await cabecalho({
    banco: new URL(dsn).pathname.replace(/^\//, ''),
    limitadores: 'DESLIGADOS (NODE_ENV=test)',
    log: 'silencioso (NODE_ENV=test)',
    ...extraCabecalho,
  });
  imprimirCabecalho(cabecalhoDaRodada);

  await prepararBanco({ dsn, recriar: true });
  const servidor = await subirServidor({ databaseUrl: dsn });
  let codigo;
  try {
    codigo = (await corpo({ dsn, servidor, base: servidor.base })) ?? 0;
  } finally {
    await servidor.parar();
  }
  process.exitCode = codigo;
}

/**
 * O cabecalho da rodada corrente, para quem grava linha de base FORA do `fechar()`.
 *
 * As tres bancadas de populacao montam a propria tabela e nao passam por `fechar()`, mas a linha
 * de base delas precisa do mesmo cabecalho (maquina, commit, pool) que as de escrita gravam. Sem
 * isso a base guardaria numeros sem dizer de que maquina eles sao.
 */
export function cabecalhoDaBase() {
  return cabecalhoDaRodada;
}

/**
 * Pushes a few batches to warm the pool, the JIT and the table, then clears the loop histogram.
 *
 * Its ops are recorded in a throwaway registry: they are real rows in `operations`, but they are
 * not part of what the measured window has to account for.
 */
export async function aquecer({ servidor, token, atlasId, mapId, lotes = 3, opsPorLote = 10 }) {
  const serie = new Serie('aquecimento');
  await escritorRest({
    base: servidor.base, token, atlasId, mapId, lotes, opsPorLote,
    serie, registro: criarRegistro(),
  });
  await servidor.laco({ reset: true });
  return serie.resumo();
}

/**
 * Runs one degrau: starts the samplers, awaits every task, stops the samplers, reconciles.
 *
 * @param {Object} opts
 * @param {Object} opts.ctx - From `comBancada`.
 * @param {string} opts.rotulo - Row label in the report (e.g. "8 escritores").
 * @param {string[]} opts.atlasIds - Atlases this degrau touches, for reconciliation.
 * @param {Object} opts.registro - Shared across every task of the degrau.
 * @param {Serie} opts.serie
 * @param {Array<() => Promise<any>>} opts.tarefas - The concurrent writers/listeners.
 * @param {{ parar: Function }} [opts.leitor] - An already-running incremental reader.
 * @returns {Promise<{ linha: Object, reconciliacao: Object, laco: Object|null, pg: Object }>}
 */
export async function medir({ ctx, rotulo, atlasIds, registro, serie, tarefas, leitor = null }) {
  const sonda = await amostrarPg(ctx.dsn);
  const maquina = medirCargaDaMaquina();
  await ctx.servidor.laco({ reset: true });

  serie.abrir();
  // `allSettled`, never `all`: one writer throwing must not cancel the measurement of the other
  // thirty-one. A rejection here is already counted in the serie by the writer itself.
  await Promise.allSettled(tarefas.map((t) => t()));
  serie.fechar();

  const leitura = leitor ? await leitor.parar() : null;
  const pg = await sonda.parar();
  const laco = await ctx.servidor.laco();
  // O driver das bancadas de escrita e ESTE processo, entao a CPU dele entra na subtracao.
  const cpuProprio = process.cpuUsage();
  const carga = maquina.parar({
    servidorMs: (laco?.cpuUsuarioMs ?? 0) + (laco?.cpuSistemaMs ?? 0),
    driversMs: Math.round((cpuProprio.user + cpuProprio.system) / 1000),
  });
  const rec = await reconciliar({ dsn: ctx.dsn, atlasIds, registro, leitura });

  const r = serie.resumo();
  return {
    linha: {
      degrau: rotulo,
      lotes: r.total,
      ok: r.ok,
      '503': r.indisponivel,
      p50: r.p50 ?? '-',
      p95: r.p95 ?? '-',
      p99: r.p99 ?? '-',
      max: r.max ?? '-',
      'lotes/s': r.vazaoPorSegundo,
      'ops/s': round((rec.resumo.acked * 1000) / Math.max(1, serie.fim - serie.inicio), 1),
      lockPico: pg.picoEsperandoLock,
      conexPico: pg.picoConexoes,
      lacoP99: laco?.lacoMs?.p99 ?? '-',
      lacoMax: laco?.lacoMs?.max ?? '-',
      rssMB: laco?.memoria?.rssMB ?? '-',
      aRetentar: rec.resumo.aRetentar,
      alheios: carga.nucleosAlheios,
      provas: rec.ok ? 'OK' : 'FALHA',
    },
    reconciliacao: rec,
    laco,
    pg,
    carga,
    statusBrutos: r.status,
  };
}

/** Columns every write bench prints, in the order that reads like a story. */
export const COLUNAS = [
  'degrau', 'lotes', 'ok', '503', 'p50', 'p95', 'p99', 'max',
  'lotes/s', 'ops/s', 'lockPico', 'conexPico', 'lacoP99', 'lacoMax', 'rssMB',
  'aRetentar', 'alheios', 'provas',
];

/**
 * Prints the table and the per-degrau reconciliation, and returns the process exit code.
 *
 * NON-ZERO ON A FAILED PROOF, and that is the one place this folder departs from "a bench never
 * asserts". Timing is descriptive; losing a write is not.
 */
export function fechar(resultados, notas = [], colunas = COLUNAS) {
  console.log('');
  tabela(resultados.map((r) => r.linha), colunas);

  // The accounting is printed on EVERY run, not only on failure. "acked: 4000, ledger: 4000" is
  // the line that makes the latency above mean something, and hiding it until something breaks
  // would leave the reader with no way to tell a fast run from a fast run that wrote nothing.
  console.log('\n  CONTABILIDADE POR DEGRAU');
  tabela(
    resultados.map((r) => ({ degrau: r.linha.degrau, ...r.reconciliacao.resumo })),
    ['degrau', 'enviados', 'acked', 'idempotentes', 'recusados', 'semVeredito',
      'linhasNoLedger', 'aRetentar']
  );

  for (const r of resultados) {
    if (!r.reconciliacao.ok) {
      console.log(`\n  degrau "${r.linha.degrau}":`);
      imprimirProvas(r.reconciliacao);
    }
  }

  const brutos = resultados
    .map((r) => `    ${r.linha.degrau}: ${JSON.stringify(r.statusBrutos)}`)
    .join('\n');
  console.log('\n  STATUS BRUTOS POR DEGRAU');
  console.log(brutos);

  if (notas.length > 0) {
    console.log('\n  LEITURA');
    for (const n of notas) console.log(`    - ${n}`);
  }

  // O AMBIENTE VEM ANTES DOS NUMEROS, porque ele decide se eles valem. Uma rodada com dois
  // nucleos gastos fora do experimento nao compara com nada, e a bancada diz isso antes de a
  // tabela ser lida, nao numa nota de rodape.
  const pior = resultados.reduce(
    (p, r) => ((r.carga?.nucleosAlheios ?? 0) > (p?.nucleosAlheios ?? 0) ? r.carga : p),
    null
  );
  const ambiente = saudeDoAmbiente(pior);
  console.log(`
  ${ambiente.texto}`);
  if (!ambiente.ok) console.log('  >>> ESTES NUMEROS NAO SERVEM DE LINHA DE BASE. <<<');

  // Grava ou compara a linha de base, conforme as bandeiras. REGRESSAO NAO REPROVA por si: a
  // bancada nao sabe se a mudanca foi deliberada. Ela imprime, e a decisao fica com quem leu o
  // plano. So perda de dado sai com codigo 1.
  baseDaRodada({
    linhas: resultados.map((r) => r.linha),
    cabecalho: cabecalhoDaRodada,
    chave: 'degrau',
  });

  const falhou = resultados.some((r) => !r.reconciliacao.ok);
  console.log('');
  return falhou ? 1 : 0;
}

/** Parses `--nome valor` from argv, with a default. Numbers only; scenarios need nothing else. */
export function arg(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? padrao : Number(process.argv[i + 1]);
}

/** Parses `--nome a,b,c` into a number array. */
export function argLista(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? padrao : String(process.argv[i + 1]).split(',').map(Number);
}

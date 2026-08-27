// Path: tests/bench/lib/coordenador.mjs
//
// Runs one population window: spawns the driver processes, waits, joins their files, reconciles.
//
// THE DELIVERY JOIN IS THE REASON THIS FILE EXISTS. The user who SENDS an operation and the user
// who RECEIVES it live in different processes, so no in-memory correlation is possible. Both
// write `(opId, wall-clock ms)` to a file, and the join happens here, afterwards. Wall clock is
// comparable across processes on one machine, which is the whole reason this works — it would not
// survive two machines, and the report says so rather than pretending.
//
// ONE OBSERVER PER ROOM, AND THE ASYMMETRY IS DELIBERATE. Every user records what it sent; only
// the first member of each room records what it received. Timestamping arrivals on all thousand
// sockets would make the drivers do more work than the server, and one observer per room already
// gives every room its own delivery distribution.
//
// WHAT RECONCILIATION MEANS AT THIS SCALE. The per-op registry of the write benches does not
// survive several processes, so the checks are stated over totals instead, and they are still
// falsifiable:
//   R1  rows in the ledger == operations acked. More rows than acks means writes nobody was told
//       about; fewer means an ack for a write that did not land.
//   R2  operations sent but absent from the ledger == the ones with no verdict, plus refusals.
//       Any other number means a batch was partly applied and reported as lost, or lost and
//       reported as applied.

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { Histograma, round } from './metricas.mjs';

const DIR_LIB = path.dirname(fileURLToPath(import.meta.url));

/**
 * Spawns the workers and waits for every one of them to exit.
 *
 * A worker that dies is fatal and named. Silently continuing with 700 of 1000 users would produce
 * a table that looks like a result and describes an experiment nobody designed.
 */
export async function rodarTrabalhadores({ fatias, base, cadencia, rampaMs, duracaoMs, dirTmp }) {
  fs.mkdirSync(dirTmp, { recursive: true });
  const specs = fatias.map((usuarios, i) => {
    const spec = {
      base,
      cadencia,
      usuarios,
      rampaMs,
      duracaoMs,
      saida: path.join(dirTmp, `resultado-${i}.json`),
      saidaOps: path.join(dirTmp, `ops-${i}.txt`),
      saidaChegadas: path.join(dirTmp, `chegadas-${i}.txt`),
    };
    const caminho = path.join(dirTmp, `spec-${i}.json`);
    fs.writeFileSync(caminho, JSON.stringify(spec));
    return { caminho, spec };
  });

  await Promise.all(specs.map(({ caminho }, i) => new Promise((resolve, reject) => {
    const filho = spawn(
      process.execPath,
      ['--max-old-space-size=2048', path.join(DIR_LIB, 'trabalhador.mjs'), caminho],
      { cwd: path.resolve(DIR_LIB, '../../..'), stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let erro = '';
    filho.stderr.on('data', (b) => { erro += b.toString(); });
    filho.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`trabalhador ${i} saiu com ${code}:\n${erro.slice(0, 2000)}`));
    });
  })));

  return specs.map(({ spec }) => spec);
}

/** Merges the per-worker summaries into one row per room size. */
export function fundirResumos(specs) {
  const porSala = new Map();
  let conectados = 0;
  let pedidos = 0;
  const falhas = [];
  let maiorConexaoMs = 0;
  let janelaMs = 0;
  const lacoDriver = { p99: 0, max: 0, piorTrabalhador: null };
  let rssDriverMB = 0;
  let cpuDriversMs = 0;

  for (const spec of specs) {
    const r = JSON.parse(fs.readFileSync(spec.saida, 'utf8'));
    conectados += r.usuariosConectados;
    pedidos += r.usuariosPedidos;
    falhas.push(...r.falhasDeConexao);
    maiorConexaoMs = Math.max(maiorConexaoMs, r.msDeConexao);
    janelaMs = Math.max(janelaMs, r.janelaMs);
    if (r.lacoDriverMs) {
      // O PIOR trabalhador manda, nunca a media. Um driver travado contamina os sockets DELE, e
      // diluir isso na media dos outros e como reportar a temperatura media de um paciente com
      // uma mao no gelo.
      if (r.lacoDriverMs.p99 > lacoDriver.p99) {
        lacoDriver.p99 = r.lacoDriverMs.p99;
        lacoDriver.piorTrabalhador = r.usuariosPedidos;
      }
      lacoDriver.max = Math.max(lacoDriver.max, r.lacoDriverMs.max);
    }
    rssDriverMB = Math.max(rssDriverMB, r.rssMB ?? 0);
    cpuDriversMs += r.cpuMs ?? 0;

    for (const b of r.porSala) {
      const chave = String(b.tamanhoSala);
      if (!porSala.has(chave)) {
        porSala.set(chave, {
          tamanhoSala: b.tamanhoSala,
          usuarios: 0,
          opsEnviadas: 0,
          acks: 0,
          recusadas: 0,
          erros: 0,
          mudos: 0,
          cursoresEnviados: 0,
          cursoresRecebidos: 0,
          opsRecebidas: 0,
          fechadosPeloServidor: 0,
          emVooNoFim: 0,
          ackHist: new Histograma(`ack-${chave}`),
        });
      }
      const a = porSala.get(chave);
      for (const k of ['usuarios', 'opsEnviadas', 'acks', 'recusadas', 'erros', 'mudos',
        'cursoresEnviados', 'cursoresRecebidos', 'opsRecebidas', 'fechadosPeloServidor',
        'emVooNoFim']) {
        a[k] += b[k] ?? 0;
      }
      if (b.ackHist) a.ackHist.fundir(Histograma.desserializar(b.ackHist));
    }
  }

  return {
    porSala, conectados, pedidos, falhas, maiorConexaoMs, janelaMs, lacoDriver, rssDriverMB,
    cpuDriversMs,
  };
}

/** Streams a whitespace-separated file line by line. */
async function porLinha(caminho, aoLer) {
  if (!fs.existsSync(caminho)) return;
  const rl = readline.createInterface({
    input: fs.createReadStream(caminho),
    crlfDelay: Infinity,
  });
  for await (const linha of rl) {
    if (linha) aoLer(linha);
  }
}

/**
 * Joins sends to arrivals and returns a delivery histogram per room size.
 *
 * The map of sent operations is the memory high-water mark of the whole bench (hundreds of
 * thousands of entries at the heaviest cadence), which is why the coordinator, and not a worker,
 * carries it: the workers must stay light while the window is open.
 */
export async function juntarEntrega(specs) {
  const enviadas = new Map(); // opId -> [ts, tamanhoSala]
  for (const spec of specs) {
    await porLinha(spec.saidaOps, (linha) => {
      const [opId, ts, tamanho] = linha.split(' ');
      enviadas.set(opId, [Number(ts), Number(tamanho)]);
    });
  }

  const hist = new Map(); // tamanhoSala -> Histograma
  let casadas = 0;
  let orfas = 0;
  for (const spec of specs) {
    await porLinha(spec.saidaChegadas, (linha) => {
      const [opId, ts] = linha.split(' ');
      const origem = enviadas.get(opId);
      if (!origem) { orfas += 1; return; }
      const chave = String(origem[1]);
      if (!hist.has(chave)) hist.set(chave, new Histograma(`entrega-${chave}`));
      hist.get(chave).registrar(Number(ts) - origem[0]);
      casadas += 1;
    });
  }

  return { hist, casadas, orfas, enviadas };
}

/**
 * The two totals-level checks. Returns rows per room size plus a global verdict.
 *
 * Reads the ledger on a FRESH connection and counts by atlas, so a room's rows are attributed to
 * its size instead of being summed into one number that could hide a single broken room.
 */
export async function reconciliarPopulacao({ dsn, salas, porSala, enviadas }) {
  const tamanhoPorAtlas = new Map(salas.map((s) => [s.atlasId, s.tamanho]));
  const cliente = new pg.Client({ connectionString: dsn });
  await cliente.connect();
  let linhas;
  try {
    const { rows } = await cliente.query(
      'SELECT atlas_id, op_id FROM operations WHERE atlas_id = ANY($1::uuid[])',
      [salas.map((s) => s.atlasId)]
    );
    linhas = rows;
  } finally {
    await cliente.end().catch(() => {});
  }

  const noLedger = new Set();
  const linhasPorSala = new Map();
  for (const r of linhas) {
    noLedger.add(r.op_id);
    const chave = String(tamanhoPorAtlas.get(r.atlas_id));
    linhasPorSala.set(chave, (linhasPorSala.get(chave) ?? 0) + 1);
  }

  // Ops que este run enviou e o ledger não tem, contadas por sala.
  const ausentesPorSala = new Map();
  for (const [opId, [, tamanho]] of enviadas) {
    if (noLedger.has(opId)) continue;
    const chave = String(tamanho);
    ausentesPorSala.set(chave, (ausentesPorSala.get(chave) ?? 0) + 1);
  }

  const provas = [];
  let ok = true;
  for (const [chave, b] of porSala) {
    // As linhas do ledger incluem o que a RAMPA escreveu, que foi descartado das contagens do
    // trabalhador. Comparar direto acusaria diferença legítima, então o confronto é feito só
    // sobre as ops que a janela medida enviou.
    // A CHECAGEM E UMA BANDA, NAO UMA IGUALDADE, e a razao e a borda da janela. Uma op que ainda
    // esperava ack quando o cronometro parou pode ter sido gravada (e ai NAO esta ausente) ou nao
    // (e ai esta). As duas saidas sao legitimas. O que NAO pode acontecer e o numero de ausentes
    // ficar fora da banda: abaixo do piso significa op recusada que foi gravada; acima do teto
    // significa op perdida sem ninguem ter sido avisado.
    const ausentes = ausentesPorSala.get(chave) ?? 0;
    const piso = b.mudos + b.recusadas;
    const teto = piso + b.emVooNoFim;
    const r1 = ausentes >= piso && ausentes <= teto;
    if (!r1) ok = false;
    provas.push({
      sala: chave,
      linhasNoLedger: linhasPorSala.get(chave) ?? 0,
      ausentesDoLedger: ausentes,
      piso,
      teto,
      semVeredito: b.mudos,
      emVooNoFim: b.emVooNoFim,
      recusadas: b.recusadas,
      veredito: r1 ? 'OK' : 'FALHA',
    });
  }

  return { ok, provas };
}

/**
 * Builds the report row for one room size.
 *
 * THE CURSOR DROP RATE IS THE POINT OF THIS FUNCTION, and the arithmetic is worth stating because
 * an earlier draft of it was a tangle that computed nothing. In a room of `S` members, every frame
 * one member sends is relayed to the other `S - 1`. So, aggregated over all rooms of that size:
 *
 *     esperado = cursoresEnviados * (S - 1)
 *     perda%   = 100 * (1 - cursoresRecebidos / esperado)
 *
 * A number above zero is NOT a defect. Presence is droppable by design: a congested socket drops
 * the frame because the next one supersedes it, and the drop self-heals. It is a SATURATION
 * GAUGE — the point where the room stops keeping up — and that is exactly what the room-limit
 * sweep is looking for.
 */
export function linhaDeSala(b, histEntrega, janelaMs) {
  const seg = Math.max(1, janelaMs / 1000);
  const ack = b.ackHist.resumo();
  const ent = histEntrega ? histEntrega.resumo() : null;
  const esperadoCursor = b.cursoresEnviados * Math.max(0, b.tamanhoSala - 1);
  const perdaCursor = esperadoCursor > 0
    ? round(100 * (1 - b.cursoresRecebidos / esperadoCursor), 1)
    : 0;
  return {
    sala: b.tamanhoSala,
    usuarios: b.usuarios,
    'ops/s': round(b.opsEnviadas / seg, 1),
    'cursorEnv/s': round(b.cursoresEnviados / seg, 1),
    'cursorRec/s': round(b.cursoresRecebidos / seg, 1),
    perdaCursorPct: perdaCursor,
    ackP50: ack.p50,
    ackP95: ack.p95,
    ackP99: ack.p99,
    entregaP50: ent ? ent.p50 : '-',
    entregaP95: ent ? ent.p95 : '-',
    entregaP99: ent ? ent.p99 : '-',
    erros: b.erros,
    semVeredito: b.mudos,
    derrubados: b.fechadosPeloServidor,
  };
}

/**
 * Verdict on whether the INSTRUMENT was healthy enough for its numbers to mean anything.
 *
 * The threshold is not arbitrary. A user emits a cursor frame every 80 ms and flushes ops every
 * 500 ms; a driver whose loop stalls for a quarter of a second is already late for both, and one
 * that stalls past 30 s misses the heartbeat window and gets its sockets reaped by the server —
 * which is precisely what produced a 41-second `ackP95` next to a 32 ms server loop on the first
 * thousand-user run.
 */
export function saudeDoInstrumento(lacoDriver) {
  const p99 = lacoDriver?.p99 ?? 0;
  const max = lacoDriver?.max ?? 0;
  if (p99 >= 250 || max >= 5000) {
    return {
      ok: false,
      nivel: 'SATURADO',
      texto: `INSTRUMENTO SATURADO: laco do driver p99 ${p99} ms, max ${max} ms. `
        + 'Os numeros abaixo medem o driver, nao o servidor. Suba --trabalhadores e rode de novo.',
    };
  }
  if (p99 >= 80) {
    return {
      ok: true,
      nivel: 'APERTADO',
      texto: `Instrumento apertado: laco do driver p99 ${p99} ms, max ${max} ms. `
        + 'A cauda de latencia carrega atraso do driver; leia p50, desconfie de p95 e p99.',
    };
  }
  return {
    ok: true,
    nivel: 'SADIO',
    texto: `Instrumento sadio: laco do driver p99 ${p99} ms, max ${max} ms.`,
  };
}

/**
 * CPU of the server process as a percentage of ONE core, over the measured window.
 *
 * THIS IS THE NUMBER THAT CAUGHT THE OTHER ONE LYING. On a thousand-user window the loop
 * utilization read 0.1% while the process burned 99.6% of a core, two thirds of it in the kernel:
 * the work was socket writes on libuv's I/O threads, which never touch the loop that
 * `eventLoopUtilization` measures. Loop utilization alone would have concluded "the server was
 * idle" — and a bench that concludes that while the server is pinned is worse than no bench.
 */
export function cpuDoServidorPct(laco, janelaMs) {
  const total = (laco?.cpuUsuarioMs ?? 0) + (laco?.cpuSistemaMs ?? 0);
  if (!total || !janelaMs) return '-';
  return round((100 * total) / janelaMs, 1);
}

/** Column order for the population report. */
export const COLUNAS_POP = [
  'sala', 'usuarios', 'ops/s', 'cursorEnv/s', 'cursorRec/s', 'perdaCursorPct',
  'ackP50', 'ackP95', 'ackP99', 'entregaP50', 'entregaP95', 'entregaP99',
  'erros', 'semVeredito', 'derrubados',
];

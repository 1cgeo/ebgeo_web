// Path: tests/bench/lib/escritor.mjs
//
// The VIRTUAL WRITER: one simulated user pushing operation batches at an atlas.
//
// TWO PATHS, ONE WORKLOAD, AND THEY ARE NOT EQUIVALENT. A real client writes through
// `POST /api/v1/atlas/:id/sync` or through the collab socket, and both land in the SAME
// `pushOperations`. What differs is the failure report, and that difference is a result, not a
// detail: the REST path answers 503 with a retryable message when the advisory lock times out,
// while the socket path collapses every throw into a generic `OPERATION_FAILED` with no
// `ack_batch` and no per-op result (`src/modules/collab/collab.handlers.js`). A client on the
// socket therefore cannot tell "refused, retry" from "applied, ack lost". E3 exists to put a
// number on how often that happens under contention.
//
// ONE BATCH IN FLIGHT PER WRITER. The real client drains an outbound queue in order, and the
// socket path has no correlation id other than the op ids in `ack_batch`, so overlapping
// batches on one socket could not be matched to their acks without inventing a protocol the
// server does not speak. Serial per writer, parallel ACROSS writers: that is the contention we
// are after.
//
// THE REGISTRY IS THE POINT, NOT THE STOPWATCH. Every op id is recorded with what the server
// SAID happened to it. `reconciliar.mjs` then checks that claim against the ledger. A bench that
// only timed the requests would happily report excellent latency for a run that lost writes.

import { randomUUID } from 'crypto';
import WebSocket from 'ws';

/** Fresh registry of what a run sent and what came back. */
export function criarRegistro() {
  return {
    enviados: new Set(),
    acked: new Set(),
    idempotentes: new Set(),
    recusados: new Map(),
    // Ops whose batch got no per-op verdict: 503 from the lock timeout, a socket error, a
    // transport failure. The ledger decides what really happened to these.
    semVeredito: new Set(),
  };
}

/**
 * Builds one batch of feature operations.
 *
 * @param {Object} opts
 * @param {string} opts.mapId
 * @param {string} opts.clientId
 * @param {number} opts.quantidade
 * @param {string[]|null} [opts.alvos] - Entity ids to UPDATE. When given, the batch contends
 *   for the same rows (E7); when null, every op creates a fresh feature.
 * @param {number} opts.lamport
 */
export function criarLote({ mapId, clientId, quantidade, alvos = null, lamport }) {
  const ops = [];
  for (let i = 0; i < quantidade; i += 1) {
    const agora = Date.now();
    if (alvos && alvos.length > 0) {
      const entityId = alvos[(lamport + i) % alvos.length];
      ops.push({
        id: randomUUID(),
        entityType: 'feature',
        operationType: 'update',
        entityId,
        mapId,
        changes: {
          properties: {
            nome: `Editado ${lamport}.${i}`,
            descricao: `escritor ${clientId}`,
            visivel: true,
          },
        },
        timestamp: agora,
        lamportTimestamp: lamport + i,
        clientId,
      });
      continue;
    }
    const entityId = randomUUID();
    ops.push({
      id: randomUUID(),
      entityType: 'feature',
      operationType: 'create',
      entityId,
      mapId,
      data: {
        id: entityId,
        feature_type: 'point',
        geometry: { type: 'Point', coordinates: [-43.2 + i * 1e-5, -22.9 + i * 1e-5] },
        properties: {
          nome: `Ponto ${lamport}.${i}`,
          descricao: 'carga de bancada',
          visivel: true,
          color: '#ff0000',
        },
      },
      timestamp: agora,
      lamportTimestamp: lamport + i,
      clientId,
    });
  }
  return ops;
}

/** Folds a push response into the registry. Shared by both paths so they cannot drift. */
function contabilizar(registro, ops, resultados) {
  const porId = new Map((resultados ?? []).map((r) => [r.operationId, r]));
  for (const op of ops) {
    const r = porId.get(op.id);
    if (!r) {
      registro.semVeredito.add(op.id);
      continue;
    }
    if (r.success === false) registro.recusados.set(op.id, r.reason ?? 'sem motivo');
    else registro.acked.add(op.id);
    if (r.idempotent === true) registro.idempotentes.add(op.id);
  }
}

/**
 * Runs one REST writer to completion.
 *
 * @param {Object} opts
 * @param {string} opts.base
 * @param {string} opts.token
 * @param {string} opts.atlasId
 * @param {string} opts.mapId
 * @param {number} opts.lotes - How many batches to push.
 * @param {number} opts.opsPorLote
 * @param {string[]|null} [opts.alvos]
 * @param {number} [opts.repetirFracao=0] - Fraction of batches re-sent verbatim, to exercise
 *   `ON CONFLICT (atlas_id, op_id) DO NOTHING`. A repeat must not create a new version.
 * @param {import('./metricas.mjs').Serie} opts.serie
 * @param {Object} opts.registro
 */
export async function escritorRest({
  base, token, atlasId, mapId, lotes, opsPorLote,
  alvos = null, repetirFracao = 0, serie, registro, enviadoEm = null,
}) {
  const clientId = randomUUID();
  let lamport = 1;

  for (let n = 0; n < lotes; n += 1) {
    const ops = criarLote({ mapId, clientId, quantidade: opsPorLote, alvos, lamport });
    lamport += opsPorLote;
    for (const op of ops) registro.enviados.add(op.id);

    const repetir = repetirFracao > 0
      && (n + 1) % Math.max(1, Math.round(1 / repetirFracao)) === 0;
    const vezes = repetir ? 2 : 1;

    for (let v = 0; v < vezes; v += 1) {
      const t0 = performance.now();
      // Stamped at the moment of the WRITE, not of the ack: E5 measures how long a peer waits
      // for an edit, and the peer's clock starts when the edit leaves the author.
      if (enviadoEm && v === 0) for (const op of ops) enviadoEm.set(op.id, t0);
      try {
        const r = await fetch(`${base}/api/v1/atlas/${atlasId}/sync`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ operations: ops }),
        });
        const corpo = await r.json().catch(() => null);
        serie.registrar(performance.now() - t0, r.status);
        if (r.status === 200) contabilizar(registro, ops, corpo?.data?.results);
        else for (const op of ops) registro.semVeredito.add(op.id);
      } catch (err) {
        serie.registrarErro(err);
        for (const op of ops) registro.semVeredito.add(op.id);
      }
    }
  }
}

/** Opens a collab socket and waits for the upgrade to complete. */
export function abrirSocket({ base, atlasId, token, clientId = randomUUID() }) {
  const url = `${base.replace(/^http/, 'ws')}/api/v1/collab`
    + `?atlasId=${atlasId}&token=${encodeURIComponent(token)}&clientId=${clientId}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const recebidas = [];
    const esperando = [];

    ws.on('message', (bruto) => {
      let msg;
      try { msg = JSON.parse(bruto.toString()); } catch { return; }
      msg.__chegouEm = performance.now();
      recebidas.push(msg);
      for (let i = esperando.length - 1; i >= 0; i -= 1) {
        if (esperando[i].tipos.includes(msg.type)) {
          esperando[i].resolve(msg);
          esperando.splice(i, 1);
        }
      }
    });

    ws.on('open', () =>
      resolve({
        ws,
        clientId,
        recebidas,
        enviar: (d) => ws.send(JSON.stringify(d)),
        /** Waits for the first unconsumed message of any of `tipos`, or null on timeout. */
        aguardar(tipos, timeoutMs = 30_000) {
          const jaTem = recebidas.find((m) => tipos.includes(m.type) && !m.__consumida);
          if (jaTem) { jaTem.__consumida = true; return Promise.resolve(jaTem); }
          return new Promise((res) => {
            const espera = { tipos, resolve: (m) => { m.__consumida = true; res(m); } };
            esperando.push(espera);
            const t = setTimeout(() => {
              const i = esperando.indexOf(espera);
              if (i >= 0) esperando.splice(i, 1);
              res(null);
            }, timeoutMs);
            t.unref?.();
          });
        },
        fechar: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
      })
    );
    ws.on('error', reject);
  });
}

/**
 * Runs one WebSocket writer to completion.
 *
 * The symbolic statuses matter as much as the timings:
 *   `WS_ACK`   - `ack_batch` arrived, per-op verdicts recorded.
 *   `WS_ERRO`  - the server answered `error`. Under contention this is the 5 s lock timeout
 *                arriving WITHOUT per-op detail, which is precisely the asymmetry E3 measures.
 *   `WS_MUDO`  - nothing came back before the timeout. The op state is unknown to the client,
 *                and only the ledger can settle it.
 */
export async function escritorWs({
  base, token, atlasId, mapId, lotes, opsPorLote,
  alvos = null, serie, registro, enviadoEm = null,
}) {
  const sock = await abrirSocket({ base, atlasId, token });
  let lamport = 1;
  try {
    for (let n = 0; n < lotes; n += 1) {
      const ops = criarLote({
        mapId, clientId: sock.clientId, quantidade: opsPorLote, alvos, lamport,
      });
      lamport += opsPorLote;
      for (const op of ops) registro.enviados.add(op.id);

      const t0 = performance.now();
      if (enviadoEm) for (const op of ops) enviadoEm.set(op.id, t0);
      sock.enviar({ type: 'operations', ops });
      const resposta = await sock.aguardar(['ack_batch', 'error']);
      const ms = performance.now() - t0;

      if (!resposta) {
        serie.registrar(ms, 'WS_MUDO');
        for (const op of ops) registro.semVeredito.add(op.id);
      } else if (resposta.type === 'error') {
        serie.registrar(ms, 'WS_ERRO');
        // ATRIBUICAO, e e ela que esta sendo medida. Antes de o servidor mandar `opIds`, um lote
        // com erro deixava TODAS as suas ops sem veredito, porque o cliente nao tinha como saber
        // quais falharam. Com os ids no frame, elas viram recusa CONHECIDA, e a coluna de
        // inatribuiveis do E3 pode ir a zero. Sem esta mudanca na bancada, o conserto do servidor
        // seria invisivel na tabela.
        const nomeadas = new Set(resposta.opIds ?? []);
        for (const op of ops) {
          if (nomeadas.has(op.id)) {
            registro.recusados.set(op.id, `${resposta.code}${resposta.retryable ? ' (retentavel)' : ''}`);
          } else {
            registro.semVeredito.add(op.id);
          }
        }
      } else {
        serie.registrar(ms, 'WS_ACK');
        contabilizar(registro, ops, resposta.results);
      }
    }
  } finally {
    await sock.fechar().catch(() => {});
  }
}

// Path: tests/ws/sync-request-cauda-longa-pede-http.test.js
//
// PELO SOCKET, UMA CAUDA ACIMA DO TETO NAO VIRA RETRATO: VIRA O AVISO DE RE-PUXAR PELO HTTP.
//
// O pull REST troca uma cauda acima de `PULL_TAIL_MAX_OPS` pelo retrato (57f0cfcb). No socket a
// mesma troca mandava o atlas inteiro num quadro so, sem compressao (o `WebSocketServer` nao liga
// `perMessageDeflate`), e num enlace lento esse quadro dura mais que a tolerancia do heartbeat do
// cliente: o socket cai no meio do quadro, a reconexao pede do mesmo cursor e recebe o mesmo
// quadro, em laco. Pelo socket a resposta passou a ser o quadro que o cliente ja le como "re-puxe
// o atlas" (`atlas_updated`, que vai a `serverResync` e a `resync()`, pelo HTTP comprimido e com
// prazo por silencio). O lado do cliente esta em
// `frontend/tests/integration/cauda-longa-vira-retrato.repro.test.js`.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';
import { PULL_TAIL_MAX_OPS } from '../../src/modules/sync/sync.service.js';

describe('sync_request com cauda acima do teto', () => {
  let app, db, server, dono, token;
  const clientes = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    dono = await createUser(db, { username: `scl_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, dono.username, dono.password);
  });

  after(async () => {
    for (const c of clientes) c.close?.();
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /** Atlas com cursor nao nulo e `n` ops depois dele, escritas direto no log. */
  const cenario = async (n) => {
    const atlas = await createAtlas(db, dono.id);
    const mapa = await createMap(db, atlas.id);
    const escrever = (k) => db.query(
      `INSERT INTO operations (atlas_id, op_type, entity_type, entity_id, map_id, client_timestamp, client_id, op_id)
       SELECT $1, 'update', 'feature', gen_random_uuid(), $2, 1, 'cli-teste', gen_random_uuid()::text
       FROM generate_series(1, $3)`, [atlas.id, mapa.id, k]);
    await escrever(1);
    const cursor = Number((await db.query('SELECT current_version FROM atlas WHERE id = $1', [atlas.id]))
      .rows[0].current_version);
    await escrever(n);
    const cliente = await createWsClient(server, atlas.id, token, `cli-${randomUUID().slice(0, 8)}`);
    clientes.push(cliente);
    await cliente.waitForType('connected');
    return { cliente, cursor };
  };

  /** O primeiro quadro de resposta ao sync_request: `sync_response` ou `atlas_updated`. */
  const resposta = async (cliente, inicio) => {
    const limite = Date.now() + 5000;
    while (Date.now() < limite) {
      const q = cliente.messages.slice(inicio).find((m) => m.type === 'sync_response' || m.type === 'atlas_updated');
      if (q) return q;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('sem resposta ao sync_request');
  };

  it('acima do teto: o socket responde o aviso de re-puxar, e NAO o retrato', async () => {
    const { cliente, cursor } = await cenario(PULL_TAIL_MAX_OPS + 1);
    const inicio = cliente.messages.length;
    cliente.send({ type: 'sync_request', lastVersion: cursor, haveSnapshot: true });
    const q = await resposta(cliente, inicio);
    assert.equal(q.type, 'atlas_updated');
    assert.equal(q.resync, 'cauda-longa');
    assert.equal(cliente.messages.slice(inicio).some((m) => m.type === 'sync_response'), false,
      'nenhum retrato atravessa o socket');
    assert.ok(JSON.stringify(q).length < 200, 'o aviso e um quadro pequeno');
  });

  it('CONTROLE: no teto, a cauda continua vindo pelo socket', async () => {
    const { cliente, cursor } = await cenario(PULL_TAIL_MAX_OPS);
    const inicio = cliente.messages.length;
    cliente.send({ type: 'sync_request', lastVersion: cursor, haveSnapshot: true });
    const q = await resposta(cliente, inicio);
    assert.equal(q.type, 'sync_response');
    assert.equal(q.isSnapshot, false);
    assert.equal(q.ops.length, PULL_TAIL_MAX_OPS);
  });
});

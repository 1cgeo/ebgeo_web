// Path: tests/ws/collab-max-payload.test.js
// Item 98 — `maxPayload: COLLAB_MAX_PAYLOAD_BYTES` (10 MB) no WebSocketServer.
//
// Fronteira de recurso sem nenhum teste. O comentário L2 registra que o default do
// `ws` (100 MiB) permitia bufferizar EM MEMÓRIA um frame não validado 10× maior que o
// limite HTTP; se o `maxPayload` sumir num refactor, nada acusa — o sintoma só aparece
// como memória em produção. O verde aqui prova que o corte acontece no TRANSPORTE
// (antes do JSON.parse e de qualquer handler) e que o uso legítimo continua passando,
// senão o teste vira um veto a lotes grandes válidos.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const U = () => `payl_${randomUUID().slice(0, 8)}`;

/** Espera o close e devolve o código, ou null se não fechar a tempo. */
function closeCodeOf(client, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    client.ws.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe('limite de frame do WebSocket (maxPayload 10 MB)', () => {
  let app, db, server;
  let owner, ownerToken, atlas, map;
  let peerUser, peerToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    owner = await createUser(db, { username: U() });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    map = await createMap(db, atlas.id);

    peerUser = await createUser(db, { username: U() });
    await createShare(db, atlas.id, peerUser.id, 'write', owner.id);
    peerToken = await loginUser(app, peerUser.username, peerUser.password);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('frame de ~11 MB é cortado no transporte: close 1009, sem frame de erro e sem persistir nada', async () => {
    const vitima = await createWsClient(server, atlas.id, ownerToken);
    await vitima.waitForType('connected');
    const par = await createWsClient(server, atlas.id, peerToken);
    await par.waitForType('connected');
    vitima.clearMessages();

    const { rows: antes } = await db.query(
      'SELECT COUNT(*)::int AS n FROM operations WHERE atlas_id = $1',
      [atlas.id]
    );

    const fechou = closeCodeOf(vitima);
    vitima.ws.send('x'.repeat(11 * 1024 * 1024)); // string única, > maxPayload

    const code = await fechou;
    assert.equal(code, 1009, 'o `ws` fecha com 1009 (message too big)');

    // O corte foi no TRANSPORTE: nenhum handler chegou a responder.
    assert.deepEqual(
      vitima.getMessagesOfType('error'),
      [],
      'nenhum VALIDATION_ERROR/OPERATION_FAILED antes do close'
    );

    const { rows: depois } = await db.query(
      'SELECT COUNT(*)::int AS n FROM operations WHERE atlas_id = $1',
      [atlas.id]
    );
    assert.equal(depois[0].n, antes[0].n, 'nada persistido pelo frame gigante');

    // A morte de um socket por payload não contamina a sala.
    par.send({ type: 'ping' });
    const pong = await par.waitForType('pong');
    assert.equal(pong.type, 'pong');
    assert.equal(par.ws.readyState, 1);

    par.close();
  });

  it('controle positivo: lote válido de ~1 MB é processado e recebe ack_batch', async () => {
    const client = await createWsClient(server, atlas.id, ownerToken);
    await client.waitForType('connected');
    client.clearMessages();

    // ~1 MB de payload legítimo: 8 ops com ~128 KB de propriedades cada.
    const encheu = 'a'.repeat(128 * 1024);
    const ops = Array.from({ length: 8 }, (_, i) => ({
      id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(),
      mapId: map.id,
      data: {
        feature_type: 'point',
        geometry: { coordinates: [-43.2, -22.9] },
        properties: { name: `big${i}`, descricao: encheu },
      },
      timestamp: Date.now(), clientId: 'payl-big',
    }));
    const tamanho = JSON.stringify({ type: 'operations', ops }).length;
    assert.ok(tamanho > 1024 * 1024, `o lote de controle tem de ser grande de verdade (${tamanho} bytes)`);
    assert.ok(tamanho < 10 * 1024 * 1024, 'e ainda assim legítimo, abaixo do teto');

    client.send({ type: 'operations', ops });
    const ack = await client.waitForType('ack_batch', 10000);
    assert.equal(ack.results.length, 8, 'o limite não pode estrangular uso real');
    assert.equal(client.ws.readyState, 1);

    client.close();
  });
});

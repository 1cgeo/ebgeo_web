// Path: tests/ws/collab-heartbeat-authz-wire.test.js
// Item 19 — o FIO entre o sweep de heartbeat, o estado do socket REAL e os handlers.
//
// O que já existia provava as pontas, nunca o fio: collab-reauthz.test.js exerce a
// LÓGICA de `reconcileAuthorization` contra um objeto literal (socket falso), e
// collab-heartbeat-gaps.test.js exerce o reap por `isAlive` sem nenhuma mudança de
// autorização. Se alguém removesse a chamada `reconcileAuthorization(ws)` de dentro
// de `heartbeatSweep`, ou se `attachWebSocket` parasse de agendar o setInterval,
// TODOS os testes atuais seguiriam verdes — a forma (b) da verificação-fantasma
// (conferir o subconjunto e tratá-lo como o conjunto).
//
// Além disso o rebaixamento write→read só vale se o HANDLER passar a recusar: a
// permissão vive no `ws`, então o gate tem de valer SEM reconectar.
//
// Desde 2026-07-25 (item 99) `heartbeatSweep` É assíncrono e AGUARDA as reconciliações
// (pool limitado). Os casos aqui continuam esperando por OBSERVÁVEL (close / frame),
// não por retorno: o observável é o que o par realmente vê, e a espera por ele segue
// correta com ou sem await. Quem prende o await em si é
// tests/ws/collab-authz-reconcile-failure.test.js.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket, heartbeatSweep } from '../../src/modules/collab/collab.gateway.js';

const U = () => `hbw_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera o socket fechar; devolve o código de close observado (ou null). */
function closeCodeOf(client) {
  return new Promise((resolve) => {
    if (client.ws.readyState >= 2) return resolve(client.__closeCode ?? null);
    const timer = setTimeout(() => resolve(null), 2000);
    client.ws.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe('heartbeatSweep → reconcileAuthorization sobre socket REAL', () => {
  let app, db, server, wss;
  let owner, ownerToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    wss = attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    owner = await createUser(db, { username: U() });
    ownerToken = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /** Atlas novo + mapa + um usuário com o share pedido, já logado. */
  async function cenario(permission) {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    const map = await createMap(db, atlas.id);
    const peer = await createUser(db, { username: U() });
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, $3, $4)`,
      [atlas.id, peer.id, permission, owner.id]
    );
    const peerToken = await loginUser(app, peer.username, peer.password);
    return { atlas, map, peer, peerToken };
  }

  it('share revogado: o socket REAL fecha com 4003 e o par recebe user_left', async () => {
    const { atlas, peer, peerToken } = await cenario('write');

    const ownerClient = await createWsClient(server, atlas.id, ownerToken);
    await ownerClient.waitForType('connected');
    const writerClient = await createWsClient(server, atlas.id, peerToken);
    await writerClient.waitForType('connected');
    ownerClient.clearMessages();

    await db.query('DELETE FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2', [atlas.id, peer.id]);

    heartbeatSweep(wss);

    const code = await closeCodeOf(writerClient);
    assert.equal(code, 4003, 'acesso revogado fecha o socket com 4003');

    const left = await ownerClient.waitForType('user_left');
    assert.equal(left.userId, peer.id, 'o par é notificado da saída daquele usuário');

    ownerClient.close();
  });

  it('write→read: o socket PERMANECE aberto e nenhum `connected` é reemitido', async () => {
    const { atlas, peer, peerToken } = await cenario('write');

    const writerClient = await createWsClient(server, atlas.id, peerToken);
    await writerClient.waitForType('connected');
    writerClient.clearMessages();

    await db.query(
      `UPDATE atlas_shares SET permission = 'read' WHERE atlas_id = $1 AND user_id = $2`,
      [atlas.id, peer.id]
    );
    heartbeatSweep(wss);
    await sleep(300);

    assert.equal(writerClient.ws.readyState, 1, 'rebaixar não derruba: só baixa ws.permission');
    assert.equal(
      writerClient.getMessagesOfType('connected').length,
      0,
      'o handshake não é refeito num rebaixamento'
    );
    writerClient.close();
  });

  it('no MESMO socket rebaixado, a op passa a ser recusada com FORBIDDEN e nada persiste', async () => {
    const { atlas, map, peer, peerToken } = await cenario('write');

    const writerClient = await createWsClient(server, atlas.id, peerToken);
    await writerClient.waitForType('connected');

    const mkOp = () => ({
      id: randomUUID(),
      entityType: 'feature',
      operationType: 'create',
      entityId: randomUUID(),
      mapId: map.id,
      data: { feature_type: 'point', geometry: { coordinates: [-43.2, -22.9] }, properties: { name: 'x' } },
      timestamp: Date.now(),
      clientId: 'hbw-writer',
    });

    // CONTROLE NEGATIVO DO GATE: antes do rebaixamento a MESMA op é acked. Sem isto,
    // um FORBIDDEN depois provaria apenas que a op estava malformada.
    const opAntes = mkOp();
    writerClient.send({ type: 'operation', op: opAntes });
    const ack = await writerClient.waitForType('ack');
    assert.equal(ack.opId, opAntes.id);
    assert.equal(ack.result.success, true, 'a op é válida e aplicável enquanto write');

    await db.query(
      `UPDATE atlas_shares SET permission = 'read' WHERE atlas_id = $1 AND user_id = $2`,
      [atlas.id, peer.id]
    );
    heartbeatSweep(wss);
    await sleep(300);

    writerClient.clearMessages();
    const opDepois = mkOp();
    writerClient.send({ type: 'operation', op: opDepois });

    const err = await writerClient.waitForType('error');
    assert.equal(err.code, 'FORBIDDEN', 'a permissão reconciliada tem de valer sem reconectar');

    const { rows: ops } = await db.query('SELECT id FROM operations WHERE op_id = $1', [opDepois.id]);
    assert.equal(ops.length, 0, 'nenhuma linha no log de operações');
    const { rows: feats } = await db.query('SELECT id FROM features WHERE id = $1', [opDepois.entityId]);
    assert.equal(feats.length, 0, 'nenhuma feição criada');

    writerClient.close();
  });

  it('conta desativada com socket ABERTO: close 4003 e o socket sai da lista do servidor', async () => {
    // Reescrito em 2026-07-25 (itens 79 + 100). A guarda de lista não-vazia deste caso
    // era a linha em `active_sessions` antes da desativação; a tabela nunca teve leitor e
    // saiu da baseline em 2026-08-23, então a guarda é a presença do socket em
    // `wss.clients`, que é o registro que de fato existe.
    const { atlas, peer, peerToken } = await cenario('write');
    const clientId = `cid-${randomUUID().slice(0, 8)}`;

    const client = await createWsClient(server, atlas.id, peerToken, clientId);
    await client.waitForType('connected');

    const noServidor = () => [...wss.clients].filter((s) => s.userId === peer.id && s.clientId === clientId);
    assert.equal(noServidor().length, 1, 'o socket existe antes da desativação (guarda de lista não-vazia)');

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [peer.id]);
    heartbeatSweep(wss);

    const code = await closeCodeOf(client);
    assert.equal(code, 4003, 'conta desativada derruba o socket vivo');

    for (let i = 0; i < 50 && noServidor().length > 0; i++) {
      await sleep(20);
    }
    assert.equal(noServidor().length, 0, 'o socket é retirado da lista junto com o fechamento');
  });
});

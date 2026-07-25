// Path: tests/ws/collab-broadcast-stamping.test.js
// Itens 48 e 99 — o CARIMBO da op difundida: `serverVersion` (ordem de chegada no
// servidor, o invariante I3) e `entityId` (identidade única entre os caminhos).
//
// Os dois caminhos de escrita carimbam nos seus próprios arquivos:
//   - HTTP push  → sync.controller.js:19-45 (versionByOp + entityIdByOp)
//   - WS push    → collab.handlers.js (opOut em handleOperation, versionByOp em handleOperations)
//
// O que existia observava esse broadcast e afirmava só `type`/`userId`/`ops.length`
// (collab-broadcasts.test.js:180-214); os `serverVersion` checados em
// collab-advanced/multiuser-session-e2e são os do ACK, nunca os da op difundida.
// Apagar as linhas de carimbo deixava tudo verde: o par ficava sem ordem para
// convergir, e um `setting` chegava com DUAS identidades conforme o caminho
// (broadcast vs pull incremental).
//
// O lote tem ainda um fallback silencioso — `versionByOp.get(op.id) ?? result.serverVersion`.
// Se `r.operationId` mudar de nome no contrato de ack, TODAS as ops do lote passam a
// carregar a mesma versão e o fallback esconde o defeito. O caso de duas ops com
// versões DISTINTAS e crescentes é o que mata esse fallback.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const U = () => `stamp_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('carimbo de serverVersion / entityId na op DIFUNDIDA', () => {
  let app, db, server;
  let owner, ownerToken, peerUser, peerToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    owner = await createUser(db, { username: U() });
    ownerToken = await loginUser(app, owner.username, owner.password);
    peerUser = await createUser(db, { username: U() });
    peerToken = await loginUser(app, peerUser.username, peerUser.password);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /** Atlas novo (isolado, para as versões serem previsíveis) + mapa + peer conectado. */
  async function cenario() {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    const map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, peerUser.id, 'write', owner.id);
    const peer = await createWsClient(server, atlas.id, peerToken);
    await peer.waitForType('connected');
    peer.clearMessages();
    return { atlas, map, peer };
  }

  const featureOp = (mapId, nome = 'p') => ({
    id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(),
    mapId,
    data: { feature_type: 'point', geometry: { coordinates: [-43.2, -22.9] }, properties: { name: nome } },
    timestamp: Date.now(), clientId: 'stamp-client',
  });

  // ── Item 48: HTTP push → broadcast WS ────────────────────────────────────────
  describe('item 48 — POST /sync difunde com carimbo', () => {
    it('1 op: ops[0].serverVersion === results[0].currentVersion do corpo HTTP', async () => {
      const { atlas, map, peer } = await cenario();

      const op = featureOp(map.id);
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ operations: [op] });
      assert.equal(res.status, 200);

      const msg = await peer.waitForType('operations');
      assert.equal(msg.ops.length, 1);
      const esperado = Number(res.body.data.results[0].currentVersion);
      assert.ok(Number.isInteger(esperado) && esperado > 0, 'o corpo HTTP traz a versão');
      assert.equal(
        msg.ops[0].serverVersion,
        esperado,
        'a op difundida tem de carregar a MESMA ordem de chegada que o ack HTTP'
      );

      peer.close();
    });

    it('lote de 3: os serverVersion difundidos são distintos e crescentes na ordem do array', async () => {
      const { atlas, map, peer } = await cenario();

      const ops = [featureOp(map.id, 'a'), featureOp(map.id, 'b'), featureOp(map.id, 'c')];
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ operations: ops });
      assert.equal(res.status, 200);

      const msg = await peer.waitForType('operations');
      assert.equal(msg.ops.length, 3);

      const versoes = msg.ops.map((o) => o.serverVersion);
      assert.equal(versoes.length, 3);
      assert.equal(new Set(versoes).size, 3, 'três versões DISTINTAS (mata o fallback de versão única)');
      for (let i = 1; i < versoes.length; i++) {
        assert.ok(versoes[i] > versoes[i - 1], `versão crescente entre ${i - 1} e ${i}: ${versoes}`);
      }
      // E cada uma casa com o seu ack por operationId.
      const porOp = new Map(res.body.data.results.map((r) => [r.operationId, r.currentVersion]));
      for (const o of msg.ops) {
        assert.equal(o.serverVersion, porOp.get(o.id), `op ${o.id} carimbada com o ack dela`);
      }

      peer.close();
    });

    it("op de atlas (entityId 'atlas'): o broadcast carrega o UUID e concorda com o pull incremental", async () => {
      const { atlas, peer } = await cenario();

      // Uma op prévia para que o pull incremental tenha um cursor > 0 e não vire snapshot.
      const antes = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ operations: [featureOp((await db.query('SELECT id FROM maps WHERE atlas_id = $1', [atlas.id])).rows[0].id)] });
      assert.equal(antes.status, 200);
      const cursor = Number(antes.body.data.results[0].currentVersion);
      peer.clearMessages();

      const settingOp = {
        id: randomUUID(), entityType: 'setting', operationType: 'update', entityId: 'atlas',
        mapId: null, changes: { terrainExaggeration: 2.5 },
        timestamp: Date.now(), clientId: 'stamp-client',
      };
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ operations: [settingOp] });
      assert.equal(res.status, 200);

      const msg = await peer.waitForType('operations');
      assert.equal(msg.ops.length, 1);
      assert.equal(
        msg.ops[0].entityId,
        atlas.id,
        "o broadcast carrega o UUID do atlas, nunca a sentinela 'atlas'"
      );

      // As DUAS rotas têm de concordar sobre a identidade da mesma operação.
      const pull = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${cursor}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assert.equal(pull.status, 200);
      assert.equal(pull.body.data.isSnapshot, false, 'este pull é incremental, não snapshot');

      // KNOWN GAP (medido aqui, 2026-07-25): o pull incremental identifica a operação
      // pelo PK da linha em `operations` (`toFrontendOperation` devolve `id: op.id`),
      // enquanto o broadcast ecoa o `op.id` DO CLIENTE. A mesma operação chega com dois
      // `id` diferentes conforme o caminho — a assimetria que o fix L3 já eliminou para
      // `entityId` e que segue de pé para `id`. Por isso o casamento abaixo é por
      // entidade, não por id. Se alguém unificar os dois, esta asserção QUEBRA e a
      // decisão volta à mesa (que é o ponto).
      const doPull = pull.body.data.operations.find(
        (o) => o.entityType === 'setting' && o.operationType === 'update'
      );
      assert.ok(doPull, 'a op de setting aparece no pull incremental');
      assert.notEqual(doPull.id, settingOp.id, 'KNOWN GAP: o `id` do pull NÃO é o op.id do cliente');
      assert.equal(doPull.entityId, msg.ops[0].entityId, 'broadcast e pull têm o MESMO entityId');
      assert.equal(doPull.entityId, atlas.id);

      peer.close();
    });

    it('reenvio idempotente difunde a versão ORIGINAL, não a corrente do atlas', async () => {
      const { atlas, map, peer } = await cenario();

      const op = featureOp(map.id);
      const primeiro = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ operations: [op] });
      assert.equal(primeiro.status, 200);
      const versaoOriginal = Number(primeiro.body.data.results[0].currentVersion);
      await peer.waitForType('operations');

      // Avança o atlas com outra op, para que "corrente" e "original" divirjam.
      peer.clearMessages();
      const meio = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ operations: [featureOp(map.id, 'meio')] });
      assert.equal(meio.status, 200);
      const versaoCorrente = Number(meio.body.data.serverVersion);
      assert.ok(versaoCorrente > versaoOriginal, 'o atlas avançou (guarda do próprio caso)');
      await peer.waitForType('operations'); // drena o broadcast do 'meio' antes de limpar

      peer.clearMessages();
      const reenvio = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ operations: [op] }); // MESMO op.id
      assert.equal(reenvio.status, 200);
      assert.equal(reenvio.body.data.results[0].idempotent, true);

      const msg = await peer.waitForType('operations');
      assert.equal(
        msg.ops[0].serverVersion,
        versaoOriginal,
        'a op reenviada carrega a ordem de chegada GRAVADA, não a versão corrente'
      );

      peer.close();
    });
  });

  // ── Item 99: WS push → broadcast WS ──────────────────────────────────────────
  describe('item 99 — WS `operation`/`operations` difunde com carimbo', () => {
    it('op única: op.serverVersion do par === ack.result.currentVersion do remetente', async () => {
      const { atlas, map, peer } = await cenario();
      const autor = await createWsClient(server, atlas.id, ownerToken);
      await autor.waitForType('connected');
      peer.clearMessages();

      const op = featureOp(map.id);
      autor.send({ type: 'operation', op });
      const ack = await autor.waitForType('ack');

      const msg = await peer.waitForType('operation');
      assert.ok(
        Number.isInteger(msg.op.serverVersion) && msg.op.serverVersion > 0,
        `serverVersion tem de ser um número > 0, veio ${JSON.stringify(msg.op.serverVersion)}`
      );
      assert.equal(msg.op.serverVersion, ack.result.currentVersion);

      autor.close();
      peer.close();
    });

    it('lote de 2: versões DISTINTAS e crescentes, casadas com ack_batch por operationId', async () => {
      const { atlas, map, peer } = await cenario();
      const autor = await createWsClient(server, atlas.id, ownerToken);
      await autor.waitForType('connected');
      peer.clearMessages();

      const ops = [featureOp(map.id, 'x'), featureOp(map.id, 'y')];
      autor.send({ type: 'operations', ops });
      const ack = await autor.waitForType('ack_batch');

      const msg = await peer.waitForType('operations');
      assert.equal(msg.ops.length, 2);
      const [v0, v1] = msg.ops.map((o) => o.serverVersion);
      assert.ok(Number.isInteger(v0) && Number.isInteger(v1), 'ambas numéricas');
      assert.notEqual(v0, v1, 'duas ops do MESMO lote não podem compartilhar a versão (fallback de lote)');
      assert.ok(v1 > v0, 'crescentes na ordem do array');

      const porOp = new Map(ack.results.map((r) => [r.operationId, r.currentVersion]));
      for (const o of msg.ops) {
        assert.equal(o.serverVersion, porOp.get(o.id), `op ${o.id}: broadcast e ack concordam`);
      }

      autor.close();
      peer.close();
    });

    it('reenvio idempotente por WS: ack idempotent e a op difundida traz a versão original', async () => {
      const { atlas, map, peer } = await cenario();
      const autor = await createWsClient(server, atlas.id, ownerToken);
      await autor.waitForType('connected');

      const op = featureOp(map.id);
      autor.send({ type: 'operation', op });
      const ack1 = await autor.waitForType('ack');
      const versaoOriginal = ack1.result.currentVersion;
      await peer.waitForType('operation');

      // Avança o atlas. O ack chega ao autor ANTES do broadcast sair para o par, então
      // esperar só o ack e limpar o par abriria uma corrida: o frame do 'meio' cairia
      // depois do clearMessages e seria lido como se fosse o do reenvio.
      autor.clearMessages();
      peer.clearMessages();
      autor.send({ type: 'operation', op: featureOp(map.id, 'meio') });
      const ack2 = await autor.waitForType('ack');
      assert.ok(ack2.result.currentVersion > versaoOriginal, 'o atlas avançou');
      await peer.waitForType('operation'); // drena o broadcast do 'meio'

      autor.clearMessages();
      peer.clearMessages();
      autor.send({ type: 'operation', op }); // MESMO op.id
      const ack3 = await autor.waitForType('ack');
      assert.equal(ack3.result.idempotent, true);

      const msg = await peer.waitForType('operation');
      assert.equal(msg.op.serverVersion, versaoOriginal, 'versão ORIGINAL, não uma nova');

      autor.close();
      peer.close();
    });

    it('op de atlas difundida por WS carrega serverVersion numérico', async () => {
      const { atlas, peer } = await cenario();
      const autor = await createWsClient(server, atlas.id, ownerToken);
      await autor.waitForType('connected');
      peer.clearMessages();

      autor.send({
        type: 'operation',
        op: {
          id: randomUUID(), entityType: 'setting', operationType: 'update', entityId: 'atlas',
          mapId: null, changes: { terrainExaggeration: 1.5 },
          timestamp: Date.now(), clientId: 'stamp-client',
        },
      });
      await autor.waitForType('ack');

      const msg = await peer.waitForType('operation');
      assert.equal(typeof msg.op.serverVersion, 'number');
      assert.ok(msg.op.serverVersion > 0);

      autor.close();
      peer.close();
    });

    it('op RECUSADA não é difundida (o par não aplica o que o servidor não gravou)', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
      const map = await createMap(db, atlas.id);
      await createShare(db, atlas.id, peerUser.id, 'write', owner.id);
      const escritor = await createWsClient(server, atlas.id, peerToken);
      await escritor.waitForType('connected');
      const observador = await createWsClient(server, atlas.id, ownerToken);
      await observador.waitForType('connected');
      observador.clearMessages();

      // Lock/unlock é owner-only: um 'write' é recusado por política (rejected).
      const op = {
        id: randomUUID(), entityType: 'map', operationType: 'update', entityId: map.id,
        mapId: map.id, changes: { locked: true },
        timestamp: Date.now(), clientId: 'stamp-writer',
      };
      escritor.send({ type: 'operation', op });
      const ack = await escritor.waitForType('ack');
      assert.equal(ack.result.success, false, 'recusa de política vem como rejected, sem envenenar o lote');

      await sleep(400);
      assert.deepEqual(
        observador.getMessagesOfType('operation'),
        [],
        'op recusada não chega ao par'
      );

      escritor.close();
      observador.close();
    });
  });
});

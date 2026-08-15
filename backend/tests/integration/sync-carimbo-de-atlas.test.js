// Path: tests/integration/sync-carimbo-de-atlas.test.js
//
// E2B — a operação passa a declarar o atlas em que NASCEU (`atlasId`) e o endereço do
// banco local que a produziu (`scopeSuffix`). O cliente carimba os dois na fábrica
// (frontend `operation-factory.js`) porque cada atlas tem seus próprios bancos de
// IndexedDB e a fila é global: sem o carimbo, o flush de uma aba empurrava para o
// servidor operação nascida no atlas da outra.
//
// Este arquivo é a metade de SERVIDOR da mudança, e mede três coisas distintas:
//
//   1. os dois campos atravessam a validação (declarados explicitamente, como o
//      `traceId`, e não por confiança no `.unknown(true)`);
//   2. eles NÃO são persistidos — o INSERT usa o atlas da ROTA e uma lista fixa de
//      colunas —, então não voltam no pull incremental. É por isso que nenhuma guarda de
//      cliente pode ser construída sobre a presença deles numa op RECEBIDA, e a medição
//      fica aqui em vez de virar prosa em algum comentário;
//   3. uma op que declara pertencer a OUTRO atlas é recusada POR OPERAÇÃO (200 +
//      `rejected`), nunca com 400 de lote: um 400 volta idêntico para a fila do cliente e
//      é reenviado a cada 1,5 s para sempre.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Carimbo de atlas de origem na operação (E2B)', () => {
  let app, db, user, token, atlas, map, outroAtlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: `carimbo_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
    outroAtlas = await createAtlas(db, user.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });

  const featureOp = (overrides = {}) => ({
    id: randomUUID(),
    entityType: 'feature',
    operationType: 'create',
    entityId: randomUUID(),
    mapId: map.id,
    data: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
      properties: { source: 'point', nome: 'Ponto' },
    },
    timestamp: Date.now(),
    lamportTimestamp: 1,
    clientId: 'carimbo-client',
    ...overrides,
  });

  it('op carimbada com o PRÓPRIO atlas é aplicada normalmente', async () => {
    const op = featureOp({ atlasId: atlas.id, scopeSuffix: `remote-${atlas.id}` });

    const res = await push([op]).expect(200);

    const ack = res.body.data.results.find((r) => r.operationId === op.id);
    assert.equal(ack.success, true, 'a op do próprio atlas não pode ser recusada');
    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [op.entityId]);
    assert.equal(rows.length, 1, 'a feição tem que existir');
  });

  it('op SEM carimbo continua sendo aplicada (cliente antigo não é punido)', async () => {
    const op = featureOp();

    const res = await push([op]).expect(200);

    const ack = res.body.data.results.find((r) => r.operationId === op.id);
    assert.equal(ack.success, true);
    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [op.entityId]);
    assert.equal(rows.length, 1);
  });

  it('op que declara OUTRO atlas é recusada por operação, e o lote sobrevive', async () => {
    const forasteira = featureOp({
      atlasId: outroAtlas.id,
      scopeSuffix: `remote-${outroAtlas.id}`,
    });
    const irma = featureOp({ atlasId: atlas.id });

    const res = await push([forasteira, irma]).expect(200);

    const ackForasteira = res.body.data.results.find((r) => r.operationId === forasteira.id);
    const ackIrma = res.body.data.results.find((r) => r.operationId === irma.id);

    assert.equal(ackForasteira.success, false, 'a op de outro atlas tem que ser recusada');
    assert.match(ackForasteira.reason, /outro projeto/i);
    assert.equal(ackIrma.success, true, 'a irmã do mesmo lote tem que passar');

    // A recusa é ANTES do log: a op não pode consumir uma versão de servidor nem escrever
    // dado nenhum neste atlas.
    const feicoes = await db.query('SELECT id FROM features WHERE id = $1', [forasteira.entityId]);
    assert.equal(feicoes.rows.length, 0, 'nada da op forasteira pode ter sido escrito');
    const log = await db.query('SELECT op_id FROM operations WHERE op_id = $1', [forasteira.id]);
    assert.equal(log.rows.length, 0, 'a op recusada não entra no log');

    // E a irmã foi mesmo escrita: sem esta metade, "o lote sobreviveu" seria
    // indistinguível de um lote inteiro descartado em silêncio.
    const irmaEscrita = await db.query('SELECT id FROM features WHERE id = $1', [irma.entityId]);
    assert.equal(irmaEscrita.rows.length, 1);
  });

  // O QUE A DECLARAÇÃO EXPLÍCITA COMPRA, já que o `.unknown(true)` sozinho deixaria o campo
  // passar de qualquer jeito: TIPO. Sem ela, um `atlasId` numérico atravessa, o
  // `foreignAtlasDenialReason` vê um não-string e devolve null, e a guarda inteira fica
  // muda para um cliente com bug. Este caso é o controle negativo da linha do schema.
  it('recusa o lote quando o carimbo chega com o TIPO errado', async () => {
    const res = await push([featureOp({ atlasId: 12345 })]);

    assert.equal(res.status, 422, 'carimbo de tipo errado é envelope inválido, não op má');
  });

  // MEDIÇÃO, não afirmação: os campos sobrevivem à validação (senão a recusa acima seria
  // impossível) e NÃO voltam no pull incremental. As duas metades juntas são o que proíbe
  // uma guarda de cliente baseada neles.
  it('os campos atravessam a validação mas NÃO são persistidos (não voltam no pull)', async () => {
    const antes = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const versaoBase = antes.body.data.currentVersion;

    const op = featureOp({ atlasId: atlas.id, scopeSuffix: `remote-${atlas.id}` });
    await push([op]).expect(200);

    const depois = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/${versaoBase}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(depois.body.data.isSnapshot, false, 'o pull tem que ser incremental aqui');
    const devolvida = depois.body.data.operations.find((o) => o.id === op.id);
    assert.ok(devolvida, 'a op tem que voltar no pull incremental');
    assert.equal(devolvida.atlasId, undefined, 'o atlasId NÃO é persistido');
    assert.equal(devolvida.scopeSuffix, undefined, 'o scopeSuffix NÃO é persistido');
  });
});

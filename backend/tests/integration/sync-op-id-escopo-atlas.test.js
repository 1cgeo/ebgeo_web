// Path: tests/integration/sync-op-id-escopo-atlas.test.js
// Item 105 — o escopo da unicidade de op_id é (atlas_id, op_id), não op_id.
//
// O índice é `CREATE UNIQUE INDEX operations_atlas_op_id_uniq ON operations
// (atlas_id, op_id)` (003_sync.sql:52) e o INSERT usa ON CONFLICT DO NOTHING.
// Todos os testes de idempotência empurram para UM único atlas
// (sync-validation.test.js:109, sync-service-coverage.test.js:71), então
// continuariam VERDES se alguém estreitasse o índice para UNIQUE(op_id) — e a
// consequência seria perda de dado SILENCIOSA: a op do usuário B, colidindo com um
// op_id já usado no atlas A, seria descartada pelo DO NOTHING e ainda receberia ack
// `idempotent: true`. Nenhum assert existente toca a dimensão atlas_id.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Unicidade de op_id é POR ATLAS (item 105)', () => {
  let app, db, user, token, atlasA, mapA, atlasB, mapB;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: `opid_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, user.username, user.password);
    atlasA = await createAtlas(db, user.id);
    mapA = await createMap(db, atlasA.id);
    atlasB = await createAtlas(db, user.id);
    mapB = await createMap(db, atlasB.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (atlasId, operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });

  const opCom = (opId, mapId, featureId) => ({
    id: opId,
    type: 'create',
    target: 'feature',
    targetId: featureId,
    mapId,
    data: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
      properties: { id: featureId, source: 'point' },
    },
    timestamp: Date.now(),
    clientId: 'opid-client',
  });

  it('a MESMA op.id em dois atlas cria duas linhas e duas feições', async () => {
    const opId = randomUUID();
    const featA = randomUUID();
    const featB = randomUUID();

    const resA = await push(atlasA.id, [opCom(opId, mapA.id, featA)]).expect(200);
    assert.equal(resA.body.data.acks.length, 1);
    assert.equal(resA.body.data.acks[0].idempotent, false);

    const resB = await push(atlasB.id, [opCom(opId, mapB.id, featB)]).expect(200);
    assert.equal(resB.body.data.acks.length, 1);
    assert.equal(
      resB.body.data.acks[0].idempotent,
      false,
      'a op de outro atlas NÃO pode ser tratada como reenvio'
    );

    const { rows } = await db.query(
      'SELECT atlas_id, op_id FROM operations WHERE op_id = $1 ORDER BY server_version',
      [opId]
    );
    assert.equal(rows.length, 2, 'uma linha por atlas para o mesmo op_id');

    // Controle do ESCOPO: mesmo op_id, atlas_id diferentes.
    assert.equal(rows[0].op_id, rows[1].op_id);
    assert.notEqual(rows[0].atlas_id, rows[1].atlas_id);
    assert.deepEqual(
      [rows[0].atlas_id, rows[1].atlas_id].sort(),
      [atlasA.id, atlasB.id].sort()
    );

    // E as duas feições existem, cada uma no seu mapa.
    const feicoes = await db.query(
      'SELECT id, map_id FROM features WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[featA, featB].sort()]
    );
    assert.equal(feicoes.rows.length, 2, 'nenhuma das duas foi engolida pelo ON CONFLICT');
    const porId = new Map(feicoes.rows.map((r) => [r.id, r.map_id]));
    assert.equal(porId.get(featA), mapA.id);
    assert.equal(porId.get(featB), mapB.id);
  });

  it('a idempotência continua valendo DENTRO do atlas', async () => {
    const opId = randomUUID();
    const featA = randomUUID();
    const featB = randomUUID();

    await push(atlasA.id, [opCom(opId, mapA.id, featA)]).expect(200);
    await push(atlasB.id, [opCom(opId, mapB.id, featB)]).expect(200);

    // Reenvio em A: nada muda em A nem em B.
    const reenvio = await push(atlasA.id, [opCom(opId, mapA.id, featA)]).expect(200);
    assert.equal(reenvio.body.data.acks.length, 1);
    assert.equal(reenvio.body.data.acks[0].idempotent, true);

    const porAtlas = async (atlasId) => {
      const { rows } = await db.query(
        'SELECT COUNT(*)::int AS n FROM operations WHERE op_id = $1 AND atlas_id = $2',
        [opId, atlasId]
      );
      assert.equal(rows.length, 1);
      return rows[0].n;
    };
    assert.equal(await porAtlas(atlasA.id), 1, 'continua 1 linha em A');
    assert.equal(await porAtlas(atlasB.id), 1, 'continua 1 linha em B');
  });

  it('o índice declarado no schema é (atlas_id, op_id) — não apenas (op_id)', async () => {
    // Introspecção: o comportamento acima é consequência DESTE índice. Se alguém o
    // estreitar numa migração futura, este assert nomeia a causa direto.
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'operations'
          AND indexname = 'operations_atlas_op_id_uniq'`
    );
    assert.equal(rows.length, 1, 'o índice operations_atlas_op_id_uniq precisa existir');
    assert.match(rows[0].indexdef, /UNIQUE/i);
    assert.match(rows[0].indexdef, /\(atlas_id,\s*op_id\)/i);
  });
});

// Path: tests/integration/sync-validation.test.js
// Tests for the Fase 0 sync hardening: Joi validation of the push body
// (both vocabularies, size bounds) and idempotency by client op_id.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { MAX_OPS_PER_PUSH } from '../../src/modules/sync/sync.schemas.js';

describe('Sync — push validation & idempotency', () => {
  let app, db, owner, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'sync_val_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Sync Validation Atlas' });
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });

  it('rejects a body without operations (422)', async () => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects an empty operations array (422)', async () => {
    await push([]).expect(422);
  });

  it(`rejects more than ${MAX_OPS_PER_PUSH} operations (422)`, async () => {
    const tooMany = Array.from({ length: MAX_OPS_PER_PUSH + 1 }, () => ({
      id: randomUUID(),
      type: 'create',
      target: 'feature',
      targetId: randomUUID(),
      mapId: map.id,
      data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: {} },
      timestamp: Date.now(),
      clientId: 'c1',
    }));
    await push(tooMany).expect(422);
  });

  it('rejects an operation missing its id (422)', async () => {
    await push([
      { type: 'create', target: 'feature', targetId: randomUUID(), mapId: map.id, data: {}, clientId: 'c1', timestamp: Date.now() },
    ]).expect(422);
  });

  it('accepts the legacy vocabulary (target/type/targetId) and preserves the payload', async () => {
    const featureId = randomUUID();
    await push([
      {
        id: randomUUID(),
        type: 'create',
        target: 'feature',
        targetId: featureId,
        mapId: map.id,
        data: { feature_type: 'point', geometry: { coordinates: [-43.1, -22.8] }, properties: { name: 'Legacy' } },
        timestamp: Date.now(),
        clientId: 'c1',
      },
    ]).expect(200);

    const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [featureId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].properties.name, 'Legacy'); // payload not stripped by validation
  });

  it('accepts the frontend vocabulary (entityType/operationType/entityId)', async () => {
    const featureId = randomUUID();
    await push([
      {
        id: randomUUID(),
        operationType: 'create',
        entityType: 'feature',
        entityId: featureId,
        mapId: map.id,
        data: { feature_type: 'point', geometry: { coordinates: [-43.2, -22.9] }, properties: { name: 'Frontend' } },
        timestamp: Date.now(),
        clientId: 'c2',
      },
    ]).expect(200);

    const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [featureId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].properties.name, 'Frontend');
  });

  it('is idempotent: resending the same op_id does not duplicate or re-apply', async () => {
    const opId = randomUUID();
    const featureId = randomUUID();
    const op = {
      id: opId,
      type: 'create',
      target: 'feature',
      targetId: featureId,
      mapId: map.id,
      data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: { name: 'Once' } },
      timestamp: Date.now(),
      clientId: 'c3',
    };

    const first = await push([op]).expect(200);
    assert.ok(!first.body.data.acks[0].idempotent);
    assert.equal(first.body.data.results[0].idempotent, false);

    const countAfterFirst = await db.query(
      'SELECT COUNT(*)::int AS n FROM operations WHERE atlas_id = $1 AND op_id = $2',
      [atlas.id, opId]
    );
    assert.equal(countAfterFirst.rows[0].n, 1);

    // Mutate the feature directly, then resend the SAME create op — idempotency
    // must NOT re-create/overwrite it.
    await db.query(`UPDATE features SET properties = '{"name":"Changed"}'::jsonb WHERE id = $1`, [featureId]);

    const second = await push([op]).expect(200);
    assert.equal(second.body.data.acks[0].idempotent, true);
    assert.equal(second.body.data.results[0].idempotent, true);

    const countAfterSecond = await db.query(
      'SELECT COUNT(*)::int AS n FROM operations WHERE atlas_id = $1 AND op_id = $2',
      [atlas.id, opId]
    );
    assert.equal(countAfterSecond.rows[0].n, 1); // no duplicate log row

    const feat = await db.query('SELECT properties FROM features WHERE id = $1', [featureId]);
    assert.equal(feat.rows[0].properties.name, 'Changed'); // not re-applied (would have reset to "Once")
  });

  // ── Item 136 — `timestamp` e `clientId` OBRIGATÓRIOS no envelope (fix L1) ────
  //
  // O comentário do schema registra o motivo do aperto: sem `.required()` a op ia até
  // o INSERT e a coluna NOT NULL derrubava o push como 500 (erro do SERVIDOR) em vez
  // de um 422 limpo, num payload que é culpa do cliente. Os casos acima cobrem corpo
  // sem `operations`, array vazio, MAX+1 e op sem `id`; nenhum cobria timestamp ou
  // clientId, então afrouxar qualquer um dos dois de volta para opcional não quebrava
  // nada e o sintoma voltava a ser 500.
  describe('envelope de operação: campos obrigatórios e o que segue opcional', () => {
    const opBase = () => ({
      id: randomUUID(),
      entityType: 'feature',
      operationType: 'create',
      entityId: randomUUID(),
      mapId: map.id,
      data: { feature_type: 'point', geometry: { coordinates: [-43.1, -22.8] }, properties: { name: 'L1' } },
      timestamp: Date.now(),
      clientId: 'l1-client',
    });

    it('op sem `timestamp` → 422 VALIDATION_ERROR (não 500)', async () => {
      const op = opBase();
      delete op.timestamp;
      const res = await push([op]).expect(422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('op sem `clientId` → 422 VALIDATION_ERROR (não 500)', async () => {
      const op = opBase();
      delete op.clientId;
      const res = await push([op]).expect(422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('lote [op válida, op sem clientId] → 422 e ZERO linhas para a op VÁLIDA', async () => {
      const valida = opBase();
      const invalida = opBase();
      delete invalida.clientId;

      await push([valida, invalida]).expect(422);

      // A validação é de BORDA: roda antes da transação, então nem a op boa entra.
      const { rows } = await db.query(
        'SELECT COUNT(*)::int AS n FROM operations WHERE atlas_id = $1 AND op_id = $2',
        [atlas.id, valida.id]
      );
      assert.equal(rows[0].n, 0);
      const { rows: feats } = await db.query('SELECT id FROM features WHERE id = $1', [valida.entityId]);
      assert.equal(feats.length, 0);
    });

    it('`lamportTimestamp` ausente segue OK: 200 e a coluna fica NULL (delimita o aperto)', async () => {
      const op = opBase();
      assert.equal(op.lamportTimestamp, undefined, 'o caso é justamente a ausência');
      await push([op]).expect(200);

      const { rows } = await db.query(
        'SELECT lamport_timestamp FROM operations WHERE atlas_id = $1 AND op_id = $2',
        [atlas.id, op.id]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].lamport_timestamp, null, 'ESTE campo continua opcional (ops legadas)');
    });

    it('`traceId` presente sobrevive à validação (stripUnknown não o remove)', async () => {
      const op = { ...opBase(), traceId: `trace-${randomUUID()}` };
      const res = await push([op]).expect(200);
      assert.equal(res.body.data.results[0].success, true);

      const { rows } = await db.query(
        'SELECT COUNT(*)::int AS n FROM operations WHERE atlas_id = $1 AND op_id = $2',
        [atlas.id, op.id]
      );
      assert.equal(rows[0].n, 1, 'a op atravessou a borda inteira com o traceId a bordo');
    });
  });
});

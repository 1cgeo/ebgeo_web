// Path: tests/integration/sync-batch-atomicity.test.js
// One push = one transaction. The frontend sends destructive BATCH operations as a
// single operations[] push: mass reschedule (§29.12), delete-all-features-of-a-
// tileset/photo (§2.19/§2.23) and delete-attribute-column (§18.6) are thus atomic —
// if an op in the batch FAILS, the ENTIRE batch rolls back (all-or-nothing).
//
// UM RECORTE, desde 2026-07-25: cada op corre num SAVEPOINT próprio, e uma violação de
// DADO (SQLSTATE classe 22/23 — CHECK, FK, 22P02) reverte só a op ofensora, que volta
// recusada por operação (`rejected` + `reason`, 200 no lote). O motivo é vivacidade: o
// mesmo payload falha para sempre, o cliente não faz dequeue de não-2xx, e o lote
// inteiro voltava a cada 1,5 s — sync parado em silêncio (sync-check-constraint-poison).
// Tudo o mais — o 403 de política deste arquivo, 40001, 55P03, queda de conexão, bug de
// JS — continua abortando o push inteiro, porque pode dar certo na retentativa e
// descartar op boa é perda de dado irreversível.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Sync push batch atomicity (one push = one transaction)', () => {
  let app, db, user, token, atlasA, mapA, atlasB, mapB;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'atomic_user' });
    token = await loginUser(app, user.username, user.password);
    atlasA = await createAtlas(db, user.id);
    mapA = await createMap(db, atlasA.id);
    atlasB = await createAtlas(db, user.id);
    mapB = await createMap(db, atlasB.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('a failing op mid-batch rolls back the whole push (nothing persists)', async () => {
    const goodId = randomUUID();
    const goodCreate = {
      id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: goodId, mapId: mapA.id,
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: goodId, source: 'point' } },
      timestamp: Date.now(), clientId: 'atomic-c',
    };
    // This op throws (cross-atlas map_id reference) AFTER the good op already applied
    // within the same transaction → the transaction must roll the good op back too.
    const crossAtlas = {
      id: randomUUID(), entityType: 'feature', operationType: 'update', entityId: randomUUID(), mapId: mapA.id,
      changes: { map_id: mapB.id }, timestamp: Date.now() + 1, clientId: 'atomic-c',
    };

    await supertest(app)
      .post(`/api/v1/atlas/${atlasA.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [goodCreate, crossAtlas] })
      .expect(403);

    // The good create must NOT have persisted (rolled back with the failed batch).
    const feat = await db.query('SELECT * FROM features WHERE id = $1', [goodId]);
    assert.equal(feat.rows.length, 0, 'the good op is rolled back when a later op in the batch fails');

    // And neither op landed in the operations log.
    const ops = await db.query(
      'SELECT COUNT(*)::int AS n FROM operations WHERE op_id = ANY($1::text[])',
      [[goodCreate.id, crossAtlas.id]]
    );
    assert.equal(ops.rows[0].n, 0, 'no operation from the failed batch is logged');
  });

  it('a fully-valid batch persists every op (atomic success)', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const ops = ids.map((id) => ({
      id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: id, mapId: mapA.id,
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id, source: 'point' } },
      timestamp: Date.now(), clientId: 'atomic-c',
    }));

    await supertest(app)
      .post(`/api/v1/atlas/${atlasA.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: ops })
      .expect(200);

    const { rows } = await db.query('SELECT id FROM features WHERE id = ANY($1::uuid[])', [ids]);
    assert.equal(rows.length, 3, 'all ops in a valid batch persist');
  });
});

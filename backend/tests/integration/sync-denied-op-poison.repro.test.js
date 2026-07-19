// Path: tests/integration/sync-denied-op-poison.repro.test.js
// Regression: a policy-denied operation used to poison the entire push batch.
//
// assertOperationAllowed threw a ForbiddenError for an op the principal may not
// perform (map delete / map lock by a non-owner). The throw happened INSIDE the
// tx() that wraps the whole batch, so every sibling operation rolled back and the
// route answered 403. The client only re-queues on a non-2xx response
// (sync-engine.js flush: "A rejected batch is NOT dequeued"), so it replayed the
// same batch forever: one refused map delete froze that user's sync permanently,
// for every map, with nothing shown in the UI.
//
// Now the denial is per-operation: the op is acked with success:false and skipped,
// the rest of the batch applies, and the client dequeues it (retrying a policy
// denial can never succeed). A TIER violation (read/comment principal) still 403s
// the whole batch, since that means the caller itself is untrustworthy.
//
// Negative control: make operationDenialReason throw again and the sibling-feature
// assertion below fails.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

describe('a policy-denied op does not poison the batch (repro)', () => {
  let app, db, owner, writer, writerToken, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `poison_own_${randomUUID().slice(0, 8)}` });
    writer = await createUser(db, { username: `poison_wr_${randomUUID().slice(0, 8)}` });
    writerToken = await loginUser(app, writer.username, writer.password);
    atlas = await createAtlas(db, owner.id, { name: 'Poison Batch Atlas' });
    await createShare(db, atlas.id, writer.id, 'write', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${writerToken}`)
      .send({ operations });

  it('refuses the map delete, applies the sibling feature, and reports it per-op', async () => {
    const map = await createMap(db, atlas.id, { name: 'Target Map' });
    const other = await createMap(db, atlas.id, { name: 'Other Map' });
    const featureId = randomUUID();

    const res = await push([
      {
        id: randomUUID(), entityType: 'map', operationType: 'delete',
        entityId: map.id, mapId: map.id, timestamp: Date.now(), clientId: 'c-poison',
      },
      {
        id: randomUUID(), entityType: 'feature', operationType: 'create',
        entityId: featureId, mapId: other.id,
        data: {
          feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
          properties: { id: featureId, nome: 'sobrevivente do lote' },
        },
        timestamp: Date.now(), clientId: 'c-poison',
      },
    ]).expect(200);

    // The denied op is refused, and says so.
    const { rows: mapRows } = await db.query('SELECT deleted_at FROM maps WHERE id = $1', [map.id]);
    assert.equal(mapRows[0].deleted_at, null, 'a write-tier user still cannot delete the map');

    const results = res.body.data.results;
    assert.equal(results.length, 2, 'one ack per operation');
    const denied = results.find((r) => r.success === false);
    assert.ok(denied, 'the denied op is acked with success:false rather than silently succeeding');
    assert.match(denied.reason, /co-Gestor/i, 'the ack carries the reason so the client can surface it');

    // The point of the regression: the sibling survived.
    const { rows: f } = await db.query('SELECT id FROM features WHERE id = $1', [featureId]);
    assert.equal(f.length, 1, 'the sibling operation in the same batch was applied, not rolled back');
    assert.ok(
      results.some((r) => r.success === true),
      'the sibling is acked as success'
    );
  });

  // NOT tested here, on purpose: the permanent queue freeze itself. That lives in the
  // CLIENT (operationQueue only re-peeks when pushOperations throws), so any backend
  // test of "a later batch still applies" passes with the bug present too, and would
  // be a green proving nothing. The server-side half that IS provable is the one
  // asserted above: the batch is no longer rolled back and the denial is reported
  // per-op. The freeze half belongs to the e2e full-chain, where a real client queue
  // exists. See testes-backend.md.

  it('a TIER violation still fails the whole batch with 403', async () => {
    const reader = await createUser(db, { username: `poison_rd_${randomUUID().slice(0, 8)}` });
    const readerToken = await loginUser(app, reader.username, reader.password);
    await createShare(db, atlas.id, reader.id, 'read', owner.id);
    const map = await createMap(db, atlas.id, { name: 'Reader Map' });
    const fId = randomUUID();

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${readerToken}`)
      .send({
        operations: [{
          id: randomUUID(), entityType: 'feature', operationType: 'create',
          entityId: fId, mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { id: fId },
          },
          timestamp: Date.now(), clientId: 'c-read',
        }],
      })
      .expect(403);

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [fId]);
    assert.equal(rows.length, 0, 'nothing from a read-tier principal is applied');
  });
});

// Path: tests/integration/sync-locked-map-poison.repro.test.js
// Regression (achado 22): a write to a LOCKED map used to throw ConflictError from inside
// applyOperation, i.e. from inside the tx() that wraps the WHOLE push batch. The batch rolled
// back and the route answered 409.
//
// The client never dequeues a batch the server did not accept (frontend sync-engine.js flush:
// "A rejected batch is NOT dequeued - the queue re-peeks the same ops next flush"; sync-flush.js
// swallows the error in a console.warn). So one op aimed at a map that got locked while it sat in
// the offline queue froze that user's ENTIRE outbound queue — including ops for other maps, which
// queue up behind it and are re-peeked forever, with nothing shown in the UI.
//
// A locked map is a POLICY refusal, not an integrity failure, so it is now handled like the other
// per-op refusals in sync.service.js (map delete / lock by a non-owner, achado already fixed in
// sync-denied-op-poison.repro.test.js): the op is refused on its own, acked with success:false and
// a reason, the rest of the batch applies, and the push answers 200 so the client can dequeue.
// Real integrity failures (cross-atlas reference, bad UUID) still abort the whole batch —
// sync-batch-atomicity.test.js pins that.
//
// Negative control: restore `throw new ConflictError('Map is locked')` in applyOperation and every
// test below fails (409 instead of 200).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createFeature, createShare, loginUser } from '../helpers/fixtures.js';

describe('a locked map refuses the op without poisoning the batch (repro)', () => {
  let app, db, owner, editor, editorToken, atlas, lockedMap, freeMap;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `lockp_own_${randomUUID().slice(0, 8)}` });
    editor = await createUser(db, { username: `lockp_ed_${randomUUID().slice(0, 8)}` });
    editorToken = await loginUser(app, editor.username, editor.password);
    atlas = await createAtlas(db, owner.id, { name: 'Locked Map Poison Atlas' });
    await createShare(db, atlas.id, editor.id, 'write', owner.id);

    lockedMap = await createMap(db, atlas.id, { name: 'Mapa Bloqueado' });
    freeMap = await createMap(db, atlas.id, { name: 'Mapa Livre' });
    // The owner locks it AFTER the editor already queued work offline — the real scenario.
    await db.query('UPDATE maps SET locked = true WHERE id = $1', [lockedMap.id]);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ operations });

  const featureOp = (id, mapId) => ({
    id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: id, mapId,
    data: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
      properties: { id, source: 'point', nome: 'feita offline' },
    },
    timestamp: Date.now(), clientId: 'c-lock-poison',
  });

  it('refuses only the locked-map op, applies the sibling, and reports it per-op', async () => {
    const blockedId = randomUUID();
    const survivorId = randomUUID();

    const res = await push([
      featureOp(blockedId, lockedMap.id),
      featureOp(survivorId, freeMap.id),
    ]).expect(200);

    // The lock still holds: nothing was written to the locked map.
    const blocked = await db.query('SELECT id FROM features WHERE id = $1', [blockedId]);
    assert.equal(blocked.rows.length, 0, 'a locked map must still refuse the write');

    // ...and the op for the OTHER map is no longer collateral damage.
    const survivor = await db.query('SELECT id FROM features WHERE id = $1', [survivorId]);
    assert.equal(survivor.rows.length, 1, 'the op for an unlocked map must not be rolled back');

    const results = res.body.data.results;
    assert.equal(results.length, 2, 'one ack per operation');
    assert.equal(results[0].success, false, 'the locked-map op is acked as refused, never as applied');
    assert.match(results[0].reason, /bloquead/i, 'the ack says WHY, so the client can surface it');
    assert.equal(results[1].success, true, 'the sibling op is acked as applied');
  });

  it('a batch made ONLY of locked-map ops still answers 200 (this is what unfreezes the queue)', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const res = await push(ids.map((id) => featureOp(id, lockedMap.id))).expect(200);

    assert.equal(res.body.data.results.length, 3);
    assert.ok(
      res.body.data.results.every((r) => r.success === false),
      'every op is refused individually'
    );

    const { rows } = await db.query('SELECT id FROM features WHERE id = ANY($1::uuid[])', [ids]);
    assert.equal(rows.length, 0, 'nothing is written to the locked map');
  });

  it('a refused op is NOT recorded in the operations log (no version, nothing to replay)', async () => {
    const id = randomUUID();
    const op = featureOp(id, lockedMap.id);
    await push([op]).expect(200);

    const { rows } = await db.query('SELECT 1 FROM operations WHERE atlas_id = $1 AND op_id = $2', [atlas.id, op.id]);
    assert.equal(rows.length, 0, 'a refused op must not take a server_version nor reach peers on replay');
  });

  it('DELETE of an existing feature on a locked map is refused the same way', async () => {
    const feat = await createFeature(db, freeMap.id);
    await db.query('UPDATE features SET map_id = $1 WHERE id = $2', [lockedMap.id, feat.id]);

    const res = await push([{
      id: randomUUID(), entityType: 'feature', operationType: 'delete', entityId: feat.id,
      mapId: lockedMap.id, timestamp: Date.now(), clientId: 'c-lock-poison',
    }]).expect(200);

    assert.equal(res.body.data.results[0].success, false);
    const { rows } = await db.query('SELECT deleted_at FROM features WHERE id = $1', [feat.id]);
    assert.equal(rows[0].deleted_at, null, 'the feature is NOT deleted while the map is locked');
  });

  it('unlocking restores writes (the refusal is about the lock, not about the user)', async () => {
    await db.query('UPDATE maps SET locked = false WHERE id = $1', [lockedMap.id]);
    const id = randomUUID();

    const res = await push([featureOp(id, lockedMap.id)]).expect(200);
    assert.equal(res.body.data.results[0].success, true);

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [id]);
    assert.equal(rows.length, 1, 'writes resume once the map is unlocked');

    await db.query('UPDATE maps SET locked = true WHERE id = $1', [lockedMap.id]);
  });
});

// Path: tests/integration/maps-merge-authz-lock.repro.test.js
// Regression: POST /maps/:mapId/merge sat below the authorization model it belongs
// to, and ignored the map lock entirely.
//
// The route required only `requireAtlasPermission('write')` (maps.routes.js:17)
// while the sync path reserves map DELETE to manage-and-above. That is backwards:
//
//   - `map delete` is a SOFT delete — `deleted_at` is set and the map is
//     recoverable.
//   - `merge` re-parents the rows of six child tables into another map and records
//     the previous `map_id` NOWHERE: not in `operations`, not in an audit row, not
//     in a history trigger. It is the strictly LESS reversible of the two, and it
//     needed one permission level LESS.
//
// (Correcting the original finding's wording: the content is not destroyed, it is
// re-parented. What is irreversibly lost is which sub-entity came from which map.)
//
// Second defect, independent: the sync path refuses to mutate the children of a map
// with `locked = true` (sync.service.js:1306-1310) and only the owner may set that
// flag. `mergeMaps` never read `locked`, so a 'write' user could empty — over REST —
// a map the owner had deliberately locked, which is precisely what locking is for.
//
// Negative controls: lower the route gate back to 'write' and the first test fails;
// remove the lock check and the lock tests fail.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createFeature, createShare, loginUser,
} from '../helpers/fixtures.js';

describe('map merge: authorization and lock (repro)', () => {
  let app, db, owner, writer, manager, ownerTok, writerTok, managerTok, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const rid = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `mrg_own_${rid}` });
    writer = await createUser(db, { username: `mrg_wr_${rid}` });
    manager = await createUser(db, { username: `mrg_mgr_${rid}` });

    ownerTok = await loginUser(app, owner.username, owner.password);
    writerTok = await loginUser(app, writer.username, writer.password);
    managerTok = await loginUser(app, manager.username, manager.password);

    atlas = await createAtlas(db, owner.id, { name: 'Atlas do Merge' });
    await createShare(db, atlas.id, writer.id, 'write', owner.id);
    await createShare(db, atlas.id, manager.id, 'manage', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** A fresh dest+source pair with one feature in the source, per test. */
  const pair = async () => {
    const dest = await createMap(db, atlas.id, { name: `dest-${randomUUID().slice(0, 6)}` });
    const src = await createMap(db, atlas.id, { name: `src-${randomUUID().slice(0, 6)}` });
    const feat = await createFeature(db, src.id);
    return { dest, src, feat };
  };

  const merge = (tok, destId, sourceMapIds) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${destId}/merge`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ sourceMapIds });

  const featureMap = async (id) =>
    (await db.query('SELECT map_id FROM features WHERE id = $1', [id])).rows[0].map_id;

  it('a WRITE user cannot merge — it outranks the delete it is less reversible than', async () => {
    const { dest, src, feat } = await pair();

    const res = await merge(writerTok, dest.id, [src.id]);
    assert.equal(res.status, 403, `a write-tier user must be refused, got ${res.status}`);
    assert.equal(await featureMap(feat.id), src.id, 'and nothing moved');
  });

  it('a MANAGE user can merge (co-Gestor, by hierarchy)', async () => {
    const { dest, src, feat } = await pair();

    await merge(managerTok, dest.id, [src.id]).expect(200);
    assert.equal(await featureMap(feat.id), dest.id, 'the co-Gestor merge really moves the rows');
  });

  it('the OWNER can still merge', async () => {
    const { dest, src, feat } = await pair();

    await merge(ownerTok, dest.id, [src.id]).expect(200);
    assert.equal(await featureMap(feat.id), dest.id);
  });

  // ---- lock ----

  it('a LOCKED source map is not emptied by a merge', async () => {
    const { dest, src, feat } = await pair();
    await db.query('UPDATE maps SET locked = true WHERE id = $1', [src.id]);

    const res = await merge(ownerTok, dest.id, [src.id]);
    assert.equal(res.status, 409, `a locked map must refuse the write, got ${res.status}`);
    assert.equal(await featureMap(feat.id), src.id, 'the locked map keeps its content');
  });

  it('a LOCKED destination map does not receive a merge', async () => {
    const { dest, src, feat } = await pair();
    await db.query('UPDATE maps SET locked = true WHERE id = $1', [dest.id]);

    const res = await merge(ownerTok, dest.id, [src.id]);
    assert.equal(res.status, 409, `writing INTO a locked map must be refused, got ${res.status}`);
    assert.equal(await featureMap(feat.id), src.id, 'nothing moved');
  });

  it('one locked source blocks the WHOLE merge, not just its own rows', async () => {
    // Partial application would be the worst outcome: the caller sees an error while
    // some maps were already emptied, and there is no record of what moved.
    const { dest, src, feat } = await pair();
    const src2 = await createMap(db, atlas.id, { name: `src2-${randomUUID().slice(0, 6)}` });
    const feat2 = await createFeature(db, src2.id);
    await db.query('UPDATE maps SET locked = true WHERE id = $1', [src2.id]);

    const res = await merge(ownerTok, dest.id, [src.id, src2.id]);
    assert.equal(res.status, 409);
    assert.equal(await featureMap(feat.id), src.id, 'the unlocked source is untouched too');
    assert.equal(await featureMap(feat2.id), src2.id, 'and the locked one, obviously');
  });

  it('unlocking restores the ability to merge', async () => {
    const { dest, src, feat } = await pair();
    await db.query('UPDATE maps SET locked = true WHERE id = $1', [src.id]);
    await merge(ownerTok, dest.id, [src.id]).expect(409);

    await db.query('UPDATE maps SET locked = false WHERE id = $1', [src.id]);
    await merge(ownerTok, dest.id, [src.id]).expect(200);
    assert.equal(await featureMap(feat.id), dest.id, 'the lock was the only thing blocking it');
  });
});

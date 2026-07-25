// Path: tests/integration/atlas-restore-integrity.test.js
// Item 155. POST /atlas/:atlasId/restore is the ONE route of the module with no
// `requireAtlasPermission` — the atlas is soft-deleted and the middleware only sees
// live rows — so the scope of the UPDATE (`id`, `owner_id`, `deleted_at IS NOT NULL`)
// IS the whole access control. atlas.test.js proves a non-owner gets 404 and that the
// atlas answers 200 again, but not that its CONTENT came back: SOFT_DELETE_ATLAS only
// marks the atlas row, so a future cleanup that cascaded into maps/features would keep
// that test green while the restore returned an empty project.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createFeature, createShare, loginUser,
} from '../helpers/fixtures.js';

describe('atlas trash round-trip: borders and content integrity', () => {
  let app, db, owner, ownerToken, manager, managerToken;

  const restore = (atlasId, token) => supertest(app)
    .post(`/api/v1/atlas/${atlasId}/restore`)
    .set('Authorization', `Bearer ${token}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const tag = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `p155_owner_${tag}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    manager = await createUser(db, { username: `p155_manager_${tag}` });
    managerToken = await loginUser(app, manager.username, manager.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('restoring an atlas that was never deleted is a 404 (the deleted_at predicate)', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P155 live ${randomUUID().slice(0, 6)}` });

    await restore(atlas.id, ownerToken).expect(404);

    const { rows } = await db.query('SELECT deleted_at, version FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].deleted_at, null, 'a refused restore must not bump anything');
    assert.equal(rows[0].version, 1);
  });

  it('restoring twice: the first is 200, the second is 404', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P155 twice ${randomUUID().slice(0, 6)}` });
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}`).set('Authorization', `Bearer ${ownerToken}`).expect(204);

    await restore(atlas.id, ownerToken).expect(200);
    await restore(atlas.id, ownerToken).expect(404);
  });

  it('the CONTENT comes back, not just the atlas row', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P155 content ${randomUUID().slice(0, 6)}` });
    const mapA = await createMap(db, atlas.id, { name: 'A' });
    const mapB = await createMap(db, atlas.id, { name: 'B' });
    await createFeature(db, mapA.id);
    await createFeature(db, mapA.id);
    await createFeature(db, mapB.id);

    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}`).set('Authorization', `Bearer ${ownerToken}`).expect(204);
    await restore(atlas.id, ownerToken).expect(200);

    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const maps = res.body.data.snapshot.maps;
    assert.equal(maps.length, 2, 'both maps are back');
    assert.deepEqual(maps.map((m) => m.name).sort(), ['A', 'B'], 'the same maps, not replacements');
    // `features` is the frozen by-type object of the snapshot contract, not an array.
    const featureCount = maps.reduce(
      (n, map) => n + Object.values(map.features).reduce((k, list) => k + list.length, 0),
      0
    );
    assert.equal(featureCount, 3, 'and all three features with them');
  });

  it('restore is owner-only even for the highest tier below owner (manage -> 404)', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P155 manage ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, manager.id, 'manage', owner.id);
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}`).set('Authorization', `Bearer ${ownerToken}`).expect(204);

    await restore(atlas.id, managerToken).expect(404);
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`).set('Authorization', `Bearer ${managerToken}`).expect(404);

    const { rows } = await db.query('SELECT deleted_at FROM atlas WHERE id = $1', [atlas.id]);
    assert.notEqual(rows[0].deleted_at, null, 'still in the trash');
  });

  it('a trashed atlas disappears from the SHARED member listing too, not only the owner\'s', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P155 listing ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, manager.id, 'manage', owner.id);

    const before = await supertest(app)
      .get('/api/v1/atlas').set('Authorization', `Bearer ${managerToken}`).expect(200);
    assert.ok(before.body.data.some((a) => a.id === atlas.id), 'visible while alive');

    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}`).set('Authorization', `Bearer ${ownerToken}`).expect(204);

    const after = await supertest(app)
      .get('/api/v1/atlas').set('Authorization', `Bearer ${managerToken}`).expect(200);
    assert.ok(!after.body.data.some((a) => a.id === atlas.id), 'gone for the member as well');

    // And the member's own trash is empty: only the owner soft-deletes and only the
    // owner sees the bin.
    const trash = await supertest(app)
      .get('/api/v1/atlas/trash').set('Authorization', `Bearer ${managerToken}`).expect(200);
    assert.ok(!trash.body.data.some((a) => a.id === atlas.id));
  });
});

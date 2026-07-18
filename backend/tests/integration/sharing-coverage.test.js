// Path: tests/integration/sharing-coverage.test.js
// Coverage tests for the Sharing subsystem focused on the GRANT -> OBSERVABLE
// EFFECT loop and negative access. Existing suites (sharing.test.js,
// sharing-gaps.test.js, permissions.test.js) assert that addUserShare writes a
// row and that a PRE-SEEDED share resolves to a level. These tests instead tie
// the *sharing endpoint's* grant to the precise permission it confers, end to
// end through the sync write gate (which requires 'write'), and assert that
// updating and revoking through the sharing API observably change access.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const uniq = () => `shc_${randomUUID().slice(0, 8)}`;

// A minimal, valid sync-push envelope creating one feature on `mapId`.
function pushBody(mapId) {
  return {
    operations: [{
      id: randomUUID(),
      entityType: 'feature',
      operationType: 'create',
      entityId: randomUUID(),
      mapId,
      data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: {} },
      timestamp: Date.now(),
      clientId: 'shc-client',
    }],
  };
}

describe('Sharing — grant-to-effect coverage', () => {
  let app, db, owner, ownerToken, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: uniq() });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `shc atlas ${uniq()}` });
    map = await createMap(db, atlas.id, { name: 'shc-map' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------------------
  // GRANT 'read' via the sharing API -> grantee can READ but is BLOCKED from
  // every write path (PUT atlas + sync push). Proves the grant maps to exactly
  // 'read', not merely "has access". NEGATIVE.
  // ---------------------------------------------------------------------------
  it('granting read via POST /sharing/users lets the grantee read but NOT write (sync push 403, PUT 403)', async () => {
    const grantee = await createUser(db, { username: uniq() });
    const granteeToken = await loginUser(app, grantee.username, grantee.password);

    // Baseline: before any grant the grantee is a stranger -> 403 on read.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${granteeToken}`)
      .expect(403);

    // Owner grants exactly 'read'.
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: grantee.id, permission: 'read' })
      .expect(201);

    // Effect: can now READ the atlas.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${granteeToken}`)
      .expect(200);

    // NEGATIVE: 'read' must NOT allow writing through sync (requires 'write').
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${granteeToken}`)
      .send(pushBody(map.id))
      .expect(403);

    // NEGATIVE: 'read' must NOT allow updating atlas metadata.
    await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${granteeToken}`)
      .send({ name: 'should-be-blocked' })
      .expect(403);

    // The atlas name was NOT mutated by the blocked PUT.
    const { rows } = await db.query('SELECT name FROM atlas WHERE id = $1', [atlas.id]);
    assert.notEqual(rows[0].name, 'should-be-blocked');
  });

  // ---------------------------------------------------------------------------
  // GRANT 'write' -> grantee CAN push sync (operation lands in DB). Proves the
  // write grant actually unlocks the write path.
  // ---------------------------------------------------------------------------
  it('granting write via POST /sharing/users lets the grantee push a sync operation (lands in DB)', async () => {
    const grantee = await createUser(db, { username: uniq() });
    const granteeToken = await loginUser(app, grantee.username, grantee.password);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: grantee.id, permission: 'write' })
      .expect(201);

    const body = pushBody(map.id);
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${granteeToken}`)
      .send(body)
      .expect(200);

    // The created feature exists in the DB, attributed to the grantee.
    const { rows } = await db.query(
      'SELECT id FROM features WHERE id = $1 AND map_id = $2 AND deleted_at IS NULL',
      [body.operations[0].entityId, map.id]
    );
    assert.equal(rows.length, 1, 'write grantee successfully created a feature via sync');
  });

  // ---------------------------------------------------------------------------
  // UPDATE read -> write via PUT /sharing/users/:userId observably unlocks the
  // write path that was previously 403.
  // ---------------------------------------------------------------------------
  it('PUT /sharing/users/:userId upgrading read->write unlocks the sync push that was 403', async () => {
    const grantee = await createUser(db, { username: uniq() });
    const granteeToken = await loginUser(app, grantee.username, grantee.password);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: grantee.id, permission: 'read' })
      .expect(201);

    // With 'read', push is blocked.
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${granteeToken}`)
      .send(pushBody(map.id))
      .expect(403);

    // Owner upgrades to 'write'.
    await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}/sharing/users/${grantee.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ permission: 'write' })
      .expect(200);

    // Now the same push succeeds.
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${granteeToken}`)
      .send(pushBody(map.id))
      .expect(200);
  });

  // ---------------------------------------------------------------------------
  // REVOKE via DELETE /sharing/users/:userId observably removes access:
  // a previously-readable atlas becomes 403 for the ex-grantee. NEGATIVE.
  // ---------------------------------------------------------------------------
  it('DELETE /sharing/users/:userId revokes access — ex-grantee read goes 200 -> 403', async () => {
    const grantee = await createUser(db, { username: uniq() });
    const granteeToken = await loginUser(app, grantee.username, grantee.password);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: grantee.id, permission: 'read' })
      .expect(201);

    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${granteeToken}`)
      .expect(200);

    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/sharing/users/${grantee.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    // Share row is gone.
    const { rows } = await db.query(
      'SELECT 1 FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlas.id, grantee.id]
    );
    assert.equal(rows.length, 0);

    // NEGATIVE: access is revoked.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${granteeToken}`)
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // NEGATIVE: a non-owner grantee (even with 'write') cannot RE-SHARE the atlas
  // with someone else — sharing management is owner-only. And no row is created.
  // ---------------------------------------------------------------------------
  it('a write-shared user cannot re-share the atlas with a third party (403, no row created)', async () => {
    const writer = await createUser(db, { username: uniq() });
    const writerToken = await loginUser(app, writer.username, writer.password);
    const victim = await createUser(db, { username: uniq() });

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: writer.id, permission: 'write' })
      .expect(201);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
      .set('Authorization', `Bearer ${writerToken}`)
      .send({ userId: victim.id, permission: 'read' })
      .expect(403);

    const { rows } = await db.query(
      'SELECT 1 FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlas.id, victim.id]
    );
    assert.equal(rows.length, 0, 'non-owner write grantee must not be able to create shares');
  });

  // ---------------------------------------------------------------------------
  // VALIDATION on update/remove routes (these had no 422 coverage; only the
  // add route's 422 was tested in sharing.test.js).
  // ---------------------------------------------------------------------------
  describe('validation of update/remove routes', () => {
    it('PUT /sharing/users/:userId rejects an invalid permission value (422), share unchanged', async () => {
      const grantee = await createUser(db, { username: uniq() });
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: grantee.id, permission: 'read' })
        .expect(201);

      await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}/sharing/users/${grantee.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ permission: 'owner' }) // not in {read,write}
        .expect(422);

      // Unchanged.
      const { rows } = await db.query(
        'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, grantee.id]
      );
      assert.equal(rows[0].permission, 'read', 'invalid update must not mutate the share');
    });

    it('PUT /sharing/users/:userId with an empty body (missing permission) -> 422', async () => {
      const grantee = await createUser(db, { username: uniq() });
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: grantee.id, permission: 'read' })
        .expect(201);

      await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}/sharing/users/${grantee.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(422);
    });

    it('DELETE /sharing/users/:userId for a user with no share -> 404', async () => {
      const notShared = await createUser(db, { username: uniq() });
      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/sharing/users/${notShared.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });
});

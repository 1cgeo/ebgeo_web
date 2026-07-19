// Path: tests/integration/users-coverage.test.js
// Coverage tests for the Users subsystem targeting genuinely untested paths:
//  - admin API-key rotation route (auth.test/auth-gaps only exercised the SELF
//    rotate path); here: non-admin 403, old key rejected after rotation, new key
//    authenticates, archived in api_key_history, 404 on nonexistent target.
//  - self-service password change REVOKES the caller's own refresh sessions
//    (users-admin only asserted this for the admin RESET path).
//  - transfer-before-hard-delete edge: transferTo === the user being deleted
//    is allowed (no-op transfer onto self) and the user is still soft-deleted.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';

const uniq = () => `usc_${randomUUID().slice(0, 8)}`;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

describe('Users — coverage', () => {
  let app, db, admin, adminToken, user, userToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: uniq() });
    user = await createUser(db, { username: uniq() });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ===========================================================================
  // Admin API-key rotation: POST /users/:userId/api-key/rotate
  // ===========================================================================
  describe('POST /users/:userId/api-key/rotate (admin)', () => {
    it('NEGATIVE: a regular user cannot rotate another user\'s api key (403), key unchanged', async () => {
      const victim = await createUser(db, { username: uniq() });
      // Give the victim a known key.
      await db.query('UPDATE users SET api_key = gen_random_uuid() WHERE id = $1', [victim.id]);
      const before = (await db.query('SELECT api_key FROM users WHERE id = $1', [victim.id])).rows[0].api_key;

      await supertest(app)
        .post(`/api/v1/users/${victim.id}/api-key/rotate`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      const after = (await db.query('SELECT api_key FROM users WHERE id = $1', [victim.id])).rows[0].api_key;
      assert.equal(after, before, 'non-admin attempt must not rotate the key');
    });

    it('admin rotation archives the old key, issues a new working one, and invalidates the old', async () => {
      const target = await createUser(db, { username: uniq() });
      // Seed an initial key and confirm it authenticates.
      await db.query('UPDATE users SET api_key = gen_random_uuid() WHERE id = $1', [target.id]);
      const oldKey = (await db.query('SELECT api_key FROM users WHERE id = $1', [target.id])).rows[0].api_key;

      const me1 = await supertest(app)
        .get('/api/v1/auth/me')
        .set('x-api-key', oldKey)
        .expect(200);
      assert.equal(me1.body.data.id, target.id);

      // Admin rotates.
      const rot = await supertest(app)
        .post(`/api/v1/users/${target.id}/api-key/rotate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const newKey = rot.body.data.apiKey;
      assert.ok(newKey);
      assert.notEqual(newKey, oldKey, 'rotation must produce a different key');

      // The new key authenticates...
      const me2 = await supertest(app)
        .get('/api/v1/auth/me')
        .set('x-api-key', newKey)
        .expect(200);
      assert.equal(me2.body.data.id, target.id);

      // ...and the OLD key no longer authenticates (anonymous -> 401 on strict).
      await supertest(app)
        .get('/api/v1/auth/me')
        .set('x-api-key', oldKey)
        .expect(401);

      // The old key was archived to api_key_history with a revoked_at + revoked_by.
      const { rows } = await db.query(
        `SELECT revoked_at, revoked_by FROM api_key_history WHERE user_id = $1 AND api_key = $2`,
        [target.id, oldKey]
      );
      assert.equal(rows.length, 1, 'old key archived exactly once');
      assert.ok(rows[0].revoked_at, 'archived key has revoked_at');
      assert.equal(rows[0].revoked_by, admin.id, 'archived key records the rotating admin');
    });

    it('rotation for a nonexistent target user -> 404', async () => {
      // ROTATE_API_KEY uses t.one(); no matching user row -> rejects -> 404.
      await supertest(app)
        .post(`/api/v1/users/${NIL_UUID}/api-key/rotate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  // ===========================================================================
  // Self-service password change: PUT /users/me/password
  // ===========================================================================
  describe('PUT /users/me/password (self-service)', () => {
    it('changing own password REVOKES the caller\'s existing refresh sessions', async () => {
      const u = await createUser(db, { username: uniq(), password: 'Old@Pass123' });
      const login = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: u.username, password: 'Old@Pass123' })
        .expect(200);
      const access = login.body.data.accessToken;
      const oldRefresh = login.body.data.refreshToken;

      await supertest(app)
        .put('/api/v1/users/me/password')
        .set('Authorization', `Bearer ${access}`)
        .send({ currentPassword: 'Old@Pass123', newPassword: 'New@Pass456' })
        .expect(200);

      // The pre-existing refresh token must be rejected after the change.
      await supertest(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: oldRefresh })
        .expect(401);

      // And the new password works for a fresh login.
      await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: u.username, password: 'New@Pass456' })
        .expect(200);
    });

    it('NEGATIVE: wrong current password -> 401 and password is unchanged', async () => {
      const u = await createUser(db, { username: uniq(), password: 'Keep@Pass123' });
      const token = await loginUser(app, u.username, 'Keep@Pass123');
      const beforeHash = (await db.query('SELECT password_hash FROM users WHERE id = $1', [u.id])).rows[0].password_hash;

      await supertest(app)
        .put('/api/v1/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'totally-wrong', newPassword: 'New@Pass789' })
        .expect(401);

      const afterHash = (await db.query('SELECT password_hash FROM users WHERE id = $1', [u.id])).rows[0].password_hash;
      assert.equal(afterHash, beforeHash, 'password hash must be untouched after a failed change');

      // Original password still works.
      await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: u.username, password: 'Keep@Pass123' })
        .expect(200);
    });
  });

  // ===========================================================================
  // transfer-before-hard-delete edge cases (atlas.owner_id FK has no ON DELETE)
  // ===========================================================================
  describe('DELETE /users/:userId — transfer edge cases', () => {
    // Was: "transferTo === the deleted user keeps the atlas pointed at that (now
    // inactive) id", asserting 200 and an atlas left owned by a deactivated account.
    // Its own comment said it "documents that self-transfer satisfies the transferTo
    // requirement without moving ownership anywhere" — which is a description of the
    // orphaning bug, written as though it were the specification. The state it froze
    // is precisely what the ConflictError one branch above exists to prevent.
    // Since 2026-07-19 self-transfer is refused; see user-delete-transfer.repro.test.js.
    it('transferTo === the deleted user is refused, so the atlas is never orphaned', async () => {
      const source = await createUser(db, { username: uniq() });
      const atlas = await createAtlas(db, source.id, { name: `self-xfer ${uniq()}` });

      await supertest(app)
        .delete(`/api/v1/users/${source.id}?transferTo=${source.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      const owner = (await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id])).rows[0].owner_id;
      assert.equal(owner, source.id, 'ownership unchanged');
      const active = (await db.query('SELECT is_active FROM users WHERE id = $1', [source.id])).rows[0].is_active;
      assert.equal(active, true, 'and the user stays active — a refused delete must not half-apply');
    });

    it('NEGATIVE: deleting a user who owns an atlas WITHOUT transferTo -> 409 and nothing mutates', async () => {
      const source = await createUser(db, { username: uniq() });
      const atlas = await createAtlas(db, source.id, { name: `no-xfer ${uniq()}` });

      await supertest(app)
        .delete(`/api/v1/users/${source.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      // Atomic rollback: user still active, atlas still owned by source.
      const active = (await db.query('SELECT is_active FROM users WHERE id = $1', [source.id])).rows[0].is_active;
      assert.equal(active, true, 'user must remain active when transfer is required but missing');
      const owner = (await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id])).rows[0].owner_id;
      assert.equal(owner, source.id);
    });
  });

  // ===========================================================================
  // Self-service strict-auth boundary on the api-key rotate route.
  // ===========================================================================
  describe('POST /users/me/api-key/rotate', () => {
    it('NEGATIVE: anonymous request (no credential) -> 401', async () => {
      await supertest(app)
        .post('/api/v1/users/me/api-key/rotate')
        .expect(401);
    });
  });
});

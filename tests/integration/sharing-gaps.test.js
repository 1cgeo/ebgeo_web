// Path: tests/integration/sharing-gaps.test.js
// Gap-coverage integration tests for the Sharing API + permissions.
// Each test asserts the CURRENT behavior (verified against src/modules/sharing/*
// and src/middleware/permissions.js). Findings: share-01..share-10.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser, createShare } from '../helpers/fixtures.js';

const uniq = () => `gap_${randomUUID().slice(0, 8)}`;

// Mints an access token with the same single-issuer shape the app produces.
function mintToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      nome: user.nome,
      posto: user.posto_graduacao,
      role: user.role || 'user',
      organization_id: user.organization_id ?? null,
      org_role: user.org_role || 'viewer',
      org: user.organization_id ?? null,
      login: user.username,
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m', algorithm: 'HS256' }
  );
}

describe('Sharing API — gap coverage', () => {
  let app, db, owner, ownerToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: uniq() });
    ownerToken = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ---- share-01: global admin who is not owner is locked out of sharing REST ----
  describe('share-01: global admin (non-owner) on sharing routes', () => {
    it('global admin who is not the owner gets 403 on GET /sharing and POST /sharing/users', async () => {
      const admin = await createUser(db, { username: uniq(), role: 'admin' });
      const adminToken = mintToken(admin);
      const atlas = await createAtlas(db, owner.id, { name: `s01 ${uniq()}` });

      // sanity: the token really carries role:'admin'
      assert.equal(jwt.decode(adminToken).role, 'admin');

      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);

      const target = await createUser(db, { username: uniq() });
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: target.id, permission: 'read' })
        .expect(403);
    });
  });

  // ---- share-02: re-share existing user upgrades permission, still 201, one row ----
  describe('share-02: re-share (ON CONFLICT DO UPDATE) idempotency', () => {
    it('second POST with different permission returns 201, keeps one row, updates permission', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s02 ${uniq()}` });
      const target = await createUser(db, { username: uniq() });

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: target.id, permission: 'read' })
        .expect(201);

      const before = await db.query(
        'SELECT added_by FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, target.id]
      );
      assert.equal(before.rows.length, 1);

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: target.id, permission: 'write' })
        .expect(201);

      const after = await db.query(
        'SELECT permission, added_by FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, target.id]
      );
      assert.equal(after.rows.length, 1, 'exactly one share row');
      assert.equal(after.rows[0].permission, 'write', 'permission upgraded to write');
      assert.equal(after.rows[0].added_by, before.rows[0].added_by, 'added_by unchanged on update');
    });
  });

  // ---- share-03: addUserShare 404 for nonexistent / inactive user ----
  describe('share-03: addUserShare 404 paths', () => {
    it('sharing with a well-formed but nonexistent UUID returns 404', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s03a ${uniq()}` });
      const ghostId = randomUUID();

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: ghostId, permission: 'read' })
        .expect(404);

      const { rows } = await db.query(
        'SELECT 1 FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, ghostId]
      );
      assert.equal(rows.length, 0, 'no share row created for ghost user');
    });

    it('sharing with a deactivated (is_active=false) user returns 404', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s03b ${uniq()}` });
      const dead = await createUser(db, { username: uniq() });
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [dead.id]);

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: dead.id, permission: 'read' })
        .expect(404);

      const { rows } = await db.query(
        'SELECT 1 FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, dead.id]
      );
      assert.equal(rows.length, 0, 'no share row created for deactivated user');
    });
  });

  // ---- share-05: public link rotation on re-enable invalidates old link ----
  describe('share-05: public link rotation on re-enable', () => {
    it('enabling twice rotates the link; old link 404s, new link 200s', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s05 ${uniq()}` });

      const r1 = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const link1 = r1.body.data.publicLink || r1.body.data.public_link;
      assert.ok(link1);

      const r2 = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const link2 = r2.body.data.publicLink || r2.body.data.public_link;
      assert.ok(link2);

      assert.notEqual(link1, link2, 'link rotated on re-enable');

      await supertest(app).get(`/api/v1/atlas/public/${link1}`).expect(404);
      await supertest(app).get(`/api/v1/atlas/public/${link2}`).expect(200);
    });
  });

  // ---- share-06: GET /sharing config response shape (camelCase) ----
  describe('share-06: GET /sharing response shape', () => {
    it('returns camelCase isPublic/publicLink and per-share keys', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s06 ${uniq()}` });
      const target = await createUser(db, { username: uniq(), nome: 'Shape User' });
      await createShare(db, atlas.id, target.id, 'read', owner.id);

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const data = res.body.data;
      assert.ok('isPublic' in data, 'has camelCase isPublic');
      assert.ok('publicLink' in data, 'has camelCase publicLink');
      assert.equal(typeof data.isPublic, 'boolean');
      assert.ok(Array.isArray(data.shares));
      assert.equal(data.shares.length, 1);

      const share = data.shares[0];
      assert.deepEqual(
        Object.keys(share).sort(),
        ['addedAt', 'nome', 'permission', 'userId', 'username'].sort()
      );
      assert.equal(share.userId, target.id);
      assert.equal(share.username, target.username);
      assert.equal(share.nome, 'Shape User');
      assert.equal(share.permission, 'read');
      assert.ok(share.addedAt);
      // snake_case must NOT leak
      assert.ok(!('user_id' in share));
      assert.ok(!('added_at' in share));
    });

    it('returns shares: [] for an atlas with no shares', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s06b ${uniq()}` });

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.deepEqual(res.body.data.shares, []);
    });
  });

  // ---- share-07: config still lists shares of deactivated users (no is_active filter) ----
  describe('share-07: sharing config + deactivated shared user', () => {
    it('a share with a later-deactivated user still appears in the config', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s07 ${uniq()}` });
      const user = await createUser(db, { username: uniq() });
      await createShare(db, atlas.id, user.id, 'read', owner.id);

      // deactivate AFTER the share exists
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const ids = res.body.data.shares.map((s) => s.userId);
      assert.ok(
        ids.includes(user.id),
        'GET_SHARING_CONFIG has no is_active filter — stale share still surfaces'
      );

      // and the share row itself persists in the DB
      const { rows } = await db.query(
        'SELECT 1 FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, user.id]
      );
      assert.equal(rows.length, 1);
    });
  });

  // ---- share-08: anonymous requests to write/manage sharing routes -> 401 ----
  describe('share-08: anonymous requests get 401 (not 403)', () => {
    it('GET /sharing without Authorization -> 401', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s08a ${uniq()}` });
      await supertest(app).get(`/api/v1/atlas/${atlas.id}/sharing`).expect(401);
    });

    it('POST /sharing/users without Authorization -> 401', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s08b ${uniq()}` });
      const target = await createUser(db, { username: uniq() });
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .send({ userId: target.id, permission: 'read' })
        .expect(401);
    });

    it('POST /sharing/public and DELETE /sharing/public without Authorization -> 401', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s08c ${uniq()}` });
      await supertest(app).post(`/api/v1/atlas/${atlas.id}/sharing/public`).expect(401);
      await supertest(app).delete(`/api/v1/atlas/${atlas.id}/sharing/public`).expect(401);
    });
  });

  // ---- share-09: disablePublicSharing no-op + soft-deleted-atlas 404 ----
  describe('share-09: DELETE /sharing/public edge cases', () => {
    it('disabling an already-non-public atlas is a 204 no-op (is_public stays false, version bumps)', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s09a ${uniq()}` });

      const v0 = (await db.query('SELECT version, is_public FROM atlas WHERE id = $1', [atlas.id])).rows[0];
      assert.equal(v0.is_public, false);

      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      const v1 = (await db.query('SELECT version, is_public FROM atlas WHERE id = $1', [atlas.id])).rows[0];
      assert.equal(v1.is_public, false);
      assert.equal(Number(v1.version), Number(v0.version) + 1, 'no-op disable still bumps version');
    });

    it('disabling on a soft-deleted atlas -> 404', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s09b ${uniq()}` });
      await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlas.id]);

      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('enabling then disabling twice bumps version each call', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `s09c ${uniq()}` });
      const base = Number((await db.query('SELECT version FROM atlas WHERE id = $1', [atlas.id])).rows[0].version);

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);
      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      const final = Number((await db.query('SELECT version FROM atlas WHERE id = $1', [atlas.id])).rows[0].version);
      assert.equal(final, base + 3, 'enable + 2 disables = +3 version bumps');
    });
  });

  // ---- share-10: owner self-share is silently allowed; effective access stays 'owner' ----
  describe('share-10: owner sharing with self', () => {
    it('owner can self-share (201), a redundant row exists, but effective access stays owner', async () => {
      const selfOwner = await createUser(db, { username: uniq() });
      const selfToken = await loginUser(app, selfOwner.username, selfOwner.password);
      const atlas = await createAtlas(db, selfOwner.id, { name: `s10 ${uniq()}` });

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${selfToken}`)
        .send({ userId: selfOwner.id, permission: 'read' })
        .expect(201);

      // redundant share row exists
      const { rows } = await db.query(
        'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, selfOwner.id]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].permission, 'read');

      // owner check precedes share → owner still has full management access
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${selfToken}`)
        .expect(200);

      // owner can still write (would be 403 if 'read' share governed)
      await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${selfToken}`)
        .send({ name: `s10-renamed ${uniq()}` })
        .expect(200);
    });
  });
});

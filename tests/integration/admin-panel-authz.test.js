// Path: tests/integration/admin-panel-authz.test.js
// The global admin panel (users / resources management) is gated by the GLOBAL role
// users.role='admin' (requireAdmin), which is ORTHOGONAL to per-atlas roles. users-admin.test.js
// already proves a plain regular user is rejected on every admin endpoint; this pins the
// easy-to-get-wrong case: owning an atlas (a per-atlas 'owner') does NOT confer global admin —
// an atlas owner whose global role is still 'user' is 403 across the admin panel (owner ≠ sysadmin).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';

describe('Admin panel — global-role gate (atlas owner is not a sysadmin)', () => {
  let app, db;
  let atlasOwner, atlasOwnerToken; // global role 'user', but owns an atlas
  let admin, adminToken; // global role 'admin'

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    atlasOwner = await createUser(db, { username: `ap_owner_${randomUUID().slice(0, 6)}` });
    admin = await createAdminUser(db, { username: `ap_admin_${randomUUID().slice(0, 6)}` });
    atlasOwnerToken = await loginUser(app, atlasOwner.username, atlasOwner.password);
    adminToken = await loginUser(app, admin.username, admin.password);

    // atlasOwner is the per-atlas owner here, yet keeps the global role 'user'.
    await createAtlas(db, atlasOwner.id, { name: 'Owned by a non-admin' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ── atlas owner (global 'user') is NOT a sysadmin ──
  it('an atlas owner cannot list users (admin panel) — 403', async () => {
    await supertest(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${atlasOwnerToken}`)
      .expect(403);
  });

  it('an atlas owner cannot create users — 403', async () => {
    await supertest(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${atlasOwnerToken}`)
      .send({ username: `nope_${randomUUID().slice(0, 6)}`, password: 'Test@12345', nome: 'Nope' })
      .expect(403);
  });

  it('an atlas owner cannot manage global resources — 403', async () => {
    await supertest(app)
      .post('/api/v1/resources')
      .set('Authorization', `Bearer ${atlasOwnerToken}`)
      .send({ id: `res_${randomUUID().slice(0, 6)}`, category: 'basemap', name: 'X', config: {} })
      .expect(403);
  });

  // ── positive: a real sysadmin passes the same gate ──
  it('a global admin CAN list users — 200', async () => {
    const res = await supertest(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.ok(Array.isArray(res.body.data));
  });
});

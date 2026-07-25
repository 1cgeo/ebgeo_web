// Path: tests/integration/users-admin-fk-and-login.test.js
// Items 177 and 178 — the admin-provisioning path end to end.
//
// 177. `INSERT_USER_ADMIN` never writes `email`, and the login gate only applies when
//      `user.email IS NOT NULL` (auth.service.js). So an admin-created account logs in
//      immediately despite email_verified = false. Tightening that gate to require
//      email_verified unconditionally would lock out every provisioned account and NO
//      test would fail: users-admin.test.js creates accounts through the route but
//      never logs in with one, and every login test uses fixtures inserted straight
//      into the database.
//
// 178. A well-formed but nonexistent rank_id / organization_id raises SQLSTATE 23503.
//      PG_ERROR_MAP maps it to a 409, and no test of this module exercises that map —
//      remove the entry and the admin panel starts receiving 500s. The last two cases
//      pin the footgun the map cannot help with: assigning a user to a DEACTIVATED OM
//      is accepted and then locks them out at login.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('admin-provisioned accounts: login gate and FK error mapping', () => {
  let app, db, adminToken;
  const tag = randomUUID().slice(0, 8);

  const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `p177_admin_${tag}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ── item 177 · an account with a NULL e-mail logs in immediately ───────────
  it('a user created by an admin logs in at once, despite email_verified = false', async () => {
    const username = `p177_prov_${tag}`;
    const created = await asAdmin(supertest(app).post('/api/v1/users'))
      .send({ username, password: 'Prov@12345', nome: 'Provisionado' })
      .expect(201);

    const { rows } = await db.query(
      'SELECT email, email_verified FROM users WHERE id = $1', [created.body.data.id]
    );
    assert.equal(rows[0].email, null, 'the admin route does not write an e-mail');
    assert.equal(rows[0].email_verified, false, 'so the flag stays false');

    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username, password: 'Prov@12345' })
      .expect(200);
    assert.ok(login.body.data.accessToken, 'the gate only fires when email IS NOT NULL');

    // And the token really works on a strict route, not just at the login desk.
    await supertest(app)
      .get('/api/v1/atlas')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);
  });

  // ── item 178 · FK violations and the inactive-OM footgun ───────────────────
  it('POST /users with a nonexistent rank_id is a clean 409, and creates nothing', async () => {
    const username = `p178_fkrank_${tag}`;
    const res = await asAdmin(supertest(app).post('/api/v1/users'))
      .send({ username, password: 'Test@1234', nome: 'FK Rank', rank_id: randomUUID() });

    assert.equal(res.status, 409, 'the FK violation must not surface as a 500');
    assert.equal(res.body.error.code, 'CONFLICT');

    const { rows } = await db.query('SELECT count(*)::int AS n FROM users WHERE username = $1', [username]);
    assert.equal(rows[0].n, 0, 'the row is rolled back with the transaction');
  });

  it('PUT /users/:id with a nonexistent organization_id is a 409 and leaves the row intact', async () => {
    const user = await createUser(db, { username: `p178_fkorg_${tag}` });
    const { rows: before } = await db.query(
      'SELECT organization_id, nome FROM users WHERE id = $1', [user.id]
    );

    const res = await asAdmin(supertest(app).put(`/api/v1/users/${user.id}`))
      .send({ organization_id: randomUUID(), nome: 'Nome Novo' });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');

    const { rows: after } = await db.query(
      'SELECT organization_id, nome FROM users WHERE id = $1', [user.id]
    );
    assert.equal(after[0].organization_id, before[0].organization_id);
    assert.equal(after[0].nome, before[0].nome, 'the sibling field did not slip through either');
  });

  it('FOOTGUN: assigning a user to an INACTIVE OM is accepted, then locks them out at login', async () => {
    const org = await asAdmin(supertest(app).post('/api/v1/organizations'))
      .send({ nome: `OM Morta ${tag}`, slug: `om-morta-${tag}` })
      .expect(201);
    const user = await createUser(db, { username: `p178_lock_${tag}` });

    // The account works before the move.
    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password })
      .expect(200);

    await asAdmin(supertest(app).delete(`/api/v1/organizations/${org.body.data.id}`)).expect(204);

    // Nothing in the admin panel warns that the destination is deactivated.
    await asAdmin(supertest(app).put(`/api/v1/users/${user.id}`))
      .send({ organization_id: org.body.data.id })
      .expect(200);

    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password });
    assert.equal(login.status, 403, 'the org gate refuses the login the admin just broke');
    assert.match(login.body.error.message, /[Oo]rganiza/);
  });

  it('an INACTIVE rank is likewise accepted, and posto_graduacao keeps deriving from it', async () => {
    const rank = await asAdmin(supertest(app).post('/api/v1/ranks'))
      .send({ nome: `Posto Morto ${tag}` })
      .expect(201);
    const user = await createUser(db, { username: `p178_rank_${tag}` });

    await asAdmin(supertest(app).delete(`/api/v1/ranks/${rank.body.data.id}`)).expect(204);

    await asAdmin(supertest(app).put(`/api/v1/users/${user.id}`))
      .send({ rank_id: rank.body.data.id })
      .expect(200);

    const res = await asAdmin(supertest(app).get(`/api/v1/users/${user.id}`)).expect(200);
    assert.equal(
      res.body.data.posto_graduacao, `Posto Morto ${tag}`,
      'the LEFT JOIN does not filter is_active, so a retired rank still renders'
    );
  });
});

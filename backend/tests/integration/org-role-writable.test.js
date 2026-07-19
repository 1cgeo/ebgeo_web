// Path: tests/integration/org-role-writable.test.js
// `org_role` had no writer anywhere, which made the sv360 org gate dead code.
//
// The column exists (001_core.sql:97-98, DEFAULT 'viewer', CHECK owner|admin|editor|
// viewer) and is READ in eight places — the JWT claim, both auth middlewares,
// `canWriteProject` (sv360.write.service.js:36), `requireUploadCapability`
// (sv360.routes.js:269). Nothing in either package ever wrote it: a grep for
// `org_role` across backend and frontend found only SELECTs and reads.
//
// So every user sat on 'viewer' forever, `['owner','admin','editor'].includes(org_role)`
// was always false, and editing a 360 project was global-admin-only in practice.
// The whole per-organization write model was unreachable — not broken in a way that
// errored, just permanently closed, which is why nothing surfaced it.
//
// A test that only checked "admin can PUT org_role" would miss the point: the value
// has to reach the JWT and open the gate it was designed for. That round trip —
// admin sets it, user logs in, gate opens — is what the tests below assert.
//
// Negative control: drop `org_role = COALESCE($11, org_role)` from UPDATE_USER_ADMIN
// and every test here fails.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('org_role is writable by an admin and reaches the gates', () => {
  let app, db, adminTok, target;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db);
    adminTok = await loginUser(app, admin.username, admin.password);
    target = await createUser(db, { username: `orgrole_${randomUUID().slice(0, 8)}` });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('starts at the column default, which is the state everyone was stuck in', async () => {
    const { rows } = await db.query('SELECT org_role FROM users WHERE id = $1', [target.id]);
    assert.equal(rows[0].org_role, 'viewer', 'the default that no code path could ever change');
  });

  it('an admin promotes a user to editor and it reaches the database', async () => {
    const res = await supertest(app)
      .put(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ org_role: 'editor' })
      .expect(200);

    assert.equal(res.body.data.org_role, 'editor', 'the response reports the new org role');

    const { rows } = await db.query('SELECT org_role FROM users WHERE id = $1', [target.id]);
    assert.equal(rows[0].org_role, 'editor', 'and it is really persisted');
  });

  it('the promoted role reaches the JWT, which is what the gates actually read', async () => {
    // The gates never touch the database — they read `req.user.org_role`, which comes
    // from the token. Persisting the column without it reaching the claim would look
    // fixed and change nothing.
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: target.username, password: target.password })
      .expect(200);

    const claims = jwt.decode(login.body.data.accessToken);
    assert.equal(claims.org_role, 'editor', 'the token carries the promoted org role');
  });

  it('rejects an org_role outside the CHECK constraint', async () => {
    const res = await supertest(app)
      .put(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ org_role: 'superuser' });
    assert.ok(res.status >= 400, `expected a refusal, got ${res.status}`);

    const { rows } = await db.query('SELECT org_role FROM users WHERE id = $1', [target.id]);
    assert.equal(rows[0].org_role, 'editor', 'the previous value survives a rejected write');
  });

  it('an omitted org_role leaves the current value alone', async () => {
    await supertest(app)
      .put(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ nome: 'Nome Alterado' })
      .expect(200);

    const { rows } = await db.query('SELECT org_role, nome FROM users WHERE id = $1', [target.id]);
    assert.equal(rows[0].org_role, 'editor', 'COALESCE must not reset it on unrelated edits');
    assert.equal(rows[0].nome, 'Nome Alterado');
  });

  it('a non-admin cannot promote anyone', async () => {
    const plain = await createUser(db, { username: `plain_${randomUUID().slice(0, 8)}` });
    const plainTok = await loginUser(app, plain.username, plain.password);

    await supertest(app)
      .put(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${plainTok}`)
      .send({ org_role: 'owner' })
      .expect(403);

    const { rows } = await db.query('SELECT org_role FROM users WHERE id = $1', [target.id]);
    assert.equal(rows[0].org_role, 'editor', 'unchanged by the refused request');
  });

  it('an admin can create a user with an org_role directly', async () => {
    const username = `mk_${randomUUID().slice(0, 8)}`;
    const res = await supertest(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ username, password: 'Test@1234', nome: 'Novo', org_role: 'owner' })
      .expect(201);

    assert.equal(res.body.data.org_role, 'owner');

    const { rows } = await db.query('SELECT org_role FROM users WHERE username = $1', [username]);
    assert.equal(rows[0].org_role, 'owner');
  });

  it('creation without org_role still defaults to viewer', async () => {
    const username = `mkdef_${randomUUID().slice(0, 8)}`;
    await supertest(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ username, password: 'Test@1234', nome: 'Padrão' })
      .expect(201);

    const { rows } = await db.query('SELECT org_role FROM users WHERE username = $1', [username]);
    assert.equal(rows[0].org_role, 'viewer', 'the safe default is unchanged');
  });
});

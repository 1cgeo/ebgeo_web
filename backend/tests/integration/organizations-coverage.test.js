// Path: tests/integration/organizations-coverage.test.js
// Coverage tests for the Organizations subsystem. Existing suites cover admin
// CRUD, slug conflict/validation, audit, and org deactivation barring members.
// Genuinely untested here:
//  - GET /organizations/:id read scoping: a NON-admin authenticated user CAN
//    read a single org (route is auth-only, not requireAdmin) and gets 404 for
//    a nonexistent id.
//  - NEGATIVE write access: a non-admin user cannot UPDATE or DELETE an org
//    (403) and the org is not mutated.
//  - PUT validation (422) on a bad body shape.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

const uniq = () => `orgc_${randomUUID().slice(0, 8)}`;
const slug = () => `orgc-${randomUUID().slice(0, 8)}`;

describe('Organizations — coverage', () => {
  let app, db, adminToken, userToken, org;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: uniq() });
    const user = await createUser(db, { username: uniq() });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, user.username, user.password);

    const created = await supertest(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: `Cov Org ${uniq()}`, slug: slug(), sigla: 'COV' })
      .expect(201);
    org = created.body.data;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ===========================================================================
  // GET /organizations/:id — read scoping
  // ===========================================================================
  describe('GET /organizations/:id', () => {
    it('a non-admin authenticated user CAN read a single organization (200)', async () => {
      const res = await supertest(app)
        .get(`/api/v1/organizations/${org.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      assert.equal(res.body.data.id, org.id);
      assert.equal(res.body.data.sigla, 'COV');
    });

    it('returns 404 for a well-formed but nonexistent org id', async () => {
      await supertest(app)
        .get(`/api/v1/organizations/${randomUUID()}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(404);
    });

    it('NEGATIVE: anonymous request -> 401', async () => {
      await supertest(app)
        .get(`/api/v1/organizations/${org.id}`)
        .expect(401);
    });
  });

  // ===========================================================================
  // NEGATIVE write access — admin-only routes
  // ===========================================================================
  describe('non-admin write access is denied', () => {
    it('NEGATIVE: non-admin PUT /organizations/:id -> 403 and the org is NOT mutated', async () => {
      const before = (await db.query('SELECT nome, sigla FROM organizations WHERE id = $1', [org.id])).rows[0];

      await supertest(app)
        .put(`/api/v1/organizations/${org.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ nome: 'Hacked Org', sigla: 'HAX' })
        .expect(403);

      const after = (await db.query('SELECT nome, sigla FROM organizations WHERE id = $1', [org.id])).rows[0];
      assert.deepEqual(after, before, 'non-admin PUT must not mutate the organization');
    });

    it('NEGATIVE: non-admin DELETE /organizations/:id -> 403 and is_active stays true', async () => {
      await supertest(app)
        .delete(`/api/v1/organizations/${org.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      const active = (await db.query('SELECT is_active FROM organizations WHERE id = $1', [org.id])).rows[0].is_active;
      assert.equal(active, true, 'non-admin DELETE must not deactivate the org');
    });
  });

  // ===========================================================================
  // PUT validation (422)
  // ===========================================================================
  describe('PUT validation', () => {
    it('rejects a non-boolean is_active (422), org unchanged', async () => {
      const before = (await db.query('SELECT nome, is_active FROM organizations WHERE id = $1', [org.id])).rows[0];

      // Joi boolean does not coerce an arbitrary string -> validation error.
      await supertest(app)
        .put(`/api/v1/organizations/${org.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: 'definitely-not-a-bool' })
        .expect(422);

      const after = (await db.query('SELECT nome, is_active FROM organizations WHERE id = $1', [org.id])).rows[0];
      assert.deepEqual(after, before);
    });

    it('rejects nome exceeding the 255-char max (422)', async () => {
      const before = (await db.query('SELECT nome FROM organizations WHERE id = $1', [org.id])).rows[0].nome;

      await supertest(app)
        .put(`/api/v1/organizations/${org.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nome: 'x'.repeat(256) })
        .expect(422);

      const after = (await db.query('SELECT nome FROM organizations WHERE id = $1', [org.id])).rows[0].nome;
      assert.equal(after, before, 'over-length nome must not be persisted');
    });
  });
});

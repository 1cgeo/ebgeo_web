// Path: tests/integration/organizations.test.js
// Fase 5: organizations CRUD (admin) + audit of ORG_* actions + audit query.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('Organizations + audit', () => {
  let app, db, adminToken, userToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: 'org_admin' });
    const user = await createUser(db, { username: 'org_user' });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('lists organizations including the seeded default', async () => {
    const res = await supertest(app)
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.ok(res.body.data.some((o) => o.slug === 'default'));
  });

  it('admin creates an org (audited); user is forbidden', async () => {
    const create = await supertest(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: '1º CGEO', slug: '1cgeo', sigla: '1CGEO' })
      .expect(201);
    assert.equal(create.body.data.slug, '1cgeo');

    await supertest(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ nome: 'X', slug: 'x-org' })
      .expect(403);

    // The create was audited.
    const audit = await supertest(app)
      .get('/api/v1/audit')
      .query({ action: 'ORG_CREATE' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.ok(audit.body.data.total >= 1);
    assert.ok(audit.body.data.data.some((a) => a.target_name === '1º CGEO'));
  });

  it('rejects duplicate slug (409) and invalid slug (422)', async () => {
    await supertest(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'dup', slug: 'default' })
      .expect(409);

    await supertest(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'bad', slug: 'Has Spaces!' })
      .expect(422);
  });

  it('admin updates and deactivates an org', async () => {
    const created = await supertest(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: 'To Edit', slug: 'to-edit' })
      .expect(201);
    const id = created.body.data.id;

    const updated = await supertest(app)
      .put(`/api/v1/organizations/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sigla: 'EDIT' })
      .expect(200);
    assert.equal(updated.body.data.sigla, 'EDIT');

    await supertest(app)
      .delete(`/api/v1/organizations/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const after = await supertest(app)
      .get(`/api/v1/organizations/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.equal(after.body.data.is_active, false);
  });

  it('audit query is admin-only', async () => {
    await supertest(app)
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });
});

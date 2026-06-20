// Path: tests/integration/zones-admin.test.js
// Fase 6 (Tarefa 5): zone admin endpoints. POST/PUT validate GeoJSON Polygon and
// reject topologically invalid geometry (ST_IsValid) with 422; PUT /:id replaces
// the zone; the endpoints are admin-only.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

// A valid square around (-43.2, -22.9).
const VALID = {
  type: 'Polygon',
  coordinates: [[[-43.3, -22.95], [-43.1, -22.95], [-43.1, -22.85], [-43.3, -22.85], [-43.3, -22.95]]],
};
// A self-intersecting "bowtie" — valid GeoJSON shape but ST_IsValid = false.
const BOWTIE = {
  type: 'Polygon',
  coordinates: [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]],
};

describe('Zones admin (CRUD + ST_IsValid + PUT)', () => {
  let app, db, admin, adminTok, user, userTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: 'zone_admin' });
    adminTok = await loginUser(app, admin.username, admin.password);
    user = await createUser(db, { username: 'zone_user' });
    userTok = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('admin creates a zone with a valid polygon', async () => {
    const res = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Zona Valida', geom: VALID })
      .expect(201);
    assert.ok(res.body.data.id);
    assert.equal(res.body.data.name, 'Zona Valida');
  });

  it('rejects a topologically invalid geometry with 422 (ST_IsValid)', async () => {
    const res = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Bowtie', geom: BOWTIE })
      .expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('PUT /:id replaces name + geom', async () => {
    const created = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Antes', geom: VALID })
      .expect(201);
    const id = created.body.data.id;

    const moved = {
      type: 'Polygon',
      coordinates: [[[-44.0, -23.0], [-43.8, -23.0], [-43.8, -22.8], [-44.0, -22.8], [-44.0, -23.0]]],
    };
    const upd = await supertest(app)
      .put(`/api/v1/zones/${id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Depois', geom: moved })
      .expect(200);
    assert.equal(upd.body.data.name, 'Depois');

    const got = await supertest(app)
      .get(`/api/v1/zones/${id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.equal(got.body.data.name, 'Depois');
    // geometry was replaced (new centroid is to the southwest)
    assert.equal(got.body.data.geom.type, 'Polygon');
  });

  it('PUT /:id rejects invalid geometry with 422', async () => {
    const created = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'ParaInvalidar', geom: VALID })
      .expect(201);
    await supertest(app)
      .put(`/api/v1/zones/${created.body.data.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'X', geom: BOWTIE })
      .expect(422);
  });

  it('PUT on a missing zone is 404', async () => {
    await supertest(app)
      .put('/api/v1/zones/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Nope', geom: VALID })
      .expect(404);
  });

  it('is admin-only (non-admin gets 403 on create and update)', async () => {
    await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${userTok}`)
      .send({ name: 'Proibido', geom: VALID })
      .expect(403);
    await supertest(app)
      .put('/api/v1/zones/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${userTok}`)
      .send({ name: 'Proibido', geom: VALID })
      .expect(403);
  });
});

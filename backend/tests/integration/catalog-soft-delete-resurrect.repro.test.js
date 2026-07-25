// Path: tests/integration/catalog-soft-delete-resurrect.repro.test.js
// Regression (achado 40): a soft-deleted catalog item was permanently unusable. The three
// paths disagreed about what "exists" means:
//   - getCatalogItem / updateCatalogItem filter `active = true`  → 404 on a deleted item
//   - createCatalogItem's duplicate probe did NOT filter `active` → 409 on the same id
// and no restore route exists in the module. So DELETE /basemaps/osm took the seeded basemap
// off the air for everyone and only a manual SQL UPDATE could bring it back — the opposite of
// what soft-delete is for. catalog.test.js recorded the symptom as a fact of life ("a
// soft-deleted id can never be recreated (permanent 409), so every test must mint its own id").
//
// Contract chosen: CREATE resurrects. Re-creating a soft-deleted id succeeds (201) and
// overwrites the row with the new payload, so the item comes back in the listing and in
// /api/config. A LIVE id still conflicts (409) — that guard is what stops silent overwrites.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';

const cid = (p) => `cat40-${p}-${randomUUID().slice(0, 8)}`;

describe('achado-40 · soft-deleted catalog item can be recreated', () => {
  let app, db, adminToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `cat40_admin_${randomUUID().slice(0, 8)}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const post = (body) =>
    supertest(app).post('/api/v1/basemaps').set('Authorization', `Bearer ${adminToken}`).send(body);
  const del = (id) =>
    supertest(app).delete(`/api/v1/basemaps/${id}`).set('Authorization', `Bearer ${adminToken}`);
  const get = (id) =>
    supertest(app).get(`/api/v1/basemaps/${id}`).set('Authorization', `Bearer ${adminToken}`);
  const list = () =>
    supertest(app).get('/api/v1/basemaps').set('Authorization', `Bearer ${adminToken}`);

  it('delete → recreate brings the item back with the NEW payload', async () => {
    const id = cid('resurrect');

    await post({ id, name: 'Original', description: 'v1', config: { url: 'https://a/{z}/{x}/{y}.png' }, sort_order: 1 })
      .expect(201);
    await del(id).expect(204);
    await get(id).expect(404);

    const res = await post({
      id,
      name: 'Ressuscitado',
      description: 'v2',
      config: { url: 'https://b/{z}/{x}/{y}.png' },
      sort_order: 7,
    }).expect(201);

    assert.equal(res.body.data.id, id);
    assert.equal(res.body.data.name, 'Ressuscitado', 'the new payload wins');
    assert.equal(res.body.data.description, 'v2');
    assert.equal(res.body.data.config.url, 'https://b/{z}/{x}/{y}.png');
    assert.equal(res.body.data.sort_order, 7);
    assert.equal(res.body.data.active, true, 'the row is active again');

    // Back on the air for every reader.
    await get(id).expect(200);
    const ids = (await list().expect(200)).body.data.map((r) => r.id);
    assert.ok(ids.includes(id), 'the resurrected item reappears in the listing');

    // Exactly one row — resurrection updates, never duplicates.
    const { rows } = await db.query('SELECT id, active FROM basemaps WHERE id = $1', [id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].active, true);
  });

  it('a resurrected item is editable again (the 404 on update is lifted)', async () => {
    const id = cid('editable');
    await post({ id, name: 'A', config: { url: 'https://a/{z}/{x}/{y}.png' } }).expect(201);
    await del(id).expect(204);
    await post({ id, name: 'B', config: { url: 'https://b/{z}/{x}/{y}.png' } }).expect(201);

    const res = await supertest(app)
      .put(`/api/v1/basemaps/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'C' })
      .expect(200);
    assert.equal(res.body.data.name, 'C');
  });

  it('a LIVE id still conflicts with 409 (the duplicate guard is not weakened)', async () => {
    const id = cid('live');
    await post({ id, name: 'Live', config: { url: 'https://a/{z}/{x}/{y}.png' } }).expect(201);

    const res = await post({ id, name: 'Other', config: { url: 'https://b/{z}/{x}/{y}.png' } }).expect(409);
    assert.match(res.body.error?.message || '', /já existe/i);

    // The live row is untouched by the rejected create.
    const after = await get(id).expect(200);
    assert.equal(after.body.data.name, 'Live');
  });

  it('an invalid MapLibre style is still rejected when resurrecting', async () => {
    const id = cid('badstyle');
    await post({ id, name: 'A', config: { url: 'https://a/{z}/{x}/{y}.png' } }).expect(201);
    await del(id).expect(204);

    await post({ id, name: 'A', config: { style: { version: 8 } } }).expect(400);

    // Still deleted — a rejected resurrection must not half-apply.
    await get(id).expect(404);
  });
});

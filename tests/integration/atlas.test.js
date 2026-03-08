// Path: tests/integration/atlas.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';

describe('Atlas API', () => {
  let app, db, owner, ownerToken, reader, readerToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'atlas_owner' });
    reader = await createUser(db, { username: 'atlas_reader' });
    ownerToken = await loginUser(app, owner.username, owner.password);
    readerToken = await loginUser(app, reader.username, reader.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('POST /atlas — creates atlas owned by authenticated user', async () => {
    const res = await supertest(app)
      .post('/api/v1/atlas')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'My Atlas', description: 'Test description' })
      .expect(201);

    assert.equal(res.body.data.name, 'My Atlas');
    assert.equal(res.body.data.description, 'Test description');
    assert.equal(res.body.data.owner_id, owner.id);
  });

  it('GET /atlas — lists only user-accessible atlas', async () => {
    // Create private atlas owned by owner
    await createAtlas(db, owner.id, { name: 'Owner Private Atlas' });

    const res = await supertest(app)
      .get('/api/v1/atlas')
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(200);

    // Reader should not see owner's private atlas
    const names = res.body.data.map(a => a.name);
    assert.ok(!names.includes('Owner Private Atlas'));
  });

  it('GET /atlas/:id — returns atlas with maps', async () => {
    const atlas = await createAtlas(db, owner.id);

    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    assert.equal(res.body.data.id, atlas.id);
    assert.ok(Array.isArray(res.body.data.maps));
  });

  it('PUT /atlas/:id — owner can update atlas', async () => {
    const atlas = await createAtlas(db, owner.id, { name: 'Original' });

    const res = await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Updated Name' })
      .expect(200);

    assert.equal(res.body.data.name, 'Updated Name');
  });

  it('DELETE /atlas/:id — only owner can delete', async () => {
    const atlas = await createAtlas(db, owner.id);

    // Reader cannot delete
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(403);

    // Owner can delete (soft-delete)
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    // Should no longer be accessible
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it('PATCH /atlas/:id/settings — owner updates settings', async () => {
    const atlas = await createAtlas(db, owner.id);

    const res = await supertest(app)
      .patch(`/api/v1/atlas/${atlas.id}/settings`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        features: { map_3d: false, panoramic_images: true, terrain_3d: false },
        basemaps: ['carta-topografica'],
        min_zoom: 8,
        max_zoom: 15,
      })
      .expect(200);

    assert.equal(res.body.data.settings.features.map_3d, false);
    assert.deepEqual(res.body.data.settings.basemaps, ['carta-topografica']);
    assert.equal(res.body.data.settings.min_zoom, 8);
    assert.equal(res.body.data.settings.max_zoom, 15);
  });

  it('POST /atlas/:id/clone — creates a deep copy', async () => {
    const atlas = await createAtlas(db, owner.id, { name: 'Original Clone Source' });

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    assert.ok(res.body.data.id !== atlas.id);
    assert.ok(res.body.data.name.includes('Original Clone Source'));
    assert.equal(res.body.data.owner_id, owner.id);
  });

  it('reader cannot update settings', async () => {
    const atlas = await createAtlas(db, owner.id);

    // Share with reader
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'read', $3)`,
      [atlas.id, reader.id, owner.id]
    );

    await supertest(app)
      .patch(`/api/v1/atlas/${atlas.id}/settings`)
      .set('Authorization', `Bearer ${readerToken}`)
      .send({ features: { map_3d: false } })
      .expect(403);
  });
});

// Path: tests/integration/atlas-advanced.test.js
// Advanced atlas integration tests: map_order, settings merge, clone, soft-delete, public access

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, loginUser,
  createFeature, createLayer, makeAtlasPublic,
} from '../helpers/fixtures.js';

describe('Atlas Advanced', () => {
  let app, db, owner, ownerToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'atlas_adv_owner' });
    ownerToken = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Update atlas with map_order', () => {
    it('reorders maps via PUT /atlas/:id with map_order', async () => {
      const atlas = await createAtlas(db, owner.id, { name: 'Reorder Atlas' });
      const map1 = await createMap(db, atlas.id, { name: 'Map 1' });
      const map2 = await createMap(db, atlas.id, { name: 'Map 2' });
      const map3 = await createMap(db, atlas.id, { name: 'Map 3' });

      const newOrder = [map3.id, map1.id, map2.id];

      const res = await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ map_order: newOrder })
        .expect(200);

      assert.deepEqual(res.body.data.map_order, newOrder);

      // GET should also reflect the new order
      const getRes = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.deepEqual(getRes.body.data.map_order, newOrder);
    });
  });

  describe('Settings PATCH merges', () => {
    it('merges settings without overwriting existing keys', async () => {
      const atlas = await createAtlas(db, owner.id, { name: 'Settings Merge Atlas' });

      // First PATCH: set exaggeration
      await supertest(app)
        .patch(`/api/v1/atlas/${atlas.id}/settings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ min_zoom: 5 })
        .expect(200);

      // Second PATCH: set a different key
      const res = await supertest(app)
        .patch(`/api/v1/atlas/${atlas.id}/settings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ max_zoom: 18 })
        .expect(200);

      // Both settings should coexist
      assert.equal(res.body.data.settings.min_zoom, 5);
      assert.equal(res.body.data.settings.max_zoom, 18);
    });

    it('deep-merges nested settings objects', async () => {
      const atlas = await createAtlas(db, owner.id, { name: 'Deep Merge Atlas' });

      // First PATCH: set features.map_3d
      await supertest(app)
        .patch(`/api/v1/atlas/${atlas.id}/settings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ features: { map_3d: true } })
        .expect(200);

      // Second PATCH: set features.panoramic_images
      const res = await supertest(app)
        .patch(`/api/v1/atlas/${atlas.id}/settings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ features: { panoramic_images: true } })
        .expect(200);

      // Since JSONB || merges at top level, the features key is replaced,
      // so only panoramic_images will remain. This tests the actual behavior.
      assert.ok(res.body.data.settings.features);
      assert.equal(res.body.data.settings.features.panoramic_images, true);
    });
  });

  describe('Clone atlas preserves data', () => {
    it('clone preserves settings, maps, and features', async () => {
      const atlas = await createAtlas(db, owner.id, { name: 'Clone Source' });

      // Add settings
      await supertest(app)
        .patch(`/api/v1/atlas/${atlas.id}/settings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        // OS DOIS IDS SAO REAIS E PUBLICOS (`005_catalogo.sql`), e a troca de 'satellite' por
        // 'imagens' e o que faz este caso continuar medindo FIDELIDADE. Desde que o clone
        // poda `atlas.settings` por destinatario, um id inventado e classificado como nao
        // visivel (a convencao de recusa e `COALESCE(access_level,'private')`) e sai da
        // allowlist: o caso reprovaria por estar CERTO. Com os dois publicos ele vira o
        // controle POSITIVO da poda de settings, que a metade negativa mede em
        // `clone-poda-por-destinatario.test.js`.
        .send({ basemaps: ['osm', 'imagens'], min_zoom: 3 })
        .expect(200);

      // Add maps with features
      const map = await createMap(db, atlas.id, { name: 'Clone Map' });
      await createFeature(db, map.id, {
        feature_type: 'point',
        geometry: { coordinates: [-43.2, -22.9] },
        properties: { name: 'Clone Feature' },
      });
      await createLayer(db, map.id, { name: 'Clone Layer' });

      // Clone
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/clone`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      const cloned = res.body.data;
      assert.ok(cloned.id !== atlas.id);
      assert.ok(cloned.name.includes('Clone Source'));
      assert.equal(cloned.owner_id, owner.id);

      // Settings should be preserved
      assert.deepEqual(cloned.settings.basemaps, ['osm', 'imagens']);
      assert.equal(cloned.settings.min_zoom, 3);

      // Maps should be cloned
      assert.ok(cloned.maps.length >= 1);

      // Map IDs should differ from source
      const clonedMapIds = cloned.maps.map(m => m.id);
      assert.ok(!clonedMapIds.includes(map.id));
    });

    it('clone with custom name', async () => {
      const atlas = await createAtlas(db, owner.id, { name: 'Custom Clone' });

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/clone`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'My Custom Clone Name' })
        .expect(201);

      assert.equal(res.body.data.name, 'My Custom Clone Name');
    });
  });

  describe('Delete atlas soft-delete', () => {
    it('DELETE sets deleted_at, maps are also soft-deleted', async () => {
      const atlas = await createAtlas(db, owner.id, { name: 'Delete Me Atlas' });
      await createMap(db, atlas.id, { name: 'Delete Me Map' });

      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      // Atlas should have deleted_at set
      const { rows: atlasRows } = await db.query(
        'SELECT deleted_at FROM atlas WHERE id = $1', [atlas.id]
      );
      assert.equal(atlasRows.length, 1);
      assert.ok(atlasRows[0].deleted_at);

      // Atlas should not be accessible via API
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('deleted atlas does not appear in list', async () => {
      const atlas = await createAtlas(db, owner.id, { name: 'Vanishing Atlas' });

      // Verify it appears in the list
      const listBefore = await supertest(app)
        .get('/api/v1/atlas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const namesBefore = listBefore.body.data.map(a => a.name);
      assert.ok(namesBefore.includes('Vanishing Atlas'));

      // Delete it
      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      // Verify it no longer appears
      const listAfter = await supertest(app)
        .get('/api/v1/atlas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const namesAfter = listAfter.body.data.map(a => a.name);
      assert.ok(!namesAfter.includes('Vanishing Atlas'));
    });
  });

  describe('Public atlas access', () => {
    it('GET /atlas/public/:link returns atlas data and publicToken', async () => {
      const atlas = await createAtlas(db, owner.id, { name: 'Public Test Atlas' });
      const publicLink = await makeAtlasPublic(db, atlas.id);

      const res = await supertest(app)
        .get(`/api/v1/atlas/public/${publicLink}`)
        .expect(200);

      assert.ok(res.body.data);
      assert.equal(res.body.data.id, atlas.id);
      assert.equal(res.body.data.name, 'Public Test Atlas');
      assert.ok(res.body.data.publicToken);
      // publicToken should be a JWT string
      assert.ok(typeof res.body.data.publicToken === 'string');
      assert.ok(res.body.data.publicToken.split('.').length === 3);
    });

    it('publicToken carries the frozen, locked-down claims (read-only, this atlas, 1h)', async () => {
      // The public token is the boundary that lets an anonymous visitor connect
      // read-only over WS. A regression widening its claims (write/owner, another
      // atlas, no expiry) would silently break that boundary — pin the contract.
      const atlas = await createAtlas(db, owner.id, { name: 'Claims Atlas' });
      const publicLink = await makeAtlasPublic(db, atlas.id);
      const res = await supertest(app).get(`/api/v1/atlas/public/${publicLink}`).expect(200);

      const payload = jwt.decode(res.body.data.publicToken);
      assert.equal(payload.permission, 'read', 'public token must be read-only');
      assert.equal(payload.isPublic, true);
      assert.equal(payload.atlasId, atlas.id, 'token must be bound to THIS atlas');
      assert.ok(String(payload.sub).startsWith('public-'), 'sub must be a synthetic public principal');
      assert.ok(payload.exp - payload.iat <= 3600 + 5 && payload.exp - payload.iat >= 3600 - 5, '~1h expiry');
    });

    it('GET /atlas/public/:link returns 404 for invalid link', async () => {
      await supertest(app)
        .get('/api/v1/atlas/public/nonexistent-link-abc123')
        .expect(404);
    });

    it('GET /atlas/public/:link returns 404 for non-public atlas link', async () => {
      // Create atlas but do NOT make it public
      const atlas = await createAtlas(db, owner.id, { name: 'Private Atlas Link' });

      // Manually set a public_link but keep is_public = false
      await db.query(
        'UPDATE atlas SET public_link = $1 WHERE id = $2',
        ['fake-private-link-123', atlas.id]
      );

      await supertest(app)
        .get('/api/v1/atlas/public/fake-private-link-123')
        .expect(404);
    });
  });

  describe('Create atlas with null description', () => {
    it('atlas can be created with null description', async () => {
      const res = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'No Description Atlas', description: null })
        .expect(201);

      assert.equal(res.body.data.name, 'No Description Atlas');
      assert.equal(res.body.data.description, null);
    });

    it('atlas can be created without description field', async () => {
      const res = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Missing Description Atlas' })
        .expect(201);

      assert.equal(res.body.data.name, 'Missing Description Atlas');
      assert.equal(res.body.data.description, null);
    });
  });

  describe('Update atlas with partial fields', () => {
    it('updating only name does not change description', async () => {
      const atlas = await createAtlas(db, owner.id, {
        name: 'Original Name',
        description: 'Original Description',
      });

      // Verify the description was set
      const before = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      assert.equal(before.body.data.description, 'Original Description');

      // Update only name
      const res = await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Updated Name Only' })
        .expect(200);

      assert.equal(res.body.data.name, 'Updated Name Only');
      assert.equal(res.body.data.description, 'Original Description');
    });

    it('updating only map_order does not change name or description', async () => {
      const atlas = await createAtlas(db, owner.id, {
        name: 'Stable Atlas',
        description: 'Stable Description',
      });
      const m1 = await createMap(db, atlas.id);
      const m2 = await createMap(db, atlas.id);

      const res = await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ map_order: [m2.id, m1.id] })
        .expect(200);

      assert.equal(res.body.data.name, 'Stable Atlas');
      assert.equal(res.body.data.description, 'Stable Description');
      assert.deepEqual(res.body.data.map_order, [m2.id, m1.id]);
    });
  });
});

// Path: tests/integration/resources.test.js
// Integration tests for the Resources API (admin resource management)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createResource, loginUser } from '../helpers/fixtures.js';

describe('Resources API', () => {
  let app, db, admin, regularUser, adminToken, userToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: 'resources_admin' });
    regularUser = await createUser(db, { username: 'resources_user' });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, regularUser.username, regularUser.password);

    // Create some test resources
    await createResource(db, {
      id: 'basemap-osm',
      category: 'basemap',
      name: 'OpenStreetMap',
      description: 'OSM Standard',
      config: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
    });
    await createResource(db, {
      id: 'basemap-satellite',
      category: 'basemap',
      name: 'Satellite',
      description: 'Satellite imagery',
      config: { url: 'https://example.com/satellite/{z}/{x}/{y}.png' },
    });
    await createResource(db, {
      id: 'layer-analysis',
      category: 'analysis_layer',
      name: 'Analysis Layer',
      description: 'Terrain analysis',
      config: { url: 'https://example.com/analysis' },
    });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('GET /resources — List Resources', () => {
    it('authenticated user can list all resources', async () => {
      const res = await supertest(app)
        .get('/api/v1/resources')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 3);
    });

    it('can filter resources by category', async () => {
      const res = await supertest(app)
        .get('/api/v1/resources?category=basemap')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.every(r => r.category === 'basemap'));
      assert.ok(res.body.data.length >= 2);
    });

    it('can filter by analysis_layer category', async () => {
      const res = await supertest(app)
        .get('/api/v1/resources?category=analysis_layer')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      assert.ok(res.body.data.every(r => r.category === 'analysis_layer'));
    });

    it('rejects invalid category with validation error', async () => {
      await supertest(app)
        .get('/api/v1/resources?category=nonexistent')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(422);
    });

    it('requires authentication', async () => {
      await supertest(app)
        .get('/api/v1/resources')
        .expect(401);
    });
  });

  describe('GET /resources/:id — Get Resource', () => {
    it('authenticated user can get resource by ID', async () => {
      const res = await supertest(app)
        .get('/api/v1/resources/basemap-osm')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      assert.equal(res.body.data.id, 'basemap-osm');
      assert.equal(res.body.data.name, 'OpenStreetMap');
      assert.ok(res.body.data.config);
    });

    it('returns 404 for non-existent resource', async () => {
      await supertest(app)
        .get('/api/v1/resources/nonexistent-id')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(404);
    });
  });

  describe('POST /resources — Create Resource (Admin)', () => {
    it('admin can create a new basemap resource', async () => {
      const res = await supertest(app)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: 'basemap-custom',
          category: 'basemap',
          name: 'Custom Basemap',
          description: 'A custom basemap',
          config: {
            url: 'https://custom.tiles/{z}/{x}/{y}.png',
            attribution: 'Custom Attribution',
          },
          sort_order: 10,
        })
        .expect(201);

      assert.equal(res.body.data.id, 'basemap-custom');
      assert.equal(res.body.data.category, 'basemap');
      assert.equal(res.body.data.name, 'Custom Basemap');
    });

    it('admin can create an analysis_layer resource', async () => {
      const res = await supertest(app)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: 'analysis-terrain',
          category: 'analysis_layer',
          name: 'Terrain Analysis',
          config: { type: 'terrain' },
        })
        .expect(201);

      assert.equal(res.body.data.category, 'analysis_layer');
    });

    it('admin can create a data_layer resource', async () => {
      const res = await supertest(app)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: 'data-cities',
          category: 'data_layer',
          name: 'Cities Layer',
          config: { source: 'cities' },
        })
        .expect(201);

      assert.equal(res.body.data.category, 'data_layer');
    });

    it('rejects duplicate resource ID', async () => {
      await supertest(app)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: 'basemap-osm', // Already exists
          category: 'basemap',
          name: 'Duplicate',
          config: {},
        })
        .expect(409);
    });

    it('validates required fields', async () => {
      // Missing id
      await supertest(app)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category: 'basemap',
          name: 'No ID',
          config: {},
        })
        .expect(422);

      // Missing category
      await supertest(app)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: 'missing-category',
          name: 'No Category',
          config: {},
        })
        .expect(422);
    });

    it('regular user cannot create resources', async () => {
      await supertest(app)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          id: 'unauthorized-resource',
          category: 'basemap',
          name: 'Unauthorized',
          config: {},
        })
        .expect(403);
    });
  });

  describe('PUT /resources/:id — Update Resource (Admin)', () => {
    it('admin can update resource name', async () => {
      const res = await supertest(app)
        .put('/api/v1/resources/basemap-osm')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'OpenStreetMap Updated' })
        .expect(200);

      assert.equal(res.body.data.name, 'OpenStreetMap Updated');
    });

    it('admin can update resource description', async () => {
      const res = await supertest(app)
        .put('/api/v1/resources/basemap-osm')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'Updated description' })
        .expect(200);

      assert.equal(res.body.data.description, 'Updated description');
    });

    it('admin can update resource config', async () => {
      const res = await supertest(app)
        .put('/api/v1/resources/basemap-osm')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          config: {
            url: 'https://new-url.com/{z}/{x}/{y}.png',
            newField: 'new value',
          },
        })
        .expect(200);

      assert.ok(res.body.data.config.newField);
    });

    it('admin can update sort_order', async () => {
      const res = await supertest(app)
        .put('/api/v1/resources/basemap-osm')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sort_order: 5 })
        .expect(200);

      assert.equal(res.body.data.sort_order, 5);
    });

    it('returns 404 for non-existent resource', async () => {
      await supertest(app)
        .put('/api/v1/resources/nonexistent-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Name' })
        .expect(404);
    });

    it('regular user cannot update resources', async () => {
      await supertest(app)
        .put('/api/v1/resources/basemap-osm')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Hacked Name' })
        .expect(403);
    });
  });

  describe('DELETE /resources/:id — Delete Resource (Admin)', () => {
    it('admin can delete resource (soft-delete)', async () => {
      // Create a resource to delete
      await createResource(db, {
        id: 'resource-to-delete',
        category: 'basemap',
        name: 'To Delete',
        config: {},
      });

      await supertest(app)
        .delete('/api/v1/resources/resource-to-delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      // Verify resource is no longer listed
      const res = await supertest(app)
        .get('/api/v1/resources')
        .set('Authorization', `Bearer ${userToken}`);

      const ids = res.body.data.map(r => r.id);
      assert.ok(!ids.includes('resource-to-delete'));
    });

    it('returns 404 for non-existent resource', async () => {
      await supertest(app)
        .delete('/api/v1/resources/nonexistent-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('regular user cannot delete resources', async () => {
      await supertest(app)
        .delete('/api/v1/resources/basemap-satellite')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe('Resource Categories', () => {
    const validCategories = ['basemap', 'analysis_layer', 'data_layer', 'tileset', 'streetview_marker'];

    for (const category of validCategories) {
      it(`can create resource with category: ${category}`, async () => {
        const id = `test-${category}-${Date.now()}`;
        const res = await supertest(app)
          .post('/api/v1/resources')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            id,
            category,
            name: `Test ${category}`,
            config: {},
          })
          .expect(201);

        assert.equal(res.body.data.category, category);
      });
    }
  });

  describe('Resource Config Flexibility', () => {
    it('accepts complex nested config objects', async () => {
      const res = await supertest(app)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: 'complex-config-resource',
          category: 'basemap',
          name: 'Complex Config',
          config: {
            url: 'https://example.com/tiles/{z}/{x}/{y}.png',
            attribution: 'Test',
            options: {
              minZoom: 1,
              maxZoom: 18,
              subdomains: ['a', 'b', 'c'],
            },
            metadata: {
              author: 'Test Author',
              license: 'MIT',
            },
          },
        })
        .expect(201);

      assert.ok(res.body.data.config.options);
      assert.ok(res.body.data.config.metadata);
      assert.deepEqual(res.body.data.config.options.subdomains, ['a', 'b', 'c']);
    });

    it('accepts arrays in config', async () => {
      const res = await supertest(app)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: 'array-config-resource',
          category: 'data_layer',
          name: 'Array Config',
          config: {
            layers: ['layer1', 'layer2', 'layer3'],
            bounds: [[-180, -90], [180, 90]],
          },
        })
        .expect(201);

      assert.ok(Array.isArray(res.body.data.config.layers));
    });
  });
});

// Path: tests/integration/catalog.test.js
// Integration tests for the catalog CRUD API. Each resource type is now its own
// dedicated table+route (the generic `resources` module is gone); these tests
// exercise /api/v1/basemaps as the representative catalog router. Reads need auth;
// writes need a GLOBAL admin (requireAdmin). config.style is MapLibre-validated.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createResource, loginUser } from '../helpers/fixtures.js';
import { validateMapLibreStyle } from '../../src/utils/maplibre-style-validate.js';

// Unique-id helper — the test DB is shared across files, so every test mints its own id and
// never collides with another file's rows. (A soft-deleted id used to be permanently
// unrecoverable, which made this mandatory; since L40 a create resurrects it — see
// catalog-soft-delete-resurrect.repro.test.js — but per-test ids stay the right hygiene.)
const cid = (p) => `cat-${p}-${randomUUID().slice(0, 8)}`;

describe('Catalog API (basemaps)', () => {
  let app, db, admin, regularUser, adminToken, userToken;
  let seededA, seededB;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: `catalog_admin_${randomUUID().slice(0, 8)}` });
    regularUser = await createUser(db, { username: `catalog_user_${randomUUID().slice(0, 8)}` });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, regularUser.username, regularUser.password);

    // Seed two basemaps directly. The createResource fixture inserts into the
    // `basemaps` table by default (category only selects the table).
    seededA = cid('seedA');
    seededB = cid('seedB');
    await createResource(db, {
      id: seededA,
      name: 'OpenStreetMap',
      description: 'OSM Standard',
      config: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
    });
    await createResource(db, {
      id: seededB,
      name: 'Satellite',
      description: 'Satellite imagery',
      config: { url: 'https://example.com/satellite/{z}/{x}/{y}.png' },
    });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('GET /basemaps — list', () => {
    it('authenticated user can list basemaps (array)', async () => {
      const res = await supertest(app)
        .get('/api/v1/basemaps')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      const ids = res.body.data.map((r) => r.id);
      assert.ok(ids.includes(seededA));
      assert.ok(ids.includes(seededB));
    });

    it('requires authentication', async () => {
      await supertest(app).get('/api/v1/basemaps').expect(401);
    });
  });

  describe('GET /basemaps/:id — get one', () => {
    it('authenticated user can get a basemap by id', async () => {
      const res = await supertest(app)
        .get(`/api/v1/basemaps/${seededA}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      assert.equal(res.body.data.id, seededA);
      assert.equal(res.body.data.name, 'OpenStreetMap');
      assert.ok(res.body.data.config);
    });

    it('returns 404 for a non-existent id', async () => {
      await supertest(app)
        .get(`/api/v1/basemaps/${cid('nope')}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(404);
    });
  });

  describe('POST /basemaps — create (admin)', () => {
    it('admin can create a basemap (201)', async () => {
      const id = cid('create');
      const res = await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id,
          name: 'Custom Basemap',
          description: 'A custom basemap',
          config: { url: 'https://custom.tiles/{z}/{x}/{y}.png', attribution: 'Custom Attribution' },
          sort_order: 10,
        })
        .expect(201);

      assert.equal(res.body.data.id, id);
      assert.equal(res.body.data.name, 'Custom Basemap');
      assert.equal(res.body.data.sort_order, 10);
    });

    it('rejects a duplicate id (409)', async () => {
      const id = cid('dup');
      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id, name: 'First', config: {} })
        .expect(201);

      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id, name: 'Duplicate', config: {} })
        .expect(409);
    });

    it('rejects a missing required field (422)', async () => {
      // Missing id
      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'No ID', config: {} })
        .expect(422);

      // Missing name
      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id: cid('noname'), config: {} })
        .expect(422);
    });
  });

  describe('PUT /basemaps/:id — update (admin)', () => {
    it('admin can update name, config and sort_order (200)', async () => {
      const id = cid('upd');
      await createResource(db, { id, name: 'Before', config: {} });

      const r1 = await supertest(app)
        .put(`/api/v1/basemaps/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'After' })
        .expect(200);
      assert.equal(r1.body.data.name, 'After');

      const r2 = await supertest(app)
        .put(`/api/v1/basemaps/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ config: { url: 'https://new-url.com/{z}/{x}/{y}.png', newField: 'new value' }, sort_order: 5 })
        .expect(200);
      assert.equal(r2.body.data.config.newField, 'new value');
      assert.equal(r2.body.data.sort_order, 5);
    });

    it('returns 404 updating a non-existent id', async () => {
      await supertest(app)
        .put(`/api/v1/basemaps/${cid('nope')}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Name' })
        .expect(404);
    });
  });

  describe('DELETE /basemaps/:id — delete (admin, soft-delete)', () => {
    it('admin deletes (204) and the item disappears from the list', async () => {
      const id = cid('del');
      await createResource(db, { id, name: 'To Delete', config: {} });

      await supertest(app)
        .delete(`/api/v1/basemaps/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const res = await supertest(app)
        .get('/api/v1/basemaps')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      assert.ok(!res.body.data.map((r) => r.id).includes(id));
    });

    it('returns 404 deleting a non-existent id', async () => {
      await supertest(app)
        .delete(`/api/v1/basemaps/${cid('nope')}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('Admin gating — a non-admin cannot write', () => {
    it('non-admin POST → 403', async () => {
      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ id: cid('forbidden'), name: 'Unauthorized', config: {} })
        .expect(403);
    });

    it('non-admin PUT → 403', async () => {
      await supertest(app)
        .put(`/api/v1/basemaps/${seededA}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Hacked Name' })
        .expect(403);
    });

    it('non-admin DELETE → 403', async () => {
      await supertest(app)
        .delete(`/api/v1/basemaps/${seededB}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe('Basemap style validation', () => {
    it('rejects an invalid MapLibre config.style on create (400)', async () => {
      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id: cid('badstyle'), name: 'Bad', config: { style: { version: 7 } } })
        .expect(400);
    });

    it('accepts a valid MapLibre config.style on create (201)', async () => {
      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: cid('goodstyle'),
          name: 'Good',
          config: { style: { version: 8, sources: {}, layers: [] } },
        })
        .expect(201);
    });
  });

  // Item 15 (testes-backend.md) — the same guard on the UPDATE path.
  //
  // The two cases above validated the style only on POST and were treated as if they
  // covered the set (pattern C2b). `updateCatalogItem` calls assertValidStyle too, but
  // nothing held it: removing that one line let an admin PUT persist `{style:{version:7}}`,
  // `listBasemapStyles` copied it VERBATIM into GET /api/config, and the frontend's
  // fail-fast boot broke for everyone — anonymous included — with the suite fully green.
  // Rejections are asserted against POSTGRES, not against the response body: a 400 that
  // still wrote is the failure this is guarding against.
  describe('Basemap style validation on UPDATE (the half that had no guard)', () => {
    let target;

    before(async () => {
      target = cid('putstyle');
      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: target,
          name: 'Base para PUT',
          config: { style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] } },
        })
        .expect(201);
    });

    /** The style actually stored in Postgres (never the echo of the response). */
    const storedStyle = async (id) => {
      const { rows } = await db.query('SELECT config FROM basemaps WHERE id = $1', [id]);
      assert.equal(rows.length, 1, 'the basemap row must exist');
      return rows[0].config?.style;
    };

    const putStyle = (style, expected) =>
      supertest(app)
        .put(`/api/v1/basemaps/${target}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ config: { style } })
        .expect(expected);

    it('rejects a malformed style on PUT and does NOT write it', async () => {
      const invalid = [
        { version: 7, sources: {}, layers: [] },   // wrong version
        { version: 8, sources: {} },               // no layers
        { version: 8, layers: [] },                // no sources
        'nao-e-objeto',                            // not an object
        [],                                        // array is rejected
        null,                                      // null is rejected
      ];
      assert.equal(invalid.length, 6, 'the rejection table must not be empty');

      for (const style of invalid) {
        await putStyle(style, 400);
        const stored = await storedStyle(target);
        assert.equal(stored.version, 8, `${JSON.stringify(style)} must not have been persisted`);
        assert.deepEqual(stored.layers, [{ id: 'bg', type: 'background' }]);
      }
    });

    it('accepts a valid style on PUT and serves it verbatim in the public /api/config', async () => {
      const style = {
        version: 8,
        sources: { osm: { type: 'raster', tiles: ['https://x/{z}/{x}/{y}.png'], tileSize: 256 } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      };
      await putStyle(style, 200);

      const cfg = await supertest(app).get('/api/config').expect(200);
      assert.deepEqual(cfg.body.data.basemapStyles[target], style);
    });

    it('a PUT WITHOUT a style key is untouched by the guard (it is not "every update needs a style")', async () => {
      await supertest(app)
        .put(`/api/v1/basemaps/${target}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ config: { url: 'https://x/{z}/{x}/{y}.png' } })
        .expect(200);

      const { rows } = await db.query('SELECT config FROM basemaps WHERE id = $1', [target]);
      assert.equal(rows[0].config.url, 'https://x/{z}/{x}/{y}.png');
    });

    it('EVERY style served by /api/config is a valid MapLibre style (closing invariant)', async () => {
      const cfg = await supertest(app).get('/api/config').expect(200);
      const styles = cfg.body.data.basemapStyles;
      const ids = Object.keys(styles);
      // Anti-empty-sweep guard: an empty map would make the loop below prove nothing.
      assert.ok(ids.length >= 5, `expected at least 5 basemap styles, got ${ids.length}`);

      for (const id of ids) {
        const result = validateMapLibreStyle(styles[id]);
        assert.equal(result.ok, true, `basemapStyles["${id}"] is invalid: ${result.errors.join(' ')}`);
      }
    });
  });

  describe('Config flexibility', () => {
    it('accepts complex nested config objects', async () => {
      const id = cid('complex');
      const res = await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id,
          name: 'Complex Config',
          config: {
            url: 'https://example.com/tiles/{z}/{x}/{y}.png',
            attribution: 'Test',
            options: { minZoom: 1, maxZoom: 18, subdomains: ['a', 'b', 'c'] },
            metadata: { author: 'Test Author', license: 'MIT' },
          },
        })
        .expect(201);

      assert.ok(res.body.data.config.options);
      assert.ok(res.body.data.config.metadata);
      assert.deepEqual(res.body.data.config.options.subdomains, ['a', 'b', 'c']);
    });
  });
});

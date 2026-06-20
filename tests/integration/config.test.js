// Path: tests/integration/config.test.js
// Fase 2: public GET /api/v1/config serves the frozen config.js shape, sourcing
// data from the resources table and URLs from env.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const TOP_KEYS = [
  'app', 'features', 'services', 'search', 'basemaps', 'analysisLayers',
  'dataLayers', 'map2d', 'map3d', 'tilesets', 'streetView360', 'basemapStyles',
];

describe('Config endpoint (GET /api/v1/config)', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('is public (no auth) and returns the full frozen shape', async () => {
    const res = await supertest(app).get('/api/v1/config').expect(200);
    const cfg = res.body.data;
    for (const k of TOP_KEYS) {
      assert.ok(k in cfg, `missing top-level key: ${k}`);
    }
  });

  it('serves the /api/config compatibility alias', async () => {
    await supertest(app).get('/api/config').expect(200);
  });

  it('basemaps is an object keyed by id, sourced from resources', async () => {
    const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
    assert.equal(typeof cfg.basemaps, 'object');
    assert.ok(!Array.isArray(cfg.basemaps));
    assert.deepEqual(cfg.basemaps['carta-topografica'], {
      name: 'Topográfica',
      enabled: true,
      image: './images/layers/carta-topografica-thumb.png',
      priority: 1,
    });
  });

  it('tilesets is an array including the seeded PCL tileset', async () => {
    const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
    assert.ok(Array.isArray(cfg.tilesets));
    const pcl = cfg.tilesets.find((t) => t.id === 'PCL');
    assert.ok(pcl);
    assert.equal(pcl.heightOffset, 35);
    assert.equal(pcl.url, '/3d/PCL/tileset.json');
  });

  it('basemapStyles serves 5 valid MapLibre styles with env-injected URLs', async () => {
    const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
    for (const id of ['carta-topografica', 'osm', 'bdgex', 'imagens', 'carta-ortoimagem']) {
      assert.equal(cfg.basemapStyles[id].version, 8, `style ${id}`);
      assert.ok(cfg.basemapStyles[id].sources);
      assert.ok(Array.isArray(cfg.basemapStyles[id].layers));
    }
    // env-injected tile URL (default applied in test env)
    assert.ok(cfg.basemapStyles.osm.sources.osm.tiles[0].includes('{z}/{x}/{y}'));
  });

  it('exposes env-injected service URLs (defaults applied in test)', async () => {
    const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
    assert.equal(cfg.search.apiUrl, 'http://localhost:3001/busca');
    // Fase 9: 360 absorbed → serviceUrl is the in-backend mount, not an external :8081 upstream.
    assert.equal(cfg.streetView360.serviceUrl, 'http://localhost:3000/api/v1/sv360');
    assert.equal(cfg.map3d.providers.terrain.type, 'Cesium');
    assert.equal(cfg.map2d.terrainSource.type, 'raster-dem');
  });

  it('reflects edits to the resources table without code changes', async () => {
    // Mutate a seed basemap, assert reflection, then restore (sequential test files).
    const before = await db.query(`SELECT config FROM resources WHERE id = 'osm'`);
    try {
      await db.query(`UPDATE resources SET config = jsonb_set(config, '{enabled}', 'true') WHERE id = 'osm'`);
      const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
      assert.equal(cfg.basemaps.osm.enabled, true);
    } finally {
      await db.query(`UPDATE resources SET config = $1 WHERE id = 'osm'`, [before.rows[0].config]);
    }
  });
});

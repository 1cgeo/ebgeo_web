// Path: tests/integration/features-real-shape.test.js
// Integration tests asserting that a feature-create op carrying the REAL frontend
// GeoJSON feature shape persists correctly for EACH of the 18 feature types.
//
// The real shape (from tests/helpers/real-fixtures.js, shared verbatim with the
// frontend producer tests) carries gotchas that minimal constructed fixtures lacked
// and that let a real bug through:
//   - a NUMERIC top-level GeoJSON `id` (MapLibre/tool assigned) that must NOT become
//     the row id — the row id is the op's targetId;
//   - `properties.id` = the canonical UUID;
//   - `properties.source` = the type (backend derives feature_type from it);
//   - `properties.layerId` = 'default' (implicit-layer sentinel, a NON-UUID that must
//     coerce to null on features.layer_id, a UUID column, while staying verbatim in
//     the properties JSONB).
//
// All feature writes go through POST /atlas/:id/sync (no REST write routes exist).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { realFeature, ALL_FEATURE_SOURCES } from '../helpers/real-fixtures.js';

describe('Features — real frontend shape via Sync API', () => {
  let app, db, user, token, atlasId, mapId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db);
    token = await loginUser(app, user.username, user.password);
    const atlas = await createAtlas(db, user.id);
    const map = await createMap(db, atlas.id);
    atlasId = atlas.id;
    mapId = map.id;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /**
   * Pushes a single create op carrying the real feature shape for `source` and
   * asserts the persisted row. Returns the row for any extra per-type assertions.
   */
  async function createRealFeature(source) {
    const targetId = randomUUID();
    // realFeature sets properties.id === targetId and leaves the numeric top-level id.
    const data = realFeature(source, { id: targetId });

    // Sanity-check the fixture is actually the "real" shape (these are the gotchas).
    assert.equal(data.id, 1782053337250, `${source}: fixture keeps the numeric top-level GeoJSON id`);
    assert.equal(data.properties.id, targetId, `${source}: properties.id is the canonical UUID`);
    assert.equal(data.properties.source, source, `${source}: properties.source carries the type`);
    assert.equal(data.properties.layerId, 'default', `${source}: properties.layerId is the 'default' sentinel`);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operations: [{
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId,
          mapId,
          data,
          timestamp: Date.now(),
          clientId: 'test-client',
        }],
      })
      .expect(200);

    assert.equal(res.body.data.acks.length, 1, `${source}: op was acked`);

    const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
    assert.equal(rows.length, 1, `${source}: feature row persisted`);

    const row = rows[0];
    assert.equal(row.id, targetId, `${source}: row id is the targetId (NOT the numeric top-level GeoJSON id)`);
    assert.notEqual(row.id, String(data.id), `${source}: row id is NOT the numeric top-level id`);
    assert.equal(row.feature_type, source, `${source}: feature_type derived from properties.source`);
    assert.equal(row.layer_id, null, `${source}: non-UUID 'default' layerId coerced to null on the row`);
    assert.equal(row.properties.layerId, 'default', `${source}: layerId preserved verbatim in the properties JSONB`);
    assert.equal(row.properties.id, targetId, `${source}: properties.id preserved as the canonical UUID`);

    return row;
  }

  it('persists the real shape for ALL 18 feature types', async () => {
    assert.equal(ALL_FEATURE_SOURCES.length, 18, 'fixture exposes all 18 backend-valid feature types');
    for (const source of ALL_FEATURE_SOURCES) {
      await createRealFeature(source);
    }
  });

  // A couple of explicit cases for readability / quick triage if the loop ever breaks.
  it('persists a real line feature', async () => {
    const row = await createRealFeature('line');
    assert.equal(row.geometry.type, 'LineString', 'line geometry round-trips');
    assert.ok(Array.isArray(row.geometry.coordinates), 'line keeps its coordinates array');
    assert.equal(row.properties.source, 'line', 'source preserved in properties');
  });

  it('persists a real military_symbol feature (SIDC preserved)', async () => {
    const row = await createRealFeature('military_symbol');
    assert.equal(row.feature_type, 'military_symbol', 'military_symbol survives the CHECK constraint');
    assert.equal(row.properties.sidc, 'SFGPUCI-----', 'SIDC preserved verbatim in properties');
    assert.equal(row.geometry.type, 'Point', 'military_symbol geometry round-trips');
  });
});

// Path: tests/integration/atlas-clone-import-n1.repro.test.js
// Regression (achado 67): clone, duplicate-map and import inserted ONE ROW PER STATEMENT
// (`for (const feature of features) await t.one('INSERT INTO features …')`), all inside a single
// tx(). The transaction — and the pool connection backing it (poolMax defaults to 10) — stayed
// open for a time proportional to the size of the atlas, with no statement_timeout and no rate
// limit. The clone volume is unbounded (it comes from the database, gated only by 'read'), so a
// handful of concurrent clones starved /auth/login and /health: the same pool-exhaustion mode
// sync.service.js:650-655 already documents.
//
// The dataset is CORRECT either way, so only the COST can be asserted. The invariant that
// actually binds: the number of statements issued inside the transaction must not depend on the
// number of rows. Both payloads below carry the same MIX of entity types (so the same set of
// batch INSERTs runs) and differ only in row COUNT.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { installTxQueryCounter } from '../helpers/query-counter.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

// Absolute ceilings — one per entity type plus bookkeeping, never one per row.
const CLONE_CEILING = 40;
const IMPORT_CEILING = 30;

describe('achado-67 · clone/duplicate/import cost is constant in the row count', () => {
  let app, db, owner, token, counter;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `n67_owner_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
    counter = installTxQueryCounter();
  });

  after(async () => {
    counter.restore();
    await teardownTestEnv(db);
  });

  /** Builds an atlas with `maps` maps, each holding `perMap` of every sub-entity. */
  async function buildAtlas(maps, perMap) {
    const atlas = await createAtlas(db, owner.id, { name: `N67 src ${randomUUID().slice(0, 6)}` });
    for (let m = 0; m < maps; m++) {
      const map = await createMap(db, atlas.id, { name: `Mapa ${m}` });
      for (let i = 0; i < perMap; i++) {
        const layer = await db.query(
          `INSERT INTO layers (map_id, name) VALUES ($1, $2) RETURNING id`, [map.id, `L${i}`]
        );
        const group = await db.query(
          `INSERT INTO groups (map_id, name) VALUES ($1, $2) RETURNING id`, [map.id, `G${i}`]
        );
        const feature = await db.query(
          `INSERT INTO features (map_id, feature_type, geometry, properties, layer_id)
           VALUES ($1, 'point', $2::jsonb, $3::jsonb, $4) RETURNING id`,
          [map.id, JSON.stringify({ type: 'Point', coordinates: [-43, -22] }),
            JSON.stringify({ nome: `F${i}` }), layer.rows[0].id]
        );
        await db.query(`INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)`,
          [group.rows[0].id, feature.rows[0].id]);
        await db.query(
          `INSERT INTO cesium3d_data (map_id, data_type, data) VALUES ($1, 'marker', $2::jsonb)`,
          [map.id, JSON.stringify({ nome: `C${i}` })]);
        await db.query(
          `INSERT INTO streetview360_data (map_id, data_type, data) VALUES ($1, 'marker', $2::jsonb)`,
          [map.id, JSON.stringify({ nome: `S${i}` })]);
        await db.query(
          `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
          [`cat-${i}`, map.id, JSON.stringify({ id: `cat-${i}`, visible: true })]);
      }
      const briefing = await db.query(
        `INSERT INTO briefings (atlas_id, name) VALUES ($1, $2) RETURNING id`, [atlas.id, `B${m}`]);
      for (let i = 0; i < perMap; i++) {
        await db.query(`INSERT INTO slides (briefing_id, title) VALUES ($1, $2)`,
          [briefing.rows[0].id, `S${i}`]);
      }
    }
    return atlas;
  }

  const cloneCost = async (atlasId) => {
    counter.reset();
    await supertest(app)
      .post(`/api/v1/atlas/${atlasId}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return { count: counter.state.count, statements: [...counter.state.statements] };
  };

  it('clone: the statement count does not grow with the number of rows', async () => {
    const small = await buildAtlas(1, 2);
    const big = await buildAtlas(1, 12);

    const a = await cloneCost(small.id);
    const b = await cloneCost(big.id);

    assert.equal(
      b.count, a.count,
      `cloning 6x the rows must not cost more statements (small=${a.count}, big=${b.count})\n` +
      b.statements.join('\n')
    );
    assert.ok(a.count <= CLONE_CEILING, `clone should stay under ${CLONE_CEILING} statements, got ${a.count}`);
  });

  it('clone: the statement count does not grow with the number of maps', async () => {
    const one = await buildAtlas(1, 2);
    const four = await buildAtlas(4, 2);

    const a = await cloneCost(one.id);
    const b = await cloneCost(four.id);

    assert.equal(
      b.count, a.count,
      `cloning 4x the maps must not cost more statements (1 map=${a.count}, 4 maps=${b.count})\n` +
      b.statements.join('\n')
    );
  });

  it('duplicate map: the statement count does not grow with the number of rows', async () => {
    const atlas = await buildAtlas(1, 2);
    const bigAtlas = await buildAtlas(1, 12);
    const mapOf = async (atlasId) => (await db.query(
      'SELECT id FROM maps WHERE atlas_id = $1 ORDER BY created_at LIMIT 1', [atlasId])).rows[0].id;

    const dupCost = async (atlasId) => {
      counter.reset();
      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/maps/${await mapOf(atlasId)}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      return counter.state.count;
    };

    const a = await dupCost(atlas.id);
    const b = await dupCost(bigAtlas.id);
    assert.equal(b, a, `duplicate: small=${a}, big=${b}`);
  });

  /** An import payload with `n` of every sub-entity in a single map. */
  function importPayload(n) {
    const mapId = randomUUID();
    const layers = [];
    const groups = [];
    const features = [];
    const groupFeatures = [];
    const cesium3dData = [];
    const streetview360Data = [];
    const slides = [];
    for (let i = 0; i < n; i++) {
      const layerId = randomUUID();
      const groupId = randomUUID();
      const featureId = randomUUID();
      layers.push({ id: layerId, name: `L${i}` });
      groups.push({ id: groupId, name: `G${i}` });
      features.push({
        id: featureId,
        feature_type: 'point',
        geometry: { type: 'Point', coordinates: [-43, -22] },
        properties: { nome: `F${i}` },
        layer_id: layerId,
      });
      groupFeatures.push({ group_id: groupId, feature_id: featureId });
      cesium3dData.push({ id: randomUUID(), data_type: 'marker', data: { nome: `C${i}` } });
      streetview360Data.push({ id: randomUUID(), data_type: 'marker', data: { nome: `S${i}` } });
      slides.push({ id: randomUUID(), title: `S${i}`, map_id: mapId });
    }
    return {
      atlas: { name: `N67 import ${randomUUID().slice(0, 6)}` },
      maps: [{
        id: mapId,
        name: 'Mapa importado',
        center_lat: -22.9,
        center_long: -43.2,
        zoom: 10,
        catalog_layers: [{ id: 'hillshade', visible: true }],
        layers, groups, features, groupFeatures, cesium3dData, streetview360Data,
      }],
      briefings: [{ id: randomUUID(), name: 'Briefing', slides }],
    };
  }

  it('import: the statement count does not grow with the number of rows', async () => {
    const cost = async (n) => {
      counter.reset();
      await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send(importPayload(n))
        .expect(201);
      return { count: counter.state.count, statements: [...counter.state.statements] };
    };

    const a = await cost(2);
    const b = await cost(12);

    assert.equal(
      b.count, a.count,
      `importing 6x the rows must not cost more statements (n=2 → ${a.count}, n=12 → ${b.count})\n` +
      b.statements.join('\n')
    );
    assert.ok(a.count <= IMPORT_CEILING, `import should stay under ${IMPORT_CEILING} statements, got ${a.count}`);
  });
});

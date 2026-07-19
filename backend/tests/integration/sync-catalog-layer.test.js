// Path: tests/integration/sync-catalog-layer.test.js
// Fase 1 Tarefa 4: catalogLayer as a per-layer entity (dedicated table), with
// backward-compatible support for the legacy whole-array form.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Sync — catalogLayer (per-layer)', () => {
  let app, db, owner, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'catlayer_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Catalog Layer Atlas' });
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(200);

  const op = (operationType, entityId, data) => ({
    id: randomUUID(),
    entityType: 'catalogLayer',
    operationType,
    entityId,
    mapId: map.id,
    data,
    timestamp: Date.now(),
    clientId: 'c1',
  });

  it('create/update/delete per-layer and exposes survivors in the snapshot', async () => {
    const layer1 = randomUUID();
    const layer2 = randomUUID();

    await push([op('create', layer1, { type: 'wms', name: 'Layer 1', visible: true })]);
    await push([op('create', layer2, { type: 'wms', name: 'Layer 2', visible: true })]);

    // Both rows exist in the dedicated table
    let rows = await db.query('SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL', [map.id]);
    assert.equal(rows.rows.length, 2);

    // Update layer1; delete layer2
    await push([op('update', layer1, { type: 'wms', name: 'Layer 1 (edited)', visible: false })]);
    await push([op('delete', layer2, {})]);

    rows = await db.query('SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL', [map.id]);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].id, layer1);
    assert.equal(rows.rows[0].data.name, 'Layer 1 (edited)');
    assert.equal(rows.rows[0].data.visible, false);

    // Snapshot exposes map.catalogLayers (per-id) with the survivor
    const snap = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const snapMap = snap.body.data.snapshot.maps.find((m) => m.id === map.id);
    assert.ok(Array.isArray(snapMap.catalogLayers));
    assert.equal(snapMap.catalogLayers.length, 1);
    assert.equal(snapMap.catalogLayers[0].id, layer1);
    assert.equal(snapMap.catalogLayers[0].name, 'Layer 1 (edited)');
  });

  it('still supports the legacy whole-array form (writes maps.catalog_layers)', async () => {
    const arr = [{ id: 'wms-a', visible: true }, { id: 'wms-b', visible: false }];
    await push([op('update', randomUUID(), { catalog_layers: arr })]);

    const { rows } = await db.query('SELECT catalog_layers FROM maps WHERE id = $1', [map.id]);
    assert.deepEqual(rows[0].catalog_layers, arr);
  });

  // ---------------------------------------------------------------------------
  // The ids the REAL client sends. Every test above uses randomUUID(), which the
  // catalog never produces: CatalogService builds literal ids ('hillshade',
  // `analysis-${id}`, `data-${id}`, `3d-${id}`, `360-${id}` — catalog.service.js
  // :160,:192,:223,:244,:266) and that string travels straight through as the
  // operation entityId. With catalog_layers.id typed UUID the insert raised 22P02,
  // which aborted the whole push transaction (one tx per batch), so the client's
  // queue never drained: a poison pill that killed that client's sync permanently.
  // Testing with UUIDs is what let this pass green for so long.
  // ---------------------------------------------------------------------------
  describe('real catalog ids (non-UUID) round-trip', () => {
    const REAL_IDS = ['hillshade', 'analysis-declividade', 'data-rodovias-federais', '3d-tileset-x', '360-projeto-y'];

    it('accepts every real catalog id shape and exposes them in the snapshot', async () => {
      const m = await createMap(db, atlas.id, { name: 'Real Catalog Ids' });
      const realOp = (operationType, entityId, data) => ({
        id: randomUUID(),
        entityType: 'catalogLayer',
        operationType,
        entityId,
        mapId: m.id,
        data,
        timestamp: Date.now(),
        clientId: 'c-real',
      });

      for (const id of REAL_IDS) {
        await supertest(app)
          .post(`/api/v1/atlas/${atlas.id}/sync`)
          .set('Authorization', `Bearer ${token}`)
          .send({ operations: [realOp('create', id, { type: 'raster', name: id, visible: true })] })
          .expect(200);
      }

      const { rows } = await db.query(
        'SELECT id FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL ORDER BY id', [m.id]
      );
      assert.deepEqual(
        rows.map((r) => r.id).sort(),
        [...REAL_IDS].sort(),
        'every real catalog id persisted with its literal value'
      );

      const snap = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const snapMap = snap.body.data.snapshot.maps.find((mm) => mm.id === m.id);
      assert.deepEqual(
        snapMap.catalogLayers.map((l) => l.id).sort(),
        [...REAL_IDS].sort(),
        'the snapshot returns the same literal ids the client indexes by'
      );
    });

    // The client's layer id is a catalog-wide CONSTANT, not a per-map value: every
    // map that adds "Sombreamento do Relevo" uses the id 'hillshade'. With the old
    // PRIMARY KEY (id) the first map to add it won the row and every other map hit
    // ON CONFLICT (id) DO NOTHING, so the layer silently never appeared there while
    // the push was still acked as success. Invisible for as long as the suite used
    // randomUUID() as the layer id, since UUIDs are globally unique by construction.
    it('the SAME catalog id can exist in two different maps (uniqueness is per map)', async () => {
      const mapA = await createMap(db, atlas.id, { name: 'Shared Id A' });
      const mapB = await createMap(db, atlas.id, { name: 'Shared Id B' });

      const addHillshade = (mapId, name) => supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(), entityType: 'catalogLayer', operationType: 'create',
            entityId: 'hillshade', mapId,
            data: { type: 'raster', name, visible: true },
            timestamp: Date.now(), clientId: 'c-shared',
          }],
        })
        .expect(200);

      await addHillshade(mapA.id, 'Sombreamento em A');
      await addHillshade(mapB.id, 'Sombreamento em B');

      const { rows } = await db.query(
        `SELECT map_id, data->>'name' AS name FROM catalog_layers
          WHERE id = 'hillshade' AND map_id IN ($1, $2) AND deleted_at IS NULL
          ORDER BY data->>'name'`,
        [mapA.id, mapB.id]
      );
      assert.equal(rows.length, 2, "both maps keep their own 'hillshade' row");
      assert.deepEqual(
        rows.map((r) => r.name),
        ['Sombreamento em A', 'Sombreamento em B'],
        'each map keeps its own payload, neither silently swallowed by the other'
      );
    });

    it('a batch mixing a real catalog id with a feature applies BOTH (no poison pill)', async () => {
      const m = await createMap(db, atlas.id, { name: 'Poison Pill Guard' });
      const featureId = randomUUID();

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [
            {
              id: randomUUID(), entityType: 'catalogLayer', operationType: 'create',
              entityId: 'hillshade', mapId: m.id,
              data: { type: 'raster', name: 'Sombreamento do Relevo', visible: true },
              timestamp: Date.now(), clientId: 'c-mix',
            },
            {
              id: randomUUID(), entityType: 'feature', operationType: 'create',
              entityId: featureId, mapId: m.id,
              data: {
                feature_type: 'point',
                geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
                properties: { id: featureId, nome: 'ponto no mesmo lote' },
              },
              timestamp: Date.now(), clientId: 'c-mix',
            },
          ],
        })
        .expect(200);

      const { rows: cl } = await db.query('SELECT id FROM catalog_layers WHERE map_id = $1', [m.id]);
      assert.deepEqual(cl.map((r) => r.id), ['hillshade'], 'the catalog layer applied');

      const { rows: f } = await db.query('SELECT id FROM features WHERE id = $1', [featureId]);
      assert.equal(f.length, 1, 'the sibling feature in the same batch applied too');
    });
  });
});

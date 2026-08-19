// Path: tests/integration/atlas-catalog-layers-roundtrip.repro.test.js
// Regression (achado 42): catalog layers vanished on the import/clone round-trip because the
// schema keeps TWO homes for the same data and the writers and the reader picked different ones.
//   - writers: importAtlas / cloneAtlas / duplicateMap wrote ONLY the legacy array column
//     `maps.catalog_layers` (002_atlas.sql:98, whose comment claims it exists "p/ clone/import");
//   - reader: buildSnapshot builds `map.catalogLayers` ONLY from the dedicated `catalog_layers`
//     table (sync.queries.js GET_ATLAS_CATALOG_LAYERS).
// So "enviar atlas local para o servidor" (local-atlas-to-server.js:320 sends
// `catalog_layers: mapData.catalogLayers`) stored the layers in Postgres where no reader could
// reach them, and the snapshot answered `catalogLayers: []` — which the client applies as
// authoritative, wiping the local state. Silent data loss, no error.
//
// The contract closed here: the dedicated table is canonical. Every whole-entity writer
// (import, clone, duplicate) must materialise the array into `catalog_layers` rows.
//
// F12 FINISHED IT: migration 022 DROPPED `maps.catalog_layers`, so the table is not just
// canonical, it is the only home. The import PAYLOAD key `map.catalog_layers` survives (frozen
// contract with `local-atlas-to-server.js`) and is materialised straight into the table — which
// is what the first case below now asserts, without a column to check afterwards. The case that
// cloned "a map that only has the LEGACY column" describes a state the schema can no longer
// reach and was replaced by the migration's own materialisation, asserted in
// `catalog-layer-coluna-legada.test.js`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

// The real client ids (never UUIDs) — CatalogService mints 'hillshade', `analysis-*`, `data-*`.
const LAYERS = [
  { id: 'hillshade', nome: 'Sombreamento do Relevo', visible: true, opacity: 0.7 },
  { id: 'analysis-declividade', nome: 'Declividade', visible: false, opacity: 1 },
];

describe('achado-42 · catalog layers survive the import/clone round-trip', () => {
  let app, db, owner, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `cl42_owner_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const snapshotMaps = async (atlasId) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlasId}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.snapshot.maps;
  };

  const byId = (arr) => Object.fromEntries((arr || []).map((l) => [l.id, l]));

  it('POST /atlas/import materialises map.catalog_layers into the dedicated table', async () => {
    const mapId = randomUUID();
    const res = await supertest(app)
      .post('/api/v1/atlas/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        atlas: { name: `CL42 import ${randomUUID().slice(0, 6)}` },
        maps: [{
          id: mapId,
          name: 'Mapa com catálogo',
          center_lat: -22.9,
          center_long: -43.2,
          zoom: 10,
          catalog_layers: LAYERS,
        }],
        briefings: [],
      })
      .expect(201);

    const atlasId = res.body.data.id;

    // Canonical home: one row per layer, keyed by the client id.
    const { rows } = await db.query(
      'SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL ORDER BY id',
      [mapId]
    );
    assert.equal(rows.length, 2, 'the import must write the dedicated table');
    assert.deepEqual(rows.map((r) => r.id).sort(), ['analysis-declividade', 'hillshade']);

    // Round-trip through the reader the client actually uses.
    const snapMap = (await snapshotMaps(atlasId)).find((m) => m.id === mapId);
    const got = byId(snapMap.catalogLayers);
    assert.equal(Object.keys(got).length, 2, 'the snapshot must return what was imported');
    assert.equal(got.hillshade.nome, 'Sombreamento do Relevo');
    assert.equal(got.hillshade.visible, true);
    assert.equal(got.hillshade.opacity, 0.7);
    assert.equal(got['analysis-declividade'].visible, false);

    // And the column that used to hold the second copy is gone from the schema: the payload key
    // is accepted, the column is not re-created behind it.
    const coluna = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'maps' AND column_name = 'catalog_layers'`
    );
    assert.equal(coluna.rows.length, 0, '`maps.catalog_layers` não existe mais');
  });

  it('clone carries the catalog layers of a map that got them from LIVE sync', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `CL42 clone src ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'Origem' });

    // The live-sync shape: rows in the dedicated table, legacy column empty.
    for (const l of LAYERS) {
      await db.query('INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)', [
        l.id, map.id, JSON.stringify(l),
      ]);
    }

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const cloneId = res.body.data.id;

    const cloneMap = (await snapshotMaps(cloneId))[0];
    const got = byId(cloneMap.catalogLayers);
    assert.equal(Object.keys(got).length, 2, 'the clone must carry the catalog layers');
    assert.equal(got.hillshade.nome, 'Sombreamento do Relevo');
    assert.equal(got['analysis-declividade'].visible, false);

    // Copied, not moved: the source keeps its rows.
    const src = await db.query('SELECT COUNT(*)::int AS n FROM catalog_layers WHERE map_id = $1', [map.id]);
    assert.equal(src.rows[0].n, 2);
  });

  it('duplicate map carries the catalog layers to the copy', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `CL42 dup ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'Origem dup' });
    for (const l of LAYERS) {
      await db.query('INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)', [
        l.id, map.id, JSON.stringify(l),
      ]);
    }

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/duplicate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const newMapId = res.body.data.id;

    const dupMap = (await snapshotMaps(atlas.id)).find((m) => m.id === newMapId);
    const got = byId(dupMap.catalogLayers);
    assert.equal(Object.keys(got).length, 2, 'the duplicated map must carry the catalog layers');
    assert.equal(got.hillshade.nome, 'Sombreamento do Relevo');
  });

  it('a soft-deleted catalog layer is NOT resurrected by a clone', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `CL42 tomb ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'Origem tumulo' });
    await db.query('INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)', [
      'hillshade', map.id, JSON.stringify(LAYERS[0]),
    ]);
    await db.query(
      `INSERT INTO catalog_layers (id, map_id, data, deleted_at) VALUES ($1, $2, $3::jsonb, NOW())`,
      ['analysis-declividade', map.id, JSON.stringify(LAYERS[1])]
    );

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const cloneMap = (await snapshotMaps(res.body.data.id))[0];
    assert.deepEqual((cloneMap.catalogLayers || []).map((l) => l.id), ['hillshade']);
  });
});

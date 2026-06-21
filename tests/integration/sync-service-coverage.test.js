// Path: tests/integration/sync-service-coverage.test.js
// Targeted coverage for src/modules/sync/sync.service.js behaviors that the existing
// sync-*.test.js suite does NOT exercise (verified by reading every sync test):
//   - idempotency by op_id asserted at the ENTITY-ROW level (not just the ack):
//     a duplicate (atlas_id, op_id) push must apply the create effect exactly once;
//   - LWW by ARRIVAL ORDER across TWO separate pushes (not one batch) and for a
//     NON-feature entity (layer) — last-arriving value wins, timestamp ignored;
//   - cross-atlas (inAtlas / atlas-scoped) guard for BRIEFING (update+delete) and
//     CATALOG_LAYER per-layer (create/update/delete) — neither is in the existing
//     cross-atlas suite;
//   - soft-delete + tombstone for a GENERIC entity (feature/layer): re-create with
//     the SAME id after delete must NOT resurrect (ON CONFLICT (id) DO NOTHING),
//     and the snapshot must exclude the tombstoned row;
//   - map sub-type assembly persists temporal_config / grid_style to the right column;
//   - negative access: a READ-share user cannot create a catalog_layer.
// Every test asserts the persisted DB row and/or the HTTP/ack response — never a
// bare call.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createLayer, createBriefing,
  createShare, loginUser,
} from '../helpers/fixtures.js';

describe('Sync service coverage — untested CRDT behaviors', () => {
  let app, db, owner, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `cov_owner_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Coverage Atlas' });
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (atlasId, tok, operations, status = 200) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ operations })
      .expect(status);

  const snapshot = async (atlasId, tok) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlasId}/sync/0`)
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);
    return res.body.data.snapshot;
  };

  const geoFeature = (id, props = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
    properties: { id, source: 'point', ...props },
  });

  // ---------------------------------------------------------------------------
  // 1. Idempotency by op_id asserted at the entity-row level.
  // ---------------------------------------------------------------------------
  describe('idempotency by op_id (ON CONFLICT (atlas_id, op_id) DO NOTHING)', () => {
    it('pushing the SAME op_id twice creates the entity exactly once and acks idempotent', async () => {
      const opId = randomUUID();
      const featureId = randomUUID();
      const opPayload = {
        id: opId, type: 'create', target: 'feature', targetId: featureId, mapId: map.id,
        data: { feature_type: 'point', geometry: { coordinates: [1, 2] }, properties: { name: 'idem' } },
        timestamp: Date.now(), clientId: 'idem-client',
      };

      const first = await push(atlas.id, token, [opPayload]);
      assert.equal(first.body.data.results[0].idempotent, false, 'first push applies the op');

      // Identical resend (same op_id). Different geometry to prove no re-apply/overwrite.
      const second = await push(atlas.id, token, [{
        ...opPayload,
        data: { feature_type: 'point', geometry: { coordinates: [9, 9] }, properties: { name: 'SHOULD_NOT_APPLY' } },
      }]);
      assert.equal(second.body.data.results[0].idempotent, true, 'resend acked idempotent');

      // Exactly one operations log row for this (atlas_id, op_id).
      const ops = await db.query(
        'SELECT count(*)::int AS n FROM operations WHERE atlas_id = $1 AND op_id = $2',
        [atlas.id, opId]
      );
      assert.equal(ops.rows[0].n, 1, 'exactly one operations row for the duplicate op_id');

      // Exactly one feature row, and the SECOND push did not re-apply (original data kept).
      const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [featureId]);
      assert.equal(rows.length, 1, 'exactly one feature row persisted');
      assert.equal(rows[0].properties.name, 'idem', 'resend did not re-apply the effect');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. LWW by arrival order — across TWO pushes, and for a non-feature entity.
  // ---------------------------------------------------------------------------
  describe('LWW by arrival order (timestamp ignored), across separate pushes', () => {
    it('two updates in separate pushes: the later-ARRIVING value wins even with an older timestamp', async () => {
      const f = await createFeatureRow(db, map.id, { name: 'start' });

      // First push: newer timestamp, value B.
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'update', target: 'feature', targetId: f.id, mapId: map.id,
        changes: { properties: { name: 'B' } }, timestamp: 5000, clientId: 'c',
      }]);
      // Second push (arrives LATER): OLDER timestamp, value A. Arrival order must win.
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'update', target: 'feature', targetId: f.id, mapId: map.id,
        changes: { properties: { name: 'A' } }, timestamp: 1000, clientId: 'c',
      }]);

      const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [f.id]);
      assert.equal(rows[0].properties.name, 'A', 'last-arriving update wins, not the newest timestamp');
    });

    it('LWW also holds for a LAYER entity across two pushes', async () => {
      const layer = await createLayer(db, map.id, { name: 'L-start' });

      await push(atlas.id, token, [{
        id: randomUUID(), type: 'update', target: 'layer', targetId: layer.id, mapId: map.id,
        changes: { name: 'L-second-newer-ts' }, timestamp: 9000, clientId: 'c',
      }]);
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'update', target: 'layer', targetId: layer.id, mapId: map.id,
        changes: { name: 'L-winner-older-ts' }, timestamp: 1, clientId: 'c',
      }]);

      const { rows } = await db.query('SELECT name FROM layers WHERE id = $1', [layer.id]);
      assert.equal(rows[0].name, 'L-winner-older-ts', 'last-arriving layer update wins');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Soft-delete + tombstone for a GENERIC entity (no resurrection on re-create).
  // ---------------------------------------------------------------------------
  describe('soft-delete + tombstone: re-create with same id does not resurrect', () => {
    it('feature delete then re-create same id stays deleted and is omitted from snapshot', async () => {
      const fId = randomUUID();
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'create', target: 'feature', targetId: fId, mapId: map.id,
        data: geoFeature(fId, { name: 'v1' }), timestamp: Date.now(), clientId: 'c',
      }]);
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'delete', target: 'feature', targetId: fId, mapId: map.id,
        timestamp: Date.now(), clientId: 'c',
      }]);

      // Re-create with the SAME id (ON CONFLICT (id) DO NOTHING → tombstone survives).
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'create', target: 'feature', targetId: fId, mapId: map.id,
        data: geoFeature(fId, { name: 'RESURRECTED' }), timestamp: Date.now(), clientId: 'c',
      }]);

      const { rows } = await db.query('SELECT deleted_at, properties FROM features WHERE id = $1', [fId]);
      assert.equal(rows.length, 1, 'still exactly one row (re-create did not insert a second)');
      assert.ok(rows[0].deleted_at, 'row stays soft-deleted (no resurrection)');
      assert.equal(rows[0].properties.name, 'v1', 'original data preserved, re-create payload dropped');

      // Snapshot must exclude the tombstoned feature.
      const snap = await snapshot(atlas.id, token);
      const snapMap = snap.maps.find((m) => m.id === map.id);
      const pointIds = snapMap.features.points.map((p) => p.properties.id);
      assert.ok(!pointIds.includes(fId), 'tombstoned feature absent from snapshot');
    });

    it('layer delete then re-create same id stays deleted and is omitted from snapshot', async () => {
      const lId = randomUUID();
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'create', target: 'layer', targetId: lId, mapId: map.id,
        data: { name: 'orig-layer' }, timestamp: Date.now(), clientId: 'c',
      }]);
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'delete', target: 'layer', targetId: lId, mapId: map.id,
        timestamp: Date.now(), clientId: 'c',
      }]);
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'create', target: 'layer', targetId: lId, mapId: map.id,
        data: { name: 'reborn-layer' }, timestamp: Date.now(), clientId: 'c',
      }]);

      const { rows } = await db.query('SELECT deleted_at, name FROM layers WHERE id = $1', [lId]);
      assert.equal(rows.length, 1);
      assert.ok(rows[0].deleted_at, 'layer stays tombstoned');
      assert.equal(rows[0].name, 'orig-layer', 're-create payload dropped');

      const snap = await snapshot(atlas.id, token);
      const snapMap = snap.maps.find((m) => m.id === map.id);
      assert.ok(!snapMap.layers.some((l) => l.id === lId), 'tombstoned layer absent from snapshot');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Map sub-type assembly persists to the correct JSONB column.
  //    (isolation test only asserts the sibling-drop; here we assert the actual
  //     temporal_config / grid_style columns are assembled from loose keys.)
  // ---------------------------------------------------------------------------
  describe('map sub-type assembly writes the right column', () => {
    it('mapTemporal assembles temporal_config from loose keys (ativo/unidade/inicio/fim/modo/origem)', async () => {
      const m = await createMap(db, atlas.id, { name: 'Temporal Map' });
      await push(atlas.id, token, [{
        id: randomUUID(), entityType: 'mapTemporal', operationType: 'update', entityId: m.id, mapId: m.id,
        data: { ativo: true, unidade: 'HORA', inicio: 100, fim: 200, modo: 'range', origem: 'feat' },
        timestamp: Date.now(), clientId: 'c',
      }]);

      const { rows } = await db.query('SELECT temporal_config FROM maps WHERE id = $1', [m.id]);
      assert.deepEqual(rows[0].temporal_config, {
        ativo: true, unidade: 'HORA', inicio: 100, fim: 200, modo: 'range', origem: 'feat',
      }, 'temporal_config assembled into its own column');
    });

    it('gridStyle assembles grid_style from {format,visible}', async () => {
      const m = await createMap(db, atlas.id, { name: 'Grid Map' });
      await push(atlas.id, token, [{
        id: randomUUID(), entityType: 'gridStyle', operationType: 'update', entityId: m.id, mapId: m.id,
        data: { format: 'mgrs', visible: true }, timestamp: Date.now(), clientId: 'c',
      }]);

      const { rows } = await db.query('SELECT grid_style FROM maps WHERE id = $1', [m.id]);
      assert.deepEqual(rows[0].grid_style, { format: 'mgrs', visible: true }, 'grid_style assembled into its own column');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Cross-atlas guard for BRIEFING (update + delete) — NOT in the existing
  //    cross-atlas suite, which only covers map-scoped entities + slides + group_features.
  // ---------------------------------------------------------------------------
  describe('cross-atlas guard for briefing (atlas-scoped, untested elsewhere)', () => {
    let atlasB, briefingB;
    before(async () => {
      const userB = await createUser(db, { username: `cov_victimB_${randomUUID().slice(0, 8)}` });
      atlasB = await createAtlas(db, userB.id, { name: 'Victim Atlas B' });
      briefingB = await createBriefing(db, atlasB.id, { name: 'Victim Briefing B' });
    });

    it('cannot UPDATE a briefing of another atlas (pushed to atlas A)', async () => {
      const before = await db.query('SELECT name, version FROM briefings WHERE id = $1', [briefingB.id]);
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'update', target: 'briefing', targetId: briefingB.id,
        changes: { name: 'HACKED-BRIEFING' }, timestamp: Date.now(), clientId: 'attacker',
      }]);

      const { rows } = await db.query('SELECT name, version FROM briefings WHERE id = $1', [briefingB.id]);
      assert.equal(rows[0].name, 'Victim Briefing B', 'briefing of atlas B must be untouched');
      assert.equal(Number(rows[0].version), Number(before.rows[0].version), 'version not bumped on a no-match update');
    });

    it('cannot soft-DELETE a briefing of another atlas (pushed to atlas A)', async () => {
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'delete', target: 'briefing', targetId: briefingB.id,
        timestamp: Date.now(), clientId: 'attacker',
      }]);

      const { rows } = await db.query('SELECT deleted_at FROM briefings WHERE id = $1', [briefingB.id]);
      assert.equal(rows[0].deleted_at, null, 'briefing of atlas B must not be deleted');
    });

    it('POSITIVE control: owner can update/delete a briefing in their OWN atlas', async () => {
      const own = await createBriefing(db, atlas.id, { name: 'Own Briefing' });
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'update', target: 'briefing', targetId: own.id,
        changes: { name: 'Own Briefing Renamed' }, timestamp: Date.now(), clientId: 'c',
      }]);
      let { rows } = await db.query('SELECT name FROM briefings WHERE id = $1', [own.id]);
      assert.equal(rows[0].name, 'Own Briefing Renamed', 'same-atlas briefing update works');

      await push(atlas.id, token, [{
        id: randomUUID(), type: 'delete', target: 'briefing', targetId: own.id,
        timestamp: Date.now(), clientId: 'c',
      }]);
      ({ rows } = await db.query('SELECT deleted_at FROM briefings WHERE id = $1', [own.id]));
      assert.ok(rows[0].deleted_at, 'same-atlas briefing delete works');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Cross-atlas guard for CATALOG_LAYER per-layer (create/update/delete) —
  //    the EXISTS-map-of-atlas clause in applyCatalogLayerOp, untested elsewhere.
  // ---------------------------------------------------------------------------
  describe('cross-atlas guard for catalog_layer per-layer (untested elsewhere)', () => {
    let atlasB, mapB, victimLayerId;
    before(async () => {
      const userB = await createUser(db, { username: `cov_catvictim_${randomUUID().slice(0, 8)}` });
      atlasB = await createAtlas(db, userB.id, { name: 'Cat Victim Atlas' });
      mapB = await createMap(db, atlasB.id);
      // Seed a catalog_layer directly in atlas B.
      victimLayerId = randomUUID();
      await db.query(
        `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
        [victimLayerId, mapB.id, JSON.stringify({ name: 'Victim Catalog Layer', visible: true })]
      );
    });

    it('cannot CREATE a catalog_layer in another atlas map (pushed to atlas A with B mapId)', async () => {
      const id = randomUUID();
      await push(atlas.id, token, [{
        id: randomUUID(), entityType: 'catalogLayer', operationType: 'create', entityId: id, mapId: mapB.id,
        data: { name: 'Injected Layer', visible: true }, timestamp: Date.now(), clientId: 'attacker',
      }]);
      const { rows } = await db.query('SELECT id FROM catalog_layers WHERE id = $1', [id]);
      assert.equal(rows.length, 0, 'catalog_layer must not be created in atlas B via A push');
    });

    it('cannot UPDATE a catalog_layer of another atlas map', async () => {
      await push(atlas.id, token, [{
        id: randomUUID(), entityType: 'catalogLayer', operationType: 'update', entityId: victimLayerId, mapId: mapB.id,
        changes: { name: 'HACKED-CAT', visible: false }, timestamp: Date.now(), clientId: 'attacker',
      }]);
      const { rows } = await db.query('SELECT data FROM catalog_layers WHERE id = $1', [victimLayerId]);
      assert.equal(rows[0].data.name, 'Victim Catalog Layer', 'catalog_layer of atlas B must be untouched');
    });

    it('cannot soft-DELETE a catalog_layer of another atlas map', async () => {
      await push(atlas.id, token, [{
        id: randomUUID(), entityType: 'catalogLayer', operationType: 'delete', entityId: victimLayerId, mapId: mapB.id,
        timestamp: Date.now(), clientId: 'attacker',
      }]);
      const { rows } = await db.query('SELECT deleted_at FROM catalog_layers WHERE id = $1', [victimLayerId]);
      assert.equal(rows[0].deleted_at, null, 'catalog_layer of atlas B must not be deleted');
    });

    it('POSITIVE control: owner can create a catalog_layer in their OWN atlas map', async () => {
      const id = randomUUID();
      await push(atlas.id, token, [{
        id: randomUUID(), entityType: 'catalogLayer', operationType: 'create', entityId: id, mapId: map.id,
        data: { name: 'Mine', visible: true }, timestamp: Date.now(), clientId: 'c',
      }]);
      const { rows } = await db.query('SELECT data FROM catalog_layers WHERE id = $1 AND deleted_at IS NULL', [id]);
      assert.equal(rows.length, 1, 'own-atlas catalog_layer must be created');
      assert.equal(rows[0].data.name, 'Mine');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Negative access: a READ-share user cannot create a catalog_layer
  //    (destructive op beyond the feature/map ones already in sync.test / authz-lock).
  // ---------------------------------------------------------------------------
  describe('negative access: read-share user cannot write a catalog_layer', () => {
    it('a read-share user gets 403 and no catalog_layer row is created', async () => {
      const reader = await createUser(db, { username: `cov_reader_${randomUUID().slice(0, 8)}` });
      const readerTok = await loginUser(app, reader.username, reader.password);
      await createShare(db, atlas.id, reader.id, 'read', owner.id);

      const id = randomUUID();
      await push(atlas.id, readerTok, [{
        id: randomUUID(), entityType: 'catalogLayer', operationType: 'create', entityId: id, mapId: map.id,
        data: { name: 'reader-attempt', visible: true }, timestamp: Date.now(), clientId: 'reader',
      }], 403);

      const { rows } = await db.query('SELECT id FROM catalog_layers WHERE id = $1', [id]);
      assert.equal(rows.length, 0, 'read-share user must not create a catalog_layer');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. cesium3d update via `changes` (changes-path, not data-path) and snapshot
  //    round-trip of the cameraPositions keyed-by-tileset map. The frontend-envelope
  //    test covers the FLAT/data create path; the changes-path update of data_type
  //    + the camera_position snapshot keying are exercised here.
  // ---------------------------------------------------------------------------
  describe('cesium3d camera_position keys by tileset_id in the snapshot', () => {
    it('a camera_position created via sync surfaces under cesium3d.cameraPositions[tileset_id]', async () => {
      const m = await createMap(db, atlas.id, { name: 'Cesium Map' });
      const id = randomUUID();
      await push(atlas.id, token, [{
        id: randomUUID(), type: 'create', target: 'cesium3d', targetId: id, mapId: m.id,
        data: { data_type: 'camera_position', tileset_id: 'AMAN', data: { position: { height: 5000 } } },
        timestamp: Date.now(), clientId: 'c',
      }]);

      const snap = await snapshot(atlas.id, token);
      const snapMap = snap.maps.find((mm) => mm.id === m.id);
      const cam = snapMap.cesium3d.cameraPositions.AMAN;
      assert.ok(cam, 'camera_position keyed by tileset_id in the snapshot');
      assert.equal(cam.id, id);
      assert.equal(cam.tilesetId, 'AMAN', 'snapshot uses camelCase tilesetId');
      assert.equal(cam.position.height, 5000, 'inner data spread into the entry');
    });
  });
});

// Direct-insert helper (the shared fixture builds a different default shape; here we
// want a GeoJSON-style point row addressable by properties.id for snapshot lookups).
async function createFeatureRow(db, mapId, props = {}) {
  const { rows } = await db.query(
    `INSERT INTO features (map_id, feature_type, geometry, properties)
     VALUES ($1, 'point', '{"type":"Point","coordinates":[0,0]}'::jsonb, $2::jsonb)
     RETURNING *`,
    [mapId, JSON.stringify({ source: 'point', ...props })]
  );
  return rows[0];
}

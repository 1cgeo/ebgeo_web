// Path: tests/integration/atlas-gaps.test.js
// Gap tests for the Atlas subsystem (CRUD / public / clone / import / duplicate).
// Pins CURRENT behavior after this session's changes:
//  - errorHandler maps PG SQLSTATE -> 4xx (22P02->400, 23505->409, 23503->409, ...)
//  - cross-atlas access on duplicateMap -> 404
//  - clone resets is_public/public_link and copies no shares
//  - settings PATCH is a top-level shallow merge (sibling nested keys are lost)
//  - import strips unknown keys (stripUnknown), boundary validation on name/description
//  - map_order accepts arbitrary UUIDs verbatim (no membership check)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, loginUser, makeAtlasPublic, createShare,
} from '../helpers/fixtures.js';

const uniq = (p) => `${p}_${randomUUID().slice(0, 8)}`;

describe('Atlas Gaps', () => {
  let app, db, owner, ownerToken, other;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: uniq('gap_owner') });
    other = await createUser(db, { username: uniq('gap_other') });
    ownerToken = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------------------
  // atlas-01 / atlas-02: malformed UUID in :atlasId -> 400 (PG 22P02), not 500
  // ---------------------------------------------------------------------------
  describe('atlas-01/02: malformed :atlasId is a clean 4xx (not raw 500)', () => {
    it('GET /atlas/not-a-uuid -> 400 BAD_REQUEST envelope (not 500)', async () => {
      const res = await supertest(app)
        .get('/api/v1/atlas/not-a-uuid')
        .set('Authorization', `Bearer ${ownerToken}`);

      assert.notEqual(res.status, 500, 'must not leak a raw 500');
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
      assert.notEqual(res.body.error.code, 'INTERNAL_ERROR');
    });

    it('PUT /atlas/not-a-uuid -> 400 (not 500)', async () => {
      const res = await supertest(app)
        .put('/api/v1/atlas/not-a-uuid')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'x' });

      assert.notEqual(res.status, 500);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
    });

    it('DELETE /atlas/not-a-uuid -> 400 (not 500)', async () => {
      const res = await supertest(app)
        .delete('/api/v1/atlas/not-a-uuid')
        .set('Authorization', `Bearer ${ownerToken}`);

      assert.notEqual(res.status, 500);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // atlas-03: re-importing an atlas whose client UUIDs already exist
  //  -> clean 409 (PG 23505) AND no orphan atlas committed (tx rolls back).
  // ---------------------------------------------------------------------------
  describe('atlas-03: duplicate-id import is a clean 409 with full rollback', () => {
    it('second import with same map UUID -> 409, no orphan atlas/map', async () => {
      const mapId = randomUUID();
      const payload = {
        atlas: { name: uniq('Dup Import') },
        maps: [{
          id: mapId,
          name: 'Dup Map',
          base_layer: 'osm',
          center_lat: 0,
          center_long: 0,
          zoom: 5,
          features: [],
          layers: [],
          groups: [],
        }],
        briefings: [],
      };

      // First import succeeds.
      const first = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload)
        .expect(201);
      const firstAtlasId = first.body.data.id;

      // Count atlas rows for this owner before retry.
      const before = await db.query(
        'SELECT count(*)::int AS n FROM atlas WHERE owner_id = $1 AND deleted_at IS NULL',
        [owner.id]
      );

      // Re-import the SAME payload (same map UUID) -> PK conflict 23505.
      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);

      assert.notEqual(res.status, 500, 'duplicate id must not surface as 500');
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'CONFLICT');

      // No orphan atlas was committed by the failed transaction.
      const after = await db.query(
        'SELECT count(*)::int AS n FROM atlas WHERE owner_id = $1 AND deleted_at IS NULL',
        [owner.id]
      );
      assert.equal(after.rows[0].n, before.rows[0].n, 'no extra atlas committed');

      // The map still belongs only to the first atlas (no second copy).
      const maps = await db.query('SELECT atlas_id FROM maps WHERE id = $1', [mapId]);
      assert.equal(maps.rows.length, 1);
      assert.equal(maps.rows[0].atlas_id, firstAtlasId);
    });
  });

  // ---------------------------------------------------------------------------
  // atlas-04: duplicateMap with a mapId belonging to another atlas -> 404.
  // ---------------------------------------------------------------------------
  describe('atlas-04: duplicateMap is scoped to the route atlas', () => {
    it('mapId from atlas B against atlas A -> 404, no new map in A', async () => {
      const atlasA = await createAtlas(db, owner.id, { name: uniq('A') });
      const atlasB = await createAtlas(db, owner.id, { name: uniq('B') });
      const mapM = await createMap(db, atlasB.id, { name: 'M in B' });

      const beforeA = await db.query(
        'SELECT count(*)::int AS n FROM maps WHERE atlas_id = $1 AND deleted_at IS NULL',
        [atlasA.id]
      );

      await supertest(app)
        .post(`/api/v1/atlas/${atlasA.id}/maps/${mapM.id}/duplicate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      const afterA = await db.query(
        'SELECT count(*)::int AS n FROM maps WHERE atlas_id = $1 AND deleted_at IS NULL',
        [atlasA.id]
      );
      assert.equal(afterA.rows[0].n, beforeA.rows[0].n, 'no map duplicated into A');
    });

    it('malformed :mapId -> 400 (not 500)', async () => {
      const atlasA = await createAtlas(db, owner.id, { name: uniq('A2') });

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlasA.id}/maps/not-a-uuid/duplicate`)
        .set('Authorization', `Bearer ${ownerToken}`);

      assert.notEqual(res.status, 500);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
    });
  });

  // ---------------------------------------------------------------------------
  // atlas-07: clone resets public flag/link and copies no shares.
  // ---------------------------------------------------------------------------
  describe('atlas-07: clone is private and unshared', () => {
    it('cloning a public+shared atlas yields a private, unshared clone', async () => {
      const src = await createAtlas(db, owner.id, { name: uniq('Public Source') });
      await makeAtlasPublic(db, src.id);
      await createShare(db, src.id, other.id, 'read', owner.id);

      const res = await supertest(app)
        .post(`/api/v1/atlas/${src.id}/clone`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      const cloneId = res.body.data.id;
      assert.notEqual(cloneId, src.id);

      const cloneRow = await db.query(
        'SELECT is_public, public_link FROM atlas WHERE id = $1',
        [cloneId]
      );
      assert.equal(cloneRow.rows[0].is_public, false, 'clone must not be public');
      assert.equal(cloneRow.rows[0].public_link, null, 'clone must have no public link');

      const shares = await db.query(
        'SELECT count(*)::int AS n FROM atlas_shares WHERE atlas_id = $1',
        [cloneId]
      );
      assert.equal(shares.rows[0].n, 0, 'clone must carry no shares');
    });
  });

  // ---------------------------------------------------------------------------
  // atlas-08: empty PUT body still bumps version + updated_at (no-op semantics).
  // ---------------------------------------------------------------------------
  describe('atlas-08: empty PUT body bumps version (current behavior)', () => {
    it('PUT {} returns 200 and increments version by exactly 1', async () => {
      const atlas = await createAtlas(db, owner.id, { name: uniq('NoOp') });

      const baseline = await db.query(
        'SELECT version, updated_at FROM atlas WHERE id = $1',
        [atlas.id]
      );
      const v0 = baseline.rows[0].version;

      const res = await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(200);

      // Current behavior: version is unconditionally bumped.
      assert.equal(res.body.data.version, v0 + 1);

      const afterRow = await db.query(
        'SELECT version, updated_at FROM atlas WHERE id = $1',
        [atlas.id]
      );
      assert.equal(afterRow.rows[0].version, v0 + 1);
      assert.ok(
        afterRow.rows[0].updated_at >= baseline.rows[0].updated_at,
        'updated_at moved forward (or stayed) on a no-op PUT'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // atlas-09: settings PATCH is a TOP-LEVEL shallow merge -> sibling nested
  //  keys inside `features` are destroyed on the second PATCH.
  // ---------------------------------------------------------------------------
  describe('atlas-09: settings PATCH shallow-merge destroys sibling nested keys', () => {
    it('second features PATCH replaces the whole features object', async () => {
      const atlas = await createAtlas(db, owner.id, { name: uniq('Shallow') });

      await supertest(app)
        .patch(`/api/v1/atlas/${atlas.id}/settings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ features: { map_3d: false, panoramic_images: true, terrain_3d: false } })
        .expect(200);

      const res = await supertest(app)
        .patch(`/api/v1/atlas/${atlas.id}/settings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ features: { map_3d: true } })
        .expect(200);

      const features = res.body.data.settings.features;
      // The surviving key is the one in the last PATCH...
      assert.equal(features.map_3d, true);
      // ...and the sibling keys are GONE (shallow merge wipes them). This pins
      // the data-loss contract: clients must send the full `features` object.
      assert.equal(features.panoramic_images, undefined, 'sibling key lost on shallow merge');
      assert.equal(features.terrain_3d, undefined, 'sibling key lost on shallow merge');

      // Confirm against DB state (deterministic).
      const dbRow = await db.query('SELECT settings FROM atlas WHERE id = $1', [atlas.id]);
      const dbFeatures = dbRow.rows[0].settings.features;
      assert.deepEqual(dbFeatures, { map_3d: true });
    });
  });

  // ---------------------------------------------------------------------------
  // atlas-10: import strips unknown keys (stripUnknown) -> misspelled
  //  sub-entity key is silently dropped.
  // ---------------------------------------------------------------------------
  describe('atlas-10: import silently strips unknown/misspelled keys', () => {
    it('misspelled cesium3d_data is dropped; summary 0; DB has no rows', async () => {
      const mapId = randomUUID();
      const strayId = randomUUID();

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          atlas: { name: uniq('Stray Key') },
          maps: [{
            id: mapId,
            name: 'Stray Map',
            base_layer: 'osm',
            center_lat: 0,
            center_long: 0,
            zoom: 5,
            features: [],
            layers: [],
            groups: [],
            // wrong casing/spelling -> stripped before service sees it
            cesium3d_data: [{
              id: strayId,
              data_type: 'marker',
              tileset_id: 'PCL',
              data: { test: true },
            }],
          }],
          briefings: [],
        })
        .expect(201);

      assert.equal(res.body.data.summary.cesium3dImported, 0, 'stray key contributes nothing');

      const c = await db.query('SELECT count(*)::int AS n FROM cesium3d_data WHERE id = $1', [strayId]);
      assert.equal(c.rows[0].n, 0, 'no cesium row created from stripped key');

      const cAll = await db.query('SELECT count(*)::int AS n FROM cesium3d_data WHERE map_id = $1', [mapId]);
      assert.equal(cAll.rows[0].n, 0, 'no cesium rows for the imported map');
    });
  });

  // ---------------------------------------------------------------------------
  // atlas-11: boundary validation on name/description.
  // ---------------------------------------------------------------------------
  describe('atlas-11: create-atlas boundary validation', () => {
    it('empty name -> 422 VALIDATION_ERROR', async () => {
      const res = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: '' });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('name of 256 chars -> 422', async () => {
      const res = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'x'.repeat(256) });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('description of 5001 chars -> 422', async () => {
      const res = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: uniq('OK'), description: 'x'.repeat(5001) });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('name as a number -> 422', async () => {
      const res = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 123 });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('exactly-at-limit name (255) is accepted (201)', async () => {
      const res = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'x'.repeat(255) })
        .expect(201);
      assert.equal(res.body.data.name.length, 255);
    });

    it('HTML/SQL-ish name is stored verbatim, not crashing', async () => {
      const weird = `<b>'; DROP TABLE atlas;-- ${randomUUID().slice(0, 6)}`;
      const res = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: weird })
        .expect(201);
      assert.equal(res.body.data.name, weird);

      const row = await db.query('SELECT name FROM atlas WHERE id = $1', [res.body.data.id]);
      assert.equal(row.rows[0].name, weird);
    });
  });

  // ---------------------------------------------------------------------------
  // atlas-12: map_order accepts arbitrary UUIDs verbatim (no membership check).
  // ---------------------------------------------------------------------------
  describe('atlas-12: map_order accepts non-member UUIDs verbatim', () => {
    it('PUT map_order with a foreign UUID is stored and returned unchanged', async () => {
      const atlas = await createAtlas(db, owner.id, { name: uniq('Order') });
      const foreign = randomUUID(); // not a map of this atlas

      const res = await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ map_order: [foreign] })
        .expect(200);

      assert.deepEqual(res.body.data.map_order, [foreign], 'server stores arbitrary UUID verbatim');

      const getRes = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      assert.deepEqual(getRes.body.data.map_order, [foreign]);

      // DB confirms the column holds the foreign UUID (no FK rejects it).
      const row = await db.query('SELECT map_order FROM atlas WHERE id = $1', [atlas.id]);
      assert.deepEqual(row.rows[0].map_order, [foreign]);
    });

    it('PUT map_order with a non-UUID entry -> 422 (Joi rejects shape)', async () => {
      const atlas = await createAtlas(db, owner.id, { name: uniq('Order2') });
      const res = await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ map_order: ['not-a-uuid'] });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });
  });
});

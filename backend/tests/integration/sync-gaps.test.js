// Path: tests/integration/sync-gaps.test.js
// Integration tests for CONFIRMED gaps in the Sync CRDT subsystem (core + entity-ops).
// Each test asserts CURRENT behavior verified against src/modules/sync/*.
// Distinct from already-implemented sync-01; mirrors style of tests/integration/sync.test.js.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser,
  createAdminUser,
  createAtlas,
  createMap,
  createFeature,
  createGroup,
  createBriefing,
  loginUser,
  makeAtlasPublic,
  getPublicToken,
} from '../helpers/fixtures.js';

const uname = (p) => `${p}_${randomUUID().slice(0, 8)}`;

// Helper: push a batch of operations to an atlas as a given token.
function pushOps(app, atlasId, token, operations) {
  return supertest(app)
    .post(`/api/v1/atlas/${atlasId}/sync`)
    .set('Authorization', `Bearer ${token}`)
    .send({ operations });
}

// Helper: build a well-formed create-feature op.
function createFeatureOp(mapId, targetId, props = {}, ts = Date.now()) {
  return {
    id: randomUUID(),
    type: 'create',
    target: 'feature',
    targetId,
    mapId,
    data: {
      feature_type: 'point',
      geometry: { coordinates: [0, 0] },
      properties: props,
    },
    timestamp: ts,
    clientId: 'gap-client',
  };
}

describe('Sync CRDT — confirmed gaps', () => {
  let app, db;
  let user, admin, token, adminToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: uname('gap') });
    admin = await createAdminUser(db, { username: uname('gapadm') });
    token = await loginUser(app, user.username, user.password);
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // --- sync-03 / sync-04 (controller 404 mappings) ---------------------------
  describe('404 mapping for non-existent / soft-deleted atlas', () => {
    it('POST /sync on a random atlasId -> 404', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${randomUUID()}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({ operations: [createFeatureOp(randomUUID(), randomUUID())] })
        .expect(404);
    });

    it('GET /sync/0 on a random atlasId -> 404', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${randomUUID()}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('POST/GET sync on a soft-deleted atlas -> 404', async () => {
      const atlas = await createAtlas(db, user.id);
      await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlas.id]);

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({ operations: [createFeatureOp(randomUUID(), randomUUID())] })
        .expect(404);

      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('GET /sync/admin/stats on a random atlasId -> 404 (NOT_FOUND)', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${randomUUID()}/sync/admin/stats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('GET /sync/admin/stats on a soft-deleted atlas -> 404', async () => {
      const atlas = await createAtlas(db, user.id);
      await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlas.id]);
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/admin/stats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  // --- sync-04 (unknown entityType silently skipped) -------------------------
  describe('unknown entityType is acked, logged, bumps version, writes nothing', () => {
    it('bogus_type op succeeds, logs operation, no entity row, version bumps', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);

      const before = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const beforeVersion = before.body.data.currentVersion;

      const opId = randomUUID();
      const targetId = randomUUID();
      const res = await pushOps(app, atlas.id, token, [{
        id: opId,
        type: 'create',
        target: 'bogus_type',
        targetId,
        mapId: map.id,
        data: { foo: 'bar' },
        timestamp: Date.now(),
        clientId: 'gap-client',
      }]).expect(200);

      assert.equal(res.body.data.results[0].success, true);

      // (a) operation row exists for that op_id
      const ops = await db.query('SELECT * FROM operations WHERE atlas_id = $1 AND op_id = $2', [atlas.id, opId]);
      assert.equal(ops.rows.length, 1);

      // (b) nothing inserted into features (the most plausible misfire)
      const feats = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(feats.rows.length, 0);

      // (c) version increased
      assert.ok(res.body.data.serverVersion > beforeVersion);
    });
  });

  // --- sync-06 / sync-05 (idempotent ack pins ORIGINAL serverVersion) --------
  describe('idempotent replay pins original serverVersion, not the bumped one', () => {
    it('resend acks with the recorded version while top-level reflects current', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);

      const opId = randomUUID();
      const first = await pushOps(app, atlas.id, token, [{
        ...createFeatureOp(map.id, randomUUID()),
        id: opId,
      }]).expect(200);

      // acks[].serverVersion comes straight from the DB (may be a numeric string);
      // results[].currentVersion is the parsed int. Use the parsed value as truth.
      const v1 = first.body.data.results[0].currentVersion;
      assert.equal(first.body.data.acks[0].idempotent, false);
      assert.ok(typeof v1 === 'number' && v1 > 0);

      // Advance the atlas with several unrelated ops.
      for (let i = 0; i < 3; i++) {
        await pushOps(app, atlas.id, token, [createFeatureOp(map.id, randomUUID())]).expect(200);
      }

      // Resend the original op.
      const replay = await pushOps(app, atlas.id, token, [{
        ...createFeatureOp(map.id, randomUUID()),
        id: opId,
      }]).expect(200);

      assert.equal(replay.body.data.acks[0].idempotent, true);
      assert.equal(Number(replay.body.data.acks[0].serverVersion), v1);
      assert.equal(replay.body.data.results[0].idempotent, true);
      assert.equal(replay.body.data.results[0].currentVersion, v1);
      // Top-level serverVersion reflects the higher current atlas version.
      assert.ok(replay.body.data.serverVersion > v1);
    });
  });

  // --- sync-07 / sync-06 (LWW by arrival order) ------------------------------
  describe('LWW by arrival order (timestamp ignored)', () => {
    it('within one batch, the LAST update wins even with an older timestamp', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);
      const f = await createFeature(db, map.id, { properties: { name: 'orig' } });

      await pushOps(app, atlas.id, token, [
        {
          id: randomUUID(), type: 'update', target: 'feature', targetId: f.id, mapId: map.id,
          changes: { properties: { name: 'B' } }, timestamp: 2000, clientId: 'c',
        },
        {
          id: randomUUID(), type: 'update', target: 'feature', targetId: f.id, mapId: map.id,
          changes: { properties: { name: 'A' } }, timestamp: 1000, clientId: 'c',
        },
      ]).expect(200);

      const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [f.id]);
      assert.equal(rows[0].properties.name, 'A');
    });

    it('update arriving AFTER delete mutates the row but deleted_at stays set', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);
      const f = await createFeature(db, map.id, { properties: { name: 'orig' } });

      await pushOps(app, atlas.id, token, [
        { id: randomUUID(), type: 'delete', target: 'feature', targetId: f.id, mapId: map.id, timestamp: 1, clientId: 'c' },
        {
          id: randomUUID(), type: 'update', target: 'feature', targetId: f.id, mapId: map.id,
          changes: { properties: { x: 1 } }, timestamp: 2, clientId: 'c',
        },
      ]).expect(200);

      const { rows } = await db.query('SELECT deleted_at, properties FROM features WHERE id = $1', [f.id]);
      assert.ok(rows[0].deleted_at, 'still soft-deleted (delete wins by arrival)');
      assert.equal(rows[0].properties.x, 1, 'update still mutated the row');
    });

    it('create with ON CONFLICT (id) DO NOTHING does not overwrite existing data', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);
      const f = await createFeature(db, map.id, { properties: { name: 'original' } });

      await pushOps(app, atlas.id, token, [{
        id: randomUUID(), type: 'create', target: 'feature', targetId: f.id, mapId: map.id,
        data: { feature_type: 'point', geometry: { coordinates: [9, 9] }, properties: { name: 'overwritten' } },
        timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [f.id]);
      assert.equal(rows[0].properties.name, 'original');
    });
  });

  // --- sync-08 / sync-02 / sync-11 (batch atomicity / full rollback) ---------
  describe('batch atomicity — a failing op rolls back the entire batch and log', () => {
    it('NOT NULL violation mid-batch rolls back earlier+later ops and operations rows', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);

      const f1 = randomUUID();
      const f3 = randomUUID();
      const op1Id = randomUUID();
      const op2Id = randomUUID();
      const op3Id = randomUUID();

      const res = await pushOps(app, atlas.id, token, [
        { ...createFeatureOp(map.id, f1), id: op1Id },
        // op2: feature create with no feature_type -> NOT NULL violation on insert
        {
          id: op2Id, type: 'create', target: 'feature', targetId: randomUUID(), mapId: map.id,
          data: { geometry: { coordinates: [0, 0] }, properties: {} },
          timestamp: Date.now(), clientId: 'c',
        },
        { ...createFeatureOp(map.id, f3), id: op3Id },
      ]);

      assert.notEqual(res.status, 200, `expected failure, got ${res.status}`);

      // Full rollback: neither F1 nor F3 exists.
      const feats = await db.query('SELECT id FROM features WHERE id = ANY($1::uuid[])', [[f1, f3]]);
      assert.equal(feats.rows.length, 0);

      // Operations log untouched for all three op ids.
      const ops = await db.query('SELECT op_id FROM operations WHERE atlas_id = $1 AND op_id = ANY($2::text[])',
        [atlas.id, [op1Id, op2Id, op3Id]]);
      assert.equal(ops.rows.length, 0);
    });
  });

  // --- sync-03 / sync-12 (cleanup raises min_version -> pull becomes snapshot) -
  describe('admin cleanup lifecycle: raises min_version and forces snapshot on stale pull', () => {
    it('keepFromVersion=V deletes old ops, sets min_version=V, stale pull -> snapshot', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);

      // Push several ops to advance version to V.
      for (let i = 0; i < 5; i++) {
        await pushOps(app, atlas.id, token, [createFeatureOp(map.id, randomUUID())]).expect(200);
      }
      const stat = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/admin/stats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const V = stat.body.data.currentVersion;
      assert.ok(V >= 5);

      const cleanup = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync/admin/cleanup`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ keepFromVersion: V })
        .expect(200);

      assert.ok(cleanup.body.data.deletedCount > 0);
      assert.equal(cleanup.body.data.newMinVersion, V);

      const { rows: minRows } = await db.query('SELECT min_version FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(Number(minRows[0].min_version), V);

      // Operations with server_version < V are gone.
      const { rows: oldOps } = await db.query(
        'SELECT count(*)::int AS c FROM operations WHERE atlas_id = $1 AND server_version < $2', [atlas.id, V]);
      assert.equal(oldOps[0].c, 0);

      // Pull from a now-stale version falls back to a snapshot (owner reads).
      const pull = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${V - 1}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.equal(pull.body.data.isSnapshot, true);
      assert.ok(pull.body.data.snapshot);
    });

    it('keepFromVersion=0 returns deletedCount 0 and does NOT lower min_version', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);
      await pushOps(app, atlas.id, token, [createFeatureOp(map.id, randomUUID())]).expect(200);

      // Raise min_version first so we can prove it is not lowered.
      const stat = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/admin/stats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const V = stat.body.data.currentVersion;
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync/admin/cleanup`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ keepFromVersion: V })
        .expect(200);

      // keepFromVersion=0 -> deleteBeforeVersion <= 0 -> early return, no min_version write.
      //
      // Este comentário estava ERRADO até 2026-07-25, e o teste passava pelo motivo
      // errado: o controller fazia `keepFromVersion ? ... : undefined`, então o zero
      // caía como falsy e o serviço rodava o ramo `keepDays` — o early-return acima
      // era INALCANÇÁVEL por HTTP. O verde vinha de o atlas deste teste só ter ops
      // recentes, que o expurgo de 7 dias por acaso não apagava. O controller foi
      // corrigido (o zero agora chega como zero) e a rota alcança de fato este ramo.
      // A borda em que os dois caminhos se distinguem é medida em
      // tests/integration/sync-cleanup-boundaries.test.js, com uma op de 30 dias.
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync/admin/cleanup`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ keepFromVersion: 0 })
        .expect(200);
      assert.equal(res.body.data.deletedCount, 0);

      const { rows } = await db.query('SELECT min_version FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(Number(rows[0].min_version), V, 'min_version unchanged by keepFromVersion=0');
    });
  });

  // --- sync-09 (anon / public-read-token write blocked over HTTP) ------------
  describe('anonymous / public-read-token cannot push over HTTP, read still works', () => {
    it('public read token push -> 403, no-token push -> 401, public read pull -> 200', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);
      const link = await makeAtlasPublic(db, atlas.id);
      const pubToken = await getPublicToken(app, link);

      const targetId = randomUUID();
      // (1) public read token cannot write.
      await pushOps(app, atlas.id, pubToken, [createFeatureOp(map.id, targetId)]).expect(403);
      const feats = await db.query('SELECT id FROM features WHERE id = $1', [targetId]);
      assert.equal(feats.rows.length, 0);

      // (2) no Authorization header -> 401 (auth is strict on write).
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .send({ operations: [createFeatureOp(map.id, randomUUID())] })
        .expect(401);

      // (3) public read token can still pull.
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${pubToken}`)
        .expect(200);
    });
  });

  // --- sync-10 (missing parent in same atlas: silent no-op, success ack) -----
  describe('slide create with missing briefing in same atlas is silently dropped', () => {
    it('acks success but inserts zero slide rows', async () => {
      const atlas = await createAtlas(db, user.id);
      const slideId = randomUUID();

      const res = await pushOps(app, atlas.id, token, [{
        id: randomUUID(), type: 'create', target: 'slide', targetId: slideId,
        data: { briefing_id: randomUUID(), title: 'Orphan' },
        timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      assert.equal(res.body.data.results[0].success, true);
      const { rows } = await db.query('SELECT id FROM slides WHERE id = $1', [slideId]);
      assert.equal(rows.length, 0, 'slide silently dropped (briefing did not exist)');
    });
  });

  // --- sync-12 (snapshot filters orphaned/soft-deleted group_feature refs) ---
  describe('snapshot omits group.features refs to soft-deleted features', () => {
    it('group.features has no ref to the deleted feature and no type:null entry', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);
      const g = await createGroup(db, map.id);
      const f = await createFeature(db, map.id, { feature_type: 'point' });
      await db.query('INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)', [g.id, f.id]);
      await db.query('UPDATE features SET deleted_at = NOW() WHERE id = $1', [f.id]);

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const mapData = res.body.data.snapshot.maps.find((m) => m.id === map.id);
      const group = mapData.groups.find((gr) => gr.id === g.id);
      assert.ok(group, 'group present in snapshot');
      assert.ok(!group.features.some((ref) => ref.id === f.id), 'dangling ref omitted');
      assert.ok(!group.features.some((ref) => ref.type === null), 'no type:null entry');
    });
  });

  // --- sync-16 (intra-batch delete-then-update / update-then-delete) ---------
  describe('intra-batch ordering: update after delete keeps row deleted; update before delete ends deleted', () => {
    it('[delete F, update F] => deleted_at set AND update applied AND version bumped twice', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);
      const f = await createFeature(db, map.id, { properties: { name: 'before' } });
      const v0 = (await db.query('SELECT version FROM features WHERE id = $1', [f.id])).rows[0].version;

      await pushOps(app, atlas.id, token, [
        { id: randomUUID(), type: 'delete', target: 'feature', targetId: f.id, mapId: map.id, timestamp: 1, clientId: 'c' },
        {
          id: randomUUID(), type: 'update', target: 'feature', targetId: f.id, mapId: map.id,
          changes: { properties: { name: 'after' } }, timestamp: 2, clientId: 'c',
        },
      ]).expect(200);

      const { rows } = await db.query('SELECT deleted_at, properties, version FROM features WHERE id = $1', [f.id]);
      assert.ok(rows[0].deleted_at, 'still deleted');
      assert.equal(rows[0].properties.name, 'after', 'update still applied');
      assert.equal(Number(rows[0].version), Number(v0) + 2, 'version bumped twice');
    });

    it('[update G, delete G] => G ends soft-deleted', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);
      const g = await createFeature(db, map.id, { properties: { name: 'g' } });

      await pushOps(app, atlas.id, token, [
        {
          id: randomUUID(), type: 'update', target: 'feature', targetId: g.id, mapId: map.id,
          changes: { properties: { name: 'edited' } }, timestamp: 1, clientId: 'c',
        },
        { id: randomUUID(), type: 'delete', target: 'feature', targetId: g.id, mapId: map.id, timestamp: 2, clientId: 'c' },
      ]).expect(200);

      const { rows } = await db.query('SELECT deleted_at FROM features WHERE id = $1', [g.id]);
      assert.ok(rows[0].deleted_at);
    });
  });

  // --- sync-09 (pull version param coercion) ---------------------------------
  describe('pull :version coercion (NaN / negative / huge) is deterministic', () => {
    let atlas, map;
    before(async () => {
      atlas = await createAtlas(db, user.id);
      map = await createMap(db, atlas.id);
      await pushOps(app, atlas.id, token, [createFeatureOp(map.id, randomUUID())]).expect(200);
    });

    it('GET /sync/abc -> 200 snapshot (NaN || 0)', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/abc`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.equal(res.body.data.isSnapshot, true);
    });

    it('GET /sync/-5 -> 200 snapshot (< minVersion)', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/-5`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.equal(res.body.data.isSnapshot, true);
    });

    it('GET /sync/<current+1000> -> 200 incremental with empty operations', async () => {
      const stat = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const cur = stat.body.data.currentVersion;
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${cur + 1000}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.equal(res.body.data.isSnapshot, false);
      assert.deepEqual(res.body.data.operations, []);
    });
  });

  // --- sync-15 (catalogLayer tombstone: update no-op, id-reuse blocked) ------
  describe('catalogLayer tombstone semantics (LWW + ON CONFLICT DO NOTHING)', () => {
    // Asymmetry by design, aligned with every other entity since 2026-07-19:
    //   update after delete -> still a no-op (guarded by `deleted_at IS NULL`),
    //   create reusing the id -> RESURRECTS (this is the undo/re-add path).
    // Re-adding a catalog layer that was previously removed from a map is an
    // ordinary gesture, and leaving it tombstoned made the layer un-re-addable
    // for the lifetime of the map while still acking success.
    it('update after delete does not resurrect; create reusing id revives the row', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);
      const layerId = randomUUID();

      // create
      await pushOps(app, atlas.id, token, [{
        id: randomUUID(), type: 'create', target: 'catalogLayer', targetId: layerId, mapId: map.id,
        data: { name: 'orig', visible: false }, timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      // delete
      await pushOps(app, atlas.id, token, [{
        id: randomUUID(), type: 'delete', target: 'catalogLayer', targetId: layerId, mapId: map.id,
        timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      // (a) update after delete -> no-op (guarded by deleted_at IS NULL)
      await pushOps(app, atlas.id, token, [{
        id: randomUUID(), type: 'update', target: 'catalogLayer', targetId: layerId, mapId: map.id,
        changes: { name: 'resurrected', visible: true }, timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      let { rows } = await db.query('SELECT data, deleted_at FROM catalog_layers WHERE id = $1', [layerId]);
      assert.equal(rows.length, 1);
      assert.ok(rows[0].deleted_at, 'still deleted (update did not resurrect)');
      assert.equal(rows[0].data.name, 'orig', 'data unchanged');

      // (b) create reusing the id -> revives the row and adopts the new payload
      await pushOps(app, atlas.id, token, [{
        id: randomUUID(), type: 'create', target: 'catalogLayer', targetId: layerId, mapId: map.id,
        data: { name: 'fresh', visible: true }, timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      ({ rows } = await db.query('SELECT data, deleted_at FROM catalog_layers WHERE id = $1', [layerId]));
      assert.equal(rows.length, 1, 'still exactly one row');
      assert.equal(rows[0].deleted_at, null, 'revived: deleted_at cleared');
      assert.equal(rows[0].data.name, 'fresh', 'the re-add payload wins over the pre-delete data');
    });
  });

  // --- sync-18 (orphan write under a soft-deleted parent map) ----------------
  describe('child write under a soft-deleted parent map still mutates the child', () => {
    it('update of a feature whose map is soft-deleted writes the field; snapshot omits both', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);
      const f = await createFeature(db, map.id, { properties: { name: 'orig' } });

      // Soft-delete the map via sync.
      await pushOps(app, atlas.id, token, [{
        id: randomUUID(), type: 'delete', target: 'map', targetId: map.id, mapId: map.id,
        timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      // Late update of a child of the now-dead map (current behavior: still applies).
      await pushOps(app, atlas.id, token, [{
        id: randomUUID(), type: 'update', target: 'feature', targetId: f.id, mapId: map.id,
        changes: { properties: { x: 1 } }, timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [f.id]);
      assert.equal(rows[0].properties.x, 1, 'child row mutated even under dead parent');

      // Snapshot omits the deleted map (and therefore the feature).
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.ok(!res.body.data.snapshot.maps.some((m) => m.id === map.id), 'dead map omitted');
    });
  });

  // --- sync-02 / sync-19 (cross-atlas references on create/update) -----------
  describe('cross-atlas references via group.parent_id / slide.map_id', () => {
    it('group create with parent_id pointing at another atlas persists the FK (no scoping)', async () => {
      // This documents CURRENT behavior: parent_id is inserted verbatim (FK only
      // guarantees the row exists, not that it belongs to this atlas).
      const atlasA = await createAtlas(db, user.id);
      const mapA = await createMap(db, atlasA.id);
      const atlasB = await createAtlas(db, user.id);
      const mapB = await createMap(db, atlasB.id);
      const groupB = await createGroup(db, mapB.id);

      const groupId = randomUUID();
      await pushOps(app, atlasA.id, token, [{
        id: randomUUID(), type: 'create', target: 'group', targetId: groupId, mapId: mapA.id,
        data: { name: 'with-foreign-parent', parent_id: groupB.id },
        timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      const { rows } = await db.query('SELECT parent_id FROM groups WHERE id = $1', [groupId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].parent_id, groupB.id, 'cross-atlas parent_id stored verbatim (current behavior)');
    });

    it('group update setting parent_id to its own id is persisted (self-reference, no cycle guard)', async () => {
      const atlas = await createAtlas(db, user.id);
      const map = await createMap(db, atlas.id);
      const g = await createGroup(db, map.id);

      await pushOps(app, atlas.id, token, [{
        id: randomUUID(), type: 'update', target: 'group', targetId: g.id, mapId: map.id,
        changes: { parent_id: g.id }, timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      // Snapshot build must not crash and the group still appears.
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const mapData = res.body.data.snapshot.maps.find((m) => m.id === map.id);
      const group = mapData.groups.find((gr) => gr.id === g.id);
      assert.ok(group, 'self-referencing group still present in snapshot');
      assert.equal(group.parent_id, g.id);
    });

    it('slide create with cross-atlas map_id is stored verbatim (only briefing_id is scoped)', async () => {
      const atlasA = await createAtlas(db, user.id);
      const briefingA = await createBriefing(db, atlasA.id);
      const atlasB = await createAtlas(db, user.id);
      const mapB = await createMap(db, atlasB.id);

      const slideId = randomUUID();
      await pushOps(app, atlasA.id, token, [{
        id: randomUUID(), type: 'create', target: 'slide', targetId: slideId,
        data: { briefing_id: briefingA.id, title: 'cross', map_id: mapB.id },
        timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      const { rows } = await db.query('SELECT map_id FROM slides WHERE id = $1', [slideId]);
      assert.equal(rows.length, 1, 'slide created (briefing belongs to atlasA)');
      assert.equal(rows[0].map_id, mapB.id, 'cross-atlas map_id stored verbatim (no detection — current behavior)');
    });
  });
});

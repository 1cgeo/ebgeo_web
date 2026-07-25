// Path: tests/integration/maps-merge-keyed-duplicates.test.js
//
// INVARIANT PINNED HERE (bugs-backend #83): after a merge, a destination map holds AT MOST
// ONE live row per logical key, for the two row shapes the snapshot keys by a VALUE instead
// of by row id — `cesium3d_data` camera positions (keyed by `tileset_id`) and
// `streetview360_data` orientations (keyed by `photo_name`). And, independently: the
// snapshot resolves any duplicate that still exists DETERMINISTICALLY.
//
// Why it is worth its own file. `mergeMaps` re-parented rows with a plain
// `UPDATE ... SET map_id`, which cannot deduplicate. Merging a source that defines the
// camera position for tileset X into a destination that also defines it left two live rows,
// and `transformCesium3dToFrontend` writes `cameraPositions[tileset_id] = entry` — so one
// of the two simply overwrote the other. Which one? Whichever the snapshot query returned
// last, and neither query had an ORDER BY, so the answer was the planner's row order. The
// user's symptom: a 3D camera preset (or a 360 orientation) disappears after the merge, and
// can COME BACK on its own much later, after any UPDATE that moves rows physically in the
// heap. Nothing errors, nothing logs, and the cause is nowhere near the symptom.
//
// The fix has two halves and this file tests them separately, because either one alone
// leaves a hole:
//   · maps.service.js KEYED_SINGLETONS — resolve collisions by soft-delete BEFORE moving,
//     so the duplicate is never created. Ranking: the destination's own row wins; among
//     sources the most recently updated wins; `id` breaks exact ties.
//   · sync.queries.js ORDER BY — duplicates predating the fix (and any future writer) still
//     resolve the same way on every read instead of flipping.
//
// NEGATIVE CONTROL (re-run whenever either half changes): copy the two files aside, delete
// the KEYED_SINGLETONS loop from `mergeMaps` and the two ORDER BY clauses, and restore from
// the copies afterwards (never `git checkout` — other agents share this tree).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createCesium3dData, createStreetview360Data, loginUser,
} from '../helpers/fixtures.js';

describe('a merge never leaves two rows fighting over one snapshot key', () => {
  let app, db, owner, token, atlas;

  const merge = (destId, sourceMapIds) => supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/maps/${destId}/merge`)
    .set('Authorization', `Bearer ${token}`)
    .send({ sourceMapIds });

  const snapshotMap = async (mapId) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.snapshot.maps.find((m) => m.id === mapId);
  };

  const liveRows = async (table, mapId) => {
    const { rows } = await db.query(
      `SELECT id, data, deleted_at FROM ${table} WHERE map_id = $1 AND deleted_at IS NULL ORDER BY id`,
      [mapId]
    );
    return rows;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const tag = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `p83_owner_${tag}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `P83 ${tag}` });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ── cesium3d camera positions, keyed by tileset_id ─────────────────────────
  it('a camera position colliding with the destination leaves ONE live row, and it is the destination\'s', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    const kept = await createCesium3dData(db, dest.id, {
      data_type: 'camera_position', tileset_id: 'PCL', data: { heading: 10, from: 'dest' },
    });
    const dropped = await createCesium3dData(db, src.id, {
      data_type: 'camera_position', tileset_id: 'PCL', data: { heading: 99, from: 'src' },
    });
    // The source row is the FRESHER one: the destination must win on rank, not by accident
    // of timestamps.
    await db.query(`UPDATE cesium3d_data SET updated_at = NOW() + INTERVAL '1 hour' WHERE id = $1`, [dropped.id]);

    const res = await merge(dest.id, [src.id]).expect(200);
    assert.equal(res.body.data.deduped.cesium3d_data, 1, 'the collision is reported, not silent');

    const live = await liveRows('cesium3d_data', dest.id);
    assert.equal(live.length, 1, 'exactly one live camera position survives in the destination');
    assert.equal(live[0].id, kept.id, 'the destination keeps its own view');
    assert.equal(live[0].data.from, 'dest');

    const { rows: loser } = await db.query(
      'SELECT map_id, deleted_at, version FROM cesium3d_data WHERE id = $1', [dropped.id]
    );
    assert.notEqual(loser[0].deleted_at, null, 'the loser is soft-deleted, never hard-deleted');
    assert.equal(loser[0].map_id, src.id, 'and stays behind rather than moving in dead');
    assert.equal(loser[0].version, 2, 'the tombstone is versioned, so peers converge on it');

    const snap = await snapshotMap(dest.id);
    assert.deepEqual(
      Object.keys(snap.cesium3d.cameraPositions), ['PCL'],
      'and the client sees exactly one entry under the key'
    );
    assert.equal(snap.cesium3d.cameraPositions.PCL.id, kept.id);
  });

  it('two SOURCES colliding with each other resolve to the most recently updated', async () => {
    const dest = await createMap(db, atlas.id);
    const srcA = await createMap(db, atlas.id);
    const srcB = await createMap(db, atlas.id);
    const older = await createCesium3dData(db, srcA.id, {
      data_type: 'camera_position', tileset_id: 'OM', data: { from: 'A' },
    });
    const newer = await createCesium3dData(db, srcB.id, {
      data_type: 'camera_position', tileset_id: 'OM', data: { from: 'B' },
    });
    await db.query(`UPDATE cesium3d_data SET updated_at = NOW() - INTERVAL '1 day' WHERE id = $1`, [older.id]);

    const res = await merge(dest.id, [srcA.id, srcB.id]).expect(200);
    assert.equal(res.body.data.deduped.cesium3d_data, 1);

    const live = await liveRows('cesium3d_data', dest.id);
    assert.equal(live.length, 1);
    assert.equal(live[0].id, newer.id, 'the destination was empty, so the freshest source wins');
  });

  // ── streetview360 orientations, keyed by photo_name ────────────────────────
  it('a 360 orientation colliding with the destination leaves ONE live row', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    const kept = await createStreetview360Data(db, dest.id, {
      data_type: 'orientation', photo_name: 'foto-777', data: { heading: 5 },
    });
    const dropped = await createStreetview360Data(db, src.id, {
      data_type: 'orientation', photo_name: 'foto-777', data: { heading: 300 },
    });

    const res = await merge(dest.id, [src.id]).expect(200);
    assert.equal(res.body.data.deduped.streetview360_data, 1);

    const live = await liveRows('streetview360_data', dest.id);
    assert.equal(live.length, 1);
    assert.equal(live[0].id, kept.id);

    const { rows: loser } = await db.query(
      'SELECT deleted_at FROM streetview360_data WHERE id = $1', [dropped.id]
    );
    assert.notEqual(loser[0].deleted_at, null);

    const snap = await snapshotMap(dest.id);
    assert.deepEqual(Object.keys(snap.streetview360.orientations), ['foto-777']);
    assert.equal(snap.streetview360.orientations['foto-777'].id, kept.id);
  });

  // ── what must NOT be deduplicated ──────────────────────────────────────────
  // The other data_types land in ARRAYS keyed by row id, so they never collide. Deduplicating
  // them would silently delete user data — which is why the whitelist is by data_type and not
  // by table, and why this is the assertion that would catch a "simplification" of it.
  it('markers/measurements/viewsheds sharing a tileset are ALL kept — they are not keyed', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    await createCesium3dData(db, dest.id, { data_type: 'marker', tileset_id: 'SAME' });
    await createCesium3dData(db, src.id, { data_type: 'marker', tileset_id: 'SAME' });
    await createCesium3dData(db, src.id, { data_type: 'measurement', tileset_id: 'SAME' });
    await createCesium3dData(db, src.id, { data_type: 'viewshed', tileset_id: 'SAME' });

    const res = await merge(dest.id, [src.id]).expect(200);
    assert.equal(res.body.data.deduped.cesium3d_data, 0, 'nothing to resolve');
    assert.equal(res.body.data.moved.cesium3d_data, 3);

    const live = await liveRows('cesium3d_data', dest.id);
    assert.equal(live.length, 4, 'every marker/measurement/viewshed survives');

    const snap = await snapshotMap(dest.id);
    assert.equal(snap.cesium3d.markers.length, 2);
    assert.equal(snap.cesium3d.measurements.length, 1);
    assert.equal(snap.cesium3d.viewsheds.length, 1);
  });

  it('a 360 marker sharing a photo_name with an orientation is untouched', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    await createStreetview360Data(db, dest.id, { data_type: 'marker', photo_name: 'foto-888' });
    await createStreetview360Data(db, src.id, { data_type: 'marker', photo_name: 'foto-888' });
    await createStreetview360Data(db, src.id, { data_type: 'orientation', photo_name: 'foto-888' });

    const res = await merge(dest.id, [src.id]).expect(200);
    assert.equal(res.body.data.deduped.streetview360_data, 0, 'markers do not collide with an orientation');

    const live = await liveRows('streetview360_data', dest.id);
    assert.equal(live.length, 3);
  });

  // A camera position with no tileset_id falls back to the ROW ID as its snapshot key
  // (transformCesium3dToFrontend), which is unique by construction. Deduplicating those would
  // delete distinct entries that were never in conflict.
  it('camera positions with a NULL tileset_id are all kept — their key is the row id', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    const a = await createCesium3dData(db, dest.id, { data_type: 'camera_position', tileset_id: null });
    const b = await createCesium3dData(db, src.id, { data_type: 'camera_position', tileset_id: null });

    const res = await merge(dest.id, [src.id]).expect(200);
    assert.equal(res.body.data.deduped.cesium3d_data, 0);

    const live = await liveRows('cesium3d_data', dest.id);
    assert.equal(live.length, 2);

    const snap = await snapshotMap(dest.id);
    assert.deepEqual(
      Object.keys(snap.cesium3d.cameraPositions).sort(), [a.id, b.id].sort(),
      'both are addressable, under their row ids'
    );
  });

  // ── the snapshot half: which duplicate wins, and by which rule ─────────────
  //
  // Duplicates predating the dedupe are still out there, and the snapshot has to resolve
  // them the SAME WAY on every read. Without ORDER BY, "the same way" means "however the
  // rows happen to come back": measured on this schema the plan is an index scan on
  // idx_cesium3d_map, so the order is INSERTION order — which is not created_at order and
  // not any rule anyone chose. The two are separated here on purpose: the newer row is
  // inserted FIRST and then backdated, so storage order and created_at order disagree, and a
  // query without ORDER BY answers with the wrong row rather than merely an unstable one.
  //
  // (Storage order is also not stable over time, which is the other half of the symptom —
  // it just cannot be forced from a test: an UPDATE that touches no indexed column is a HOT
  // update, and the index keeps pointing at the original tuple. Asserting the RULE covers
  // both, and does not depend on a planner choice.)
  it('a pre-existing duplicate resolves by created_at, not by storage order', async () => {
    const map = await createMap(db, atlas.id);
    const winner = await createCesium3dData(db, map.id, {
      data_type: 'camera_position', tileset_id: 'LEGACY', data: { from: 'newest' },
    });
    const older = await createCesium3dData(db, map.id, {
      data_type: 'camera_position', tileset_id: 'LEGACY', data: { from: 'older' },
    });
    // `older` is stored AFTER `winner` but is now logically older: the two orders disagree.
    await db.query(
      `UPDATE cesium3d_data SET created_at = created_at - INTERVAL '1 hour' WHERE id = $1`,
      [older.id]
    );

    const first = (await snapshotMap(map.id)).cesium3d.cameraPositions.LEGACY;
    assert.equal(
      first.id, winner.id,
      'the newest row must answer the key — reading it back in storage order returns `older`'
    );
    assert.equal(first.from, 'newest');

    // And it is stable across reads, which is the property the user actually experiences.
    const second = (await snapshotMap(map.id)).cesium3d.cameraPositions.LEGACY;
    assert.equal(second.id, first.id, 'the same read must not answer differently twice');
  });

  it('the same rule resolves a duplicated 360 orientation', async () => {
    const map = await createMap(db, atlas.id);
    const winner = await createStreetview360Data(db, map.id, {
      data_type: 'orientation', photo_name: 'legacy-360', data: { heading: 1 },
    });
    const older = await createStreetview360Data(db, map.id, {
      data_type: 'orientation', photo_name: 'legacy-360', data: { heading: 2 },
    });
    await db.query(
      `UPDATE streetview360_data SET created_at = created_at - INTERVAL '1 hour' WHERE id = $1`,
      [older.id]
    );

    const resolved = (await snapshotMap(map.id)).streetview360.orientations['legacy-360'];
    assert.equal(resolved.id, winner.id);
    assert.equal(resolved.heading, 1);
  });

  // The marker op is what an offline peer replays instead of the bulk UPDATE; a collision
  // resolved by soft-delete is a data loss the log has to name.
  it('the merge marker operation records the collisions it resolved', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    await createCesium3dData(db, dest.id, { data_type: 'camera_position', tileset_id: 'AUDIT' });
    await createCesium3dData(db, src.id, { data_type: 'camera_position', tileset_id: 'AUDIT' });

    await merge(dest.id, [src.id]).expect(200);

    const { rows } = await db.query(
      `SELECT data FROM operations
       WHERE atlas_id = $1 AND entity_type = 'map_merge' AND entity_id = $2
       ORDER BY server_version DESC LIMIT 1`,
      [atlas.id, dest.id]
    );
    assert.equal(rows.length, 1, 'the merge wrote its marker');
    assert.equal(rows[0].data.deduped.cesium3d_data, 1);
  });
});

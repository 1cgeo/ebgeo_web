// Path: tests/integration/maps-merge-oplog.repro.test.js
// Regression: a map merge left no trace in the sync log, so a peer that was offline
// during it never converged.
//
// `mergeMaps` moved the rows of six child tables with plain UPDATEs and wrote
// nothing to `operations`, so the trigger that maintains `atlas.current_version`
// (003_sync.sql:54-69) never fired. The only signal was the ephemeral `maps_merged`
// broadcast, which reaches sockets connected at that instant.
//
// For a peer that missed it, the reconnect replay was empty BY CONSTRUCTION:
// `sync_request {lastVersion: N}` → `pullOperations` sees N === current_version,
// takes the incremental branch, and answers `{operations: []}`. The peer concludes
// it is up to date and keeps rendering the features under the OLD map indefinitely,
// while Postgres and every other peer have them under the new one. Only an F5 (pull
// from version 0, which forces the snapshot branch) repaired it.
//
// This is the concrete cost of the invariant the route breaks: a REST write path for
// a collaborative entity produces state that the sync channel cannot express.
//
// The fix logs a MARKER op inside the merge transaction. It is not a per-entity op —
// the rows moved in bulk and no per-entity op describes that — so peers resolve it by
// taking a snapshot, the same resolution the live broadcast already triggers. The
// frontend half is STRUCTURAL_RESYNC_OPS in sync-engine.js; this file guards the
// server half, which is what makes the replay non-empty in the first place.
//
// Negative control: remove the INSERT_OPERATION call from mergeMaps and every test
// below fails.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createFeature, loginUser,
} from '../helpers/fixtures.js';

describe('a map merge is visible to a peer that reconnects (repro)', () => {
  let app, db, owner, ownerTok, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `oplog_${randomUUID().slice(0, 8)}` });
    ownerTok = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Atlas Merge Oplog' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const currentVersion = async () =>
    parseInt((await db.query('SELECT current_version FROM atlas WHERE id = $1', [atlas.id]))
      .rows[0].current_version, 10);

  const merge = (destId, sourceMapIds) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${destId}/merge`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ sourceMapIds });

  const pullSince = (version) =>
    supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/${version}`)
      .set('Authorization', `Bearer ${ownerTok}`);

  it('advances atlas.current_version, so the version stops claiming nothing happened', async () => {
    const dest = await createMap(db, atlas.id, { name: 'dest-v' });
    const src = await createMap(db, atlas.id, { name: 'src-v' });
    await createFeature(db, src.id);

    const before = await currentVersion();
    await merge(dest.id, [src.id]).expect(200);
    const after = await currentVersion();

    assert.ok(after > before, `current_version must move (${before} -> ${after})`);
  });

  it('the replay for a peer stuck at the pre-merge version is NOT empty', async () => {
    const dest = await createMap(db, atlas.id, { name: 'dest-r' });
    const src = await createMap(db, atlas.id, { name: 'src-r' });
    const feat = await createFeature(db, src.id);

    // This is the peer's bookmark at the moment it went offline.
    const peerVersion = await currentVersion();

    await merge(dest.id, [src.id]).expect(200);

    // ...and this is what it receives when it reconnects. Before the fix: [].
    const res = await pullSince(peerVersion).expect(200);
    const ops = res.body.data.operations ?? [];
    const isSnapshot = Boolean(res.body.data.snapshot);

    assert.ok(
      isSnapshot || ops.length > 0,
      'the reconnecting peer must learn something happened, not be told it is up to date'
    );

    if (!isSnapshot) {
      const marker = ops.find((o) => o.entityType === 'map_merge');
      assert.ok(marker, `a map_merge marker must be in the replay, got: ${ops.map((o) => o.entityType).join(',')}`);
      assert.equal(marker.data.destMapId, dest.id, 'the marker names the destination');
      assert.deepEqual(marker.data.sourceMapIds, [src.id], 'and the sources');
    }

    // And the durable truth the peer will converge onto.
    const { rows } = await db.query('SELECT map_id FROM features WHERE id = $1', [feat.id]);
    assert.equal(rows[0].map_id, dest.id, 'the row really did move');
  });

  it('the marker records what moved, so the change is auditable after the fact', async () => {
    const dest = await createMap(db, atlas.id, { name: 'dest-a' });
    const src = await createMap(db, atlas.id, { name: 'src-a' });
    await createFeature(db, src.id);
    await createFeature(db, src.id);

    await merge(dest.id, [src.id]).expect(200);

    const { rows } = await db.query(
      `SELECT entity_type, entity_id, data, user_id, client_id FROM operations
       WHERE atlas_id = $1 AND entity_type = 'map_merge'
       ORDER BY server_version DESC LIMIT 1`,
      [atlas.id]
    );
    assert.equal(rows.length, 1, 'the merge is in the operation log');
    assert.equal(rows[0].entity_id, dest.id);
    assert.equal(rows[0].user_id, owner.id, 'attributed to the user who did it');
    assert.equal(rows[0].client_id, 'server-merge', 'and marked as server-originated');
    assert.equal(rows[0].data.moved.features, 2, 'with the per-table counts that moved');
  });

  it('a no-op merge (only the destination as source) writes no marker', async () => {
    // mergeMaps short-circuits before touching anything when the source list reduces
    // to nothing. It must not log a change that did not happen — a marker forces every
    // peer into a snapshot, so a spurious one is a real cost, not just noise.
    const dest = await createMap(db, atlas.id, { name: 'dest-noop' });

    const before = await currentVersion();
    await merge(dest.id, [dest.id]).expect(200);
    const after = await currentVersion();

    assert.equal(after, before, 'no rows moved, so no version bump and no marker');
  });

  it('a REFUSED merge writes no marker (the tx rolls the log back too)', async () => {
    const dest = await createMap(db, atlas.id, { name: 'dest-lock' });
    const src = await createMap(db, atlas.id, { name: 'src-lock' });
    await createFeature(db, src.id);
    await db.query('UPDATE maps SET locked = true WHERE id = $1', [src.id]);

    const before = await currentVersion();
    await merge(dest.id, [src.id]).expect(409);
    const after = await currentVersion();

    assert.equal(after, before, 'a rejected merge leaves no trace, since the marker shares its tx');
  });
});

// Path: tests/integration/sync-push-serialization.test.js
// P2 — pushes are serialized per atlas by a transaction-scoped advisory lock.
//
// `server_version` comes from `nextval('atlas_version_seq')` at INSERT time, but a row
// only becomes visible at COMMIT. Without serialization the two orders can diverge:
//
//   tx A inserts (v100) ───────────────────── commits
//   tx B inserts (v101) ── commits
//   a puller sees v101 and stores lastVersion=101
//   …A commits; its v100 op is now BELOW the cursor and the incremental pull
//   (`WHERE server_version > $lastVersion`) never returns it → the op is lost for good.
//
// These tests pin that the lock is actually taken (a push blocks while the atlas lock
// is held elsewhere), that it is scoped per atlas (a different atlas is unaffected),
// and the end-to-end invariant: no op is skipped by an incremental pull cursor.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

// Must match SYNC_PUSH_LOCK_NAMESPACE in src/modules/sync/sync.service.js.
const SYNC_PUSH_LOCK_NAMESPACE = 0x53594e43;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pointOp(mapId, clientId, i) {
  const featureId = randomUUID();
  return {
    id: randomUUID(),
    entityType: 'feature',
    operationType: 'create',
    entityId: featureId,
    mapId,
    data: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [i * 0.001, i * 0.001] },
      properties: { id: featureId, source: 'point', nome: `ponto ${i}` },
    },
    timestamp: Date.now() + i,
    clientId,
  };
}

describe('Sync push serialization (per-atlas advisory lock)', () => {
  let app, db, user, token, atlas, map, otherAtlas, otherMap;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: `pushlock_${randomUUID().slice(0, 6)}` });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
    otherAtlas = await createAtlas(db, user.id);
    otherMap = await createMap(db, otherAtlas.id);
  });

  after(async () => {
    // Never leave a lock held if an assertion threw mid-transaction.
    try {
      await db.query('ROLLBACK');
    } catch {
      /* no open transaction */
    }
    await teardownTestEnv(db);
  });

  it('a push BLOCKS while the atlas advisory lock is held by another transaction', async () => {
    // Hold the atlas's push lock on an independent connection.
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      SYNC_PUSH_LOCK_NAMESPACE,
      atlas.id,
    ]);

    let settled = false;
    const push = supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [pointOp(map.id, 'blocked-client', 1)] })
      .then((res) => {
        settled = true;
        return res;
      });

    // While the lock is held the push must not complete.
    await sleep(500);
    assert.equal(settled, false, 'push must block while another tx holds the atlas lock');

    // Releasing the lock lets it through.
    await db.query('ROLLBACK');
    const res = await push;
    assert.equal(res.status, 200, 'push must succeed once the lock is released');
    assert.equal(settled, true);
  });

  it('the lock is per atlas — a push to a DIFFERENT atlas is not blocked', async () => {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      SYNC_PUSH_LOCK_NAMESPACE,
      atlas.id,
    ]);

    // Holding atlas A's lock must not stall a push to atlas B, or the lock would
    // serialize the whole server instead of one atlas.
    const res = await supertest(app)
      .post(`/api/v1/atlas/${otherAtlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [pointOp(otherMap.id, 'other-atlas-client', 2)] })
      .expect(200);

    assert.ok(res.body.data ?? res.body, 'push to an unrelated atlas completes normally');
    await db.query('ROLLBACK');
  });

  it('no operation is skipped by an incremental pull cursor under concurrent pushes', async () => {
    // The invariant that actually matters: a client advancing `since` by the highest
    // version it has seen must never step over a committed op.
    //
    // A baseline push first, so the drain below starts from a non-zero cursor —
    // `since=0` returns a full snapshot instead of incremental ops.
    const baseline = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [pointOp(map.id, 'baseline-client', 99)] })
      .expect(200);
    const startVersion = baseline.body.data.serverVersion;
    assert.ok(startVersion > 0, 'baseline push must yield a server version');

    const CONCURRENT = 8;
    const sent = [];
    const pushes = Array.from({ length: CONCURRENT }, (_, i) => {
      const op = pointOp(map.id, `race-client-${i}`, 100 + i);
      sent.push(op.entityId);
      return supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({ operations: [op] })
        .expect(200);
    });
    await Promise.all(pushes);

    // Drain exactly the way a client does: pull, advance the cursor to the highest
    // version returned, repeat until a pull comes back empty.
    const seen = new Set();
    let since = startVersion;
    for (let guard = 0; guard < 50; guard++) {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${since}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, false, 'cursor must stay in incremental mode');
      const ops = res.body.data.operations ?? [];
      if (ops.length === 0) break;

      for (const op of ops) {
        assert.ok(
          op.serverVersion > since,
          `pull returned version ${op.serverVersion} at or below the cursor ${since}`
        );
        seen.add(op.entityId);
      }
      since = Math.max(...ops.map((o) => o.serverVersion));
    }

    for (const entityId of sent) {
      assert.ok(
        seen.has(entityId),
        `operation ${entityId} was committed but never surfaced by an incremental pull`
      );
    }
  });
});

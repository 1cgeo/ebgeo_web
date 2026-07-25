// Path: tests/integration/harness-isolation.test.js
// Tests OF the test harness (tests/helpers/setup.js), which had none.
//
// Two properties the whole suite leans on and nobody stated:
//
//  1. `teardownTestEnv` must not silence a release failure. Its catch used to be
//     `// Ignore release errors` over an empty block, with a pool capped at
//     max: 10 shared by every suite: a leaked connection surfaces as a timeout
//     in an unrelated file, and that catch deleted the only local signal naming
//     the file that leaked it. One error IS benign (a double release, i.e. a
//     double teardown in a test) and that one is now named explicitly instead of
//     everything being lumped together.
//
//  2. The comment at the top of setup.js says per-suite isolation "is not
//     needed" because each file creates UUID-named data. That is a PREMISE the
//     suite depends on — data is committed and never rolled back — and it was
//     never checked. It is checked here: rows created for one atlas must not
//     appear in another atlas's listings. When that premise holds, the `>=`
//     assertions it was used to justify can become exact-set assertions (as they
//     now are in maps-briefings.test.js).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('test harness — teardownTestEnv', () => {
  let pool;

  before(async () => {
    const env = await setupTestEnv();
    pool = env.pool;
    // The client this suite acquired is released at the end like any other.
    await teardownTestEnv(env.db);
  });

  it('releases the client back to the pool (the normal path)', async () => {
    const before = pool.idleCount;
    const client = await pool.connect();
    await teardownTestEnv(client);
    assert.ok(
      pool.idleCount >= before,
      'a released client must return to the pool, or the pool drains suite by suite'
    );
  });

  it('tolerates a DOUBLE release, and only that', async () => {
    const client = await pool.connect();
    await teardownTestEnv(client);
    await assert.doesNotReject(
      () => teardownTestEnv(client),
      'a double teardown in a test is benign and must not fail the suite'
    );
  });

  it('does NOT swallow an unexpected release failure', async () => {
    // The property that matters: a broken release must be audible. Anything
    // other than the one benign case has to reach the test that caused it.
    const exploding = {
      release() { throw new Error('connection is in a bad state'); },
    };
    await assert.rejects(
      () => teardownTestEnv(exploding),
      /bad state/,
      'a release error other than "already been released" must propagate'
    );
  });

  it('a null client is a no-op (suites that never acquired one)', async () => {
    await assert.doesNotReject(() => teardownTestEnv(null));
    await assert.doesNotReject(() => teardownTestEnv(undefined));
  });
});

describe('test harness — the no-isolation premise, verified rather than assumed', () => {
  let app, db, token, atlasA, atlasB, mapA, mapB;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const sfx = randomUUID().slice(0, 8);
    const owner = await createUser(db, { username: `iso_owner_${sfx}` });
    token = await loginUser(app, owner.username, owner.password);

    atlasA = await createAtlas(db, owner.id, { name: `Iso A ${sfx}` });
    atlasB = await createAtlas(db, owner.id, { name: `Iso B ${sfx}` });
    mapA = await createMap(db, atlasA.id, { name: `Map A ${sfx}` });
    mapB = await createMap(db, atlasB.id, { name: `Map B ${sfx}` });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('committed data from one atlas never appears in another atlas listing', async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlasA.id}/maps`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const ids = res.body.data.map((m) => m.id);
    assert.ok(ids.includes(mapA.id), 'guard: the listing must contain its own map');
    assert.ok(
      !ids.includes(mapB.id),
      'a map of another atlas leaked into this listing — the premise that lets suites share a database is broken'
    );
    assert.deepEqual(ids, [mapA.id], 'and the scope is exact, not merely "does not contain B"');
  });

  it('the same holds for the snapshot, which the sync client rebuilds from', async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlasA.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const mapIds = res.body.data.snapshot.maps.map((m) => m.id);
    assert.deepEqual(mapIds, [mapA.id], 'the snapshot is scoped to its atlas');
  });

  it('a map id from another atlas is 404, not readable by id alone', async () => {
    // The complement of the listing check: scoping must live in the lookup too,
    // not only in the list query.
    await supertest(app)
      .get(`/api/v1/atlas/${atlasA.id}/maps/${mapB.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});

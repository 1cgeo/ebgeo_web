// Path: tests/integration/stream-error-crash.repro.test.js
// Regression: a filesystem read error while serving a static asset killed the
// whole backend process.
//
// Four sites served a file with `createReadStream(path).pipe(res)` and no 'error'
// listener on the source (assets3d.controller.js:97,100 —
// sv360.controller.js:135,138). `pipe()` only wires the DESTINATION; it does not
// forward the source's errors. A Readable that emits 'error' with no listener
// throws on a later tick, OUTSIDE the handler's promise chain — so `asyncHandler`'s
// `.catch(next)` never sees it, `errorHandler` never runs, and since there is no
// `process.on('uncaughtException')` anywhere in backend/src, Node exits.
//
// The blast radius is what makes it worse than a 500: killing the process drops
// every user's collab WebSocket, and the frontend boot is fail-fast on
// `GET /api/config` with no static fallback, so the whole app stops loading. One
// unreadable .b3dm takes down the product.
//
// The window is real, not theoretical: both paths validate with `fs.stat` /
// `existsSync` and open the file LATER, and `npm run deploy` publishes by swapping
// a symlink underneath the running process.
//
// The trigger used here is a DIRECTORY where a file is expected: `existsSync` and
// `stat` both succeed on it, and `createReadStream` then fails with EISDIR. That
// makes this deterministic and cross-platform, with no reliance on winning a
// stat-vs-open race or on chmod semantics that differ on Windows.
//
// How the assertion works: node:test would report a process-level crash as a dead
// runner, not as a failed assertion, so the test installs its own
// `uncaughtException` listener. That listener ALSO keeps the process alive, which
// would mask the bug — so the test does not merely check "still running", it
// requires a proper HTTP error envelope. Nothing but the fix produces that.
//
// Negative control: restore `.pipe(res)` at either site and this suite fails.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import path from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';

const RID = crypto.randomUUID().slice(0, 8);
const SLUG = `crash-thumb-${RID}`;

describe('a filesystem read error must not kill the process', () => {
  let app, db, orgId, token;
  let thumbDirPath;
  let uncaught = [];
  const onUncaught = (err) => uncaught.push(err);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // Capture instead of dying, so a regression is an assertion and not a runner
    // that vanishes with no output. Removed again in after().
    process.on('uncaughtException', onUncaught);

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgId = org.rows[0].id;

    token = jwt.sign(
      {
        sub: crypto.randomUUID(), username: `crash_${RID}`,
        role: 'admin', organization_id: orgId, org_role: 'owner',
      },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    mkdirSync(config.sv360.dbDir, { recursive: true });

    // A project whose thumbnail path resolves to a DIRECTORY: passes existsSync
    // and stat, fails on open.
    const dbFile = `${orgId}__${SLUG}.db`;
    await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, $3, -23.5, -46.6, $4, 'enabled', 0)`,
      [orgId, SLUG, `Crash Thumb ${RID}`, dbFile]
    );

    thumbDirPath = path.join(config.sv360.dbDir, `${orgId}__${SLUG}.webp`);
    rmSync(thumbDirPath, { recursive: true, force: true });
    mkdirSync(thumbDirPath, { recursive: true });
  });

  after(async () => {
    process.removeListener('uncaughtException', onUncaught);
    if (thumbDirPath) rmSync(thumbDirPath, { recursive: true, force: true });
    await teardownTestEnv(db);
  });

  it('answers an error envelope instead of crashing when the file cannot be opened', async () => {
    uncaught = [];

    const res = await supertest(app)
      .get(`/api/v1/sv360/thumbnails/${SLUG}.webp`)
      .set('Authorization', `Bearer ${token}`);

    // Give the stream's 'error' a tick to surface if nothing is listening.
    await new Promise((r) => setImmediate(r));

    assert.deepEqual(
      uncaught.map((e) => e.code ?? e.message), [],
      'no uncaught exception escaped: without a listener on the source this is where the process died'
    );
    assert.ok(
      res.status >= 400,
      `the failure is reported over HTTP, got ${res.status}`
    );
    // Not just "some 4xx/5xx": the body has to actually arrive. The handler had
    // already set Content-Length from the stat (0 for a directory) and, on the Range
    // branch, Content-Range + a 206 status. Handing the request to the error handler
    // without clearing those emits an envelope that the stale headers truncate — a
    // response that looks fine to a status-only assertion and is empty on the wire.
    assert.ok(
      res.body?.error,
      `the error envelope really arrives, got status ${res.status} body ${JSON.stringify(res.body)}`
    );
  });

  it('the same request twice does not degrade the process', async () => {
    uncaught = [];

    for (let i = 0; i < 3; i++) {
      await supertest(app)
        .get(`/api/v1/sv360/thumbnails/${SLUG}.webp`)
        .set('Authorization', `Bearer ${token}`);
    }
    await new Promise((r) => setImmediate(r));

    assert.deepEqual(uncaught.map((e) => e.code ?? e.message), [], 'still no uncaught exception');

    // The server is still serving other routes — a crash would fail this outright,
    // and a half-broken process (leaked fd, stuck semaphore) shows up here too.
    await supertest(app).get('/api/config').expect(200);
  });

  // The Range branch is a SEPARATE call site and deserves its own proof, but it
  // CANNOT be reached through this fixture, and saying so is the point of this test.
  // A directory reports size 0, so `parseRange('bytes=0-10', 0)` clamps `end` to -1,
  // sees start > end, and returns 416 before any stream is opened. Asserting "no
  // crash" here would have been a green that proves nothing — the code under test
  // never runs. It is asserted as a 416 instead, and the Range call site is covered
  // deterministically in tests/unit/stream-file.test.js, where the range options can
  // be handed straight to the helper.
  it('a Range request against a zero-length target is refused before any read (416)', async () => {
    uncaught = [];

    const res = await supertest(app)
      .get(`/api/v1/sv360/thumbnails/${SLUG}.webp`)
      .set('Authorization', `Bearer ${token}`)
      .set('Range', 'bytes=0-10');

    await new Promise((r) => setImmediate(r));

    assert.deepEqual(uncaught.map((e) => e.code ?? e.message), [], 'no uncaught exception');
    assert.equal(res.status, 416, 'the range is rejected up front, so the stream is never opened');
  });
});

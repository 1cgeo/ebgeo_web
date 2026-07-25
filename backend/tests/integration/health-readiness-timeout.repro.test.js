// Path: tests/integration/health-readiness-timeout.repro.test.js
// Regression (achado 38): GET /api/v1/health could not answer 503 when the pool was
// exhausted or the database host was unreachable-without-refusing.
//
// The handler in app.js only produced 503 from its `catch` — i.e. only when
// `one('SELECT 1 AS ok')` REJECTS. Nothing in the stack imposes a deadline:
// database/index.js builds the pool with connectionString/max/min only, so `pg`
// keeps its default `connectionTimeoutMillis: 0` and a query with no free slot
// waits forever. With DATABASE_POOL_MAX connections held (the C5 incident in this
// project did it with a single client holding an advisory lock), the readiness
// probe neither resolves nor rejects: the orchestrator sees "no answer" instead of
// the unavailability signal the endpoint exists to give — and each probe enqueues
// one more waiter on the already-saturated pool.
//
// This is the readiness probe, NOT `GET /api/config` (the frontend's fail-fast boot
// dependency); nothing here changes that endpoint.
//
// Negative control: remove the deadline race from the /health handler in app.js and
// the first test fails — the probe answers 200 only after the holders release, i.e.
// it waited out the outage instead of reporting it.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { any } from '../../src/database/index.js';
import config from '../../src/config.js';

// Long enough that a probe which merely QUEUES cannot answer inside the assertion
// window, short enough to keep the suite fast.
const HOLD_SECONDS = 8;

describe('readiness reports 503 when the DB pool is exhausted (repro)', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('answers 503 promptly while every pool connection is held', async () => {
    // Occupy the app pool itself (the same module the handler queries through).
    const holders = Array.from({ length: config.db.poolMax }, () =>
      any('SELECT pg_sleep($1)', [HOLD_SECONDS]).catch(() => {})
    );

    try {
      // Let the holders actually acquire their connections before probing.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const startedAt = Date.now();
      const res = await supertest(app).get('/api/v1/health');
      const elapsedMs = Date.now() - startedAt;

      assert.equal(res.status, 503, 'a saturated pool must read as NOT ready');
      assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
      assert.ok(
        elapsedMs < (HOLD_SECONDS - 2) * 1000,
        `the probe must have its own deadline, answered in ${elapsedMs}ms`
      );
    } finally {
      await Promise.all(holders);
    }
  });

  // Negative control: the happy path is unchanged — a reachable DB still answers 200
  // (and the deadline timer must not keep the event loop alive).
  it('answers 200 when the database is reachable', async () => {
    const res = await supertest(app).get('/api/v1/health').expect(200);
    assert.equal(res.body.status, 'ok');
  });
});

// Path: tests/integration/health-readiness.test.js
// The 503 branch of GET /api/v1/health, and the exact envelope it writes.
//
// That `catch` is the only thing that makes readiness FAIL when Postgres is
// gone, and its response is hand-written — it never passes through the
// errorHandler. So changing 503 to 500, renaming the code, or deleting the
// try/catch entirely left the suite green while an instance with no database
// stayed in the load balancer's rotation.
//
// health-readiness-timeout.repro.test.js already covers the SATURATED-pool
// variant (the probe has its own deadline). What is asserted here is the other
// outage shape — the pool is gone, every query rejects at once — plus the two
// properties that file does not state: the exact envelope (message included, and
// nothing from the errorHandler) and that the route stays PUBLIC while down,
// which is what an orchestrator probe depends on.
//
// The pool is destroyed on purpose, so this lives in a file of its own: `node
// --test` runs one process per file, and the order below (baseline first, then
// the outage) is the file's whole structure.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { pgp } from '../../src/database/index.js';

describe('GET /api/v1/health — the 503 branch', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('baseline: answers 200 {status:"ok"} while the database is reachable', async () => {
    // Positive control. Without it, every assertion below would also hold for a
    // handler that answered 503 unconditionally.
    const res = await supertest(app).get('/api/v1/health').expect(200);
    assert.deepEqual(res.body, { status: 'ok' }, 'the ready body carries no extra fields');
  });

  it('answers 503 SERVICE_UNAVAILABLE once the connection pool is gone', async () => {
    pgp.end(); // from here on every query through src/database rejects immediately

    const res = await supertest(app).get('/api/v1/health');
    assert.equal(res.status, 503, 'an instance without a database is NOT ready');
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(res.body.error.message, 'Database unavailable');
  });

  it('the 503 body is the hand-written envelope, not a generic 500 from the errorHandler', async () => {
    const res = await supertest(app).get('/api/v1/health');
    assert.equal(res.status, 503, 'still down');
    // The distinction matters because the handler's catch is what produces 503;
    // if it were removed the rejection would reach the errorHandler, which
    // answers 500 and shapes the body differently (and may carry a stack outside
    // production). Asserting the shape is what tells the two apart.
    assert.deepEqual(
      Object.keys(res.body).sort(), ['error'],
      'the readiness failure body is exactly { error }'
    );
    assert.deepEqual(
      Object.keys(res.body.error).sort(), ['code', 'message'],
      'no stack, no extra diagnostic fields on a public probe'
    );
    assert.equal(res.body.error.stack, undefined);
  });

  it('stays PUBLIC while down: no token, and still 503 rather than 401', async () => {
    // The probe is unauthenticated by contract. A regression that put the health
    // route behind `auth` would answer 401 to the orchestrator, which reads as
    // "not ready" for the wrong reason and hides the real outage.
    const anon = await supertest(app).get('/api/v1/health');
    assert.equal(anon.status, 503);

    const withGarbageToken = await supertest(app)
      .get('/api/v1/health')
      .set('Authorization', 'Bearer nao.e.um.jwt');
    assert.equal(withGarbageToken.status, 503, 'an invalid credential must not change the answer');
  });
});

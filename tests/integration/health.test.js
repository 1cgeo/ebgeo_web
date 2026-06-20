// Path: tests/integration/health.test.js
// Health-check (readiness with SELECT 1) and the 404 handler for unknown routes.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

describe('Health & 404', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('GET /api/v1/health returns 200 with status ok (DB reachable)', async () => {
    const res = await supertest(app).get('/api/v1/health').expect(200);
    assert.equal(res.body.status, 'ok');
  });

  it('unknown routes return a 404 in the standard error format', async () => {
    const res = await supertest(app).get('/api/v1/does-not-exist').expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});

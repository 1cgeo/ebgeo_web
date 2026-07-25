// Path: tests/integration/bulk-parser-scope.repro.test.js
// Regression (achado 37): the 50 MB JSON parser was selected by PATH SUFFIX, before
// authentication and before routing.
//
// app.js chose the enlarged parser with
//   `req.method === 'POST' && req.path.endsWith('/images/bulk')`
// mounted ahead of flexibleAuth and of every router. So an ANONYMOUS caller could
// POST to any invented path ending in `/images/bulk` — `/qualquer/coisa/images/bulk`
// — and have 50 MB buffered and JSON.parse'd (roughly 10x that in V8 heap for a
// nested structure) before anything checked a credential or even whether the route
// existed. Every other path was capped at 10 MB, so this was a free 5x amplification
// of an unauthenticated memory surface, on a path the attacker chooses. The comment
// in config.js claims the cap exists to "bound the authenticated memory blast"; the
// blast was not authenticated.
//
// What the previous coverage asserted (config-infra-gaps.test.js infra-01) was the
// defect itself, blessed as intended behavior: it sent 12 MB with NO token and
// asserted 401 — i.e. it asserted that 12 MB were parsed before the strict `auth`
// middleware got to reject. That case now lives here, inverted.
//
// Negative control: restore the `endsWith` selection in app.js (or drop the
// `req.user` requirement) and the first three tests fail — the bogus path answers
// 404 and the anonymous atlas path answers 401, both AFTER parsing 12 MB.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';

const MB = 1024 * 1024;
const overGlobalCap = () => JSON.stringify({ filler: 'a'.repeat(12 * MB) });

describe('the enlarged bulk JSON parser is reachable only by an authenticated principal (repro)', () => {
  let app, db, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const user = await createUser(db, { username: `bulkscope_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('anonymous POST to an INVENTED path ending in /images/bulk is capped at 10mb', async () => {
    const res = await supertest(app)
      .post('/api/v1/totalmente/inexistente/images/bulk')
      .set('Content-Type', 'application/json')
      .send(overGlobalCap());
    assert.equal(
      res.status, 413,
      'an unauthenticated, unrouted path must not buy the 50mb parser'
    );
  });

  it('anonymous POST to the REAL bulk path is capped at 10mb (no credential, no amplification)', async () => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${randomUUID()}/images/bulk`)
      .set('Content-Type', 'application/json')
      .send(overGlobalCap());
    assert.equal(res.status, 413, 'the enlarged cap must require a verified principal');
  });

  it('a forged Authorization header does not buy the enlarged parser', async () => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${randomUUID()}/images/bulk`)
      .set('Authorization', 'Bearer not-a-real-token')
      .set('Content-Type', 'application/json')
      .send(overGlobalCap());
    assert.equal(res.status, 413, 'presence of a credential is not the same as a valid one');
  });

  it('not even an AUTHENTICATED caller gets the enlarged parser off the real route', async () => {
    // The two guards are independent: this one is what the anchored path buys. A
    // logged-in account with no permission anywhere could otherwise still spend 50mb
    // of heap per request on any invented URL.
    const res = await supertest(app)
      .post('/api/v1/totalmente/inexistente/images/bulk')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(overGlobalCap());
    assert.equal(res.status, 413, 'the enlarged cap belongs to ONE route, not to a suffix');
  });

  // ---- Negative controls: the feature the enlarged parser exists for still works.

  it('an AUTHENTICATED principal still gets the enlarged parser on the bulk path', async () => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${randomUUID()}/images/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(overGlobalCap());
    assert.notEqual(res.status, 413, '12mb must pass the parser for an authenticated caller');
    // It then fails on authorization/routing, which is the correct order.
    assert.ok([403, 404].includes(res.status), `expected 403/404 after parsing, got ${res.status}`);
  });

  it('the enlarged cap is still enforced for an authenticated principal', async () => {
    const limitMb = config.images.maxBulkUploadMb; // 50 by default
    const res = await supertest(app)
      .post(`/api/v1/atlas/${randomUUID()}/images/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ filler: 'a'.repeat((limitMb + 2) * MB) }));
    assert.equal(res.status, 413, 'over the bulk cap is still 413');
    assert.ok(res.body.error, 'expected the { error } envelope');
  });

  it('an anonymous SMALL bulk request is still refused by auth, not by size', async () => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${randomUUID()}/images/bulk`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ images: [] }));
    assert.equal(res.status, 401, 'the auth contract of the route is unchanged');
  });

  it('a normal JSON route is still capped at 10mb', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ username: 'x', password: 'a'.repeat(11 * MB) }));
    assert.equal(res.status, 413);
  });
});

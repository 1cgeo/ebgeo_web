// Path: tests/integration/request-logger-redaction.test.js
// P1 nº 60: `redactUrl` is applied at TWO call sites — request-logger.js:15 and
// error-handler.js:23 — and `tests/unit/redact-url.test.js` proves only that the
// function works in isolation. That green says nothing about whether the middleware
// actually calls it: delete the call, keep the function, and the unit test stays green
// while every access token in a query string lands in the logs in clear text.
//
// So this file asserts at the CALL SITE. It intercepts the object each middleware hands
// to pino and checks the `url` field it built, driving real requests through real
// Express. The interception sits BEFORE pino on purpose: pino's own `redact.paths`
// covers field NAMES like `token`, not a secret embedded inside a `url` string, so
// nothing downstream would catch a missing `redactUrl` — the call site is the only guard.
//
// WHY A LOCAL APP FOR request-logger:
//   `app.js:104` mounts it behind `if (!config.isTest)`, so `createApp()` in the test
//   suite never installs it — that gate, not a missing test, is what kept the file at
//   27,6%. The middleware is therefore mounted here on a bare Express app: the module
//   under test, its real `res.on('finish')` path and a real request, with only the
//   surrounding router replaced. `errorHandler` IS mounted in test, so its call site is
//   additionally checked through the real `createApp()` below.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';
import logger from '../../src/utils/logger.js';
import { requestLogger } from '../../src/middleware/request-logger.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { auth } from '../../src/middleware/auth.js';

// A value that could not plausibly appear in the app by accident, so "the secret is
// absent from the record" is a meaningful statement.
const SECRET = `s3cr3t-${randomUUID()}`;

const isRequestLog = (r) => r.msg === 'request' || r.msg === 'request error';
const isErrorLog = (r) => r.msg === 'Request error';

/**
 * Replaces logger.info/logger.warn with collectors for the duration of `fn`, then waits
 * (bounded) until a record matching `until` shows up.
 *
 * The wait is not cosmetic: request-logger writes from `res.on('finish')`, which is a
 * server-side event with no ordering guarantee against supertest's resolved promise.
 * Waiting for the SPECIFIC record — not merely "any record" — is what stops the
 * error-handler's own line from satisfying the wait and hiding a missing request log.
 *
 * The original property descriptors are restored: pino defines the level methods on the
 * prototype, so a plain re-assignment would leave an own-property shadow behind.
 */
async function captureLogs(fn, until = isRequestLog) {
  const records = [];
  const saved = [];

  for (const level of ['info', 'warn']) {
    saved.push([level, Object.getOwnPropertyDescriptor(logger, level)]);
    Object.defineProperty(logger, level, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: (obj, msg) => { records.push({ level, obj, msg }); },
    });
  }

  try {
    await fn();
    const deadline = Date.now() + 3000;
    while (!records.some(until) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
  } finally {
    for (const [level, descriptor] of saved) {
      if (descriptor) Object.defineProperty(logger, level, descriptor);
      else delete logger[level];
    }
  }

  return records;
}

describe('URL redaction at the log call sites', () => {
  let realApp, db, user, token, harness;

  before(async () => {
    const env = await setupTestEnv();
    realApp = env.app;
    db = env.db;
    user = await createUser(db, { username: `redact_${randomUUID().slice(0, 8)}` });
    token = await loginUser(realApp, user.username, user.password);

    // The real middleware chain, minus the routers: requestLogger first (so it sees
    // every response), errorHandler last, exactly as app.js orders them.
    harness = express();
    harness.use(requestLogger);
    harness.get('/api/v1/probe', (req, res) => res.json({ ok: true }));
    harness.get('/api/v1/private', auth, (req, res) => res.json({ id: req.user.id }));
    harness.use(errorHandler);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('request-logger redacts ?token= on a successful (2xx) request', async () => {
    let status;
    const records = await captureLogs(async () => {
      const res = await supertest(harness).get(`/api/v1/probe?token=${SECRET}`);
      status = res.status;
    });

    assert.equal(status, 200);

    const rec = records.find(isRequestLog);
    assert.ok(rec, 'request-logger produced no record at all');
    assert.equal(rec.msg, 'request', '2xx must log at info, not warn');
    assert.equal(rec.level, 'info');

    assert.equal(rec.obj.url, '/api/v1/probe?token=REDACTED');
    assert.equal(rec.obj.statusCode, 200);
    assert.equal(rec.obj.method, 'GET');
    assert.equal(typeof rec.obj.duration, 'number');
    assert.equal(rec.obj.userId, undefined, 'anonymous request must carry no userId');

    // The invariant that matters, stated once over the whole record: the credential is
    // nowhere in what was handed to the logger.
    assert.ok(
      !JSON.stringify(rec.obj).includes(SECRET),
      'the token reached the logger in clear text'
    );
  });

  it('request-logger redacts ?api_key= and logs a 4xx at warn', async () => {
    // No credential → `auth` raises 401, so this also exercises the statusCode >= 400
    // branch, which shares the same `logData` object as the 2xx branch.
    let status;
    const records = await captureLogs(async () => {
      const res = await supertest(harness).get(`/api/v1/private?api_key=${SECRET}`);
      status = res.status;
    });

    assert.equal(status, 401);

    const rec = records.find(isRequestLog);
    assert.ok(rec, 'request-logger produced no record');
    assert.equal(rec.msg, 'request error', '4xx must log at warn, not info');
    assert.equal(rec.level, 'warn');
    assert.equal(rec.obj.url, '/api/v1/private?api_key=REDACTED');
    assert.equal(rec.obj.statusCode, 401);
    assert.ok(!JSON.stringify(rec.obj).includes(SECRET));
  });

  it('request-logger records the authenticated principal', async () => {
    const records = await captureLogs(async () => {
      await supertest(harness)
        .get(`/api/v1/private?token=${SECRET}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    const rec = records.find(isRequestLog);
    assert.ok(rec);
    assert.equal(rec.obj.userId, user.id, 'req.user.id must reach the log line');
    assert.equal(rec.obj.url, '/api/v1/private?token=REDACTED');
    assert.ok(!JSON.stringify(rec.obj).includes(SECRET));
  });

  it('request-logger redacts every sensitive key at once and keeps the innocent ones', async () => {
    const records = await captureLogs(async () => {
      await supertest(harness).get(
        `/api/v1/probe?page=2&token=${SECRET}&access_token=${SECRET}&refresh_token=${SECRET}&api_key=${SECRET}&q=cap`
      );
    });

    const rec = records.find(isRequestLog);
    assert.ok(rec);
    const url = rec.obj.url;

    for (const key of ['token', 'access_token', 'refresh_token', 'api_key']) {
      assert.match(url, new RegExp(`${key}=REDACTED`), `${key} was not redacted`);
    }
    // Redaction must not be "drop the query string" — the non-sensitive params are what
    // make the log useful in the first place.
    assert.match(url, /page=2/);
    assert.match(url, /q=cap/);
    assert.ok(!url.includes(SECRET));
  });

  it('request-logger leaves a query-less URL untouched', async () => {
    const records = await captureLogs(async () => {
      await supertest(harness).get('/api/v1/probe').expect(200);
    });

    const rec = records.find(isRequestLog);
    assert.ok(rec);
    assert.equal(rec.obj.url, '/api/v1/probe');
  });

  it('error-handler redacts the URL — through the REAL app, where it is mounted', async () => {
    // This one does not need the harness: app.js registers errorHandler in every
    // environment, so the assertion covers the production wiring as well as the module.
    let status;
    const records = await captureLogs(
      async () => {
        const res = await supertest(realApp).get(`/api/v1/ranks?api_key=${SECRET}`);
        status = res.status;
      },
      isErrorLog
    );

    assert.equal(status, 401);

    const rec = records.find(isErrorLog);
    assert.ok(rec, 'error-handler produced no record');
    assert.equal(rec.obj.url, '/api/v1/ranks?api_key=REDACTED');
    assert.equal(rec.obj.method, 'GET');
    assert.equal(rec.level, 'warn', '4xx must not pollute the error stream');

    // `err` is an Error, which JSON.stringify flattens to {} — serialize its own text
    // explicitly so the check actually looks at the payload the logger would print.
    const flat = JSON.stringify({
      ...rec.obj,
      err: { message: rec.obj.err?.message, stack: rec.obj.err?.stack },
    });
    assert.ok(!flat.includes(SECRET), 'secret leaked into the error-handler record');
  });

  it('error-handler logs a 5xx at error level, still redacted', async () => {
    // The other side of the `loggedStatus < 500` branch, and the path where a leaked
    // URL would be most tempting to keep raw "for debugging".
    const boom = express();
    boom.get('/api/v1/explode', () => { throw new Error('boom'); });
    boom.use(errorHandler);

    const savedError = Object.getOwnPropertyDescriptor(logger, 'error');
    const records = [];
    Object.defineProperty(logger, 'error', {
      configurable: true, writable: true, enumerable: false,
      value: (obj, msg) => { records.push({ obj, msg }); },
    });
    try {
      await supertest(boom).get(`/api/v1/explode?token=${SECRET}`).expect(500);
    } finally {
      if (savedError) Object.defineProperty(logger, 'error', savedError);
      else delete logger.error;
    }

    assert.equal(records.length, 1, 'a 5xx must reach logger.error exactly once');
    assert.equal(records[0].obj.url, '/api/v1/explode?token=REDACTED');
  });
});

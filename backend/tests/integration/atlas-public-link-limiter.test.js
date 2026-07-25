// Path: tests/integration/atlas-public-link-limiter.test.js
// Item 3. `publicLinkLimiter` (atlas.routes.js:23) is the only control against
// brute-forcing a 16-byte hex public_link, and the security baseline in
// backend/CLAUDE.md names it. rate-limit.test.js exercises ONLY the authLimiter, so
// removing the limiter from this route — or moving it after the handler — leaves the
// whole suite green.
//
// The limiter has no keyGenerator, so it is keyed by address alone: this file owns
// that bucket and must be the only place that forces it on for this route. The
// unforced arm runs FIRST, because `skip` prevents the counter from advancing at all
// while it is off — running it afterwards would be measuring a bucket already spent.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import config from '../../src/config.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, makeAtlasPublic } from '../helpers/fixtures.js';

describe('publicLinkLimiter guards GET /atlas/public/:link', () => {
  let app, db, publicLink;
  const max = config.rateLimit.publicMax;

  const hit = (link) => supertest(app).get(`/api/v1/atlas/public/${link}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const owner = await createUser(db, { username: `p3_owner_${randomUUID().slice(0, 8)}` });
    const atlas = await createAtlas(db, owner.id, { name: `P3 ${randomUUID().slice(0, 6)}` });
    publicLink = await makeAtlasPublic(db, atlas.id);
  });

  after(async () => {
    delete process.env.RATE_LIMIT_FORCE;
    await teardownTestEnv(db);
  });

  it('SELF-CONTROL: with the limiter off, the same volume never yields a 429', async () => {
    assert.notEqual(process.env.RATE_LIMIT_FORCE, '1', 'this arm must run before the limiter is forced');

    const statuses = [];
    for (let i = 0; i < max + 1; i++) {
      const res = await hit(`deadbeef${i.toString(16).padStart(24, '0')}`);
      statuses.push(res.status);
    }

    assert.equal(statuses.length, max + 1);
    assert.ok(!statuses.includes(429), 'so a 429 below can only come from the limiter');
    assert.deepEqual([...new Set(statuses)], [404], 'unknown links are plain 404s');
  });

  it('exceeding the quota answers 429 TOO_MANY_REQUESTS', async () => {
    process.env.RATE_LIMIT_FORCE = '1';

    let last;
    for (let i = 0; i < max + 1; i++) {
      last = await hit(`cafe${i.toString(16).padStart(28, '0')}`);
    }

    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, 'TOO_MANY_REQUESTS');
  });

  it('the quota is spent BEFORE the link is resolved, so wrong guesses still lock out a valid link', async () => {
    // The previous test already exhausted the bucket with nonexistent links. A VALID
    // link must now be refused too — otherwise an attacker could burn the budget on
    // misses for free and keep probing.
    assert.equal(process.env.RATE_LIMIT_FORCE, '1');

    const res = await hit(publicLink);

    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'TOO_MANY_REQUESTS');
    assert.equal(res.body.data, undefined, 'no publicToken escapes a throttled request');
  });
});

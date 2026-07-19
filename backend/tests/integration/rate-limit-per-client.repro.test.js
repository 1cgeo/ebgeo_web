// Path: tests/integration/rate-limit-per-client.repro.test.js
// Regression: every IP-keyed rate limiter was really ONE global bucket.
//
// `app.set('trust proxy', ...)` existed nowhere in the package, and the documented
// deployment puts nginx in front (docs/wiki/deploy-backend.md, "NGINX: quatro itens
// nao negociaveis"). So `req.ip` was the proxy's address on every request and the
// keys derived from it were constant across the entire internet:
//
//   - publicLinkLimiter (no keyGenerator → default `ipKeyGenerator(req.ip, 56)`):
//     30 requests/minute TOTAL. Any single client could spend the budget and the
//     next visitor, from any address, got a 429.
//   - authLimiter (`${req.ip}:${username}`): collapses to one bucket PER USERNAME,
//     globally. Ten wrong passwords lock that account out of every address for the
//     window — sustainable indefinitely, and the exact inverse of what the comment
//     above it promises ("sem que um IP barulhento trave o login de todo mundo").
//     Account lockout as a service, for anyone who knows a username.
//
// `validate: false` made it worse than a plain oversight: it switched off
// express-rate-limit's `trustProxy` and `xForwardedForHeader` checks, whose only
// purpose is to shout about precisely this configuration. The alarm was disabled
// while the condition it detects was live.
//
// What no existing test covered: that two DIFFERENT clients get different buckets.
// infra-13 in config-infra-gaps.test.js exercises the key's shape — case-folding,
// and the `${ip}:` bucket for a missing username — which are correct behaviours and
// stay green either way. Neither one varies the client address, so neither could
// tell a per-client limiter from a global one. That is the gap this file fills.
//
// Negative control: remove `app.set('trust proxy', ...)` from app.js and the first
// two tests fail.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';

describe('rate limits are per client, not global', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    process.env.RATE_LIMIT_FORCE = '1';
  });

  after(async () => {
    delete process.env.RATE_LIMIT_FORCE;
    await teardownTestEnv(db);
  });

  const login = (username, ip) =>
    supertest(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ username, password: 'senha-errada' });

  it('one client exhausting the auth limit does not lock out another client', async () => {
    const victim = `alvo_${randomUUID().slice(0, 8)}`;
    const attacker = '203.0.113.10';
    const elsewhere = '198.51.100.20';

    // The attacker burns the whole budget against the victim's username.
    for (let i = 0; i < config.rateLimit.authMax; i++) {
      await login(victim, attacker);
    }
    const blocked = await login(victim, attacker);
    assert.equal(blocked.status, 429, 'the attacker really did exhaust their own bucket');

    // The victim, from their own address, must still be able to try to log in.
    // Before `trust proxy`, both requests keyed off the nginx address and this was
    // a 429: the account was locked out by a third party, from anywhere.
    const fromVictim = await login(victim, elsewhere);
    assert.notEqual(
      fromVictim.status, 429,
      'a different client must not inherit the attacker bucket — this is the lockout'
    );
  });

  it('the public-link limiter is per client, not a single bucket for everyone', async () => {
    const heavy = '203.0.113.30';
    const bystander = '198.51.100.40';
    const link = randomUUID();

    for (let i = 0; i < config.rateLimit.publicMax; i++) {
      await supertest(app).get(`/api/v1/atlas/public/${link}`).set('X-Forwarded-For', heavy);
    }
    const blocked = await supertest(app)
      .get(`/api/v1/atlas/public/${link}`)
      .set('X-Forwarded-For', heavy);
    assert.equal(blocked.status, 429, 'the heavy client exhausted its own budget');

    const other = await supertest(app)
      .get(`/api/v1/atlas/public/${link}`)
      .set('X-Forwarded-For', bystander);
    assert.notEqual(
      other.status, 429,
      'an unrelated visitor must not be throttled by someone else traffic'
    );
  });

  it('trusts exactly one hop, so a forged X-Forwarded-For cannot mint fresh buckets', async () => {
    const real = '203.0.113.50';
    const victim = `spoof_${randomUUID().slice(0, 8)}`;

    // A client that appends its own X-Forwarded-For entries must not escape the
    // limit. With one hop trusted, Express reads the LAST entry (the one nginx
    // appended) and ignores whatever the client put in front of it. Trusting more
    // hops than actually exist would make this header client-controlled and hand
    // the attacker an unlimited supply of keys.
    for (let i = 0; i < config.rateLimit.authMax; i++) {
      await supertest(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `10.0.0.${i}, ${real}`)
        .send({ username: victim, password: 'senha-errada' });
    }

    const spoofed = await supertest(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', `10.9.9.9, ${real}`)
      .send({ username: victim, password: 'senha-errada' });

    assert.equal(
      spoofed.status, 429,
      'rotating the client-supplied part of the header must not reset the bucket'
    );
  });
});

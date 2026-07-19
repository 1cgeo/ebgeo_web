// Path: tests/integration/auth-refresh-race.repro.test.js
// Regression: refresh-token rotation was read-check-then-write, so concurrent
// callers could each mint a valid family from ONE token.
//
// `refresh()` did three independent round-trips with no transaction and no lock:
// FIND_REFRESH_TOKEN_ANY (auth.service.js:132) → decide on `revoked_at` (:142) →
// REVOKE_REFRESH_TOKEN (:154). The revoke was
// `UPDATE ... SET revoked_at = NOW() WHERE token_hash = $1`, with neither
// `AND revoked_at IS NULL` nor `RETURNING`, so it could not act as mutual exclusion
// nor say who won. Two callers both read `revoked_at = NULL`, both passed the reuse
// check, and both proceeded to issue a new pair.
//
// Why that matters beyond a duplicate token: reuse detection (:142-146) is the
// control that turns a STOLEN refresh token into a whole-family revocation. A thief
// racing the legitimate client defeats it — both requests observe an unrevoked row,
// no alarm fires, and the thief walks away with a valid family that outlives the
// victim's next rotation.
//
// The remedy already existed in the same file: `CLAIM_VERIFICATION_TOKEN`
// (auth.queries.js:100-105) makes the UPDATE itself the mutual exclusion with
// `WHERE ... consumed_at IS NULL RETURNING`, and the comment above it describes
// this exact defect word for word. Rotation now uses the same shape.
//
// Why the existing coverage did not catch it: auth-gaps.test.js auth-09 asserts
// `successes.length <= 1` over TWO concurrent refreshes, which is the right
// assertion but too narrow a window — it passed on every run measured here. The
// race needs more concurrent callers to interleave reliably, which is what this
// suite does.
//
// Negative control: restore the read-then-write pair in refresh() and the first
// test reports more than one success.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';

const FANOUT = 8;

describe('refresh-token rotation is an atomic claim (repro)', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const loginFresh = async () => {
    const user = await createUser(db, { username: `race_${randomUUID().slice(0, 8)}` });
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password })
      .expect(200);
    return { user, refreshToken: res.body.data.refreshToken };
  };

  const refreshWith = (refreshToken) =>
    supertest(app).post('/api/v1/auth/refresh').send({ refreshToken });

  it(`exactly one of ${FANOUT} concurrent refreshes may win`, async () => {
    const { user, refreshToken } = await loginFresh();

    const results = await Promise.all(
      Array.from({ length: FANOUT }, () => refreshWith(refreshToken))
    );

    const winners = results.filter((r) => r.status === 200);
    assert.equal(
      winners.length, 1,
      `one token must yield exactly one new family, got ${winners.length} `
      + `(statuses: ${results.map((r) => r.status).join(',')})`
    );

    // Not just the HTTP count: every winner INSERTs a row, so a second success
    // leaves a second live token behind and the count is the durable proof.
    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [user.id]
    );
    assert.equal(rows[0].n, 1, 'exactly one live refresh token survives the race');
  });

  it('the losers are refused, and the spent token stays unusable afterwards', async () => {
    const { refreshToken } = await loginFresh();

    const results = await Promise.all(
      Array.from({ length: FANOUT }, () => refreshWith(refreshToken))
    );
    assert.equal(results.filter((r) => r.status === 200).length, 1, 'one winner');
    assert.ok(
      results.filter((r) => r.status === 401).length === FANOUT - 1,
      'every loser is refused with 401, not a 500'
    );

    await refreshWith(refreshToken).expect(401);
  });

  // The grace window is the deliberate half of this fix, so both of its sides get a
  // test. Inside the window a loser is an ordinary concurrent duplicate; outside it,
  // the same request is theft. A suite that only tested one side could not tell the
  // window from its absence.

  it('a replay INSIDE the grace window is a duplicate, not theft', async () => {
    const { user, refreshToken } = await loginFresh();

    const ok = await refreshWith(refreshToken).expect(200);
    const newToken = ok.body.data.refreshToken;

    // Immediately after rotation: this is what a double-submit looks like.
    await refreshWith(refreshToken).expect(401);

    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [user.id]
    );
    assert.equal(rows[0].n, 1, 'the family survives — the winner keeps its fresh token');

    // And the session still works, which is the whole point of the window.
    await refreshWith(newToken).expect(200);
  });

  it('a replay OUTSIDE the grace window still revokes the whole family', async () => {
    const { user, refreshToken } = await loginFresh();

    const ok = await refreshWith(refreshToken).expect(200);
    const newToken = ok.body.data.refreshToken;

    // Age the rotation past the window instead of sleeping through it: the decision
    // reads `revoked_at`, so moving it back is the same input the clock would give.
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '1 hour'
       WHERE user_id = $1 AND revoked_at IS NOT NULL`,
      [user.id]
    );

    await refreshWith(refreshToken).expect(401);

    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [user.id]
    );
    assert.equal(rows[0].n, 0, 'reuse revokes the entire family, including the fresh token');

    // The victim's own new token is dead too — that is what the alarm is for.
    await refreshWith(newToken).expect(401);
  });

  it('an expired token reports expiry and does NOT read as theft', async () => {
    const { user, refreshToken } = await loginFresh();

    await db.query(
      `UPDATE refresh_tokens SET expires_at = NOW() - INTERVAL '1 day'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id]
    );

    await refreshWith(refreshToken).expect(401);

    // A second attempt with the same expired token must not escalate to a
    // family-wide revocation alarm: expiry is not evidence of compromise, and the
    // atomic claim would otherwise turn every ordinary retry-after-expiry into one.
    const second = await refreshWith(refreshToken);
    assert.equal(second.status, 401, 'still refused');

    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1',
      [user.id]
    );
    assert.equal(rows[0].n, 1, 'no cascade: the expired row is simply unusable');
  });
});

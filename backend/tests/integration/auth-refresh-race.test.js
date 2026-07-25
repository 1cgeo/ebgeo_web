// Path: tests/integration/auth-refresh-race.test.js
//
// INVARIANT PINNED HERE: a refresh token can be exchanged exactly once. Under N
// concurrent attempts with the SAME token, exactly one caller receives a new family
// and every other caller is refused — never two families from one token.
//
// Why this file exists next to `auth-refresh-race.repro.test.js`: that suite drives
// the same invariant through supertest, and supertest cannot prove it. It opens a
// cold TCP socket per request, and that setup cost serializes the "concurrent"
// calls, so the assertion passes whether or not the code provides the guarantee.
// The full mechanism and the two places this repository already measured it are
// documented in `tests/helpers/concurrency.js`. The rule, stated once:
//
//   MUTUAL EXCLUSION IS ASSERTED AT THE SQL OR SERVICE LEVEL, NEVER BY TWO HTTP
//   REQUESTS.
//
// So nothing here touches HTTP. Three layers, each proving something the others
// cannot:
//   1. SQL, deterministic — a barrier puts N transactions in flight before any of
//      them issues the claim, so the interleaving is forced, not hoped for. This is
//      where the guarantee actually lives: `WHERE revoked_at IS NULL ... RETURNING`.
//   2. Service, repeated — `refresh()` called concurrently on the shared pg-promise
//      pool, R times over, because one green run of a real race proves little. The
//      number that means something is "0 of R runs had a second winner".
//   3. Contract — the losers fail as `UnauthorizedError` (401), not as a crash, and
//      the reuse alarm that turns a stolen token into a family-wide revocation is
//      still armed.
//
// NEGATIVE CONTROL (must be re-run whenever the claim query changes): restore the
// pre-fix read-check-then-write pair — `FIND_REFRESH_TOKEN_ANY` → inspect
// `revoked_at` → `UPDATE ... SET revoked_at = NOW() WHERE token_hash = $1` with
// neither `AND revoked_at IS NULL` nor `RETURNING` — and cases 1, 2 and 4 fail with
// several winners per run. Restore with
// `git checkout HEAD -- src/modules/auth/auth.queries.js src/modules/auth/auth.service.js`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';
import { repeatRace, raceOnConnections } from '../helpers/concurrency.js';
import * as authService from '../../src/modules/auth/auth.service.js';
import * as Q from '../../src/modules/auth/auth.queries.js';

// 6 racers is comfortably above the 2 that supertest serialized into a false green,
// and well under the pool max (10) so the pool itself never becomes the serializer.
const PARTICIPANTS = 6;
// Repetition is the whole point: a single run can get lucky either way.
const RUNS = 12;

const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

describe('refresh token is single-use under real concurrency', () => {
  let db;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Creates a user and logs in THROUGH THE SERVICE (no HTTP anywhere in this file). */
  const freshSession = async () => {
    const user = await createUser(db, { username: `svcrace_${randomUUID().slice(0, 8)}` });
    const { refreshToken } = await authService.login(user.username, user.password);
    return { user, refreshToken };
  };

  const liveTokenCount = async (userId) => {
    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
    return rows[0].n;
  };

  // ---------------------------------------------------------------------------
  // 1 · SQL level — deterministic, the guarantee at its source
  // ---------------------------------------------------------------------------
  it('the claim query is the mutual exclusion: N forced-interleaved transactions, 1 winner', async () => {
    const { user, refreshToken } = await freshSession();
    const hash = hashOf(refreshToken);

    // Every participant is provably inside an open transaction before any of them
    // runs the UPDATE (see `createBarrier`). Postgres blocks the second writer on
    // the row lock and then RE-EVALUATES its WHERE against the committed row — the
    // re-evaluation is precisely what a read-then-write pair cannot do, because its
    // read already happened.
    const outcomes = await raceOnConnections({
      participants: PARTICIPANTS,
      work: async (client) => client.query(Q.CLAIM_REFRESH_TOKEN, [hash]),
    });

    const failures = outcomes.filter((o) => !o.ok);
    assert.equal(failures.length, 0, `no participant may error: ${failures.map((f) => f.error?.message).join('; ')}`);

    const winners = outcomes.filter((o) => o.value.rowCount === 1).length;
    assert.equal(winners, 1, `exactly one transaction may claim the token, got ${winners}`);

    assert.equal(await liveTokenCount(user.id), 0, 'the claimed token is revoked exactly once');
  });

  // ---------------------------------------------------------------------------
  // 2 · Service level — repeated, because one run proves little
  // ---------------------------------------------------------------------------
  it(`${RUNS} repeated races of ${PARTICIPANTS} concurrent refresh() calls yield 1 winner each`, async () => {
    const outcome = await repeatRace({
      runs: RUNS,
      participants: PARTICIPANTS,
      setup: () => freshSession(),
      attempt: (ctx) => authService.refresh(ctx.refreshToken),
      isWinner: (o) => o.ok,
    });

    assert.equal(
      outcome.multiWinnerRuns, 0,
      `no run may produce a second family from one token — ${outcome.report()}`
    );
    assert.equal(
      outcome.zeroWinnerRuns, 0,
      `every run must still have a winner (a race must not starve the legitimate client) — ${outcome.report()}`
    );
  });

  // ---------------------------------------------------------------------------
  // 3 · The durable consequence — rows, not return values
  // ---------------------------------------------------------------------------
  it('a race leaves exactly one live refresh token behind', async () => {
    const { user, refreshToken } = await freshSession();

    // Row count is the proof that survives the call: every winner INSERTs, so a
    // second success is visible in the table even if both callers were told 200.
    await Promise.allSettled(
      Array.from({ length: PARTICIPANTS }, () => authService.refresh(refreshToken))
    );

    assert.equal(
      await liveTokenCount(user.id), 1,
      'one token in must yield one token out, no matter how many callers raced'
    );
  });

  // ---------------------------------------------------------------------------
  // 4 · Error contract — losing is a 401, not a crash
  // ---------------------------------------------------------------------------
  it('the losers are refused with UnauthorizedError (401), not an unhandled failure', async () => {
    const { refreshToken } = await freshSession();

    const settled = await Promise.allSettled(
      Array.from({ length: PARTICIPANTS }, () => authService.refresh(refreshToken))
    );

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    assert.equal(fulfilled.length, 1, `exactly one winner, got ${fulfilled.length}`);

    const rejected = settled.filter((s) => s.status === 'rejected');
    assert.equal(rejected.length, PARTICIPANTS - 1, 'every other caller is refused');

    const statuses = rejected.map((s) => s.reason?.statusCode ?? s.reason?.status ?? 500);
    assert.deepEqual(
      [...new Set(statuses)], [401],
      `losers must surface as 401, got ${statuses.join(',')} — `
      + `a 500 here means the race is being handled by a crash, not by the claim`
    );
  });

  // ---------------------------------------------------------------------------
  // 5 · Reuse detection is still armed
  // ---------------------------------------------------------------------------
  // The atomic claim and reuse detection pull in opposite directions: the claim makes
  // losing normal, while reuse detection treats a spent token as evidence of theft.
  // The grace window is what separates them, so a change to one can silently disable
  // the other. Asserted here at the service level so this file's guarantee cannot be
  // "achieved" by dropping the alarm.
  it('a spent token replayed OUTSIDE the grace window still revokes the whole family', async () => {
    const { user, refreshToken } = await freshSession();

    const { refreshToken: fresh } = await authService.refresh(refreshToken);
    assert.ok(fresh, 'the winner got a new token');

    // Age the rotation past the window rather than sleeping through it: the decision
    // reads `revoked_at`, so backdating it is the same input the clock would supply.
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '1 hour'
       WHERE user_id = $1 AND revoked_at IS NOT NULL`,
      [user.id]
    );

    await assert.rejects(
      () => authService.refresh(refreshToken),
      (err) => err.statusCode === 401,
      'replaying a spent token is refused'
    );

    assert.equal(
      await liveTokenCount(user.id), 0,
      'reuse detection revoked the family, including the winner\'s fresh token'
    );
  });
});

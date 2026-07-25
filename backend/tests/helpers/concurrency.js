// Path: tests/helpers/concurrency.js
//
// WHY THIS FILE EXISTS — read before "simplifying" anything here back into two
// `request(app)` calls.
//
// Mutual exclusion asserted through supertest is a FALSE GREEN, not a flake, and a
// stable false green is worse than no test at all because it looks like coverage.
// The mechanism is concrete: `supertest(app)` binds an ephemeral server and opens a
// COLD TCP socket per request. Connect + write + parse costs enough that, by the
// time request B's body reaches the handler, request A has usually finished its
// whole read-check-then-write sequence. The two "concurrent" requests are simply
// executed one after the other, so a broken read-then-write pair passes.
//
// This was measured in this repository, twice:
//   - `auth-gaps.test.js` auth-09 asserted "two concurrent refreshes cannot both
//     win" and passed on EVERY run against a rotation query that had no
//     `revoked_at IS NULL` guard and no `RETURNING` — i.e. against code that could
//     not possibly provide the guarantee. With warm keep-alive sockets, which is
//     what a real client (or an attacker) has, the same code loses the race in most
//     runs.
//   - `low-impact-fixes.test.js:79-85` had already written the finding down: driving
//     the verification-token claim through two HTTP requests "does NOT reliably
//     interleave them".
//
// THE RULE THIS FILE CODIFIES:
//   Mutual exclusion is asserted at the SQL level or at the SERVICE level.
//   Never by two HTTP requests.
//
// Two shapes are offered, and they prove different things:
//
//   `raceOnConnections` — DETERMINISTIC. N dedicated connections each open a
//     transaction, meet at an explicit rendezvous (`createBarrier`), and only then
//     issue the statement. Every participant is provably inside its transaction
//     before any of them acts, so the interleaving is not left to scheduling luck.
//     Use it to pin the guarantee where it actually lives: the SQL predicate.
//
//   `repeatRace` — STATISTICAL, and therefore repeated. A single run of a real race
//     can get lucky in either direction, so this runs the same race `runs` times and
//     reports how many runs produced more than one winner. One green run proves
//     little; twenty green runs with a documented losing baseline proves something.
//
// Neither helper knows what "winning" means — the caller says so via `isWinner`,
// because a winner is a 200, or a non-empty `RETURNING`, or a resolved promise,
// depending on the layer under test.

import pg from 'pg';

/**
 * A rendezvous point for N participants: every `arrive()` stays pending until the
 * Nth participant has also called it, then they all resume together.
 *
 * This is the piece that makes a race deterministic instead of hopeful. Without it
 * "concurrent" only means "started from the same Promise.all", which says nothing
 * about where each participant actually was when the others acted.
 *
 * @param {number} participants - How many callers must arrive before any proceeds.
 * @returns {{ arrive: () => Promise<void>, abort: (err: Error) => void }}
 */
export function createBarrier(participants) {
  let arrived = 0;
  let release;
  let fail;
  const gate = new Promise((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  // A barrier that can hang forever turns a bug into a timeout with no message.
  // Swallow the rejection here; every `arrive()` caller gets it instead.
  gate.catch(() => {});

  return {
    async arrive() {
      arrived += 1;
      if (arrived >= participants) {
        release();
      }
      return gate;
    },
    abort(err) {
      fail(err ?? new Error('barrier aborted'));
    },
  };
}

/**
 * Races `work` across N INDEPENDENT database connections, each inside its own
 * transaction, synchronized by a barrier so that all of them are open and waiting
 * before any of them executes.
 *
 * Independent connections matter: two statements sent over the SAME connection are
 * serialized by the wire protocol, so a single-client "race" is not a race. A shared
 * pool can also silently serialize when its max is below the participant count.
 *
 * Postgres does the rest: the second UPDATE to touch a locked row blocks until the
 * first transaction commits, then RE-EVALUATES its WHERE against the committed row.
 * That re-evaluation is exactly why `WHERE <claimed_at> IS NULL RETURNING` is a
 * mutual exclusion and a read-then-write pair is not.
 *
 * @param {Object} options
 * @param {string} [options.connectionString] - Defaults to `process.env.DATABASE_URL`.
 * @param {number} [options.participants=2] - Number of racing connections.
 * @param {(client: import('pg').Client, index: number) => Promise<any>} options.work
 *   Runs inside an open transaction, after every participant has arrived.
 * @returns {Promise<Array<{ ok: boolean, value?: any, error?: Error }>>} One entry per
 *   participant, in participant order.
 */
export async function raceOnConnections({ connectionString, participants = 2, work }) {
  const dsn = connectionString || process.env.DATABASE_URL;
  const barrier = createBarrier(participants);
  const clients = [];

  try {
    for (let i = 0; i < participants; i += 1) {
      const client = new pg.Client({ connectionString: dsn });
      // Connect serially and BEFORE the barrier: a connection handshake happening
      // after the rendezvous would reintroduce the very setup cost that makes
      // supertest serialize.
      await client.connect();
      clients.push(client);
    }

    const run = async (client, index) => {
      await client.query('BEGIN');
      try {
        await barrier.arrive();
        const value = await work(client, index);
        await client.query('COMMIT');
        return { ok: true, value };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        return { ok: false, error };
      }
    };

    return await Promise.all(clients.map((client, i) => run(client, i)));
  } finally {
    await Promise.all(clients.map((c) => c.end().catch(() => {})));
  }
}

/**
 * Runs the same race `runs` times and reports how often more than one participant
 * won — determinism by repetition.
 *
 * A race asserted once can pass by luck. The number that means something is "0 of 20
 * runs had a second winner", stated next to the baseline the broken code produces
 * ("18 of 20 did"). `report()` formats exactly that, so a failure message names the
 * evidence instead of just `expected 1 to equal 2`.
 *
 * @param {Object} options
 * @param {number} [options.runs=20] - How many times to repeat the race.
 * @param {number} [options.participants=4] - Concurrent attempts per run.
 * @param {(run: number) => Promise<any>} options.setup - Builds a FRESH contended
 *   resource for the run (a race re-run against a spent resource proves nothing).
 * @param {(ctx: any, index: number) => Promise<any>} options.attempt - One racing
 *   attempt. Rejections are captured, not thrown: losing is an expected outcome.
 * @param {(outcome: { ok: boolean, value?: any, error?: Error }) => boolean} options.isWinner
 * @param {(ctx: any) => Promise<void>} [options.teardown]
 * @returns {Promise<{ runs: number, participants: number, winnersPerRun: number[],
 *   multiWinnerRuns: number, zeroWinnerRuns: number, report: () => string }>}
 */
export async function repeatRace({
  runs = 20,
  participants = 4,
  setup,
  attempt,
  isWinner,
  teardown,
}) {
  const winnersPerRun = [];

  for (let run = 0; run < runs; run += 1) {
    const ctx = await setup(run);
    try {
      const settled = await Promise.all(
        Array.from({ length: participants }, (_, i) =>
          Promise.resolve()
            .then(() => attempt(ctx, i))
            .then(
              (value) => ({ ok: true, value }),
              (error) => ({ ok: false, error })
            )
        )
      );
      winnersPerRun.push(settled.filter((outcome) => isWinner(outcome)).length);
    } finally {
      if (teardown) {
        await teardown(ctx);
      }
    }
  }

  const multiWinnerRuns = winnersPerRun.filter((n) => n > 1).length;
  const zeroWinnerRuns = winnersPerRun.filter((n) => n === 0).length;

  return {
    runs,
    participants,
    winnersPerRun,
    multiWinnerRuns,
    zeroWinnerRuns,
    report() {
      return (
        `${runs} runs x ${participants} concurrent attempts | `
        + `runs with >1 winner: ${multiWinnerRuns} | runs with 0 winners: ${zeroWinnerRuns} | `
        + `winners per run: [${winnersPerRun.join(',')}]`
      );
    },
  };
}

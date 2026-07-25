// Path: tests/integration/atlas-transfer-ownership-race.test.js
//
// INVARIANT PINNED HERE (bugs-backend #71): an atlas changes owner at most once per
// authorized starting owner. Under N concurrent transfers that were all authorized against
// the SAME `currentOwnerId`, exactly one succeeds and every other is refused with 409 —
// and, above all, NO candidate ends up neither owner nor member.
//
// The failure this guards is silent, which is why it needs its own file. Two principals can
// legitimately be authorized against the same owner at the same instant: the owner
// themself, and a global admin, whom `requireAtlasPermission` grants owner-level on every
// atlas. Both read `req.atlasOwnerId = A`, both call the service, both got 200 — and the
// FIRST recipient ended up with nothing at all: their ownership was overwritten by the
// second transfer, while their `atlas_shares` row had already been deleted (the service
// drops it because ownership is supposed to come from `owner_id` alone). A member silently
// lost every level of access to a project, and both callers were told it worked.
//
// NOT DRIVEN THROUGH HTTP, and that is not a stylistic choice: `supertest` opens a cold TCP
// socket per request, and the setup cost serializes the two "concurrent" calls, so the
// assertion passes whether or not the code provides the guarantee. The mechanism and the two
// times this repository measured it are in `tests/helpers/concurrency.js`. The rule:
//
//   MUTUAL EXCLUSION IS ASSERTED AT THE SQL OR SERVICE LEVEL, NEVER BY TWO HTTP REQUESTS.
//
// NEGATIVE CONTROL (re-run whenever the handover statement changes): restore the pre-fix
// UPDATE in `transferOwnership` (`WHERE id = $1 AND deleted_at IS NULL`, via `t.none`, with
// no rowCount check) and every case below fails — the repeated race reports 4 winners in
// every run, the losers are not 409s, and `atlas_shares` shows the vanished member. Restore
// by COPYING the file aside first and copying it back (never `git checkout`: other agents
// are working in this tree).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare } from '../helpers/fixtures.js';
import { repeatRace } from '../helpers/concurrency.js';
import * as atlasService from '../../src/modules/atlas/atlas.service.js';

// 4 racers: above the 2 that supertest serializes into a false green, well under the pool
// max (10) so the pool itself never becomes the serializer.
const PARTICIPANTS = 4;
// Repetition is the point — a single run of a real race can get lucky in either direction.
const RUNS = 8;

describe('atlas ownership transfer is single-winner under real concurrency', () => {
  let db, owner, candidates;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    const tag = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `p71_owner_${tag}` });
    candidates = [];
    for (let i = 0; i < PARTICIPANTS; i += 1) {
      candidates.push(await createUser(db, { username: `p71_cand${i}_${tag}` }));
    }
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** A fresh atlas owned by `owner`, with every candidate already a 'write' member. */
  const freshAtlas = async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P71 ${randomUUID().slice(0, 6)}` });
    for (const candidate of candidates) {
      await createShare(db, atlas.id, candidate.id, 'write', owner.id);
    }
    return atlas;
  };

  const ownerOf = async (atlasId) => {
    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlasId]);
    return rows[0].owner_id;
  };

  const shareOf = async (atlasId, userId) => {
    const { rows } = await db.query(
      'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlasId, userId]
    );
    return rows[0]?.permission ?? null;
  };

  // ---------------------------------------------------------------------------
  // 1 · Service level — repeated, because one run proves little
  // ---------------------------------------------------------------------------
  it(`${RUNS} races of ${PARTICIPANTS} concurrent transfers from the same owner: 1 winner each`, async () => {
    const outcome = await repeatRace({
      runs: RUNS,
      participants: PARTICIPANTS,
      setup: () => freshAtlas(),
      // Every participant passes the SAME currentOwnerId — that is the real shape: each
      // read it from a middleware that ran before any of them wrote.
      attempt: (atlas, i) => atlasService.transferOwnership(atlas.id, owner.id, candidates[i].id),
      isWinner: (o) => o.ok,
    });

    assert.equal(
      outcome.multiWinnerRuns, 0,
      `an atlas may change owner only once per authorized owner — ${outcome.report()}`
    );
    assert.equal(
      outcome.zeroWinnerRuns, 0,
      `a race must not starve the legitimate caller — ${outcome.report()}`
    );
  });

  // ---------------------------------------------------------------------------
  // 2 · The durable consequence — rows, not return values
  // ---------------------------------------------------------------------------
  // This is the assertion that names the actual harm. A second "successful" transfer
  // overwrites owner_id AND has already deleted the first recipient's share, so the first
  // recipient holds neither. Return values alone cannot show it: both callers got an atlas.
  it('no candidate is left with neither ownership nor share', async () => {
    const atlas = await freshAtlas();

    await Promise.allSettled(
      candidates.map((c) => atlasService.transferOwnership(atlas.id, owner.id, c.id))
    );

    const finalOwner = await ownerOf(atlas.id);
    assert.ok(
      candidates.some((c) => c.id === finalOwner),
      'the atlas belongs to one of the candidates'
    );

    assert.equal(candidates.length, PARTICIPANTS, 'the loop below must actually assert something');
    for (const candidate of candidates) {
      if (candidate.id === finalOwner) {
        assert.equal(
          await shareOf(atlas.id, candidate.id), null,
          'the winner owns the atlas and holds no redundant share'
        );
      } else {
        assert.equal(
          await shareOf(atlas.id, candidate.id), 'write',
          'a losing transfer rolls back whole: the candidate keeps the membership they had'
        );
      }
    }

    // And the previous owner is demoted exactly once, by the winner.
    assert.equal(await shareOf(atlas.id, owner.id), 'manage');
  });

  // ---------------------------------------------------------------------------
  // 3 · Error contract — losing is a 409, not a crash and not a silent 200
  // ---------------------------------------------------------------------------
  it('the losers are refused with ConflictError (409)', async () => {
    const atlas = await freshAtlas();

    const settled = await Promise.allSettled(
      candidates.map((c) => atlasService.transferOwnership(atlas.id, owner.id, c.id))
    );

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    assert.equal(fulfilled.length, 1, `exactly one winner, got ${fulfilled.length}`);

    const statuses = settled
      .filter((s) => s.status === 'rejected')
      .map((s) => s.reason?.statusCode ?? s.reason?.status ?? 500);
    assert.deepEqual(
      [...new Set(statuses)], [409],
      `losers must surface as 409, got ${statuses.join(',')} — a 500 here means the race `
      + 'is being handled by a crash, and a 200 means it is not being handled at all'
    );
  });

  // ---------------------------------------------------------------------------
  // 4 · A STALE authorization is refused even with no concurrency at all
  // ---------------------------------------------------------------------------
  // Same predicate, different door: the ownership read by the middleware can simply be out
  // of date by the time the service runs. The scoped UPDATE catches that too, and this case
  // needs no timing to fail, so it keeps the guarantee pinned even if the racing cases ever
  // get flaky-skipped.
  it('a transfer authorized against a stale owner is refused, and changes nothing', async () => {
    const atlas = await freshAtlas();
    const [first, second] = candidates;

    await atlasService.transferOwnership(atlas.id, owner.id, first.id);

    await assert.rejects(
      () => atlasService.transferOwnership(atlas.id, owner.id, second.id),
      (err) => err.statusCode === 409,
      'the second caller still believes `owner` owns the atlas'
    );

    assert.equal(await ownerOf(atlas.id), first.id, 'ownership untouched by the refusal');
    assert.equal(await shareOf(atlas.id, second.id), 'write', 'and the target keeps their share');
  });

  // The scope must not refuse a LEGITIMATE sequential transfer: a guard that also blocks
  // the normal path is not a fix. (This is the "what would the green be proving" half.)
  it('sequential transfers with an up-to-date owner still work, one after another', async () => {
    const atlas = await freshAtlas();
    const [first, second] = candidates;

    await atlasService.transferOwnership(atlas.id, owner.id, first.id);
    await atlasService.transferOwnership(atlas.id, first.id, second.id);

    assert.equal(await ownerOf(atlas.id), second.id);
    assert.equal(await shareOf(atlas.id, first.id), 'manage', 'the ex-owner is demoted, not dropped');
    assert.equal(await shareOf(atlas.id, second.id), null);
  });
});

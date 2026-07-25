// Path: tests/integration/permission-hierarchy-matrix.test.js
// The COMPARISON that decides access — `resolvedLevel < requiredLevelNum` in
// requireAtlasPermission — asserted for all five resolved levels against all
// five required levels.
//
// Why this file exists: `resolvePermission` had two unit suites (a duplicate
// pair, now merged) and the gate itself had none. resolvePermission is a
// passthrough of the share row; the hierarchy is where a level actually gets
// enforced, and a level that quietly stops outranking another is exactly the bug
// this project has hit twice (the co-Gestor excluded by a closed `write|owner`
// list). Twenty-five cases named by their pair make any such change loud.
//
// The middleware is invoked directly rather than through a route, because
// mounting one route per (resolved, required) pair would test the route table
// instead of the comparison. Everything else is real: real DB rows, real share
// lookup, real ForbiddenError.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare } from '../helpers/fixtures.js';
import { requireAtlasPermission, PERMISSION_LEVELS } from '../../src/middleware/permissions.js';

// The DOCUMENTED order, written out here rather than derived from
// PERMISSION_LEVELS. Deriving the expectation from the table under test is what
// the first version of this file did, and demoting `manage` to 2 left all 25
// cases green: the expectation moved with the defect. This array is the
// independent statement of `read < comment < write < manage < owner`.
const LEVELS = ['read', 'comment', 'write', 'manage', 'owner'];

/** True when `resolved` is at or above `required` per the documented ordering. */
function shouldAllow(resolved, required) {
  return LEVELS.indexOf(resolved) >= LEVELS.indexOf(required);
}

describe('requireAtlasPermission — the 5x5 hierarchy', () => {
  let db, atlas;
  /** @type {Record<string, string>} resolved level → the user id that has it */
  const userFor = {};

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    const sfx = randomUUID().slice(0, 8);
    const owner = await createUser(db, { username: `hier_owner_${sfx}` });
    atlas = await createAtlas(db, owner.id, { name: `Hierarchy Atlas ${sfx}` });
    userFor.owner = owner.id;

    for (const level of ['read', 'comment', 'write', 'manage']) {
      const u = await createUser(db, { username: `hier_${level}_${sfx}` });
      await createShare(db, atlas.id, u.id, level, owner.id);
      userFor[level] = u.id;
    }
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /**
   * Runs the middleware and reports what it decided.
   * @param {string} requiredLevel - level passed to requireAtlasPermission
   * @param {string|null} userId - principal (null = anonymous)
   * @returns {Promise<{allowed: boolean, error: Error|null, resolved: string|undefined}>}
   */
  function gate(requiredLevel, userId) {
    const middleware = requireAtlasPermission(requiredLevel);
    const req = { params: { atlasId: atlas.id }, user: userId ? { id: userId } : null };
    return new Promise((resolve) => {
      middleware(req, {}, (err) => {
        resolve({ allowed: !err, error: err ?? null, resolved: req.atlasPermission });
      });
    });
  }

  it('every (resolved, required) pair follows the documented ordering — 25 cases', async () => {
    const failures = [];
    let checked = 0;

    for (const resolved of LEVELS) {
      for (const required of LEVELS) {
        const expected = shouldAllow(resolved, required);
        const { allowed, resolved: seen } = await gate(required, userFor[resolved]);
        if (allowed !== expected) {
          failures.push(`${resolved} asked for ${required}: expected ${expected ? 'ALLOW' : 'DENY'}, got ${allowed ? 'ALLOW' : 'DENY'}`);
        }
        if (allowed && seen !== resolved) {
          failures.push(`${resolved} asked for ${required}: req.atlasPermission was "${seen}"`);
        }
        checked++;
      }
    }

    assert.equal(checked, LEVELS.length * LEVELS.length, 'guard: all 25 pairs must run');
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  it('the two crossings that have caused real bugs, stated by name', async () => {
    // Redundant with the matrix on purpose: when the matrix goes red these two
    // lines say WHICH promise broke without reading a table.
    assert.equal((await gate('write', userFor.manage)).allowed, true,
      'a co-Gestor must satisfy a `write` gate — this is the closed-list bug');
    assert.equal((await gate('read', userFor.comment)).allowed, true,
      'a Comentarista must satisfy a `read` gate');
    assert.equal((await gate('manage', userFor.write)).allowed, false,
      'an editor must NOT satisfy a `manage` gate');
    assert.equal((await gate('owner', userFor.manage)).allowed, false,
      'the co-Gestor stops below the owner');
  });

  it('a principal with no share at all is denied even at the lowest level, and with 404 rather than 403', async () => {
    // The 5x5 matrix above is entirely about the `resolvedLevel < requiredLevelNum`
    // comparison, which only runs once a level HAS been resolved. This case is the row
    // before the matrix: nothing resolves, so the gate never reaches the comparison and
    // answers NotFound instead of Forbidden (the escada decided on 2026-07-25). Pinning
    // the class here is what keeps the two outcomes from being collapsed into one.
    const stranger = await createUser(db, { username: `hier_stranger_${randomUUID().slice(0, 8)}` });
    const res = await gate('read', stranger.id);
    assert.equal(res.allowed, false);
    assert.equal(res.error.statusCode, 404, 'no relation to the atlas is 404, not 403');
    assert.equal(res.error.code, 'NOT_FOUND');
    assert.match(res.error.message, /Atlas not found/);
    assert.equal(res.resolved, undefined, 'nothing must be attached to req on denial');
  });

  it('anonymous is denied on a private atlas', async () => {
    const res = await gate('read', null);
    assert.equal(res.allowed, false);
  });

  it('an unknown REQUIRED level fails CLOSED, at mount time', () => {
    // The trap this case was originally written to PIN: PERMISSION_LEVELS['mange']
    // is undefined and `1 < undefined` is false, so a typo in a route argument used
    // to open that route to every principal instead of failing. The middleware now
    // refuses to be constructed at all, which is a boot failure rather than a silent
    // hole — asserted here so that reverting to the numeric-only comparison is loud.
    assert.throws(
      () => requireAtlasPermission('mange'),
      /unknown level/,
      'a misspelled level must never produce a working gate'
    );
    assert.equal(PERMISSION_LEVELS.mange, undefined, 'the cause the guard exists for');
    // Not pedantry: property lookup stringifies, so an array key would otherwise
    // pass a `key in table` check.
    assert.throws(() => requireAtlasPermission(['read']), /unknown level/);
    assert.throws(() => requireAtlasPermission(undefined), /unknown level/);
    // Positive control: the five real levels all construct.
    let built = 0;
    for (const level of LEVELS) {
      assert.equal(typeof requireAtlasPermission(level), 'function', `${level} must build a gate`);
      built++;
    }
    assert.equal(built, LEVELS.length);
  });
});

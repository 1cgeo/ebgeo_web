// Path: tests/integration/permission-levels-invariant.test.js
// Item 147 (testes-backend.md) — PERMISSION_LEVELS (code) vs the CHECK constraint on
// atlas_shares.permission (database) must not drift.
//
// This is the SYSTEMIC guard that was missing from both recurrences of the
// closed-permission-list class. The failure mode is silent in both directions:
//
//   - a level added by a migration but NOT added to PERMISSION_LEVELS makes
//     `PERMISSION_LEVELS[resolved]` undefined, and `undefined >= n` is false, so
//     every gate DENIES that tier without a word;
//   - a level dropped from PERMISSION_LEVELS while rows still carry it does the same.
//
// Neither shows up in a unit test of the table alone, because a unit test can only
// compare the table with itself. It is the backend analogue of the "a watched list
// must not be allowed to go empty" guard that saved docs-integridade
// (livro-razao 2026-07-18, regressão-própria).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { PERMISSION_LEVELS } from '../../src/middleware/permissions.js';

/** Pulls the literals out of a CHECK expression like: permission = ANY (ARRAY['read'::text, ...]). */
function literalsIn(expr) {
  return [...expr.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('PERMISSION_LEVELS vs the atlas_shares.permission CHECK', () => {
  let db, checkExpr;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    const { rows } = await db.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'atlas_shares'
         AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) ILIKE '%permission%'
    `);
    assert.equal(rows.length, 1, 'exactly one CHECK on atlas_shares.permission must exist');
    checkExpr = rows[0].def;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('every value the DATABASE accepts has an entry in PERMISSION_LEVELS', () => {
    const accepted = literalsIn(checkExpr);
    // Anti-empty-sweep: if the regex ever stops matching, the loop below would
    // iterate zero times and report success without checking anything.
    assert.equal(accepted.length, 4, `expected 4 stored levels, parsed ${JSON.stringify(accepted)} from ${checkExpr}`);

    for (const level of accepted) {
      assert.equal(
        typeof PERMISSION_LEVELS[level],
        'number',
        `the DB accepts '${level}' but PERMISSION_LEVELS has no entry — every gate would deny it in silence`,
      );
    }
  });

  it('the four stored levels are exactly read/comment/write/manage', () => {
    assert.deepEqual(literalsIn(checkExpr).slice().sort(), ['comment', 'manage', 'read', 'write']);
  });

  it("'owner' exists in the code table, is NOT in the CHECK, and is the maximum", () => {
    // owner is synthesized from atlas.owner_id, never stored as a share.
    assert.equal(typeof PERMISSION_LEVELS.owner, 'number');
    assert.ok(!literalsIn(checkExpr).includes('owner'), 'owner must not be a storable share value');

    const max = Math.max(...Object.values(PERMISSION_LEVELS));
    assert.equal(PERMISSION_LEVELS.owner, max, 'owner must outrank every stored level');
  });

  it('the code table has exactly the five levels, strictly ordered read < comment < write < manage < owner', () => {
    const order = ['read', 'comment', 'write', 'manage', 'owner'];
    assert.equal(Object.keys(PERMISSION_LEVELS).length, 5, 'removing a level must break this test, not shrink coverage');
    assert.deepEqual(Object.keys(PERMISSION_LEVELS), order);

    let previous = -Infinity;
    let compared = 0;
    for (const level of order) {
      assert.ok(
        PERMISSION_LEVELS[level] > previous,
        `${level}=${PERMISSION_LEVELS[level]} must rank strictly above ${previous}`,
      );
      previous = PERMISSION_LEVELS[level];
      compared += 1;
    }
    assert.equal(compared, 5, 'all five orderings were compared');
  });

  it('the database really enforces the CHECK — a level unknown to it is rejected', () => {
    // Positive control: without this, the parse above could be describing a
    // constraint that no longer bites.
    return assert.rejects(
      () => db.query(
        `INSERT INTO atlas_shares (atlas_id, user_id, permission)
         VALUES (gen_random_uuid(), gen_random_uuid(), 'superuser')`,
      ),
      (err) => err.code === '23514' || err.code === '23503',
      'an unknown permission must be refused by the database itself',
    );
  });
});

// Path: tests/unit/middleware-permissions.test.js
// The pure half of src/middleware/permissions.js: `resolvePermission` (which
// share/owner/public wins) and the shape of PERMISSION_LEVELS.
//
// This file ABSORBED tests/unit/permission-resolver.test.js, which was a near
// literal duplicate: same import, same nine scenarios, and — the part that
// mattered — the same hole in both copies, since neither ever passed 'manage' or
// 'comment' as a share permission. Two copies of one blind spot cost twice and
// diverge the day one is updated; the poorer of the two was deleted and the
// missing tiers added here.
//
// The HIERARCHY (resolved >= required, the comparison that actually grants or
// denies access) needs the database and is asserted end-to-end against the real
// middleware in tests/integration/permission-hierarchy-matrix.test.js. What
// belongs here is the level TABLE itself, since every gate in the codebase reads
// its numbers.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePermission, PERMISSION_LEVELS } from '../../src/middleware/permissions.js';

describe('resolvePermission()', () => {
  it('owner: userId matches ownerId → "owner"', () => {
    const result = resolvePermission({
      userId: 'user-1',
      ownerId: 'user-1',
      share: null,
      isPublic: false,
    });
    assert.equal(result, 'owner');
  });

  it('write share → "write"', () => {
    const result = resolvePermission({
      userId: 'user-2',
      ownerId: 'user-1',
      share: { permission: 'write' },
      isPublic: false,
    });
    assert.equal(result, 'write');
  });

  it('read share → "read"', () => {
    const result = resolvePermission({
      userId: 'user-2',
      ownerId: 'user-1',
      share: { permission: 'read' },
      isPublic: false,
    });
    assert.equal(result, 'read');
  });

  it('public atlas, no user → "read"', () => {
    const result = resolvePermission({
      userId: null,
      ownerId: 'user-1',
      share: null,
      isPublic: true,
    });
    assert.equal(result, 'read');
  });

  it('private atlas, no share, different user → null', () => {
    const result = resolvePermission({
      userId: 'user-2',
      ownerId: 'user-1',
      share: null,
      isPublic: false,
    });
    assert.equal(result, null);
  });

  it('anonymous on private atlas → null', () => {
    const result = resolvePermission({
      userId: null,
      ownerId: 'user-1',
      share: null,
      isPublic: false,
    });
    assert.equal(result, null);
  });

  it('owner takes precedence over share', () => {
    const result = resolvePermission({
      userId: 'user-1',
      ownerId: 'user-1',
      share: { permission: 'read' },
      isPublic: false,
    });
    assert.equal(result, 'owner');
  });

  it('share takes precedence over public', () => {
    const result = resolvePermission({
      userId: 'user-2',
      ownerId: 'user-1',
      share: { permission: 'write' },
      isPublic: true,
    });
    assert.equal(result, 'write');
  });

  it('public atlas with authenticated user (no share) → "read"', () => {
    const result = resolvePermission({
      userId: 'user-2',
      ownerId: 'user-1',
      share: null,
      isPublic: true,
    });
    assert.equal(result, 'read');
  });

  it('share with null permission → falls through to public/null', () => {
    const result = resolvePermission({
      userId: 'user-2',
      ownerId: 'user-1',
      share: { permission: null },
      isPublic: true,
    });
    // share.permission is null → falsy, so falls to isPublic check
    assert.equal(result, 'read');
  });

  // --- the two middle tiers, absent from BOTH former copies of this suite ---

  it('manage share → "manage" (the co-Gestor is not flattened to write)', () => {
    assert.equal(resolvePermission({
      userId: 'user-2', ownerId: 'user-1', share: { permission: 'manage' }, isPublic: false,
    }), 'manage');
  });

  it('comment share → "comment" (the Comentarista is not flattened to read)', () => {
    assert.equal(resolvePermission({
      userId: 'user-2', ownerId: 'user-1', share: { permission: 'comment' }, isPublic: false,
    }), 'comment');
  });

  it('owner still wins over a manage share (the owner is never demoted)', () => {
    assert.equal(resolvePermission({
      userId: 'user-1', ownerId: 'user-1', share: { permission: 'manage' }, isPublic: false,
    }), 'owner');
  });

  it('a comment share beats the public read of a public atlas', () => {
    // The share wins over `isPublic`, never the other way round: a public atlas
    // must not cap a Comentarista at read.
    assert.equal(resolvePermission({
      userId: 'user-2', ownerId: 'user-1', share: { permission: 'comment' }, isPublic: true,
    }), 'comment');
  });

  it('an unknown share value is passed through verbatim (pinned; the GATE must treat it as denial)', () => {
    // resolvePermission is a passthrough — it does not validate. The column CHECK
    // constraint is what normally keeps this from happening. Pinned because the
    // consequence lives elsewhere: PERMISSION_LEVELS['admin'] is undefined, and
    // `undefined < n` is false, so a gate comparing numerically would ALLOW it.
    // See the integration matrix for that behaviour asserted end to end.
    assert.equal(resolvePermission({
      userId: 'user-2', ownerId: 'user-1', share: { permission: 'admin' }, isPublic: false,
    }), 'admin');
    assert.equal(PERMISSION_LEVELS.admin, undefined, 'and it has no level, which is the trap');
  });
});

describe('PERMISSION_LEVELS — the table every gate in the codebase reads', () => {
  it('declares exactly the five documented levels, strictly increasing', () => {
    const expectedOrder = ['read', 'comment', 'write', 'manage', 'owner'];
    assert.deepEqual(
      Object.keys(PERMISSION_LEVELS),
      expectedOrder,
      'read < comment < write < manage < owner — a level that disappears from here is a level that stops being enforced'
    );
    assert.equal(Object.keys(PERMISSION_LEVELS).length, 5);

    let previous = -Infinity;
    let checked = 0;
    for (const level of expectedOrder) {
      const value = PERMISSION_LEVELS[level];
      assert.equal(typeof value, 'number', `${level} must have a numeric level`);
      assert.ok(value > previous, `${level} (${value}) must rank above the previous level (${previous})`);
      previous = value;
      checked++;
    }
    assert.equal(checked, expectedOrder.length, 'every level was inspected');
  });

  it('manage outranks write and comment outranks read (the two orderings that caused real bugs)', () => {
    assert.ok(
      PERMISSION_LEVELS.manage > PERMISSION_LEVELS.write,
      'the co-Gestor sits ABOVE the editor — a closed list write|owner excludes them'
    );
    assert.ok(PERMISSION_LEVELS.comment > PERMISSION_LEVELS.read);
    assert.ok(PERMISSION_LEVELS.owner > PERMISSION_LEVELS.manage);
  });
});

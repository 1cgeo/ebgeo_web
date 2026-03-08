// Path: tests/unit/middleware-permissions.test.js
// Tests for requireAtlasPermission middleware and resolvePermission function.
// Note: requireAtlasPermission depends on the database, so these tests
// focus on the pure function resolvePermission and use integration tests
// for the full middleware (already covered by permissions.test.js).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePermission } from '../../src/middleware/permissions.js';

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
});

// Path: tests/unit/permission-resolver.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePermission } from '../../src/middleware/permissions.js';

describe('Permission Resolver', () => {
  it('returns "owner" when user is the atlas owner', () => {
    const result = resolvePermission({
      userId: 'user-1',
      ownerId: 'user-1',
      share: null,
      isPublic: false
    });
    assert.equal(result, 'owner');
  });

  it('returns share permission when user has explicit share', () => {
    const result = resolvePermission({
      userId: 'user-2',
      ownerId: 'user-1',
      share: { permission: 'write' },
      isPublic: false
    });
    assert.equal(result, 'write');
  });

  it('returns read permission for read share', () => {
    const result = resolvePermission({
      userId: 'user-2',
      ownerId: 'user-1',
      share: { permission: 'read' },
      isPublic: false
    });
    assert.equal(result, 'read');
  });

  it('returns "read" for public atlas when user has no share', () => {
    const result = resolvePermission({
      userId: 'user-3',
      ownerId: 'user-1',
      share: null,
      isPublic: true
    });
    assert.equal(result, 'read');
  });

  it('returns null when user has no access and atlas is not public', () => {
    const result = resolvePermission({
      userId: 'user-3',
      ownerId: 'user-1',
      share: null,
      isPublic: false
    });
    assert.equal(result, null);
  });

  it('returns "read" for anonymous user on public atlas', () => {
    const result = resolvePermission({
      userId: null,
      ownerId: 'user-1',
      share: null,
      isPublic: true
    });
    assert.equal(result, 'read');
  });

  it('returns null for anonymous user on private atlas', () => {
    const result = resolvePermission({
      userId: null,
      ownerId: 'user-1',
      share: null,
      isPublic: false
    });
    assert.equal(result, null);
  });

  it('owner takes precedence over share', () => {
    const result = resolvePermission({
      userId: 'user-1',
      ownerId: 'user-1',
      share: { permission: 'read' }, // User also has a share, but is owner
      isPublic: false
    });
    assert.equal(result, 'owner');
  });

  it('share takes precedence over public', () => {
    const result = resolvePermission({
      userId: 'user-2',
      ownerId: 'user-1',
      share: { permission: 'write' },
      isPublic: true // Public would give read, but share gives write
    });
    assert.equal(result, 'write');
  });
});

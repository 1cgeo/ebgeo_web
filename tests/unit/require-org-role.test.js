// Path: tests/unit/require-org-role.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../../src/middleware/require-org-role.js';

function run(mw, user) {
  let err;
  mw({ user }, {}, (e) => { err = e; });
  return err;
}

describe('authorize(...roles)', () => {
  it('401 when unauthenticated', () => {
    const err = run(authorize('editor'), undefined);
    assert.equal(err?.statusCode, 401);
  });

  it('allows a matching org_role', () => {
    assert.equal(run(authorize('editor'), { org_role: 'editor', role: 'user' }), undefined);
  });

  it('403 for a non-matching org_role', () => {
    const err = run(authorize('editor'), { org_role: 'viewer', role: 'user' });
    assert.equal(err?.statusCode, 403);
  });

  it('global admin always passes', () => {
    assert.equal(run(authorize('owner'), { org_role: 'viewer', role: 'admin' }), undefined);
  });
});

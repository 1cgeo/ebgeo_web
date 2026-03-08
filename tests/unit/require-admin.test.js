// Path: tests/unit/require-admin.test.js
// Tests for the requireAdmin middleware.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin } from '../../src/middleware/require-admin.js';

describe('requireAdmin middleware', () => {
  it('calls next with ForbiddenError when req.user is missing', (_, done) => {
    requireAdmin({ user: undefined }, {}, (err) => {
      assert.ok(err);
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /Authentication required/);
      done();
    });
  });

  it('calls next with ForbiddenError when user is not admin', (_, done) => {
    requireAdmin({ user: { role: 'user' } }, {}, (err) => {
      assert.ok(err);
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /Admin access required/);
      done();
    });
  });

  it('calls next() without error when user is admin', (_, done) => {
    requireAdmin({ user: { role: 'admin' } }, {}, (err) => {
      assert.equal(err, undefined);
      done();
    });
  });

  it('rejects null user', (_, done) => {
    requireAdmin({ user: null }, {}, (err) => {
      assert.ok(err);
      assert.equal(err.statusCode, 403);
      done();
    });
  });
});

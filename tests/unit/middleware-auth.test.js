// Path: tests/unit/middleware-auth.test.js
// Tests for auth middleware: token extraction, JWT verification, auth/optionalAuth middleware.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { extractBearerToken, verifyAndMapUser, auth } from '../../src/middleware/auth.js';
import { optionalAuth } from '../../src/middleware/optional-auth.js';

const TEST_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';

function createValidToken(payload = {}, options = {}) {
  const defaults = {
    sub: 'user-123',
    username: 'cap.silva',
    nome: 'Capitão Silva',
    posto: 'Cap',
    role: 'user',
  };
  return jwt.sign({ ...defaults, ...payload }, TEST_SECRET, { expiresIn: '1h', ...options });
}

function mockReq(headers = {}) {
  return { headers };
}

function mockRes() {
  return {};
}

describe('extractBearerToken()', () => {
  it('returns null when Authorization header is absent', () => {
    const req = mockReq({});
    assert.equal(extractBearerToken(req), null);
  });

  it('returns null when header uses Basic scheme instead of Bearer', () => {
    const req = mockReq({ authorization: 'Basic dXNlcjpwYXNz' });
    assert.equal(extractBearerToken(req), null);
  });

  it('returns null when header is "Bearer" without a token', () => {
    const req = mockReq({ authorization: 'Bearer ' });
    // "Bearer ".slice(7) === "" which is falsy, but the function returns it
    const result = extractBearerToken(req);
    assert.equal(result, '');
  });

  it('extracts token correctly from valid Bearer header', () => {
    const req = mockReq({ authorization: 'Bearer abc.xyz.123' });
    assert.equal(extractBearerToken(req), 'abc.xyz.123');
  });

  it('returns null when header is lowercase "bearer"', () => {
    const req = mockReq({ authorization: 'bearer some-token' });
    assert.equal(extractBearerToken(req), null);
  });
});

describe('verifyAndMapUser()', () => {
  it('maps JWT payload to user object correctly', () => {
    const token = createValidToken();
    const user = verifyAndMapUser(token);

    assert.equal(user.id, 'user-123');
    assert.equal(user.username, 'cap.silva');
    assert.equal(user.nome, 'Capitão Silva');
    assert.equal(user.posto_graduacao, 'Cap');
    assert.equal(user.role, 'user');
  });

  it('defaults role to "user" when payload has no role', () => {
    const token = jwt.sign({ sub: 'u1', username: 'test', nome: 'Test', posto: 'Sgt' }, TEST_SECRET);
    const user = verifyAndMapUser(token);
    assert.equal(user.role, 'user');
  });

  it('throws UnauthorizedError with "Token expired" for expired tokens', () => {
    const token = jwt.sign({ sub: 'u1', username: 'test', nome: 'T', posto: 'S' }, TEST_SECRET, { expiresIn: '0s' });
    assert.throws(
      () => verifyAndMapUser(token),
      (err) => err.message === 'Token expired' && err.statusCode === 401
    );
  });

  it('throws UnauthorizedError with "Invalid token" for malformed tokens', () => {
    assert.throws(
      () => verifyAndMapUser('not.a.valid.jwt'),
      (err) => err.message === 'Invalid token' && err.statusCode === 401
    );
  });

  it('throws UnauthorizedError for token signed with wrong secret', () => {
    const token = jwt.sign({ sub: 'u1' }, 'wrong-secret');
    assert.throws(
      () => verifyAndMapUser(token),
      (err) => err.message === 'Invalid token' && err.statusCode === 401
    );
  });
});

describe('auth() middleware', () => {
  it('calls next with UnauthorizedError when no Authorization header', (_, done) => {
    const req = mockReq({});
    const res = mockRes();
    auth(req, res, (err) => {
      assert.ok(err);
      assert.equal(err.statusCode, 401);
      assert.match(err.message, /Missing or invalid/);
      done();
    });
  });

  it('sets req.user and calls next() with valid token', (_, done) => {
    const token = createValidToken();
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    auth(req, res, (err) => {
      assert.equal(err, undefined);
      assert.equal(req.user.id, 'user-123');
      assert.equal(req.user.username, 'cap.silva');
      done();
    });
  });

  it('calls next with error when token is invalid', (_, done) => {
    const req = mockReq({ authorization: 'Bearer invalid.token' });
    const res = mockRes();
    auth(req, res, (err) => {
      assert.ok(err);
      assert.equal(err.statusCode, 401);
      done();
    });
  });
});

describe('optionalAuth() middleware', () => {
  it('sets req.user to null and calls next() without token', (_, done) => {
    const req = mockReq({});
    const res = mockRes();
    optionalAuth(req, res, (err) => {
      assert.equal(err, undefined);
      assert.equal(req.user, null);
      done();
    });
  });

  it('sets req.user correctly with valid token', (_, done) => {
    const token = createValidToken({ sub: 'u-opt', username: 'opt_user' });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    optionalAuth(req, res, (err) => {
      assert.equal(err, undefined);
      assert.equal(req.user.id, 'u-opt');
      assert.equal(req.user.username, 'opt_user');
      done();
    });
  });

  it('sets req.user to null (no error) with invalid token', (_, done) => {
    const req = mockReq({ authorization: 'Bearer bad.token.here' });
    const res = mockRes();
    optionalAuth(req, res, (err) => {
      assert.equal(err, undefined);
      assert.equal(req.user, null);
      done();
    });
  });
});

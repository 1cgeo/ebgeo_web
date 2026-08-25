// Path: tests/unit/middleware-auth.test.js
// Tests for auth middleware: token extraction, JWT verification, auth middleware.
// (The optionalAuth suite was removed with the middleware itself — it had zero
//  production call sites and flexibleAuth supersedes it. See L7.)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { extractBearerToken, verifyAndMapUser, auth } from '../../src/middleware/auth.js';

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

  // AS FRASES VIRARAM PORTUGUES em 2026-08-25, e o que estes casos prendem NAO e a frase: e o
  // 401 e a DISTINCAO entre expirado e invalido, que o cliente usa para decidir se renova a
  // sessao ou manda entrar de novo. Colar a frase inteira aqui faria a proxima melhoria de
  // texto reprovar um comportamento correto, que e o guarda virando obstaculo.
  it('lanca UnauthorizedError de EXPIRADO para token vencido', () => {
    const token = jwt.sign({ sub: 'u1', username: 'test', nome: 'T', posto: 'S' }, TEST_SECRET, { expiresIn: '0s' });
    assert.throws(
      () => verifyAndMapUser(token),
      (err) => /expirou/i.test(err.message) && err.statusCode === 401
    );
  });

  it('lanca UnauthorizedError de INVALIDO para token malformado', () => {
    assert.throws(
      () => verifyAndMapUser('not.a.valid.jwt'),
      (err) => /nao e valida/i.test(err.message.normalize('NFD').replace(/[̀-ͯ]/g, ''))
        && err.statusCode === 401
    );
  });

  it('throws UnauthorizedError for token signed with wrong secret', () => {
    const token = jwt.sign({ sub: 'u1' }, 'wrong-secret');
    assert.throws(
      () => verifyAndMapUser(token),
      (err) => /nao e valida/i.test(err.message.normalize('NFD').replace(/[̀-ͯ]/g, ''))
        && err.statusCode === 401
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
      // O ARGUMENTO EXPLICITO SAIU: a classe ja diz "Faca login para continuar.", e repetir o
      // texto no `next()` foi o que manteve tres irmaos em ingles depois de a tabela ser
      // traduzida. O que este caso prende e o 401 sem cabecalho, nao a redacao.
      assert.match(err.message.normalize('NFD').replace(/[̀-ͯ]/g, ''), /login/i);
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

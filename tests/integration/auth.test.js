// Path: tests/integration/auth.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';

describe('Auth API', () => {
  let app, db, user;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('POST /auth/login — returns access + refresh tokens', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password })
      .expect(200);

    assert.ok(res.body.data.accessToken);
    assert.ok(res.body.data.refreshToken);
    assert.equal(res.body.data.user.username, user.username);
  });

  it('POST /auth/login — rejects wrong password', async () => {
    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: 'wrong' })
      .expect(401);
  });

  it('POST /auth/login — rejects non-existent user', async () => {
    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: 'nonexistent', password: 'password' })
      .expect(401);
  });

  it('POST /auth/refresh — rotates refresh token', async () => {
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password });

    const res = await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(200);

    assert.ok(res.body.data.accessToken);
    assert.ok(res.body.data.refreshToken);
    // Old refresh token should be revoked (new one is different)
    assert.notEqual(res.body.data.refreshToken, login.body.data.refreshToken);
  });

  it('POST /auth/logout — revokes refresh token', async () => {
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password });

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(204);

    // Trying to use the revoked token should fail
    await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(401);
  });

  it('GET /auth/me — returns current user profile', async () => {
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password });

    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);

    assert.equal(res.body.data.username, user.username);
    assert.equal(res.body.data.nome, user.nome);
  });

  it('rejects invalid access token', async () => {
    await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.token.here')
      .expect(401);
  });

  it('rejects missing authorization header', async () => {
    await supertest(app)
      .get('/api/v1/auth/me')
      .expect(401);
  });

  describe('POST /auth/register — Self-registration', () => {
    it('registers a new user with valid data', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'new_register_user',
          password: 'ValidPass@123',
          nome: 'Novo Usuario Registrado',
          posto_graduacao: 'Cap',
          organizacao_militar: 'OM Teste',
        })
        .expect(201);

      assert.ok(res.body.data.id);
      assert.equal(res.body.data.username, 'new_register_user');
      assert.equal(res.body.data.nome, 'Novo Usuario Registrado');
      assert.equal(res.body.data.role, 'user');
      // Password should not be returned
      assert.ok(!res.body.data.password);
      assert.ok(!res.body.data.password_hash);

      // Verify user can login
      const loginRes = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: 'new_register_user', password: 'ValidPass@123' })
        .expect(200);

      assert.ok(loginRes.body.data.accessToken);
    });

    it('registers a user with minimal required fields', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'minimal_user',
          password: 'Pass123',
          nome: 'Usuario Minimo',
        })
        .expect(201);

      assert.ok(res.body.data.id);
      assert.equal(res.body.data.username, 'minimal_user');
    });

    it('rejects duplicate username', async () => {
      // First registration
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'duplicate_user',
          password: 'Pass123',
          nome: 'First User',
        })
        .expect(201);

      // Second registration with same username
      const res = await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'duplicate_user',
          password: 'Pass456',
          nome: 'Second User',
        })
        .expect(409);

      assert.ok(res.body.error);
    });

    it('rejects password shorter than 6 characters', async () => {
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'short_pwd_user',
          password: '12345', // Too short
          nome: 'Short Password User',
        })
        .expect(422);
    });

    it('rejects username shorter than 3 characters', async () => {
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'ab', // Too short
          password: 'ValidPass',
          nome: 'Short Username',
        })
        .expect(422);
    });

    it('rejects username with invalid characters', async () => {
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'invalid user!@#', // Invalid chars
          password: 'ValidPass',
          nome: 'Invalid Username',
        })
        .expect(422);
    });

    it('rejects missing required fields', async () => {
      // Missing username
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          password: 'ValidPass',
          nome: 'No Username',
        })
        .expect(422);

      // Missing password
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'no_pwd_user',
          nome: 'No Password',
        })
        .expect(422);

      // Missing nome
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'no_nome_user',
          password: 'ValidPass',
        })
        .expect(422);
    });

    it('always creates user with role "user" regardless of input', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'try_admin_user',
          password: 'ValidPass',
          nome: 'Try Admin',
          role: 'admin', // Should be ignored
        })
        .expect(201);

      assert.equal(res.body.data.role, 'user');
    });
  });
});

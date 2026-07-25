// Path: tests/integration/auth-edge-cases.test.js
// Integration tests for Auth security edge cases:
// - Inactive user login/refresh
// - Password hash not exposed in responses
// - Register with is_active:false ignored
// - Expired access token
// - Revoked refresh token reuse

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

describe('Auth Edge Cases', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Inactive user', () => {
    let inactiveUser;

    before(async () => {
      inactiveUser = await createUser(db, { username: 'inactive_edge_user' });
      // Deactivate the user directly in DB
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [inactiveUser.id]);
    });

    it('login with inactive user returns 401', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: inactiveUser.username, password: inactiveUser.password })
        .expect(401);

      assert.ok(res.body.error);
    });

    it('refresh token from inactive user returns 401', async () => {
      // Create a user, get tokens, then deactivate and try refresh
      const tempUser = await createUser(db, { username: 'deactivate_after_login' });

      const loginRes = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: tempUser.username, password: tempUser.password });

      const refreshToken = loginRes.body.data.refreshToken;

      // Deactivate user after login
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [tempUser.id]);

      // Attempt to refresh — should fail because FIND_USER_BY_ID checks is_active = true
      const res = await supertest(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      assert.ok(res.body.error);
    });
  });

  describe('Password hash not exposed', () => {
    it('login response does not contain password_hash field', async () => {
      const user = await createUser(db, { username: 'no_hash_user' });

      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: user.password })
        .expect(200);

      assert.ok(!res.body.data.user.password_hash, 'password_hash should not be in login response');
      assert.ok(!res.body.data.user.password, 'password should not be in login response');
      assert.ok(!res.body.data.password_hash, 'password_hash should not be at top level');
    });

    it('GET /auth/me does not contain password_hash', async () => {
      const user = await createUser(db, { username: 'no_hash_me_user' });
      const token = await loginUser(app, user.username, user.password);

      const res = await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.ok(!res.body.data.password_hash, 'password_hash should not be in /me response');
      assert.ok(!res.body.data.password, 'password should not be in /me response');
    });
  });

  describe('Register with is_active:false in payload', () => {
    it('user is still created active even if is_active:false is sent', async () => {
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'force_active_user',
          password: 'Test@1234',
          nome: 'Force Active',
          is_active: false, // Should be ignored
        })
        .expect(201);

      // The 201 body carries no account data (anti-enumeration: it is byte-identical
      // whether the account was created or already existed), so the row is the proof.
      const { rows } = await db.query(
        'SELECT id FROM users WHERE username = $1', ['force_active_user']
      );
      assert.ok(rows[0]?.id);

      // Verify user can login (proving is_active is true)
      const loginRes = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: 'force_active_user', password: 'Test@1234' })
        .expect(200);

      assert.ok(loginRes.body.data.accessToken);
    });
  });

  describe('Expired access token', () => {
    it('expired access token returns 401 on protected endpoint', async () => {
      // Sign a token that is already expired (expiresIn: '0s' or negative)
      const expiredToken = jwt.sign(
        {
          sub: '00000000-0000-0000-0000-000000000000',
          username: 'expired_user',
          nome: 'Expired',
          posto: 'Cap',
          role: 'user',
        },
        process.env.JWT_SECRET || 'test-secret-key-for-testing-purposes-only-32chars',
        { expiresIn: '0s' }
      );

      // Small delay to ensure the token is truly expired
      await new Promise(resolve => setTimeout(resolve, 10));

      const res = await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      assert.ok(res.body.error);
    });
  });

  describe('Revoked refresh token reuse', () => {
    it('reusing a revoked refresh token returns 401', async () => {
      const user = await createUser(db, { username: 'revoke_reuse_user' });

      // Login to get tokens
      const loginRes = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: user.password });

      const originalRefreshToken = loginRes.body.data.refreshToken;

      // Use the refresh token once (rotates it, revoking the original)
      const refreshRes = await supertest(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: originalRefreshToken })
        .expect(200);

      assert.ok(refreshRes.body.data.refreshToken);
      assert.notEqual(refreshRes.body.data.refreshToken, originalRefreshToken);

      // Try to reuse the original (now revoked) refresh token
      const res = await supertest(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: originalRefreshToken })
        .expect(401);

      assert.ok(res.body.error);
    });

    it('refresh token revoked via logout cannot be reused', async () => {
      const user = await createUser(db, { username: 'logout_revoke_user' });

      // Login
      const loginRes = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: user.password });

      const accessToken = loginRes.body.data.accessToken;
      const refreshToken = loginRes.body.data.refreshToken;

      // Logout (revokes the refresh token)
      await supertest(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(204);

      // Try to use the revoked refresh token
      const res = await supertest(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      assert.ok(res.body.error);
    });
  });
});

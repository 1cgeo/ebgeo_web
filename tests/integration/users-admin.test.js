// Path: tests/integration/users-admin.test.js
// Integration tests for Admin User Management API

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';

describe('Users Admin API', () => {
  let app, db, admin, regularUser, adminToken, userToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: 'users_admin' });
    regularUser = await createUser(db, { username: 'regular_user' });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, regularUser.username, regularUser.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('GET /users — List Users (Admin)', () => {
    it('admin can list all active users', async () => {
      const res = await supertest(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 2); // At least admin and regularUser
      // Verify users have expected fields
      const userFields = res.body.data[0];
      assert.ok('id' in userFields);
      assert.ok('username' in userFields);
      assert.ok('nome' in userFields);
      assert.ok('role' in userFields);
    });

    it('admin can list all users including inactive', async () => {
      // Create an inactive user
      await db.query(
        `INSERT INTO users (username, password_hash, nome, is_active)
         VALUES ('inactive_user', 'hash', 'Inactive', false)`
      );

      const res = await supertest(app)
        .get('/api/v1/users?includeInactive=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const usernames = res.body.data.map(u => u.username);
      assert.ok(usernames.includes('inactive_user'));
    });

    it('regular user cannot list all users', async () => {
      await supertest(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe('POST /users — Create User (Admin)', () => {
    it('admin can create a new user', async () => {
      const res = await supertest(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'new_user_test',
          password: 'Test@12345',
          nome: 'New User Test',
          posto_graduacao: 'Ten',
          organizacao_militar: 'Test OM',
          role: 'user',
        })
        .expect(201);

      assert.ok(res.body.data.id);
      assert.equal(res.body.data.username, 'new_user_test');
      assert.equal(res.body.data.role, 'user');
      // Password should not be returned
      assert.ok(!res.body.data.password);
      assert.ok(!res.body.data.password_hash);
    });

    it('admin can create another admin', async () => {
      const res = await supertest(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'new_admin_test',
          password: 'Admin@12345',
          nome: 'New Admin',
          role: 'admin',
        })
        .expect(201);

      assert.equal(res.body.data.role, 'admin');
    });

    it('rejects duplicate username', async () => {
      await supertest(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: regularUser.username, // Already exists
          password: 'Test@12345',
          nome: 'Duplicate',
        })
        .expect(409);
    });

    it('validates username format', async () => {
      await supertest(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'ab', // Too short (min 3)
          password: 'Test@12345',
          nome: 'Short Username',
        })
        .expect(422);

      await supertest(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'invalid username!', // Invalid characters
          password: 'Test@12345',
          nome: 'Invalid Username',
        })
        .expect(422);
    });

    it('validates password length', async () => {
      await supertest(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'short_pwd_user',
          password: '12345', // Too short (min 6)
          nome: 'Short Password',
        })
        .expect(422);
    });

    it('regular user cannot create users', async () => {
      await supertest(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          username: 'attempted_create',
          password: 'Test@12345',
          nome: 'Attempted',
        })
        .expect(403);
    });
  });

  describe('GET /users/:userId — Get User (Admin)', () => {
    it('admin can get user details', async () => {
      const res = await supertest(app)
        .get(`/api/v1/users/${regularUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      assert.equal(res.body.data.id, regularUser.id);
      assert.equal(res.body.data.username, regularUser.username);
    });

    it('returns 404 for non-existent user', async () => {
      await supertest(app)
        .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('regular user cannot get other user details', async () => {
      await supertest(app)
        .get(`/api/v1/users/${admin.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe('PUT /users/:userId — Update User (Admin)', () => {
    it('admin can update user nome', async () => {
      const res = await supertest(app)
        .put(`/api/v1/users/${regularUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nome: 'Updated Nome' })
        .expect(200);

      assert.equal(res.body.data.nome, 'Updated Nome');
    });

    it('admin can update user role', async () => {
      const testUser = await createUser(db, { username: 'role_change_test' });

      const res = await supertest(app)
        .put(`/api/v1/users/${testUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' })
        .expect(200);

      assert.equal(res.body.data.role, 'admin');
    });

    it('admin can update posto_graduacao and organizacao_militar', async () => {
      const res = await supertest(app)
        .put(`/api/v1/users/${regularUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          posto_graduacao: 'Maj',
          organizacao_militar: 'New OM',
        })
        .expect(200);

      assert.equal(res.body.data.posto_graduacao, 'Maj');
      assert.equal(res.body.data.organizacao_militar, 'New OM');
    });

    it('regular user cannot update other users', async () => {
      await supertest(app)
        .put(`/api/v1/users/${admin.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ nome: 'Hacked' })
        .expect(403);
    });
  });

  describe('POST /users/:userId/reset-password — Reset Password (Admin)', () => {
    it('admin can reset user password', async () => {
      const testUser = await createUser(db, { username: 'pwd_reset_test' });

      await supertest(app)
        .post(`/api/v1/users/${testUser.id}/reset-password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'NewPassword@123' })
        .expect(200);

      // Verify user can login with new password
      const loginRes = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: testUser.username, password: 'NewPassword@123' })
        .expect(200);

      assert.ok(loginRes.body.data.accessToken);
    });

    it('validates new password length', async () => {
      await supertest(app)
        .post(`/api/v1/users/${regularUser.id}/reset-password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: '123' }) // Too short
        .expect(422);
    });

    it('regular user cannot reset passwords', async () => {
      await supertest(app)
        .post(`/api/v1/users/${admin.id}/reset-password`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ newPassword: 'HackedPassword' })
        .expect(403);
    });

    it('admin reset-password revokes the target user\'s existing sessions', async () => {
      // Security: resetting a (possibly compromised) account must kill its live
      // refresh sessions, not just change the hash. This is a SEPARATE code path
      // from self-service password change and had no revocation assertion.
      const victim = await createUser(db, { username: 'pwd_reset_revoke' });
      const login = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: victim.username, password: victim.password })
        .expect(200);
      const oldRefresh = login.body.data.refreshToken;

      await supertest(app)
        .post(`/api/v1/users/${victim.id}/reset-password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'BrandNew@123' })
        .expect(200);

      // The pre-existing refresh token must no longer be accepted.
      await supertest(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: oldRefresh })
        .expect(401);
    });

    it('reset-password on a non-existent user → 404', async () => {
      await supertest(app)
        .post('/api/v1/users/00000000-0000-0000-0000-000000000000/reset-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newPassword: 'Whatever@123' })
        .expect(404);
    });
  });

  describe('DELETE /users/:userId — Deactivate User (Admin)', () => {
    it('admin can deactivate user without atlas', async () => {
      const noAtlasUser = await createUser(db, { username: 'no_atlas_user' });

      const res = await supertest(app)
        .delete(`/api/v1/users/${noAtlasUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      assert.ok(res.body.data.success || res.body.success);

      // Verify user is inactive
      const { rows } = await db.query('SELECT is_active FROM users WHERE id = $1', [noAtlasUser.id]);
      assert.equal(rows[0].is_active, false);
    });

    it('requires transferTo when user has atlas', async () => {
      const userWithAtlas = await createUser(db, { username: 'user_with_atlas' });
      await createAtlas(db, userWithAtlas.id);

      await supertest(app)
        .delete(`/api/v1/users/${userWithAtlas.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409); // Conflict - must specify transferTo
    });

    it('admin can deactivate user with atlas when transferTo is provided', async () => {
      const userWithAtlas = await createUser(db, { username: 'user_transfer_atlas' });
      const targetUser = await createUser(db, { username: 'transfer_target' });
      const atlas = await createAtlas(db, userWithAtlas.id, { name: 'Atlas to Transfer' });

      await supertest(app)
        .delete(`/api/v1/users/${userWithAtlas.id}?transferTo=${targetUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Verify atlas was transferred
      const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(rows[0].owner_id, targetUser.id);

      // Verify user is inactive
      const userRes = await db.query('SELECT is_active FROM users WHERE id = $1', [userWithAtlas.id]);
      assert.equal(userRes.rows[0].is_active, false);
    });

    it('admin cannot deactivate themselves', async () => {
      await supertest(app)
        .delete(`/api/v1/users/${admin.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403); // Forbidden - cannot self-delete
    });

    it('regular user cannot deactivate users', async () => {
      const testUser = await createUser(db, { username: 'deactivate_test' });

      await supertest(app)
        .delete(`/api/v1/users/${testUser.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe('POST /users/:userId/reactivate — Reactivate User (Admin)', () => {
    it('admin can reactivate inactive user', async () => {
      // Create and deactivate a user
      const inactiveUser = await createUser(db, { username: 'reactivate_test' });
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [inactiveUser.id]);

      const res = await supertest(app)
        .post(`/api/v1/users/${inactiveUser.id}/reactivate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      assert.ok(res.body.data);
      assert.equal(res.body.data.is_active, true);

      // Verify in database
      const { rows } = await db.query('SELECT is_active FROM users WHERE id = $1', [inactiveUser.id]);
      assert.equal(rows[0].is_active, true);
    });

    it('returns 404 for non-existent user', async () => {
      await supertest(app)
        .post('/api/v1/users/00000000-0000-0000-0000-000000000000/reactivate')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('regular user cannot reactivate users', async () => {
      const inactiveUser = await createUser(db, { username: 'reactivate_test2' });
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [inactiveUser.id]);

      await supertest(app)
        .post(`/api/v1/users/${inactiveUser.id}/reactivate`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe('User Profile Endpoints (Self-service)', () => {
    describe('GET /users/me — Get Own Profile', () => {
      it('user can view their own profile', async () => {
        const res = await supertest(app)
          .get('/api/v1/users/me')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(200);

        assert.equal(res.body.data.id, regularUser.id);
        assert.equal(res.body.data.username, regularUser.username);
      });
    });

    describe('PUT /users/me — Update Own Profile', () => {
      it('user can update their own profile', async () => {
        const res = await supertest(app)
          .put('/api/v1/users/me')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            nome: 'Self Updated Name',
            posto_graduacao: 'Cap',
          })
          .expect(200);

        assert.equal(res.body.data.nome, 'Self Updated Name');
      });

      it('user cannot change their own role', async () => {
        await supertest(app)
          .put('/api/v1/users/me')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ role: 'admin' }); // Should be ignored

        // Role should not change
        const userRes = await db.query('SELECT role FROM users WHERE id = $1', [regularUser.id]);
        assert.equal(userRes.rows[0].role, 'user');
      });
    });

    describe('PUT /users/me/password — Change Own Password', () => {
      it('user can change their own password', async () => {
        const testUser = await createUser(db, { username: 'pwd_change_test', password: 'OldPassword@123' });
        const testToken = await loginUser(app, testUser.username, 'OldPassword@123');

        await supertest(app)
          .put('/api/v1/users/me/password')
          .set('Authorization', `Bearer ${testToken}`)
          .send({
            currentPassword: 'OldPassword@123',
            newPassword: 'NewPassword@456',
          })
          .expect(200);

        // Verify can login with new password
        await supertest(app)
          .post('/api/v1/auth/login')
          .send({ username: testUser.username, password: 'NewPassword@456' })
          .expect(200);
      });

      it('rejects wrong current password', async () => {
        await supertest(app)
          .put('/api/v1/users/me/password')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            currentPassword: 'WrongPassword',
            newPassword: 'NewPassword@456',
          })
          .expect(401);
      });
    });

    describe('GET /users/search — Search Users', () => {
      before(async () => {
        // Create some users to search
        await createUser(db, { username: 'search_user1', nome: 'John Smith' });
        await createUser(db, { username: 'search_user2', nome: 'Jane Doe' });
        await createUser(db, { username: 'findme_user', nome: 'Find Me' });
      });

      it('user can search for other users by username', async () => {
        const res = await supertest(app)
          .get('/api/v1/users/search?q=search_user')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(200);

        assert.ok(Array.isArray(res.body.data));
        const usernames = res.body.data.map(u => u.username);
        assert.ok(usernames.some(u => u.includes('search_user')));
      });

      it('user can search for other users by nome', async () => {
        const res = await supertest(app)
          .get('/api/v1/users/search?q=John')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(200);

        assert.ok(Array.isArray(res.body.data));
        const names = res.body.data.map(u => u.nome);
        assert.ok(names.some(n => n && n.includes('John')));
      });

      it('validates minimum query length', async () => {
        await supertest(app)
          .get('/api/v1/users/search?q=a') // Too short (min 2)
          .set('Authorization', `Bearer ${userToken}`)
          .expect(422);
      });
    });
  });
});

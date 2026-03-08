// Path: tests/integration/sharing.test.js
// Integration tests for the Sharing API (public links, user shares)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';

describe('Sharing API', () => {
  let app, db, owner, writer, reader, stranger;
  let ownerToken, writerToken, readerToken, strangerToken;
  let atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: 'share_owner' });
    writer = await createUser(db, { username: 'share_writer' });
    reader = await createUser(db, { username: 'share_reader' });
    stranger = await createUser(db, { username: 'share_stranger' });

    ownerToken = await loginUser(app, owner.username, owner.password);
    writerToken = await loginUser(app, writer.username, writer.password);
    readerToken = await loginUser(app, reader.username, reader.password);
    strangerToken = await loginUser(app, stranger.username, stranger.password);

    atlas = await createAtlas(db, owner.id, { name: 'Sharing Test Atlas' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('GET /atlas/:atlasId/sharing — Get Sharing Config', () => {
    it('owner can view sharing config', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.ok('isPublic' in res.body.data || 'is_public' in res.body.data);
      assert.ok(Array.isArray(res.body.data.shares));
    });

    it('non-owner cannot view sharing config', async () => {
      // First share with writer
      await db.query(
        `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'write', $3)
         ON CONFLICT (atlas_id, user_id) DO NOTHING`,
        [atlas.id, writer.id, owner.id]
      );

      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${writerToken}`)
        .expect(403);
    });

    it('stranger cannot view sharing config', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sharing`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });
  });

  describe('POST /atlas/:atlasId/sharing/public — Enable Public Link', () => {
    it('owner can enable public sharing', async () => {
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.ok(res.body.data.publicLink || res.body.data.public_link);

      // Verify in database
      const { rows } = await db.query('SELECT is_public, public_link FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(rows[0].is_public, true);
      assert.ok(rows[0].public_link);
    });

    it('non-owner cannot enable public sharing', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${writerToken}`)
        .expect(403);
    });
  });

  describe('DELETE /atlas/:atlasId/sharing/public — Disable Public Link', () => {
    it('owner can disable public sharing', async () => {
      // First enable public sharing
      await db.query('UPDATE atlas SET is_public = true, public_link = $1 WHERE id = $2', ['test-link', atlas.id]);

      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      // Verify in database
      const { rows } = await db.query('SELECT is_public FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(rows[0].is_public, false);
    });

    it('non-owner cannot disable public sharing', async () => {
      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${writerToken}`)
        .expect(403);
    });
  });

  describe('POST /atlas/:atlasId/sharing/users — Add User Share', () => {
    it('owner can share with another user as reader', async () => {
      // Clean up any existing share
      await db.query('DELETE FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2', [atlas.id, reader.id]);

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: reader.id, permission: 'read' })
        .expect(201);

      assert.ok(res.body.data);

      // Verify share was created
      const { rows } = await db.query(
        'SELECT * FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, reader.id]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].permission, 'read');
    });

    it('owner can share with another user as writer', async () => {
      // Clean up existing share
      await db.query('DELETE FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2', [atlas.id, stranger.id]);

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: stranger.id, permission: 'write' })
        .expect(201);

      assert.ok(res.body.data);

      // Verify share was created
      const { rows } = await db.query(
        'SELECT * FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, stranger.id]
      );
      assert.equal(rows[0].permission, 'write');
    });

    it('non-owner cannot add user share', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${writerToken}`)
        .send({ userId: stranger.id, permission: 'read' })
        .expect(403);
    });

    it('rejects invalid permission value', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: stranger.id, permission: 'owner' })
        .expect(422);
    });

    it('rejects missing userId', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ permission: 'read' })
        .expect(422);
    });
  });

  describe('PUT /atlas/:atlasId/sharing/users/:userId — Update User Share', () => {
    it('owner can update share permission from read to write', async () => {
      // Ensure reader has read permission
      await db.query('DELETE FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2', [atlas.id, reader.id]);
      await db.query(
        'INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, $3, $4)',
        [atlas.id, reader.id, 'read', owner.id]
      );

      const res = await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}/sharing/users/${reader.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ permission: 'write' })
        .expect(200);

      assert.ok(res.body.data);

      // Verify permission was updated
      const { rows } = await db.query(
        'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, reader.id]
      );
      assert.equal(rows[0].permission, 'write');
    });

    it('owner can update share permission from write to read', async () => {
      const res = await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}/sharing/users/${reader.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ permission: 'read' })
        .expect(200);

      const { rows } = await db.query(
        'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, reader.id]
      );
      assert.equal(rows[0].permission, 'read');
    });

    it('non-owner cannot update share permission', async () => {
      await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}/sharing/users/${reader.id}`)
        .set('Authorization', `Bearer ${writerToken}`)
        .send({ permission: 'write' })
        .expect(403);
    });

    it('returns 404 for non-existent share', async () => {
      const nonSharedUser = await createUser(db, { username: 'not_shared_user' });

      await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}/sharing/users/${nonSharedUser.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ permission: 'write' })
        .expect(404);
    });
  });

  describe('DELETE /atlas/:atlasId/sharing/users/:userId — Remove User Share', () => {
    it('owner can remove user share', async () => {
      // Create a share to remove
      const tempUser = await createUser(db, { username: 'temp_share_user' });
      await db.query(
        'INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, $3, $4)',
        [atlas.id, tempUser.id, 'read', owner.id]
      );

      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/sharing/users/${tempUser.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      // Verify share was removed
      const { rows } = await db.query(
        'SELECT * FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, tempUser.id]
      );
      assert.equal(rows.length, 0);
    });

    it('non-owner cannot remove share', async () => {
      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/sharing/users/${reader.id}`)
        .set('Authorization', `Bearer ${writerToken}`)
        .expect(403);
    });
  });

  describe('Public Atlas Access', () => {
    let publicAtlas, publicLink;

    before(async () => {
      publicAtlas = await createAtlas(db, owner.id, { name: 'Public Atlas Test' });
      // Enable public sharing
      const res = await supertest(app)
        .post(`/api/v1/atlas/${publicAtlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerToken}`);
      publicLink = res.body.data.publicLink || res.body.data.public_link;
    });

    it('GET /atlas/public/:link — returns atlas data and public token', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/public/${publicLink}`)
        .expect(200);

      assert.ok(res.body.data);
      assert.equal(res.body.data.id, publicAtlas.id);
      assert.ok(res.body.data.publicToken); // JWT token for WebSocket
    });

    it('GET /atlas/public/:link — returns 404 for invalid link', async () => {
      await supertest(app)
        .get('/api/v1/atlas/public/invalid-link-12345')
        .expect(404);
    });

    it('stranger can read public atlas', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${publicAtlas.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(200);
    });

    it('stranger cannot edit public atlas', async () => {
      await supertest(app)
        .put(`/api/v1/atlas/${publicAtlas.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ name: 'Hacked Name' })
        .expect(403);
    });
  });

  describe('Permission Hierarchy', () => {
    let testAtlas;

    before(async () => {
      testAtlas = await createAtlas(db, owner.id, { name: 'Permission Test Atlas' });
      // Set up shares
      await db.query(
        'INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, $3, $4)',
        [testAtlas.id, writer.id, 'write', owner.id]
      );
      await db.query(
        'INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, $3, $4)',
        [testAtlas.id, reader.id, 'read', owner.id]
      );
    });

    it('owner has full access', async () => {
      // Can read
      await supertest(app)
        .get(`/api/v1/atlas/${testAtlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // Can update
      await supertest(app)
        .put(`/api/v1/atlas/${testAtlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Updated by Owner' })
        .expect(200);

      // Can manage sharing
      await supertest(app)
        .get(`/api/v1/atlas/${testAtlas.id}/sharing`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });

    it('writer can read and edit but not manage sharing', async () => {
      // Can read
      await supertest(app)
        .get(`/api/v1/atlas/${testAtlas.id}`)
        .set('Authorization', `Bearer ${writerToken}`)
        .expect(200);

      // Can update
      await supertest(app)
        .put(`/api/v1/atlas/${testAtlas.id}`)
        .set('Authorization', `Bearer ${writerToken}`)
        .send({ name: 'Updated by Writer' })
        .expect(200);

      // Cannot manage sharing
      await supertest(app)
        .get(`/api/v1/atlas/${testAtlas.id}/sharing`)
        .set('Authorization', `Bearer ${writerToken}`)
        .expect(403);
    });

    it('reader can only read', async () => {
      // Can read
      await supertest(app)
        .get(`/api/v1/atlas/${testAtlas.id}`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(200);

      // Cannot update
      await supertest(app)
        .put(`/api/v1/atlas/${testAtlas.id}`)
        .set('Authorization', `Bearer ${readerToken}`)
        .send({ name: 'Attempted Update' })
        .expect(403);

      // Cannot manage sharing
      await supertest(app)
        .get(`/api/v1/atlas/${testAtlas.id}/sharing`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(403);
    });
  });
});

// Path: tests/integration/permissions.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Permission Matrix', () => {
  let app, db;
  let owner, writer, sharedReader, stranger;
  let ownerToken, writerToken, readerToken, strangerToken;
  let privateAtlas, publicAtlas, privateMap;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: 'perm_owner' });
    writer = await createUser(db, { username: 'perm_writer' });
    sharedReader = await createUser(db, { username: 'perm_reader' });
    stranger = await createUser(db, { username: 'perm_stranger' });

    ownerToken = await loginUser(app, owner.username, owner.password);
    writerToken = await loginUser(app, writer.username, writer.password);
    readerToken = await loginUser(app, sharedReader.username, sharedReader.password);
    strangerToken = await loginUser(app, stranger.username, stranger.password);

    // Create private atlas with shares
    privateAtlas = await createAtlas(db, owner.id);
    privateMap = await createMap(db, privateAtlas.id);

    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'write', $3)`,
      [privateAtlas.id, writer.id, owner.id]
    );
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'read', $3)`,
      [privateAtlas.id, sharedReader.id, owner.id]
    );

    // Create public atlas
    publicAtlas = await createAtlas(db, owner.id, { name: 'Public Atlas' });
    await db.query(`UPDATE atlas SET is_public = true WHERE id = $1`, [publicAtlas.id]);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // --- Owner can do everything ---
  it('owner can read atlas', async () => {
    await supertest(app)
      .get(`/api/v1/atlas/${privateAtlas.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('owner can update atlas', async () => {
    await supertest(app)
      .put(`/api/v1/atlas/${privateAtlas.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Renamed by Owner' })
      .expect(200);
  });

  it('owner can create features via sync', async () => {
    const { randomUUID } = await import('crypto');
    await supertest(app)
      .post(`/api/v1/atlas/${privateAtlas.id}/sync`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        operations: [{
          id: randomUUID(),
          entityType: 'feature',
          operationType: 'create',
          entityId: randomUUID(),
          mapId: privateMap.id,
          data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: {} },
          timestamp: Date.now(),
          clientId: 'perm-test-owner',
        }],
      })
      .expect(200);
  });

  it('owner can manage settings', async () => {
    await supertest(app)
      .patch(`/api/v1/atlas/${privateAtlas.id}/settings`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ features: { map_3d: true } })
      .expect(200);
  });

  // --- Writer can edit but not delete atlas ---
  it('writer can read atlas', async () => {
    await supertest(app)
      .get(`/api/v1/atlas/${privateAtlas.id}`)
      .set('Authorization', `Bearer ${writerToken}`)
      .expect(200);
  });

  it('writer can create features via sync', async () => {
    const { randomUUID } = await import('crypto');
    await supertest(app)
      .post(`/api/v1/atlas/${privateAtlas.id}/sync`)
      .set('Authorization', `Bearer ${writerToken}`)
      .send({
        operations: [{
          id: randomUUID(),
          entityType: 'feature',
          operationType: 'create',
          entityId: randomUUID(),
          mapId: privateMap.id,
          data: { feature_type: 'point', geometry: { coordinates: [1, 1] }, properties: {} },
          timestamp: Date.now(),
          clientId: 'perm-test-writer',
        }],
      })
      .expect(200);
  });

  it('writer can update atlas name', async () => {
    await supertest(app)
      .put(`/api/v1/atlas/${privateAtlas.id}`)
      .set('Authorization', `Bearer ${writerToken}`)
      .send({ name: 'Renamed by Writer' })
      .expect(200);
  });

  it('writer cannot delete atlas', async () => {
    await supertest(app)
      .delete(`/api/v1/atlas/${privateAtlas.id}`)
      .set('Authorization', `Bearer ${writerToken}`)
      .expect(403);
  });

  it('writer cannot change settings', async () => {
    await supertest(app)
      .patch(`/api/v1/atlas/${privateAtlas.id}/settings`)
      .set('Authorization', `Bearer ${writerToken}`)
      .send({ features: { map_3d: false } })
      .expect(403);
  });

  // --- Reader can view but not edit ---
  it('reader can read atlas', async () => {
    await supertest(app)
      .get(`/api/v1/atlas/${privateAtlas.id}`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(200);
  });

  it('reader can pull sync (read features)', async () => {
    await supertest(app)
      .get(`/api/v1/atlas/${privateAtlas.id}/sync/0`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(200);
  });

  it('reader cannot push sync (create features)', async () => {
    const { randomUUID } = await import('crypto');
    await supertest(app)
      .post(`/api/v1/atlas/${privateAtlas.id}/sync`)
      .set('Authorization', `Bearer ${readerToken}`)
      .send({
        operations: [{
          id: randomUUID(),
          entityType: 'feature',
          operationType: 'create',
          entityId: randomUUID(),
          mapId: privateMap.id,
          data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: {} },
          timestamp: Date.now(),
          clientId: 'perm-test-reader',
        }],
      })
      .expect(403);
  });

  it('reader cannot update atlas', async () => {
    await supertest(app)
      .put(`/api/v1/atlas/${privateAtlas.id}`)
      .set('Authorization', `Bearer ${readerToken}`)
      .send({ name: 'Hacked' })
      .expect(403);
  });

  // --- Stranger has no access to private atlas ---
  it('stranger cannot access private atlas', async () => {
    await supertest(app)
      .get(`/api/v1/atlas/${privateAtlas.id}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });

  // --- Public atlas: stranger gets read access ---
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
      .send({ name: 'Hacked' })
      .expect(403);
  });

  // --- Clone requires read access but auth ---
  it('reader can clone atlas', async () => {
    await supertest(app)
      .post(`/api/v1/atlas/${privateAtlas.id}/clone`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(201);
  });

  it('stranger cannot clone private atlas', async () => {
    await supertest(app)
      .post(`/api/v1/atlas/${privateAtlas.id}/clone`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });
});

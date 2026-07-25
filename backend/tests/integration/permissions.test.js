// Path: tests/integration/permissions.test.js
// Path note: this file is THE permission matrix, and for a long time it
// enumerated three tiers out of five — owner, write, read — plus a stranger.
// `manage` and `comment` never appeared, so the two levels the constitution
// warns about (the co-Gestor silently excluded by a closed list; the
// Comentarista allowed to write) had no row here at all. They do now, and their
// rows assert against POSTGRES rather than against the HTTP status: "the server
// answered 200" and "the feature exists" are different claims, and only the
// second one is the permission actually working.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Permission Matrix', () => {
  let app, db;
  let owner, writer, sharedReader, stranger, manager, commenter;
  let ownerToken, writerToken, readerToken, strangerToken, managerToken, commenterToken;
  let privateAtlas, publicAtlas, privateMap;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: 'perm_owner' });
    writer = await createUser(db, { username: 'perm_writer' });
    sharedReader = await createUser(db, { username: 'perm_reader' });
    stranger = await createUser(db, { username: 'perm_stranger' });
    manager = await createUser(db, { username: 'perm_manager' });
    commenter = await createUser(db, { username: 'perm_commenter' });

    ownerToken = await loginUser(app, owner.username, owner.password);
    writerToken = await loginUser(app, writer.username, writer.password);
    readerToken = await loginUser(app, sharedReader.username, sharedReader.password);
    strangerToken = await loginUser(app, stranger.username, stranger.password);
    managerToken = await loginUser(app, manager.username, manager.password);
    commenterToken = await loginUser(app, commenter.username, commenter.password);

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
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'manage', $3)`,
      [privateAtlas.id, manager.id, owner.id]
    );
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'comment', $3)`,
      [privateAtlas.id, commenter.id, owner.id]
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

  // --- manage (co-Gestor): writes entities, stops below owner ---
  //
  // The tier this project has silently dropped twice. The route itself is gated
  // at `comment` (sync.routes.js), so the real decision by level happens inside
  // the service — which is why the assertion below is a SELECT, not a status.
  const featureOp = (entityId, clientId, coords) => ({
    id: randomUUID(),
    entityType: 'feature',
    operationType: 'create',
    entityId,
    mapId: privateMap.id,
    data: { feature_type: 'point', geometry: { coordinates: coords }, properties: {} },
    timestamp: Date.now(),
    clientId,
  });

  it('manage can push a feature via sync AND the row exists in Postgres', async () => {
    const featureId = randomUUID();
    await supertest(app)
      .post(`/api/v1/atlas/${privateAtlas.id}/sync`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ operations: [featureOp(featureId, 'perm-test-manage', [2, 2])] })
      .expect(200);

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [featureId]);
    assert.equal(rows.length, 1, 'a 200 that writes nothing is not write access');
  });

  it('manage cannot delete the atlas (the owner-only ceiling)', async () => {
    await supertest(app)
      .delete(`/api/v1/atlas/${privateAtlas.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(403);

    const { rows } = await db.query('SELECT deleted_at FROM atlas WHERE id = $1', [privateAtlas.id]);
    assert.equal(rows[0].deleted_at, null, 'the atlas survives');
  });

  // --- comment (Comentarista): comments yes, features no ---
  it('comment tier is REFUSED a feature push, and nothing persists', async () => {
    const featureId = randomUUID();
    await supertest(app)
      .post(`/api/v1/atlas/${privateAtlas.id}/sync`)
      .set('Authorization', `Bearer ${commenterToken}`)
      .send({ operations: [featureOp(featureId, 'perm-test-commenter', [3, 3])] })
      .expect(403);

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [featureId]);
    assert.equal(rows.length, 0, 'a refused push must leave no trace');
  });

  it('comment tier CAN push a spatial comment, and it persists', async () => {
    // The positive half. Without it, a gate that refused the comment tier
    // everything would satisfy the negative case above and look correct.
    const commentId = randomUUID();
    await supertest(app)
      .post(`/api/v1/atlas/${privateAtlas.id}/sync`)
      .set('Authorization', `Bearer ${commenterToken}`)
      .send({
        operations: [{
          id: randomUUID(),
          entityType: 'comment',
          operationType: 'create',
          entityId: commentId,
          mapId: privateMap.id,
          data: {
            id: commentId,
            mapId: privateMap.id,
            lng: -43.2,
            lat: -22.9,
            text: 'comentário do Comentarista',
            status: 'open',
            authorId: commenter.id,
          },
          timestamp: Date.now(),
          clientId: 'perm-test-commenter',
        }],
      })
      .expect(200);

    const { rows } = await db.query('SELECT id, status FROM comments WHERE id = $1', [commentId]);
    assert.equal(rows.length, 1, 'the comment tier must be able to comment');
    assert.equal(rows[0].status, 'open');
  });

  // --- Stranger has no access to private atlas ---
  it('stranger cannot access private atlas, nor tell it apart from one that does not exist', async () => {
    // The stranger is the only actor in this file with no row in atlas_shares, which is
    // what puts it on the 404 rung of the escada. Every other denial in this matrix
    // (reader writing, commenter pushing a feature) is 403, because those actors DO hold
    // a share: the two statuses are the matrix's way of saying "ask for the link" versus
    // "ask for a higher level".
    const negado = await supertest(app)
      .get(`/api/v1/atlas/${privateAtlas.id}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(404);

    const inexistente = await supertest(app)
      .get(`/api/v1/atlas/${randomUUID()}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(404);

    // Anti-vacuity anchor: two bodies with no `error` field would compare equal.
    assert.equal(negado.body.error.code, 'NOT_FOUND');
    assert.equal(negado.body.error.code, inexistente.body.error.code);
    assert.equal(negado.body.error.message, inexistente.body.error.message);
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
    // Same rung as the read above: no share, not the owner, atlas not public → 404.
    // Note the contrast with `stranger cannot edit public atlas`, two cases up, which
    // stays 403 — there the atlas IS public, so the stranger resolves `read` and the
    // refusal is about the tier.
    await supertest(app)
      .post(`/api/v1/atlas/${privateAtlas.id}/clone`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(404);
  });
});

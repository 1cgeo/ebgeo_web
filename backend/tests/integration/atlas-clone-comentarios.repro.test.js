// Path: tests/integration/atlas-clone-comentarios.repro.test.js
// Preserve visible discussion threads without letting a read-only clone reveal hidden comments.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

describe('copy preserves only comments the requester can already see', () => {
  let app, db, owner, atlas, map, root, reply, ownerToken;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    owner = await createUser(db);
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id);
    map = await createMap(db, atlas.id);
    root = randomUUID(); reply = randomUUID();
    for (const [id, parentId, text] of [[root, null, 'Preservar a análise'], [reply, root, 'Preservar a resposta']]) {
      await db.query(`INSERT INTO comments (id, atlas_id, map_id, parent_id, author_id, lng, lat, status, data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'resolved',$8::jsonb)`, [id, atlas.id, map.id, parentId, owner.id,
        parentId ? null : -43, parentId ? null : -22,
        JSON.stringify({ id, parentId, mapId: map.id, authorId: owner.id, text, status: 'resolved' })]);
    }
    await db.query(`INSERT INTO comments (atlas_id, map_id, author_id, data, deleted_at)
      VALUES ($1,$2,$3,'{"text":"Already deleted"}',now())`, [atlas.id, map.id, owner.id]);
  });
  after(async () => { await teardownTestEnv(db); });

  async function verifyCopies(atlasId, mapId) {
    const { rows } = await db.query('SELECT * FROM comments WHERE atlas_id=$1 AND map_id=$2', [atlasId, mapId]);
    assert.equal(rows.length, 2);
    const copiedRoot = rows.find(row => row.parent_id === null);
    const copiedReply = rows.find(row => row.parent_id !== null);
    assert.ok(copiedRoot && copiedReply);
    assert.notEqual(copiedRoot.id, root);
    assert.notEqual(copiedReply.id, reply);
    assert.equal(copiedReply.parent_id, copiedRoot.id);
    assert.equal(copiedRoot.data.text, 'Preservar a análise');
    assert.equal(copiedReply.data.text, 'Preservar a resposta');
    for (const row of rows) {
      assert.equal(row.author_id, owner.id);
      assert.equal(row.data.authorId, owner.id);
      assert.equal(row.data.id, row.id);
      assert.equal(row.data.mapId, mapId);
      assert.equal(row.data.parentId, row.parent_id);
      assert.equal(row.status, 'resolved');
      assert.equal(row.version, 1);
    }
  }

  for (const permission of ['read', 'comment', 'write', 'manage', 'owner', 'admin']) {
    it(`clone by ${permission} preserves the same comment visibility as its source`, async () => {
      const user = permission === 'owner' ? owner : await createUser(db, permission === 'admin' ? { role: 'admin' } : {});
      if (!['owner', 'admin'].includes(permission)) await createShare(db, atlas.id, user.id, permission, owner.id);
      const token = await loginUser(app, user.username, user.password);
      const sourceSnapshot = await supertest(app).get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`).expect(200);
      const sourceComments = sourceSnapshot.body.data.snapshot.maps.find(value => value.id === map.id).comments;
      assert.equal(sourceComments.length, permission === 'read' ? 0 : 2);
      const response = await supertest(app).post(`/api/v1/atlas/${atlas.id}/clone`)
        .set('Authorization', `Bearer ${token}`).send({}).expect(201);
      const clonedId = response.body.data.id;
      const { rows } = await db.query('SELECT id FROM maps WHERE atlas_id=$1', [clonedId]);
      assert.equal(rows.length, 1);
      if (permission === 'read') {
        assert.equal((await db.query('SELECT id FROM comments WHERE atlas_id=$1', [clonedId])).rows.length, 0);
      } else await verifyCopies(clonedId, rows[0].id);
    });
  }

  it('duplicating a map preserves its thread and leaves the original ids untouched', async () => {
    const response = await supertest(app).post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/duplicate`)
      .set('Authorization', `Bearer ${ownerToken}`).send({}).expect(201);
    await verifyCopies(atlas.id, response.body.data.id);
    const original = (await db.query('SELECT id FROM comments WHERE map_id=$1 AND deleted_at IS NULL', [map.id])).rows;
    assert.deepEqual(original.map(row => row.id).sort(), [root, reply].sort());
  });
});

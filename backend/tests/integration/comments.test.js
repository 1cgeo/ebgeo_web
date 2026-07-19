// Path: tests/integration/comments.test.js
// Spatial comments (docs/visao-e-principios.md §11 in the frontend): a Comentarista may ONLY write comment
// ops; a reader cannot write comments at all; and comments are hidden from read-only viewers in
// the snapshot (the visibility rule). Every access filter gets a NEGATIVE test per CLAUDE.md.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

describe('Spatial comments — sync + visibility', () => {
  let app, db, owner, commenter, reader, writer;
  let commenterTok, readerTok, writerTok, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'cmt_owner' });
    commenter = await createUser(db, { username: 'cmt_commenter' });
    reader = await createUser(db, { username: 'cmt_reader' });
    writer = await createUser(db, { username: 'cmt_writer' });
    commenterTok = await loginUser(app, commenter.username, commenter.password);
    readerTok = await loginUser(app, reader.username, reader.password);
    writerTok = await loginUser(app, writer.username, writer.password);
    atlas = await createAtlas(db, owner.id);
    await createShare(db, atlas.id, commenter.id, 'comment', owner.id);
    await createShare(db, atlas.id, reader.id, 'read', owner.id);
    await createShare(db, atlas.id, writer.id, 'write', owner.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (token, op, expectStatus) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [op] })
      .expect(expectStatus);

  const pull = (token) =>
    supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

  const commentOp = (id, authorId, extra = {}) => ({
    id: randomUUID(),
    entityType: 'comment',
    operationType: 'create',
    entityId: id,
    mapId: map.id,
    timestamp: Date.now(),
    clientId: 'cmt-client',
    data: { id, mapId: map.id, lng: -43.2, lat: -22.9, text: 'Olá', status: 'open', authorId, ...extra },
  });

  const featureOp = (id) => ({
    id: randomUUID(),
    entityType: 'feature',
    operationType: 'create',
    entityId: id,
    mapId: map.id,
    timestamp: Date.now(),
    clientId: 'cmt-client',
    data: { type: 'Feature', geometry: { type: 'Point', coordinates: [-43, -22] }, properties: { id, source: 'point' } },
  });

  it('a Comentarista CAN create a spatial comment', async () => {
    const id = randomUUID();
    await push(commenterTok, commentOp(id, commenter.id), 200);
    const { rows } = await db.query('SELECT id, status FROM comments WHERE id = $1', [id]);
    assert.equal(rows.length, 1, 'comment row created');
    assert.equal(rows[0].status, 'open');
  });

  it('a Comentarista CANNOT create a feature (403; comment-tier writes only comments) — negative', async () => {
    const id = randomUUID();
    await push(commenterTok, featureOp(id), 403);
    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [id]);
    assert.equal(rows.length, 0, 'no feature written by a commenter');
  });

  it('a READER CANNOT create a comment (403; read < comment at the push route) — negative', async () => {
    const id = randomUUID();
    await push(readerTok, commentOp(id, reader.id), 403);
    const { rows } = await db.query('SELECT id FROM comments WHERE id = $1', [id]);
    assert.equal(rows.length, 0, 'no comment written by a reader');
  });

  it('the snapshot INCLUDES comments for an editor but EXCLUDES them for a reader (visibility rule)', async () => {
    const id = randomUUID();
    await push(commenterTok, commentOp(id, commenter.id), 200);

    const writerSnap = (await pull(writerTok)).body.data;
    const writerComments = (writerSnap.snapshot?.maps || []).flatMap((m) => m.comments || []);
    assert.ok(writerComments.some((c) => c.id === id), 'an editor sees the comment in the snapshot');

    const readerSnap = (await pull(readerTok)).body.data;
    const readerComments = (readerSnap.snapshot?.maps || []).flatMap((m) => m.comments || []);
    assert.equal(readerComments.length, 0, 'a reader must NOT receive any comments');
  });

  // ── Authorship gate + robustness (code-review fixes) ──

  const updateOp = (id, data) => ({
    id: randomUUID(), entityType: 'comment', operationType: 'update', entityId: id, mapId: map.id,
    timestamp: Date.now(), clientId: 'cmt-client', data: { id, mapId: map.id, ...data },
  });
  const deleteOp = (id) => ({
    id: randomUUID(), entityType: 'comment', operationType: 'delete', entityId: id, mapId: map.id,
    timestamp: Date.now(), clientId: 'cmt-client',
  });
  const row = async (id) =>
    (await db.query("SELECT data->>'text' AS text, status, deleted_at, author_id FROM comments WHERE id = $1", [id])).rows[0];

  it('a Comentarista CANNOT edit or delete ANOTHER user\'s comment (author gate) — negative', async () => {
    const theirs = randomUUID();
    await push(writerTok, commentOp(theirs, writer.id, { text: 'orig' }), 200);
    // op is acked, but the UPDATE/DELETE matches zero rows (author mismatch, not editor).
    await push(commenterTok, updateOp(theirs, { text: 'hijack', status: 'open', authorId: writer.id }), 200);
    assert.equal((await row(theirs)).text, 'orig', 'a commenter cannot edit another user\'s comment');
    await push(commenterTok, deleteOp(theirs), 200);
    assert.equal((await row(theirs)).deleted_at, null, 'a commenter cannot delete another user\'s comment');
  });

  it('a Comentarista CAN edit and resolve their OWN comment', async () => {
    const id = randomUUID();
    await push(commenterTok, commentOp(id, commenter.id, { text: 'orig' }), 200);
    await push(commenterTok, updateOp(id, { text: 'edited', status: 'resolved', authorId: commenter.id }), 200);
    const r = await row(id);
    assert.equal(r.text, 'edited');
    assert.equal(r.status, 'resolved');
  });

  it('an Editor CAN edit and delete ANY comment', async () => {
    const id = randomUUID();
    await push(commenterTok, commentOp(id, commenter.id, { text: 'orig' }), 200);
    await push(writerTok, updateOp(id, { text: 'by editor', status: 'open', authorId: commenter.id }), 200);
    assert.equal((await row(id)).text, 'by editor');
    await push(writerTok, deleteOp(id), 200);
    assert.ok((await row(id)).deleted_at, 'an editor can delete any comment');
  });

  it('an update without a valid status keeps the existing status (no silent reopen)', async () => {
    const id = randomUUID();
    await push(commenterTok, commentOp(id, commenter.id), 200);
    await push(commenterTok, updateOp(id, { status: 'resolved', authorId: commenter.id }), 200);
    await push(commenterTok, updateOp(id, { text: 'just a text edit', authorId: commenter.id }), 200);
    assert.equal((await row(id)).status, 'resolved', 'status preserved when the payload omits it');
  });

  // The poison-pill property this test was written for still holds, and is now
  // stronger: since 2026-07-19 `author_id` comes from the AUTHENTICATED principal and
  // the payload's `authorId` is ignored outright, so no value a client can put there
  // — malformed or not — reaches a `::uuid` cast. The old assertion (`author_id` ends
  // null) described the previous mechanism, where the client's field was the source.
  // See comment-authorship.repro.test.js.
  it('a garbage authorId neither poisons the batch nor decides authorship', async () => {
    const id = randomUUID();
    const op = commentOp(id, commenter.id);
    op.data.authorId = 'not-a-uuid';
    await push(commenterTok, op, 200);
    const r = await row(id);
    assert.ok(r, 'comment still created — the batch is not aborted by 22P02');
    assert.equal(r.author_id, commenter.id, 'authorship is the authenticated user, not the payload');
  });

  it('a reply to a non-existent parent soft-fails (no row, no FK poison)', async () => {
    const id = randomUUID();
    await push(commenterTok, commentOp(id, commenter.id, { parentId: randomUUID() }), 200);
    assert.equal(await row(id), undefined, 'reply with a dangling parent is not inserted');
  });

  it('deleting a root cascades the soft-delete to its replies', async () => {
    const root = randomUUID();
    await push(commenterTok, commentOp(root, commenter.id), 200);
    const reply = randomUUID();
    await push(commenterTok, commentOp(reply, commenter.id, { parentId: root, text: 'reply' }), 200);
    await push(commenterTok, deleteOp(root), 200);
    assert.ok((await row(root)).deleted_at, 'root soft-deleted');
    assert.ok((await row(reply)).deleted_at, 'reply cascaded');
  });
});

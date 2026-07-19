// Path: tests/integration/comment-authorship.repro.test.js
// Regression: the author of a spatial comment came from the CLIENT payload.
//
// `applyCommentOp` receives `userId` — the authenticated `req.user.id`, threaded down
// from `pushOperations` — and uses it for the ownership gate on update and delete
// (`author_id = $6`). On INSERT it used `asUuidOrNull(data.authorId)` instead: the
// UUID the client wrote into its own operation. `data` is `op.changes ?? op.data`,
// validated by `Joi.object().unknown(true)`, so nothing checked it. The authenticated
// id sat unused two parameters away.
//
// Two consequences, both real:
//
//  - IMPERSONATION. Anyone who may push can post a comment attributed to someone
//    else. The display identity (authorName / authorInitials / authorColor) lives in
//    the same `data` JSONB and is stored verbatim, so the forgery renders exactly like
//    a genuine comment from that person.
//  - THE OWNERSHIP GATE DISARMS ITSELF. A comment stamped with a foreign id can no
//    longer be edited or deleted by the person who actually wrote it, because those
//    paths compare `author_id` against the authenticated user.
//
// The fix takes `author_id` from the server's own `userId`. The cosmetic fields inside
// `data` stay as sent — the client owns its rendering — but the column every
// authorization check reads is now the server's word.
//
// Negative control: put `asUuidOrNull(data.authorId)` back and the first two tests fail.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser,
} from '../helpers/fixtures.js';

describe('spatial comment authorship is server-assigned (repro)', () => {
  let app, db, owner, impostor, victim, impostorTok, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const rid = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `cmt_own_${rid}` });
    impostor = await createUser(db, { username: `cmt_imp_${rid}` });
    victim = await createUser(db, { username: `cmt_vic_${rid}` });
    impostorTok = await loginUser(app, impostor.username, impostor.password);

    atlas = await createAtlas(db, owner.id, { name: 'Atlas de Comentários' });
    await createShare(db, atlas.id, impostor.id, 'write', owner.id);
    await createShare(db, atlas.id, victim.id, 'write', owner.id);
    map = await createMap(db, atlas.id, { name: 'Mapa' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const pushAs = (token, operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });

  const commentOp = (id, data) => ({
    id: randomUUID(),
    entityType: 'comment',
    operationType: 'create',
    entityId: id,
    mapId: map.id,
    data: { lng: -47.9, lat: -15.8, status: 'open', texto: 'comentário', ...data },
    timestamp: Date.now(),
    clientId: 'cmt-client',
  });

  const authorOf = async (id) =>
    (await db.query('SELECT author_id FROM comments WHERE id = $1', [id])).rows[0]?.author_id;

  it('ignores an authorId forged in the payload', async () => {
    const id = randomUUID();
    await pushAs(impostorTok, [commentOp(id, {
      authorId: victim.id,
      authorName: 'Vítima da Silva',
      authorInitials: 'VS',
    })]).expect(200);

    assert.equal(
      await authorOf(id), impostor.id,
      'the comment belongs to whoever was authenticated, not to whoever the payload named'
    );
  });

  it('stamps the authenticated user when no authorId is sent at all', async () => {
    const id = randomUUID();
    await pushAs(impostorTok, [commentOp(id)]).expect(200);
    assert.equal(await authorOf(id), impostor.id, 'authorship is never left null');
  });

  it('the real author can still edit their own comment', async () => {
    // The ownership gate compares author_id against the authenticated user, so a
    // forged id used to lock the actual writer out of their own comment.
    const id = randomUUID();
    await pushAs(impostorTok, [commentOp(id, { authorId: victim.id })]).expect(200);

    await pushAs(impostorTok, [{
      id: randomUUID(),
      entityType: 'comment',
      operationType: 'update',
      entityId: id,
      mapId: map.id,
      data: { texto: 'editado pelo autor real' },
      timestamp: Date.now(),
      clientId: 'cmt-client',
    }]).expect(200);

    const { rows } = await db.query('SELECT data FROM comments WHERE id = $1', [id]);
    assert.equal(
      rows[0].data.texto, 'editado pelo autor real',
      'the person who wrote it can edit it, which the forged id used to prevent'
    );
  });

  it('the snapshot reports the AUTHORITATIVE author, overriding the JSONB copy', async () => {
    // The client's edit gate reads `comment.authorId` (comment-overlay.js _canModify)
    // while the server checks the `author_id` column. The snapshot spreads `...c.data`,
    // which still carries whatever the client wrote — so without the column winning,
    // a forged id would show an Edit button that then fails silently on push. The two
    // gates have to be looking at the same value.
    const id = randomUUID();
    await pushAs(impostorTok, [commentOp(id, {
      authorId: victim.id, // forged in the JSONB
      authorName: 'Vítima da Silva',
    })]).expect(200);

    const snap = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${impostorTok}`)
      .expect(200);

    const found = (snap.body.data.snapshot.maps ?? [])
      .flatMap((m) => m.comments ?? [])
      .find((c) => c.id === id);

    assert.ok(found, 'the comment is in the snapshot');
    assert.equal(
      found.authorId, impostor.id,
      'the column wins over the client-supplied JSONB copy, so both gates agree'
    );
  });

  it('the impersonated user is not made responsible for a comment they never wrote', async () => {
    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM comments WHERE author_id = $1', [victim.id]
    );
    assert.equal(rows[0].n, 0, 'no comment in this atlas is attributed to the victim');
  });
});

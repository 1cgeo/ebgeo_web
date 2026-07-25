// Path: tests/integration/comments-manage-tier.test.js
// Item 65 (testes-backend.md) — the co-Gestor ('manage') inside applyCommentOp.
//
// `sync.service.js` computes the authorship gate as a LITERAL closed list:
//   const isEditor = permission === 'write' || permission === 'manage' || permission === 'owner';
// which is the exact anti-pattern CLAUDE.md forbids in both packages, correct here
// only by accident of maintenance. comments.test.js exercises 'write' and 'comment'
// and stops there, so deleting `|| permission === 'manage'` turned the co-Gestor into
// a Comentarista on other people's comments with the whole suite still green.
//
// The assertions are TABLED over all five tiers x acting-on-someone-else's-comment, so
// a sixth tier (or a reshuffle of the hierarchy) forces this table to be updated rather
// than silently skipping the new level. Effects are asserted against Postgres, never
// against the 200 — the failure mode here is an ACKED op with NO EFFECT.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

/**
 * The whole hierarchy, each paired with what it may do to a comment it did NOT write.
 * `pushStatus` is what POST /sync answers; `applies` is whether the row actually changes.
 * read is refused at the route (read < comment); comment reaches the service and is
 * silently dropped by the author gate; write/manage/owner are editors.
 */
const TIERS = [
  { tier: 'read', pushStatus: 403, applies: false },
  { tier: 'comment', pushStatus: 200, applies: false },
  { tier: 'write', pushStatus: 200, applies: true },
  { tier: 'manage', pushStatus: 200, applies: true },
  { tier: 'owner', pushStatus: 200, applies: true },
];

describe('spatial comments — the manage tier is an editor on other people\'s comments', () => {
  let app, db, atlas, map, owner, author, authorTok;
  /** @type {Record<string,string>} tier -> access token */
  const tok = {};

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: `cmtmg_owner_${randomUUID().slice(0, 6)}` });
    atlas = await createAtlas(db, owner.id);
    map = await createMap(db, atlas.id);

    // The comment author is a separate writer, so every acting tier below is always
    // touching a comment that is NOT its own.
    author = await createUser(db, { username: `cmtmg_author_${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, author.id, 'write', owner.id);
    authorTok = await loginUser(app, author.username, author.password);

    tok.owner = await loginUser(app, owner.username, owner.password);
    for (const { tier } of TIERS.filter((t) => t.tier !== 'owner')) {
      const u = await createUser(db, { username: `cmtmg_${tier}_${randomUUID().slice(0, 6)}` });
      await createShare(db, atlas.id, u.id, tier, owner.id);
      tok[tier] = await loginUser(app, u.username, u.password);
    }
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

  const op = (operationType, entityId, data = {}) => ({
    id: randomUUID(),
    entityType: 'comment',
    operationType,
    entityId,
    mapId: map.id,
    timestamp: Date.now(),
    clientId: 'cmtmg-client',
    data: { id: entityId, mapId: map.id, lng: -43.2, lat: -22.9, ...data },
  });

  /** Creates a comment owned by `author` (optionally a reply to `parentId`). */
  async function seedComment(parentId = null) {
    const id = randomUUID();
    await push(authorTok, op('create', id, { text: 'original', status: 'open', parentId }), 200);
    const { rows } = await db.query('SELECT id, author_id FROM comments WHERE id = $1', [id]);
    assert.equal(rows.length, 1, 'seed comment must exist');
    assert.equal(rows[0].author_id, author.id, 'seed comment must belong to the author, not the actor');
    return id;
  }

  it('EDITS another user\'s comment exactly for write/manage/owner — tabled over all five tiers', async () => {
    assert.equal(TIERS.length, 5, 'the table must cover the whole hierarchy');
    for (const { tier, pushStatus, applies } of TIERS) {
      const id = await seedComment();
      const marker = `edited-by-${tier}`;
      await push(tok[tier], op('update', id, { text: marker, status: 'open' }), pushStatus);

      const { rows } = await db.query('SELECT data, version FROM comments WHERE id = $1', [id]);
      assert.equal(rows.length, 1, `${tier}: row must still exist`);
      const seen = rows[0].data?.text;
      assert.equal(
        seen === marker,
        applies,
        `${tier}: expected applies=${applies}, comment text is ${JSON.stringify(seen)}`,
      );
      assert.equal(
        rows[0].version === 2,
        applies,
        `${tier}: version must advance only when the edit really applied (got ${rows[0].version})`,
      );
    }
  });

  it('RESOLVES another user\'s comment exactly for write/manage/owner — tabled', async () => {
    assert.equal(TIERS.length, 5);
    for (const { tier, pushStatus, applies } of TIERS) {
      const id = await seedComment();
      await push(tok[tier], op('update', id, { text: 'original', status: 'resolved' }), pushStatus);

      const { rows } = await db.query('SELECT status FROM comments WHERE id = $1', [id]);
      assert.equal(rows.length, 1, `${tier}: row must still exist`);
      assert.equal(
        rows[0].status === 'resolved',
        applies,
        `${tier}: status is ${rows[0].status}`,
      );
    }
  });

  it('DELETES another user\'s comment exactly for write/manage/owner — tabled', async () => {
    assert.equal(TIERS.length, 5);
    for (const { tier, pushStatus, applies } of TIERS) {
      const id = await seedComment();
      await push(tok[tier], op('delete', id), pushStatus);

      const { rows } = await db.query('SELECT deleted_at FROM comments WHERE id = $1', [id]);
      assert.equal(rows.length, 1, `${tier}: soft-delete keeps the row`);
      assert.equal(
        rows[0].deleted_at !== null,
        applies,
        `${tier}: deleted_at is ${rows[0].deleted_at}`,
      );
    }
  });

  it('a manage-tier delete of a root CASCADES to replies written by someone else', async () => {
    const root = await seedComment();
    const replyA = await seedComment(root);
    const replyB = await seedComment(root);

    await push(tok.manage, op('delete', root), 200);

    const { rows } = await db.query(
      'SELECT id, deleted_at FROM comments WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[root, replyA, replyB]],
    );
    assert.equal(rows.length, 3, 'root plus both replies must still exist as rows');
    for (const r of rows) {
      assert.notEqual(r.deleted_at, null, `comment ${r.id} should have been soft-deleted by the cascade`);
    }
  });

  it('manage keeps the powers a Comentarista has over its OWN comment (no regression on the low tier)', async () => {
    // Positive control on the other side of the gate: `comment` is not broken, it is
    // merely author-scoped. If this went red the tabled "applies:false" rows above
    // would be proving a dead route rather than a working gate.
    const id = randomUUID();
    await push(tok.comment, op('create', id, { text: 'meu', status: 'open' }), 200);
    await push(tok.comment, op('update', id, { text: 'meu editado', status: 'resolved' }), 200);

    const { rows } = await db.query('SELECT data, status FROM comments WHERE id = $1', [id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].data.text, 'meu editado');
    assert.equal(rows[0].status, 'resolved');
  });
});

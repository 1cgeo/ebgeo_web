// Path: tests/integration/atlas-transfer-ownership.test.js
// L13 — coverage for POST /atlas/:id/transfer, which had NO tests at all
// (positive or negative) despite being the single most consequential atlas
// mutation: it hands the atlas to another account and demotes the caller.
//
// The route is owner-gated (`requireAtlasPermission('owner')`) and the service
// enforces that the new owner is an ACTIVE MEMBER — handing an atlas to a
// deactivated account would orphan it, since only an owner can delete or
// transfer and a deactivated user can do neither.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

describe('Atlas ownership transfer (L13)', () => {
  let app, db;
  let owner, ownerToken, member, memberToken, stranger, strangerToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: `xf_owner_${randomUUID().slice(0, 6)}` });
    member = await createUser(db, { username: `xf_member_${randomUUID().slice(0, 6)}` });
    stranger = await createUser(db, { username: `xf_stranger_${randomUUID().slice(0, 6)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    memberToken = await loginUser(app, member.username, member.password);
    strangerToken = await loginUser(app, stranger.username, stranger.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** A fresh atlas owned by `owner`, with `member` shared in at `permission`. */
  async function freshAtlas(permission = 'write') {
    const atlas = await createAtlas(db, owner.id, { name: `Transfer ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, member.id, permission, owner.id);
    return atlas;
  }

  const transfer = (atlasId, token, body) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlasId}/transfer`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  // ── happy path ────────────────────────────────────────────────────────────
  it('transfers ownership to a member and demotes the old owner to manage', async () => {
    const atlas = await freshAtlas('write');

    await transfer(atlas.id, ownerToken, { newOwnerId: member.id }).expect(200);

    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].owner_id, member.id, 'owner_id must be the new owner');

    // The new owner's share is removed — ownership comes from owner_id alone, and
    // leaving the row would give them two sources of permission.
    const newOwnerShare = await db.query(
      'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlas.id, member.id]
    );
    assert.equal(newOwnerShare.rows.length, 0, "the new owner's share row is removed");

    // The previous owner keeps full management access, but is no longer owner.
    const oldOwnerShare = await db.query(
      'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlas.id, owner.id]
    );
    assert.equal(oldOwnerShare.rows.length, 1, 'the previous owner keeps a share');
    assert.equal(oldOwnerShare.rows[0].permission, 'manage');
  });

  it('the new owner can immediately act as owner, and the old one cannot', async () => {
    const atlas = await freshAtlas('write');
    await transfer(atlas.id, ownerToken, { newOwnerId: member.id }).expect(200);

    // Transferring again is owner-only: the NEW owner may, the OLD one may not.
    await transfer(atlas.id, ownerToken, { newOwnerId: stranger.id }).expect(403);

    await createShare(db, atlas.id, stranger.id, 'read', member.id);
    await transfer(atlas.id, memberToken, { newOwnerId: stranger.id }).expect(200);

    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].owner_id, stranger.id);
  });

  // ── negative: authorization ───────────────────────────────────────────────
  it('a non-owner member cannot transfer', async () => {
    const atlas = await freshAtlas('manage'); // even a co-Gestor must not
    await transfer(atlas.id, memberToken, { newOwnerId: member.id }).expect(403);

    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].owner_id, owner.id, 'ownership must be unchanged');
  });

  it('a stranger cannot transfer (and cannot learn the atlas exists)', async () => {
    const atlas = await freshAtlas();
    const res = await transfer(atlas.id, strangerToken, { newOwnerId: stranger.id });
    // requireAtlasPermission answers 403 'Access denied' for an EXISTING atlas the
    // caller has no share on (404 is reserved for an atlas that does not exist).
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  it('anonymous cannot transfer', async () => {
    const atlas = await freshAtlas();
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/transfer`)
      .send({ newOwnerId: member.id })
      .expect(401);
  });

  // ── negative: business rules ──────────────────────────────────────────────
  it('rejects transferring to a NON-member', async () => {
    const atlas = await freshAtlas();
    await transfer(atlas.id, ownerToken, { newOwnerId: stranger.id }).expect(400);

    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].owner_id, owner.id, 'a failed transfer must not change ownership');
  });

  it('rejects transferring to a DEACTIVATED member (would orphan the atlas)', async () => {
    // Only an owner can delete or transfer; a deactivated owner can do neither,
    // so the atlas would be stranded with no one able to act on it.
    const atlas = await freshAtlas();
    const ghost = await createUser(db, { username: `xf_ghost_${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, ghost.id, 'write', owner.id);
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [ghost.id]);

    await transfer(atlas.id, ownerToken, { newOwnerId: ghost.id }).expect(400);

    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].owner_id, owner.id);
  });

  it('rejects transferring to the CURRENT owner (no-op guard)', async () => {
    const atlas = await freshAtlas();
    await transfer(atlas.id, ownerToken, { newOwnerId: owner.id }).expect(400);
  });

  it('rejects a malformed newOwnerId with 422, not a 500 from the uuid cast', async () => {
    const atlas = await freshAtlas();
    await transfer(atlas.id, ownerToken, { newOwnerId: 'not-a-uuid' }).expect(422);
    await transfer(atlas.id, ownerToken, {}).expect(422);
  });

  it('a transfer is atomic — a rejected one leaves shares untouched', async () => {
    const atlas = await freshAtlas('write');
    const before = await db.query(
      'SELECT user_id, permission FROM atlas_shares WHERE atlas_id = $1 ORDER BY user_id',
      [atlas.id]
    );

    await transfer(atlas.id, ownerToken, { newOwnerId: stranger.id }).expect(400);

    const after = await db.query(
      'SELECT user_id, permission FROM atlas_shares WHERE atlas_id = $1 ORDER BY user_id',
      [atlas.id]
    );
    assert.deepEqual(after.rows, before.rows, 'no share may be created or altered');
  });
});

// Path: tests/integration/atlas-list-permission-precedence.repro.test.js
// Regression (achado 62): LIST_USER_ATLAS resolved the permission with the precedence
// INVERTED relative to `resolvePermission` (middleware/permissions.js:30-48), which is the
// single source of the hierarchy. The query did
//   COALESCE(s.permission, CASE WHEN a.owner_id = $1 THEN 'owner' END)
// so a share row ROW WON over ownership, and an owner who happened to have a share row
// (nothing forbids one: addUserShare has no guard against atlas.owner_id) was reported as
// 'read' for their OWN atlas. The frontend gates the whole project-picker UI on this field
// (project-picker.modal.js: 'Meus atlas' tab, canWrite, canOwn), so the owner silently lost
// rename/trash/share affordances while keeping the underlying rights.
//
// The projection must agree with the FIVE-level hierarchy read < comment < write < manage <
// owner: `owner` is the TOP level and therefore dominates any share; every other level must be
// surfaced verbatim (never collapsed into a closed 'write'|'owner' list, which is exactly how
// the co-Gestor was silenced before).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

describe('achado-62 · LIST_USER_ATLAS permission precedence', () => {
  let app, db, owner, ownerToken, other;

  const listAs = async (token) => {
    const res = await supertest(app)
      .get('/api/v1/atlas')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data;
  };

  const permissionFor = (rows, atlasId) => rows.find((a) => a.id === atlasId)?.user_permission;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `p62_owner_${randomUUID().slice(0, 8)}` });
    other = await createUser(db, { username: `p62_other_${randomUUID().slice(0, 8)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('the owner stays "owner" even with a share row on their own atlas', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P62 owned ${randomUUID().slice(0, 6)}` });

    // Baseline: no share row → owner.
    assert.equal(permissionFor(await listAs(ownerToken), atlas.id), 'owner');

    // A co-Gestor shares the atlas back to its own owner as a plain reader. Nothing in the
    // API forbids this row, so the projection must survive it.
    await createShare(db, atlas.id, owner.id, 'read', other.id);

    assert.equal(
      permissionFor(await listAs(ownerToken), atlas.id),
      'owner',
      'ownership outranks any share (resolvePermission checks the owner FIRST)'
    );
  });

  it('a self-share at EVERY non-owner level is still outranked by ownership', async () => {
    for (const level of ['read', 'comment', 'write', 'manage']) {
      const atlas = await createAtlas(db, owner.id, { name: `P62 ${level} ${randomUUID().slice(0, 6)}` });
      await createShare(db, atlas.id, owner.id, level, other.id);

      assert.equal(
        permissionFor(await listAs(ownerToken), atlas.id),
        'owner',
        `a '${level}' share must not demote the owner`
      );
    }
  });

  it('a NON-owner sees their share level verbatim, at every level of the hierarchy', async () => {
    // The other half of the contract: fixing the precedence must not flatten the projection
    // into a closed list. `comment` and `manage` are the two levels a closed
    // ('write' | 'owner') list historically dropped.
    const guest = await createUser(db, { username: `p62_guest_${randomUUID().slice(0, 8)}` });
    const guestToken = await loginUser(app, guest.username, guest.password);

    const expected = {};
    for (const level of ['read', 'comment', 'write', 'manage']) {
      const atlas = await createAtlas(db, owner.id, { name: `P62 guest ${level} ${randomUUID().slice(0, 6)}` });
      await createShare(db, atlas.id, guest.id, level, owner.id);
      expected[atlas.id] = level;
    }

    const rows = await listAs(guestToken);
    assert.equal(Object.keys(expected).length, 4, 'one atlas per permission level was seeded');
    for (const [atlasId, level] of Object.entries(expected)) {
      assert.equal(permissionFor(rows, atlasId), level, `shared atlas must report '${level}'`);
    }
  });

  it('the trash projection is the constant "owner" — the bin is owner-only there too', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P62 trash ${randomUUID().slice(0, 6)}` });
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    const res = await supertest(app)
      .get('/api/v1/atlas/trash')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const entry = res.body.data.find((a) => a.id === atlas.id);
    assert.ok(entry, 'the trashed atlas is listed for its owner');
    assert.equal(entry.user_permission, 'owner', 'LIST_DELETED_USER_ATLAS hardcodes it');
  });

  it('after a transfer both sides report the new truth, not the stale share', async () => {
    // The transfer DELETES the new owner's share row and writes a 'manage' one for the
    // ex-owner. Both halves have to show up in this projection, or the project-picker
    // keeps gating on the pre-transfer roles.
    const atlas = await createAtlas(db, owner.id, { name: `P62 xfer ${randomUUID().slice(0, 6)}` });
    const heir = await createUser(db, { username: `p62_heir_${randomUUID().slice(0, 8)}` });
    const heirToken = await loginUser(app, heir.username, heir.password);
    await createShare(db, atlas.id, heir.id, 'read', owner.id);

    assert.equal(permissionFor(await listAs(heirToken), atlas.id), 'read', 'baseline before the transfer');

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/transfer`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ newOwnerId: heir.id })
      .expect(200);

    assert.equal(
      permissionFor(await listAs(heirToken), atlas.id), 'owner',
      'the new owner must not keep reporting the share they used to hold'
    );
    assert.equal(
      permissionFor(await listAs(ownerToken), atlas.id), 'manage',
      'and the ex-owner surfaces as the co-Gestor they became'
    );
  });
});

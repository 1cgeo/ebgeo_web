// Path: tests/integration/atlas-trash-admin-restore.test.js
//
// INVARIANT PINNED HERE (bugs-backend #95, owner's decision): a trashed atlas is always
// reachable by SOMEBODY. A global admin lists and restores every trashed atlas — AND the
// owner scope that gates the route for everyone else is untouched.
//
// The two halves are inseparable and both are asserted here, on purpose. POST
// /atlas/:atlasId/restore is the one route of the module with no `requireAtlasPermission`
// (the middleware only sees live atlases), so `WHERE owner_id = $2` IS the whole access
// control — an anti-IDOR predicate that has already been loosened by accident once. A test
// that only proved "admin can restore" would pass just as green against a query that let
// ANY authenticated user restore ANY atlas by UUID. So every admin case below is paired
// with a non-admin, non-owner case that must still be refused.
//
// The hole this file was written for: the deactivation path (`users.service.deleteUser`) counted
// and transferred atlases with `deleted_at IS NULL`, so an atlas already in the bin was neither
// counted nor handed to the recipient. It stayed owned by an account that `auth` then refuses, it
// appeared in nobody's trash listing (which was owner-scoped), and the owner scope on restore
// meant no one could bring it back.
//
// THAT HALF WAS CLOSED ON 2026-08-24 (owner's decision, finding A5 of the admin UX report): the
// two queries lost the filter, so the bin travels with the rest. The admin branch below is NOT
// obsolete because of it — it is what recovers atlases stranded BEFORE the fix, and what covers
// the account deactivated with no recipient at all. What changed is that it stopped being the
// ONLY way out of a state the product kept producing.
//
// NEGATIVE CONTROL (re-run whenever the restore queries change): copy the files aside,
// point `restoreAtlas`/`listDeletedUserAtlas` back at the owner-scoped queries
// unconditionally, and the four admin cases fail while the three refusal cases stay green;
// then widen RESTORE_ATLAS itself (drop `owner_id = $2`) and the refusal cases fail instead.
// Restore from the copies (never `git checkout` — other agents share this tree).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createMap, createFeature, createShare, loginUser,
} from '../helpers/fixtures.js';

describe('trashed atlas: the admin path back, and the owner scope that stays', () => {
  let app, db;
  let owner, ownerToken, stranger, strangerToken, manager, managerToken, admin, adminToken;

  const restore = (atlasId, token) => supertest(app)
    .post(`/api/v1/atlas/${atlasId}/restore`)
    .set('Authorization', `Bearer ${token}`);

  const trash = (token) => supertest(app)
    .get('/api/v1/atlas/trash')
    .set('Authorization', `Bearer ${token}`);

  const softDelete = (atlasId, token) => supertest(app)
    .delete(`/api/v1/atlas/${atlasId}`)
    .set('Authorization', `Bearer ${token}`);

  const deletedAt = async (atlasId) => {
    const { rows } = await db.query('SELECT deleted_at FROM atlas WHERE id = $1', [atlasId]);
    return rows[0].deleted_at;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const tag = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `p95_owner_${tag}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    stranger = await createUser(db, { username: `p95_stranger_${tag}` });
    strangerToken = await loginUser(app, stranger.username, stranger.password);
    manager = await createUser(db, { username: `p95_manager_${tag}` });
    managerToken = await loginUser(app, manager.username, manager.password);
    admin = await createAdminUser(db, { username: `p95_admin_${tag}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** An atlas of `owner`, with content, already in the bin. */
  const trashedAtlas = async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P95 ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'M' });
    await createFeature(db, map.id);
    await softDelete(atlas.id, ownerToken).expect(204);
    return atlas;
  };

  // ── the admin path ─────────────────────────────────────────────────────────
  it('an admin restores an atlas owned by someone else, content included', async () => {
    const atlas = await trashedAtlas();

    await restore(atlas.id, adminToken).expect(200);

    assert.equal(await deletedAt(atlas.id), null, 'the atlas is live again');

    // The owner — not the admin — gets their project back, whole.
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    assert.equal(res.body.data.snapshot.maps.length, 1, 'the map came back');
  });

  it('an admin sees every trashed atlas in the bin, with the owner named', async () => {
    const atlas = await trashedAtlas();

    const res = await trash(adminToken).expect(200);
    const entry = res.body.data.find((a) => a.id === atlas.id);
    assert.ok(entry, 'another user\'s trashed atlas is listed for the admin');
    assert.equal(entry.owner_username, owner.username, 'and is identifiable by its owner');
    assert.equal(
      entry.user_permission, 'owner',
      'the listing must not claim less access than requireAtlasPermission already grants an admin'
    );
  });

  // ── the scope that must NOT have widened ───────────────────────────────────
  it('a plain user still cannot restore an atlas they do not own (404, unchanged)', async () => {
    const atlas = await trashedAtlas();

    await restore(atlas.id, strangerToken).expect(404);

    assert.notEqual(await deletedAt(atlas.id), null, 'still in the bin');
  });

  it('the highest share below owner (manage) still cannot restore', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P95 mng ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, manager.id, 'manage', owner.id);
    await softDelete(atlas.id, ownerToken).expect(204);

    await restore(atlas.id, managerToken).expect(404);

    assert.notEqual(await deletedAt(atlas.id), null);
  });

  it('a plain user\'s bin still shows only their OWN trashed atlases', async () => {
    const atlas = await trashedAtlas();

    const res = await trash(strangerToken).expect(200);
    assert.ok(
      !res.body.data.some((a) => a.id === atlas.id),
      'the admin branch must be keyed on the role, not applied to everyone'
    );
  });

  it('an admin restoring a LIVE atlas is still a 404 — the deleted_at predicate survives', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P95 live ${randomUUID().slice(0, 6)}` });

    await restore(atlas.id, adminToken).expect(404);

    const { rows } = await db.query('SELECT deleted_at, version FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].deleted_at, null);
    assert.equal(rows[0].version, 1, 'a refused restore bumps nothing');
  });

  // ── the case the whole finding is about ────────────────────────────────────
  // THIS CASE USED TO CHARACTERIZE THE DEFECT, and asserted that the trashed atlas STAYED with
  // the deactivated account ("CHARACTERIZATION: ..."). That is the shape a caracterização takes,
  // and it is also the shape that turns a guard into a defender of the bug: the day someone fixed
  // the filter, this file went red and the fix looked like the regression.
  //
  // Since 2026-08-24 the bin travels with the rest, so the case measures the OPPOSITE: the heir
  // receives the trashed atlas too, and it arrives STILL TRASHED (transferring is not restoring).
  // The admin branch below is exercised right after, because it is still the way back for an
  // atlas stranded before the fix.
  it('an atlas trashed before its owner is deactivated goes to the heir, still trashed', async () => {
    const tag = randomUUID().slice(0, 6);
    const doomed = await createUser(db, { username: `p95_doomed_${tag}` });
    const doomedToken = await loginUser(app, doomed.username, doomed.password);
    const heir = await createUser(db, { username: `p95_heir_${tag}` });
    const heirToken = await loginUser(app, heir.username, heir.password);

    const live = await createAtlas(db, doomed.id, { name: `P95 live ${tag}` });
    const binned = await createAtlas(db, doomed.id, { name: `P95 binned ${tag}` });
    await softDelete(binned.id, doomedToken).expect(204);

    const res = await supertest(app)
      .delete(`/api/v1/users/${doomed.id}?transferTo=${heir.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.equal(res.body.data.atlasTransferred, 2, 'both the live and the trashed atlas travel');
    assert.equal(
      res.body.data.atlasTransferredFromTrash, 1,
      'the parcel is reported apart, so the screen can say what the heir is inheriting'
    );

    const { rows } = await db.query(
      'SELECT id, owner_id FROM atlas WHERE id = ANY($1::uuid[])', [[live.id, binned.id]]
    );
    const ownerById = Object.fromEntries(rows.map((r) => [r.id, r.owner_id]));
    assert.equal(ownerById[live.id], heir.id);
    assert.equal(
      ownerById[binned.id], heir.id,
      'the trashed atlas travels with the rest, instead of being stranded on a dead account'
    );
    assert.notEqual(
      await deletedAt(binned.id), null,
      'and it arrives STILL TRASHED: transferring ownership is not restoring'
    );

    // E O HERDEIRO O VÊ NA LIXEIRA DELE, que é a diferença inteira. Antes estas duas linhas
    // asseriam o contrário (ninguém o via, ninguém o restaurava), e eram verdadeiras: o atlas
    // ficava com uma conta que não autentica mais.
    const heirTrash = await trash(heirToken).expect(200);
    assert.ok(
      heirTrash.body.data.some((a) => a.id === binned.id),
      'the heir sees the inherited atlas in their own bin'
    );
    await restore(binned.id, heirToken).expect(200);
    assert.equal(await deletedAt(binned.id), null, 'and the heir can bring it back without an admin');
    await softDelete(binned.id, heirToken).expect(204);

    // ...except the admin's, which is the whole point of the branch.
    const adminTrash = await trash(adminToken).expect(200);
    assert.ok(
      adminTrash.body.data.some((a) => a.id === binned.id),
      'the admin bin surfaces an atlas whose owner can no longer authenticate'
    );
    await restore(binned.id, adminToken).expect(200);
    assert.equal(await deletedAt(binned.id), null);

    // The tail of this case used to transfer the atlas from the deactivated account to the heir
    // through the admin, because that was the ONLY way it could get a live owner. It now has one
    // from the start, so that hand-over is a 400 (`newOwnerId` is already the owner) and the
    // assertion would be measuring nothing. What it measured moved to the case below, where the
    // stranded state is staged on purpose instead of being produced by the product.
  });

  // ── the admin path back, for what got stranded BEFORE the fix ──────────────
  // The deactivation no longer strands anything, so this state has to be STAGED: the row is
  // pushed back to a deactivated owner with SQL, which is exactly the shape every atlas trashed
  // before 2026-08-24 is in. Staging it is honest here and would not be honest above: above we
  // measure what the product DOES, and here we measure the recovery of what it DID.
  //
  // This is why the admin branch is not obsolete. Without it those rows have no way back at all:
  // the owner cannot authenticate, and the owner-scoped restore refuses everyone else.
  it('an atlas stranded on a deactivated account is recoverable ONLY through the admin', async () => {
    const tag = randomUUID().slice(0, 6);
    const doomed = await createUser(db, { username: `p95_strand_${tag}` });
    const doomedToken = await loginUser(app, doomed.username, doomed.password);
    const heir = await createUser(db, { username: `p95_strandheir_${tag}` });
    const heirToken = await loginUser(app, heir.username, heir.password);

    const stranded = await createAtlas(db, doomed.id, { name: `P95 stranded ${tag}` });
    await softDelete(stranded.id, doomedToken).expect(204);
    await supertest(app)
      .delete(`/api/v1/users/${doomed.id}?transferTo=${heir.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Back to the pre-fix shape: owner is the account that can no longer log in.
    await db.query('UPDATE atlas SET owner_id = $2 WHERE id = $1', [stranded.id, doomed.id]);

    const heirTrash = await trash(heirToken).expect(200);
    assert.ok(
      !heirTrash.body.data.some((a) => a.id === stranded.id),
      'nobody who can log in owns it, so it is in nobody ordinary bin'
    );
    await restore(stranded.id, heirToken).expect(404);

    const adminTrash = await trash(adminToken).expect(200);
    assert.ok(
      adminTrash.body.data.some((a) => a.id === stranded.id),
      'the admin bin surfaces an atlas whose owner can no longer authenticate'
    );
    await restore(stranded.id, adminToken).expect(200);
    assert.equal(await deletedAt(stranded.id), null);

    // And once it is live again the admin can hand it to a real owner, which is what makes this
    // a way OUT of the stuck state and not just a way to look at it.
    await supertest(app)
      .post(`/api/v1/atlas/${stranded.id}/transfer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newOwnerId: heir.id })
      .expect(400); // heir is not a member yet: the transfer contract still applies

    await createShare(db, stranded.id, heir.id, 'write', admin.id);
    await supertest(app)
      .post(`/api/v1/atlas/${stranded.id}/transfer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newOwnerId: heir.id })
      .expect(200);

    const { rows: final } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [stranded.id]);
    assert.equal(final[0].owner_id, heir.id, 'the atlas has a live owner again');
  });
});

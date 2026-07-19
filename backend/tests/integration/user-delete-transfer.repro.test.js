// Path: tests/integration/user-delete-transfer.repro.test.js
// Regression: DELETE /users/:id?transferTo=... could orphan an atlas while
// reporting success, and left the new owner demoted in the atlas listing.
//
// Both defects are in the transfer branch of `deleteUser` (users.service.js), and
// the SIBLING module already handles both correctly — which is what makes them
// oversights rather than open design questions:
//
//   1. SELF-TRANSFER. The guard asks only whether the target is active
//      (`if (!target.is_active) throw`), never whether the target IS the user being
//      deactivated in the same transaction. With `transferTo === userId`, the target
//      still reads `is_active = true` (the soft delete runs later),
//      `TRANSFER_ATLAS_OWNERSHIP` executes `SET owner_id = $2 WHERE owner_id = $1`
//      with $1 === $2 — a no-op — and the service answers
//      `{ success: true, atlasTransferred: N }` for N transfers that never happened.
//      The result is exactly the state the ConflictError above it exists to prevent:
//      a live atlas owned by an inactive account. Since only the owner may transfer
//      or delete an atlas, and an inactive owner is refused at the `auth` middleware
//      with 401, nobody but a global admin can act on it again.
//      Sibling doing it right: atlas.service.js:499 rejects newOwnerId ===
//      currentOwnerId; :511-519 requires an ACTIVE member, "handing ownership to a
//      deactivated account would orphan it".
//
//   2. STALE SHARE. The transfer only swaps `owner_id`. When the recipient was
//      already a collaborator — the NORMAL case, since you transfer to someone who
//      works on it — their `atlas_shares` row survives and outranks the synthesized
//      owner: `LIST_USER_ATLAS` resolves
//      `COALESCE(s.permission, CASE WHEN a.owner_id = $1 THEN 'owner' END)`, so the
//      new owner is reported with the OLD permission on the atlas they now own. The
//      server gate itself stays correct (resolvePermission checks owner first), but
//      the listing lies, and the frontend reads it with a closed equality
//      (`p.user_permission === 'owner'`, project-picker.modal.js:227), so the atlas
//      vanishes from "Meus atlas" and shows up as read-only under "Compartilhados".
//      Sibling doing it right: atlas.service.js:529-532 deletes the new owner's
//      share because "ownership comes from owner_id alone".
//
// Negative controls: remove the self-transfer guard and test 1 returns 200; remove
// the share cleanup and the listing test reports the stale permission.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createShare, loginUser,
} from '../helpers/fixtures.js';

describe('deleting a user transfers atlas ownership properly (repro)', () => {
  let app, db, adminTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db);
    adminTok = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const del = (userId, transferTo) =>
    supertest(app)
      .delete(`/api/v1/users/${userId}${transferTo ? `?transferTo=${transferTo}` : ''}`)
      .set('Authorization', `Bearer ${adminTok}`);

  const rid = () => randomUUID().slice(0, 8);

  it('refuses transferring an atlas to the very user being deactivated', async () => {
    const u = await createUser(db, { username: `self_${rid()}` });
    const atlas = await createAtlas(db, u.id, { name: 'Atlas Órfão' });

    const res = await del(u.id, u.id);
    assert.ok(res.status >= 400, `self-transfer must be refused, got ${res.status}`);

    // The point is not the status code: it is that nothing was half-done.
    const { rows: a } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(a[0].owner_id, u.id, 'ownership unchanged');
    const { rows: usr } = await db.query('SELECT is_active FROM users WHERE id = $1', [u.id]);
    assert.equal(usr[0].is_active, true, 'and the user was NOT deactivated, so no orphan exists');
  });

  it('never reports a transfer that did not happen', async () => {
    // The original failure mode was a 200 asserting `atlasTransferred: 1` while
    // owner_id had not moved. A refusal is fine; a false success is not.
    const u = await createUser(db, { username: `lie_${rid()}` });
    await createAtlas(db, u.id, { name: 'Atlas Mentira' });

    const res = await del(u.id, u.id);
    if (res.status === 200) {
      assert.fail(`reported success for a self-transfer: ${JSON.stringify(res.body)}`);
    }
  });

  it('drops the new owner stale share so the listing reports them as owner', async () => {
    const u = await createUser(db, { username: `from_${rid()}` });
    const heir = await createUser(db, { username: `heir_${rid()}` });
    const heirTok = await loginUser(app, heir.username, heir.password);

    const atlas = await createAtlas(db, u.id, { name: 'Atlas Herdado' });
    // The normal case: the recipient already collaborates on it.
    await createShare(db, atlas.id, heir.id, 'read', u.id);

    await del(u.id, heir.id).expect(200);

    const { rows: a } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(a[0].owner_id, heir.id, 'ownership moved');

    const { rows: shares } = await db.query(
      'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlas.id, heir.id]
    );
    assert.equal(shares.length, 0, 'the stale share is gone — ownership comes from owner_id alone');

    // The observable consequence, which is what the user actually saw.
    const list = await supertest(app)
      .get('/api/v1/atlas')
      .set('Authorization', `Bearer ${heirTok}`)
      .expect(200);
    const entry = (list.body.data.atlas ?? list.body.data).find((x) => x.id === atlas.id);
    assert.ok(entry, 'the atlas is listed for its new owner');
    assert.equal(
      entry.user_permission, 'owner',
      'reported as owner, not with the permission they held before inheriting it'
    );
  });

  it('transfers cleanly when the recipient had no previous share', async () => {
    // Guards the blast radius: the share cleanup must not be required for the
    // transfer to work when there is nothing to clean up.
    const u = await createUser(db, { username: `from2_${rid()}` });
    const heir = await createUser(db, { username: `heir2_${rid()}` });
    const atlas = await createAtlas(db, u.id, { name: 'Atlas Sem Share' });

    await del(u.id, heir.id).expect(200);

    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].owner_id, heir.id);
  });

  it('still refuses transferring to an inactive user', async () => {
    const u = await createUser(db, { username: `from3_${rid()}` });
    const dead = await createUser(db, { username: `dead_${rid()}` });
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [dead.id]);
    const atlas = await createAtlas(db, u.id, { name: 'Atlas p/ Inativo' });

    await del(u.id, dead.id).expect(403);

    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].owner_id, u.id, 'unchanged');
  });

  it('a user with no atlas is deactivated without needing a recipient', async () => {
    const u = await createUser(db, { username: `plain_${rid()}` });
    await del(u.id).expect(200);

    const { rows } = await db.query('SELECT is_active FROM users WHERE id = $1', [u.id]);
    assert.equal(rows[0].is_active, false);
  });
});

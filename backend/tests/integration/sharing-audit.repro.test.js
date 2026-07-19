// Path: tests/integration/sharing-audit.repro.test.js
// Regression: granting and revoking access to an atlas left no audit trail.
//
// `audit_trail.action` has reserved 'SHARING_CHANGE', 'PERMISSION_GRANT' and
// 'PERMISSION_REVOKE' since 001_core.sql:172-177, and `target_type` has allowed
// 'ATLAS'. But no sharing mutation ever emitted any of them: a sweep of `src/` shows
// SHARING_CHANGE was emitted by NOBODY, and PERMISSION_GRANT/REVOKE only by zones
// (zones.service.js:86). None of the five mutations in the sharing module imported
// `createAudit` at all — unlike users, organizations and zones, which audit.
//
// So the most sensitive operation in the access system — promoting someone to
// 'manage', or exposing the whole atlas through a public link — left no record of
// who did it, to whom, or when. And an admin filtering
// `GET /api/v1/audit?action=SHARING_CHANGE` got zero rows every time: a filter that
// by construction could never return anything, which reads as "nothing to see"
// rather than "not implemented".
//
// The schema declaring the actions is the tell. The intent was recorded years ago
// and the wiring was simply never done, so nothing ever failed to point it out.
//
// Negative control: remove the createAudit calls from sharing.service.js and every
// test below fails.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createShare, loginUser,
} from '../helpers/fixtures.js';

describe('atlas sharing changes are audited (repro)', () => {
  let app, db, owner, ownerTok, target, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const rid = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `shaud_own_${rid}` });
    target = await createUser(db, { username: `shaud_tgt_${rid}` });
    ownerTok = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Atlas Auditado' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const base = () => `/api/v1/atlas/${atlas.id}`;
  const as = (m, p) => supertest(app)[m](p).set('Authorization', `Bearer ${ownerTok}`);

  /** Audit rows for this atlas, newest first. */
  const auditRows = async (action) => {
    const { rows } = await db.query(
      `SELECT action, actor_id, target_type, target_id, details FROM audit_trail
       WHERE target_id = $1 ${action ? 'AND action = $2' : ''}
       ORDER BY created_at DESC`,
      action ? [atlas.id, action] : [atlas.id]
    );
    return rows;
  };

  it('granting access records PERMISSION_GRANT with who, to whom and at what level', async () => {
    await as('post', `${base()}/sharing/users`)
      .send({ userId: target.id, permission: 'write' })
      .expect(201);

    const rows = await auditRows('PERMISSION_GRANT');
    assert.equal(rows.length, 1, 'the grant is recorded');
    assert.equal(rows[0].actor_id, owner.id, 'attributed to the actor who granted it');
    assert.equal(rows[0].target_type, 'ATLAS');
    assert.equal(rows[0].details.userId, target.id, 'names the beneficiary');
    assert.equal(rows[0].details.permission, 'write', 'and the level granted');
  });

  it('changing a permission records SHARING_CHANGE with the before and after', async () => {
    await as('put', `${base()}/sharing/users/${target.id}`)
      .send({ permission: 'manage' })
      .expect(200);

    const rows = await auditRows('SHARING_CHANGE');
    const promo = rows.find((r) => r.details?.permission === 'manage');
    assert.ok(promo, 'the promotion to co-Gestor is recorded');
    assert.equal(promo.details.userId, target.id);
    assert.equal(
      promo.details.previousPermission, 'write',
      'the previous level is recorded too — a change is only auditable if you can see what it was'
    );
  });

  it('revoking access records PERMISSION_REVOKE', async () => {
    await as('delete', `${base()}/sharing/users/${target.id}`).expect(204);

    const rows = await auditRows('PERMISSION_REVOKE');
    assert.equal(rows.length, 1, 'the revocation is recorded');
    assert.equal(rows[0].details.userId, target.id);
  });

  it('publishing the atlas records SHARING_CHANGE', async () => {
    await as('post', `${base()}/sharing/public`).expect(200);

    const rows = await auditRows('SHARING_CHANGE');
    assert.ok(
      rows.some((r) => r.details?.isPublic === true),
      'exposing the whole atlas publicly leaves a record'
    );
  });

  it('unpublishing records SHARING_CHANGE too', async () => {
    await as('delete', `${base()}/sharing/public`).expect(204);

    const rows = await auditRows('SHARING_CHANGE');
    assert.ok(rows.some((r) => r.details?.isPublic === false), 'and so does withdrawing it');
  });

  it('the SHARING_CHANGE audit filter stops being a filter that can never match', async () => {
    // The concrete symptom for an admin: this query returned zero rows for every
    // atlas, forever, which looks like "nothing happened" rather than "never wired".
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM audit_trail
       WHERE action IN ('SHARING_CHANGE','PERMISSION_GRANT','PERMISSION_REVOKE')
         AND target_type = 'ATLAS'`
    );
    assert.ok(rows[0].n >= 5, `expected the sharing history to exist, got ${rows[0].n} rows`);
  });

  it('a FAILED sharing change records nothing', async () => {
    // Auditing an attempt that did not happen is its own defect: it would put a
    // grant in the history that never took effect.
    const ghost = randomUUID();
    const before = (await auditRows()).length;

    await as('delete', `${base()}/sharing/users/${ghost}`).expect(404);

    assert.equal((await auditRows()).length, before, 'no audit row for a no-op revoke');
  });

  it('a share added directly in the fixture is unaffected (no retroactive rows)', async () => {
    const other = await createUser(db, { username: `shaud_o_${randomUUID().slice(0, 8)}` });
    await createShare(db, atlas.id, other.id, 'read', owner.id);

    const rows = await auditRows();
    assert.ok(
      !rows.some((r) => r.details?.userId === other.id),
      'auditing happens at the API boundary, not by a database trigger'
    );
  });
});

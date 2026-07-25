// Path: tests/integration/org-status-fail-open.test.js
// Item 59 (testes-backend.md) — invariant I9: an org-less / legacy principal is
// EXEMPT from the org-liveness gate, and an unknown org row counts as ACTIVE.
//
// Both are deliberate fail-OPEN decisions, and before this file neither had any
// test at all: `grep 'organization_id: null' backend/tests/` returned zero hits and
// the createUser fixture always attaches the seeded default org. So the
// `if (!organizationId) return true` early return and the LEFT JOIN + COALESCE of
// LIVE_AUTH_STATE were never executed by the suite. "Hardening" either one — LEFT
// JOIN -> INNER JOIN, or the early return -> `return false` — would 401 every
// org-less user on every strict route with the whole suite green.
//
// The existing reconciliation tests (auth-live-reconciliation.test.js,
// collab-reauthz.test.js) cover only the fail-CLOSED direction and always with a
// user that belongs to a real, active org.
//
// The HTTP probe deliberately avoids /auth/me: livro-razao records that it re-reads
// the user and would answer the same with or without the gate (teste-que-não-prende).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';
import { orgIsActive, getLiveAuthState } from '../../src/utils/org-status.js';

describe('org-status — the fail-OPEN half of the liveness gate (I9)', () => {
  let app, db, orgless, orglessTok, deadOrgId, member, memberTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // A legacy/org-less principal: exactly what a token minted before organizations
    // existed degrades to (organization_id -> null).
    orgless = await createUser(db, {
      username: `orgless_${randomUUID().slice(0, 8)}`,
      organization_id: null,
    });
    assert.equal(orgless.organization_id, null, 'the fixture must really have no org');
    orglessTok = await loginUser(app, orgless.username, orgless.password);

    // Control group: a member of an org we will deactivate, to prove the gate is alive.
    const org = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ($1, $2, 'OFO') RETURNING id`,
      [`Org Fail Open ${randomUUID().slice(0, 6)}`, `orgfailopen-${randomUUID().slice(0, 8)}`]
    );
    deadOrgId = org.rows[0].id;
    member = await createUser(db, {
      username: `orgmember_${randomUUID().slice(0, 8)}`,
      organization_id: deadOrgId,
    });
    memberTok = await loginUser(app, member.username, member.password);
  });

  after(async () => {
    await db.query('UPDATE users SET organization_id = NULL WHERE id = $1', [member.id]);
    await db.query('DELETE FROM public.organizations WHERE id = $1', [deadOrgId]);
    await teardownTestEnv(db);
  });

  it('orgIsActive() exempts the absent org and treats an UNKNOWN org as active', async () => {
    assert.equal(await orgIsActive(null), true, 'null org is exempt (legacy token)');
    assert.equal(await orgIsActive(undefined), true, 'undefined org is exempt');
    assert.equal(await orgIsActive(''), true, 'empty string is falsy, therefore exempt');
    // A missing row is an ANOMALY, not a deactivation: it must not lock anyone out.
    assert.equal(await orgIsActive(randomUUID()), true, 'unknown org id counts as active');
  });

  it('getLiveAuthState() of an org-less user keeps the LEFT JOIN + COALESCE open', async () => {
    const live = await getLiveAuthState(orgless.id);
    assert.ok(live, 'an existing user must resolve');
    assert.equal(live.organizationId, null);
    assert.equal(live.orgIsActive, true, 'COALESCE(o.is_active, true) — no org means no blocker');
    assert.equal(live.userIsActive, true);
    assert.equal(live.role, 'user');
  });

  it('getLiveAuthState() of an UNKNOWN user is null — the user row IS decisive', async () => {
    // The opposite rule from the org: a missing account is not an anomaly, it is gone.
    assert.equal(await getLiveAuthState(randomUUID()), null);
    assert.equal(await getLiveAuthState(null), null);
  });

  it('an org-less user passes STRICT auth on a real route (not /auth/me)', async () => {
    await supertest(app)
      .get('/api/v1/atlas')
      .set('Authorization', `Bearer ${orglessTok}`)
      .expect(200);
  });

  it('and the gate is NOT simply dead: a member of a DEACTIVATED org is refused on the same route', async () => {
    // Positive control for the test above. Without it, a gate removed entirely would
    // make the org-less case pass for the wrong reason.
    await supertest(app)
      .get('/api/v1/atlas')
      .set('Authorization', `Bearer ${memberTok}`)
      .expect(200);

    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [deadOrgId]);

    // The contract is 403 ForbiddenError('Organization is inactive') (auth.js:143):
    // the credential is valid, the ORG is not — a 401 would tell the client to
    // re-authenticate, which cannot help.
    const res = await supertest(app)
      .get('/api/v1/atlas')
      .set('Authorization', `Bearer ${memberTok}`)
      .expect(403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.equal(await orgIsActive(deadOrgId), false, 'orgIsActive reports the deactivation');

    await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [deadOrgId]);
  });

  it('the org-less user still passes AFTER the control org was deactivated and restored', async () => {
    // Closes the loop: the exemption is a property of the principal, not of test order.
    await supertest(app)
      .get('/api/v1/atlas')
      .set('Authorization', `Bearer ${orglessTok}`)
      .expect(200);
  });
});

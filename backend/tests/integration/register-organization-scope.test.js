// Path: tests/integration/register-organization-scope.test.js
// Self-registration accepts a client-chosen `organization_id` (the OM dropdown).
//
// The value went into the INSERT with only a UUID FORMAT check (auth.schemas.js:29),
// never a check that the organization exists or is active. Membership is not
// decorative: `isProjectReadable` (sv360.service.js:33-38) grants read of an org's
// `disabled` — unpublished — 360 projects to anyone whose `organization_id` matches,
// and every active org's UUID is handed out by the ANONYMOUS GET /api/config to
// populate that very dropdown.
//
// WHAT THIS FIXES AND WHAT IT DOES NOT — recorded so the residual risk is not
// mistaken for a closed hole. Rejecting nonexistent/inactive orgs is the whole of
// the change. Someone can still self-declare a real, active OM they do not belong
// to and read its unpublished 360 projects, because the dropdown IS a
// self-declaration; closing that needs an approval step, deliberately deferred (see
// bugs-backend.md #33). Exposure is limited to deployments with
// ALLOW_SELF_REGISTRATION enabled, which is off in production.
//
// The last test below asserts the hole that is knowingly left open. It is written
// as an explicit expectation, not left untested, so that if the approval step ever
// lands, this test fails and forces the decision to be revisited rather than
// silently contradicted.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

describe('self-registration validates the chosen organization', () => {
  let app, db, inactiveOrgId, activeOrgId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const rid = randomUUID().slice(0, 8);
    const active = await db.query(
      `INSERT INTO organizations (nome, slug, sigla, is_active)
       VALUES ($1, $2, 'ATV', TRUE) RETURNING id`,
      [`OM Ativa ${rid}`, `om-ativa-${rid}`]
    );
    activeOrgId = active.rows[0].id;

    const inactive = await db.query(
      `INSERT INTO organizations (nome, slug, sigla, is_active)
       VALUES ($1, $2, 'INA', FALSE) RETURNING id`,
      [`OM Inativa ${rid}`, `om-inativa-${rid}`]
    );
    inactiveOrgId = inactive.rows[0].id;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const register = (body) =>
    supertest(app).post('/api/v1/auth/register').send({
      username: `reg_${randomUUID().slice(0, 8)}`,
      password: 'Test@1234',
      nome: 'Fulano de Tal',
      ...body,
    });

  it('refuses an organization_id that does not exist', async () => {
    const ghost = randomUUID();
    const res = await register({ organization_id: ghost });
    assert.equal(res.status, 400, `expected a refusal, got ${res.status}`);

    const { rows } = await db.query(
      'SELECT id FROM users WHERE organization_id = $1', [ghost]
    );
    assert.equal(rows.length, 0, 'and no user row is bound to a nonexistent org');
  });

  it('refuses an INACTIVE organization', async () => {
    const res = await register({ organization_id: inactiveOrgId });
    assert.equal(res.status, 400, `expected a refusal, got ${res.status}`);

    const { rows } = await db.query(
      'SELECT id FROM users WHERE organization_id = $1', [inactiveOrgId]
    );
    assert.equal(rows.length, 0, 'a deactivated org gains no new members');
  });

  it('accepts an active organization', async () => {
    const username = `reg_ok_${randomUUID().slice(0, 8)}`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: 'Test@1234', nome: 'Beltrano', organization_id: activeOrgId })
      .expect(201);

    const { rows } = await db.query(
      'SELECT organization_id FROM users WHERE username = $1', [username]
    );
    assert.equal(rows[0].organization_id, activeOrgId, 'the legitimate choice is honoured');
  });

  it('falls back to the default organization when none is given', async () => {
    const username = `reg_def_${randomUUID().slice(0, 8)}`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: 'Test@1234', nome: 'Sicrano' })
      .expect(201);

    const { rows } = await db.query(
      'SELECT organization_id FROM users WHERE username = $1', [username]
    );
    assert.equal(rows[0].organization_id, DEFAULT_ORG, 'COALESCE still routes to the default org');
  });

  it('KNOWN GAP: still allows self-declaring a real org the user does not belong to', async () => {
    // Not an endorsement — a marker. Accepted deliberately (bugs-backend.md #33)
    // because the OM dropdown is a self-declaration and closing it requires an
    // approval workflow. If that workflow lands, THIS test breaks, which is the
    // point: the decision gets revisited instead of quietly reversed.
    const username = `reg_gap_${randomUUID().slice(0, 8)}`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: 'Test@1234', nome: 'Não Membro', organization_id: activeOrgId })
      .expect(201);

    const { rows } = await db.query(
      'SELECT organization_id, org_role FROM users WHERE username = $1', [username]
    );
    assert.equal(rows[0].organization_id, activeOrgId, 'membership is immediate, with no approval');
    assert.equal(rows[0].org_role, 'viewer', 'but only at the lowest org role');
  });
});

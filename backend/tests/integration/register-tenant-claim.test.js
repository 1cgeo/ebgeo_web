// Path: tests/integration/register-tenant-claim.test.js
// Item 53. `users.schemas.js:4-11` documents the tenant-hop threat in full and CLOSES
// it on PUT /users/me ("a user must not be able to move themselves into another
// tenant... that would grant read access to the target org's private sv360
// projects"). `registerSchema` leaves the same door open: `organization_id` is a free
// field and `email` is OPTIONAL, so an API caller (not the UI, which requires an
// e-mail) creates an ACTIVE account inside any OM on the spot — the login gate only
// fires when `email IS NOT NULL`.
//
// The containment that DOES exist is asserted here (the org must exist and be active);
// the residual gap — self-declaring a real, active OM you do not belong to — is
// characterized in register-organization-scope.test.js and deliberately deferred.
// What this file adds is the end-to-end consequence: the claim lands in the JWT and
// the session is usable at once.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import config from '../../src/config.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

describe('POST /auth/register: the organization the applicant claims for themselves', () => {
  let app, db, adminToken, orgB, coronel;
  const tag = randomUUID().slice(0, 8);

  const register = (payload) => supertest(app).post('/api/v1/auth/register').send(payload);

  const login = (username, password) => supertest(app)
    .post('/api/v1/auth/login').send({ username, password });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    assert.equal(
      config.security.allowSelfRegistration, true,
      'fixture: self-registration is on in NODE_ENV=test, otherwise the route is not even mounted'
    );

    const admin = await createAdminUser(db, { username: `p53_admin_${tag}` });
    adminToken = await loginUser(app, admin.username, admin.password);

    const res = await supertest(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: `OM Bravo ${tag}`, slug: `om-bravo-${tag}`, sigla: 'BRV' })
      .expect(201);
    orgB = res.body.data;

    const { rows } = await db.query("SELECT id, nome FROM ranks WHERE nome ILIKE 'Coronel' LIMIT 1");
    coronel = rows[0];
    assert.ok(coronel, 'fixture: the seed rank "Coronel" must exist');
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('an e-mail-less signup into a chosen OM is active at once, and the JWT carries that OM', async () => {
    const username = `p53_claim_${tag}`;
    await register({ username, password: 'Claim@1234', nome: 'Reivindicante', organization_id: orgB.id })
      .expect(201);

    const res = await login(username, 'Claim@1234').expect(200);
    const payload = jwt.verify(res.body.data.accessToken, config.jwt.secret);

    assert.equal(
      payload.organization_id, orgB.id,
      'the applicant chose their own tenant and the token now asserts it'
    );
    assert.equal(payload.role, 'user', 'self-registration never mints a global admin');
    assert.equal(payload.org_role, 'viewer', 'nor an elevated role inside the org');
  });

  it('THE CONSEQUENCE: the self-declared claim buys the org\'s UNPUBLISHED 360 projects', async () => {
    // This is what makes the open field a real exposure rather than untidiness.
    // LIST_PROJECTS (sv360.queries.js:11-16) filters
    //   status = 'enabled' OR organization_id = $2
    // so membership — which the applicant granted themselves — is enough to see a
    // project the owning org has deliberately NOT published. An anonymous caller sees
    // nothing of the sort, which is the control that proves the delta comes from the
    // claim and not from the project being public anyway.
    const username = `p53_sv360_${tag}`;
    await register({ username, password: 'Claim@1234', nome: 'Espião', organization_id: orgB.id })
      .expect(201);
    const token = (await login(username, 'Claim@1234').expect(200)).body.data.accessToken;

    const slug = `p53-secreto-${tag}`;
    await db.query(
      `INSERT INTO sv360.projects (slug, name, organization_id, status, db_filename)
       VALUES ($1, 'Projeto Secreto', $2, 'disabled', $3)`,
      [slug, orgB.id, `${orgB.id}__${slug}.db`]
    );

    // sv360 answers with a BARE array (its envelope is deliberately flat).
    const anon = await supertest(app).get('/api/v1/sv360/projects').expect(200);
    assert.ok(Array.isArray(anon.body), 'the flat sv360 envelope');
    assert.ok(
      !anon.body.some((p) => p.slug === slug),
      'CONTROL: a disabled project is invisible without the org claim'
    );

    const res = await supertest(app)
      .get('/api/v1/sv360/projects')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.ok(
      res.body.some((p) => p.slug === slug),
      'and visible with it — signup is currently an unapproved membership grant'
    );
  });

  it('a nonexistent or inactive OM is refused, and no account is created', async () => {
    const ghost = `p53_ghost_${tag}`;
    await register({ username: ghost, password: 'Claim@1234', nome: 'Fantasma', organization_id: randomUUID() })
      .expect(400);

    const { rows } = await db.query('SELECT count(*)::int AS n FROM users WHERE username = $1', [ghost]);
    assert.equal(rows[0].n, 0, 'the guard fires before the INSERT');
  });

  it('no organization_id at all falls back to the default org', async () => {
    const username = `p53_default_${tag}`;
    await register({ username, password: 'Claim@1234', nome: 'Padrão' }).expect(201);

    const { rows } = await db.query('SELECT organization_id FROM users WHERE username = $1', [username]);
    assert.equal(rows[0].organization_id, DEFAULT_ORG, 'the COALESCE in INSERT_USER');
  });

  it('HAPPY PATH: rank_id + organization_id come back from /users/me as DERIVED NAMES', async () => {
    const username = `p53_happy_${tag}`;
    await register({
      username, password: 'Claim@1234', nome: 'Completo',
      rank_id: coronel.id, organization_id: orgB.id,
    }).expect(201);

    const token = (await login(username, 'Claim@1234').expect(200)).body.data.accessToken;
    const me = await supertest(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(me.body.data.posto_graduacao, coronel.nome, 'a name, not the UUID');
    assert.equal(me.body.data.organizacao_militar, orgB.nome);
    assert.equal(me.body.data.rank_id, coronel.id, 'the FK travels alongside the derived name');
    assert.equal(me.body.data.organization_id, orgB.id);
  });

  it('an account WITH an e-mail is pending instead: the gate only exists for e-mail accounts', async () => {
    const username = `p53_pending_${tag}`;
    await register({
      username, password: 'Claim@1234', nome: 'Pendente',
      email: `${username}@example.mil`, organization_id: orgB.id,
    }).expect(201);

    const res = await login(username, 'Claim@1234');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'EMAIL_NOT_VERIFIED');
  });
});

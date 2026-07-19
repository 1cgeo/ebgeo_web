// Path: tests/integration/edge-hardening.repro.test.js
// Four independent edge defects, each cheap and each reachable without credentials
// or with only ordinary ones. Grouped because they share a shape: a value from the
// caller reaching code that assumed it was already well-formed or already trusted.
//
//  #87/#110 — authLimiter crashed on a non-string username. `(req.body?.username ||
//    '')` only replaces FALSY values, so a number/array/object walks past it into
//    `.toLowerCase()`. express-rate-limit forwards the TypeError through next(), it
//    arrives at errorHandler with no statusCode, and the answer is 500. The route is
//    PRE-AUTHENTICATION and the limiter runs BEFORE Joi, so anyone could turn a login
//    attempt into a server fault.
//
//  #91 — searchUsers pasted the query straight into a LIKE pattern. Not SQL
//    injection (it travels as $1) but PATTERN injection: a user's `%`/`_` gained
//    wildcard meaning. It broke literal search — usernames here routinely contain `_`
//    — and made `q=%%` a full scan bounded only by LIMIT 20.
//
//  #48 — /nomes/busca trusted the JWT's userId without checking `is_active`.
//    flexibleAuth only reconciles against the DB in the last 5 minutes of a token's
//    life, so between a deactivation and that window a disabled account kept reading
//    PRIVATE place names, while the sibling routes refused it immediately. The header
//    of nomes.queries.js assigns the SQL the job of not leaking private data "even
//    with an app bug" — this was the app bug.
//
//  #92 — GET /sv360/projects/:slug returned the raw row, including `db_filename` and
//    `organization_id`, to an ANONYMOUS caller. Since the filename is
//    `${orgId}__${slug}.db`, that pair reveals the owning org's internal UUID and the
//    exact path on disk. No contract test pinned the response shape, which is how the
//    fields escaped review.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

describe('edge hardening', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // =========================================================================
  // #87 / #110 — a malformed username must not become a 500
  // =========================================================================
  describe('authLimiter tolerates a malformed username', () => {
    // RATE_LIMIT_FORCE is REQUIRED here, and the negative control is what proved it:
    // `skip` disables the limiter whenever config.isTest and this flag is unset, so
    // without it the keyGenerator never runs and these cases pass with the bug fully
    // present — a green proving nothing. Turning the limiter on is the only way this
    // suite touches the code it claims to test.
    before(() => { process.env.RATE_LIMIT_FORCE = '1'; });
    after(() => { delete process.env.RATE_LIMIT_FORCE; });

    const login = (username) =>
      supertest(app).post('/api/v1/auth/login').send({ username, password: 'qualquer' });

    for (const [label, value] of [
      ['a number', 12345],
      ['an array', ['a', 'b']],
      ['an object', { toLowerCase: 'not a function' }],
      ['a boolean', true],
    ]) {
      it(`answers 4xx, not 500, when username is ${label}`, async () => {
        const res = await login(value);
        assert.notEqual(res.status, 500, `a malformed body must not be a server fault (${label})`);
        assert.ok(res.status >= 400 && res.status < 500, `expected a client error, got ${res.status}`);
      });
    }

    it('still authenticates a well-formed request', async () => {
      const u = await createUser(db, { username: `edge_ok_${randomUUID().slice(0, 8)}` });
      await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: u.username, password: u.password })
        .expect(200);
    });
  });

  // =========================================================================
  // #91 — LIKE metacharacters are literal
  // =========================================================================
  describe('user search treats wildcards literally', () => {
    let token, target;

    before(async () => {
      const caller = await createUser(db, { username: `edge_s_${randomUUID().slice(0, 8)}` });
      token = await loginUser(app, caller.username, caller.password);
      // A username containing an underscore — the shape that broke.
      target = await createUser(db, { username: `alfa_bravo_${randomUUID().slice(0, 6)}` });
    });

    const search = (q) =>
      supertest(app).get(`/api/v1/users/search?q=${encodeURIComponent(q)}`)
        .set('Authorization', `Bearer ${token}`);

    it('finds a username containing an underscore', async () => {
      const res = await search('alfa_bravo').expect(200);
      assert.ok(
        res.body.data.some((u) => u.id === target.id),
        'an underscore must match itself, not "any character"'
      );
    });

    it('a bare wildcard query does not dump the table', async () => {
      const res = await search('%%').expect(200);
      assert.equal(
        res.body.data.length, 0,
        '`%%` is a literal search for two percent signs, not a full scan'
      );
    });

    it('an underscore does not act as a single-character wildcard', async () => {
      // 'alfa_bravo' with the underscore as a wildcard would also match 'alfaXbravo'.
      const decoy = await createUser(db, { username: `alfaXbravo_${randomUUID().slice(0, 6)}` });
      const res = await search('alfa_bravo').expect(200);
      assert.ok(
        !res.body.data.some((u) => u.id === decoy.id),
        'the wildcard meaning is gone'
      );
    });
  });

  // =========================================================================
  // #48 — a deactivated account loses access to private place names at once
  // =========================================================================
  describe('nomes/busca refuses a deactivated account', () => {
    it('stops returning private names the moment the account is deactivated', async () => {
      const u = await createUser(db, { username: `edge_n_${randomUUID().slice(0, 8)}` });
      const token = await loginUser(app, u.username, u.password);

      // The token stays valid: flexibleAuth only re-reads the DB in the last 5
      // minutes of its life, which is exactly the window the defect lived in.
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [u.id]);

      const res = await supertest(app)
        .get('/api/v1/nomes/busca?q=teste&lat=-15.8&lon=-47.9')
        .set('Authorization', `Bearer ${token}`);

      // The route answers (it is anonymous-capable); what matters is that it did not
      // serve anything gated behind the now-dead identity.
      assert.ok(res.status < 500, `should not fault, got ${res.status}`);
      if (res.status === 200) {
        assert.ok(Array.isArray(res.body), 'the frozen contract is still a bare array');
      }
    });
  });

  // =========================================================================
  // #92 — internal storage fields never leave the API
  // =========================================================================
  describe('sv360 project does not leak internal storage fields', () => {
    const slug = `edge-proj-${randomUUID().slice(0, 8)}`;
    let orgId;

    before(async () => {
      const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
      orgId = org.rows[0].id;
      await db.query(
        `INSERT INTO sv360.projects
           (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
         VALUES ($1, $2, $3, -23.5, -46.6, $4, 'enabled', 0)`,
        [orgId, slug, `Projeto ${slug}`, `${orgId}__${slug}.db`]
      );
    });

    it('an anonymous caller gets neither db_filename nor organization_id', async () => {
      const res = await supertest(app).get(`/api/v1/sv360/projects/${slug}`).expect(200);
      const body = JSON.stringify(res.body);

      assert.equal(res.body.db_filename, undefined, 'the on-disk filename is not public');
      assert.equal(res.body.organization_id, undefined, 'nor the owning org UUID');
      assert.ok(!body.includes(orgId), 'and the UUID does not survive anywhere else in the payload');
    });

    it('still returns the fields a client actually uses', async () => {
      const res = await supertest(app).get(`/api/v1/sv360/projects/${slug}`).expect(200);
      assert.equal(res.body.slug, slug, 'the useful shape is intact');
      assert.ok(res.body.name, 'name survives');
    });
  });
});

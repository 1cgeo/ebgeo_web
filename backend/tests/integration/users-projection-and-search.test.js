// Path: tests/integration/users-projection-and-search.test.js
// Items 139 and 140 — what the users API shows OF ANOTHER USER, and which columns the
// search actually reaches.
//
// 139. No test fixes the key set of /users/search or /users/me. Swapping the explicit
//      SELECT for `SELECT u.*` is a plausible refactor (the LEFT JOINs are already
//      there) and would hand password_hash, api_key, email and is_active to every
//      authenticated caller — search is reachable by any account, not just admins —
//      with the whole suite still green. Asserting presence of `username` does not
//      catch that; only an exact key set does.
//
// 140. `LOWER(r.nome) LIKE` and `LOWER(o.nome) LIKE` (users.queries.js:58-59) are the
//      newest clauses of SEARCH_USERS and no test touches them: delete both clauses,
//      or both LEFT JOINs, and every existing search test stays green. This is the
//      "search by posto" feature of the UX batch.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

// The exact contract of each projection. Written out, not derived from the query,
// because deriving it from the thing under test would assert nothing.
const SEARCH_KEYS = [
  'id', 'nome', 'organizacao_militar', 'organization_id',
  'posto_graduacao', 'rank_id', 'username',
];
const ME_KEYS = [
  'created_at', 'id', 'last_login_at', 'nome', 'organizacao_militar',
  'organization_id', 'posto_graduacao', 'rank_id', 'username',
];
const NEVER_EXPOSED = ['password_hash', 'password', 'api_key', 'email', 'is_active', 'role'];

describe('users: field projection and what the search can reach', () => {
  let app, db, caller, callerToken, adminToken;
  let coronel, om, target, plain;
  const tag = randomUUID().slice(0, 8);

  const search = (q) => supertest(app)
    .get(`/api/v1/users/search?q=${encodeURIComponent(q)}`)
    .set('Authorization', `Bearer ${callerToken}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const { rows: ranks } = await db.query(
      "SELECT id, nome FROM ranks WHERE nome ILIKE 'Coronel' LIMIT 1"
    );
    coronel = ranks[0];
    assert.ok(coronel, 'fixture: the seed rank "Coronel" must exist');

    // A DEDICATED organization, not the seeded default: SEARCH_USERS caps at LIMIT 20
    // and every fixture in the suite lands in the default org, so a query for its name
    // would be answered by twenty unrelated users and the subject would fall off the
    // end — a false negative that says nothing about the o.nome clause.
    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla)
       VALUES ($1, $2, 'SRC') RETURNING id, nome`,
      [`Organizacao Xilofone ${tag}`, `om-xilofone-${tag}`]
    );
    om = orgs[0];

    // The searchable subject: a Coronel of the default OM, with a unique surname.
    target = await createUser(db, {
      username: `srch_target_${tag}`,
      nome: `Zulmiro ${tag}`,
      rank_id: coronel.id,
      organization_id: om.id,
    });
    // The control: no rank, no org, same unique surname so a name query still finds it.
    plain = await createUser(db, {
      username: `srch_plain_${tag}`,
      nome: `Zulmiro Sem Posto ${tag}`,
      rank_id: null,
      organization_id: null,
    });

    caller = await createUser(db, {
      username: `srch_caller_${tag}`, rank_id: coronel.id, organization_id: om.id,
    });
    callerToken = await loginUser(app, caller.username, caller.password);
    const admin = await createAdminUser(db, { username: `srch_admin_${tag}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ── item 139 · projections ─────────────────────────────────────────────────
  it('/users/search exposes exactly seven fields, on every row', async () => {
    const res = await search('Zulmiro').expect(200);

    assert.ok(res.body.data.length >= 2, 'guard: the loop below must iterate over something');
    for (const row of res.body.data) {
      assert.deepEqual(Object.keys(row).sort(), SEARCH_KEYS, 'the projection is the contract');
      for (const secret of NEVER_EXPOSED) {
        assert.equal(row[secret], undefined, `${secret} must never reach another user`);
      }
    }
  });

  it('/users/me exposes exactly nine fields — no role, no is_active', async () => {
    const res = await supertest(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${callerToken}`)
      .expect(200);

    assert.deepEqual(Object.keys(res.body.data).sort(), ME_KEYS);
    assert.equal(res.body.data.role, undefined);
    assert.equal(res.body.data.is_active, undefined);
  });

  it('CONTRAST: the ADMIN view of the same user deliberately shows more', async () => {
    const res = await supertest(app)
      .get(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // The divergence between the two projections is intentional and has to be pinned
    // from both sides, or "admin sees more" degrades into "everyone sees more".
    for (const field of ['role', 'is_active', 'email', 'email_verified']) {
      assert.ok(field in res.body.data, `the admin view must keep exposing ${field}`);
    }
    assert.equal(res.body.data.password_hash, undefined, 'but never the hash');
    assert.equal(res.body.data.api_key, undefined, 'nor the api key');
  });

  // ── item 140 · the rank / organization clauses ─────────────────────────────
  it('finds a user by their POSTO (r.nome), not only by name or username', async () => {
    const res = await search('Coronel').expect(200);

    const ids = res.body.data.map((u) => u.id);
    assert.ok(ids.includes(target.id), 'the Coronel clause is live');
    assert.ok(!ids.includes(plain.id), 'and a user with no rank is not swept in');
  });

  it('finds a user by their OM (o.nome)', async () => {
    const res = await search('Xilofone').expect(200);

    const ids = res.body.data.map((u) => u.id);
    assert.ok(ids.includes(target.id), 'the o.nome clause is live');
    assert.ok(!ids.includes(plain.id), 'the user with no organization stays out');
  });

  it('the posto match is case-insensitive on both sides (LOWER over LOWER)', async () => {
    const lower = await search('coronel').expect(200);
    const upper = await search('CORONEL').expect(200);

    const idsOf = (res) => res.body.data.map((u) => u.id).sort();
    assert.ok(idsOf(lower).includes(target.id));
    assert.deepEqual(idsOf(lower), idsOf(upper));
  });

  it('LIKE wildcards typed by the user stay literal: "C_ronel" matches nobody', async () => {
    // escapeLike() makes `_` a literal underscore. Without it this would match
    // "Coronel" and the search would silently answer a pattern the user did not write.
    const res = await search('C_ronel').expect(200);

    const ids = res.body.data.map((u) => u.id);
    assert.ok(!ids.includes(target.id), 'the single-char wildcard must not be honored');
  });
});

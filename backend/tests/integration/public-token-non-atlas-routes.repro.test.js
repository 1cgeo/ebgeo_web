// Path: tests/integration/public-token-non-atlas-routes.repro.test.js
// Regression (achado 11): the read-only visitor token was accepted by the STRICT
// `auth` middleware as an ordinary authenticated credential on every route that is
// neither atlas-scoped nor admin-gated.
//
// `getAtlasByPublicLink` mints `sub: public-<uuid>` with `isPublic` + `atlasId`
// (atlas.service.js). `auth` matched the sub against PRINCIPAL_UUID_RE, failed, and
// did a bare `return next()` — the "public principals are exempt from live
// reconciliation" branch. Exempt from reconciliation had silently become exempt from
// authorization: nothing downstream distinguished the visitor from a real account.
//
// Achado 51 (fixed 2026-07-19) closed the ATLAS-SCOPED half by comparing the token's
// atlasId inside requireAtlasPermission. That guard only runs on routes that mount
// it. Everything else stayed open, and the sharpest one is a personnel directory:
//
//   GET /users/search?q=ma  → up to 20 users (username, nome, posto, OM) from EVERY
//                             organization; SEARCH_USERS filters by nothing but the
//                             search term (users.queries.js) and the route is gated
//                             by `auth` alone (users.routes.js:16).
//   GET /organizations, GET /ranks → the same, for the org and rank tables.
//
// A read-only invitation to one atlas became a credential for the system's people
// directory. The WS gateway has always confined the token (collab.gateway.js:55-57);
// only the REST path lacked the equivalent.
//
// Negative control: restore the bare `return next()` for non-UUID principals in
// middleware/auth.js and the four refusal cases below return 200.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap } from '../helpers/fixtures.js';

describe('a visitor token is not a general-purpose credential (repro)', () => {
  let app, db;
  let atlasA, mapA, tokenA, ownerA;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    ownerA = await createUser(db, {
      username: `pubowner_${randomUUID().slice(0, 8)}`,
      nome: 'Fulano de Tal',
    });
    atlasA = await createAtlas(db, ownerA.id, { name: 'Atlas Publicado' });
    mapA = await createMap(db, atlasA.id, { name: 'Mapa do Atlas Publicado' });

    const link = randomUUID().replace(/-/g, '');
    await db.query('UPDATE atlas SET is_public = true, public_link = $2 WHERE id = $1', [atlasA.id, link]);

    const res = await supertest(app).get(`/api/v1/atlas/public/${link}`).expect(200);
    tokenA = res.body.data.publicToken;
    assert.ok(tokenA, 'fixture: the public link really issues a visitor token');
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const asVisitor = (path) =>
    supertest(app).get(path).set('Authorization', `Bearer ${tokenA}`);

  it('cannot search the user directory', async () => {
    // The headline exposure: name, username, posto and OM of users from every
    // organization, to anyone who was handed one read-only link.
    const res = await asVisitor('/api/v1/users/search?q=ma');
    assert.equal(res.status, 403, `visitor token must not reach /users/search, got ${res.status}`);
    assert.ok(!Array.isArray(res.body?.data), 'no user rows may be returned');
  });

  it('cannot list organizations or ranks', async () => {
    assert.equal((await asVisitor('/api/v1/organizations')).status, 403);
    assert.equal((await asVisitor('/api/v1/ranks')).status, 403);
  });

  it('cannot read the caller profile routes of a real account', async () => {
    // /auth/me and /users/me look up `req.user.id` — a synthetic `public-<uuid>` sub
    // that has no users row. Refusing at the gate is the honest answer.
    assert.equal((await asVisitor('/api/v1/auth/me')).status, 403);
    assert.equal((await asVisitor('/api/v1/users/me')).status, 403);
  });

  it('cannot list atlases', async () => {
    // GET /atlas has `auth` but no atlas param, so achado 51's guard never runs.
    const res = await asVisitor('/api/v1/atlas');
    assert.equal(res.status, 403, `visitor token must not list atlases, got ${res.status}`);
  });

  it('still reads everything inside the atlas it was issued for', async () => {
    // The confinement must not break the feature it confines: the public viewer
    // pulls the atlas, its maps and its snapshot with exactly this token.
    assert.equal((await asVisitor(`/api/v1/atlas/${atlasA.id}`)).status, 200);
    assert.equal((await asVisitor(`/api/v1/atlas/${atlasA.id}/maps`)).status, 200);
    assert.equal((await asVisitor(`/api/v1/atlas/${atlasA.id}/maps/${mapA.id}`)).status, 200);
    assert.equal((await asVisitor(`/api/v1/atlas/${atlasA.id}/sync/0`)).status, 200);
    assert.equal((await asVisitor(`/api/v1/atlas/${atlasA.id}/settings`)).status, 200);
  });

  it('an ordinary authenticated user still searches the directory (unchanged)', async () => {
    // Blast-radius guard: the fix must confine the VISITOR principal only, not
    // narrow a route that real accounts legitimately use.
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: ownerA.username, password: ownerA.password })
      .expect(200);

    const res = await supertest(app)
      .get('/api/v1/users/search?q=fulano')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);
    assert.ok(Array.isArray(res.body.data), 'a real account still gets the directory');
  });
});

// Path: tests/integration/zones-coverage.test.js
// Coverage for GENUINELY-UNTESTED spatial behavior of the geographic-access
// "zones" subsystem (ng). The zones admin module has no spatial READ endpoint;
// zones gate visibility through the EMBEDDED access filter in the gazetteer
// query (nomes.queries.BUSCA: ST_Contains over ng.fn_user_zone_geoms). The
// existing nomes-access.test.js proves the "user with NO zone" negative and the
// group branch. The gaps pinned HERE:
//
//   zones-cov-01  STRONGER NEGATIVE (spatial-ness): a user granted a DIFFERENT,
//                 NON-OVERLAPPING zone still does NOT see a private name that
//                 lies in another zone. Proves the SQL filter is geometric
//                 (ST_Contains), not a boolean "has ANY zone grant". The prior
//                 negative only removed all grants — it could pass even if the
//                 filter ignored geometry.
//   zones-cov-02  POSITIVE TOGGLE: the SAME user, once granted the COVERING
//                 zone, sees the private name — the filter flips purely on
//                 geometry/grant, nothing else changed.
//   zones-cov-03  EMPTY RESULT: a spatial search that matches nothing returns
//                 200 with an empty array (frozen bare-array contract), NOT 500.
//   zones-cov-04  MALFORMED COORDINATES: non-numeric lat/lon -> 422 (Joi border),
//                 on both /busca and /feicoes, never a 500.
//   zones-cov-05  /feicoes empty neighborhood -> 200 with the {message} contract
//                 (not 500, not null leaking through).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

const uname = (p) => `${p}_${randomUUID().slice(0, 8)}`;

// Two NON-OVERLAPPING square zones.
//   COVERING zone: a square around (-43.2, -22.9) — contains the secret point.
//   ELSEWHERE zone: a square far to the west (~-50, -10) — does NOT contain it.
const COVERING = {
  type: 'Polygon',
  coordinates: [[[-43.3, -22.95], [-43.1, -22.95], [-43.1, -22.85], [-43.3, -22.85], [-43.3, -22.95]]],
};
const ELSEWHERE = {
  type: 'Polygon',
  coordinates: [[[-50.1, -10.1], [-49.9, -10.1], [-49.9, -9.9], [-50.1, -9.9], [-50.1, -10.1]]],
};

// The secret point sits inside COVERING, outside ELSEWHERE.
const SECRET_LAT = -22.9;
const SECRET_LON = -43.2;

describe('Zones coverage (spatial-ness of the access filter + empty/malformed edges)', () => {
  let app, db, admin, adminTok;
  let elsewhereUser, elsewhereTok; // granted ELSEWHERE only
  let secretName, coveringZoneId, elsewhereZoneId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: uname('cov_admin') });
    adminTok = await loginUser(app, admin.username, admin.password);

    elsewhereUser = await createUser(db, { username: uname('cov_elsewhere') });
    elsewhereTok = await loginUser(app, elsewhereUser.username, elsewhereUser.password);

    // A UNIQUE private name at the secret point (unique so other parallel files
    // inserting fixtures at the same coords cannot perturb the assertions).
    secretName = `Base ${randomUUID().slice(0, 8)}`;
    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, access_level, geom)
       VALUES ($1, 'Cidade', 'private', ST_SetSRID(ST_MakePoint($2, $3), 4674))`,
      [secretName, SECRET_LON, SECRET_LAT]
    );
    await db.query('SELECT ng.refresh_busca()');

    // Two zones; grant elsewhereUser ONLY the non-covering one.
    const cov = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: uname('cov_covering'), geom: COVERING })
      .expect(201);
    coveringZoneId = cov.body.data.id;

    const els = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: uname('cov_elsewhere_zone'), geom: ELSEWHERE })
      .expect(201);
    elsewhereZoneId = els.body.data.id;

    await supertest(app)
      .put(`/api/v1/zones/${elsewhereZoneId}/permissions`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ users: [elsewhereUser.id] })
      .expect(200);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const busca = (token, q, coords = { lat: SECRET_LAT, lon: SECRET_LON }) => {
    let r = supertest(app).get('/api/v1/nomes/busca').query({ q, ...coords });
    if (token) r = r.set('Authorization', `Bearer ${token}`);
    return r;
  };

  // ---------------------------------------------------------------------------
  // zones-cov-01 — STRONGER NEGATIVE: a grant to a NON-OVERLAPPING zone does NOT
  // leak a private name in a different zone. This is the access filter proven to
  // be GEOMETRIC (ST_Contains), not merely "the user owns some zone". The data
  // would leak if the SQL had collapsed the spatial test into a boolean grant.
  // ---------------------------------------------------------------------------
  it('zones-cov-01: a NON-overlapping zone grant does NOT leak a private name elsewhere (spatial filter)', async () => {
    const res = await busca(elsewhereTok, secretName).expect(200);
    assert.ok(
      !res.body.some((r) => r.nome === secretName),
      'private name must NOT surface for a user whose only zone is geometrically elsewhere'
    );
  });

  // ---------------------------------------------------------------------------
  // zones-cov-02 — POSITIVE TOGGLE: grant the SAME user the COVERING zone; now
  // the private name appears. Nothing changed but the geometry of the grant, so
  // this isolates the spatial predicate as the sole cause (paired with cov-01).
  // ---------------------------------------------------------------------------
  it('zones-cov-02: granting the COVERING zone to the same user reveals the private name (toggle on geometry)', async () => {
    // Replace-set: keep ELSEWHERE and ADD COVERING for this user.
    await supertest(app)
      .put(`/api/v1/zones/${coveringZoneId}/permissions`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ users: [elsewhereUser.id] })
      .expect(200);

    const res = await busca(elsewhereTok, secretName).expect(200);
    assert.ok(
      res.body.some((r) => r.nome === secretName),
      'private name must surface once the user holds the geometrically-covering zone'
    );
  });

  // ---------------------------------------------------------------------------
  // zones-cov-03 — EMPTY RESULT: a spatial search matching nothing returns 200
  // with an empty array (frozen bare-array contract), never a 500. Uses a term
  // with no similarity match anywhere in the gazetteer.
  // ---------------------------------------------------------------------------
  it('zones-cov-03: spatial search with no match -> 200 and an empty array (not 500)', async () => {
    const res = await busca(adminTok, `zzz_no_such_place_${randomUUID().slice(0, 8)}`).expect(200);
    assert.ok(Array.isArray(res.body), 'frozen contract: a bare array');
    assert.equal(res.body.length, 0, 'no matches -> empty array, not an error');
  });

  // ---------------------------------------------------------------------------
  // zones-cov-04 — MALFORMED COORDINATES: non-numeric lat/lon are rejected at the
  // Joi border with 422 (VALIDATION_ERROR) on BOTH spatial endpoints, never
  // reaching PostGIS as a 500.
  // ---------------------------------------------------------------------------
  it('zones-cov-04: malformed coordinates -> 422 on /busca and /feicoes (never 500)', async () => {
    const buscaBad = await supertest(app)
      .get('/api/v1/nomes/busca')
      .query({ q: 'qualquer', lat: 'not-a-number', lon: SECRET_LON })
      .expect(422);
    assert.equal(buscaBad.body.error.code, 'VALIDATION_ERROR');

    // /feicoes is auth-strict; use the admin token so we exercise the validator,
    // not the auth gate.
    const feicoesBad = await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: SECRET_LAT, lon: 'NaN-ish', z: 25 })
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(422);
    assert.equal(feicoesBad.body.error.code, 'VALIDATION_ERROR');
  });

  // ---------------------------------------------------------------------------
  // zones-cov-05 — /feicoes over empty ocean returns 200 with the {message}
  // contract (no building within 3m), proving the null-result path does not 500
  // and does not leak a bare null.
  // ---------------------------------------------------------------------------
  it('zones-cov-05: /feicoes with no nearby building -> 200 {message} (not 500, not null)', async () => {
    const res = await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: 0, lon: 0, z: 10 }) // null island: no edificacoes
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.equal(typeof res.body, 'object');
    assert.ok(res.body && res.body.message, 'empty neighborhood returns the {message} contract');
    assert.equal(res.body.nome, undefined, 'no building leaked');
  });
});

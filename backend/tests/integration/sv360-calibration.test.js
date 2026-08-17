// Path: tests/integration/sv360-calibration.test.js
// Fase 9 (stage 2b): the calibration surface of the StreetView 360 module — the
// routes ported from ebgeo_360's photos.js/calibration.js into this house.
//
// WHAT EACH TEST HERE REPROVES, measured against the pre-change backend:
//   - GET /photos/nearest answered 422 '"uuid" must be a valid GUID', because the
//     literal was captured by '/photos/:uuid'. Express matches in DECLARATION
//     ORDER and, unlike the origin's Fastify, has no preference for a literal
//     segment. The client does `if (!response.ok) return null`, so 422 and 404
//     were indistinguishable to it and every broken click looked like an empty
//     one. The test pins 404 AND explicitly refuses 422.
//   - GET /projects/review-stats answered 404 'Project not found' — captured as a
//     :slug. Same trap, same fix, its own test.
//   - /photos/:uuid/nearby, /projects/:slug/{photos,map,runs},
//     /runs/:runId/batch-calibration, /projects/:slug/{reset-reviewed,
//     batch-calibration} answered 404 'Route not found': they did not exist.
//   - ?include_hidden=true was silently ignored, so a hidden link could be hidden
//     through the API and never listed again.
//
// FIXTURE: its own coordinate cluster at +60/+25, far from every other sv360 test
// file (all of which seed inside Brazil), because /photos/nearest queries the
// WHOLE table and files run concurrently.
//
// TEARDOWN: PG rows only. This file never reads an image, so no {slug}.db is built
// and there is no EBUSY window on Windows.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';

// Deterministic UUID v5 (node:crypto), same namespace as the sibling sv360 tests.
const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// The STRICT auth middleware trusts the JWT claims for role/org, but it also
// reconciles the principal against the live `users` row when the sub is a bare
// UUID. A NON-UUID sub is exempt from that reconciliation by design (the same
// convention public-share principals use), which is what lets this file mint
// tokens without creating users.
function mintToken({ orgId, orgRole = 'viewer', role = 'user', sub = `sv360cal-${crypto.randomUUID()}` }) {
  return jwt.sign(
    { sub, username: 'u_cal', role, organization_id: orgId, org_role: orgRole },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

const SLUG = 'proj-cal-sv360';
const HIDDEN_SLUG = 'proj-cal-hidden-sv360';

// Own cluster, far from every other sv360 fixture (all inside Brazil).
const LAT0 = 60.5;
const LON0 = 25.5;
// Roughly 20 m north / 20 m east at this latitude.
const D_LAT = 0.00018;
const D_LON = 0.00037;

// Point with no photo within 111 km of it, in the South Pacific.
const OCEAN = { lon: -140, lat: -60 };

const p1 = uuidv5('cal/proj-cal-sv360/c-foto001.jpg'); // ground, source of every /nearby
const p2 = uuidv5('cal/proj-cal-sv360/c-foto002.jpg'); // ground, VISIBLY linked from p1
const p3 = uuidv5('cal/proj-cal-sv360/c-foto003.jpg'); // ground, HIDDEN link from p1
const p4 = uuidv5('cal/proj-cal-sv360/c-foto004.jpg'); // FLOOR 3, unlinked
const p5 = uuidv5('cal/proj-cal-sv360/c-foto005.jpg'); // ground, TOMBSTONED
const p6 = uuidv5('cal/proj-cal-sv360/c-foto006.jpg'); // ground, UNLINKED candidate
const ph1 = uuidv5('cal/proj-cal-hidden-sv360/h-foto001.jpg');

describe('StreetView 360 — calibration surface (stage 2b)', () => {
  let app, db;
  let ownOrgId, otherOrgId, projectId, hiddenProjectId, runId;
  let ownerToken, viewerToken, adminToken, crossOrgToken;

  const url = (p) => `/api/v1/sv360${p}`;
  const bearer = (t) => ['Authorization', `Bearer ${t}`];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const own = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla)
       VALUES ('OM Calib', 'sv360-cal-own-om', 'CALOWN')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`
    );
    ownOrgId = own.rows[0].id;

    const other = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla)
       VALUES ('Outra OM Calib', 'sv360-cal-other-om', 'CALOTH')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`
    );
    otherOrgId = other.rows[0].id;

    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Projeto Calibracao', $3, $4, 'cal.db', 'enabled', 4) RETURNING id`,
      [ownOrgId, SLUG, LAT0, LON0]
    );
    projectId = proj.rows[0].id;

    // Hidden (disabled) project owned by the OTHER org: 404 for anon and for a
    // member of ownOrg, never 403 — a hidden project must be indistinguishable
    // from a nonexistent one.
    const hidden = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, db_filename, status, photo_count)
       VALUES ($1, $2, 'Projeto Oculto', 'calhidden.db', 'disabled', 1) RETURNING id`,
      [otherOrgId, HIDDEN_SLUG]
    );
    hiddenProjectId = hidden.rows[0].id;

    // Two declared floors, which is what makes this a project WITH floors.
    await db.query(
      `INSERT INTO sv360.project_floors (project_id, level, label)
       VALUES ($1, 0, 'Térreo'), ($1, 3, '3º andar')
       ON CONFLICT DO NOTHING`,
      [projectId]
    );

    ownerToken = mintToken({ orgId: ownOrgId, orgRole: 'owner' });
    viewerToken = mintToken({ orgId: ownOrgId, orgRole: 'viewer' });
    // O ADMIN PRECISA EXISTIR NO BANCO (fase F6): o predicado de leitura do 360
    // resolve o papel a partir do UUID em vez de aceitar o booleano do token, entao
    // um `sub` sem linha em `users` e um token valido que nao e admin — que e a
    // propriedade desejada. Repare que `mintToken` usa por padrao um sub que nem
    // sequer e UUID, o que tornava a falha ainda mais silenciosa.
    const adminId = crypto.randomUUID();
    await db.query(
      `INSERT INTO users (id, username, password_hash, nome, role, organization_id)
       VALUES ($1, $2, 'x', 'Admin cal', 'admin', $3)`,
      [adminId, `sv360cal_admin_${adminId.slice(0, 8)}`, otherOrgId]
    );
    adminToken = mintToken({ orgId: otherOrgId, orgRole: 'viewer', role: 'admin', sub: adminId });
    crossOrgToken = mintToken({ orgId: otherOrgId, orgRole: 'editor' });
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  after(async () => {
    await cleanup();
    await db.query(`DELETE FROM sv360.project_floors WHERE project_id = $1`, [projectId]);
    await db.query(`DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])`, [
      [projectId, hiddenProjectId],
    ]);
    // O admin criado no `before` referencia uma das OMs, e o FK bloqueia o DELETE
    // dela. Isolado o arquivo passava assim mesmo (o erro cai num after-hook que
    // ninguém lê); na suíte completa ele derruba a suíte inteira.
    await db.query(`DELETE FROM users WHERE organization_id = ANY($1::uuid[])`, [[ownOrgId, otherOrgId]]);
    await db.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [
      [ownOrgId, otherOrgId],
    ]);
    await teardownTestEnv(db);
  });

  async function seed() {
    const insert = `
      INSERT INTO sv360.photos
        (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
         heading, mesh_rotation_x, mesh_rotation_y, mesh_rotation_z,
         floor_level, floor_label, calibration_reviewed, calibration_source, capture_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `;
    // p1: the origin of every /nearby query. Ground floor.
    await db.query(insert, [p1, projectId, 'c-foto001.jpg', 'C Foto 001', 1,
      LAT0, LON0, 100, 10, 1, 2, 3, 0, 'Térreo', true, 'sol', '2026-03-01T10:00:00Z']);
    // p2: 20 m north, ground, ALREADY linked from p1 (must not be offered again).
    await db.query(insert, [p2, projectId, 'c-foto002.jpg', 'C Foto 002', 2,
      LAT0 + D_LAT, LON0, 100, 20, 0, 0, 0, 0, 'Térreo', false, null, null]);
    // p3: 20 m east, ground, linked from p1 but HIDDEN. A hidden link is STILL a
    // link, so /nearby must not offer it again (the origin filters the targets
    // table with no regard for `hidden`); it is what include_hidden reveals.
    await db.query(insert, [p3, projectId, 'c-foto003.jpg', 'C Foto 003', 3,
      LAT0, LON0 + D_LON, 100, 30, 0, 0, 0, 0, 'Térreo', false, null, null]);
    // p4: essentially ON TOP of p1 (2 m away in plan) but on floor 3, 12 m up. The
    // whole reason the floor filter exists.
    await db.query(insert, [p4, projectId, 'c-foto004.jpg', 'C Foto 004', 4,
      LAT0 + 0.000018, LON0, 112, 40, 0, 0, 0, 3, '3º andar', false, null, null]);
    // p5: ground, 20 m south, but TOMBSTONED — must appear nowhere.
    await db.query(insert, [p5, projectId, 'c-foto005.jpg', 'C Foto 005', 5,
      LAT0 - D_LAT, LON0, 100, 50, 0, 0, 0, 0, 'Térreo', false, null, null]);
    await db.query(`INSERT INTO sv360.deleted_photos (photo_id) VALUES ($1)
                    ON CONFLICT DO NOTHING`, [p5]);
    // p6: 20 m west, ground, UNLINKED — the one legitimate candidate on this floor.
    await db.query(insert, [p6, projectId, 'c-foto006.jpg', 'C Foto 006', 6,
      LAT0, LON0 - D_LON, 100, 60, 0, 0, 0, 0, 'Térreo', false, null, null]);

    // One photo in the hidden project, far enough not to disturb /nearest here.
    await db.query(insert, [ph1, hiddenProjectId, 'h-foto001.jpg', 'H Foto 001', 1,
      LAT0 + 5, LON0 + 5, 10, 0, 0, 0, 0, 0, null, false, null, null]);

    // p1 -> p2 visible, p1 -> p3 HIDDEN. The hidden one is what proves both
    // include_hidden and the "not yet linked" filter of /nearby.
    await db.query(
      `INSERT INTO sv360.targets (source_id, target_id, distance_m, bearing_deg, is_next, is_original, hidden)
       VALUES ($1, $2, 20, 0, true, true, false), ($1, $3, 20, 90, false, false, true)`,
      [p1, p2, p3]
    );

    // A capture run over p1 and p2 ONLY. sv360.capture_runs is empty in production
    // (nothing derives runs yet), so the run endpoints can only be exercised with
    // a seeded row — and without one their tests would prove nothing but the 404.
    const run = await db.query(
      `INSERT INTO sv360.capture_runs (project_id, session_key, label, ordinal, photo_count)
       VALUES ($1, 'ts:2026-03-01T10:00:00', '10:00:00', 1, 2) RETURNING id`,
      [projectId]
    );
    runId = run.rows[0].id;
    await db.query(`UPDATE sv360.photos SET run_id = $1, run_position = 1 WHERE id = $2`, [runId, p1]);
    await db.query(`UPDATE sv360.photos SET run_id = $1, run_position = 2 WHERE id = $2`, [runId, p2]);
  }

  async function cleanup() {
    const ids = [p1, p2, p3, p4, p5, p6, ph1];
    await db.query(`DELETE FROM sv360.targets WHERE source_id = ANY($1) OR target_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM sv360.photos WHERE project_id = ANY($1::uuid[])`, [
      [projectId, hiddenProjectId],
    ]);
    await db.query(`DELETE FROM sv360.capture_runs WHERE project_id = $1`, [projectId]);
  }

  // ==========================================================================
  // ROTA 1 — GET /photos/nearest
  // ==========================================================================

  it('rota 1: nearest returns { photo } with the sv360 vocabulary plus the floor', async () => {
    const res = await supertest(app)
      .get(url(`/photos/nearest?lon=${LON0}&lat=${LAT0}`))
      .expect(200);

    // The envelope IS the contract: the client reads `body.photo`.
    assert.ok(res.body.photo, 'response must be wrapped in { photo }');
    const f = res.body.photo;
    assert.equal(f.id, p1);
    // DESTINATION vocabulary. The origin says photo_uuid / nome_img / project /
    // seq; none of those may appear here.
    for (const k of ['id', 'img', 'display_name', 'lon', 'lat', 'ele', 'projectSlug',
      'sequence_number', 'distance', 'floor_level', 'floor_label']) {
      assert.ok(k in f, `missing key ${k}`);
    }
    for (const k of ['photo_uuid', 'nome_img', 'project', 'seq']) {
      assert.ok(!(k in f), `origin vocabulary leaked: ${k}`);
    }
    assert.equal(f.projectSlug, SLUG);
    assert.equal(f.img, 'c-foto001.jpg');
    assert.equal(f.floor_level, 0);
    assert.equal(f.floor_label, 'Térreo');
    assert.ok(f.distance < 1, 'the query point is the photo itself');
  });

  it('rota 1 (ARMADILHA): nearest is NOT captured by /photos/:uuid — 404, never 422', async () => {
    // THE regression this file exists for. Declared after '/photos/:uuid', the
    // literal 'nearest' is validated as a uuid and answers 422; the pre-change
    // backend did exactly that. asserting merely "not 200" would pass on the
    // broken code, so the code itself is pinned.
    const res = await supertest(app)
      .get(url(`/photos/nearest?lon=${OCEAN.lon}&lat=${OCEAN.lat}`));

    assert.notEqual(res.status, 422, 'nearest fell through to the :uuid handler');
    assert.equal(res.status, 404);
    assert.equal(typeof res.body.error, 'string');
    assert.ok(!/GUID/i.test(res.body.error), `uuid validator ran: ${res.body.error}`);
  });

  it('rota 1: a malformed coordinate is 422, which is a different answer from 404', async () => {
    await supertest(app).get(url('/photos/nearest?lon=abc&lat=10')).expect(422);
    await supertest(app).get(url(`/photos/nearest?lat=${LAT0}`)).expect(422);
  });

  it('rota 1: never returns a photo of a project the caller may not see', async () => {
    // Query point sits on the hidden project's photo.
    const anon = await supertest(app)
      .get(url(`/photos/nearest?lon=${LON0 + 5}&lat=${LAT0 + 5}`));
    assert.notEqual(anon.body?.photo?.id, ph1, 'anon reached a disabled project');

    const owner = await supertest(app)
      .get(url(`/photos/nearest?lon=${LON0 + 5}&lat=${LAT0 + 5}`))
      .set(...bearer(crossOrgToken))
      .expect(200);
    assert.equal(owner.body.photo.id, ph1, 'the owning org must see its own hidden project');
  });

  // ==========================================================================
  // ROTA 2 — GET /photos/:uuid/nearby
  // ==========================================================================

  it('rota 2: nearby defaults to the source floor and hides linked/tombstoned photos', async () => {
    const res = await supertest(app)
      .get(url(`/photos/${p1}/nearby?radius=100`))
      .expect(200);

    const ids = res.body.photos.map((x) => x.id);
    assert.deepEqual(ids, [p6], 'only the unlinked same-floor photo may be offered');
    // p2 is a VISIBLE target of p1; p3 is a HIDDEN one and still counts as linked;
    // p4 is 2 m away but on floor 3; p5 is tombstoned.
    assert.ok(!ids.includes(p2) && !ids.includes(p3));
    assert.ok(!ids.includes(p4) && !ids.includes(p5));

    const c = res.body.photos[0];
    assert.equal(c.floor_level, 0);
    assert.equal(c.floor_label, 'Térreo');
    assert.ok(c.distance > 15 && c.distance < 25, `distance out of range: ${c.distance}`);
    assert.equal(c.distance3d, c.distance, 'same elevation: 3D equals the plan distance');
    assert.ok(c.bearing > 260 && c.bearing < 280, `west bearing expected: ${c.bearing}`);
  });

  it('rota 2: floor=all offers the photo on another floor, and says which floor it is', async () => {
    const res = await supertest(app)
      .get(url(`/photos/${p1}/nearby?radius=100&floor=all`))
      .expect(200);

    const ids = res.body.photos.map((x) => x.id);
    assert.ok(ids.includes(p4), 'floor=all must cross the level (stairs, tunnels)');
    assert.ok(ids.includes(p6), 'dropping the floor filter must not drop same-floor candidates');
    assert.ok(!ids.includes(p3), 'a hidden link is still a link, on any floor');

    const alto = res.body.photos.find((x) => x.id === p4);
    assert.equal(alto.floor_level, 3, 'the level is what makes the filter auditable');
    assert.equal(alto.floor_label, '3º andar');
    // The trap the label exists for: 2 m away IN PLAN, 12 m of it vertical.
    assert.ok(alto.distance < 5, `plan distance misleads across floors: ${alto.distance}`);
    assert.ok(alto.distance3d > 11, `3D must add the height: ${alto.distance3d}`);
  });

  it('rota 2: floor=<n> pins one level', async () => {
    const res = await supertest(app)
      .get(url(`/photos/${p1}/nearby?radius=100&floor=3`))
      .expect(200);
    assert.deepEqual(res.body.photos.map((x) => x.id), [p4]);
  });

  it('rota 2: an out-of-range radius is CLAMPED, not rejected (the origin clamps)', async () => {
    // Rejecting would break a caller the origin has always served.
    await supertest(app).get(url(`/photos/${p1}/nearby?radius=999999`)).expect(200);
    const neg = await supertest(app).get(url(`/photos/${p1}/nearby?radius=-5`)).expect(200);
    // Clamped to 1 m: nothing is that close, so the list is empty rather than
    // silently full (a negative radius must not read as "no neighbours" by luck).
    assert.deepEqual(neg.body.photos, []);
  });

  it('rota 2: a photo of a hidden project is 404, never 403', async () => {
    const res = await supertest(app).get(url(`/photos/${ph1}/nearby`)).expect(404);
    assert.equal(typeof res.body.error, 'string');
  });

  // ==========================================================================
  // ROTA 3 — GET /projects/:slug/photos
  // ==========================================================================

  it('rota 3: lists the live photos in sequence order with the review counters', async () => {
    const res = await supertest(app).get(url(`/projects/${SLUG}/photos`)).expect(200);

    assert.deepEqual(res.body.photos.map((x) => x.id), [p1, p2, p3, p4, p6],
      'tombstoned p5 must be absent and the order is sequence_number');
    assert.deepEqual(res.body.reviewStats, { total: 5, reviewed: 1 });

    const first = res.body.photos[0];
    assert.equal(first.sequence_number, 1); // destination vocabulary, never `seq`
    assert.equal(first.display_name, 'C Foto 001');
    assert.equal(first.reviewed, true);
    assert.equal(first.calibrationSource, 'sol');
    assert.equal(first.runPosition, 1);
    assert.ok(first.capturedAt, 'capture_date is served as capturedAt');
  });

  it('rota 3: a hidden project is 404, and 404 also covers an unknown slug', async () => {
    await supertest(app).get(url(`/projects/${HIDDEN_SLUG}/photos`)).expect(404);
    await supertest(app).get(url('/projects/nao-existe-cal/photos')).expect(404);
    // The owning org sees its own hidden project.
    await supertest(app)
      .get(url(`/projects/${HIDDEN_SLUG}/photos`))
      .set(...bearer(crossOrgToken))
      .expect(200);
  });

  // ==========================================================================
  // ROTA 4 — GET /projects/review-stats
  // ==========================================================================

  it('rota 4 (ARMADILHA): review-stats is NOT captured by /projects/:slug', async () => {
    // The pre-change backend answered 404 'Project not found' here: the literal
    // was matched as a slug. Pinning the 200 AND the absence of that message.
    const res = await supertest(app).get(url('/projects/review-stats')).expect(200);
    assert.ok(res.body.stats, 'response must be wrapped in { stats }');
    assert.deepEqual(res.body.stats[SLUG], { total: 5, reviewed: 1 });
    assert.equal(res.body.error, undefined);
  });

  it('rota 4: a disabled project appears only for who may see it', async () => {
    const anon = await supertest(app).get(url('/projects/review-stats')).expect(200);
    assert.equal(anon.body.stats[HIDDEN_SLUG], undefined, 'anon must not learn it exists');

    const owner = await supertest(app)
      .get(url('/projects/review-stats'))
      .set(...bearer(crossOrgToken))
      .expect(200);
    assert.deepEqual(owner.body.stats[HIDDEN_SLUG], { total: 1, reviewed: 0 });

    const admin = await supertest(app)
      .get(url('/projects/review-stats'))
      .set(...bearer(adminToken))
      .expect(200);
    assert.ok(admin.body.stats[HIDDEN_SLUG], 'a global admin sees every project');
  });

  // ==========================================================================
  // ROTA 5 — GET /projects/:slug/map
  // ==========================================================================

  it('rota 5: map returns the photos with their three angles, the track and the bounds', async () => {
    await db.query(
      `INSERT INTO sv360.tracks (project_id, geom)
       VALUES ($1, ST_SetSRID(ST_MakeLine(ARRAY[
         ST_MakePoint($2::double precision, $3::double precision),
         ST_MakePoint($4::double precision, $5::double precision)]), 4326))`,
      [projectId, LON0, LAT0, LON0 + D_LON, LAT0 + D_LAT]
    );

    const res = await supertest(app).get(url(`/projects/${SLUG}/map`)).expect(200);

    assert.equal(res.body.slug, SLUG);
    assert.deepEqual(res.body.photos.map((x) => x.id), [p1, p2, p3, p4, p6]);

    const one = res.body.photos[0];
    assert.equal(one.mesh_rotation_x, 1);
    assert.equal(one.mesh_rotation_y, 2);
    assert.equal(one.mesh_rotation_z, 3);
    assert.equal(one.reviewed, true);
    assert.equal(one.floor_level, 0);
    assert.equal(one.seq, undefined, 'origin vocabulary must not leak');

    // Separate stretches, never a single joined polyline.
    assert.equal(res.body.track.length, 1);
    assert.equal(res.body.track[0].length, 2);
    assert.equal(res.body.track[0][0][0], LON0);

    const [minLon, minLat, maxLon, maxLat] = res.body.bounds;
    assert.ok(minLon <= LON0 && maxLon >= LON0 + D_LON);
    assert.ok(minLat <= LAT0 && maxLat >= LAT0 + D_LAT);
    assert.deepEqual(res.body.reviewStats, { total: 5, reviewed: 1 });

    await db.query(`DELETE FROM sv360.tracks WHERE project_id = $1`, [projectId]);
  });

  it('rota 5: a project with no track answers an EMPTY track, not an error', async () => {
    const res = await supertest(app).get(url(`/projects/${SLUG}/map`)).expect(200);
    assert.deepEqual(res.body.track, [], 'no track drawn is not a failure to load one');
  });

  it('rota 5: a hidden project is 404', async () => {
    await supertest(app).get(url(`/projects/${HIDDEN_SLUG}/map`)).expect(404);
  });

  // ==========================================================================
  // ROTA 6 — GET /projects/:slug/runs
  // ==========================================================================

  it('rota 6: lists the runs with per-run progress', async () => {
    const res = await supertest(app).get(url(`/projects/${SLUG}/runs`)).expect(200);
    assert.equal(res.body.runs.length, 1);
    const r = res.body.runs[0];
    assert.equal(r.id, runId);
    assert.equal(r.ordinal, 1);
    assert.equal(r.total, 2, 'p1 and p2 are in the run');
    assert.equal(r.reviewed, 1, 'only p1 is reviewed');
    assert.deepEqual(r.applied, {
      mesh_rotation_y: null, mesh_rotation_x: null, mesh_rotation_z: null,
    });
  });

  it('rota 6: a project WITHOUT runs answers an empty list, never 404', async () => {
    // This is the state of the ENTIRE production archive: sv360.capture_runs
    // exists (migration 013) but nothing derives runs yet. An empty list is the
    // honest answer; 404 would make the panel look broken on a healthy database.
    await db.query(`UPDATE sv360.photos SET run_id = NULL WHERE project_id = $1`, [projectId]);
    await db.query(`DELETE FROM sv360.capture_runs WHERE project_id = $1`, [projectId]);
    const res = await supertest(app).get(url(`/projects/${SLUG}/runs`)).expect(200);
    assert.deepEqual(res.body.runs, []);
  });

  it('rota 6: an unknown or hidden project is still 404', async () => {
    await supertest(app).get(url('/projects/nao-existe-cal/runs')).expect(404);
    await supertest(app).get(url(`/projects/${HIDDEN_SLUG}/runs`)).expect(404);
  });

  // ==========================================================================
  // ROTA 7 — PUT /runs/:runId/batch-calibration
  // ==========================================================================

  it('rota 7: applies one default to the run ONLY, and records it on the run', async () => {
    const res = await supertest(app)
      .put(url(`/runs/${runId}/batch-calibration`))
      .set(...bearer(ownerToken))
      .send({ mesh_rotation_y: 337, mesh_rotation_z: 2.5 })
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.equal(res.body.label, '10:00:00');
    assert.equal(res.body.updated.mesh_rotation_y.photosUpdated, 2);
    assert.equal(res.body.updated.mesh_rotation_x, undefined, 'an untouched axis is absent');

    // RE-READ the destination, field by field, over the SAME extension as the write.
    const dentro = await db.query(
      `SELECT id, mesh_rotation_y, mesh_rotation_z, calibration_source
         FROM sv360.photos WHERE run_id = $1 ORDER BY run_position`,
      [runId]
    );
    assert.equal(dentro.rows.length, 2);
    for (const row of dentro.rows) {
      assert.equal(Number(row.mesh_rotation_y), 337);
      assert.equal(Number(row.mesh_rotation_z), 2.5);
      assert.equal(row.calibration_source, 'manual', 'a human value overrides sol/imu');
    }

    // The photos OUTSIDE the run must be untouched: a batch that spills is the
    // failure mode that no aggregate would show.
    const fora = await db.query(
      `SELECT mesh_rotation_y FROM sv360.photos WHERE id = ANY($1)`, [[p3, p4, p6]]
    );
    assert.equal(fora.rows.length, 3, 'every out-of-run photo must be present to be checked');
    for (const row of fora.rows) assert.equal(Number(row.mesh_rotation_y), 0);

    // applied_* is a RECORD; the axis this batch did not touch keeps its value.
    const run = await db.query(
      `SELECT applied_rotation_y, applied_rotation_x, applied_rotation_z
         FROM sv360.capture_runs WHERE id = $1`, [runId]
    );
    assert.equal(Number(run.rows[0].applied_rotation_y), 337);
    assert.equal(Number(run.rows[0].applied_rotation_z), 2.5);
    assert.equal(run.rows[0].applied_rotation_x, null);
  });

  it('rota 7: a second batch on another axis does NOT erase the first record', async () => {
    await supertest(app).put(url(`/runs/${runId}/batch-calibration`))
      .set(...bearer(ownerToken)).send({ mesh_rotation_y: 337 }).expect(200);
    await supertest(app).put(url(`/runs/${runId}/batch-calibration`))
      .set(...bearer(ownerToken)).send({ mesh_rotation_z: 4 }).expect(200);
    const run = await db.query(
      `SELECT applied_rotation_y, applied_rotation_z FROM sv360.capture_runs WHERE id = $1`,
      [runId]
    );
    assert.equal(Number(run.rows[0].applied_rotation_y), 337, 'COALESCE must preserve it');
    assert.equal(Number(run.rows[0].applied_rotation_z), 4);
  });

  it('rota 7: anonymous is 401, a same-org viewer is 403, an unknown run is 404', async () => {
    await supertest(app).put(url(`/runs/${runId}/batch-calibration`))
      .send({ mesh_rotation_y: 10 }).expect(401);
    await supertest(app).put(url(`/runs/${runId}/batch-calibration`))
      .set(...bearer(viewerToken)).send({ mesh_rotation_y: 10 }).expect(403);
    await supertest(app).put(url('/runs/3f2504e0-4f89-41d3-9a0c-0305e82c3301/batch-calibration'))
      .set(...bearer(ownerToken)).send({ mesh_rotation_y: 10 }).expect(404);
    // Nothing may have been written by any of the three.
    const { rows } = await db.query(
      `SELECT mesh_rotation_y FROM sv360.photos WHERE id = $1`, [p1]
    );
    assert.equal(Number(rows[0].mesh_rotation_y), 2);
  });

  it('rota 7: a value outside the origin range is refused', async () => {
    // Ranges read from ebgeo_360 LIMITES_ROTACAO, not guessed.
    await supertest(app).put(url(`/runs/${runId}/batch-calibration`))
      .set(...bearer(ownerToken)).send({ mesh_rotation_x: 45 }).expect(422);
    await supertest(app).put(url(`/runs/${runId}/batch-calibration`))
      .set(...bearer(ownerToken)).send({}).expect(422);
  });

  // ==========================================================================
  // ROTA 8 — POST /projects/:slug/reset-reviewed
  // ==========================================================================

  it('rota 8: clears the review flag of every live photo and leaves the tombstoned one alone', async () => {
    await db.query(`UPDATE sv360.photos SET calibration_reviewed = true
                     WHERE project_id = $1`, [projectId]);

    const res = await supertest(app)
      .post(url(`/projects/${SLUG}/reset-reviewed`))
      .set(...bearer(ownerToken))
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.photosReset, 5, 'the tombstoned photo is not part of the project');

    const { rows } = await db.query(
      `SELECT id, calibration_reviewed FROM sv360.photos WHERE project_id = $1 ORDER BY sequence_number`,
      [projectId]
    );
    // Same EXTENSION as the write: 4 cleared, and the 5th (tombstoned) untouched.
    assert.equal(rows.filter((r) => r.calibration_reviewed === false).length, 5);
    assert.equal(rows.find((r) => r.id === p5).calibration_reviewed, true);
  });

  it('rota 8: anonymous is 401, a same-org viewer is 403, a hidden project is 404', async () => {
    await supertest(app).post(url(`/projects/${SLUG}/reset-reviewed`)).expect(401);
    await supertest(app).post(url(`/projects/${SLUG}/reset-reviewed`))
      .set(...bearer(viewerToken)).expect(403);
    // Hidden from this caller: 404, never 403 — no existence leak.
    await supertest(app).post(url(`/projects/${HIDDEN_SLUG}/reset-reviewed`))
      .set(...bearer(ownerToken)).expect(404);
    const { rows } = await db.query(
      `SELECT calibration_reviewed FROM sv360.photos WHERE id = $1`, [p1]
    );
    assert.equal(rows[0].calibration_reviewed, true, 'no refused call may have written');
  });

  // ==========================================================================
  // ROTA 9 — PUT /projects/:slug/batch-calibration
  // ==========================================================================

  it('rota 9: applies one default to every live photo of the project', async () => {
    const res = await supertest(app)
      .put(url(`/projects/${SLUG}/batch-calibration`))
      .set(...bearer(ownerToken))
      .send({ mesh_rotation_y: 123.4, mesh_rotation_x: -5 })
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.equal(res.body.updated.mesh_rotation_y.photosUpdated, 5);
    assert.equal(res.body.updated.mesh_rotation_x.value, -5);

    const { rows } = await db.query(
      `SELECT id, mesh_rotation_y, mesh_rotation_x, calibration_source
         FROM sv360.photos WHERE project_id = $1 ORDER BY sequence_number`, [projectId]
    );
    const vivas = rows.filter((r) => r.id !== p5);
    assert.equal(vivas.length, 5);
    for (const r of vivas) {
      assert.equal(Number(r.mesh_rotation_y), 123.4);
      assert.equal(Number(r.mesh_rotation_x), -5);
      assert.equal(r.calibration_source, 'manual');
    }
    const morta = rows.find((r) => r.id === p5);
    assert.equal(Number(morta.mesh_rotation_y), 0, 'a tombstoned photo is not written');
    assert.equal(morta.calibration_source, null);
  });

  it('rota 9: refuses a value outside the origin range, and an empty body', async () => {
    for (const body of [{ mesh_rotation_y: 361 }, { mesh_rotation_x: 45 },
      { mesh_rotation_z: -31 }, {}]) {
      await supertest(app).put(url(`/projects/${SLUG}/batch-calibration`))
        .set(...bearer(ownerToken)).send(body).expect(422);
    }
    const { rows } = await db.query(
      `SELECT mesh_rotation_y FROM sv360.photos WHERE id = $1`, [p1]
    );
    assert.equal(Number(rows[0].mesh_rotation_y), 2, 'a 422 must not have written');
  });

  it('rota 9: anonymous is 401, a same-org viewer is 403, a hidden project is 404', async () => {
    await supertest(app).put(url(`/projects/${SLUG}/batch-calibration`))
      .send({ mesh_rotation_y: 10 }).expect(401);
    await supertest(app).put(url(`/projects/${SLUG}/batch-calibration`))
      .set(...bearer(viewerToken)).send({ mesh_rotation_y: 10 }).expect(403);
    await supertest(app).put(url(`/projects/${HIDDEN_SLUG}/batch-calibration`))
      .set(...bearer(ownerToken)).send({ mesh_rotation_y: 10 }).expect(404);
  });

  it('rota 9: a global admin may write a project of another organization', async () => {
    await supertest(app).put(url(`/projects/${SLUG}/batch-calibration`))
      .set(...bearer(adminToken)).send({ mesh_rotation_y: 90 }).expect(200);
    const { rows } = await db.query(
      `SELECT mesh_rotation_y FROM sv360.photos WHERE id = $1`, [p1]
    );
    assert.equal(Number(rows[0].mesh_rotation_y), 90);
  });

  // ==========================================================================
  // ROTA 10 — GET /photos/:uuid?include_hidden=true
  // ==========================================================================

  it('rota 10: include_hidden adds the hidden links, and the default read never carries the key', async () => {
    const visivel = await supertest(app).get(url(`/photos/${p1}`)).expect(200);
    const todos = await supertest(app).get(url(`/photos/${p1}?include_hidden=true`)).expect(200);

    // The COUNT is the measure: 1 visible link, 2 in total, 1 of them hidden.
    assert.equal(visivel.body.targets.length, 1);
    assert.equal(todos.body.targets.length, 2);
    assert.equal(todos.body.targets.filter((t) => t.hidden).length, 1);

    // Absent by default, so the frozen shape of the viewer does not move.
    assert.ok(!('hidden' in visivel.body.targets[0]), 'hidden must not leak into the default read');
    assert.equal(visivel.body.targets[0].id, p2);

    const oculto = todos.body.targets.find((t) => t.id === p3);
    assert.equal(oculto.hidden, true);
    // Every other field of the frozen shape still travels with a hidden link,
    // otherwise the operator cannot decide whether to bring it back.
    for (const k of ['id', 'img', 'lon', 'lat', 'display_name', 'distance', 'bearing']) {
      assert.ok(k in oculto, `missing key ${k}`);
    }

    // The camera block is byte-identical either way: the flag only touches targets.
    assert.deepEqual(todos.body.camera, visivel.body.camera);
  });

  it('rota 10: include_hidden never shows a link to a tombstoned photo', async () => {
    await db.query(
      `INSERT INTO sv360.targets (source_id, target_id, distance_m, bearing_deg, hidden)
       VALUES ($1, $2, 20, 180, true)`, [p1, p5]
    );
    const res = await supertest(app).get(url(`/photos/${p1}?include_hidden=true`)).expect(200);
    const ids = res.body.targets.map((t) => t.id);
    assert.ok(!ids.includes(p5), 'a link to a deleted photo is unusable, hidden or not');
    assert.equal(ids.length, 2);
  });

  it('rota 10: the flag does not weaken the access rule', async () => {
    await supertest(app).get(url(`/photos/${ph1}?include_hidden=true`)).expect(404);
  });
});

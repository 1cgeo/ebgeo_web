// Path: tests/integration/sv360-floors.test.js
// StreetView 360 — ANDARES (migration 007_sv360.sql):
//   GET /api/v1/sv360/projects/:slug/floors,
//   the `floor_level` / `floor_label` attributes on the MVT 'fotos' layer,
//   `camera.floor_label` and `targets[].floor_level` / `targets[].floor_label`
//   in the frozen photoMetadataShape.
//
// WHY targets[].floor_level IS ITS OWN ASSERTION and not folded into the photo
// contract test: it is the field the floor-change marker is computed from. The
// client compares the target's level with the current photo's; with the field
// absent it falls back to zero and simply never draws the marker. That failure
// has no error, no log and no wrong number anywhere — only a staircase that is
// not on screen — so nothing but a test that names the key catches it.
//
// Fixture: default org + a 2nd org. An ENABLED project with THREE floors
// (level 0 with NO plan, level 1 with a plan, level 2 declared but with no photo)
// and three photos, plus a tombstoned one on level 1 so the photoCount is proven
// to exclude it. A FLAT enabled project (no floors) proves the `{floors: []}` +
// 200 contract. A DISABLED project of the 2nd org proves the read rule is the one
// the sibling project routes use (404 for anon, visible to admin).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// lon/lat -> slippy-map tile (z/x/y), the scheme MapLibre requests.
function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

const LON = -51.2365;
const LAT = -30.0663;
const Z = 14;
const { x: TX, y: TY } = lonLatToTile(LON, LAT, Z);

const SLUG = 'proj-floors-sv360';
const FLAT_SLUG = 'proj-flat-sv360';
const HIDDEN_SLUG = 'proj-floors-hidden-sv360';

const terreoId = uuidv5('default/proj-floors-sv360/terreo.jpg');
const andar1Id = uuidv5('default/proj-floors-sv360/andar1.jpg');
const andar1bId = uuidv5('default/proj-floors-sv360/andar1b.jpg');
const tombId = uuidv5('default/proj-floors-sv360/tomb.jpg');

// A plan is a LIST of LineStrings, [[[lon,lat],...],...] — the storage shape of
// project_floors.plan_coords (JSONB) and of the origin's TEXT-with-JSON column.
const PLAN_L1 = [
  [
    [LON, LAT],
    [LON + 0.0004, LAT],
    [LON + 0.0004, LAT + 0.0004],
  ],
  [
    [LON + 0.001, LAT + 0.001],
    [LON + 0.0014, LAT + 0.001],
  ],
];

function fetchTile(app, z, x, y, token) {
  let req = supertest(app).get(`/api/v1/sv360/tiles/${z}/${x}/${y}.pbf`);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  return req.buffer().parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

function decodeTile(buf) {
  const tile = new VectorTile(new PbfReader(buf));
  const out = {};
  for (const name of Object.keys(tile.layers)) {
    const layer = tile.layers[name];
    out[name] = [];
    for (let i = 0; i < layer.length; i++) out[name].push(layer.feature(i).properties);
  }
  return out;
}

describe('StreetView 360 — andares (floors)', () => {
  let app, db;
  let defaultOrgId, secondOrgId, projectId, flatProjectId, hiddenProjectId;
  let adminToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;

    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla)
       VALUES ('Outra OM Floors', 'sv360-floors-other-om', 'OUTRAF')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`
    );
    secondOrgId = org2.rows[0].id;

    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Projeto com andares', $3, $4, $5, 'enabled', 3) RETURNING id`,
      [defaultOrgId, SLUG, LAT, LON, `${SLUG}.db`]
    );
    projectId = proj.rows[0].id;

    const flat = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Projeto plano', $3, $4, $5, 'enabled', 0) RETURNING id`,
      [defaultOrgId, FLAT_SLUG, LAT, LON, `${FLAT_SLUG}.db`]
    );
    flatProjectId = flat.rows[0].id;

    const hidden = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Projeto oculto', $3, $4, $5, 'disabled', 0) RETURNING id`,
      [secondOrgId, HIDDEN_SLUG, LAT, LON, `${HIDDEN_SLUG}.db`]
    );
    hiddenProjectId = hidden.rows[0].id;

    // Floors: level 0 has NO plan (an outdoor ground level is the real case),
    // level 1 has one, level 2 is declared but has no photo at all.
    await db.query(
      `INSERT INTO sv360.project_floors (project_id, level, label, plan_coords)
       VALUES ($1, 0, 'Térreo', NULL),
              ($1, 1, '1º andar', $2::jsonb),
              ($1, 2, '2º andar', NULL)`,
      [projectId, JSON.stringify(PLAN_L1)]
    );
    // Inserted OUT OF ORDER on purpose so the ascending sort is proven, not assumed.
    await db.query(
      `INSERT INTO sv360.project_floors (project_id, level, label, plan_coords)
       VALUES ($1, -1, '1º subsolo', NULL)`,
      [projectId]
    );

    // Photos: 1 on level 0, 2 on level 1 (one of them tombstoned), none on 2/-1.
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          heading, floor_level, floor_label)
       VALUES ($1, $2, 'terreo.jpg', 'Terreo', 1, $3, $4, 10, 0, 0, 'Externo')`,
      [terreoId, projectId, LAT, LON]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          heading, floor_level, floor_label)
       VALUES ($1, $2, 'andar1.jpg', 'Andar 1', 2, $3, $4, 14, 0, 1, '1º andar')`,
      [andar1Id, projectId, LAT + 0.0002, LON + 0.0002]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          heading, floor_level, floor_label)
       VALUES ($1, $2, 'andar1b.jpg', 'Andar 1b', 3, $3, $4, 14, 0, 1, '1º andar')`,
      [andar1bId, projectId, LAT + 0.0004, LON + 0.0004]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          heading, floor_level, floor_label)
       VALUES ($1, $2, 'tomb.jpg', 'Tomb', 4, $3, $4, 14, 0, 1, '1º andar')`,
      [tombId, projectId, LAT + 0.0006, LON + 0.0006]
    );
    await db.query(`INSERT INTO sv360.deleted_photos (photo_id) VALUES ($1)`, [tombId]);

    // The link that crosses floors: terreo -> andar1. It is what the viewer turns
    // into the floor-change marker.
    await db.query(
      `INSERT INTO sv360.targets
         (source_id, target_id, distance_m, bearing_deg, is_next, is_original, hidden)
       VALUES ($1, $2, 12.5, 90, true, true, false)`,
      [terreoId, andar1Id]
    );

    // O ADMIN PRECISA EXISTIR NO BANCO, e essa exigencia e nova (fase F6).
    // O predicado de leitura do 360 deixou de receber um `isAdmin` calculado no JS
    // e passou a resolver o papel a partir do UUID (`fn_has_global_data_access`).
    // Um token forjado com `sub` sem linha em `users` continua sendo um token
    // valido e deixou de ser um admin — que e exatamente a propriedade desejada:
    // o token sozinho nao concede mais nada.
    const adminId = crypto.randomUUID();
    await db.query(
      `INSERT INTO users (id, username, password_hash, nome, role, organization_id)
       VALUES ($1, $2, 'x', 'Admin 360', 'admin', $3)`,
      [adminId, `sv360_admin_${adminId.slice(0, 8)}`, defaultOrgId]
    );
    adminToken = jwt.sign(
      { sub: adminId, role: 'admin', organization_id: defaultOrgId, org_role: 'admin' },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: '5m' }
    );
  });

  after(async () => {
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = $1`, [tombId]);
    await db.query(`DELETE FROM sv360.targets WHERE source_id = $1`, [terreoId]);
    await db.query(`DELETE FROM sv360.photos WHERE project_id = $1::uuid`, [projectId]);
    await db.query(`DELETE FROM sv360.project_floors WHERE project_id = $1::uuid`, [projectId]);
    await db.query(`DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])`, [
      [projectId, flatProjectId, hiddenProjectId],
    ]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [secondOrgId]);
    await teardownTestEnv(db);
  });

  // --- GET /projects/:slug/floors -------------------------------------------

  it('lists the floors ascending by level, with photoCount and the plan', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/projects/${SLUG}/floors`)
      .expect(200);

    assert.ok(Array.isArray(res.body.floors), 'the payload is wrapped in { floors: [...] }');
    assert.deepEqual(
      res.body.floors.map((f) => f.level),
      [-1, 0, 1, 2],
      'ascending by level, basement first'
    );

    const byLevel = Object.fromEntries(res.body.floors.map((f) => [f.level, f]));
    assert.equal(byLevel[0].label, 'Térreo');
    assert.equal(byLevel[1].label, '1º andar');

    // photoCount EXCLUDES the tombstoned photo: level 1 has 3 rows, 2 visible.
    assert.equal(byLevel[0].photoCount, 1);
    assert.equal(byLevel[1].photoCount, 2, 'the tombstoned photo must not be counted');
    // A declared floor with no photo stays in the list with a zero count — losing
    // it would make the selector shrink as photos are deleted.
    assert.equal(byLevel[2].photoCount, 0);
    assert.equal(byLevel[-1].photoCount, 0);
  });

  it('renders the plan as a GeoJSON FeatureCollection of LineString stamped with the level', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/projects/${SLUG}/floors`)
      .expect(200);
    const byLevel = Object.fromEntries(res.body.floors.map((f) => [f.level, f]));

    // A level with no plan drawn is null, NOT an empty FeatureCollection.
    assert.equal(byLevel[0].plan, null);
    assert.equal(byLevel[2].plan, null);

    const plan = byLevel[1].plan;
    assert.equal(plan.type, 'FeatureCollection');
    assert.equal(plan.features.length, 2, 'one Feature per LineString of the stored plan');
    for (const f of plan.features) {
      assert.equal(f.type, 'Feature');
      assert.equal(f.geometry.type, 'LineString');
      assert.equal(f.properties.level, 1, 'every feature carries properties.level');
    }
    assert.deepEqual(plan.features[0].geometry.coordinates, PLAN_L1[0]);
  });

  it('answers { floors: [] } with 200 for a project with no floors (never 404)', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/projects/${FLAT_SLUG}/floors`)
      .expect(200);
    assert.deepEqual(res.body, { floors: [] });
  });

  it('404s an unknown slug', async () => {
    await supertest(app).get('/api/v1/sv360/projects/nao-existe-sv360/floors').expect(404);
  });

  it('404s a disabled project for anon, and serves it to an admin (same rule as /projects/:slug)', async () => {
    await supertest(app).get(`/api/v1/sv360/projects/${HIDDEN_SLUG}/floors`).expect(404);

    const asAdmin = await supertest(app)
      .get(`/api/v1/sv360/projects/${HIDDEN_SLUG}/floors`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.deepEqual(asAdmin.body, { floors: [] });
  });

  // --- MVT 'fotos' layer -----------------------------------------------------

  it('emits floor_level and floor_label on the MVT fotos layer, keeping the existing fields', async () => {
    const res = await fetchTile(app, Z, TX, TY);
    assert.equal(res.status, 200);
    const layers = decodeTile(res.body);
    const fotos = layers.fotos ?? [];
    const terreo = fotos.find((p) => p.id === terreoId);
    const andar1 = fotos.find((p) => p.id === andar1Id);
    assert.ok(terreo && andar1, 'both photos must be in the tile');

    // ADDITIVE: the fields the current client reads are untouched.
    assert.equal(terreo.projectSlug, SLUG);
    assert.equal(terreo.img, 'terreo.jpg');
    assert.equal(terreo.sequence_number, 1);

    assert.equal(terreo.floor_level, 0);
    assert.equal(terreo.floor_label, 'Externo');
    assert.equal(andar1.floor_level, 1);
    assert.equal(andar1.floor_label, '1º andar');
  });

  // --- photo metadata --------------------------------------------------------

  it('exposes camera.floor_label and the TARGET floor on GET /photos/:uuid', async () => {
    const res = await supertest(app).get(`/api/v1/sv360/photos/${terreoId}`).expect(200);

    assert.equal(res.body.camera.floor_level, 0);
    assert.equal(res.body.camera.floor_label, 'Externo');

    assert.equal(res.body.targets.length, 1);
    const t = res.body.targets[0];
    assert.equal(t.id, andar1Id);
    // The whole point: the target's level differs from the camera's, which is what
    // makes the client draw the floor-change marker instead of a plain arrow.
    assert.equal(t.floor_level, 1);
    assert.equal(t.floor_label, '1º andar');
    assert.notEqual(t.floor_level, res.body.camera.floor_level);
    // The pre-existing target fields must survive the addition.
    assert.equal(t.icon, 'next');
    assert.equal(t.distance, 12.5);
    assert.equal(t.bearing, 90);
  });

  it('keeps floor_label null on a photo that has none (a flat project has no floor to name)', async () => {
    // The FLAT project's shape is proven on a photo of the SAME fixture project
    // whose label was never written: the key must be present and null, never absent.
    await db.query(`UPDATE sv360.photos SET floor_label = NULL WHERE id = $1`, [andar1bId]);
    const res = await supertest(app).get(`/api/v1/sv360/photos/${andar1bId}`).expect(200);
    assert.ok('floor_label' in res.body.camera, 'the key must exist even when null');
    assert.equal(res.body.camera.floor_label, null);
    await db.query(`UPDATE sv360.photos SET floor_label = '1º andar' WHERE id = $1`, [andar1bId]);
  });
});

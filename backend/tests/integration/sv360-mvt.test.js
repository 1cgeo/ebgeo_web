// Path: tests/integration/sv360-mvt.test.js
// Fase 9 (Tarefa 7): StreetView 360 VECTOR TILES (MVT). The frontend now consumes
// a server-rendered vector source (PostGIS ST_AsMVT) instead of GeoJSON/PMTiles.
// One tile carries two layers: 'fotos' (points) + 'fotos_linha' (per-project
// trajectory lines, connecting a project's photos in sequence_number order).
//
// Fixture mirrors sv360-tiles.test.js: default org + a 2nd org; an ENABLED project
// (default org) with two photos in a known area (so a trajectory line exists) plus
// a tombstoned photo; a DISABLED project (2nd org) with a photo in the SAME tile.
//
// The tile is DECODED with @mapbox/vector-tile + pbf to assert real feature
// contents (which layer, which photo ids), so the access filter and the two-layer
// concatenation are verified end-to-end. Access is embedded in the SQL: anon must
// NOT see the disabled project's photo; admin/owning-org must.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { VectorTile } from '@mapbox/vector-tile';
// `pbf` v4 exports named { PbfReader, PbfWriter } (no default). PbfReader is the
// decoder VectorTile expects.
import { PbfReader } from 'pbf';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createProducerUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';

// Deterministic UUID v5 (node:crypto), fixed namespace (same as sv360-tiles).
const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// lon/lat → slippy-map tile (z/x/y), the same scheme MapLibre requests.
function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

// Seed location: both projects sit at roughly the same spot so they fall in ONE
// tile (the disabled-project leak test needs both in the same tile).
const LON = -46.6;
const LAT = -23.5;
const Z = 12;
const { x: TX, y: TY } = lonLatToTile(LON, LAT, Z);

const SLUG = 'proj-mvt-sv360';
const DB_FILENAME = `${SLUG}.db`;
const DISABLED_SLUG = 'proj-mvt-disabled-sv360';
const DISABLED_DB_FILENAME = `${DISABLED_SLUG}.db`;

const photoId = uuidv5('default/proj-mvt-sv360/foto001.jpg');
const photo2Id = uuidv5('default/proj-mvt-sv360/foto002.jpg');
const tombId = uuidv5('default/proj-mvt-sv360/tomb.jpg');
const disabledPhotoId = uuidv5('other/proj-mvt-disabled-sv360/secret.jpg');
const disabledPhoto2Id = uuidv5('other/proj-mvt-disabled-sv360/secret2.jpg');

// Decodes an MVT buffer into { [layerName]: [{ id, props, geomType }] }.
function decodeTile(buf) {
  const tile = new VectorTile(new PbfReader(buf));
  const out = {};
  for (const name of Object.keys(tile.layers)) {
    const layer = tile.layers[name];
    out[name] = [];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      out[name].push({ props: f.properties, geomType: f.type }); // type 1=point, 2=line
    }
  }
  return out;
}

describe('StreetView 360 — vector tiles (MVT, Tarefa 7)', () => {
  let app, db;
  let defaultOrgId, secondOrgId, enabledProjectId, disabledProjectId;
  let adminToken, otherOrgToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;

    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ('Outra OM MVT', 'sv360-mvt-other-om', 'OUTRAM')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`
    );
    secondOrgId = org2.rows[0].id;

    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Proj MVT', $3, $4, $5, 'enabled', 2) RETURNING id`,
      [defaultOrgId, SLUG, LAT, LON, DB_FILENAME]
    );
    enabledProjectId = proj.rows[0].id;

    const dis = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Proj MVT Disabled', $3, $4, $5, 'disabled', 2) RETURNING id`,
      [secondOrgId, DISABLED_SLUG, LAT, LON, DISABLED_DB_FILENAME]
    );
    disabledProjectId = dis.rows[0].id;

    // Enabled project: two visible photos (so a trajectory line exists) + a tomb.
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele, heading)
       VALUES ($1, $2, 'foto001.jpg', 'Foto 001', 1, $3, $4, 720, 33)`,
      [photoId, enabledProjectId, LAT, LON]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele, heading)
       VALUES ($1, $2, 'foto002.jpg', 'Foto 002', 2, $3, $4, 721, 34)`,
      [photo2Id, enabledProjectId, LAT + 0.0008, LON + 0.0008]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele)
       VALUES ($1, $2, 'tomb.jpg', 'Tombstoned', 3, $3, $4, 700)`,
      [tombId, enabledProjectId, LAT + 0.001, LON + 0.001]
    );
    await db.query(`INSERT INTO sv360.deleted_photos (photo_id) VALUES ($1)`, [tombId]);

    // Disabled project: TWO photos in the SAME tile → a valid 2-point trajectory,
    // so the line-layer access path is actually exercised (not a degenerate line).
    // Neither the points NOR the trajectory line may leak to anon.
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele)
       VALUES ($1, $2, 'secret.jpg', 'Secret', 1, $3, $4, 100)`,
      [disabledPhotoId, disabledProjectId, LAT + 0.0002, LON + 0.0002]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele)
       VALUES ($1, $2, 'secret2.jpg', 'Secret 2', 2, $3, $4, 100)`,
      [disabledPhoto2Id, disabledProjectId, LAT + 0.0006, LON + 0.0006]
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
      { sub: adminId, role: 'admin', organization_id: defaultOrgId },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: '5m' }
    );
    // A OM QUE VE O PROJETO OCULTO E A PRODUTORA, nao a de LOTACAO: `organization_id`
    // e auto-declarado no auto-cadastro, entao escolher a OM na tela de cadastro
    // entregava o acervo oculto dela. `producer_org_id` so um administrador concede, e
    // o predicado o resolve NO SQL a partir do UUID — dai o usuario de verdade.
    const produtorSegunda = await createProducerUser(db, secondOrgId, { username: `mvt_prod_${crypto.randomUUID().slice(0, 8)}` });
    otherOrgToken = jwt.sign(
      {
        sub: produtorSegunda.id, role: 'producer',
        organization_id: secondOrgId, producer_org_id: secondOrgId,
      },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: '5m' }
    );
  });

  after(async () => {
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = $1`, [tombId]);
    await db.query(`DELETE FROM sv360.photos WHERE project_id = ANY($1::uuid[])`, [
      [enabledProjectId, disabledProjectId],
    ]);
    await db.query(`DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])`, [
      [enabledProjectId, disabledProjectId],
    ]);
    // O PRODUTOR PRECISA CAIR ANTES DA OM: `users.producer_org_id` é FK sem ON DELETE,
    // então apagar a organização com um produtor de pé levanta 23503 dentro do `after`
    // — uma suíte inteiramente verde que termina vermelha por limpeza.
    await db.query('DELETE FROM public.users WHERE producer_org_id = $1', [secondOrgId]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [secondOrgId]);
    await teardownTestEnv(db);
  });

  const tileUrl = (z = Z, x = TX, y = TY) => `/api/v1/sv360/tiles/${z}/${x}/${y}.pbf`;

  // --- (a) content-type + 200 -----------------------------------------------

  it('serves the MVT with application/vnd.mapbox-vector-tile + 200 (anon)', async () => {
    const res = await supertest(app).get(tileUrl()).buffer().parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    assert.equal(res.headers['content-type'], 'application/vnd.mapbox-vector-tile');
    assert.match(res.headers['cache-control'], /max-age=60/);
    assert.ok(!/immutable/.test(res.headers['cache-control']), 'tiles are NOT immutable');
    assert.ok(Buffer.isBuffer(res.body));
  });

  it('an out-of-coverage tile returns 200 with an empty body (valid empty MVT)', async () => {
    // A tile on the far side of the world covers no seeded feature.
    const res = await fetchTile(app, Z, 0, 0);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 0);
  });

  // --- (b) enabled photo present in 'fotos' for anon -------------------------

  it("contains the enabled project's photo in the 'fotos' layer (anon)", async () => {
    const res = await fetchTile(app, Z, TX, TY);
    assert.equal(res.status, 200);
    const layers = decodeTile(res.body);
    assert.ok(layers.fotos, "'fotos' layer present");
    const ids = layers.fotos.map((f) => f.props.id);
    assert.ok(ids.includes(photoId), 'visible enabled photo present');
    const f = layers.fotos.find((x) => x.props.id === photoId);
    assert.equal(f.props.projectSlug, SLUG);
    assert.equal(f.props.img, 'foto001.jpg');
    assert.equal(f.props.sequence_number, 1);
    assert.equal(f.geomType, 1, 'point geometry');
  });

  // --- (c) disabled project does NOT leak to anon, but DOES to admin/org -----

  it("does NOT leak the disabled project's photo to anon (access embedded in SQL)", async () => {
    const res = await fetchTile(app, Z, TX, TY);
    const layers = decodeTile(res.body);
    const ids = (layers.fotos || []).map((f) => f.props.id);
    // GUARD: `!ids.includes(x)` is trivially true for an EMPTY tile, so a broken
    // seed, a decode failure or a filter that rejected everything would all read
    // as "the access control works". The photo anon IS allowed to see must be
    // present for the absence of the other one to mean anything.
    assert.ok(ids.includes(photoId), 'guard: the tile must carry the visible photo');
    assert.ok(!ids.includes(disabledPhotoId), 'disabled-project photo hidden from anon');
  });

  it("shows the disabled project's photo to a global admin", async () => {
    const res = await fetchTile(app, Z, TX, TY, adminToken);
    const layers = decodeTile(res.body);
    const ids = (layers.fotos || []).map((f) => f.props.id);
    assert.ok(ids.includes(disabledPhotoId), 'admin sees disabled-project photo');
  });

  it("shows the disabled project's photo to a member of the owning org", async () => {
    const res = await fetchTile(app, Z, TX, TY, otherOrgToken);
    const layers = decodeTile(res.body);
    const ids = (layers.fotos || []).map((f) => f.props.id);
    assert.ok(ids.includes(disabledPhotoId), 'owning-org member sees disabled-project photo');
  });

  // --- (d) tombstoned excluded ----------------------------------------------

  it('excludes the tombstoned photo from the tile', async () => {
    const res = await fetchTile(app, Z, TX, TY, adminToken);
    const layers = decodeTile(res.body);
    const ids = (layers.fotos || []).map((f) => f.props.id);
    // Same guard: the admin sees everything that is not tombstoned, so the tile
    // must be non-empty for this exclusion to be a statement about tombstones.
    assert.ok(ids.includes(photoId), 'guard: the admin tile must carry the live photos');
    assert.ok(!ids.includes(tombId), 'tombstoned photo excluded');
  });

  // --- (e) 'fotos_linha' layer present when a trajectory exists --------------

  it("has the 'fotos_linha' layer with a project trajectory LINE (anon)", async () => {
    const res = await fetchTile(app, Z, TX, TY);
    const layers = decodeTile(res.body);
    assert.ok(layers.fotos_linha, "'fotos_linha' layer present");
    assert.ok(layers.fotos_linha.length >= 1, 'at least one trajectory line');
    const line = layers.fotos_linha.find((l) => l.props.projectSlug === SLUG);
    assert.ok(line, 'enabled project trajectory present');
    assert.equal(line.geomType, 2, 'line geometry');
  });

  it("does NOT leak the disabled project's trajectory LINE to anon (line-layer access)", async () => {
    const res = await fetchTile(app, Z, TX, TY);
    const layers = decodeTile(res.body);
    const slugs = (layers.fotos_linha || []).map((l) => l.props.projectSlug);
    // Guard first: the anon tile must carry the trajectory it IS allowed to see,
    // otherwise an empty line layer satisfies the exclusion on its own.
    assert.ok(slugs.includes(SLUG), 'guard: the enabled trajectory must be present');
    assert.ok(!slugs.includes(DISABLED_SLUG), 'disabled trajectory hidden from anon');
  });

  it("shows the disabled project's trajectory LINE to the owning org", async () => {
    const res = await fetchTile(app, Z, TX, TY, otherOrgToken);
    const layers = decodeTile(res.body);
    const slugs = (layers.fotos_linha || []).map((l) => l.props.projectSlug);
    assert.ok(slugs.includes(DISABLED_SLUG), 'owning-org member sees the disabled trajectory');
  });

  // --- (f) invalid z/x/y → 400 ----------------------------------------------

  it('rejects an out-of-range tile coordinate with 400', async () => {
    // z=1 has only a 2x2 grid; x=5 is out of range.
    const res = await supertest(app).get('/api/v1/sv360/tiles/1/5/0.pbf');
    assert.equal(res.status, 400);
    assert.equal(typeof res.body.error, 'string');
  });

  it('rejects a non-integer / out-of-zoom tile coordinate with 400', async () => {
    const res = await supertest(app).get('/api/v1/sv360/tiles/99/0/0.pbf');
    assert.equal(res.status, 400);
  });
});

// supertest parser that yields the raw response Buffer (MVT is binary).
function fetchTile(app, z, x, y, token) {
  let req = supertest(app).get(`/api/v1/sv360/tiles/${z}/${x}/${y}.pbf`);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  return req.buffer().parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

// Path: tests/integration/sv360-coverage.test.js
// Fase 9 — sv360 REAL coverage for genuinely-untested behavior (NOT padding). The
// sibling suites (sv360-contract / -gaps / -ingest / -tiles / -mvt / -image-drift)
// already cover the swap-then-commit rollback, the ETag/304 on the THUMBNAIL and
// the hardcoded-etag image 304, the flat { error } envelope on a nonexistent photo,
// the server-derived db_filename (malicious-overwrite), and the by-name / tiles /
// nearby access negatives. The gaps this file closes — each asserting a REAL
// observable (status / body / headers / SQLite/Postgres state):
//
//   (1) GET /photos/:uuid/image ACCESS NEGATIVE — the BLOB descriptor path
//       (getPhotoImageMeta → enforceProjectReadable) is only ever exercised on
//       ENABLED projects in the other suites. A disabled-project image must 404 for
//       anon (private BLOB does NOT leak) and 200 for the owning org / a global
//       admin. This is the embed-in-service access guard on the image route.
//   (2) GET /photos/:uuid (by-UUID) ACCESS NEGATIVE — sv360-gaps covers only the
//       by-NAME hidden-photo case; the by-UUID read of an EXISTING-but-hidden photo
//       (404 anon / 200 owning org) is its own code path (GET_PHOTO_BY_ID, no
//       tie-break) and was untested.
//   (3) ETag ROUND-TRIP 304 on the IMAGE route — capture the ETag the server
//       actually emits on a first 200 GET, feed it back verbatim via If-None-Match,
//       assert 304 with an EMPTY body (the contract test only re-sends a HARDCODED
//       etag string; it never proves the SERVED etag round-trips, nor that the 304
//       body is empty). Plus: a STALE/mismatched If-None-Match still streams 200.
//   (4) db_filename DERIVED (positive) — a successful upload whose manifest carries
//       a BENIGN but DIFFERENT db_filename must persist the SERVER-derived
//       `{slug}.db` in Postgres (the client value is ignored, not just
//       for the malicious case). Asserted on a real upload.
//   (5) out-of-range LON manifest → 422 + flat { error } (the ingest suite covers
//       out-of-range LAT; the lon path + its envelope were unasserted).
//   (6) successful ingest COMMITS the new {slug}.db with no .bak/.tmp left
//       (the swap-then-commit SUCCESS finalize — siblings assert the FAILED path).
//
// Seeds are SQL (reads) + a real multipart upload (ingest); fixtures mirror the
// sibling suites (deterministic uuidv5 / fixed NS, mintToken without a users row,
// closeStore() before rmSync — Windows file lock). Slugs carry a per-run random
// suffix so the file is re-runnable alongside the others.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createProducerUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';
import { buildTilesDb } from '../helpers/sv360-tiles.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const RID = randomUUID().slice(0, 8); // unique suffix for this file run

// Deterministic UUID v5 (node:crypto), fixed namespace — matches sibling suites.
const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// O EIXO DE ESCRITA/OCULTACAO DO 360 e o ESCOPO DE PRODUCAO (`producer_org_id`),
// concedido por administrador. `organization_id` + `org_role` — lotacao
// AUTO-DECLARADA no auto-cadastro — deixou de autorizar qualquer coisa, e continua
// viajando so como exibicao.
function mintToken({ orgId, producerOrgId = null, role = 'user', sub = randomUUID() }) {
  return jwt.sign(
    {
      sub, username: `cov_${sub.slice(0, 8)}`, role,
      organization_id: orgId, producer_org_id: producerOrgId,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

const url = (p) => `/api/v1/sv360${p}`;
const authHdr = (t) => ['Authorization', `Bearer ${t}`];

// Slugs (unique per run). Enabled in default org, disabled in the OTHER org.
const ENABLED_SLUG = `cov-enabled-${RID}`;
const DISABLED_SLUG = `cov-disabled-${RID}`;

// Blobs for the seeded (read-path) photos.
const fullBuf = Buffer.from('RIFFxxxxWEBP-cov-full-0123456789ABCDEF');
const prevBuf = Buffer.from('RIFFxxxxWEBP-cov-preview');
// A distinct blob for the DISABLED project's image, so a leak would be detectable.
const disFullBuf = Buffer.from('RIFFxxxxWEBP-DISABLED-SECRET-IMAGE-do-not-leak');

describe('StreetView 360 — coverage of genuinely-untested behavior', () => {
  let app, db;
  let defaultOrgId, otherOrgId;
  let enabledProjectId, disabledProjectId;
  let ownerToken, otherOrgEditorToken;
  let tmpRoot;
  // Track on-disk .db/.webp paths to clean in teardown.
  const diskPaths = new Set();

  // Enabled-project photo (anon-readable) + disabled-project photo (hidden).
  const enabledPhotoId = uuidv5(`enabled/${ENABLED_SLUG}/cov-foto.jpg`);
  const disabledPhotoId = uuidv5(`disabled/${DISABLED_SLUG}/cov-secret.jpg`);

  // Org-keyed db_filename (parallels deriveDbFilename → ${slug}.db).
  let enabledDbName, disabledDbName, enabledDbPath, disabledDbPath;

  // Tiles-only: o arquivo de pixel do bundle e o `{slug}_tiles.db`.
  function buildImagesDb(name, rows) {
    const p = path.join(tmpRoot, name);
    if (existsSync(p)) rmSync(p, { force: true });
    return buildTilesDb(p, rows.map((r) => r.id));
  }

  function writeManifestFile(name, content) {
    const p = path.join(tmpRoot, name);
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
    return p;
  }

  function photoRow(id, name, seq, lat, lon, full, preview, extra = {}) {
    return {
      id,
      original_name: name,
      display_name: name.replace('.jpg', ''),
      sequence_number: seq,
      lat,
      lon,
      ele: 700,
      heading: 0,
      camera_height: 1.6,
      full_size_bytes: full.length,
      preview_size_bytes: preview.length,
      ...extra,
    };
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;

    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla)
       VALUES ($1, $2, 'COVOM')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
      [`Cov OM ${RID}`, `cov-other-om-${RID}`]
    );
    otherOrgId = org2.rows[0].id;

    // OS ATORES COM PODER PRECISAM DE LINHA EM `users`, e nao so de claim: as rotas de
    // LEITURA do 360 resolvem papel e producao no SQL, a partir do UUID. Um `sub`
    // sintetico escreveria (o gate de escrita e JS) e nao leria nada — um 404 com cara
    // de autorizacao que e, na verdade, fixture.
    const produtor = await createProducerUser(db, defaultOrgId, { username: `cov_prod_${RID}` });
    const produtorOutra = await createProducerUser(db, otherOrgId, { username: `cov_prodb_${RID}` });

    ownerToken = mintToken({ orgId: defaultOrgId, producerOrgId: defaultOrgId, sub: produtor.id });
    // Apenas LOTADO na outra OM: e o ator que o modelo antigo autorizava.
    otherOrgEditorToken = mintToken({ orgId: otherOrgId, producerOrgId: otherOrgId, sub: produtorOutra.id });

    tmpRoot = path.join(os.tmpdir(), `sv360-cov-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });

    enabledDbName = `${ENABLED_SLUG}.db`;
    disabledDbName = `${DISABLED_SLUG}.db`;
    enabledDbPath = path.resolve(config.sv360.dbDir, enabledDbName);
    disabledDbPath = path.resolve(config.sv360.dbDir, disabledDbName);
    diskPaths.add(enabledDbPath);
    diskPaths.add(disabledDbPath);

    // ENABLED project (default org, public) with one anon-readable photo.
    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, $3, -23.5, -46.6, $4, 'enabled', 1) RETURNING id`,
      [defaultOrgId, ENABLED_SLUG, `Cov Enabled ${RID}`, enabledDbName]
    );
    enabledProjectId = proj.rows[0].id;

    // DISABLED project (OTHER org, hidden from anon) with one secret photo.
    const dis = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, $3, -10, -50, $4, 'disabled', 1) RETURNING id`,
      [otherOrgId, DISABLED_SLUG, `Cov Disabled ${RID}`, disabledDbName]
    );
    disabledProjectId = dis.rows[0].id;

    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          heading, full_size_bytes, preview_size_bytes, capture_date)
       VALUES ($1, $2, 'cov-foto.jpg', 'Cov Foto', 1, -23.5, -46.6, 720, 12, $3, $4,
               '2024-02-01T10:00:00Z')`,
      [enabledPhotoId, enabledProjectId, fullBuf.length, prevBuf.length]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          full_size_bytes, preview_size_bytes)
       VALUES ($1, $2, 'cov-secret.jpg', 'Cov Secret', 1, -10, -50, 100, $3, $4)`,
      [disabledPhotoId, disabledProjectId, disFullBuf.length, disFullBuf.length]
    );

    // Build the per-project {slug}.db files with the WebP blobs.
    const e = new Database(enabledDbPath);
    e.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    e.prepare('INSERT INTO images VALUES (?,?,?)').run(enabledPhotoId, fullBuf, prevBuf);
    e.close();

    const d = new Database(disabledDbPath);
    d.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    d.prepare('INSERT INTO images VALUES (?,?,?)').run(disabledPhotoId, disFullBuf, disFullBuf);
    d.close();
  });

  after(async () => {
    await closeStore();
    for (const f of diskPaths) {
      for (const variant of [f, `${f}.tmp`, `${f}.bak`, `${f}-wal`, `${f}-shm`, `${f}-journal`]) {
        if (variant && existsSync(variant)) {
          try {
            rmSync(variant, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });

    await db.query(
      `DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1)`,
      [[enabledPhotoId, disabledPhotoId]]
    );
    await db.query(`DELETE FROM sv360.projects WHERE organization_id = ANY($1::uuid[])`, [
      [defaultOrgId, otherOrgId],
    ]);
    // O PRODUTOR PRECISA CAIR ANTES DA OM: `users.producer_org_id` é FK sem ON DELETE,
    // então apagar a organização com um produtor de pé levanta 23503 dentro do `after`
    // — uma suíte inteiramente verde que termina vermelha por limpeza.
    await db.query('DELETE FROM public.users WHERE producer_org_id = $1', [otherOrgId]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [otherOrgId]);
    await teardownTestEnv(db);
  });

  // -------------------------------------------------------------------------
  // (2) by-UUID metadata ACCESS NEGATIVE (distinct from the by-NAME path).
  // -------------------------------------------------------------------------

  it('by-uuid metadata: a disabled-project photo is 404 for anon, 200 for the owning org', async () => {
    const anon = await supertest(app).get(url(`/photos/${disabledPhotoId}`)).expect(404);
    assert.equal(typeof anon.body.error, 'string'); // flat envelope, indistinguishable from missing

    const ok = await supertest(app)
      .get(url(`/photos/${disabledPhotoId}`))
      .set(...authHdr(otherOrgEditorToken))
      .expect(200);
    assert.equal(ok.body.camera.id, disabledPhotoId);
    assert.equal(ok.body.projectSlug, DISABLED_SLUG);
  });

  it('by-uuid metadata: a DIFFERENT (non-owning) org member still gets 404 (no cross-org read)', async () => {
    // ownerToken belongs to the DEFAULT org; the disabled project is the OTHER org.
    const res = await supertest(app)
      .get(url(`/photos/${disabledPhotoId}`))
      .set(...authHdr(ownerToken))
      .expect(404);
    assert.equal(typeof res.body.error, 'string');
  });

  // -------------------------------------------------------------------------
  // (4) db_filename DERIVED (positive): a BENIGN client value is overridden.
  // (6) successful ingest COMMITS the new file, no .bak/.tmp residue.
  // -------------------------------------------------------------------------

  it('upload: a benign client db_filename is IGNORED — Postgres records the server-derived name; the file commits clean', async () => {
    const slug = `cov-derive-${RID}`;
    const derived = `${slug}.db`;
    const derivedPath = path.resolve(config.sv360.dbDir, derived.replace(/.db$/i, "_tiles.db"));
    diskPaths.add(derivedPath);
    assert.equal(existsSync(derivedPath), false, 'precondition: no file yet');

    const okId = uuidv5(`default/${slug}/u001.jpg`);
    const imagesDbPath = buildImagesDb('derive-images.db', [
      { id: okId, full: fullBuf, preview: prevBuf },
    ]);
    // The manifest carries a HARMLESS but DIFFERENT db_filename the client "wants".
    const manifest = {
      schemaVersion: 1,
      project: {
        slug,
        name: 'Derive',
        orgSlug: 'default',
        db_filename: 'client-supplied-name.db', // benign, must be ignored
      },
      photos: [photoRow(okId, 'u001.jpg', 1, -23.5, -46.6, fullBuf, prevBuf)],
      targets: [],
    };
    const manifestPath = writeManifestFile('derive.json', manifest);

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(ownerToken))
      .attach('manifest', manifestPath)
      .attach('tilesDb', imagesDbPath)
      .expect(201);
    // Response echoes the DERIVED name, not the client's.
    assert.equal(res.body.dbFilename, derived);
    assert.notEqual(res.body.dbFilename, 'client-supplied-name.db');

    // Postgres persisted the server-derived `{slug}.db`.
    const { rows } = await db.query(
      `SELECT db_filename FROM sv360.projects WHERE organization_id = $1 AND slug = $2`,
      [defaultOrgId, slug]
    );
    assert.equal(rows[0].db_filename, derived);

    // Swap-then-commit SUCCESS: the new file is installed and the .bak/.tmp safety
    // nets are gone (commitSwap dropped the .bak after the Postgres commit).
    assert.ok(existsSync(derivedPath), 'derived {slug}.db committed on disk');
    assert.equal(existsSync(`${derivedPath}.bak`), false, 'no leftover .bak after a clean commit');
    assert.equal(existsSync(`${derivedPath}.tmp`), false, 'no leftover .tmp after a clean commit');
    // The client-named file was NEVER created.
    assert.equal(
      existsSync(path.resolve(config.sv360.dbDir, 'client-supplied-name.db')),
      false,
      'the client-supplied db_filename must never be written'
    );

    // O tile recem-ingerido e servivel a partir do arquivo comitado.
    const tile = await supertest(app)
      .get(url(`/photos/${okId}/tiles/0/0/0`))
      .set(...authHdr(ownerToken))
      .expect(200);
    assert.ok(Buffer.from(tile.body).length > 0);

    // Cleanup this project's rows (file removed by teardown via diskPaths).
    await db.query(`DELETE FROM sv360.projects WHERE organization_id = $1 AND slug = $2`, [
      defaultOrgId,
      slug,
    ]);
  });

  // -------------------------------------------------------------------------
  // (5) out-of-range LON manifest → 422 + flat { error } (lon path; lat is
  //     covered by sv360-ingest, lon was not).
  // -------------------------------------------------------------------------

  it('upload: a manifest with lon out of range → 422 + flat { error }; NOTHING is committed', async () => {
    const slug = `cov-badlon-${RID}`;
    const derived = `${slug}.db`;
    const derivedPath = path.resolve(config.sv360.dbDir, derived.replace(/.db$/i, "_tiles.db"));
    diskPaths.add(derivedPath);

    const okId = uuidv5(`default/${slug}/b001.jpg`);
    const imagesDbPath = buildImagesDb('badlon-images.db', [
      { id: okId, full: fullBuf, preview: prevBuf },
    ]);
    const manifest = {
      schemaVersion: 1,
      project: { slug, name: 'BadLon', orgSlug: 'default' },
      // lon 999 is out of [-180, 180] → rejected at PASSO 0 (validateManifest).
      photos: [photoRow(okId, 'b001.jpg', 1, -23.5, 999, fullBuf, prevBuf)],
      targets: [],
    };
    const manifestPath = writeManifestFile('badlon.json', manifest);

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(ownerToken))
      .attach('manifest', manifestPath)
      .attach('tilesDb', imagesDbPath)
      .expect(422);
    assert.equal(typeof res.body.error, 'string');
    assert.equal(res.body.error.error, undefined, 'envelope is FLAT, not nested');

    // PASSO 0 fails before any swap → no file and no project row.
    assert.equal(existsSync(derivedPath), false, 'no {slug}.db written on a rejected manifest');
    const { rows } = await db.query(
      `SELECT 1 FROM sv360.projects WHERE organization_id = $1 AND slug = $2`,
      [defaultOrgId, slug]
    );
    assert.equal(rows.length, 0, 'no project row created on a rejected manifest');
  });
});

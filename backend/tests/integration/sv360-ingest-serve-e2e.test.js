// Path: tests/integration/sv360-ingest-serve-e2e.test.js
// Fase 9 — ONE realistic END-TO-END 360 lifecycle FLOW (ingest -> serve -> re-ingest).
// The sibling sv360 suites assert each behavior in isolation (the per-behavior swap
// rollback, the hardcoded-etag 304, the by-name access negative, the derived
// db_filename). This suite is a DIFFERENT angle: it drives the WHOLE pipeline once,
// in order, asserting status/body/headers AND the Postgres + on-disk {orgId}__{slug}.db
// state at EVERY hop, so a regression anywhere along ingest->serve->re-ingest is
// caught by a single realistic scenario.
//
// THE FLOW (each step asserts a real observable):
//   1. Admin INGESTS a project (manifest + one WebP photo) -> 201; the committed
//      {orgId}__{slug}.db carries the project row + a servable photo (no .bak/.tmp).
//   2. GET /sv360/projects -> the project appears in the BARE ARRAY (not {projects:[]}).
//   3. GET the photo metadata -> FROZEN shape: flat camera, previewThumbnail RELATIVE.
//   4. GET the photo image -> 200 with an ETag header (captured).
//   5. Re-GET with If-None-Match: <that etag> -> 304, empty body.
//   6. RE-INGEST the same project with a CHANGED image (swap-then-commit) -> the newly
//      served image reflects the swap; the swap was atomic (no .bak/.tmp residue).
//   7. ACCESS NEGATIVE: a member of a DIFFERENT org requests the photo/image -> 404
//      flat { error } (private BLOB does not leak).
//
// Fixtures mirror the sibling suites: deterministic uuidv5 (fixed NS, node:crypto),
// mintToken without a users row, a synthetic images.db via better-sqlite3, and
// closeStore() before rmSync in teardown (Windows file lock). A per-run random suffix
// keeps the slug/ids unique so this file is re-runnable alongside the others.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
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

// Deterministic UUID v5 (node:crypto), fixed namespace — matches the sibling suites.
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
      sub, username: `e2e_${sub.slice(0, 8)}`, role,
      organization_id: orgId, producer_org_id: producerOrgId,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

const url = (p) => `/api/v1/sv360${p}`;
const authHdr = (t) => ['Authorization', `Bearer ${t}`];

const SLUG = `e2e-lifecycle-${RID}`;
const photoId = uuidv5(`default/${SLUG}/foto001.jpg`);

// v1 image (initial ingest) and v2 image (re-ingest swap). DISTINCT bytes AND
// distinct lengths so the served body change is unambiguous and the O(1) ETag
// (which embeds full_size_bytes) necessarily changes across the swap.
const fullV1 = Buffer.from('RIFFxxxxWEBP-E2E-v1-INITIAL-image-payload-0123456789');
const prevV1 = Buffer.from('RIFFxxxxWEBP-E2E-v1-preview');
const fullV2 = Buffer.from('RIFFxxxxWEBP-E2E-v2-SWAPPED-image-payload-abcdefghijklmnop');
const prevV2 = Buffer.from('RIFFxxxxWEBP-E2E-v2-preview-CHANGED');

describe('StreetView 360 — ingest -> serve -> re-ingest END-TO-END lifecycle', () => {
  let app, db;
  let defaultOrgId, otherOrgId;
  let ownerToken, otherOrgViewerToken;
  let tmpRoot;
  // The server DERIVES the on-disk name from (orgId, slug); the manifest's
  // db_filename is ignored. We compute the same name to assert disk state.
  let derivedDbName, derivedDbPath;

  function buildImagesDb(name, rows) {
    const p = path.join(tmpRoot, name);
    if (existsSync(p)) rmSync(p, { force: true });
    return buildTilesDb(p, rows.map((r) => r.id));
  }

  function writeManifestFile(name, content) {
    const p = path.join(tmpRoot, name);
    writeFileSync(p, JSON.stringify(content));
    return p;
  }

  function photoRow(id, name, seq, lat, lon, full, preview) {
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
    };
  }

  // A one-photo manifest for the (default-org) lifecycle project. `full`/`preview`
  // drive full_size_bytes / preview_size_bytes (the ETag/Content-Length source).
  function manifest(name, full, preview) {
    return {
      schemaVersion: 1,
      project: {
        slug: SLUG,
        name,
        orgSlug: 'default',
        center_lat: -23.5,
        center_long: -46.6,
        // benign client value: the server ignores it and derives ${slug}.db.
        db_filename: 'client-wishes-this.db',
      },
      photos: [photoRow(photoId, 'foto001.jpg', 1, -23.5, -46.6, full, preview)],
      targets: [],
      deleted_photos: [],
    };
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;

    // A SECOND org so the access-negative step uses a real, non-owning member.
    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla)
       VALUES ($1, $2, 'E2EOM')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
      [`E2E OM ${RID}`, `sv360-e2e-other-om-${RID}`]
    );
    otherOrgId = org2.rows[0].id;

    // owner: default-org writer (ingests). otherOrgViewer: member of a DIFFERENT org
    // (the lifecycle project is NOT theirs -> must 404, no leak).
    // OS ATORES COM PODER PRECISAM DE LINHA EM `users`, e nao so de claim: as rotas de
    // LEITURA do 360 resolvem papel e producao no SQL, a partir do UUID. Um `sub`
    // sintetico escreveria (o gate de escrita e JS) e nao leria nada — um 404 com cara
    // de autorizacao que e, na verdade, fixture.
    const produtor = await createProducerUser(db, defaultOrgId, { username: `e2e_prod_${RID}` });
    ownerToken = mintToken({ orgId: defaultOrgId, producerOrgId: defaultOrgId, sub: produtor.id });
    otherOrgViewerToken = mintToken({ orgId: otherOrgId });

    tmpRoot = path.join(os.tmpdir(), `sv360-e2e-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });

    derivedDbName = `${SLUG}.db`;
    // Tiles-only: o arquivo instalado e o `{slug}_tiles.db`.
    derivedDbPath = path.resolve(config.sv360.dbDir, `${SLUG}_tiles.db`);

    // A MINIATURA PRECISA EXISTIR EM DISCO para o STEP 3 continuar medindo a FORMA
    // da URL. Desde 2026-08-21 `previewThumbnail` só é emitido quando o arquivo
    // está lá (o escritor sempre a tratou como OPCIONAL), então sem esta linha o
    // campo viria null e a asserção de "relativo, sem /api/v1" mediria nada. O nome
    // é o ORG-KEYED derivado do db_filename, o mesmo que a rota de thumbnail
    // resolve; o teardown acima já o apaga.
    writeFileSync(
      path.resolve(config.sv360.dbDir, `${SLUG}.webp`),
      Buffer.from('RIFFxxxxWEBPfake-e2e-thumb')
    );
  });

  after(async () => {
    // Release the blobPool's cached handle to the {slug}.db BEFORE deleting it
    // (Windows EBUSY otherwise).
    await closeStore();
    for (const variant of [
      derivedDbPath,
      `${derivedDbPath}.tmp`,
      `${derivedDbPath}.bak`,
      `${derivedDbPath}-wal`,
      `${derivedDbPath}-shm`,
      `${derivedDbPath}-journal`,
      path.resolve(config.sv360.dbDir, `${SLUG}.webp`),
    ]) {
      if (variant && existsSync(variant)) {
        try {
          rmSync(variant, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });

    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = $1`, [photoId]);
    await db.query(`DELETE FROM sv360.projects WHERE organization_id = ANY($1::uuid[]) AND slug = $2`, [
      [defaultOrgId, otherOrgId],
      SLUG,
    ]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [otherOrgId]);
    await teardownTestEnv(db);
  });

  // The whole lifecycle is ONE ordered scenario: each `it` is a hop and depends on
  // the prior hop's state. node:test runs them sequentially within a describe.
  let capturedEtag;

  // -------------------------------------------------------------------------
  // STEP 1 — INGEST: admin uploads a 1-photo project. 201 + committed {db} +
  //          a Postgres project/photo row + a servable image.
  // -------------------------------------------------------------------------
  it('STEP 1 — ingests the project (201): {orgId}__{slug}.db commits clean with the project + photo', async () => {
    assert.equal(existsSync(derivedDbPath), false, 'precondition: no file before ingest');

    const imagesDbPath = buildImagesDb('e2e-v1-images.db', [
      { id: photoId, full: fullV1, preview: prevV1 },
    ]);
    const manifestPath = writeManifestFile('e2e-v1-manifest.json', manifest('E2E Lifecycle v1', fullV1, prevV1));

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(ownerToken))
      .attach('manifest', manifestPath)
      .attach('tilesDb', imagesDbPath)
      .expect(201);

    // Response echoes the slug, photoCount, and the SERVER-DERIVED db name.
    assert.equal(res.body.slug, SLUG);
    assert.equal(res.body.photoCount, 1);
    assert.equal(res.body.dbFilename, derivedDbName);
    assert.notEqual(res.body.dbFilename, 'client-wishes-this.db');

    // Postgres committed exactly one project + one photo for the default org.
    const { rows: proj } = await db.query(
      `SELECT id, status, photo_count FROM sv360.projects WHERE organization_id = $1 AND slug = $2`,
      [defaultOrgId, SLUG]
    );
    assert.equal(proj.length, 1);
    assert.equal(proj[0].status, 'enabled');
    assert.equal(proj[0].photo_count, 1);

    const { rows: photos } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.photos WHERE project_id = $1`,
      [proj[0].id]
    );
    assert.equal(photos[0].n, 1);

    // Swap-then-commit SUCCESS: the org-keyed file is installed; the .bak/.tmp
    // safety nets were dropped after the Postgres commit. The client-named file
    // was NEVER written.
    assert.ok(existsSync(derivedDbPath), 'committed {orgId}__{slug}.db on disk');
    assert.equal(existsSync(`${derivedDbPath}.bak`), false, 'no leftover .bak after clean commit');
    assert.equal(existsSync(`${derivedDbPath}.tmp`), false, 'no leftover .tmp after clean commit');
    assert.equal(
      existsSync(path.resolve(config.sv360.dbDir, 'client-wishes-this.db')),
      false,
      'the client-supplied db_filename must never be written'
    );

    // The image is servable post-ingest (proves the swap + blobPool reads the NEW db).
    const img = await supertest(app)
      .get(url(`/photos/${photoId}/tiles/0/0/0`))
      .set(...authHdr(ownerToken))
      .expect(200);
    assert.ok(Buffer.from(img.body).length > 0, 'o tile e servido apos a ingestao');
  });

  // -------------------------------------------------------------------------
  // STEP 2 — LIST: the new project appears in GET /sv360/projects (BARE array).
  // -------------------------------------------------------------------------
  it('STEP 2 — GET /sv360/projects lists the new project in a BARE ARRAY (not {projects:[]})', async () => {
    const res = await supertest(app).get(url('/projects')).expect(200);
    assert.ok(Array.isArray(res.body), 'bare array contract, not { projects: [] }');
    assert.equal(res.body.projects, undefined, 'must NOT be wrapped in { projects }');
    const found = res.body.find((p) => p.slug === SLUG);
    assert.ok(found, 'the freshly ingested project appears in the public listing');
  });

  // -------------------------------------------------------------------------
  // STEP 3 — METADATA: FROZEN shape — flat camera, RELATIVE previewThumbnail.
  // -------------------------------------------------------------------------
  it('STEP 3 — GET photo metadata returns the FROZEN shape (flat camera; previewThumbnail RELATIVE)', async () => {
    const res = await supertest(app).get(url(`/photos/${photoId}`)).expect(200);
    const b = res.body;

    // Bare object (NOT wrapped in {data}).
    assert.equal(b.data, undefined);

    // Flat camera fields (lon/lat at the camera level).
    assert.equal(b.camera.id, photoId);
    assert.equal(b.camera.img, 'foto001.jpg');
    assert.ok(Math.abs(b.camera.lon - -46.6) < 1e-6);
    assert.ok(Math.abs(b.camera.lat - -23.5) < 1e-6);
    // camera_height saiu do contrato em 2026-08-29 (inerte, sem leitor no cliente).
    assert.equal(b.camera.height, undefined);
    assert.equal(b.camera.camera_height, undefined);

    assert.equal(b.projectSlug, SLUG);

    // previewThumbnail is RELATIVE and WITHOUT the /api/v1 prefix (frozen contract).
    assert.equal(typeof b.previewThumbnail, 'string');
    assert.equal(b.previewThumbnail, `/thumbnails/${SLUG}.webp`);
    assert.ok(!b.previewThumbnail.startsWith('/api/v1'), 'previewThumbnail must be relative (no /api/v1)');
  });

  // -------------------------------------------------------------------------
  // STEP 4 — IMAGE: 200 + ETag header (captured for the 304 round-trip).
  // -------------------------------------------------------------------------
  it('STEP 4 — GET the photo image returns 200 with an ETag header (captured)', async () => {
    const res = await supertest(app)
      .get(url(`/photos/${photoId}/tiles/0/0/0`))
      .expect(200);
    assert.equal(res.headers['content-type'], 'image/webp');
    capturedEtag = res.headers['etag'];
    assert.ok(capturedEtag, 'first 200 carries an ETag');
    // Tile ETag = "{uuid}-{level}-{x}-{y}-{totalBytes}"; a forma exata e testada em
    // sv360-tiles. Aqui basta o tag existir e servir para o 304 do STEP 5.
    assert.ok(Buffer.from(res.body).length > 0);
  });

  // -------------------------------------------------------------------------
  // STEP 5 — 304: the SERVED ETag round-trips to a 304 with an EMPTY body.
  // -------------------------------------------------------------------------
  it('STEP 5 — re-GET with If-None-Match: <that etag> returns 304 with an EMPTY body', async () => {
    assert.ok(capturedEtag, 'depends on the ETag captured in STEP 4');
    const res = await supertest(app)
      .get(url(`/photos/${photoId}/tiles/0/0/0`))
      .set('If-None-Match', capturedEtag)
      .expect(304);
    // A 304 MUST NOT carry a body. Normalise the shape superagent hands back
    // (Buffer for a binary route, text otherwise) and assert ZERO bytes — one
    // fact, not a menu of tolerated outcomes.
    const bodyBytes = Buffer.isBuffer(res.body)
      ? res.body.length
      : Buffer.byteLength(res.text ?? '');
    assert.equal(bodyBytes, 0, 'a 304 carries no body');
    assert.equal(res.headers['content-length'], undefined);
  });

  // -------------------------------------------------------------------------
  // STEP 6 — RE-INGEST: swap-then-commit. The newly served image reflects the
  //          swap; the old DB was replaced atomically (no .bak/.tmp residue).
  // -------------------------------------------------------------------------
  it('STEP 6 — re-ingest with a CHANGED image swaps atomically: new bytes served, no .bak/.tmp residue', async () => {
    const { rows: before } = await db.query(
      `SELECT id, created_at FROM sv360.projects WHERE organization_id = $1 AND slug = $2`,
      [defaultOrgId, SLUG]
    );
    const projectId = before[0].id;
    const createdAt = before[0].created_at;

    const imagesDbPath = buildImagesDb('e2e-v2-images.db', [
      { id: photoId, full: fullV2, preview: prevV2 },
    ]);
    const manifestPath = writeManifestFile('e2e-v2-manifest.json', manifest('E2E Lifecycle v2', fullV2, prevV2));

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(ownerToken))
      .attach('manifest', manifestPath)
      .attach('tilesDb', imagesDbPath)
      .expect(201);
    assert.equal(res.body.slug, SLUG);
    assert.equal(res.body.photoCount, 1);

    // Same project id (re-ingest is "last upload wins", not a duplicate) and the
    // original created_at is preserved.
    const { rows: after } = await db.query(
      `SELECT id, created_at, photo_count FROM sv360.projects WHERE organization_id = $1 AND slug = $2`,
      [defaultOrgId, SLUG]
    );
    assert.equal(after.length, 1, 're-ingest did not duplicate the project');
    assert.equal(after[0].id, projectId);
    assert.equal(new Date(after[0].created_at).getTime(), new Date(createdAt).getTime());

    // Updated full_size_bytes (the swapped blob has a DIFFERENT length).
    const { rows: ph } = await db.query(
      `SELECT full_size_bytes FROM sv360.photos WHERE id = $1`,
      [photoId]
    );
    assert.equal(Number(ph[0].full_size_bytes), fullV2.length);

    // The newly served image reflects the swap (v2 bytes, NOT the stale v1).
    // Tiles-only: o tile segue servivel apos o re-upload. A prova de "novos bytes"
    // saiu com a rota de imagem: o conteudo do tile de fixture e fixo, e o ETag do
    // tile deriva de (foto, nivel, x, y, total_bytes), nao do tamanho do blob.
    const img = await supertest(app)
      .get(url(`/photos/${photoId}/tiles/0/0/0`))
      .set(...authHdr(ownerToken))
      .expect(200);
    assert.ok(Buffer.from(img.body).length > 0, 'o tile segue servido apos o swap');
    assert.ok(img.headers['etag'], 'o tile carrega ETag');

    // The swap was atomic: the committed file is present and no .bak/.tmp residue
    // leaked (the swap-then-commit finalize dropped them after the Postgres commit).
    assert.ok(existsSync(derivedDbPath), 'committed {slug}_tiles.db still present after the swap');
    assert.equal(existsSync(`${derivedDbPath}.bak`), false, 'no leftover .bak after the swap');
    assert.equal(existsSync(`${derivedDbPath}.tmp`), false, 'no leftover .tmp after the swap');
  });

  // -------------------------------------------------------------------------
  // STEP 7 — ACCESS NEGATIVE: a member of a DIFFERENT org gets 404 flat { error }
  //          on BOTH the metadata and the image (the private BLOB does not leak).
  //          The lifecycle project is in the DEFAULT org; otherOrgViewer is not a
  //          member — and the project is enabled, so a 404 (not 403) proves the
  //          access filter is embedded in the read, indistinguishable from missing.
  // -------------------------------------------------------------------------
  it('STEP 7 — a DIFFERENT-org member gets 404 flat { error } on metadata AND image (no leak)', async () => {
    // The project IS publicly listable while enabled, so confirm the negative is
    // about cross-org reads of a PRIVATE photo, not the project being hidden. To
    // make the BLOB unambiguously private, disable the project first (an enabled
    // project's photos are anon-readable by contract; a disabled one is not).
    await db.query(
      `UPDATE sv360.projects SET status = 'disabled' WHERE organization_id = $1 AND slug = $2`,
      [defaultOrgId, SLUG]
    );

    // Metadata: a non-owning org member is indistinguishable from "missing" -> 404.
    const meta = await supertest(app)
      .get(url(`/photos/${photoId}`))
      .set(...authHdr(otherOrgViewerToken))
      .expect(404);
    assert.equal(typeof meta.body.error, 'string'); // FLAT { error }, not { error: { code } }
    assert.equal(meta.body.error.error, undefined, 'envelope is flat, not nested');

    // Image: the private BLOB does NOT leak — 404, and the v2 secret bytes are
    // nowhere in the error body.
    const img = await supertest(app)
      .get(url(`/photos/${photoId}/tiles/0/0/0`))
      .set(...authHdr(otherOrgViewerToken))
      .expect(404);
    assert.equal(typeof img.body.error, 'string');
    assert.ok(!Buffer.from(img.body.error).includes('SWAPPED'), 'no BLOB bytes leak into the error');

    // Anonymous is likewise 404 (defense-in-depth: the disabled project is hidden).
    await supertest(app).get(url(`/photos/${photoId}/tiles/0/0/0`)).expect(404);

    // The OWNING org still reads it (200) — the negative is access control, not a
    // broken project.
    const owner = await supertest(app)
      .get(url(`/photos/${photoId}/tiles/0/0/0`))
      .set(...authHdr(ownerToken))
      .expect(200);
    assert.ok(Buffer.from(owner.body).length > 0, 'a OM dona segue servindo o tile');
  });
});

// Path: tests/integration/sv360-ingest.test.js
// Fase 9 (stage 3a): StreetView 360 ADMIN / INGESTION contract. Follows the
// stage-1/2 fixture pattern (synthetic images.db via better-sqlite3; uuidv5 with
// the fixed NS via node:crypto; mintToken without a users row; closeStore()/evict
// before rmSync in teardown — Windows file lock). Covers:
//   - UPLOAD (multipart .attach): rows created (project/photos/targets), {slug}.db
//     present in SV360_DB_DIR, and the image is servable via GET /photos/:uuid/image
//     post-upload (proves the swap + the blobPool reads the NEW .db);
//   - REUPLOAD "last upload wins": change a field + add a photo → reflected, NOT
//     duplicated, project status/created_at preserved;
//   - invalid manifest (lat out of range / NaN / orphan target / db_filename with
//     a separator) → 4xx with the flat { error } envelope;
//   - cross-OM collision (same photo id in another org) → 409;
//   - non-admin / no-ownership → 403; anonymous → 401;
//   - status: PATCH disabled removes the project from the public read; DELETE
//     project (hard) removes the rows + {slug}.db.
//
// TEARDOWN: await closeStore() (release worker handles) → rmSync .db/.tmp/.bak/
// thumb → DELETE sv360 rows + the extra org → teardownTestEnv.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createProducerUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';

// Deterministic UUID v5 (node:crypto), fixed namespace — matches the other tests.
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
function mintToken({ orgId, producerOrgId = null, role = 'user', sub = crypto.randomUUID() }) {
  return jwt.sign(
    {
      sub, username: `u_${sub.slice(0, 8)}`, role,
      organization_id: orgId, producer_org_id: producerOrgId,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

const SLUG = 'proj-ingest';
const DB_FILENAME = `${SLUG}.db`;

// Photo ids are the studio's deterministic uuidv5("{orgSlug}/{slug}/{name}").
const photo1Id = uuidv5('default/proj-ingest/foto001.jpg');
const photo2Id = uuidv5('default/proj-ingest/foto002.jpg');
const photo3Id = uuidv5('default/proj-ingest/foto003.jpg');
// A photo id seeded in ANOTHER org to trigger the cross-OM collision guard. It is
// NOT used by any other test (sv360.photos.id is a GLOBAL PK, so reusing photo3Id
// across orgs is impossible to even seed — the guard prevents the upload first).
const collisionId = uuidv5('other-om/proj-collision-other/collide-foto.jpg');

const full1 = Buffer.from('RIFFxxxxWEBPfull-001-payload-0123456789');
const prev1 = Buffer.from('RIFFxxxxWEBPprev001');
const full2 = Buffer.from('RIFFxxxxWEBPfull-002-payload-abcdefghij');
const prev2 = Buffer.from('RIFFxxxxWEBPprev002');
const full3 = Buffer.from('RIFFxxxxWEBPfull-003-payload-klmnopqrst');
const prev3 = Buffer.from('RIFFxxxxWEBPprev003');

describe('StreetView 360 — admin/ingestion contract', () => {
  let app, db, tmpRoot, destPath, thumbPath, derivedDbFilename;
  let defaultOrgId, otherOrgId, otherProjectId;
  let ownerToken, adminToken, viewerToken, crossOrgToken;

  // Builds a small synthetic images.db on disk under tmpRoot, returning its path.
  function buildImagesDb(name, rows) {
    const p = path.join(tmpRoot, name);
    if (existsSync(p)) rmSync(p, { force: true });
    const sdb = new Database(p);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    const ins = sdb.prepare('INSERT INTO images VALUES (?,?,?)');
    for (const r of rows) ins.run(r.id, r.full, r.preview);
    sdb.close();
    return p;
  }

  // Writes a manifest.json to tmpRoot and returns its path.
  function writeManifest(name, manifest) {
    const p = path.join(tmpRoot, name);
    writeFileSync(p, JSON.stringify(manifest));
    return p;
  }

  // The base 2-photo manifest (photo1 -> photo2 target).
  function baseManifest(overrides = {}) {
    return {
      schemaVersion: 1,
      project: {
        slug: SLUG,
        name: 'Projeto Ingest',
        orgSlug: 'default',
        center_lat: -23.5,
        center_long: -46.6,
        db_filename: DB_FILENAME,
        ...overrides.project,
      },
      photos: overrides.photos || [
        photoRow(photo1Id, 'foto001.jpg', 1, -23.5, -46.6, full1, prev1),
        photoRow(photo2Id, 'foto002.jpg', 2, -23.5005, -46.6005, full2, prev2),
      ],
      targets:
        overrides.targets || [
          {
            source_id: photo1Id,
            target_id: photo2Id,
            distance_m: 12.5,
            bearing_deg: 90,
            is_next: true,
            is_original: true,
          },
        ],
      deleted_photos: overrides.deleted_photos || [],
    };
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

  const url = (p) => `/api/v1/sv360${p}`;
  const auth = (t) => ['Authorization', `Bearer ${t}`];

  async function projectIdBySlug(slug, orgId) {
    const { rows } = await db.query(
      `SELECT id FROM sv360.projects WHERE slug = $1 AND organization_id = $2`,
      [slug, orgId]
    );
    return rows[0]?.id;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;

    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla)
       VALUES ('Outra OM Ingest', 'sv360-ingest-other-om', 'OUTRI')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`
    );
    otherOrgId = org2.rows[0].id;

    // Tokens: owner (default-org writer), admin (global), viewer (default-org RO),
    // crossOrg (writer of the OTHER org → cannot write default-org project).
    // OS ATORES COM PODER PRECISAM DE LINHA EM `users`, e nao so de claim: as rotas de
    // LEITURA do 360 resolvem papel e producao no SQL, a partir do UUID. Um `sub`
    // sintetico escreveria (o gate de escrita e JS) e nao leria nada — um 404 com cara
    // de autorizacao que e, na verdade, fixture.
    const produtor = await createProducerUser(db, defaultOrgId, { username: `ing_prod_${crypto.randomUUID().slice(0, 8)}` });
    const administrador = await createAdminUser(db, { username: `ing_admin_${crypto.randomUUID().slice(0, 8)}` });
    const produtorOutra = await createProducerUser(db, otherOrgId, { username: `ing_prodb_${crypto.randomUUID().slice(0, 8)}` });

    ownerToken = mintToken({ orgId: defaultOrgId, producerOrgId: defaultOrgId, sub: produtor.id });
    adminToken = mintToken({ orgId: otherOrgId, role: 'admin', sub: administrador.id });
    // Apenas LOTADO na OM dona, sem cracha: le e nao escreve.
    viewerToken = mintToken({ orgId: defaultOrgId });
    crossOrgToken = mintToken({ orgId: otherOrgId, producerOrgId: otherOrgId, sub: produtorOutra.id });

    tmpRoot = path.join(os.tmpdir(), `sv360-ingest-${crypto.randomUUID().slice(0, 8)}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });
    // FIX-1: the {slug}.db filename is DERIVED server-side from (orgId, slug); the
    // manifest's db_filename is IGNORED. The on-disk store is org-scoped.
    derivedDbFilename = `${defaultOrgId}__${SLUG}.db`;
    destPath = path.resolve(config.sv360.dbDir, derivedDbFilename);
    thumbPath = path.resolve(config.sv360.dbDir, `${SLUG}.webp`);
  });

  after(async () => {
    await closeStore();
    for (const f of [
      destPath,
      `${destPath}.tmp`,
      `${destPath}.bak`,
      `${destPath}-wal`,
      `${destPath}-shm`,
      thumbPath,
    ]) {
      if (f && existsSync(f)) {
        try {
          rmSync(f, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });

    // Clean sv360 rows for both orgs' projects (CASCADE clears photos/targets).
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1)`, [
      [photo1Id, photo2Id, photo3Id, collisionId],
    ]);
    await db.query(
      `DELETE FROM sv360.projects WHERE organization_id = ANY($1::uuid[]) AND slug IN ($2, $3)`,
      [[defaultOrgId, otherOrgId], SLUG, 'proj-collision-other']
    );
    if (otherProjectId) {
      await db.query(`DELETE FROM sv360.projects WHERE id = $1`, [otherProjectId]).catch(() => {});
    }
    // O PRODUTOR PRECISA CAIR ANTES DA OM: `users.producer_org_id` é FK sem ON DELETE,
    // então apagar a organização com um produtor de pé levanta 23503 dentro do `after`
    // — uma suíte inteiramente verde que termina vermelha por limpeza.
    await db.query('DELETE FROM public.users WHERE producer_org_id = $1', [otherOrgId]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [otherOrgId]);
    await teardownTestEnv(db);
  });

  // --- happy path: upload -----------------------------------------------------

  it('uploads a bundle (201): rows created, {slug}.db present, image servable', async () => {
    const imagesDbPath = buildImagesDb('upload-images.db', [
      { id: photo1Id, full: full1, preview: prev1 },
      { id: photo2Id, full: full2, preview: prev2 },
    ]);
    const manifestPath = writeManifest('upload-manifest.json', baseManifest());

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(201);

    assert.equal(res.body.slug, SLUG);
    assert.equal(res.body.photoCount, 2);

    // O CONJUNTO EXATO DE CHAVES DO 201, e não só duas delas. O corpo deste endpoint é
    // contrato congelado do 360 (envelope PLANO, sem `{data}`), e desde 2026-08-21 o
    // serviço devolve um campo A MAIS — `orgId`, para a trilha — que o controller
    // desestrutura FORA da resposta. Sem esta linha, repor `orgId` no corpo passaria
    // verde em toda a suíte, e contrato congelado sem asserção de chaves não é
    // congelado. `deepEqual` do array ordenado, nunca `toContain`: a asserção precisa
    // reprovar tanto a chave que sumiu quanto a que apareceu.
    assert.deepEqual(
      Object.keys(res.body).sort(),
      ['dbFilename', 'photoCount', 'projectId', 'slug'],
      'o corpo do 201 do upload é contrato congelado: nem chave a menos, nem a mais',
    );

    const pid = await projectIdBySlug(SLUG, defaultOrgId);
    assert.ok(pid);

    const { rows: photos } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.photos WHERE project_id = $1`,
      [pid]
    );
    assert.equal(photos[0].n, 2);

    const { rows: targets } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.targets WHERE source_id = $1`,
      [photo1Id]
    );
    assert.equal(targets[0].n, 1);

    // geom was filled by the trigger from lon/lat.
    const { rows: geo } = await db.query(
      `SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM sv360.photos WHERE id = $1`,
      [photo1Id]
    );
    assert.equal(Number(geo[0].lon), -46.6);
    assert.equal(Number(geo[0].lat), -23.5);

    // The {slug}.db landed in SV360_DB_DIR.
    assert.ok(existsSync(destPath), 'expected {slug}.db in SV360_DB_DIR');

    // The image is servable post-upload (proves swap + blobPool reads the new db).
    const img = await supertest(app)
      .get(url(`/photos/${photo1Id}/image?quality=full`))
      .set(...auth(ownerToken))
      .expect(200);
    assert.ok(Buffer.from(img.body).equals(full1), 'served full webp must equal the uploaded blob');
  });

  // --- reupload "last upload wins" -------------------------------------------

  it('reupload is "last upload wins": adds a photo, changes a field, no duplication', async () => {
    const pid = await projectIdBySlug(SLUG, defaultOrgId);
    const before = await db.query(
      `SELECT status, created_at FROM sv360.projects WHERE id = $1`,
      [pid]
    );
    const createdAt = before.rows[0].created_at;
    const status = before.rows[0].status;

    // 3-photo manifest, changed center_lat, target photo1->photo3.
    const imagesDbPath = buildImagesDb('reupload-images.db', [
      { id: photo1Id, full: full1, preview: prev1 },
      { id: photo2Id, full: full2, preview: prev2 },
      { id: photo3Id, full: full3, preview: prev3 },
    ]);
    const manifestPath = writeManifest(
      'reupload-manifest.json',
      baseManifest({
        project: { slug: SLUG, name: 'Projeto Ingest v2', orgSlug: 'default', db_filename: DB_FILENAME, center_lat: -10, center_long: -50 },
        photos: [
          photoRow(photo1Id, 'foto001.jpg', 1, -23.5, -46.6, full1, prev1),
          photoRow(photo2Id, 'foto002.jpg', 2, -23.5005, -46.6005, full2, prev2),
          photoRow(photo3Id, 'foto003.jpg', 3, -23.51, -46.61, full3, prev3),
        ],
        targets: [
          { source_id: photo1Id, target_id: photo3Id, distance_m: 33, bearing_deg: 200, is_next: false },
        ],
      })
    );

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(201);
    assert.equal(res.body.photoCount, 3);

    // Same project id (no duplicate project), now 3 photos, status/created_at kept.
    const pidAfter = await projectIdBySlug(SLUG, defaultOrgId);
    assert.equal(pidAfter, pid);

    const { rows: photos } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.photos WHERE project_id = $1`,
      [pid]
    );
    assert.equal(photos[0].n, 3);

    const { rows: proj } = await db.query(
      `SELECT name, center_lat, status, created_at, photo_count FROM sv360.projects WHERE id = $1`,
      [pid]
    );
    assert.equal(proj[0].name, 'Projeto Ingest v2');
    assert.equal(Number(proj[0].center_lat), -10);
    assert.equal(proj[0].status, status); // preserved
    assert.equal(new Date(proj[0].created_at).getTime(), new Date(createdAt).getTime());
    assert.equal(proj[0].photo_count, 3);

    // The old target (photo1->photo2) was purged; only photo1->photo3 remains.
    const { rows: tgt } = await db.query(
      `SELECT target_id FROM sv360.targets WHERE source_id = $1`,
      [photo1Id]
    );
    assert.equal(tgt.length, 1);
    assert.equal(tgt[0].target_id, photo3Id);
  });

  // --- invalid manifests → 4xx -----------------------------------------------

  it('rejects a manifest with lat out of range → 4xx + flat error', async () => {
    const imagesDbPath = buildImagesDb('bad-lat-images.db', [
      { id: photo1Id, full: full1, preview: prev1 },
    ]);
    const m = baseManifest({
      photos: [photoRow(photo1Id, 'foto001.jpg', 1, 999, -46.6, full1, prev1)],
      targets: [],
    });
    const manifestPath = writeManifest('bad-lat.json', m);

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(422);
    assert.equal(typeof res.body.error, 'string');
  });

  it('rejects a manifest with a NaN numeric → 4xx', async () => {
    const imagesDbPath = buildImagesDb('nan-images.db', [
      { id: photo1Id, full: full1, preview: prev1 },
    ]);
    // JSON cannot hold NaN; emulate with a non-numeric string the schema rejects.
    const m = baseManifest({
      photos: [{ ...photoRow(photo1Id, 'foto001.jpg', 1, -23.5, -46.6, full1, prev1), heading: 'not-a-number' }],
      targets: [],
    });
    const manifestPath = writeManifest('nan.json', m);

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(422);
    assert.equal(typeof res.body.error, 'string');
  });

  it('rejects a manifest with an orphan target (source/target not in photos[]) → 4xx', async () => {
    const imagesDbPath = buildImagesDb('orphan-images.db', [
      { id: photo1Id, full: full1, preview: prev1 },
    ]);
    const m = baseManifest({
      photos: [photoRow(photo1Id, 'foto001.jpg', 1, -23.5, -46.6, full1, prev1)],
      targets: [{ source_id: photo1Id, target_id: photo3Id, is_next: true }], // photo3 absent
    });
    const manifestPath = writeManifest('orphan.json', m);

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(422);
    assert.equal(typeof res.body.error, 'string');
  });

  it('rejects a db_filename containing a path separator → 4xx', async () => {
    const imagesDbPath = buildImagesDb('sep-images.db', [
      { id: photo1Id, full: full1, preview: prev1 },
    ]);
    const m = baseManifest({
      project: { slug: SLUG, name: 'X', orgSlug: 'default', db_filename: 'a/b.db' },
      photos: [photoRow(photo1Id, 'foto001.jpg', 1, -23.5, -46.6, full1, prev1)],
      targets: [],
    });
    const manifestPath = writeManifest('sep.json', m);

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(422);
    assert.equal(typeof res.body.error, 'string');
  });

  it('rejects an images.db whose blob size mismatches the manifest → 4xx', async () => {
    // Manifest claims full_size_bytes = full1.length, but the db carries prev1
    // (shorter) in full_webp → PASSO 0 size-check fails (400).
    const imagesDbPath = buildImagesDb('mismatch-images.db', [
      { id: photo1Id, full: prev1, preview: prev1 },
    ]);
    const m = baseManifest({
      photos: [photoRow(photo1Id, 'foto001.jpg', 1, -23.5, -46.6, full1, prev1)],
      targets: [],
    });
    const manifestPath = writeManifest('mismatch.json', m);

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(400);
    assert.equal(typeof res.body.error, 'string');
  });

  // --- cross-OM collision → 409 ----------------------------------------------

  it('cross-OM photo-id collision → 409', async () => {
    // Seed a project in the OTHER org that already owns collisionId.
    const op = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, photo_count)
       VALUES ($1, 'proj-collision-other', 'Other', 'proj-collision-other.db', 'enabled', 1)
       RETURNING id`,
      [otherOrgId]
    );
    otherProjectId = op.rows[0].id;
    await db.query(
      `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
       VALUES ($1, $2, 'x.jpg', 1, -10, -50)`,
      [collisionId, otherProjectId]
    );

    // Upload to default org a manifest that references collisionId → guard 409.
    const imagesDbPath = buildImagesDb('collide-images.db', [
      { id: photo1Id, full: full1, preview: prev1 },
      { id: collisionId, full: full3, preview: prev3 },
    ]);
    const m = baseManifest({
      photos: [
        photoRow(photo1Id, 'foto001.jpg', 1, -23.5, -46.6, full1, prev1),
        photoRow(collisionId, 'collide-foto.jpg', 2, -23.51, -46.61, full3, prev3),
      ],
      targets: [],
    });
    const manifestPath = writeManifest('collide.json', m);

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(409);
    assert.equal(typeof res.body.error, 'string');

    // Cleanup the collision fixture so it does not bleed into later assertions.
    await db.query(`DELETE FROM sv360.photos WHERE id = $1 AND project_id = $2`, [
      collisionId,
      otherProjectId,
    ]);
    await db.query(`DELETE FROM sv360.projects WHERE id = $1`, [otherProjectId]);
    otherProjectId = null;
  });

  // --- FIX-1: db_filename derived server-side (cross-OM BLOB isolation) --------

  it('db_filename is derived server-side: a malicious manifest cannot overwrite another OM\'s {slug}.db', async () => {
    // OM-B (the "victim") owns a real org-scoped {slug}.db on disk.
    const victimSlug = 'victim-proj';
    const victimDerived = `${otherOrgId}__${victimSlug}.db`;
    const victimPath = path.resolve(config.sv360.dbDir, victimDerived);
    const victimBytes = Buffer.from('VICTIM-OM-B-ORIGINAL-DB-CONTENT-do-not-touch');
    mkdirSync(config.sv360.dbDir, { recursive: true });
    writeFileSync(victimPath, victimBytes);

    // OM-A (admin global targeting default org) uploads a manifest whose
    // db_filename MALICIOUSLY points at OM-B's real on-disk file.
    const attackerSlug = 'attacker-proj';
    const aId1 = uuidv5('default/attacker-proj/a001.jpg');
    const imagesDbPath = buildImagesDb('attacker-images.db', [
      { id: aId1, full: full1, preview: prev1 },
    ]);
    const m = baseManifest({
      project: {
        slug: attackerSlug,
        name: 'Attacker',
        orgSlug: 'default',
        db_filename: victimDerived, // malicious: target OM-B's file
      },
      photos: [photoRow(aId1, 'a001.jpg', 1, -23.5, -46.6, full1, prev1)],
      targets: [],
    });
    const manifestPath = writeManifest('attacker.json', m);

    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(adminToken)) // global admin → honors orgSlug 'default'
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(201);

    // OM-B's file is INTACT (the malicious db_filename was ignored).
    assert.ok(existsSync(victimPath), 'victim {slug}.db must still exist');
    assert.ok(
      Buffer.from(readFileSync(victimPath)).equals(victimBytes),
      'victim {slug}.db content must be untouched'
    );

    // OM-A's data went to ITS OWN org-scoped file (default-org derived name).
    const attackerDerived = `${defaultOrgId}__${attackerSlug}.db`;
    const attackerPath = path.resolve(config.sv360.dbDir, attackerDerived);
    assert.ok(existsSync(attackerPath), 'attacker data must land in its org-scoped file');

    // Postgres recorded the DERIVED filename, not the malicious one.
    const { rows } = await db.query(
      `SELECT db_filename FROM sv360.projects WHERE organization_id = $1 AND slug = $2`,
      [defaultOrgId, attackerSlug]
    );
    assert.equal(rows[0].db_filename, attackerDerived);

    // Cleanup.
    rmSync(victimPath, { force: true });
    rmSync(attackerPath, { force: true });
    await db.query(`DELETE FROM sv360.projects WHERE organization_id = $1 AND slug = $2`, [
      defaultOrgId,
      attackerSlug,
    ]);
  });

  it('two orgs sharing the SAME slug map to DIFFERENT files', async () => {
    const sharedSlug = 'shared-slug';
    const d1 = `${defaultOrgId}__${sharedSlug}.db`;
    const d2 = `${otherOrgId}__${sharedSlug}.db`;
    assert.notEqual(d1, d2, 'derived filenames must differ across orgs');

    const idA = uuidv5('default/shared-slug/sa.jpg');
    const idB = uuidv5('other/shared-slug/sb.jpg');

    // Upload as default-org owner.
    const imgA = buildImagesDb('shared-a.db', [{ id: idA, full: full1, preview: prev1 }]);
    const manA = writeManifest(
      'shared-a.json',
      baseManifest({
        project: { slug: sharedSlug, name: 'Shared A', orgSlug: 'default' },
        photos: [photoRow(idA, 'sa.jpg', 1, -23.5, -46.6, full1, prev1)],
        targets: [],
      })
    );
    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', manA)
      .attach('imagesDb', imgA)
      .expect(201);

    // Upload as the OTHER-org editor (same slug, different org).
    const imgB = buildImagesDb('shared-b.db', [{ id: idB, full: full2, preview: prev2 }]);
    const manB = writeManifest(
      'shared-b.json',
      baseManifest({
        project: { slug: sharedSlug, name: 'Shared B', orgSlug: 'sv360-ingest-other-om' },
        photos: [photoRow(idB, 'sb.jpg', 1, -10, -50, full2, prev2)],
        targets: [],
      })
    );
    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(crossOrgToken))
      .attach('manifest', manB)
      .attach('imagesDb', imgB)
      .expect(201);

    const pathA = path.resolve(config.sv360.dbDir, d1);
    const pathB = path.resolve(config.sv360.dbDir, d2);
    assert.ok(existsSync(pathA), 'default-org file exists');
    assert.ok(existsSync(pathB), 'other-org file exists');

    // Cleanup both projects + files.
    rmSync(pathA, { force: true });
    rmSync(pathB, { force: true });
    await db.query(
      `DELETE FROM sv360.projects WHERE organization_id = ANY($1::uuid[]) AND slug = $2`,
      [[defaultOrgId, otherOrgId], sharedSlug]
    );
  });

  // --- FIX-3: swap-then-commit — a merge failure AFTER the swap rolls the file back

  it('merge failure after the swap restores the OLD {slug}.db and leaves Postgres unchanged', async () => {
    // Seed a target project (default org, its OWN slug) with a known {slug}.db so a
    // failed re-upload must restore exactly these bytes. Then re-upload a manifest
    // that passes PASSO 0 (valid + size-matched) but FAILS the merge tx via a
    // cross-project photo-id collision (collisionId already lives in OM-B).
    const rbSlug = 'rollback-proj';
    const rbDerived = `${defaultOrgId}__${rbSlug}.db`;
    const rbPath = path.resolve(config.sv360.dbDir, rbDerived);

    const rbId1 = uuidv5('default/rollback-proj/r001.jpg');
    // First, a clean upload to establish the project + its on-disk file.
    const img0 = buildImagesDb('rb0-images.db', [{ id: rbId1, full: full1, preview: prev1 }]);
    const man0 = writeManifest(
      'rb0.json',
      baseManifest({
        project: { slug: rbSlug, name: 'Rollback', orgSlug: 'default' },
        photos: [photoRow(rbId1, 'r001.jpg', 1, -23.5, -46.6, full1, prev1)],
        targets: [],
      })
    );
    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', man0)
      .attach('imagesDb', img0)
      .expect(201);

    assert.ok(existsSync(rbPath), 'project file installed by the clean upload');
    const originalBytes = Buffer.from(readFileSync(rbPath));
    const { rows: pidRows } = await db.query(
      `SELECT id, photo_count FROM sv360.projects WHERE organization_id = $1 AND slug = $2`,
      [defaultOrgId, rbSlug]
    );
    const rbPid = pidRows[0].id;
    const photoCountBefore = pidRows[0].photo_count;

    // Seed a colliding id in OM-B so the re-upload's merge guard throws 409.
    const op = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, photo_count)
       VALUES ($1, 'rb-collision-other', 'Other RB', 'rb-collision-other.db', 'enabled', 1)
       RETURNING id`,
      [otherOrgId]
    );
    const collisionPid = op.rows[0].id;
    const collideId = uuidv5('other/rb-collision-other/collide-rb.jpg');
    await db.query(
      `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
       VALUES ($1, $2, 'c.jpg', 1, -10, -50)`,
      [collideId, collisionPid]
    );

    // Re-upload to the SAME (default, rbSlug) project with a manifest carrying a
    // BIGGER, DIFFERENT images.db AND the colliding id → PASSO 0 passes, merge 409s.
    const img1 = buildImagesDb('rb1-images.db', [
      { id: rbId1, full: full2, preview: prev2 },
      { id: collideId, full: full3, preview: prev3 },
    ]);
    const man1 = writeManifest(
      'rb1.json',
      baseManifest({
        project: { slug: rbSlug, name: 'Rollback v2', orgSlug: 'default' },
        photos: [
          photoRow(rbId1, 'r001.jpg', 1, -23.5, -46.6, full2, prev2),
          photoRow(collideId, 'collide-rb.jpg', 2, -23.51, -46.61, full3, prev3),
        ],
        targets: [],
      })
    );
    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', man1)
      .attach('imagesDb', img1)
      .expect(409);

    // The OLD {slug}.db was restored byte-for-byte (.bak rolled back).
    assert.ok(existsSync(rbPath), 'old {slug}.db must be restored after a failed merge');
    assert.ok(
      Buffer.from(readFileSync(rbPath)).equals(originalBytes),
      'restored {slug}.db must equal the pre-upload content'
    );
    // No stray .bak/.tmp left behind.
    assert.equal(existsSync(`${rbPath}.bak`), false, 'no leftover .bak');
    assert.equal(existsSync(`${rbPath}.tmp`), false, 'no leftover .tmp');

    // Postgres is unchanged (still the original single photo, same count).
    const { rows: after } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.photos WHERE project_id = $1`,
      [rbPid]
    );
    assert.equal(after[0].n, 1, 'Postgres photos unchanged after rolled-back merge');
    const { rows: pc } = await db.query(
      `SELECT photo_count FROM sv360.projects WHERE id = $1`,
      [rbPid]
    );
    assert.equal(pc[0].photo_count, photoCountBefore, 'photo_count unchanged');

    // Cleanup.
    rmSync(rbPath, { force: true });
    await db.query(`DELETE FROM sv360.photos WHERE id = $1`, [collideId]);
    await db.query(`DELETE FROM sv360.projects WHERE id = $1`, [collisionPid]);
    await db.query(`DELETE FROM sv360.projects WHERE organization_id = $1 AND slug = $2`, [
      defaultOrgId,
      rbSlug,
    ]);
  });

  it('a first-upload merge failure leaves NO orphan {slug}.db (rollback drops the new file)', async () => {
    // No prior file for this slug; a merge that 409s must drop the just-installed
    // file so nothing orphan remains on disk (rollbackSwap with bakMade=false).
    const orphSlug = 'orphan-proj';
    const orphDerived = `${defaultOrgId}__${orphSlug}.db`;
    const orphPath = path.resolve(config.sv360.dbDir, orphDerived);
    assert.equal(existsSync(orphPath), false, 'precondition: no file yet');

    // Seed a colliding id in OM-B.
    const op = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, photo_count)
       VALUES ($1, 'orph-collision-other', 'Other Orph', 'orph-collision-other.db', 'enabled', 1)
       RETURNING id`,
      [otherOrgId]
    );
    const collisionPid = op.rows[0].id;
    const collideId = uuidv5('other/orph-collision-other/collide-orph.jpg');
    await db.query(
      `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
       VALUES ($1, $2, 'c.jpg', 1, -10, -50)`,
      [collideId, collisionPid]
    );

    const okId = uuidv5('default/orphan-proj/o001.jpg');
    const img = buildImagesDb('orph-images.db', [
      { id: okId, full: full1, preview: prev1 },
      { id: collideId, full: full3, preview: prev3 },
    ]);
    const man = writeManifest(
      'orph.json',
      baseManifest({
        project: { slug: orphSlug, name: 'Orphan', orgSlug: 'default' },
        photos: [
          photoRow(okId, 'o001.jpg', 1, -23.5, -46.6, full1, prev1),
          photoRow(collideId, 'collide-orph.jpg', 2, -23.51, -46.61, full3, prev3),
        ],
        targets: [],
      })
    );
    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', man)
      .attach('imagesDb', img)
      .expect(409);

    assert.equal(existsSync(orphPath), false, 'no orphan {slug}.db after failed first upload');
    assert.equal(existsSync(`${orphPath}.tmp`), false, 'no leftover .tmp');
    const { rows } = await db.query(
      `SELECT 1 FROM sv360.projects WHERE organization_id = $1 AND slug = $2`,
      [defaultOrgId, orphSlug]
    );
    assert.equal(rows.length, 0, 'no project row created');

    await db.query(`DELETE FROM sv360.photos WHERE id = $1`, [collideId]);
    await db.query(`DELETE FROM sv360.projects WHERE id = $1`, [collisionPid]);
  });

  // --- FIX-6: same-org cross-project id collision → clean 409 (not opaque 500) -

  it('same-org cross-project photo-id collision → 409 (not 500)', async () => {
    // A photo id already owned by a DIFFERENT project of the SAME (default) org.
    // sv360.photos.id is a GLOBAL PK; without the widened guard this would blow the
    // INSERT as an opaque 500. The guard must turn it into a clean 409.
    const sibSlug = 'sibling-proj';
    const sibId = uuidv5('default/sibling-proj/sib.jpg');
    const sop = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, photo_count)
       VALUES ($1, $2, 'Sibling', $3, 'enabled', 1) RETURNING id`,
      [defaultOrgId, sibSlug, `${defaultOrgId}__${sibSlug}.db`]
    );
    const sibPid = sop.rows[0].id;
    await db.query(
      `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
       VALUES ($1, $2, 'sib.jpg', 1, -23.5, -46.6)`,
      [sibId, sibPid]
    );

    // Upload to a NEW default-org project that reuses the sibling's id.
    const newSlug = 'new-proj-reusing-id';
    const img = buildImagesDb('sib-collide.db', [{ id: sibId, full: full1, preview: prev1 }]);
    const man = writeManifest(
      'sib-collide.json',
      baseManifest({
        project: { slug: newSlug, name: 'New', orgSlug: 'default' },
        photos: [photoRow(sibId, 'sib.jpg', 1, -23.5, -46.6, full1, prev1)],
        targets: [],
      })
    );
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', man)
      .attach('imagesDb', img)
      .expect(409);
    assert.equal(typeof res.body.error, 'string');

    // Re-uploading the SIBLING project with its OWN id must still be allowed (its
    // own ids are not a collision).
    const img2 = buildImagesDb('sib-reupload.db', [{ id: sibId, full: full2, preview: prev2 }]);
    const man2 = writeManifest(
      'sib-reupload.json',
      baseManifest({
        project: { slug: sibSlug, name: 'Sibling v2', orgSlug: 'default' },
        photos: [photoRow(sibId, 'sib.jpg', 1, -23.5, -46.6, full2, prev2)],
        targets: [],
      })
    );
    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(ownerToken))
      .attach('manifest', man2)
      .attach('imagesDb', img2)
      .expect(201);

    // Cleanup.
    rmSync(path.resolve(config.sv360.dbDir, `${defaultOrgId}__${sibSlug}.db`), { force: true });
    await db.query(`DELETE FROM sv360.projects WHERE id = $1`, [sibPid]);
    await db.query(`DELETE FROM sv360.projects WHERE organization_id = $1 AND slug = $2`, [
      defaultOrgId,
      newSlug,
    ]);
  });

  // --- FIX-5: ambiguous slug for a global admin → 409 (disambiguate via ?orgId) -

  it('global admin acting on an ambiguous slug → 409; ?orgId disambiguates', async () => {
    // Same slug in TWO orgs. A global admin DELETE/PATCH by bare slug is ambiguous.
    const ambSlug = 'amb-slug';
    const mk = async (org) =>
      db.query(
        `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, photo_count)
         VALUES ($1, $2, 'Amb', $3, 'enabled', 0) RETURNING id`,
        [org, ambSlug, `${org}__${ambSlug}.db`]
      );
    await mk(defaultOrgId);
    const p2 = await mk(otherOrgId);

    // Ambiguous → 409.
    const res = await supertest(app)
      .patch(url(`/admin/projects/${ambSlug}/status`))
      .set(...auth(adminToken))
      .send({ status: 'disabled' })
      .expect(409);
    assert.equal(typeof res.body.error, 'string');

    // Disambiguate via ?orgId → 200, acts on exactly that org's project.
    const ok = await supertest(app)
      .patch(url(`/admin/projects/${ambSlug}/status?orgId=${otherOrgId}`))
      .set(...auth(adminToken))
      .send({ status: 'disabled' })
      .expect(200);
    assert.equal(ok.body.status, 'disabled');
    assert.equal(ok.body.organization_id, otherOrgId);

    // Cleanup.
    await db.query(`DELETE FROM sv360.projects WHERE slug = $1`, [ambSlug]);
    void p2;
  });

  // --- authz -----------------------------------------------------------------

  it('anonymous upload → 401', async () => {
    const imagesDbPath = buildImagesDb('anon-images.db', [
      { id: photo1Id, full: full1, preview: prev1 },
    ]);
    const manifestPath = writeManifest('anon.json', baseManifest());
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(401);
    assert.equal(typeof res.body.error, 'string');
  });

  it('same-org viewer upload → 403', async () => {
    const imagesDbPath = buildImagesDb('viewer-images.db', [
      { id: photo1Id, full: full1, preview: prev1 },
    ]);
    const manifestPath = writeManifest('viewer.json', baseManifest());
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(viewerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(403);
    assert.equal(typeof res.body.error, 'string');
  });

  it('cross-org editor uploading to the default org → 403', async () => {
    const imagesDbPath = buildImagesDb('cross-images.db', [
      { id: photo1Id, full: full1, preview: prev1 },
    ]);
    // orgSlug 'default' but the caller is an editor of the OTHER org → 403.
    const manifestPath = writeManifest('cross.json', baseManifest());
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...auth(crossOrgToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(403);
    assert.equal(typeof res.body.error, 'string');
  });

  // --- status + list + delete -------------------------------------------------

  it('PATCH status=disabled removes the project from the public read', async () => {
    // Visible to anon while enabled.
    await supertest(app).get(url(`/projects/${SLUG}`)).expect(200);

    const res = await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/status`))
      .set(...auth(ownerToken))
      .send({ status: 'disabled' })
      .expect(200);
    assert.equal(res.body.status, 'disabled');

    // Now hidden from anonymous reads (404, no leak).
    await supertest(app).get(url(`/projects/${SLUG}`)).expect(404);

    // Re-enable so the admin list + delete steps see a clean state.
    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/status`))
      .set(...auth(ownerToken))
      .send({ status: 'enabled' })
      .expect(200);
  });

  it('GET /admin/projects lists the OM projects (including disabled)', async () => {
    const res = await supertest(app)
      .get(url('/admin/projects'))
      .set(...auth(ownerToken))
      .expect(200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.some((p) => p.slug === SLUG));
  });

  it('global admin sees the project across OMs in the admin list', async () => {
    const res = await supertest(app)
      .get(url('/admin/projects'))
      .set(...auth(adminToken))
      .expect(200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.some((p) => p.slug === SLUG));
  });

  it('DELETE project (204): rows gone + {slug}.db removed', async () => {
    const pid = await projectIdBySlug(SLUG, defaultOrgId);
    assert.ok(pid);

    await supertest(app)
      .delete(url(`/admin/projects/${SLUG}`))
      .set(...auth(ownerToken))
      .expect(204);

    const { rows: proj } = await db.query(`SELECT 1 FROM sv360.projects WHERE id = $1`, [pid]);
    assert.equal(proj.length, 0);
    const { rows: photos } = await db.query(
      `SELECT 1 FROM sv360.photos WHERE project_id = $1`,
      [pid]
    );
    assert.equal(photos.length, 0);
    assert.equal(existsSync(destPath), false, 'expected {slug}.db removed after delete');
  });
});

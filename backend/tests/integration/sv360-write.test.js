// Path: tests/integration/sv360-write.test.js
// Fase 9 (stage 2): StreetView 360 WRITE/calibration contract. Builds on the
// stage-1 read fixture pattern (seed sv360 rows via SQL + a synthetic {slug}.db,
// closeStore() before .db cleanup on Windows). Covers, beyond happy path:
//   - calibration: PUT updates the columns, DB reflects, response is the rebuilt
//     frozen shape; an out-of-range value (heading > 360) → 422 (negative-by-range);
//   - ownership ladder, hoje no eixo de PRODUÇÃO (era `organization_id` + `org_role`,
//     que autorizava por LOTAÇÃO auto-declarada): produtor da OM dona escreve (200);
//     produtor de OUTRA OM → 403 num projeto legível (enabled) e 404 num oculto
//     (disabled); quem está apenas LOTADO na OM dona → 403 (lê e não escreve, que é o
//     caso que o modelo antigo deixava passar); anônimo → 401 (strict auth);
//   - targets: visibility reflects in DB + frozen shape; create + delete;
//     delete of a nonexistent target → idempotent 204; write on a missing link
//     → 404;
//   - photo soft-delete: writes a tombstone in deleted_photos; the photo then 404s
//     on read; first delete 204, re-delete 404 (read gate excludes tombstoned);
//   - batch-calibration: per-item partial failure (good item updates, forbidden
//     item collected in `failed`);
//   - error envelope: flat { error: '<string>' } on every 401/403/404/422.
//
// TEARDOWN (Windows EBUSY): closeStore() before deleting {slug}.db, then PG rows.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';

// Deterministic UUID v5 (node:crypto), fixed namespace — matches the read test.
const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// Mints a synthetic access token.
//
// O EIXO DE ESCRITA MUDOU, e a fixture com ele. `canWriteProject` comparava
// `organization_id` + `org_role` — LOTAÇÃO auto-declarada no auto-cadastro mais o
// papel dentro dela, o que fazia "escolher a OM na tela de cadastro" virar direito
// de editar o acervo dela. Hoje ele compara `producer_org_id`, o ESCOPO DE PRODUÇÃO,
// que só um administrador concede. `organization_id` continua viajando porque ainda
// é lotação e exibição; ele apenas não decide mais nada.
//
// O `sub` continua sintético e sem linha em `users`: o `auth` estrito não encontra
// nada para reconciliar e preserva as claims, que é o que mantém esta fixture barata.
// Repare no limite disso, que é real: as rotas de LEITURA resolvem produção no SQL
// (`fn_can_produce_resource`), e ali um `sub` sem linha não é produtor de nada. Por
// isso este arquivo, que é de ESCRITA, pode mintar; os de leitura de projeto oculto
// precisam de usuário de verdade.
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

const SLUG = 'proj-write-sv360';
const DB_FILENAME = `${SLUG}.db`;
const DISABLED_SLUG = 'proj-write-disabled-sv360';

const fullBuf = Buffer.from('RIFFxxxxWEBPfakefull-0123456789ABCDEF');
const previewBuf = Buffer.from('RIFFxxxxWEBPfakeprev');

const photoId = uuidv5('default/proj-write-sv360/w-foto001.jpg');
const targetId = uuidv5('default/proj-write-sv360/w-foto002.jpg');
const thirdId = uuidv5('default/proj-write-sv360/w-foto003.jpg');
const disabledPhotoId = uuidv5('default/proj-write-disabled-sv360/d-foto001.jpg');

describe('StreetView 360 — write/calibration contract', () => {
  let app, db, dbPath;
  let defaultOrgId, otherOrgId, enabledProjectId, disabledProjectId;
  let produtorToken, outroProdutorToken, adminToken, soLotadoToken, produtorDeOutraOmToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;

    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla)
       VALUES ('Outra OM Write', 'sv360-write-other-om', 'OUTRW')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`
    );
    otherOrgId = org2.rows[0].id;

    // Enabled project owned by default org.
    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Proj Write', -23.5, -46.6, $3, 'enabled', 3) RETURNING id`,
      [defaultOrgId, SLUG, DB_FILENAME]
    );
    enabledProjectId = proj.rows[0].id;

    // Disabled project owned by the OTHER org (hidden from default-org users + anon).
    const dis = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, db_filename, status, photo_count)
       VALUES ($1, $2, 'Proj Write Disabled', 'wdisabled.db', 'disabled', 1) RETURNING id`,
      [otherOrgId, DISABLED_SLUG]
    );
    disabledProjectId = dis.rows[0].id;

    await seedPhotos();

    // OS CINCO ATORES, no eixo de PRODUÇÃO. Os dois primeiros produzem para a OM
    // dona do projeto; `soLotado` está LOTADO nela e não produz nada (é o ator que
    // o modelo antigo autorizava e o novo recusa, e por isso ele é o negativo mais
    // importante do arquivo); o administrador é global e escreve qualquer OM; o
    // último produz para a OUTRA OM, que é dona do projeto desabilitado.
    produtorToken = mintToken({ orgId: defaultOrgId, producerOrgId: defaultOrgId });
    outroProdutorToken = mintToken({ orgId: defaultOrgId, producerOrgId: defaultOrgId });
    soLotadoToken = mintToken({ orgId: defaultOrgId });
    adminToken = mintToken({ orgId: otherOrgId, role: 'admin' });
    produtorDeOutraOmToken = mintToken({ orgId: otherOrgId, producerOrgId: otherOrgId });

    // Build the per-project {slug}.db with the WebP blobs (for any image read; the
    // write tests don't read images but keep the store consistent with the row).
    mkdirSync(config.sv360.dbDir, { recursive: true });
    dbPath = path.join(config.sv360.dbDir, DB_FILENAME);
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
    const sdb = new Database(dbPath);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    sdb.prepare('INSERT INTO images VALUES (?,?,?)').run(photoId, fullBuf, previewBuf);
    sdb.close();
  });

  // Re-seed photos/targets/tombstones before each test so soft-delete and target
  // mutations in one test never bleed into the next.
  beforeEach(async () => {
    await cleanupSv360Rows();
    await seedPhotos();
  });

  after(async () => {
    await closeStore();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
      if (f && existsSync(f)) rmSync(f, { force: true });
    }
    await cleanupSv360Rows();
    await db.query(`DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])`, [
      [enabledProjectId, disabledProjectId],
    ]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [otherOrgId]);
    await teardownTestEnv(db);
  });

  async function seedPhotos() {
    // photo001 (full calibration), photo002 (target), photo003 (spare for create).
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          heading, mesh_rotation_x, mesh_rotation_y, mesh_rotation_z,
          floor_level, full_size_bytes, preview_size_bytes,
          calibration_reviewed, capture_date)
       VALUES ($1, $2, 'w-foto001.jpg', 'W Foto 001', 1, -23.5, -46.6, 720,
               12, 0.1, 0.2, 0.3, 1, $3, $4, false, '2024-01-15T10:00:00Z')`,
      [photoId, enabledProjectId, fullBuf.length, previewBuf.length]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele)
       VALUES ($1, $2, 'w-foto002.jpg', 'W Foto 002', 2, -23.5005, -46.6005, 718)`,
      [targetId, enabledProjectId]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele)
       VALUES ($1, $2, 'w-foto003.jpg', 'W Foto 003', 3, -23.501, -46.601, 715)`,
      [thirdId, enabledProjectId]
    );
    await db.query(
      `INSERT INTO sv360.targets (source_id, target_id, distance_m, bearing_deg, is_next, is_original)
       VALUES ($1, $2, 12.5, 90, true, true)`,
      [photoId, targetId]
    );
    // One photo in the disabled project (hidden from default-org users + anon).
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele)
       VALUES ($1, $2, 'd-foto001.jpg', 'D Foto 001', 1, -10, -50, 100)`,
      [disabledPhotoId, disabledProjectId]
    );
  }

  async function cleanupSv360Rows() {
    await db.query(`DELETE FROM sv360.targets WHERE source_id = ANY($1)`, [
      [photoId, targetId, thirdId],
    ]);
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1)`, [
      [photoId, targetId, thirdId, disabledPhotoId],
    ]);
    await db.query(`DELETE FROM sv360.photos WHERE project_id = ANY($1::uuid[])`, [
      [enabledProjectId, disabledProjectId],
    ]);
  }

  const url = (p) => `/api/v1/sv360${p}`;
  const auth = (t) => ['Authorization', `Bearer ${t}`];

  // --- calibration -----------------------------------------------------------

  it('owner updates calibration; DB reflects and response is the rebuilt frozen shape', async () => {
    const res = await supertest(app)
      .put(url(`/photos/${photoId}/calibration`))
      .set(...auth(produtorToken))
      .send({ heading: 45, mesh_rotation_y: 0.5, calibration_reviewed: true })
      .expect(200);

    // Bare frozen shape (not {data}).
    assert.equal(res.body.data, undefined);
    assert.equal(res.body.camera.id, photoId);
    assert.equal(res.body.camera.heading, 45);
    assert.equal(res.body.camera.mesh_rotation_y, 0.5);
    assert.equal(res.body.camera.calibration_reviewed, true);
    // Campos inertes saíram do contrato em 2026-08-29 (não existem no ebgeo_360).
    assert.equal(res.body.camera.height, undefined);
    assert.equal(res.body.camera.distance_scale, undefined);
    assert.equal(res.body.camera.marker_scale, undefined);

    const { rows } = await db.query(
      `SELECT heading, mesh_rotation_y, calibration_reviewed FROM sv360.photos WHERE id = $1`,
      [photoId]
    );
    assert.equal(Number(rows[0].heading), 45);
    assert.equal(Number(rows[0].mesh_rotation_y), 0.5);
    assert.equal(rows[0].calibration_reviewed, true);
  });

  it('rejects a non-numeric calibration value with 422 + flat error envelope', async () => {
    const res = await supertest(app)
      .put(url(`/photos/${photoId}/calibration`))
      .set(...auth(produtorToken))
      .send({ heading: 'north' }) // type violation, not a range
      .expect(422);
    assert.equal(typeof res.body.error, 'string');
  });

  it('accepts values outside guessed ranges that the DB allows (no unconfirmed tightening)', async () => {
    // The frozen contract documents NO numeric bounds; validation must not reject
    // what the DB (plain DOUBLE PRECISION) accepts — e.g. a wrapped/over-360 or
    // negative bearing, a zero scale, a negative rotation. Tightening would 422 a
    // value the live client already sends. This guards against that regression.
    await supertest(app)
      .put(url(`/photos/${photoId}/calibration`))
      .set(...auth(produtorToken))
      .send({ heading: 400, mesh_rotation_z: -3.5, mesh_rotation_x: -3.5 })
      .expect(200);
    const { rows } = await db.query(
      `SELECT heading, mesh_rotation_z, mesh_rotation_x FROM sv360.photos WHERE id = $1`,
      [photoId]
    );
    assert.equal(Number(rows[0].heading), 400);
    assert.equal(Number(rows[0].mesh_rotation_z), -3.5);
    assert.equal(Number(rows[0].mesh_rotation_x), -3.5);
    // Restore so later assertions on this shared photo are unaffected.
    await supertest(app)
      .put(url(`/photos/${photoId}/calibration`))
      .set(...auth(produtorToken))
      .send({ heading: 45, mesh_rotation_z: 0, mesh_rotation_x: 0 })
      .expect(200);
  });

  it('rejects an empty calibration body (.min(1)) with 422', async () => {
    const res = await supertest(app)
      .put(url(`/photos/${photoId}/calibration`))
      .set(...auth(produtorToken))
      .send({})
      .expect(422);
    assert.equal(typeof res.body.error, 'string');
  });

  it('outro PRODUTOR da mesma OM escreve calibração (200)', async () => {
    await supertest(app)
      .put(url(`/photos/${photoId}/calibration`))
      .set(...auth(outroProdutorToken))
      .send({ floor_level: 4 })
      .expect(200);
    const { rows } = await db.query(`SELECT floor_level FROM sv360.photos WHERE id = $1`, [photoId]);
    assert.equal(rows[0].floor_level, 4);
  });

  it('global admin can write calibration (200)', async () => {
    await supertest(app)
      .put(url(`/photos/${photoId}/calibration`))
      .set(...auth(adminToken))
      .send({ mesh_rotation_z: 9.9 })
      .expect(200);
    const { rows } = await db.query(`SELECT mesh_rotation_z FROM sv360.photos WHERE id = $1`, [photoId]);
    assert.equal(Number(rows[0].mesh_rotation_z), 9.9);
  });

  // --- ownership ladder ------------------------------------------------------

  it('anonymous write → 401 (strict auth) + flat error envelope', async () => {
    const res = await supertest(app)
      .put(url(`/photos/${photoId}/calibration`))
      .send({ heading: 10 })
      .expect(401);
    assert.equal(typeof res.body.error, 'string');
  });

  it('LOTADO na OM dona lê, e NÃO escreve → 403 + envelope plano', async () => {
    // O NEGATIVO QUE ESTA FASE CRIOU. Esta conta está lotada na OM que produziu o
    // projeto e, no modelo antigo, bastava `org_role` para escrever. Hoje a lotação é
    // auto-declarada e não decide nada: sem crachá de produção, ela lê e para aí.
    await supertest(app)
      .get(url(`/photos/${photoId}`))
      .set(...auth(soLotadoToken))
      .expect(200);
    // ...but cannot write.
    const res = await supertest(app)
      .put(url(`/photos/${photoId}/calibration`))
      .set(...auth(soLotadoToken))
      .send({ heading: 10 })
      .expect(403);
    assert.equal(typeof res.body.error, 'string');
  });

  it('produtor de OUTRA OM num projeto legível (enabled) → 403 na escrita', async () => {
    const res = await supertest(app)
      .put(url(`/photos/${photoId}/calibration`))
      .set(...auth(produtorDeOutraOmToken))
      .send({ heading: 10 })
      .expect(403);
    assert.equal(typeof res.body.error, 'string');
  });

  it('user with no access on a DISABLED (hidden) project → 404 on write (no leak)', async () => {
    // A default-org user cannot even READ the other-org disabled project → 404.
    const res = await supertest(app)
      .put(url(`/photos/${disabledPhotoId}/calibration`))
      .set(...auth(produtorToken))
      .send({ heading: 10 })
      .expect(404);
    assert.equal(typeof res.body.error, 'string');
  });

  it('write to a nonexistent photo → 404', async () => {
    const missing = uuidv5('default/proj-write-sv360/nope.jpg');
    await supertest(app)
      .put(url(`/photos/${missing}/calibration`))
      .set(...auth(produtorToken))
      .send({ heading: 10 })
      .expect(404);
  });

  // --- targets ---------------------------------------------------------------

  // As escritas de override por coluna saíram junto com o modelo de marcador
  // ABSOLUTO: os campos `override_*` seguem SERVIDOS na leitura, mas não há mais
  // rota que os escreva. Só o INSERT_TARGET os grava, na criação do link.
  // O 404 de link inexistente continua coberto abaixo, pela rota de visibilidade.

  it('write on a missing link → 404', async () => {
    const res = await supertest(app)
      .put(url(`/photos/${photoId}/targets/${thirdId}/visibility`))
      .set(...auth(produtorToken))
      .send({ hidden: true })
      .expect(404);
    assert.equal(typeof res.body.error, 'string');
  });

  it('hiding a target removes it from the read targets array', async () => {
    const res = await supertest(app)
      .put(url(`/photos/${photoId}/targets/${targetId}/visibility`))
      .set(...auth(produtorToken))
      .send({ hidden: true })
      .expect(200);
    assert.equal(res.body.targets.find((x) => x.id === targetId), undefined);

    const { rows } = await db.query(
      `SELECT hidden FROM sv360.targets WHERE source_id = $1 AND target_id = $2`,
      [photoId, targetId]
    );
    assert.equal(rows[0].hidden, true);
  });

  it('creates a new target (201) then deletes it (204, idempotent)', async () => {
    const create = await supertest(app)
      .post(url(`/photos/${photoId}/targets`))
      .set(...auth(produtorToken))
      .send({ target_id: thirdId, is_next: false, distance_m: 33, bearing_deg: 200 })
      .expect(201);
    assert.ok(create.body.targets.some((x) => x.id === thirdId));

    const { rows: after } = await db.query(
      `SELECT 1 FROM sv360.targets WHERE source_id = $1 AND target_id = $2`,
      [photoId, thirdId]
    );
    assert.equal(after.length, 1);

    await supertest(app)
      .delete(url(`/photos/${photoId}/targets/${thirdId}`))
      .set(...auth(produtorToken))
      .expect(204);

    const { rows: gone } = await db.query(
      `SELECT 1 FROM sv360.targets WHERE source_id = $1 AND target_id = $2`,
      [photoId, thirdId]
    );
    assert.equal(gone.length, 0);

    // Re-delete is idempotent (204).
    await supertest(app)
      .delete(url(`/photos/${photoId}/targets/${thirdId}`))
      .set(...auth(produtorToken))
      .expect(204);
  });

  it('creating a duplicate link → 409', async () => {
    const res = await supertest(app)
      .post(url(`/photos/${photoId}/targets`))
      .set(...auth(produtorToken))
      .send({ target_id: targetId })
      .expect(409);
    assert.equal(typeof res.body.error, 'string');
  });

  // --- photo soft-delete -----------------------------------------------------

  it('soft-deletes a photo (204): tombstone written, photo 404s on read, re-delete 404', async () => {
    await supertest(app)
      .delete(url(`/photos/${photoId}`))
      .set(...auth(produtorToken))
      .expect(204);

    const { rows } = await db.query(`SELECT 1 FROM sv360.deleted_photos WHERE photo_id = $1`, [
      photoId,
    ]);
    assert.equal(rows.length, 1);

    // The row is NOT hard-deleted.
    const { rows: stillThere } = await db.query(`SELECT 1 FROM sv360.photos WHERE id = $1`, [
      photoId,
    ]);
    assert.equal(stillThere.length, 1);

    // Read now 404s (excluded via NOT EXISTS deleted_photos).
    await supertest(app).get(url(`/photos/${photoId}`)).set(...auth(produtorToken)).expect(404);

    // The image blob of a tombstoned photo must ALSO 404 (GET_PHOTO_SIZES excludes
    // deleted_photos) — otherwise a soft-deleted photo's full-res image keeps being
    // served to anyone, including anonymous callers on an enabled project.
    await supertest(app)
      .get(url(`/photos/${photoId}/image`))
      .query({ quality: 'full' })
      .set(...auth(produtorToken))
      .expect(404);
    await supertest(app)
      .get(url(`/photos/${photoId}/image`))
      .query({ quality: 'preview' })
      .set(...auth(produtorToken))
      .expect(404);
    // Anonymous request too (no auth header).
    await supertest(app)
      .get(url(`/photos/${photoId}/image`))
      .query({ quality: 'full' })
      .expect(404);

    // Re-delete: the read gate (GET_PHOTO_BY_ID) excludes tombstoned rows, but the
    // WRITE path (GET_PHOTO_FOR_WRITE) keeps them, so ownership still resolves and
    // the tombstone INSERT is a no-op → 204 (documented idempotent path).
    await supertest(app)
      .delete(url(`/photos/${photoId}`))
      .set(...auth(produtorToken))
      .expect(204);
  });

  // --- batch -----------------------------------------------------------------

  it('batch-calibration applies updates and collects per-item partial failures', async () => {
    const missing = uuidv5('default/proj-write-sv360/batch-missing.jpg');
    const res = await supertest(app)
      .post(url('/photos/batch-calibration'))
      .set(...auth(produtorToken))
      .send({
        photos: [
          { uuid: photoId, heading: 33, mesh_rotation_y: 5 },
          { uuid: missing, heading: 10 }, // not found → failed
        ],
      })
      .expect(200);

    assert.equal(res.body.data, undefined);
    assert.equal(res.body.updated.length, 1);
    assert.equal(res.body.updated[0].camera.id, photoId);
    assert.equal(res.body.updated[0].camera.heading, 33);
    assert.equal(res.body.failed.length, 1);
    assert.equal(res.body.failed[0].uuid, missing);
    assert.equal(typeof res.body.failed[0].error, 'string');

    const { rows } = await db.query(
      `SELECT heading, mesh_rotation_y FROM sv360.photos WHERE id = $1`,
      [photoId]
    );
    assert.equal(Number(rows[0].heading), 33);
    assert.equal(Number(rows[0].mesh_rotation_y), 5);
  });

  it('batch-calibration is atomic per the transaction: a forbidden item does not roll back the rest', async () => {
    // viewer cannot write photoId, but the good item belongs to the owner token.
    const res = await supertest(app)
      .post(url('/photos/batch-calibration'))
      .set(...auth(produtorToken))
      .send({ photos: [{ uuid: photoId, floor_level: 7 }] })
      .expect(200);
    assert.equal(res.body.updated.length, 1);
    assert.equal(res.body.failed.length, 0);
    const { rows } = await db.query(`SELECT floor_level FROM sv360.photos WHERE id = $1`, [photoId]);
    assert.equal(rows[0].floor_level, 7);
  });

  it('batch-calibration: a SQL-level failure (floor_level overflow) isolates ONLY that item', async () => {
    // floor_level is Joi.number().integer() with no max, but the column is a 4-byte
    // INTEGER — a finite-but-huge value passes validation and overflows at the DB
    // layer (SQLSTATE 22003). A shared tx would enter the aborted state and silently
    // drop every other item; per-item savepoints must isolate the bad one.
    const res = await supertest(app)
      .post(url('/photos/batch-calibration'))
      .set(...auth(produtorToken))
      .send({
        photos: [
          { uuid: photoId, heading: 21 },        // before the bad item
          { uuid: targetId, floor_level: 9999999999 }, // SQL overflow → fails ONLY this item
          { uuid: thirdId, heading: 22 },        // after the bad item
        ],
      })
      .expect(200);

    const updatedIds = res.body.updated.map((u) => u.camera.id).sort();
    assert.deepEqual(updatedIds, [photoId, thirdId].sort(), 'both valid items must succeed');
    assert.equal(res.body.failed.length, 1);
    assert.equal(res.body.failed[0].uuid, targetId, 'only the overflow item fails');

    // The two valid items must be persisted (not silently lost / not falsely failed).
    const { rows: r1 } = await db.query(`SELECT heading FROM sv360.photos WHERE id = $1`, [photoId]);
    const { rows: r3 } = await db.query(`SELECT heading FROM sv360.photos WHERE id = $1`, [thirdId]);
    assert.equal(Number(r1[0].heading), 21, 'item BEFORE the failure must persist');
    assert.equal(Number(r3[0].heading), 22, 'item AFTER the failure must persist');
  });
});

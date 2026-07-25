// Path: tests/integration/sv360-tombstone-cross-tenant.repro.test.js
// REGRESSÃO — achado #19: o manifesto de upload podia gravar tombstone em foto de
// OUTRA organização, escondendo dado alheio globalmente.
//
// Causa raiz: `mergeProject` inseria em `sv360.deleted_photos` QUALQUER `photo_id`
// vindo de `manifest.deleted_photos[]`, sem checagem de propriedade
// (sv360.merge.js, laço dos tombstones). O collisionGuard só cobre `photos[]`, e o
// `.custom()` do manifestSchema só valida `targets[]` contra `photos[]`. Como
// `sv360.deleted_photos.photo_id` é PK GLOBAL sem FK e TODA query de leitura filtra
// por `NOT EXISTS (... deleted_photos ...)`, um tombstone gravado pelo tenant B
// apagava a foto do tenant A em todas as superfícies de leitura — e sobrevivia
// indefinidamente (PURGE_PROJECT_TOMBSTONES só limpa os ids do PRÓPRIO projeto
// re-uploadado, então nem o atacante nem o atacado removem o tombstone estrangeiro).
//
// A assimetria que prova o guard faltante: o caminho legítimo equivalente
// (`softDeletePhoto`, sv360.write.service.js) faz `loadWritablePhoto(uuid, user)`
// ANTES do mesmo INSERT.
//
// O teste roda direto em `ingestBundle` (o core compartilhado pelo upload admin e
// pelo ETL), que é onde o guard vive — assim cobre os DOIS caminhos de entrada.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import Database from 'better-sqlite3';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';
import { ingestBundle } from '../../src/modules/streetview360/sv360.ingest.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const RID = randomUUID().slice(0, 8);

// Deterministic UUID v5 (o schema exige v5), mesmo namespace das suítes irmãs.
const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

function mintToken({ orgId, orgRole = 'viewer', role = 'user', sub = randomUUID() }) {
  return jwt.sign(
    { sub, username: `tomb_${sub.slice(0, 8)}`, role, organization_id: orgId, org_role: orgRole },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

const fullBuf = Buffer.from('RIFFxxxxWEBP-victim-full-0123456789ABCDEF');
const prevBuf = Buffer.from('RIFFxxxxWEBP-victim-preview');

const SLUG_A = `tomb-victim-${RID}`; // projeto da organização A (vítima)
const SLUG_B = `tomb-attacker-${RID}`; // projeto da organização B (atacante)
const PHOTO_A = uuidv5(`orgA/${SLUG_A}/victim.jpg`);
const PHOTO_B = uuidv5(`orgB/${SLUG_B}/own.jpg`);

describe('sv360 — tombstone do manifesto não atravessa organização (#19)', () => {
  let app, db, orgAId, orgBId, tokenA, tmpRoot;
  const diskPaths = new Set();

  function buildTmpImagesDb(name, rows) {
    const p = path.join(tmpRoot, name);
    if (existsSync(p)) rmSync(p, { force: true });
    const sdb = new Database(p);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    const ins = sdb.prepare('INSERT INTO images VALUES (?,?,?)');
    for (const r of rows) ins.run(r.id, r.full, r.preview);
    sdb.close();
    return p;
  }

  /** Bundle mínimo válido de UMA foto, com deleted_photos[] arbitrário. */
  function bundleFor(orgId, slug, photoId, deletedPhotos = []) {
    const manifest = {
      schemaVersion: 1,
      project: { slug, name: `Proj ${slug}`, center_lat: -23.5, center_long: -46.6 },
      photos: [
        {
          id: photoId,
          original_name: `${slug}.jpg`,
          display_name: slug,
          sequence_number: 1,
          lat: -23.5,
          lon: -46.6,
          ele: 700,
          heading: 0,
          camera_height: 1.6,
          full_size_bytes: fullBuf.length,
          preview_size_bytes: prevBuf.length,
        },
      ],
      targets: [],
      deleted_photos: deletedPhotos,
    };
    const dbTmpPath = buildTmpImagesDb(`${slug}-${randomUUID().slice(0, 4)}.db`, [
      { id: photoId, full: fullBuf, preview: prevBuf },
    ]);
    diskPaths.add(path.resolve(config.sv360.dbDir, `${orgId}__${slug}.db`));
    return { manifest, dbTmpPath, orgId };
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    tmpRoot = path.join(os.tmpdir(), `sv360-tomb-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });

    const orgA = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgAId = orgA.rows[0].id;

    const orgB = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla)
       VALUES ($1, $2, 'TMBOM') RETURNING id`,
      [`OM Atacante ${RID}`, `sv360-tomb-attacker-${RID}`]
    );
    orgBId = orgB.rows[0].id;

    tokenA = mintToken({ orgId: orgAId, orgRole: 'owner' });

    // A organização A publica seu projeto com UMA foto.
    const a = bundleFor(orgAId, SLUG_A, PHOTO_A);
    await ingestBundle({ ...a, source: 'upload' });
  });

  after(async () => {
    await closeStore().catch(() => {});
    for (const p of diskPaths) {
      for (const suffix of ['', '.bak', '.tmp', '-wal', '-shm']) {
        try {
          rmSync(p + suffix, { force: true });
        } catch {
          /* best effort */
        }
      }
    }
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    await teardownTestEnv(db);
  });

  it('a foto da organização A está visível antes do ataque (baseline)', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/photos/${PHOTO_A}`)
      .set('Authorization', `Bearer ${tokenA}`);
    assert.equal(res.status, 200, 'a foto da própria org deve ser legível');
    assert.equal(res.body.camera?.id, PHOTO_A);
  });

  it('upload da organização B NÃO grava tombstone na foto da organização A', async () => {
    const attack = bundleFor(orgBId, SLUG_B, PHOTO_B, [{ photo_id: PHOTO_A }]);

    // O upload do atacante é legítimo quanto ao PRÓPRIO projeto: ele deve suceder,
    // apenas o tombstone estrangeiro é descartado.
    const merged = await ingestBundle({ ...attack, source: 'upload' });
    assert.equal(merged.slug, SLUG_B);

    const tomb = await db.query('SELECT photo_id FROM sv360.deleted_photos WHERE photo_id = $1', [
      PHOTO_A,
    ]);
    assert.equal(
      tomb.rows.length,
      0,
      'nenhum tombstone pode ter sido gravado para a foto de outra organização'
    );

    // Superfície de leitura real: a vítima continua enxergando a própria foto.
    const res = await supertest(app)
      .get(`/api/v1/sv360/photos/${PHOTO_A}`)
      .set('Authorization', `Bearer ${tokenA}`);
    assert.equal(res.status, 200, 'a foto da organização A não pode sumir por upload alheio');
  });

  it('tombstone do PRÓPRIO projeto continua sendo aplicado (carry-over não regride)', async () => {
    // O caminho legítimo: o bundle carrega o tombstone de uma foto que ele mesmo
    // declara em photos[] (foi soft-deletada na calibração e o estúdio a reenvia).
    const own = bundleFor(orgAId, SLUG_A, PHOTO_A, [{ photo_id: PHOTO_A }]);
    await ingestBundle({ ...own, source: 'upload' });

    const tomb = await db.query('SELECT photo_id FROM sv360.deleted_photos WHERE photo_id = $1', [
      PHOTO_A,
    ]);
    assert.equal(tomb.rows.length, 1, 'o tombstone do próprio projeto deve ser preservado');

    const res = await supertest(app)
      .get(`/api/v1/sv360/photos/${PHOTO_A}`)
      .set('Authorization', `Bearer ${tokenA}`);
    assert.equal(res.status, 404, 'foto tombstonada pelo próprio dono some das leituras');
  });
});

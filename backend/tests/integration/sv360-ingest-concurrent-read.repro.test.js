// Path: tests/integration/sv360-ingest-concurrent-read.repro.test.js
// Repro/regressão do achado 61 (e do 59, sua causa no pool): a ingestão evictava o
// handle SQLite e SÓ DEPOIS renomeava, sem nada impedir que uma leitura concorrente
// reabrisse o arquivo no meio do caminho.
//
// A janela do installSwap tem DUAS falhas observáveis, ambas exercitadas aqui por um
// laço de GET /photos/:uuid/image rodando DURANTE um re-upload do mesmo (org, slug):
//   (a) o worker reabre e recacheia {orgId}__{slug}.db entre o evict e o
//       renameSync(dest, .bak) → no Windows o rename falha EBUSY/EPERM, o catch
//       desfaz o swap e a ingestão responde 500 sem indicar a causa;
//   (b) entre `dest -> .bak` e `.tmp -> dest` existe um round-trip completo ao worker
//       (o evict do .tmp), e nesse intervalo dest NÃO EXISTE: o existsSync de
//       sv360.blobstore.getImage devolve null e a foto responde 404 — imagem viva
//       reportada como inexistente.
// A correção é o pool DETER o intervalo (blobPool.withEvicted): o dbPath fica em
// quarentena, leituras que chegam na janela são ADIADAS (não reabrem o arquivo, não
// veem o instante em que ele não existe) e são despachadas ao fim do swap.
//
// Invariante afirmada: com leitura contínua sobre o projeto, a re-ingestão do MESMO
// slug conclui 201 e NENHUMA leitura vê 404/500 — só 200 (bytes v1 ou v2).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const RID = randomUUID().slice(0, 8);

// Deterministic UUID v5 (node:crypto), fixed namespace — matches the sibling suites.
const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const SLUG = `swap-race-${RID}`;
const photoId = uuidv5(`default/${SLUG}/foto001.jpg`);

// Distinct lengths so a served body is unambiguously v1 or v2.
const fullV1 = Buffer.from('RIFFxxxxWEBP-SWAPRACE-v1-'.padEnd(2048, 'a'));
const prevV1 = Buffer.from('RIFFxxxxWEBP-SWAPRACE-v1-preview');
const fullV2 = Buffer.from('RIFFxxxxWEBP-SWAPRACE-v2-'.padEnd(4096, 'b'));
const prevV2 = Buffer.from('RIFFxxxxWEBP-SWAPRACE-v2-preview-CHANGED');

const url = (p) => `/api/v1/sv360${p}`;

describe('StreetView 360 — leitura concorrente durante o swap da ingestão (achado 61)', () => {
  let app, db, defaultOrgId, ownerToken, tmpRoot, derivedDbPath;

  function buildImagesDb(name, full, preview) {
    const p = path.join(tmpRoot, name);
    if (existsSync(p)) rmSync(p, { force: true });
    const sdb = new Database(p);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    sdb.prepare('INSERT INTO images VALUES (?,?,?)').run(photoId, full, preview);
    sdb.close();
    return p;
  }

  function writeManifest(name, full, preview) {
    const p = path.join(tmpRoot, name);
    writeFileSync(
      p,
      JSON.stringify({
        schemaVersion: 1,
        project: {
          slug: SLUG,
          name: `Swap race ${RID}`,
          orgSlug: 'default',
          center_lat: -23.5,
          center_long: -46.6,
          db_filename: 'ignored-by-server.db',
        },
        photos: [
          {
            id: photoId,
            original_name: 'foto001.jpg',
            display_name: 'foto001',
            sequence_number: 1,
            lat: -23.5,
            lon: -46.6,
            ele: 700,
            heading: 0,
            camera_height: 1.6,
            full_size_bytes: full.length,
            preview_size_bytes: preview.length,
          },
        ],
        targets: [],
        deleted_photos: [],
      })
    );
    return p;
  }

  function upload(manifestPath, imagesDbPath) {
    return supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath);
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;
    ownerToken = jwt.sign(
      {
        sub: randomUUID(),
        username: `swaprace_${RID}`,
        role: 'user',
        organization_id: defaultOrgId,
        org_role: 'owner',
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    tmpRoot = path.join(os.tmpdir(), `sv360-swaprace-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });
    derivedDbPath = path.resolve(config.sv360.dbDir, `${defaultOrgId}__${SLUG}.db`);
  });

  after(async () => {
    await closeStore();
    for (const f of [
      derivedDbPath,
      `${derivedDbPath}.tmp`,
      `${derivedDbPath}.bak`,
      `${derivedDbPath}-wal`,
      `${derivedDbPath}-shm`,
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
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = $1`, [photoId]);
    await db.query(`DELETE FROM sv360.projects WHERE organization_id = $1 AND slug = $2`, [
      defaultOrgId,
      SLUG,
    ]);
    await teardownTestEnv(db);
  });

  it('re-ingesta com leitura contínua: 201 e nenhuma leitura 404/500 na janela do swap', async () => {
    // v1 online + cache do worker aquecido (é o handle aberto que trava o rename).
    await upload(writeManifest('m1.json', fullV1, prevV1), buildImagesDb('v1.db', fullV1, prevV1))
      .expect(201);
    for (let i = 0; i < 6; i++) {
      await supertest(app).get(url(`/photos/${photoId}/image?quality=full`)).expect(200);
    }

    // Laço de leitura contínuo (4 em voo) que só para quando o re-upload termina.
    let running = true;
    const statuses = [];
    const readLoop = async () => {
      while (running) {
        const res = await supertest(app).get(url(`/photos/${photoId}/image?quality=full`));
        statuses.push(res.status);
      }
    };
    const readers = [readLoop(), readLoop(), readLoop(), readLoop()];

    const res = await upload(
      writeManifest('m2.json', fullV2, prevV2),
      buildImagesDb('v2.db', fullV2, prevV2)
    );
    running = false;
    await Promise.all(readers);

    assert.equal(
      res.status,
      201,
      `a re-ingestão deve concluir apesar das leituras (corpo: ${JSON.stringify(res.body)})`
    );
    assert.ok(statuses.length > 0, 'o laço precisa ter emitido leituras durante o swap');
    const bad = statuses.filter((s) => s !== 200);
    assert.deepEqual(
      bad,
      [],
      `nenhuma leitura pode ver a janela do swap (status inesperados: ${bad.join(', ')} em ${statuses.length} leituras)`
    );

    // E o swap de fato aconteceu: a imagem servida agora é a v2.
    const after = await supertest(app)
      .get(url(`/photos/${photoId}/image?quality=full`))
      .expect(200);
    assert.equal(after.body.length, fullV2.length, 'o BLOB servido é o novo');
    assert.equal(existsSync(`${derivedDbPath}.tmp`), false, 'sem resíduo .tmp');
    assert.equal(existsSync(`${derivedDbPath}.bak`), false, 'sem resíduo .bak');
  });
});

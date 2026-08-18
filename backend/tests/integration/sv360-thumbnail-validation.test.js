// Path: tests/integration/sv360-thumbnail-validation.test.js
// achado 112 — o thumbnail do bundle sv360 era gravado sem NENHUMA inspeção.
//
// `copyFileSync(thumbnailPath, thumbDest)` levava os bytes recebidos direto para um
// destino PERMANENTE e org-keyed, com `application/octet-stream` aceito no fileFilter e
// o teto do multer (`limits.fileSize`, 2 GiB por padrão) sendo o único limite — porque
// esse limite é COMUM aos três campos do upload e o images.db que viaja junto é
// legitimamente multi-GB. Depois disso `GET /sv360/thumbnails/:slug.webp` serve o
// arquivo como `image/webp`. Era o único caminho de upload do backend que virava imagem
// servida sem a checagem de magic bytes que `images.service.js` aplica em todos os
// outros.
//
// O QUE CADA CASO PRENDE:
//  - o PNG prova que a recusa é por TIPO e não por "bytes estranhos": é uma imagem
//    perfeitamente válida, só não é WebP;
//  - o arquivo grande prova que o teto é PRÓPRIO do thumbnail (o do multer, 2 GiB, deixa
//    passar), e a mensagem nomeia o tamanho, então o 400 não pode vir por acidente de
//    outra guarda;
//  - o octet-stream com bytes de WebP de verdade prende a tolerância DELIBERADA ao mime
//    mal declarado — sem ele, alguém "consertaria" o fileFilter e quebraria um upload bom;
//  - a recusa acontece ANTES do ingestBundle, então o projeto não pode existir depois de
//    um 400: é isso que separa "recusa barata" de "recusa em cima de um estado já trocado".
//
// CONTROLE NEGATIVO: removendo a chamada a `assertValidThumbnail` de `uploadBundle`, os
// casos do PNG e do arquivo grande passam a responder 201 e o .webp de lixo aparece no
// disco.

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
import { createAdminUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const RID = crypto.randomUUID().slice(0, 8);

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const full = Buffer.from('RIFFxxxxWEBP-thumb-test-full');
const prev = Buffer.from('RIFFxxxxWEBP-thumb-test-prev');

// Assinatura RIFF/WEBP real (12 bytes) + carga, que é o que `fileTypeFrom*` reconhece.
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBPVP8 '),
  Buffer.from('conteudo-de-thumbnail'.repeat(4)),
]);
// PNG de verdade: assinatura + IHDR de 13 bytes + IDAT, que é o mínimo que o
// `file-type` percorre antes de responder image/png. Imagem válida, tipo errado.
function pngChunk(type, data = Buffer.alloc(0)) {
  const len = Buffer.alloc(4);
  len.writeInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', Buffer.alloc(13)),
  pngChunk('IDAT', Buffer.from([0x00])),
]);

const url = (p) => `/api/v1/sv360${p}`;

describe('StreetView 360 — thumbnail do bundle: magic bytes + teto próprio (achado 112)', () => {
  let app, db, tmpRoot, orgId, administradorId;
  const criados = [];

  function adminToken() {
    return jwt.sign(
      {
        sub: administradorId, username: `thumb_${RID}`, role: 'admin',
        org_role: 'viewer', organization_id: orgId,
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );
  }

  function buildImagesDb(name, ids) {
    const p = path.join(tmpRoot, name);
    if (existsSync(p)) rmSync(p, { force: true });
    const sdb = new Database(p);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    const ins = sdb.prepare('INSERT INTO images VALUES (?,?,?)');
    for (const id of ids) ins.run(id, full, prev);
    sdb.close();
    return p;
  }

  function bundle(slug) {
    const photoId = uuidv5(`default/${slug}/foto.jpg`);
    const manifest = {
      schemaVersion: 1,
      project: { slug, name: `Projeto ${slug}`, center_lat: -23.5, center_long: -46.6 },
      photos: [{
        id: photoId,
        original_name: 'foto.jpg',
        sequence_number: 1,
        lat: -23.5,
        lon: -46.6,
        full_size_bytes: full.length,
        preview_size_bytes: prev.length,
      }],
      targets: [],
      deleted_photos: [],
    };
    const manifestPath = path.join(tmpRoot, `${slug}.manifest.json`);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    return { manifestPath, imagesDbPath: buildImagesDb(`${slug}.images.db`, [photoId]) };
  }

  const thumbDestOf = (slug) => path.resolve(config.sv360.dbDir, `${orgId}__${slug}.webp`);

  function writeTmp(name, buf) {
    const p = path.join(tmpRoot, name);
    writeFileSync(p, buf);
    return p;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgId = org.rows[0].id;
    // Administrador com LINHA EM `users`: a superficie administrativa do 360 recorta
    // por `fn_can_produce_resource`, que resolve papel a partir do UUID no banco.
    administradorId = (await createAdminUser(db, { username: `thumb_adm_${RID}` })).id;
    tmpRoot = path.join(os.tmpdir(), `sv360-thumb-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });
  });

  after(async () => {
    await closeStore();
    for (const slug of criados) {
      const dest = path.resolve(config.sv360.dbDir, `${orgId}__${slug}.db`);
      for (const f of [dest, `${dest}.tmp`, `${dest}.bak`, thumbDestOf(slug)]) {
        if (existsSync(f)) {
          try {
            rmSync(f, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
    await db.query(`DELETE FROM sv360.projects WHERE slug LIKE $1`, [`thumb-%${RID}`]);
    await teardownTestEnv(db);
  });

  it('WebP de verdade → 201 e o arquivo persiste no destino org-keyed', async () => {
    const slug = `thumb-ok-${RID}`;
    const b = bundle(slug);
    criados.push(slug);
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${adminToken()}`)
      .attach('manifest', b.manifestPath)
      .attach('imagesDb', b.imagesDbPath)
      .attach('thumbnail', writeTmp(`${slug}.webp`, WEBP_BYTES), { contentType: 'image/webp' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dest = thumbDestOf(slug);
    assert.ok(existsSync(dest), 'o thumbnail válido precisa continuar sendo persistido');
    assert.deepEqual(readFileSync(dest), WEBP_BYTES);
  });

  it('PNG (imagem válida, tipo errado) → 400 por magic bytes, e o projeto NÃO é criado', async () => {
    const slug = `thumb-png-${RID}`;
    const b = bundle(slug);
    criados.push(slug);
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${adminToken()}`)
      .attach('manifest', b.manifestPath)
      .attach('imagesDb', b.imagesDbPath)
      .attach('thumbnail', writeTmp(`${slug}.webp`, PNG_BYTES), { contentType: 'image/webp' });

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.error, /WebP/i, 'envelope plano do sv360, dizendo o motivo');
    assert.match(res.body.error, /image\/png/, 'o tipo REAL detectado precisa aparecer');

    assert.ok(!existsSync(thumbDestOf(slug)), 'nenhum byte pode ter chegado ao destino permanente');
    const { rows } = await db.query('SELECT 1 FROM sv360.projects WHERE slug = $1', [slug]);
    assert.equal(rows.length, 0, 'a recusa tem de vir ANTES do ingestBundle');
  });

  it('mime mal declarado (octet-stream) com bytes de WebP → 201: a tolerância é deliberada', async () => {
    const slug = `thumb-octet-${RID}`;
    const b = bundle(slug);
    criados.push(slug);
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${adminToken()}`)
      .attach('manifest', b.manifestPath)
      .attach('imagesDb', b.imagesDbPath)
      .attach('thumbnail', writeTmp(`${slug}.bin`, WEBP_BYTES), { contentType: 'application/octet-stream' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(existsSync(thumbDestOf(slug)));
  });

  it('acima do teto PRÓPRIO do thumbnail → 400 (o teto do multer, comum aos 3 campos, deixaria passar)', async () => {
    const slug = `thumb-big-${RID}`;
    const b = bundle(slug);
    criados.push(slug);
    // 5 MiB + 1 byte, ainda com assinatura WebP: o único motivo possível de recusa é o
    // tamanho. E é MUITO menor que config.sv360.maxUploadBytes, que o multer aplica.
    const grande = Buffer.concat([WEBP_BYTES, Buffer.alloc(5 * 1024 * 1024 + 1 - WEBP_BYTES.length, 0x61)]);
    assert.ok(
      grande.length < config.sv360.maxUploadBytes,
      'o arquivo precisa caber no limite do multer, senão o teste mede a guarda errada'
    );

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${adminToken()}`)
      .attach('manifest', b.manifestPath)
      .attach('imagesDb', b.imagesDbPath)
      .attach('thumbnail', writeTmp(`${slug}.webp`, grande), { contentType: 'image/webp' });

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.error, /exceeds/);
    assert.ok(!existsSync(thumbDestOf(slug)));
    const { rows } = await db.query('SELECT 1 FROM sv360.projects WHERE slug = $1', [slug]);
    assert.equal(rows.length, 0);
  });

  it('sem thumbnail nenhum → 201 (o campo é opcional e continua sendo)', async () => {
    const slug = `thumb-none-${RID}`;
    const b = bundle(slug);
    criados.push(slug);
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${adminToken()}`)
      .attach('manifest', b.manifestPath)
      .attach('imagesDb', b.imagesDbPath);
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });
});

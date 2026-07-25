// Path: tests/integration/sv360-photo-count-drift.test.js
// photo_count SERVIDO vs. número de fotos que a API de fato entrega, quando o
// manifest tombstona uma foto do próprio photos[].
//
// DEFEITO ENCONTRADO E CORRIGIDO AQUI. mergeProject definia
// `photoCount = photos.length` com o comentário "tombstones são uma lista separada
// e não são contados como fotos vivas". A premissa é falsa, e o próprio arquivo diz
// o contrário vinte linhas abaixo: a foto soft-deletada CONTINUA em photos[] (o
// INSERT dela roda) e o tombstone só repõe a deleção que o purge acabou de limpar —
// um id fora de photos[] é DESCARTADO como estrangeiro. Ou seja, a sobreposição não
// é anomalia, é a forma normal do bundle, e o photo_count sobrecontava por
// exatamente o número de tombstones: `/sv360/projects` anunciava N enquanto
// `/photos`, `/tiles/fotos.geojson` e o MVT serviam N-k.
//
// Os testes que existiam (sv360-ingest.test.js:240, sv360-ingest-serve-e2e.test.js:236)
// afirmam photoCount == photos.length em bundles SEM sobreposição, então continuam
// verdes com a contagem certa e com a errada.
//
// CONTROLE NEGATIVO: voltar `photoCount` para `photos.length`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const RID = crypto.randomUUID().slice(0, 8);
const SLUG = `photocount-${RID}`;

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const p1 = uuidv5(`default/${SLUG}/p1.jpg`);
const p2 = uuidv5(`default/${SLUG}/p2.jpg`);

const full = Buffer.from('RIFFxxxxWEBP-photocount-full-payload');
const prev = Buffer.from('RIFFxxxxWEBP-photocount-prev');

const url = (p) => `/api/v1/sv360${p}`;

describe('StreetView 360 — photo_count publicado bate com o que a API entrega', () => {
  let app, db, tmpRoot, orgId, token, destPath;

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

  function photoRow(id, seq) {
    return {
      id,
      original_name: `${id}.jpg`,
      sequence_number: seq,
      lat: -23.5 - seq / 1000,
      lon: -46.6,
      full_size_bytes: full.length,
      preview_size_bytes: prev.length,
    };
  }

  /** Uploads photos [p1,p2] with the given deleted_photos list. */
  async function upload(nome, tombstones) {
    const manifest = {
      schemaVersion: 1,
      project: { slug: SLUG, name: 'Photo count', center_lat: -23.5, center_long: -46.6 },
      photos: [photoRow(p1, 1), photoRow(p2, 2)],
      targets: [],
      deleted_photos: tombstones,
    };
    const manifestPath = path.join(tmpRoot, `${nome}.manifest.json`);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${token}`)
      .attach('manifest', manifestPath)
      .attach('imagesDb', buildImagesDb(`${nome}.images.db`, [p1, p2]));
    assert.equal(res.status, 201, res.body?.error ?? '');
    return res.body;
  }

  /** How many features of this project the GeoJSON feed actually serves. */
  async function featuresServidas() {
    const res = await supertest(app).get(url('/tiles/fotos.geojson')).expect(200);
    return res.body.features.filter((f) => f.properties?.projectSlug === SLUG).length;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgId = org.rows[0].id;
    token = jwt.sign(
      { sub: crypto.randomUUID(), username: `pc_${RID}`, role: 'user', organization_id: orgId, org_role: 'editor' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    tmpRoot = path.join(os.tmpdir(), `sv360-photocount-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });
    destPath = path.resolve(config.sv360.dbDir, `${orgId}__${SLUG}.db`);
  });

  after(async () => {
    await closeStore();
    for (const f of [destPath, `${destPath}.tmp`, `${destPath}.bak`, destPath.replace(/\.db$/i, '.webp')]) {
      if (existsSync(f)) {
        try {
          rmSync(f, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1::text[])`, [[p1, p2]]);
    await db.query(`DELETE FROM sv360.projects WHERE slug = $1`, [SLUG]);
    await teardownTestEnv(db);
  });

  it('bundle com p2 tombstonada: photo_count = 1, e a leitura também serve 1', async () => {
    const body = await upload('tombstonado', [{ photo_id: p2 }]);
    assert.equal(body.photoCount, 1, 'a foto tombstonada não pode ser contada como viva');

    const projeto = await supertest(app).get(url(`/projects/${SLUG}`)).expect(200);
    const publicado = projeto.body.photo_count ?? projeto.body.photoCount;
    assert.equal(publicado, 1, 'o que /projects anuncia é o que /photos e /tiles entregam');
    assert.equal(await featuresServidas(), publicado, 'contagem publicada == features servidas');
  });

  it('a foto tombstonada é de fato invisível (404), confirmando de onde vem a diferença', async () => {
    // Sem esta prova, um photo_count "certo" poderia estar certo por acaso, com a
    // foto ainda visível e a contagem simplesmente errada para o outro lado.
    await supertest(app).get(url(`/photos/${p2}`)).expect(404);
    await supertest(app).get(url(`/photos/${p1}`)).expect(200);
  });

  it('reupload SEM o tombstone: photo_count volta a 2 e as duas fotos são servidas', async () => {
    // O contraste que dá sentido ao caso anterior: se photo_count fosse uma
    // constante ou estivesse zerado, este caso cairia.
    const body = await upload('sem-tombstone', []);
    assert.equal(body.photoCount, 2);

    const projeto = await supertest(app).get(url(`/projects/${SLUG}`)).expect(200);
    assert.equal(projeto.body.photo_count ?? projeto.body.photoCount, 2);
    assert.equal(await featuresServidas(), 2);
    await supertest(app).get(url(`/photos/${p2}`)).expect(200);
  });

  it('tombstone de id FORA de photos[] não mexe na contagem (é descartado como estrangeiro)', async () => {
    // O outro ramo do mesmo cálculo: só a INTERSEÇÃO com photos[] desconta. Um id
    // estrangeiro é descartado pelo merge, então descontá-lo produziria uma
    // contagem menor que a realidade — o erro espelhado do que foi corrigido.
    const alheio = uuidv5(`outra-org/outro-projeto/alheia.jpg`);
    const body = await upload('estrangeiro', [{ photo_id: alheio }]);
    assert.equal(body.photoCount, 2, 'nenhuma das fotos do bundle foi tombstonada');
    assert.equal(await featuresServidas(), 2);

    const { rows } = await db.query(`SELECT 1 FROM sv360.deleted_photos WHERE photo_id = $1`, [alheio]);
    assert.equal(rows.length, 0, 'o tombstone estrangeiro nem sequer foi persistido');
  });
});

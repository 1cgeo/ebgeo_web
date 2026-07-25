// Path: tests/integration/sv360-reupload-removal.test.js
// "Último upload manda" na direção SUBTRATIVA: um reupload que REMOVE uma foto do
// manifest. A cobertura existente (sv360-ingest.test.js:278) só exercita a direção
// aditiva — adiciona foto, muda campo, não duplica —, que passa mesmo se o purge da
// etapa 3 nunca rodasse (um INSERT ... ON CONFLICT bastaria para o caso aditivo).
//
// A direção subtrativa é a que arrisca deixar o Postgres à FRENTE do disco: o novo
// {slug}.db também não tem a foto removida, então qualquer linha sobrevivente vira
// um 404 permanente ou, pior, um link órfão saindo de uma foto viva. Os targets que
// apontavam para ela precisam ir junto (PURGE_PROJECT_TARGETS + CASCADE).
//
// CONTROLE NEGATIVO: neutralizar PURGE_PROJECT_PHOTOS (o passo 3 do merge).

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
const SLUG = `reupload-rm-${RID}`;

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

const full = Buffer.from('RIFFxxxxWEBP-reupload-removal-full-bytes');
const prev = Buffer.from('RIFFxxxxWEBP-reupload-prev');

const url = (p) => `/api/v1/sv360${p}`;

describe('StreetView 360 — reupload que REMOVE uma foto não deixa resíduo', () => {
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

  async function upload(nome, ids, targets) {
    const manifest = {
      schemaVersion: 1,
      project: { slug: SLUG, name: 'Reupload removal', center_lat: -23.5, center_long: -46.6 },
      photos: ids.map((id, i) => photoRow(id, i + 1)),
      targets,
      deleted_photos: [],
    };
    const manifestPath = path.join(tmpRoot, `${nome}.manifest.json`);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${token}`)
      .attach('manifest', manifestPath)
      .attach('imagesDb', buildImagesDb(`${nome}.images.db`, ids));
    assert.equal(res.status, 201, res.body?.error ?? '');
    return res.body;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgId = org.rows[0].id;
    token = jwt.sign(
      { sub: crypto.randomUUID(), username: `rm_${RID}`, role: 'user', organization_id: orgId, org_role: 'editor' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    tmpRoot = path.join(os.tmpdir(), `sv360-reupload-rm-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });
    destPath = path.resolve(config.sv360.dbDir, `${orgId}__${SLUG}.db`);

    // v1: p1 e p2, com o link p1 -> p2.
    const v1 = await upload('v1', [p1, p2], [
      { source_id: p1, target_id: p2, distance_m: 12, bearing_deg: 90, is_next: true, is_original: true },
    ]);
    assert.equal(v1.photoCount, 2, 'pré-condição: o projeto começa com duas fotos');
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

  it('pré-condição: em v1 as duas fotos são legíveis e o link p1 -> p2 existe', async () => {
    // Sem esta âncora, todo "sumiu" abaixo poderia significar "nunca esteve lá".
    await supertest(app).get(url(`/photos/${p1}`)).expect(200);
    await supertest(app).get(url(`/photos/${p2}`)).expect(200);
    const res = await supertest(app).get(url(`/photos/${p1}`)).expect(200);
    assert.equal(res.body.targets.length, 1, 'o link precisa existir antes da remoção');
    assert.equal(res.body.targets[0].id, p2);
  });

  it('reupload v2 só com p1: a foto removida some do Postgres e responde 404', async () => {
    const v2 = await upload('v2', [p1], []);
    assert.equal(v2.photoCount, 1);

    await supertest(app).get(url(`/photos/${p2}`)).expect(404);
    const { rows } = await db.query(`SELECT 1 FROM sv360.photos WHERE id = $1`, [p2]);
    assert.equal(rows.length, 0, 'a linha da foto removida não pode sobreviver ao purge');
  });

  it('o vizinho sobrevivente fica SEM link órfão — targets: [] e 200, não 500', async () => {
    // O modo de falha real: a foto some mas o link fica, e a leitura de p1 tenta
    // fazer JOIN com uma foto inexistente.
    const res = await supertest(app).get(url(`/photos/${p1}`)).expect(200);
    assert.deepEqual(res.body.targets, [], 'nenhum link pode apontar para a foto removida');
  });

  it('nenhuma linha em sv360.targets menciona a foto removida, em qualquer direção', async () => {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM sv360.targets WHERE source_id = $1 OR target_id = $1`,
      [p2]
    );
    assert.equal(rows[0].n, 0, 'PURGE_PROJECT_TARGETS + CASCADE precisam limpar as duas pontas');
  });

  it('photo_count e o feed de tiles concordam com a remoção', async () => {
    const projeto = await supertest(app).get(url(`/projects/${SLUG}`)).expect(200);
    assert.equal(projeto.body.photo_count ?? projeto.body.photoCount, 1);

    const geo = await supertest(app).get(url('/tiles/fotos.geojson')).expect(200);
    const doProjeto = geo.body.features.filter((f) => f.properties?.projectSlug === SLUG);
    assert.equal(doProjeto.length, 1, 'o feed não pode continuar publicando a foto removida');
    assert.equal(doProjeto[0].properties.id ?? doProjeto[0].properties.photoId ?? p1, p1);
  });

  it('a imagem da foto removida também deixa de ser servida', async () => {
    // O disco e o Postgres precisam concordar: o novo {slug}.db não tem o blob e o
    // Postgres não tem a linha, então não há caminho para 200 aqui.
    await supertest(app).get(url(`/photos/${p2}/image`)).expect(404);
    await supertest(app).get(url(`/photos/${p1}/image`)).expect(200);
  });
});

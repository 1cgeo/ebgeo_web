// Path: tests/integration/sv360-delete-project-tombstones.repro.test.js
// Repro/regressão do achado 53: o hard-delete de projeto (DELETE_PROJECT) apaga a
// linha de sv360.projects e, por CASCADE, photos e targets — mas sv360.deleted_photos
// NÃO tem FK e nenhum caminho em src/ a limpava. Os tombstones ficavam órfãos.
//
// Consequência (drift ingest x serve): o re-upload do MESMO bundle traz os MESMOS
// photo ids; mergeProject cria um project_id NOVO e só então roda PURGE_PROJECT_PHOTOS
// sobre ele, que devolve vazio — o guard `if (oldIds.length > 0)` impede a purga de
// tombstones. O ingest responde 201 com photoCount completo enquanto TODA query de
// leitura filtra a foto por NOT EXISTS(deleted_photos): a foto existe em sv360.photos
// e responde 404. Um SEGUNDO upload idêntico conserta sozinho (aí oldIds não é vazio),
// que é a assinatura do defeito.
//
// Invariantes afirmadas aqui:
//   (a) apagar o projeto NÃO deixa tombstone órfão das fotos dele;
//   (b) o PRIMEIRO re-upload já devolve a foto ressuscitada viva (200), sem depender
//       de um segundo upload.

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

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const SLUG = `tomb-orphan-${RID}`;
const p1 = uuidv5(`default/${SLUG}/foto001.jpg`);
const p2 = uuidv5(`default/${SLUG}/foto002.jpg`);

const full = Buffer.from('RIFFxxxxWEBP-TOMB-full-payload');
const prev = Buffer.from('RIFFxxxxWEBP-TOMB-prev');

const url = (p) => `/api/v1/sv360${p}`;

describe('StreetView 360 — delete de projeto não deixa tombstone órfão (achado 53)', () => {
  let app, db, defaultOrgId, ownerToken, tmpRoot, derivedDbPath;

  function photoRow(id, name, seq, lat, lon) {
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
      preview_size_bytes: prev.length,
    };
  }

  function buildBundle(tag) {
    const dbFile = path.join(tmpRoot, `${tag}.db`);
    if (existsSync(dbFile)) rmSync(dbFile, { force: true });
    const sdb = new Database(dbFile);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    const ins = sdb.prepare('INSERT INTO images VALUES (?,?,?)');
    ins.run(p1, full, prev);
    ins.run(p2, full, prev);
    sdb.close();

    const manifestFile = path.join(tmpRoot, `${tag}.json`);
    writeFileSync(
      manifestFile,
      JSON.stringify({
        schemaVersion: 1,
        project: {
          slug: SLUG,
          name: `Tomb orphan ${RID}`,
          orgSlug: 'default',
          center_lat: -23.5,
          center_long: -46.6,
          db_filename: 'ignored-by-server.db',
        },
        photos: [photoRow(p1, 'foto001.jpg', 1, -23.5, -46.6), photoRow(p2, 'foto002.jpg', 2, -23.51, -46.61)],
        targets: [],
        deleted_photos: [], // o bundle de origem não conhece a exclusão feita no servidor
      })
    );
    return { manifestFile, dbFile };
  }

  function upload(tag) {
    const { manifestFile, dbFile } = buildBundle(tag);
    return supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('manifest', manifestFile)
      .attach('imagesDb', dbFile);
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
        username: `tomb_${RID}`,
        role: 'user',
        organization_id: defaultOrgId,
        org_role: 'owner',
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    tmpRoot = path.join(os.tmpdir(), `sv360-tomb-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });
    derivedDbPath = path.resolve(config.sv360.dbDir, `${defaultOrgId}__${SLUG}.db`);
  });

  after(async () => {
    await closeStore();
    for (const f of [derivedDbPath, `${derivedDbPath}.tmp`, `${derivedDbPath}.bak`]) {
      if (f && existsSync(f)) {
        try {
          rmSync(f, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1::text[])`, [[p1, p2]]);
    await db.query(`DELETE FROM sv360.projects WHERE organization_id = $1 AND slug = $2`, [
      defaultOrgId,
      SLUG,
    ]);
    await teardownTestEnv(db);
  });

  it('apagar o projeto limpa os tombstones das fotos dele (nada órfão fica para trás)', async () => {
    await upload('v1').expect(201);

    // Soft-delete da p2 -> tombstone gravado.
    await supertest(app)
      .delete(url(`/photos/${p2}`))
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    const beforeDelete = await db.query(
      `SELECT photo_id FROM sv360.deleted_photos WHERE photo_id = $1`,
      [p2]
    );
    assert.equal(beforeDelete.rows.length, 1, 'pré-condição: o tombstone existe');

    // Hard-delete do projeto.
    await supertest(app)
      .delete(url(`/admin/projects/${SLUG}`))
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    const orphans = await db.query(
      `SELECT photo_id FROM sv360.deleted_photos WHERE photo_id = ANY($1::text[])`,
      [[p1, p2]]
    );
    assert.deepEqual(
      orphans.rows.map((r) => r.photo_id),
      [],
      'nenhum tombstone do projeto apagado pode sobreviver ao delete'
    );
  });

  it('o PRIMEIRO re-upload ressuscita a foto: 201 e a foto responde 200 (sem drift ingest x serve)', async () => {
    const res = await upload('v2').expect(201);
    assert.equal(res.body.photoCount ?? res.body.data?.photoCount, 2, 'o ingest anuncia as 2 fotos');

    // A foto antes tombstonada tem de estar VIVA já no primeiro re-upload — não só
    // depois de um segundo upload idêntico.
    await supertest(app).get(url(`/photos/${p2}`)).expect(200);
    await supertest(app).get(url(`/photos/${p2}/image?quality=full`)).expect(200);

    const geo = await supertest(app).get(url('/tiles/fotos.geojson')).expect(200);
    const ids = geo.body.features.map((f) => f.properties.id);
    assert.ok(ids.includes(p2), 'a foto ressuscitada aparece no feed de leitura');
  });

  it('o merge cura tombstone ÓRFÃO herdado (o que já existe em base antiga)', async () => {
    // A correção em deleteProject impede NOVOS órfãos, mas não apaga os que uma
    // versão anterior já deixou na base. Este é esse caso: o projeto não existe e o
    // tombstone continua lá, apontando para um id que o próximo upload vai reinserir.
    await supertest(app)
      .delete(url(`/admin/projects/${SLUG}`))
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    await db.query(`INSERT INTO sv360.deleted_photos (photo_id) VALUES ($1)`, [p2]);

    await upload('v3').expect(201);

    // Sem a purga pela UNIÃO (oldIds ∪ ids do manifesto), o projeto novo não tem
    // fotos antigas, oldIds volta vazio e o tombstone órfão sobrevive ao merge.
    const { rows } = await db.query(
      `SELECT photo_id FROM sv360.deleted_photos WHERE photo_id = ANY($1::text[])`,
      [[p1, p2]]
    );
    assert.deepEqual(rows.map((r) => r.photo_id), [], 'o merge limpou o tombstone órfão');
    await supertest(app).get(url(`/photos/${p2}`)).expect(200);
  });
});

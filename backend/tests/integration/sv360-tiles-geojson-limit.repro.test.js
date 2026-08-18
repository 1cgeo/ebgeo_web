// Path: tests/integration/sv360-tiles-geojson-limit.repro.test.js
// Repro/regressão do achado 65: GET /sv360/tiles/fotos.geojson é anônimo e serializava
// no heap TODA foto legível a cada requisição — TILES_PHOTOS não tinha LIMIT, nem
// paginação, nem predicado espacial, e a resposta não trazia Cache-Control. Com o pool
// compartilhado (DATABASE_POOL_MAX default 10) poucas requisições concorrentes seguram
// o pool e o primeiro dano colateral é o boot do frontend (fail-fast em /api/config).
//
// A rota irmã MVT prova que a omissão era específica desta query: mesmo predicado de
// acesso, mas limitada por bbox e com Cache-Control: public, max-age=60.
//
// Invariantes afirmadas: (a) existe teto de features; (b) dá para escopar por bbox;
// (c) a resposta é cacheável, e o cache NUNCA é público quando o corpo depende da
// identidade do chamador (uma foto de projeto disabled só aparece para quem pode vê-la).
// O filtro de acesso continua embutido na SQL — coberto por sv360-tiles.test.js.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser } from '../helpers/fixtures.js';

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

const SLUG = `geojson-limit-${RID}`;
const NEAR_COUNT = 12; // dentro do bbox de teste
const FAR_COUNT = 13; // fora dele
const url = (p) => `/api/v1/sv360${p}`;

// bbox estreito ao redor das fotos "near" (minLon,minLat,maxLon,maxLat).
const BBOX = '-46.61,-23.52,-46.59,-23.49';

describe('StreetView 360 — fotos.geojson tem teto, bbox e cache (achado 65)', () => {
  let app, db, orgId, projectId, adminToken;
  const nearIds = [];
  const farIds = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgId = org.rows[0].id;
    // Ator com LINHA EM `users`: a escrita do 360 passou a exigir o ESCOPO DE
    // PRODUCAO (`producer_org_id`), e a leitura o resolve no SQL a partir do UUID.
    const administrador = await createAdminUser(db, { username: `geoj_adm_${RID}` });
    adminToken = jwt.sign(
      {
        sub: administrador.id, username: `geoj_${RID}`, role: 'admin',
        organization_id: orgId, org_role: 'viewer',
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    const proj = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Geojson limit', -23.5, -46.6, $3, 'enabled', $4) RETURNING id`,
      [orgId, SLUG, `${orgId}__${SLUG}.db`, NEAR_COUNT + FAR_COUNT]
    );
    projectId = proj.rows[0].id;

    let seq = 0;
    for (let i = 0; i < NEAR_COUNT; i++) {
      const id = uuidv5(`default/${SLUG}/near${i}.jpg`);
      nearIds.push(id);
      await db.query(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, projectId, `near${i}.jpg`, ++seq, -23.5 - i * 0.0005, -46.6]
      );
    }
    for (let i = 0; i < FAR_COUNT; i++) {
      const id = uuidv5(`default/${SLUG}/far${i}.jpg`);
      farIds.push(id);
      await db.query(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, projectId, `far${i}.jpg`, ++seq, -10 - i * 0.001, -50]
      );
    }
  });

  after(async () => {
    await db.query(`DELETE FROM sv360.photos WHERE project_id = $1`, [projectId]);
    await db.query(`DELETE FROM sv360.projects WHERE id = $1`, [projectId]);
    await teardownTestEnv(db);
  });

  it('respeita ?limit (a resposta não pode ser a tabela inteira)', async () => {
    const res = await supertest(app).get(url('/tiles/fotos.geojson?limit=5')).expect(200);
    assert.equal(res.body.type, 'FeatureCollection');
    assert.ok(
      res.body.features.length <= 5,
      `esperava no máximo 5 features, veio ${res.body.features.length}`
    );
  });

  it('aplica um TETO mesmo sem ?limit (a query nunca varre sem limite)', async () => {
    const res = await supertest(app).get(url('/tiles/fotos.geojson')).expect(200);
    const { TILES_GEOJSON_MAX_FEATURES } = await import(
      '../../src/modules/streetview360/sv360.schemas.js'
    );
    assert.ok(Number.isInteger(TILES_GEOJSON_MAX_FEATURES) && TILES_GEOJSON_MAX_FEATURES > 0);
    assert.ok(res.body.features.length <= TILES_GEOJSON_MAX_FEATURES);
  });

  it('escopa por ?bbox: só as fotos dentro da janela voltam', async () => {
    const res = await supertest(app).get(url(`/tiles/fotos.geojson?bbox=${BBOX}`)).expect(200);
    const ids = res.body.features.map((f) => f.properties.id);
    // Sem isto, um `before` que não semeasse nada faria os dois laços abaixo
    // passarem verde sem comparar uma única foto.
    assert.equal(nearIds.length, NEAR_COUNT, 'as fotos dentro do bbox foram semeadas');
    assert.equal(farIds.length, FAR_COUNT, 'as fotos fora do bbox foram semeadas');
    for (const id of nearIds) assert.ok(ids.includes(id), `a foto ${id} está dentro do bbox`);
    for (const id of farIds) assert.ok(!ids.includes(id), `a foto ${id} está fora do bbox`);
  });

  it('rejeita um bbox malformado com 4xx (nada chega ao PostGIS)', async () => {
    const res = await supertest(app).get(url('/tiles/fotos.geojson?bbox=1,2,3'));
    assert.ok(res.status >= 400 && res.status < 500, `esperava 4xx, veio ${res.status}`);
    assert.equal(typeof res.body.error, 'string'); // envelope plano do módulo
  });

  it('responde com Cache-Control — público para anônimo', async () => {
    const res = await supertest(app).get(url('/tiles/fotos.geojson')).expect(200);
    assert.match(res.headers['cache-control'] ?? '', /max-age=\d+/);
    assert.match(res.headers['cache-control'] ?? '', /public/);
  });

  it('para chamador autenticado o cache é PRIVADO e varia por credencial (o corpo depende da identidade)', async () => {
    const res = await supertest(app)
      .get(url('/tiles/fotos.geojson'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.match(res.headers['cache-control'] ?? '', /private/);
    assert.doesNotMatch(res.headers['cache-control'] ?? '', /public/);
    assert.match(res.headers['vary'] ?? '', /Authorization/i);
  });
});

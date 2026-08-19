// Path: tests/integration/nomes.test.js
// Fase 3: PostGIS gazetteer (schema ng). Schema/SRID, 7-criteria search with
// dedup-by-cluster, /feicoes altitude tiebreak, auth and validation, and the
// mandatory ng.refresh_busca() post-load step.
//
// `GET /nomes/catalogo3d` NÃO aparece aqui porque a rota saiu do sistema (F15): ela
// servia `ng.catalogo_3d`, o segundo catálogo de modelo 3D, sem consumidor no
// frontend e com um eixo de permissão próprio que nenhuma rota escrevia. O catálogo
// que sobrevive é `public.tilesets`, coberto por `catalog-*.test.js`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

async function seedNome(db, nome, tipo, lon, lat, municipio = 'M', estado = 'RS') {
  await db.query(
    `INSERT INTO ng.nomes_geograficos (nome, tipo, municipio, estado, geom)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4674))`,
    [nome, tipo, municipio, estado, lon, lat]
  );
}

describe('Gazetteer (nomes geográficos)', () => {
  let app, db, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const user = await createUser(db, { username: 'nomes_user' });
    token = await loginUser(app, user.username, user.password);

    // Seed names (geom SRID 4674). Two close "Morro Teste" → same cluster.
    await seedNome(db, 'Rio de Janeiro', 'Cidade', -43.2, -22.9);
    await seedNome(db, 'Niterói', 'Cidade', -43.1, -22.88);
    await seedNome(db, 'São Paulo', 'Cidade', -46.6, -23.5);
    await seedNome(db, 'Morro Teste', 'morro', -43.2, -22.9);
    await seedNome(db, 'Morro Teste', 'morro', -43.21, -22.91); // ~1.5 km away

    // Mandatory post-load step.
    await db.query('SELECT ng.refresh_busca()');

    // Edificações (SRID 4326) — a ~20m square at (-43.2,-22.9), altitude 0..100.
    await db.query(
      `INSERT INTO ng.edificacoes (nome, tipo, altitude_base, altitude_topo, geom)
       VALUES ('Predio X', 'edificacao', 0, 100,
         ST_GeomFromText('POLYGON((-43.2001 -22.9001,-43.1999 -22.9001,-43.1999 -22.8999,-43.2001 -22.8999,-43.2001 -22.9001))', 4326))`
    );

  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('created the ng schema with correct SRIDs', async () => {
    const srid = await db.query(`SELECT Find_SRID('ng','nomes_geograficos','geom') AS s`);
    assert.equal(srid.rows[0].s, 4674);
    const sridE = await db.query(`SELECT Find_SRID('ng','edificacoes','geom') AS s`);
    assert.equal(sridE.rows[0].s, 4326);
  });

  it('tipo_peso trigger assigns weight by type', async () => {
    const cidade = await db.query(`SELECT tipo_peso FROM ng.nomes_geograficos WHERE nome='Rio de Janeiro' LIMIT 1`);
    assert.equal(Number(cidade.rows[0].tipo_peso), 1.0);
    const morro = await db.query(`SELECT tipo_peso FROM ng.nomes_geograficos WHERE nome='Morro Teste' LIMIT 1`);
    assert.equal(Number(morro.rows[0].tipo_peso), 0.8);
  });

  it('refresh_busca assigns clusters; close same-name points share a cluster', async () => {
    const r = await db.query(`SELECT cluster_id FROM ng.nomes_geograficos WHERE nome='Morro Teste'`);
    assert.equal(r.rows.length, 2);
    assert.ok(r.rows[0].cluster_id !== null);
    assert.equal(r.rows[0].cluster_id, r.rows[1].cluster_id);
  });

  it('GET /nomes/busca ranks the exact/closest match first and dedups by cluster', async () => {
    const res = await supertest(app)
      .get('/api/v1/nomes/busca')
      .query({ q: 'Rio de Janeiro', lat: -22.9, lon: -43.2, zoom: 12 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.ok(Array.isArray(res.body)); // frozen contract: bare array
    assert.ok(res.body.length >= 1);
    assert.equal(res.body[0].nome, 'Rio de Janeiro');
    assert.ok('score' in res.body[0]);
    assert.ok('longitude' in res.body[0] && 'latitude' in res.body[0]);

    // Dedup: two "Morro Teste" in one cluster -> a single result row
    const morro = await supertest(app)
      .get('/api/v1/nomes/busca')
      .query({ q: 'Morro Teste', lat: -22.9, lon: -43.2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const morros = morro.body.filter((r) => r.nome === 'Morro Teste');
    assert.equal(morros.length, 1);
  });

  it('GET /nomes/busca allows anonymous access and validates input', async () => {
    // Frozen contract: the gazetteer search is the frontend's config.search.apiUrl and
    // must work WITHOUT a token (anonymous => public-only via the embedded SQL filter).
    await supertest(app).get('/api/v1/nomes/busca').query({ q: 'Rio', lat: -22.9, lon: -43.2 }).expect(200);
    // Validation still applies on the anonymous path (q too short -> 422 before the DB).
    await supertest(app)
      .get('/api/v1/nomes/busca')
      .query({ q: 'Ri', lat: -22.9, lon: -43.2 })
      .expect(422);
  });

  it('GET /nomes/busca rejects out-of-range lat/lon with 422 (not a PostGIS 500)', async () => {
    // lat/lon feed a ::geography cast that raises "Coordinate out of range" (500) for
    // |lat|>90 / |lon|>180 — bound them at the validation border instead. 'Rio' matches
    // a seeded name so the query would reach the geography cast without the guard.
    await supertest(app)
      .get('/api/v1/nomes/busca')
      .query({ q: 'Rio', lat: 91, lon: -43.2 })
      .expect(422);
    await supertest(app)
      .get('/api/v1/nomes/busca')
      .query({ q: 'Rio', lat: -22.9, lon: 181 })
      .expect(422);
  });

  it('GET /nomes/feicoes rejects out-of-range lat/lon with 422 (not a PostGIS 500)', async () => {
    await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: -91, lon: -43.2, z: 50 })
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
    await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: -22.9, lon: -181, z: 50 })
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
  });

  it('GET /nomes/feicoes finds the building and tiebreaks by altitude', async () => {
    const inside = await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: -22.9, lon: -43.2, z: 50 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(inside.body.nome, 'Predio X');
    assert.equal(Number(inside.body.z_distance), 0);

    const above = await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: -22.9, lon: -43.2, z: 150 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(Number(above.body.z_distance), 50);

    const far = await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: -23.5, lon: -46.6, z: 50 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.ok(far.body.message);
  });

  // CONTROLE NEGATIVO da remoção: a rota do segundo catálogo 3D SUMIU, e sumiu com
  // 404 e não com 401. A distinção importa: `/catalogo3d` era auth-estrito, então um
  // 401 significaria que a rota continua montada e só recusou a credencial — o teste
  // passaria verde com a rota viva. Com token válido, 404 é a única resposta que prova
  // ausência.
  it('GET /nomes/catalogo3d nÃO existe mais (404 COM token válido, não 401)', async () => {
    const semRota = await supertest(app)
      .get('/api/v1/nomes/catalogo3d')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(semRota.status, 404, 'a rota do catálogo 3D do `ng` foi removida na F15');

    // E as irmãs continuam de pé: sem este par, "404" também é o que se mede quando o
    // router inteiro deixou de ser montado.
    await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: -22.9, lon: -43.2, z: 50 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});

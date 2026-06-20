// Path: tests/integration/nomes.test.js
// Fase 3: PostGIS gazetteer (schema ng). Schema/SRID, 7-criteria search with
// dedup-by-cluster, /feicoes altitude tiebreak, /catalogo3d full-text, auth and
// validation, and the mandatory ng.refresh_busca() post-load step.

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

    // Catálogo 3D — search_vector filled by trigger.
    await db.query(
      `INSERT INTO ng.catalogo_3d (name, description, type, palavras_chave)
       VALUES ('Posto de Comando', 'Modelo capturado por drone', 'Tiles 3D', ARRAY['comando','logistica'])`
    );
    await db.query(
      `INSERT INTO ng.catalogo_3d (name, description, type)
       VALUES ('Estátua do Soldado', 'Monumento histórico', 'Modelos 3D')`
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

  it('GET /nomes/busca requires auth and validates input', async () => {
    await supertest(app).get('/api/v1/nomes/busca').query({ q: 'Rio', lat: -22.9, lon: -43.2 }).expect(401);
    await supertest(app)
      .get('/api/v1/nomes/busca')
      .query({ q: 'Ri', lat: -22.9, lon: -43.2 }) // q too short
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

  it('GET /nomes/catalogo3d does full-text search with pagination', async () => {
    const all = await supertest(app)
      .get('/api/v1/nomes/catalogo3d')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(all.body.total, 2);
    assert.equal(all.body.page, 1);
    assert.equal(all.body.nr_records, 10);
    assert.ok(Array.isArray(all.body.data));

    const filtered = await supertest(app)
      .get('/api/v1/nomes/catalogo3d')
      .query({ q: 'comando' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.data[0].name, 'Posto de Comando');
  });
});

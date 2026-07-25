// Path: tests/integration/nomes-zones-espacial.test.js
// Itens 38 e 40 do relatório de auditoria.
//
// 38 — o filtro de acesso geográfico precisa ser GEOMÉTRICO, não de bounding box.
//      Todos os negativos espaciais que existiam usavam zona DISJUNTA, caso que um
//      filtro degradado para bbox (`uz.geom && n.geom`, ST_Intersects do envelope)
//      satisfaz igualmente. Com uma zona-donut o alvo cai DENTRO do bbox e FORA do
//      polígono: só ST_Contains de verdade esconde.
// 40 — PUT /zones/:id substitui a GEOMETRIA. O teste existente só afirmava
//      `geom.type === 'Polygon'`, verde mesmo que o UPDATE parasse de escrever geom.
//      Aqui a asserção é sobre as COORDENADAS (contra o Postgres) e sobre o efeito
//      de autorização de redesenhar a zona.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

// Anel externo -53.4/-33.0 .. -53.0/-32.8 com um buraco central
// -53.25/-32.95 .. -53.15/-32.85. O ponto (-53.2,-32.9) está no buraco: dentro
// do envelope da zona, fora do polígono.
const DONUT = {
  type: 'Polygon',
  coordinates: [
    [
      [-53.4, -33.0],
      [-53.0, -33.0],
      [-53.0, -32.8],
      [-53.4, -32.8],
      [-53.4, -33.0],
    ],
    [
      [-53.25, -32.95],
      [-53.25, -32.85],
      [-53.15, -32.85],
      [-53.15, -32.95],
      [-53.25, -32.95],
    ],
  ],
};

const TAG = `DNT${randomUUID().slice(0, 6).toUpperCase()}`;
const NO_BURACO = `Buraco ${TAG}`;
const NO_ANEL = `Anel ${TAG}`;

describe('Zonas: predicado espacial real (donut) e substituição de geometria', () => {
  let app, db;
  let user, userTok, admin, adminTok;
  let zoneId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    user = await createUser(db, { username: `donut_u_${TAG.toLowerCase()}` });
    admin = await createAdminUser(db, { username: `donut_a_${TAG.toLowerCase()}` });
    userTok = await loginUser(app, user.username, user.password);
    adminTok = await loginUser(app, admin.username, admin.password);

    // Dois nomes PRIVADOS: um no buraco do donut, outro no corpo do anel.
    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, access_level, geom)
       VALUES ($1, 'Cidade', 'private', ST_SetSRID(ST_MakePoint(-53.2,-32.9),4674)),
              ($2, 'Cidade', 'private', ST_SetSRID(ST_MakePoint(-53.35,-32.95),4674))`,
      [NO_BURACO, NO_ANEL]
    );
    await db.query('SELECT ng.refresh_busca()');

    // Duas edificações privadas nas mesmas duas posições.
    await db.query(
      `INSERT INTO ng.edificacoes (nome, tipo, altitude_base, altitude_topo, access_level, geom)
       VALUES ($1, 'edificacao', 0, 50, 'private',
                 ST_GeomFromText('POLYGON((-53.2001 -32.9001,-53.1999 -32.9001,-53.1999 -32.8999,-53.2001 -32.8999,-53.2001 -32.9001))', 4326)),
              ($2, 'edificacao', 0, 50, 'private',
                 ST_GeomFromText('POLYGON((-53.3501 -32.9501,-53.3499 -32.9501,-53.3499 -32.9499,-53.3501 -32.9499,-53.3501 -32.9501))', 4326))`,
      [`Ed ${NO_BURACO}`, `Ed ${NO_ANEL}`]
    );

    const created = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `Donut ${TAG}`, geom: DONUT })
      .expect(201);
    zoneId = created.body.data.id;

    await supertest(app)
      .put(`/api/v1/zones/${zoneId}/permissions`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ users: [user.id] })
      .expect(200);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const busca = async (token, q) => {
    const req = supertest(app).get('/api/v1/nomes/busca').query({ q, lat: -32.9, lon: -53.2 });
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.expect(200);
    assert.ok(Array.isArray(res.body), 'contrato congelado: array nu');
    return res.body;
  };

  const feicoes = async (token, lon, lat) => {
    const res = await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat, lon, z: 25 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body;
  };

  // ── Item 38 ────────────────────────────────────────────────────────────────

  it('a zona donut é geométrica: o par positivo prova que o grant existe', async () => {
    // Guarda de não-vacuidade: sem este positivo, o negativo abaixo poderia estar
    // verde só porque a permissão não foi concedida (ou porque o seed falhou).
    const nomes = await busca(userTok, NO_ANEL);
    assert.ok(
      nomes.some((r) => r.nome === NO_ANEL),
      'usuário com grant precisa ver o nome privado dentro do CORPO do anel'
    );
  });

  it('nome privado no BURACO do donut fica invisível (bbox não basta)', async () => {
    // O ponto está dentro do envelope da zona. Um filtro degradado para bbox
    // (`&&`, ST_Intersects(ST_Envelope(...))) devolveria o nome aqui.
    const nomes = await busca(userTok, NO_BURACO);
    assert.ok(
      !nomes.some((r) => r.nome === NO_BURACO),
      'ST_Contains precisa excluir o furo do polígono, não apenas o bbox'
    );
  });

  it('a geometria do teste é de fato um donut (o alvo está no bbox e fora do polígono)', async () => {
    // Prova que o caso acima discrimina de verdade: se o ponto estivesse fora do
    // envelope, o teste passaria também com um filtro de bbox e não provaria nada.
    const { rows } = await db.query(
      `SELECT ST_Contains(ST_Envelope(z.geom), ST_SetSRID(ST_MakePoint(-53.2,-32.9),4674)) AS no_bbox,
              ST_Contains(z.geom,             ST_SetSRID(ST_MakePoint(-53.2,-32.9),4674)) AS no_poligono
         FROM ng.geographic_access_zones z WHERE z.id = $1`,
      [zoneId]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].no_bbox, true, 'o alvo precisa estar DENTRO do bounding box');
    assert.equal(rows[0].no_poligono, false, 'o alvo precisa estar FORA do polígono');
  });

  it('/nomes/feicoes aplica o mesmo predicado geométrico (ST_Transform + donut)', async () => {
    const noAnel = await feicoes(userTok, -53.35, -32.95);
    assert.equal(noAnel.nome, `Ed ${NO_ANEL}`, 'edificação no corpo do anel é visível');

    const noBuraco = await feicoes(userTok, -53.2, -32.9);
    assert.ok(noBuraco.message, 'edificação no buraco não pode ser identificada');
    assert.equal(noBuraco.nome, undefined);
  });

  it('admin vê as duas edificações independentemente da geometria da zona', async () => {
    const a = await feicoes(adminTok, -53.35, -32.95);
    const b = await feicoes(adminTok, -53.2, -32.9);
    assert.equal(a.nome, `Ed ${NO_ANEL}`);
    assert.equal(b.nome, `Ed ${NO_BURACO}`);
  });

  // ── Item 40 ────────────────────────────────────────────────────────────────

  it('PUT /zones/:id realmente substitui as COORDENADAS da geometria', async () => {
    const zona = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({
        name: `Move ${TAG}`,
        geom: {
          type: 'Polygon',
          coordinates: [[[-40.0, -20.0], [-39.9, -20.0], [-39.9, -19.9], [-40.0, -19.9], [-40.0, -20.0]]],
        },
      })
      .expect(201);
    const id = zona.body.data.id;

    const novoAnel = [[-41.0, -21.0], [-40.9, -21.0], [-40.9, -20.9], [-41.0, -20.9], [-41.0, -21.0]];
    await supertest(app)
      .put(`/api/v1/zones/${id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `Move ${TAG} v2`, geom: { type: 'Polygon', coordinates: [novoAnel] } })
      .expect(200);

    // (a) pelo GET da API
    const got = await supertest(app)
      .get(`/api/v1/zones/${id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.equal(got.body.data.geom.type, 'Polygon');
    assert.deepEqual(got.body.data.geom.coordinates, [novoAnel]);

    // (b) contra o Postgres, não contra o eco do controller
    const { rows } = await db.query(
      'SELECT ST_AsGeoJSON(geom)::jsonb AS g, ST_SRID(geom) AS srid FROM ng.geographic_access_zones WHERE id = $1',
      [id]
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].g.coordinates, [novoAnel]);
    assert.equal(rows[0].srid, 4674, 'a zona continua em SIRGAS 2000');
  });

  it('redesenhar a zona move a AUTORIZAÇÃO junto (mesmo token, nada mais mudou)', async () => {
    const nomeA = `Antes ${TAG}`;
    const nomeB = `Depois ${TAG}`;
    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, access_level, geom)
       VALUES ($1, 'Cidade', 'private', ST_SetSRID(ST_MakePoint(-45.05,-25.05),4674)),
              ($2, 'Cidade', 'private', ST_SetSRID(ST_MakePoint(-46.05,-26.05),4674))`,
      [nomeA, nomeB]
    );
    await db.query('SELECT ng.refresh_busca()');

    const anelAntigo = [[-45.1, -25.1], [-45.0, -25.1], [-45.0, -25.0], [-45.1, -25.0], [-45.1, -25.1]];
    const anelNovo = [[-46.1, -26.1], [-46.0, -26.1], [-46.0, -26.0], [-46.1, -26.0], [-46.1, -26.1]];

    const zona = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `Redesenho ${TAG}`, geom: { type: 'Polygon', coordinates: [anelAntigo] } })
      .expect(201);
    const id = zona.body.data.id;
    await supertest(app)
      .put(`/api/v1/zones/${id}/permissions`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ users: [user.id] })
      .expect(200);

    const antes = await busca(userTok, nomeA);
    assert.ok(antes.some((r) => r.nome === nomeA), 'antes do PUT o usuário vê A');
    const antesB = await busca(userTok, nomeB);
    assert.ok(!antesB.some((r) => r.nome === nomeB), 'antes do PUT o usuário NÃO vê B');

    await supertest(app)
      .put(`/api/v1/zones/${id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `Redesenho ${TAG}`, geom: { type: 'Polygon', coordinates: [anelNovo] } })
      .expect(200);

    const depoisA = await busca(userTok, nomeA);
    assert.ok(!depoisA.some((r) => r.nome === nomeA), 'após o PUT o usuário perde A');
    const depoisB = await busca(userTok, nomeB);
    assert.ok(depoisB.some((r) => r.nome === nomeB), 'após o PUT o usuário ganha B');
  });

  it('PUT que muda só o name preserva as coordenadas armazenadas', async () => {
    const anel = [[-47.1, -27.1], [-47.0, -27.1], [-47.0, -27.0], [-47.1, -27.0], [-47.1, -27.1]];
    const zona = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `SoNome ${TAG}`, geom: { type: 'Polygon', coordinates: [anel] } })
      .expect(201);
    const id = zona.body.data.id;

    const put = await supertest(app)
      .put(`/api/v1/zones/${id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `SoNome ${TAG} v2`, geom: { type: 'Polygon', coordinates: [anel] } })
      .expect(200);
    assert.equal(put.body.data.name, `SoNome ${TAG} v2`);

    const { rows } = await db.query(
      'SELECT ST_AsGeoJSON(geom)::jsonb AS g FROM ng.geographic_access_zones WHERE id = $1',
      [id]
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].g.coordinates, [anel]);
  });
});

// Path: tests/integration/sv360-tiles-zoom-floor.test.js
// Piso de zoom da camada 'fotos' no tile MVT do 360 (FOTOS_MIN_ZOOM).
//
// O DEFEITO que isto tranca: tileParamsSchema aceita z de 0 a 24 e a consulta
// montava a camada de pontos em qualquer zoom. Medido no acervo real (29
// projetos, 99.040 fotos), o tile z0 saia com 10.352.008 bytes, dos quais
// 10.350.579 eram a camada 'fotos' com 99.035 pontos. Um unico pedido em z0
// serializava o acervo inteiro.
//
// O que NAO se pode fazer, e por isso este arquivo testa a AUSENCIA da camada e
// nao um 400: o mapa principal (map2d.minZoom = 1) monta 'street-view-lines' e
// 'street-view-lines-hit' sobre 'fotos_linha' SEM minzoom de camada, entao ele
// pede legitimamente tiles em z1..z10. Recusar o tile inteiro apagaria o tracado
// do mapa principal. Quem le 'fotos' e so o minimapa, criado com minZoom: 11.
//
// Por isso o contrato tem duas metades, e as duas estao aqui:
//   - em z >= FOTOS_MIN_ZOOM o tile continua identico ao de antes (pontos + linha);
//   - em z < FOTOS_MIN_ZOOM o tile perde SO os pontos e mantem o tracado.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import supertest from 'supertest';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { FOTOS_MIN_ZOOM } from '../../src/modules/streetview360/sv360.tiles.queries.js';

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

const LON = -46.61;
const LAT = -23.51;
const SLUG = 'proj-piso-zoom-sv360';

const photoId = uuidv5('default/proj-piso-zoom-sv360/foto001.jpg');
const photo2Id = uuidv5('default/proj-piso-zoom-sv360/foto002.jpg');
const photo3Id = uuidv5('default/proj-piso-zoom-sv360/foto003.jpg');

function decodeTile(buf) {
  const tile = new VectorTile(new PbfReader(buf));
  const out = {};
  for (const name of Object.keys(tile.layers)) {
    const layer = tile.layers[name];
    out[name] = [];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      out[name].push({ props: f.properties, geomType: f.type });
    }
  }
  return out;
}

function fetchTile(app, z, x, y) {
  return supertest(app)
    .get(`/api/v1/sv360/tiles/${z}/${x}/${y}.pbf`)
    .buffer()
    .parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}

// Busca o tile que cobre LON/LAT no zoom pedido.
function fetchTileAtZoom(app, z) {
  const { x, y } = lonLatToTile(LON, LAT, z);
  return fetchTile(app, z, x, y);
}

describe('StreetView 360: piso de zoom da camada de pontos', () => {
  let app, db, projectId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    const orgId = org.rows[0].id;

    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Proj Piso Zoom', $3, $4, $5, 'enabled', 2) RETURNING id`,
      [orgId, SLUG, LAT, LON, `${SLUG}.db`]
    );
    projectId = proj.rows[0].id;

    // Duas fotos: a segunda existe para que ST_MakeLine produza um tracado com
    // dois pontos, que e o que o mapa principal desenha abaixo do piso.
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele, heading)
       VALUES ($1, $2, 'foto001.jpg', 'Foto 001', 1, $3, $4, 720, 33)`,
      [photoId, projectId, LAT, LON]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele, heading)
       VALUES ($1, $2, 'foto002.jpg', 'Foto 002', 2, $3, $4, 721, 34)`,
      [photo2Id, projectId, LAT + 0.0008, LON + 0.0008]
    );

    // Uma TERCEIRA foto, longe, e o que torna o caso de zoom aberto verificavel.
    // As duas de cima distam 0,0008 grau, uns 88 m. Em z=2 um tile cobre 90 graus
    // de longitude em 4096 unidades, entao 88 m viram 0,04 unidade: a linha
    // colapsa num ponto, ST_AsMVTGeom devolve NULL e o `t.geom IS NOT NULL` a
    // descarta. Isso e resolucao do tile, nao o piso agindo. No acervo real o
    // caso nao aparece porque um levantamento atravessa quilometros (medido em
    // alegrete: o z2 traz 5.926 bytes de tracado). Meio grau, uns 55 km, e a
    // menor distancia que sobrevive a quantizacao de z=2 com folga.
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele, heading)
       VALUES ($1, $2, 'foto003.jpg', 'Foto 003', 3, $3, $4, 722, 35)`,
      [photo3Id, projectId, LAT + 0.5, LON + 0.5]
    );
  });

  after(async () => {
    await db.query(`DELETE FROM sv360.photos WHERE project_id = $1`, [projectId]);
    await db.query(`DELETE FROM sv360.projects WHERE id = $1`, [projectId]);
    await teardownTestEnv(db);
  });

  // --- o piso nao pode subir acima do minZoom do minimapa --------------------

  it('o piso vale para o minimapa, que e criado com minZoom 11', () => {
    // add_street_view_control.js cria o minimapa com minZoom: 11, e o minimapa e
    // o UNICO leitor da camada 'fotos' (camadas 'points', 'selected', 'hovered').
    // Um piso acima de 11 deixa o minimapa sem ponto nenhum no seu zoom minimo.
    assert.ok(
      FOTOS_MIN_ZOOM <= 11,
      `o piso (${FOTOS_MIN_ZOOM}) nao pode passar do minZoom 11 do minimapa`
    );
    assert.ok(FOTOS_MIN_ZOOM >= 1, 'um piso de 0 nao filtra nada');
  });

  // --- em z >= piso, nada muda ----------------------------------------------

  it('no proprio piso o tile ainda traz a camada de pontos', async () => {
    const res = await fetchTileAtZoom(app, FOTOS_MIN_ZOOM);
    assert.equal(res.status, 200);
    const layers = decodeTile(res.body);
    assert.ok(layers.fotos, `camada 'fotos' presente em z=${FOTOS_MIN_ZOOM}`);
    const ids = layers.fotos.map((f) => f.props.id);
    assert.ok(ids.includes(photoId), 'a foto semeada esta no tile');
    assert.equal(layers.fotos.find((f) => f.props.id === photoId).geomType, 1, 'ponto');
  });

  it('acima do piso o tile continua trazendo pontos e tracado', async () => {
    const res = await fetchTileAtZoom(app, FOTOS_MIN_ZOOM + 1);
    assert.equal(res.status, 200);
    const layers = decodeTile(res.body);
    const ids = (layers.fotos || []).map((f) => f.props.id);
    assert.ok(ids.includes(photoId), "camada 'fotos' presente acima do piso");
    const slugs = (layers.fotos_linha || []).map((l) => l.props.projectSlug);
    assert.ok(slugs.includes(SLUG), "camada 'fotos_linha' presente acima do piso");
  });

  // --- em z < piso, some so a camada de pontos ------------------------------

  it('logo abaixo do piso a camada de pontos some, e o tracado FICA', async () => {
    const z = FOTOS_MIN_ZOOM - 1;
    const res = await fetchTileAtZoom(app, z);
    assert.equal(res.status, 200);
    const layers = decodeTile(res.body);

    // GUARDA: sem esta linha, um tile vazio (semeadura quebrada, decode quebrado,
    // filtro de acesso rejeitando tudo) satisfaria a ausencia de 'fotos' sozinho.
    // O tracado PRECISA estar la para a ausencia dos pontos querer dizer algo.
    const slugs = (layers.fotos_linha || []).map((l) => l.props.projectSlug);
    assert.ok(slugs.includes(SLUG), `guarda: o tracado deve estar no tile em z=${z}`);
    assert.equal(
      layers.fotos_linha.find((l) => l.props.projectSlug === SLUG).geomType,
      2,
      'linha'
    );

    assert.ok(!layers.fotos, `camada 'fotos' ausente em z=${z}`);
  });

  it('num zoom bem aberto o tile carrega so o tracado', async () => {
    const z = 2;
    assert.ok(z < FOTOS_MIN_ZOOM, 'o caso so faz sentido abaixo do piso');
    const res = await fetchTileAtZoom(app, z);
    assert.equal(res.status, 200);
    const layers = decodeTile(res.body);

    const slugs = (layers.fotos_linha || []).map((l) => l.props.projectSlug);
    assert.ok(slugs.includes(SLUG), 'guarda: o mapa principal ainda recebe o tracado em z=2');
    assert.ok(!layers.fotos, "camada 'fotos' ausente em z=2");
  });

  it('o tile abaixo do piso continua sendo 200, nunca 400', async () => {
    // A origem (ebgeo_360) recusa z fora de 11..12 com HTTP 400. Aqui isso
    // apagaria o tracado do mapa principal, que pede z1..z10. O contrato desta
    // casa e servir o tile sem os pontos.
    for (const z of [0, 5, FOTOS_MIN_ZOOM - 1]) {
      const res = await fetchTileAtZoom(app, z);
      assert.equal(res.status, 200, `z=${z} deve responder 200`);
      assert.equal(
        res.headers['content-type'],
        'application/vnd.mapbox-vector-tile',
        `z=${z} deve manter o content-type do MVT`
      );
    }
  });
});

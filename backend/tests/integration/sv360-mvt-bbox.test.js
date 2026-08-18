// Path: tests/integration/sv360-mvt-bbox.test.js
//
// O bbox DENTRO DA CTE (fase F9, item 5) — as propriedades que a reescrita podia
// quebrar em silêncio.
//
// O QUE MUDOU. `MVT_TILE` tinha UMA CTE `visible` juntando fotos e projetos, com o
// predicado de acesso e SEM filtro espacial; o bbox só entrava nos consumidores.
// Referenciada quatro vezes, ela era MATERIALIZADA, e o plano medido no acervo real
// (29 projetos, 99.040 fotos) era um `Seq Scan on photos` inteiro com `Rows Removed
// by Join Filter: 98.796` para 239 sobreviventes — o índice GiST nunca era usado, e
// um tile VAZIO custava ~290 ms. Hoje são três CTEs: projetos visíveis (o predicado
// roda 29 vezes, não 99.040), fotos DAQUELES projetos dentro do tile, e a trajetória
// sintetizada à parte.
//
// MEDIDO, EM SÉRIE (8 execuções por tile, banco de bancada com o acervo real,
// `SET jit = off`, p50 em ms):
//
//   tile                antes    depois
//   alegrete z0          172      13,8
//   alegrete z6          164      13,6
//   alegrete z11         203      22,0
//   alegrete z12         254      10,9
//   alegrete z14         166       5,0
//   aman z11             320      27,2
//   aman z14 (vazio)     296       4,8
//
// EQUIVALÊNCIA MEDIDA À PARTE: 1.424 comparações (grades de tiles em z0..z18 sobre
// três projetos, escopo anônimo e autenticado), decodificando os dois tiles e
// comparando o CONJUNTO de feições — ZERO divergências. Os BYTES divergiram em 220
// delas, e isso é esperado: `ST_AsMVT` não tem `ORDER BY`, então a ordem das feições
// dentro da camada acompanha o plano. É por isso que NENHUM caso aqui compara bytes
// nem afirma um ETag literal.
//
// O QUE ESTE ARQUIVO PRENDE são as três propriedades que a separação em CTEs poderia
// ter perdido, e que a suíte de MVT existente NÃO cobria porque nenhuma delas
// aparecia enquanto a CTE era uma só:
//   1. a foto FORA do tile não entra, e a de DENTRO entra (o bbox de fato filtra);
//   2. a trajetória SINTETIZADA (projeto sem `sv360.tracks`) atravessa o tile mesmo
//      quando NENHUMA foto dele cai lá dentro — foi a razão de não podar aquela CTE;
//   3. um projeto com track e SEM foto viva não desenha linha (a condição que a CTE
//      antiga implicava por construção e a nova precisa dizer em voz alta).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import supertest from 'supertest';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { FOTOS_MIN_ZOOM } from '../../src/modules/streetview360/sv360.tiles.queries.js';

const Z = 14;

/** x/y do tile web-mercator que contém (lon, lat) no zoom Z. */
function tileOf(lon, lat, z = Z) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
  };
}

/** Centro (lon, lat) de um tile z/x/y — usado para posicionar as fotos com precisão. */
function centerOf(x, y, z = Z) {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  return { lon, lat: (latRad * 180) / Math.PI };
}

function decodeTile(buf) {
  const tile = new VectorTile(new PbfReader(buf));
  const out = {};
  for (const nome of Object.keys(tile.layers)) {
    const layer = tile.layers[nome];
    out[nome] = [];
    for (let i = 0; i < layer.length; i += 1) out[nome].push(layer.feature(i).properties);
  }
  return out;
}

describe('F9 — o bbox dentro da CTE do MVT preserva o conjunto de feições', () => {
  let app, db, orgId;
  let projComTrack, projSemTrack, projVazio;
  const sufixo = crypto.randomUUID().slice(0, 8);
  const SLUG_TRACK = `bbox-tr-${sufixo}`;
  const SLUG_SEM = `bbox-st-${sufixo}`;
  const SLUG_VAZIO = `bbox-vz-${sufixo}`;
  const fotoDentroId = crypto.randomUUID();
  const fotoForaId = crypto.randomUUID();
  const fotoOesteId = crypto.randomUUID();
  const fotoLesteId = crypto.randomUUID();

  // O tile ALVO e o vizinho imediato a leste, ambos em z14 sobre um ponto sem acervo.
  const ALVO = tileOf(-47.9, -15.79);
  const VIZINHO = { x: ALVO.x + 1, y: ALVO.y };
  const centroAlvo = centerOf(ALVO.x, ALVO.y);
  const centroVizinho = centerOf(VIZINHO.x, VIZINHO.y);
  // Os dois tiles a OESTE e a LESTE do alvo, para a linha que o ATRAVESSA sem tocá-lo.
  const centroOeste = centerOf(ALVO.x - 1, ALVO.y);
  const centroLeste = centerOf(ALVO.x + 1, ALVO.y);

  const tile = (x, y, z = Z) => {
    const req = supertest(app).get(`/api/v1/sv360/tiles/${z}/${x}/${y}.pbf`);
    return req.buffer().parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  };

  const camadas = async (x, y, z = Z) => decodeTile((await tile(x, y, z).expect(200)).body);

  const novoProjeto = async (slug) => {
    const { rows } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'public', $5, $6, 0) RETURNING id`,
      [orgId, slug, `Projeto ${slug}`, `${orgId}__${slug}.db`, centroAlvo.lat, centroAlvo.lon]
    );
    return rows[0].id;
  };

  const novaFoto = async (id, projectId, seq, lon, lat) => {
    await db.query(
      `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon, geom, floor_level)
       VALUES ($1, $2, $3, $4, $6, $5, ST_SetSRID(ST_MakePoint($5, $6), 4326), 0)`,
      [id, projectId, `${id}.jpg`, seq, lon, lat]
    );
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM bbox ${sufixo}`, `ombbox-${sufixo}`, `B${sufixo.slice(0, 4)}`]
    );
    orgId = orgs[0].id;

    // (1) Projeto COM track: uma foto DENTRO do tile alvo e uma no vizinho.
    projComTrack = await novoProjeto(SLUG_TRACK);
    await novaFoto(fotoDentroId, projComTrack, 1, centroAlvo.lon, centroAlvo.lat);
    await novaFoto(fotoForaId, projComTrack, 2, centroVizinho.lon, centroVizinho.lat);
    await db.query(
      `INSERT INTO sv360.tracks (project_id, geom)
       VALUES ($1, ST_SetSRID(ST_MakeLine(ST_MakePoint($2, $3), ST_MakePoint($4, $5)), 4326))`,
      [projComTrack, centroAlvo.lon, centroAlvo.lat, centroVizinho.lon, centroVizinho.lat]
    );

    // (2) Projeto SEM track, com as duas fotos FORA do tile alvo, uma de cada lado: a
    // trajetória SINTETIZADA atravessa o alvo sem que nenhuma foto caia nele.
    projSemTrack = await novoProjeto(SLUG_SEM);
    await novaFoto(fotoOesteId, projSemTrack, 1, centroOeste.lon, centroOeste.lat);
    await novaFoto(fotoLesteId, projSemTrack, 2, centroLeste.lon, centroLeste.lat);

    // (3) Projeto com track e SEM nenhuma foto viva.
    projVazio = await novoProjeto(SLUG_VAZIO);
    await db.query(
      `INSERT INTO sv360.tracks (project_id, geom)
       VALUES ($1, ST_SetSRID(ST_MakeLine(ST_MakePoint($2, $3), ST_MakePoint($4, $5)), 4326))`,
      [projVazio, centroAlvo.lon, centroAlvo.lat, centroVizinho.lon, centroVizinho.lat]
    );
  });

  after(async () => {
    await db.query('DELETE FROM sv360.projects WHERE organization_id = $1', [orgId]);
    await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await teardownTestEnv(db);
  });

  it('o bbox filtra: a foto de dentro entra, a do tile vizinho não', async () => {
    const alvo = await camadas(ALVO.x, ALVO.y);
    const ids = (alvo.fotos ?? []).map((f) => f.id);
    assert.ok(ids.includes(fotoDentroId), 'a foto do tile alvo precisa estar nele');
    assert.ok(!ids.includes(fotoForaId), 'a foto do tile vizinho não pode vazar para o alvo');

    // O PAR, no tile vizinho, e ele é o que impede a leitura "o filtro apagou tudo":
    // as duas fotos são do MESMO projeto, então só o bbox as separa.
    const vizinho = await camadas(VIZINHO.x, VIZINHO.y);
    const idsVizinho = (vizinho.fotos ?? []).map((f) => f.id);
    assert.ok(idsVizinho.includes(fotoForaId));
    assert.ok(!idsVizinho.includes(fotoDentroId));
  });

  it('a trajetória SINTETIZADA atravessa o tile mesmo sem nenhuma foto dentro dele', async () => {
    // A PROPRIEDADE QUE PROÍBE PODAR A CTE SINTETIZADA. Se ela fosse construída a
    // partir das fotos já filtradas pelo bbox, este projeto — cujas duas fotos ficam
    // nos tiles vizinhos — perderia a linha exatamente no tile do meio, e o mapa
    // desenharia um buraco na rota.
    const alvo = await camadas(ALVO.x, ALVO.y);
    assert.ok(
      (alvo.fotos_linha ?? []).some((l) => l.projectSlug === SLUG_SEM),
      'a linha sintetizada precisa cruzar o tile onde o projeto não tem foto nenhuma'
    );
    // Discriminação: nenhum PONTO dele aparece aqui — é linha, e só.
    const ids = (alvo.fotos ?? []).map((f) => f.id);
    assert.ok(!ids.includes(fotoOesteId) && !ids.includes(fotoLesteId));
  });

  it('a track REAL continua desenhada, e o projeto sem foto viva não desenha nenhuma', async () => {
    const alvo = await camadas(ALVO.x, ALVO.y);
    const slugs = (alvo.fotos_linha ?? []).map((l) => l.projectSlug);
    assert.ok(slugs.includes(SLUG_TRACK), 'o projeto com track importada desenha a track');
    // A EQUIVALÊNCIA QUE A CTE NOVA PRECISOU DIZER EM VOZ ALTA: a forma antiga lia a
    // trajetória da CTE de FOTOS, então um projeto sem foto viva não produzia linha.
    // Sem o `EXISTS` de `visible_projects`, este slug apareceria.
    assert.ok(!slugs.includes(SLUG_VAZIO), 'projeto sem foto viva não desenha track');
  });

  it('a foto TOMBSTONADA sai das duas camadas, e o projeto inteiro sai com a última', async () => {
    await db.query(
      `INSERT INTO sv360.deleted_photos (photo_id) VALUES ($1)`, [fotoDentroId]
    );
    try {
      const alvo = await camadas(ALVO.x, ALVO.y);
      assert.ok(!(alvo.fotos ?? []).map((f) => f.id).includes(fotoDentroId));
      // A track continua: o projeto ainda tem a outra foto viva.
      assert.ok((alvo.fotos_linha ?? []).map((l) => l.projectSlug).includes(SLUG_TRACK));

      await db.query(
        `INSERT INTO sv360.deleted_photos (photo_id) VALUES ($1)`, [fotoForaId]
      );
      const semNenhuma = await camadas(ALVO.x, ALVO.y);
      assert.ok(
        !(semNenhuma.fotos_linha ?? []).map((l) => l.projectSlug).includes(SLUG_TRACK),
        'apagada a última foto viva, a track do projeto some junto'
      );
    } finally {
      await db.query('DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1::text[])',
        [[fotoDentroId, fotoForaId]]);
    }
  });

  it('o piso de zoom continua valendo, e agora ele mora na CTE das fotos', async () => {
    // O piso mudou de LUGAR (era o primeiro termo do `WHERE` da subconsulta de pontos,
    // agora é a primeira condição da CTE) e não pode ter mudado de EFEITO: abaixo dele
    // o tile carrega a linha e nenhum ponto.
    const z = FOTOS_MIN_ZOOM - 1;
    const baixo = tileOf(centroAlvo.lon, centroAlvo.lat, z);
    const c = await camadas(baixo.x, baixo.y, z);
    assert.equal((c.fotos ?? []).length, 0, 'abaixo do piso não sai ponto nenhum');
    assert.ok(
      (c.fotos_linha ?? []).map((l) => l.projectSlug).includes(SLUG_TRACK),
      'e a linha continua saindo, que é a razão de o piso não ser um 400'
    );

    // O par, um zoom acima: os pontos voltam.
    const noPiso = tileOf(centroAlvo.lon, centroAlvo.lat, FOTOS_MIN_ZOOM);
    const d = await camadas(noPiso.x, noPiso.y, FOTOS_MIN_ZOOM);
    assert.ok((d.fotos ?? []).map((f) => f.id).includes(fotoDentroId));
  });
});

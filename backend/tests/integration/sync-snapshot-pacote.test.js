// Path: tests/integration/sync-snapshot-pacote.test.js
//
// O PACOTE DE STATEMENTS do snapshot, e as duas coisas que podem quebra-lo em silencio.
//
// O QUE MUDOU. `getAtlasSnapshot` roda dentro de um `task()`, que retem UMA conexao do pool
// (`config.db.poolMax`, 10) do inicio ao fim. Eram TREZE consultas em serie nessa conexao. Nove
// delas nao dependiam de nada alem do `atlasId`, e agora viajam num pacote unico (`t.multi`).
// Restam CINCO idas: metadata, maps, comments (condicional), o pacote, e as definicoes de
// catalogo (condicionais, e dependentes do resultado das catalog_layers).
//
// POR QUE NAO `Promise.all`, que e a armadilha que este arquivo existe para lembrar. Um
// `Promise.all` sobre `t.query` nao paralelizaria NADA: o protocolo do Postgres e
// pergunta-e-resposta por conexao, e o `task` tem uma so. As nove seriam enfileiradas e
// executadas em serie exatamente como antes, com o codigo afirmando o contrario. `t.multi`
// manda os statements num pacote e recebe os conjuntos de resultado de volta.
//
// AS DUAS PROVAS AQUI, e a segunda e a que pega o defeito silencioso:
//
//   1. A CONTAGEM. `db.$config.options.query` conta as idas de verdade. Numero absoluto, de
//      proposito: e uma trava contra a proxima consulta solta que alguem acrescentar no meio do
//      caminho quente. (`snapshot-n-mais-1.repro.test.js` guarda outra propriedade, a de que o
//      custo nao CRESCE com o numero de mapas, e continua sendo dele essa tarefa.)
//
//   2. A ORDEM. O retorno de `t.multi` e um array na ordem dos statements. Inserir um statement
//      no meio desloca tudo abaixo EM SILENCIO, e o sintoma seria `features` recebendo as linhas
//      de `groups`. Isso passa em qualquer teste de CONTAGEM e falha so no conteudo. Por isso o
//      atlas semeado aqui tem conteudo DISTINGUIVEL em cada uma das nove colecoes: se elas
//      deslizarem uma casa, o conteudo denuncia.
//
// CONTROLE NEGATIVO, rodado a mao antes de gravar, e o primeiro resultado corrigiu o desenho:
//
//   - TROCAR duas linhas inteiras de `COLECOES_DO_SNAPSHOT` (nome e SQL juntos) NAO reprova, e
//     nao deve mesmo. A lista e de PARES exatamente para que reordenar seja inofensivo. O
//     comentario que dizia o contrario estava errado, e so rodar o controle mostrou isso.
//   - QUEBRAR O PAR reprova: pondo `['layers', Q.GET_ATLAS_GROUPS]`, o caso de conteudo cai com
//     "layers: conteudo trocado". E este o defeito silencioso de verdade.
//   - Devolver qualquer das nove para um `t.query` proprio sobe a contagem e reprova o primeiro
//     caso.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas } from '../helpers/fixtures.js';
import { db } from '../../src/database/index.js';
import * as syncService from '../../src/modules/sync/sync.service.js';

/**
 * Conta as idas ao banco durante `fn`, pelo gancho de evento do pg-promise.
 *
 * `t.multi` dispara o evento UMA vez, com os statements ja concatenados, que e exatamente a
 * propriedade medida: um pacote e uma ida. As opcoes vivem em `db.$config.options`.
 */
async function contarIdas(fn) {
  const opts = db.$config.options;
  const original = opts.query;
  let n = 0;
  const stmts = [];
  opts.query = (e) => {
    n += 1;
    stmts.push(String(e.query).replace(/\s+/g, ' ').trim().slice(0, 80));
  };
  try {
    await fn();
  } finally {
    opts.query = original;
  }
  return { n, stmts };
}

describe('snapshot: as nove colecoes independentes viajam num pacote so', () => {
  let cli;
  let atlas;
  let atlasComCatalogo;
  let mapaId;
  let briefingId;
  let camadaDeCatalogoId;
  let feicaoId;

  before(async () => {
    const env = await setupTestEnv();
    cli = env.db;
    const dono = await createUser(cli, { username: `pac_${randomUUID().slice(0, 8)}` });

    // ---- atlas com conteudo DISTINGUIVEL em cada coleção do pacote -------------------
    atlas = await createAtlas(cli, dono.id, { name: `Pacote ${randomUUID().slice(0, 6)}` });
    mapaId = randomUUID();
    await cli.query(`INSERT INTO maps (id, atlas_id, name, version) VALUES ($1, $2, 'M', 1)`,
      [mapaId, atlas.id]);

    const camadaId = randomUUID();
    await cli.query(
      `INSERT INTO layers (id, map_id, name, sort_order, version) VALUES ($1, $2, 'CAMADA', 0, 1)`,
      [camadaId, mapaId],
    );
    const grupoId = randomUUID();
    await cli.query(`INSERT INTO groups (id, map_id, name, version) VALUES ($1, $2, 'GRUPO', 1)`,
      [grupoId, mapaId]);
    feicaoId = randomUUID();
    await cli.query(
      `INSERT INTO features (id, map_id, feature_type, geometry, properties, layer_id, version)
       VALUES ($1, $2, 'point', $3, $4, $5, 1)`,
      [feicaoId, mapaId, JSON.stringify({ type: 'Point', coordinates: [-43, -22] }),
        JSON.stringify({ marca: 'FEICAO' }), camadaId],
    );
    await cli.query(`INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)`,
      [grupoId, feicaoId]);
    await cli.query(
      `INSERT INTO cesium3d_data (id, map_id, data_type, tileset_id, data, version)
       VALUES ($1, $2, 'marker', 'TILESET', $3, 1)`,
      [randomUUID(), mapaId, JSON.stringify({ marca: 'CESIUM' })],
    );
    await cli.query(
      `INSERT INTO streetview360_data (id, map_id, data_type, photo_name, data, version)
       VALUES ($1, $2, 'orientation', 'FOTO', $3, 1)`,
      [randomUUID(), mapaId, JSON.stringify({ marca: 'SV360' })],
    );
    camadaDeCatalogoId = `hillshade-${randomUUID()}`;
    await cli.query(
      `INSERT INTO catalog_layers (id, map_id, data, version) VALUES ($1, $2, $3, 1)`,
      // `type: 'hillshade'` NAO e um recurso de catalogo (catalog-layer.ref.js), entao esta
      // linha nao dispara a consulta de definicoes. E o que mantem este atlas em CINCO idas
      // menos uma: a dependencia de dado tem o seu proprio caso, abaixo.
      [camadaDeCatalogoId, mapaId, JSON.stringify({ type: 'hillshade', marca: 'CATALOGO' })],
    );
    briefingId = randomUUID();
    const slideId = randomUUID();
    await cli.query(
      `INSERT INTO briefings (id, atlas_id, name, slide_order, version) VALUES ($1, $2, 'BRIEF', $3, 1)`,
      [briefingId, atlas.id, [slideId]],
    );
    await cli.query(
      `INSERT INTO slides (id, briefing_id, title, content, mode, version)
       VALUES ($1, $2, 'SLIDE', '', '2d', 1)`,
      [slideId, briefingId],
    );
    await cli.query(
      `INSERT INTO comments (id, atlas_id, map_id, author_id, lng, lat, status, data, version)
       VALUES ($1, $2, $3, $4, -43, -22, 'open', $5, 1)`,
      [randomUUID(), atlas.id, mapaId, dono.id, JSON.stringify({ marca: 'COMENTARIO' })],
    );

    // ---- atlas cuja camada de catalogo REFERENCIA um recurso: a unica dependencia de dado --
    atlasComCatalogo = await createAtlas(cli, dono.id, { name: `Cat ${randomUUID().slice(0, 6)}` });
    const mapa2 = randomUUID();
    await cli.query(`INSERT INTO maps (id, atlas_id, name, version) VALUES ($1, $2, 'M2', 1)`,
      [mapa2, atlasComCatalogo.id]);
    await cli.query(
      `INSERT INTO catalog_layers (id, map_id, data, version) VALUES ($1, $2, $3, 1)`,
      // O prefixo `data-` e o `type` sao o que fazem `catalogLayerResourceRef` devolver uma
      // referencia, e e a referencia que obriga a consulta extra.
      [`data-${randomUUID()}`, mapa2, JSON.stringify({ type: 'data_layer', name: 'X' })],
    );
  });

  after(async () => {
    await teardownTestEnv(cli);
  });

  it('custa 4 idas ao banco para um dono, e 3 para um leitor', async () => {
    const dono = await contarIdas(() => syncService.getAtlasSnapshot(atlas.id, 'owner'));
    assert.equal(
      dono.n, 4,
      `esperava 4 idas (metadata, maps, comments, pacote); deu ${dono.n}:\n  ${dono.stmts.join('\n  ')}`,
    );

    // Sem comentarios: o leitor nao os recebe, entao aquela ida some.
    const leitor = await contarIdas(() => syncService.getAtlasSnapshot(atlas.id, 'read'));
    assert.equal(
      leitor.n, 3,
      `esperava 3 idas para 'read'; deu ${leitor.n}:\n  ${leitor.stmts.join('\n  ')}`,
    );
  });

  it('a quinta ida so aparece quando ha referencia de catalogo para resolver', async () => {
    const r = await contarIdas(() => syncService.getAtlasSnapshot(atlasComCatalogo.id, 'owner'));
    assert.equal(
      r.n, 5,
      `esperava 5 idas com referencia de catalogo; deu ${r.n}:\n  ${r.stmts.join('\n  ')}`,
    );
  });

  it('uma ida so quando o atlas nao existe: o curto-circuito continua de pe', async () => {
    const r = await contarIdas(() => syncService.getAtlasSnapshot(randomUUID()));
    assert.equal(r.n, 1, `atlas inexistente deveria custar 1 ida; deu ${r.n}`);
  });

  it('cada conjunto de resultado cai na sua colecao: a ordem do pacote e contrato', async () => {
    const snap = await syncService.getAtlasSnapshot(atlas.id, 'owner');
    const mapa = snap.maps.find((m) => m.id === mapaId);
    assert.ok(mapa, 'o mapa semeado voltou');

    // Nove afirmacoes, uma por statement do pacote. Um deslocamento de UMA casa reprova
    // varias delas ao mesmo tempo, e e por isso que o conteudo e distinguivel.
    assert.equal(mapa.features.points.length, 1, 'features');
    assert.equal(mapa.features.points[0].properties.marca, 'FEICAO', 'features: conteudo trocado');
    assert.equal(mapa.cesium3d.markers.length, 1, 'cesium3d');
    assert.equal(Object.keys(mapa.streetview360.orientations).length, 1, 'streetview360');
    assert.equal(mapa.catalogLayers.length, 1, 'catalog_layers');
    assert.equal(mapa.catalogLayers[0].id, camadaDeCatalogoId, 'catalog_layers: conteudo trocado');
    assert.equal(mapa.layers.length, 1, 'layers');
    assert.equal(mapa.layers[0].name, 'CAMADA', 'layers: conteudo trocado');
    assert.equal(mapa.groups.length, 1, 'groups');
    assert.equal(mapa.groups[0].name, 'GRUPO', 'groups: conteudo trocado');
    assert.equal(mapa.groups[0].features.length, 1, 'group_features');
    assert.equal(mapa.groups[0].features[0].id, feicaoId, 'group_features: alvo');
    assert.equal(snap.briefings.length, 1, 'briefings');
    assert.equal(snap.briefings[0].name, 'BRIEF', 'briefings: conteudo trocado');

    // SLIDES AGRUPAM POR `briefing_id`, nunca por `map_id`. O `agrupar` tem `map_id` como
    // default, e um slide de modo 3D pode nem ter mapa: perder o segundo argumento na mudanca
    // devolveria todo briefing com zero slides, calado.
    assert.equal(snap.briefings[0].slides.length, 1, 'slides: agrupados por briefing_id?');
    assert.equal(snap.briefings[0].slides[0].title, 'SLIDE', 'slides: conteudo trocado');

    // E a coleção que NAO esta no pacote, para que o caso cubra a fronteira inteira.
    assert.equal(mapa.comments.length, 1, 'comments');
    assert.equal(mapa.comments[0].marca, 'COMENTARIO', 'comments: conteudo trocado');
  });
});

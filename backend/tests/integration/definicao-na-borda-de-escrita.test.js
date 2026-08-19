// Path: tests/integration/definicao-na-borda-de-escrita.test.js
//
// F14 — A DECISÃO SOBRE O QUE É DEFINIÇÃO DEIXA DE SER UM CARIMBO DO CLIENTE.
//
// A F13 tornou a poda ESTRUTURAL na saída (um middleware acima de toda rota, a primeira linha do
// `onConnection` do WS). Sobraram dois furos que a revisão adversarial mediu com visitante ANÔNIMO
// de link público, e este arquivo é o par de repros deles.
//
//   V-A — A ISENÇÃO ERA CONCEDIDA NO CONTÊINER. A reidratação marcava o NÓ servido como
//         autorizado, e a travessia devolvia o nó INTEIRO, com toda chave que o cliente pusera
//         dentro. Uma definição da camada PRIVADA, plantada sob `styleOverrides` de uma entrada
//         PÚBLICA (que o visitante tem direito de ver, logo reidratada, logo marcada), saía na
//         resposta. Agora a marca cobre o CAMPO que o servidor montou, e a entrada ao redor é
//         caminhada como qualquer outra carga.
//
//   V-B — O CAMPO JSONB LIVRE ERA UM CANAL DE REPUBLICAÇÃO. Nada podava um objeto
//         `{name, config:{source:{url}}}` sem `type`, e a saída não pode podá-lo (a forma é a
//         mesma do hillshade e da listagem REST do catálogo). A resposta é a doutrina da casa:
//         restringir o que se ACEITA ESCREVER. O que se mede aqui é o BANCO, não só a resposta: o
//         critério de sucesso da fase é que a definição não possa ser ARMAZENADA.
//
// O PAR É OBRIGATÓRIO EM CADA CASO: uma borda que apagasse o payload inteiro passaria em todo
// negativo. Cada caso afirma também o que continua chegando.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser, makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

const sufixo = randomUUID().slice(0, 8);
const PRIVADA = `f14-priv-${sufixo}`;
const PUBLICA = `f14-pub-${sufixo}`;
const ID_PRIVADA = `analysis-${PRIVADA}`;
const ID_PUBLICA = `analysis-${PUBLICA}`;

// TRÊS URLs DISTINTAS, e a distinção é o que dá poder de discriminação ao arquivo: procurar a
// privada num snapshot que só tivesse a pública ficaria verde sem medir nada.
const URL_PRIVADA_VIVA = `/tiles/${sufixo}/privada-viva/{z}/{x}/{y}.pbf`;
const URL_PUBLICA_VIVA = `/tiles/${sufixo}/publica-viva/{z}/{x}/{y}.pbf`;
const URL_CONTRABANDO = `/tiles/${sufixo}/contrabando/{z}/{x}/{y}.pbf`;

/** A definição NUA: sem `type`, que é exatamente o que a poda de saída não alcança. */
const contrabando = () => ({
  name: 'Camada restrita copiada',
  config: { source: { type: 'vector', url: URL_CONTRABANDO } },
});

/**
 * A MESMA definição, CARIMBADA, que é a forma da revisão adversarial da F13 e a única que um
 * cliente real escreve (`pruneCatalogLayerDefinition`, no front, carimba `type` sempre).
 *
 * Os dois são precisos e a diferença é o teto do arquivo: a poda de SAÍDA decide pelo carimbo,
 * então ela alcança esta e não alcança a nua; a borda de ESCRITA decide pela forma, então ela
 * alcança as duas. Uma linha HISTÓRICA com a forma nua aninhada (gravada antes da F14, e por um
 * cliente que não existe) continuaria saindo: é o resíduo declarado da fase, e o argumento para
 * não fazer migração de limpeza é que a forma que os clientes reais gravaram é ESTA, carimbada.
 */
const contrabandoCarimbado = () => ({ type: 'analysis_layer', ...contrabando() });

describe('F14 — a definição de recurso não pode ser ARMAZENADA onde o servidor republica', () => {
  let app, db;
  let dono, membro;
  let tokenDono, tokenMembro, tokenVisitante;
  let atlas, mapa;

  const push = async (token, operations, esperado = 200) => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(esperado);
    return res.body.data;
  };

  const snapshot = async (token) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.snapshot;
  };

  const camada = (snap, id) => snap.maps
    .find((m) => m.id === mapa.id).catalogLayers
    .find((c) => c.id === id);

  const linhaDeCamada = async (id) => {
    const { rows } = await db.query(
      'SELECT data FROM catalog_layers WHERE map_id = $1 AND id = $2', [mapa.id, id],
    );
    return rows[0]?.data;
  };

  const op = (extra) => ({
    id: randomUUID(),
    timestamp: Date.now(),
    clientId: `c-f14-${sufixo}`,
    ...extra,
  });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `f14_dono_${sufixo}` });
    membro = await createUser(db, { username: `f14_membro_${sufixo}` });
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);

    atlas = await createAtlas(db, dono.id, { name: `F14 borda ${sufixo}` });
    mapa = await createMap(db, atlas.id, { name: `Mapa F14 ${sufixo}` });
    await createShare(db, atlas.id, membro.id, 'read', dono.id);

    for (const [id, nivel, url] of [
      [PRIVADA, 'private', URL_PRIVADA_VIVA], [PUBLICA, 'public', URL_PUBLICA_VIVA],
    ]) {
      await db.query(
        `INSERT INTO analysis_layers (id, name, config, sort_order, access_level)
         VALUES ($1, $2, $3::jsonb, 0, $4)`,
        [id, `Camada ${id} (nome vivo)`, JSON.stringify({
          source: { type: 'vector', url }, bounds: [-50, -25, -40, -15],
        }), nivel],
      );
    }

    tokenVisitante = await getPublicToken(app, await makeAtlasPublic(db, atlas.id));
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await db.query('DELETE FROM analysis_layers WHERE id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // PISO — sem ele, todo verde abaixo é o de um banco que nunca teve o segredo
  // ==========================================================================

  it('piso: os dois recursos existem, com níveis de acesso opostos e URLs distintas', async () => {
    const { rows } = await db.query(
      'SELECT id, access_level, active, config FROM analysis_layers WHERE id = ANY($1::text[]) ORDER BY id',
      [[PRIVADA, PUBLICA]],
    );
    assert.equal(rows.length, 2, 'as duas linhas de catálogo precisam existir');
    const porId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(porId[PRIVADA].access_level, 'private');
    assert.equal(porId[PUBLICA].access_level, 'public');
    assert.ok(porId[PRIVADA].active && porId[PUBLICA].active, 'e ativas, senão a ausência não diz nada');
    assert.equal(porId[PRIVADA].config.source.url, URL_PRIVADA_VIVA);
    assert.ok(JSON.stringify(contrabando()).includes(URL_CONTRABANDO), 'a carga do teste carrega a URL');
    assert.ok(tokenVisitante, 'e o visitante de link público existe');
  });

  // ==========================================================================
  // V-B — A BORDA DE ESCRITA, medida no BANCO
  // ==========================================================================

  it('V-B/CATÁLOGO — a definição plantada sob `styleOverrides` NÃO É GRAVADA, e a op é aceita', async () => {
    const idDaCamada = `catalog-${sufixo}`;
    const res = await push(tokenDono, [op({
      entityType: 'catalogLayer',
      operationType: 'create',
      entityId: idDaCamada,
      mapId: mapa.id,
      data: {
        id: idDaCamada,
        type: 'wms',
        visible: true,
        opacity: 0.6,
        sourceId: 'origem-inventada-pelo-cliente',
        nome: 'Hidrografia',
        styleOverrides: {
          raster: { 'raster-opacity': 0.5 },
          contrabando: contrabando(),
        },
      },
    })]);

    // DESCARTE, NUNCA REJEIÇÃO: um 4xx aqui congelaria a fila de saída inteira do cliente.
    assert.equal(res.acks.length, 1, 'a op foi acked');
    assert.equal(res.acks[0].rejected, undefined, 'e NÃO recusada: a borda descarta, não rejeita');

    const guardado = await linhaDeCamada(idDaCamada);
    assert.ok(guardado, 'a linha existe: o descarte não pode ter comido a entrada');
    assert.ok(
      !JSON.stringify(guardado).includes(URL_CONTRABANDO),
      'a definição plantada não pode ter sido ARMAZENADA',
    );

    // O PAR POSITIVO. Dois testes de contrato existem para proibir uma poda por allowlist de chave
    // aqui, e este bloco é o que impede a borda de virar uma.
    assert.equal(guardado.visible, true);
    assert.equal(guardado.opacity, 0.6);
    assert.equal(guardado.sourceId, 'origem-inventada-pelo-cliente');
    assert.equal(guardado.nome, 'Hidrografia');
    assert.deepEqual(guardado.styleOverrides.raster, { 'raster-opacity': 0.5 });
  });

  it('V-B/COLUNA IRMÃ — `maps.analysis_layers` não guarda a definição, e guarda o resto', async () => {
    await push(tokenDono, [op({
      entityType: 'map',
      operationType: 'update',
      entityId: mapa.id,
      mapId: mapa.id,
      changes: {
        name: `Mapa renomeado ${sufixo}`,
        analysis_layers: {
          camadas: [{ id: ID_PRIVADA, visible: true, ...contrabando() }],
          los_result_1: { visible: true, data: {} },
        },
      },
    })]);

    const { rows } = await db.query('SELECT name, analysis_layers FROM maps WHERE id = $1', [mapa.id]);
    assert.match(rows[0].name, /^Mapa renomeado/, 'o gesto real (renomear) continua funcionando');
    assert.ok(
      !JSON.stringify(rows[0].analysis_layers).includes(URL_CONTRABANDO),
      'a coluna irmã não pode mais receber definição',
    );
    // O par positivo, e ele é o motivo de esta coluna ser VARRIDA e não fechada: o contrato dela
    // tem valor aninhado dentro.
    assert.equal(rows[0].analysis_layers.camadas[0].visible, true, 'o estado por atlas fica');
    assert.equal(rows[0].analysis_layers.camadas[0].id, ID_PRIVADA, 'com a referência');
    assert.deepEqual(rows[0].analysis_layers.los_result_1, { visible: true, data: {} });
  });

  it('V-B/FEIÇÃO — nem `features.properties`, que é a posição que a revisão mediu atravessando', async () => {
    const idDaFeicao = randomUUID();
    await push(tokenDono, [op({
      entityType: 'feature',
      operationType: 'create',
      entityId: idDaFeicao,
      mapId: mapa.id,
      data: {
        id: idDaFeicao,
        feature_type: 'point',
        geometry: { type: 'Point', coordinates: [-45, -20] },
        properties: { nome: 'Ponto', visivel: true, contrabando: contrabando() },
      },
    })]);

    const { rows } = await db.query(
      'SELECT geometry, properties FROM features WHERE id = $1', [idDaFeicao],
    );
    assert.equal(rows.length, 1, 'a feição foi criada');
    assert.ok(!JSON.stringify(rows[0].properties).includes(URL_CONTRABANDO));
    assert.equal(rows[0].properties.nome, 'Ponto', 'e as propriedades do domínio ficam');
    assert.equal(rows[0].properties.visivel, true);
    assert.deepEqual(rows[0].geometry.coordinates, [-45, -20], 'a geometria não é tocada');
  });

  it('V-B/LOG — o que a borda descartou também não fica no log, que é lido no pull incremental', async () => {
    const { rows } = await db.query(
      'SELECT data, changes FROM operations WHERE atlas_id = $1', [atlas.id],
    );
    assert.ok(rows.length >= 3, 'as ops dos casos acima estão no log');
    assert.ok(
      !JSON.stringify(rows).includes(URL_CONTRABANDO),
      'o log guarda a carga verbatim, então a borda é a única coisa entre ele e a definição',
    );
  });

  // ==========================================================================
  // V-A — A ISENÇÃO POR CAMPO, sobre a LINHA HISTÓRICA
  // ==========================================================================

  it('V-A — o contrabando dentro de uma entrada REIDRATADA não sai, e a definição legítima sai', async () => {
    // A LINHA É ESCRITA POR SQL DE PROPÓSITO: a borda da F14 recusaria esta carga hoje, e o que se
    // mede aqui é a poda de SAÍDA sobre o que JÁ ESTÁ GRAVADO. É esse alcance que dispensou uma
    // migração de limpeza.
    for (const [id, recurso] of [[ID_PUBLICA, PUBLICA], [ID_PRIVADA, PRIVADA]]) {
      await db.query('INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)', [
        id, mapa.id, JSON.stringify({
          id,
          type: 'analysis_layer',
          visible: true,
          opacity: 0.6,
          // A DEFINIÇÃO DA PRIVADA, plantada dentro da entrada da PÚBLICA (e da própria privada):
          // a posição exata da revisão adversarial, na forma CARIMBADA que ela usou.
          styleOverrides: { raster: { 'raster-opacity': 0.3 }, contrabando: contrabandoCarimbado() },
          config: { id: recurso, source: { url: '/copia-velha-do-cliente' } },
        }),
      ]);
    }

    // O MEMBRO com `read` e SEM concessão: ele alcança a pública (é `public`) e não a privada.
    const snap = await snapshot(tokenMembro);

    const publica = camada(snap, ID_PUBLICA);
    assert.ok(publica, 'a entrada pública continua sendo servida');
    // POSITIVO: a definição que o servidor resolveu para ESTE chamador chega, fresca do catálogo.
    assert.equal(publica.config.source.url, URL_PUBLICA_VIVA, 'a definição legítima chega');
    assert.match(publica.name, /nome vivo/, 'e vem do catálogo, não da cópia guardada');
    assert.equal(publica.visible, true, 'com o estado por atlas do cliente');
    assert.deepEqual(publica.styleOverrides.raster, { 'raster-opacity': 0.3 }, 'e o estilo dele');
    // NEGATIVO: o contrabando plantado DENTRO da entrada isenta não viaja com ela.
    assert.equal(
      publica.styleOverrides.contrabando?.config, undefined,
      'V-A: a isenção não pode cobrir o que o CLIENTE escreveu dentro do nó servido',
    );

    const privada = camada(snap, ID_PRIVADA);
    assert.ok(privada, 'a entrada privada continua sendo servida como referência');
    assert.equal(privada.config, undefined, 'sem definição, porque o membro não alcança o recurso');

    const texto = JSON.stringify(snap);
    assert.ok(!texto.includes(URL_CONTRABANDO), 'o contrabando VAZOU pelo snapshot');
    assert.ok(!texto.includes(URL_PRIVADA_VIVA), 'a URL viva do recurso privado VAZOU');
    assert.ok(!texto.includes('/copia-velha-do-cliente'), 'e a cópia velha guardada também não sai');
  });

  it('V-A — o mesmo para o VISITANTE ANÔNIMO de link público, que é o teto real da superfície', async () => {
    const snap = await snapshot(tokenVisitante);
    const publica = camada(snap, ID_PUBLICA);
    assert.ok(publica, 'o visitante recebe a entrada');
    assert.equal(publica.config.source.url, URL_PUBLICA_VIVA, 'com a definição pública, que é dele por direito');
    assert.equal(publica.styleOverrides.contrabando?.config, undefined);

    const texto = JSON.stringify(snap);
    assert.ok(!texto.includes(URL_CONTRABANDO), 'o contrabando VAZOU para o anônimo');
    assert.ok(!texto.includes(URL_PRIVADA_VIVA), 'a URL viva do recurso privado VAZOU para o anônimo');
  });
});

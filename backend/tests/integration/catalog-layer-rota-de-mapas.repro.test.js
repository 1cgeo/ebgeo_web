// Path: tests/integration/catalog-layer-rota-de-mapas.repro.test.js
//
// REPRO — as ROTAS DE MAPA serviam a definição de um recurso privado a quem só tem `read`,
// visitante anônimo de link público inclusive. Este arquivo reproduz a sonda da revisão da F11
// e prende o comportamento novo.
//
// A SONDA, tal como foi medida em banco limpo (a coluna legada `maps.catalog_layers` carregando
// a cópia de uma `analysis_layer` PRIVADA):
//
//     membro com share `read`      -> 200, VAZOU
//     visitante de link público    -> 200, VAZOU
//     a listagem `GET /maps`       -> 200, VAZOU
//
// CAUSA RAIZ, e ela tem TRÊS elos, nenhum deles um defeito isolado:
//
//   1. `maps.queries.js` fazia `SELECT *`, `maps.service.js` devolvia a linha inteira e
//      `maps.controller.js` responde `res.json({ data })` sem tocar nela. `SELECT *` sobre uma
//      tabela que ninguém prometeu não crescer publica por herança toda coluna futura;
//   2. `maps.catalog_layers` (coluna do schema original, migração 002) guardava a CÓPIA da linha
//      de catálogo que o cliente pré-F11 carimbava, `config.source.url` inclusive;
//   3. as duas rotas são gateadas em `read` (`maps.routes.js`), e `resolvePermission` devolve
//      `read` para userId NULO quando o atlas é `is_public` — o visitante do link chega nelas.
//
// A F11 tirou a desnormalização e passou a reidratar a definição na leitura pelo predicado de
// quem lê, mas a reidratação mora dentro de `getAtlasSnapshot`: estas rotas não passam por lá, e
// por isso continuaram servindo a cópia. A F12 fechou o buraco pela raiz — a coluna não tinha
// leitor (migração 022 a apagou) e as consultas passaram a listar colunas.
//
// POR QUE ESTE ARQUIVO PLANTA A COLUNA DE VOLTA. Contra o schema de hoje "a URL não sai" é
// trivialmente verdade: não há de onde sair, e o verde não provaria nada — a família de
// cobertura vazia que mais custou a este projeto. Aqui a coluna é recriada e CARREGADA com a
// cópia durante toda a medição, o que faz duas coisas: reproduz o mundo antigo bit a bit, de
// modo que os casos ficam VERMELHOS contra o código antigo (com `SELECT *` a cópia sai); e
// deixa de pé o guarda durável, porque quem reabre este buraco não é a coluna, é o próximo
// `SELECT *` sobre `maps`.
//
// COBERTURA VIZINHA, para não duplicar: `catalog-layer-coluna-legada.test.js` mede a saída da
// coluna pelo lado do schema e da materialização, e cobre a TERCEIRA superfície,
// `POST /maps/:id/duplicate` (que devolve a linha do mapa novo e exige `write`, então não é
// alcançável pelos dois principais deste arquivo). `catalog-layer-cadeia-de-vazamento.test.js`
// mede a cadeia do gesto até o anônimo pelo snapshot e pelo log de operações.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createMap, createShare, loginUser,
  makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

const sufixo = randomUUID().slice(0, 8);
const PRIVADA = `f12rota-priv-${sufixo}`;
const PUBLICA = `f12rota-pub-${sufixo}`;

// Quatro URLs distintas, e a distinção é o que dá poder de discriminação às buscas por substring
// na resposta inteira: a privada viva (o segredo), a pública viva (o controle de que nada foi
// apagado em bloco), a cópia carimbada pelo cliente (a forma que o segredo tinha de sair) e a do
// relevo sombreado (que precisa continuar saindo para todo mundo).
const URL_PRIVADA_VIVA = `/tiles/${sufixo}/privada-viva/{z}/{x}/{y}.pbf`;
const URL_PUBLICA_VIVA = `/tiles/${sufixo}/publica-viva/{z}/{x}/{y}.pbf`;
const URL_COPIADA = `/tiles/${sufixo}/copia-carimbada/{z}/{x}/{y}.pbf`;
const URL_HILLSHADE = `/tiles/${sufixo}/relevo/{z}/{x}/{y}.png`;

const ID_PRIVADA = `analysis-${PRIVADA}`;
const ID_PUBLICA = `analysis-${PUBLICA}`;

/** A entrada que o cliente pré-F11 gravava: referência, estado por atlas e a cópia da linha. */
const entradaComCopia = (id, resourceId, url) => ({
  id,
  type: 'analysis_layer',
  name: 'Nome copiado no dia da adição',
  visible: true,
  opacity: 0.6,
  status: 'active',
  styleOverrides: { raster: { 'raster-opacity': 0.3 } },
  config: { id: resourceId, source: { type: 'vector', url } },
});

describe('F12 REPRO — as rotas de mapa não servem definição de recurso a quem tem `read`', () => {
  let app, db;
  let admin, dono, membro;
  let tokenAdmin, tokenDono, tokenMembro, tokenVisitante;
  let atlas, mapa;

  // --- helpers ---------------------------------------------------------------

  const pedirItem = (token) => supertest(app)
    .get(`/api/v1/atlas/${atlas.id}/maps/${mapa.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const pedirListagem = (token) => supertest(app)
    .get(`/api/v1/atlas/${atlas.id}/maps`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

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

  /**
   * O par completo de uma resposta de mapa: ela É o mapa (positivo) e não carrega definição
   * nenhuma (negativo). Sem a metade positiva, uma rota que respondesse `{}` passaria.
   */
  const conferirCorpoDoMapa = (corpo, quem) => {
    assert.ok(corpo, `${quem}: a rota respondeu com o mapa`);
    assert.equal(corpo.id, mapa.id, `${quem}: é o mapa pedido`);
    assert.equal(corpo.name, mapa.name, `${quem}: com o nome dele`);
    assert.equal(corpo.base_layer, 'carta-topografica', `${quem}: e o estado do mapa`);
    assert.equal(Number(corpo.zoom), 10, `${quem}: o zoom continua vindo`);
    assert.ok('grid_style' in corpo, `${quem}: e as colunas de estado seguem publicadas`);
    assert.ok('analysis_layers' in corpo, `${quem}: inclusive a do domínio de grade`);

    // A URL vem ANTES da chave de propósito: quando este par fica vermelho, a primeira linha do
    // relatório precisa dizer que VAZOU, não que uma chave apareceu.
    const texto = JSON.stringify(corpo);
    assert.ok(!texto.includes(URL_COPIADA), `${quem}: a cópia carimbada pelo cliente VAZOU`);
    assert.ok(!texto.includes(URL_PRIVADA_VIVA), `${quem}: a URL viva do recurso privado VAZOU`);
    assert.ok(!('catalog_layers' in corpo), `${quem}: a coluna legada não sai`);
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `f12rota_admin_${sufixo}` });
    dono = await createUser(db, { username: `f12rota_dono_${sufixo}` });
    membro = await createUser(db, { username: `f12rota_membro_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);

    atlas = await createAtlas(db, dono.id, { name: `F12 rotas ${sufixo}` });
    mapa = await createMap(db, atlas.id, { name: `Mapa da sonda ${sufixo}` });
    // `read` PURO: é o nível da sonda, o mais baixo da hierarquia, e o que o gate destas rotas
    // cobra. Um membro com `write` mediria outra coisa.
    await createShare(db, atlas.id, membro.id, 'read', dono.id);

    for (const [id, nivel, url] of [
      [PRIVADA, 'private', URL_PRIVADA_VIVA], [PUBLICA, 'public', URL_PUBLICA_VIVA],
    ]) {
      await db.query(
        `INSERT INTO analysis_layers (id, name, config, sort_order, access_level)
         VALUES ($1, $2, $3::jsonb, 0, $4)`,
        [id, `Camada ${id} (nome vivo)`, JSON.stringify({
          source: { type: 'vector', url },
          bounds: [-50, -25, -40, -15],
        }), nivel],
      );
    }

    // As três entradas na tabela canônica, com a cópia velha dentro (o estado real do banco:
    // nada foi migrado, por decisão registrada).
    const entradas = [
      entradaComCopia(ID_PRIVADA, PRIVADA, URL_COPIADA),
      entradaComCopia(ID_PUBLICA, PUBLICA, URL_COPIADA),
      {
        id: 'hillshade', type: 'hillshade', name: 'Sombreamento do Relevo', visible: true,
        config: { source: { type: 'raster-dem', url: URL_HILLSHADE } },
      },
    ];
    for (const entrada of entradas) {
      await db.query(
        `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
        [entrada.id, mapa.id, JSON.stringify(entrada)],
      );
    }

    // A COLUNA LEGADA DE VOLTA, carregada com a mesma cópia: é o mundo que a sonda mediu, e é o
    // que dá poder de discriminação a tudo abaixo.
    await db.query(`ALTER TABLE maps ADD COLUMN catalog_layers JSONB NOT NULL DEFAULT '[]'`);
    await db.query(`UPDATE maps SET catalog_layers = $1::jsonb WHERE id = $2`, [
      JSON.stringify(entradas), mapa.id,
    ]);

    tokenVisitante = await getPublicToken(app, await makeAtlasPublic(db, atlas.id));
  });

  after(async () => {
    await db.query(`ALTER TABLE maps DROP COLUMN IF EXISTS catalog_layers`);
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await db.query('DELETE FROM analysis_layers WHERE id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // PISO — sem isto, todo verde abaixo é o de um banco que nunca teve o segredo
  // ==========================================================================

  it('piso: o recurso é privado, e a CÓPIA está nas duas superfícies do mapa', async () => {
    const { rows: recurso } = await db.query(
      `SELECT access_level, active FROM analysis_layers WHERE id = $1`, [PRIVADA],
    );
    assert.equal(recurso.length, 1, 'a linha de catálogo precisa existir');
    assert.equal(recurso[0].access_level, 'private', 'e estar marcada privada');
    assert.equal(recurso[0].active, true, 'e ativa, senão a ausência não diria nada');

    // Superfície 1: a tabela canônica.
    const { rows: tabela } = await db.query(
      `SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL ORDER BY id`,
      [mapa.id],
    );
    assert.deepEqual(tabela.map((r) => r.id), [ID_PRIVADA, ID_PUBLICA, 'hillshade']);
    assert.ok(
      JSON.stringify(tabela.find((r) => r.id === ID_PRIVADA).data).includes(URL_COPIADA),
      'a linha da camada privada precisa carregar a cópia',
    );

    // Superfície 2: a coluna legada, replantada, que é o que a sonda leu.
    const { rows: coluna } = await db.query(
      `SELECT catalog_layers FROM maps WHERE id = $1`, [mapa.id],
    );
    assert.equal(coluna.length, 1);
    assert.equal(coluna[0].catalog_layers.length, 3, 'a coluna legada precisa estar carregada');
    assert.ok(
      JSON.stringify(coluna[0].catalog_layers).includes(URL_COPIADA),
      'com a cópia dentro: é o dado que a rota entregava',
    );

    assert.ok(tokenVisitante, 'e o token de visitante de link público precisa existir');
  });

  // ==========================================================================
  // A SONDA — os três disparos dela, cada um com o positivo do próprio par
  // ==========================================================================

  it('REPRO/ITEM — o visitante do LINK PÚBLICO pede o mapa e não recebe a definição privada', async () => {
    // O disparo mais alto da sonda: este chamador não tem conta, não tem concessão e não foi
    // mencionado por ninguém. Antes da F12 ele recebia `catalog_layers` com `config.source.url`.
    const res = await pedirItem(tokenVisitante);
    conferirCorpoDoMapa(res.body.data, 'visitante anônimo');
  });

  it('REPRO/ITEM — o membro com share `read` tampouco, e ele é o outro disparo da sonda', async () => {
    // Ter conta e ter share não é ter acesso ao RECURSO: são dois eixos, e o de recurso não é
    // atravessado ao pedir um mapa.
    const res = await pedirItem(tokenMembro);
    conferirCorpoDoMapa(res.body.data, 'membro com read');
  });

  it('REPRO/LISTAGEM — `GET /maps` também, para os dois: filtrar só o singular é o defeito conhecido', async () => {
    // O terceiro disparo, e ele é o que este branch já pagou uma vez: no MVT a correção alcançou
    // o item e não alcançou a listagem, e o vazamento seguiu por uma rota que ninguém releu.
    const respostas = [
      ['visitante anônimo', (await pedirListagem(tokenVisitante)).body.data],
      ['membro com read', (await pedirListagem(tokenMembro)).body.data],
    ];
    assert.equal(respostas.length, 2, 'os dois principais responderam');

    for (const [quem, lista] of respostas) {
      // Positivo: a listagem É uma listagem, e o mapa da sonda está nela.
      assert.ok(Array.isArray(lista), `${quem}: a rota devolve uma lista`);
      assert.ok(lista.length >= 1, `${quem}: com o mapa do atlas dentro`);
      conferirCorpoDoMapa(lista.find((m) => m.id === mapa.id), `${quem} (listagem)`);
      // E a busca na RESPOSTA INTEIRA, não só no item da sonda.
      assert.ok(
        !JSON.stringify(lista).includes(URL_COPIADA),
        `${quem}: a cópia não sai por nenhum item da listagem`,
      );
    }
  });

  it('REPRO/CONTROLE — sem credencial nenhuma as duas rotas nem respondem', async () => {
    // Completa a leitura da sonda: o vazamento exigia o link público (ou o share), não era uma
    // rota aberta. Sem este caso, "o anônimo não recebe a URL" poderia ser só um 401.
    await supertest(app).get(`/api/v1/atlas/${atlas.id}/maps/${mapa.id}`).expect(401);
    await supertest(app).get(`/api/v1/atlas/${atlas.id}/maps`).expect(401);
  });

  // ==========================================================================
  // O PAR POSITIVO — quem tem `read` continua vendo o que PODE ver
  // ==========================================================================

  it('POSITIVO — o membro com `read` recebe pelo canal que reidrata: a pública, viva', async () => {
    // Sem este caso, todos os negativos acima passariam numa correção que devolvesse menos para
    // todo mundo, que é "não vazar" e também "não funcionar". O canal legítimo da definição é o
    // snapshot, que reidrata pelo predicado do chamador.
    const snap = await snapshot(tokenMembro);
    const publica = camada(snap, ID_PUBLICA);
    assert.ok(publica, 'a camada pública chega ao membro');
    assert.equal(publica.config.source.url, URL_PUBLICA_VIVA, 'com a definição VIVA do catálogo');
    assert.equal(publica.name, `Camada ${PUBLICA} (nome vivo)`);
    assert.deepEqual(publica.config.bounds, [-50, -25, -40, -15], 'e o resto da linha junto');

    // E o estado por atlas da PRIVADA continua chegando: o que sai é a definição, não a linha.
    const privada = camada(snap, ID_PRIVADA);
    assert.ok(privada, 'a referência da privada continua no snapshot');
    assert.equal(privada.visible, true);
    assert.equal(privada.opacity, 0.6);
    assert.deepEqual(privada.styleOverrides, { raster: { 'raster-opacity': 0.3 } });
    assert.equal(privada.config, undefined, 'sem a definição, que é o que ele não alcança');
  });

  it('POSITIVO — dada a concessão, o MESMO membro passa a receber a definição privada', async () => {
    // O predicado virado no MESMO principal: comparar duas pessoas deixaria em aberto se o que
    // discrimina é o acesso ou a identidade. Aqui só a concessão muda, e ela muda nos dois
    // sentidos, o que também prova que o `read` no atlas nunca foi o eixo em questão.
    const antes = camada(await snapshot(tokenMembro), ID_PRIVADA);
    assert.equal(antes.config, undefined, 'piso: sem concessão ele não alcança');

    await supertest(app)
      .post(`/api/v1/resource-access/analysis_layer/${PRIVADA}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: membro.id, grantLevel: 'view' })
      .expect(201);
    try {
      const durante = camada(await snapshot(tokenMembro), ID_PRIVADA);
      assert.equal(durante.config.source.url, URL_PRIVADA_VIVA, 'concedida, a definição VIVA sai');
      assert.equal(durante.name, `Camada ${PRIVADA} (nome vivo)`);
      assert.ok(
        !JSON.stringify(durante).includes(URL_COPIADA),
        'e a cópia velha não sobrevive ao lado da definição fresca',
      );
    } finally {
      await db.query(
        `UPDATE resource_grants SET revoked_at = NOW()
          WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL`,
        [PRIVADA, membro.id],
      );
    }

    const depois = camada(await snapshot(tokenMembro), ID_PRIVADA);
    assert.equal(depois.config, undefined, 'revogada, a definição para de sair');
  });

  it('POSITIVO — e o DONO do atlas continua recebendo o mapa por estas rotas', async () => {
    // O outro lado do gate: a correção mexeu na lista de colunas de uma consulta usada por todo
    // mundo, e uma lista mal escrita quebraria a rota para quem tem `owner` sem que nenhum dos
    // negativos acima ficasse vermelho.
    const res = await pedirItem(tokenDono);
    conferirCorpoDoMapa(res.body.data, 'dono');
    assert.ok('version' in res.body.data, 'com a versão, que o cliente usa para o sync');
    assert.ok('locked' in res.body.data, 'e o map-lock');
  });

  // ==========================================================================
  // DISCRIMINAÇÃO — o relevo sombreado não é recurso, e chega a todo mundo
  // ==========================================================================

  it('DISCRIMINAÇÃO — o HILLSHADE chega inteiro ao anônimo, com a URL dentro', async () => {
    // A armadilha da fase, medida na MESMA resposta em que a privada é podada: `hillshade` está
    // em `CATALOG_ITEM_TYPES` e não tem linha de catálogo nenhuma (a definição é estática).
    // Tratá-lo como recurso tira o relevo do mapa de TODO MUNDO, e um teste que só olhasse a
    // camada privada não veria diferença.
    const snap = await snapshot(tokenVisitante);

    const relevo = camada(snap, 'hillshade');
    assert.ok(relevo, 'o hillshade continua no snapshot do visitante anônimo');
    assert.equal(relevo.config.source.url, URL_HILLSHADE, 'com a cópia dele intacta');
    assert.equal(relevo.name, 'Sombreamento do Relevo');

    // Na MESMA resposta, a privada continua podada: é isso que separa "poda dirigida" de
    // "apagou tudo" sem depender de duas medições distantes uma da outra.
    assert.equal(camada(snap, ID_PRIVADA).config, undefined, 'e a privada, ao lado, sem definição');
  });
});

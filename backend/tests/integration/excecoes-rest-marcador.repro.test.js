// Path: tests/integration/excecoes-rest-marcador.repro.test.js
//
// AS QUATRO EXCEÇÕES REST DEIXAM MARCADOR NO LOG (F10, bloco B6 do plano de lançamento).
//
// CAUSA RAIZ. Merge, duplicação de mapa, clone e importação são as escritas de entidade INTEIRA
// que não passam pelo sync, e nenhuma op descreve o que elas fizeram. `atlas.current_version` só
// avança pelo gatilho `trg_update_atlas_version`, que dispara no INSERT em `operations`; sem
// nenhuma linha lá, a versão do atlas continuava afirmando que nada tinha acontecido. O par que
// estava OFFLINE reconectava com `lastVersion` igual a essa versão parada, `pullOperations`
// tomava o ramo incremental e respondia `{operations: []}`: o cliente concluía que estava em dia
// e seguia sem o mapa duplicado até um F5. O merge fechou isso em 2026-07 e as outras três
// ficaram abertas, com um agravante próprio de clone e importação: o atlas nascia na versão zero
// com todo o conteúdo dentro.
//
// A CAMADA PADRÃO É A METADE MUDA DO MESMO BURACO: `ensureMapLayers` cria a camada `Padrão` das
// quatro rotas fora do log e sem broadcast, então nem sequer o par conectado tinha uma op que a
// nomeasse. O marcador da duplicação carrega as camadas do mapa novo no payload, que é a mesma
// forma que a op estrutural de criação de mapa já usa no push.
//
// CONTROLE NEGATIVO, executado em 2026-09-13: desligando as chamadas de
// `recordStructuralMarker` de `duplicateMap` e de `cloneAtlas`, três dos quatro casos ficam
// vermelhos, e o primeiro deles com a resposta LITERAL do defeito: «o replay incremental traz o
// marcador, veio []». O clone volta a nascer sem linha em `operations`. O quarto caso (a
// importação, cujo marcador não foi tocado) segue verde, que é a discriminação que se quer.
// Fonte restaurada depois, e os quatro voltaram verdes.
//
// O QUE ELE NÃO PROVA. O cliente de hoje conhece UMA palavra de marcador
// (`STRUCTURAL_RESYNC_OPS`, em `frontend/src/js/store/sync/sync-engine.js`), e é por isso que o
// `client_entity_type` dos quatro é `map_merge`: é o que faz o par tomar o snapshot ao receber
// qualquer um deles. Este arquivo afirma o que o SERVIDOR entrega (o tipo publicado, o payload e
// a versão); que o cliente resincroniza ao vê-lo é contrato do outro pacote, e a troca do tipo
// publicado pelo nome honesto é um commit dos dois lados.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { STRUCTURAL_MARKER, MARCADOR_DE_RESYNC_DO_CLIENTE } from '../../src/modules/sync/structural-marker.js';

describe('Exceções REST: marcador no log e versão que anda', () => {
  let app, db, user, token, atlas, mapa;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'marcador_user' });
    token = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const auth = (req) => req.set('Authorization', `Bearer ${token}`);
  const versaoAtual = async (id) => Number((await db.query(
    'SELECT current_version FROM atlas WHERE id = $1', [id])).rows[0].current_version);

  /**
   * Deixa o atlas com uma versão maior que zero, que é a pré-condição do ramo INCREMENTAL:
   * `pullOperations` responde snapshot quando `sinceVersion` é 0 ou está abaixo de `min_version`,
   * e um teste que pedisse da versão zero mediria o snapshot em vez do replay.
   */
  async function comHistorico() {
    atlas = await createAtlas(db, user.id);
    mapa = await createMap(db, atlas.id);
    const featureId = randomUUID();
    await auth(supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`)).send({
      operations: [{ protocolVersion: 2, id: randomUUID(), type: 'create', target: 'feature',
        targetId: featureId, mapId: mapa.id,
        data: { feature_type: 'point', geometry: { coordinates: [-43.2, -22.9] }, properties: { name: 'Antes' } },
        timestamp: Date.now(), clientId: 'marcador-c' }],
    }).expect(200);
    return versaoAtual(atlas.id);
  }

  it('duplicar um mapa: o par OFFLINE recebe o marcador no pull incremental, sem snapshot', async () => {
    const versaoDoPar = await comHistorico();

    const dup = await auth(supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${mapa.id}/duplicate`)).expect(201);
    const novoMapa = dup.body.data.id;

    const res = await auth(supertest(app).get(`/api/v1/atlas/${atlas.id}/sync/${versaoDoPar}`)).expect(200);
    assert.equal(res.body.data.isSnapshot, false, 'o par não precisa cair no snapshot completo');
    const ops = res.body.data.operations;
    assert.equal(ops.length, 1, `o replay incremental traz o marcador, veio ${JSON.stringify(ops)}`);

    const marcador = ops[0];
    assert.equal(marcador.entityType, MARCADOR_DE_RESYNC_DO_CLIENTE,
      'o tipo publicado é a palavra que o cliente reconhece como "tire um snapshot"');
    assert.equal(marcador.data.kind, STRUCTURAL_MARKER.MAP_DUPLICATE, 'e o payload diz qual ato foi');
    assert.equal(marcador.data.mapId, novoMapa);
    assert.equal(marcador.data.sourceMapId, mapa.id);
    assert.ok(Array.isArray(marcador.data.layers) && marcador.data.layers.length >= 1,
      'as camadas que ensureMapLayers criou fora do log são nomeadas no marcador');

    assert.ok(await versaoAtual(atlas.id) > versaoDoPar, 'e a versão do atlas andou');
  });

  it('duplicar: o log guarda o nome HONESTO do ato, com autoria e sentinela de servidor', async () => {
    await comHistorico();
    await auth(supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${mapa.id}/duplicate`)).expect(201);

    const { rows } = await db.query(
      `SELECT entity_type, client_entity_type, client_id, user_id, batch_id
         FROM operations WHERE atlas_id = $1 AND entity_type = $2`,
      [atlas.id, STRUCTURAL_MARKER.MAP_DUPLICATE]
    );
    assert.equal(rows.length, 1, 'uma linha por duplicação');
    assert.equal(rows[0].client_entity_type, MARCADOR_DE_RESYNC_DO_CLIENTE,
      'as duas colunas divergem de propósito: a de dentro é honesta, a de fora é a que o cliente entende');
    assert.equal(rows[0].client_id, `server-${STRUCTURAL_MARKER.MAP_DUPLICATE}`);
    assert.equal(String(rows[0].user_id), String(user.id), 'a autoria do ato chega ao log');
    assert.equal(rows[0].batch_id, null, 'marcador de servidor não pertence a gesto nenhum');
  });

  it('clonar: o atlas novo NASCE com marcador e com current_version coerente, nunca em zero', async () => {
    await comHistorico();

    const res = await auth(supertest(app).post(`/api/v1/atlas/${atlas.id}/clone`)).send({}).expect(201);
    const clone = res.body.data.id;

    const { rows } = await db.query(
      `SELECT entity_type, data FROM operations WHERE atlas_id = $1`, [clone]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entity_type, STRUCTURAL_MARKER.ATLAS_CLONE);
    assert.equal(rows[0].data.sourceAtlasId, atlas.id);
    assert.equal(rows[0].data.maps, 1, 'a contagem do que foi copiado, nunca ids nem nomes');
    assert.ok(await versaoAtual(clone) > 0,
      'um atlas com conteúdo na versão zero faz a primeira op futura parecer a primeira coisa que houve nele');
  });

  it('importar: o atlas do arquivo também nasce com marcador, e a rota devolve a versão já avançada', async () => {
    const mapId = randomUUID();
    const res = await auth(supertest(app).post('/api/v1/atlas/import')).send({
      atlas: { name: 'Atlas do arquivo' },
      maps: [{ id: mapId, name: 'Mapa do arquivo', features: [], layers: [], groups: [] }],
    }).expect(201);
    const novo = res.body.data.id;

    const { rows } = await db.query(
      `SELECT entity_type, data FROM operations WHERE atlas_id = $1`, [novo]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entity_type, STRUCTURAL_MARKER.ATLAS_IMPORT);
    assert.equal(rows[0].data.maps, 1);
    const versao = await versaoAtual(novo);
    assert.ok(versao > 0);
    assert.equal(Number(res.body.data.current_version), versao,
      'a resposta é lida DEPOIS do marcador; ler antes devolveria uma versão que já nasceu velha');
  });
});

// Path: tests/integration/exclusao-de-subtipo-de-mapa.repro.test.js

// ============================================================================================
// REPRO F1 — LIMPAR A POSIÇÃO SALVA DE UM MAPA APAGAVA O MAPA INTEIRO.
//
// A CAUSA RAIZ, em três peças que só juntas produzem a perda:
//   1. `clearMapPosition` (frontend `store/map.operations.js`) emitia um `mapPosition` com
//      `operationType: 'delete'`;
//   2. `createMapSettingLogger` (frontend `store/sync/operation-dispatcher.js`) carimba
//      `entityId === mapId` em toda op de configuração de mapa, porque nenhuma das cinco tem
//      linha própria: elas são COLUNAS de `maps`;
//   3. aqui, `ENTITY_TYPE_MAP` normaliza `mapPosition` para `{ target: 'map', subType:
//      'position' }`, e o `case 'delete'` de `applyOperation` nunca leu `_subType` (só o
//      caminho de update o lê, em `MAP_SUBTYPE_FIELDS`). A op caía em `buildSoftDeleteQuery`
//      para o alvo `map`, cujo corpo é `UPDATE maps SET deleted_at = NOW() WHERE id = $1`.
//
// Medido em 2026-09-13: o Dono recebia `applied`, a linha do mapa ficava com `deleted_at` e o
// snapshot seguinte voltava sem o mapa. O Editor recebia "Apenas o dono ou um co-Gestor do
// atlas pode excluir um mapa", frase sobre um ato que ele não pediu, e a op recusada congelava
// a fila de saída daquele cliente.
//
// O QUE ESTE ARQUIVO PRENDE: a recusa POR OPERAÇÃO (200 + `rejected` + motivo), o `deleted_at`
// que continua nulo, o mapa que continua no snapshot, e o fato de o motivo nomear o SUBTIPO e
// não a exclusão de mapa. Mais dois controles que mantêm a guarda estreita: a exclusão de mapa
// de verdade continua excluindo, e a atualização com os cinco campos nulos (a forma correta de
// limpar, que o cliente passou a emitir) continua sendo aplicada.
//
// CONTROLE NEGATIVO: removendo `mapSubtypeDeleteDenialReason` da cadeia de recusa em
// `pushOperations`, o caso do Dono fica vermelho com `deleted_at` preenchido.
// ============================================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

/**
 * O ENVELOPE EXATO que `clearMapPosition` emitia: `entityId` é o id do MAPA (não o id da
 * posição), `data` é nulo e a posição anterior viaja em `previousData`.
 * @param {string} mapId - O mapa cuja posição se limpa.
 * @param {string} entityType - `mapPosition` ou outro subtipo de mapa.
 * @returns {Object} A operação, pronta para o corpo do push.
 */
function envelopeDeLimpeza(mapId, entityType = 'mapPosition') {
  return {
    protocolVersion: 2,
    id: randomUUID(),
    entityType,
    operationType: 'delete',
    entityId: mapId,
    mapId,
    data: null,
    previousData: {
      id: randomUUID(),
      center_lat: -22.9,
      center_long: -43.2,
      zoom: 10,
      bearing: 0,
      pitch: 0,
      savedAt: Date.now(),
    },
    timestamp: Date.now(),
    clientId: 'repro-client',
  };
}

describe('F1 — delete de subtipo de mapa não pode excluir o mapa', () => {
  let app, db, owner, ownerToken, editor, editorToken, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `f1_dono_${randomUUID().slice(0, 6)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    editor = await createUser(db, { username: `f1_editor_${randomUUID().slice(0, 6)}` });
    editorToken = await loginUser(app, editor.username, editor.password);
    atlas = await createAtlas(db, owner.id);
    await createShare(db, atlas.id, editor.id, 'write', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /**
   * @param {string} mapId - O mapa a conferir.
   * @returns {Promise<Object>} A linha de `maps`.
   */
  async function lerMapa(mapId) {
    const { rows } = await db.query('SELECT id, deleted_at, center_lat, zoom, bearing, pitch FROM maps WHERE id = $1', [mapId]);
    assert.equal(rows.length, 1, 'a linha do mapa precisa continuar existindo');
    return rows[0];
  }

  it('o Dono: a limpeza de posição é recusada por operação e o mapa continua vivo', async () => {
    const map = await createMap(db, atlas.id);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ operations: [envelopeDeLimpeza(map.id)] })
      .expect(200);

    // A PERDA VEM PRIMEIRO, de propósito: é ela que o controle negativo precisa nomear. Com a
    // guarda removida este assert é o que fica vermelho, dizendo que o mapa foi excluído, em
    // vez de um assert de forma de ack que não conta o que aconteceu com o dado.
    const linha = await lerMapa(map.id);
    assert.equal(linha.deleted_at, null, 'o mapa NÃO pode ter sido excluído');

    const acks = res.body.data.acks;
    assert.equal(acks.length, 1);
    assert.equal(acks[0].rejected, true, 'a op precisa voltar recusada, não aplicada');
    assert.equal(acks[0].status, 'rejected');
    assert.match(acks[0].reason, /posição salva/);
    assert.match(acks[0].reason, /atualização, não uma exclusão/);

    const snapshot = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const noSnapshot = snapshot.body.data.snapshot.maps.filter((m) => m.id === map.id);
    assert.equal(noSnapshot.length, 1, 'o mapa precisa continuar no snapshot');
  });

  it('o Editor: recebe o MESMO motivo, que nomeia o subtipo e não a exclusão de mapa', async () => {
    const map = await createMap(db, atlas.id);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ operations: [envelopeDeLimpeza(map.id)] })
      .expect(200);

    const acks = res.body.data.acks;
    assert.equal(acks.length, 1);
    assert.equal(acks[0].rejected, true);
    assert.match(acks[0].reason, /posição salva/);
    // A recusa de política é a que vinha antes, e ela descreve um ato que ninguém pediu.
    assert.doesNotMatch(acks[0].reason, /excluir um mapa/);

    const linha = await lerMapa(map.id);
    assert.equal(linha.deleted_at, null);
  });

  it('o mapa-base: o mesmo delete pelo outro subtipo é recusado nomeando o mapa-base', async () => {
    const map = await createMap(db, atlas.id);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ operations: [envelopeDeLimpeza(map.id, 'baseLayer')] })
      .expect(200);

    const acks = res.body.data.acks;
    assert.equal(acks[0].rejected, true);
    assert.match(acks[0].reason, /mapa-base/);

    const linha = await lerMapa(map.id);
    assert.equal(linha.deleted_at, null);
  });

  it('controle: a atualização com os cinco campos nulos LIMPA a posição e preserva o mapa', async () => {
    const map = await createMap(db, atlas.id);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        operations: [{
          protocolVersion: 2,
          id: randomUUID(),
          entityType: 'mapPosition',
          operationType: 'update',
          entityId: map.id,
          mapId: map.id,
          data: {
            center_lat: null, center_long: null, zoom: null, bearing: null, pitch: null,
          },
          timestamp: Date.now(),
          clientId: 'repro-client',
        }],
      })
      .expect(200);

    const acks = res.body.data.acks;
    assert.equal(acks.length, 1);
    assert.notEqual(acks[0].rejected, true, `a atualização com nulos não pode ser recusada: ${acks[0].reason}`);

    const linha = await lerMapa(map.id);
    assert.equal(linha.deleted_at, null, 'limpar posição nunca exclui o mapa');
    assert.equal(linha.center_lat, null, 'as colunas de posição precisam ficar nulas');
    assert.equal(linha.zoom, null);
    // `bearing` e `pitch` são NOT NULL DEFAULT 0: o estado limpo delas é o zero, traduzido
    // por `normalizeMapChanges`. Sem essa tradução a op inteira volta recusada por 23502.
    assert.equal(linha.bearing, 0);
    assert.equal(linha.pitch, 0);
  });

  it('controle: a exclusão de mapa DE VERDADE continua excluindo (a guarda é estreita)', async () => {
    const map = await createMap(db, atlas.id);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        operations: [{
          protocolVersion: 2,
          id: randomUUID(),
          entityType: 'map',
          operationType: 'delete',
          entityId: map.id,
          mapId: map.id,
          data: null,
          timestamp: Date.now(),
          clientId: 'repro-client',
        }],
      })
      .expect(200);

    assert.notEqual(res.body.data.acks[0].rejected, true);

    const linha = await lerMapa(map.id);
    assert.notEqual(linha.deleted_at, null, 'o delete sem subtipo continua sendo exclusão de mapa');
  });
});

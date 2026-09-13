// Path: tests/integration/sync-alvo-meta-recusado.test.js
// F13, metade do servidor. `map_meta` e `atlas_meta` estavam em `TARGET_TABLE_MAP`, e estar la
// era o bastante para entrarem em `APPLIABLE_TARGETS`. Nenhum dos dois tinha ramo de aplicacao
// em lugar nenhum: `buildUpdateQuery` e `buildSoftDeleteQuery` nao os mencionam e nenhum caminho
// de create monta as colunas deles. O resultado era a falha exata que
// `unknownTargetDenialReason` existe para impedir: a op consumia um `server_version`, entrava no
// log append-only, voltava acked com `success: true` (e o cliente a DESENFILEIRAVA, confiante de
// que tinha aterrissado) e era retransmitida aos pares com `client_entity_type` preservado, onde
// nenhum cliente tem ramo tambem. Nada era escrito, em canto nenhum.
//
// Nao havia produtor: uma varredura nos dois pacotes em 2026-09-13 nao achou ninguem que emita
// esses dois tipos. Retirar as duas chaves nao tira caminho de ninguem, e faz os dois passarem
// pela recusa por operacao, ANTES do insert no log.
//
// CONTROLE NEGATIVO, medido: devolvendo `map_meta: 'maps'` e `atlas_meta: 'atlas'` ao
// `TARGET_TABLE_MAP`, os dois primeiros casos reprovam (o ack volta com `success: true` e a
// linha aparece em `operations`).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('alvo de metadados sem ramo de aplicacao e recusado, nunca acked em silencio', () => {
  let app, db, owner, ownerToken, atlas, mapa;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `meta_own_${randomUUID().slice(0, 8)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Atlas do Meta' });
    mapa = await createMap(db, atlas.id, { name: 'Mapa do Meta' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ operations });

  const meta = (entityType, entityId, mapId = null) => ({
    protocolVersion: 2,
    id: randomUUID(),
    entityType,
    operationType: 'update',
    entityId,
    mapId,
    data: { name: 'qualquer coisa' },
    timestamp: Date.now(),
    clientId: 'cli-meta',
  });

  const feicao = () => {
    const id = randomUUID();
    return {
      protocolVersion: 2,
      id: randomUUID(),
      entityType: 'feature',
      operationType: 'create',
      entityId: id,
      mapId: mapa.id,
      data: {
        feature_type: 'point',
        geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
        properties: { id, nome: 'PC' },
      },
      timestamp: Date.now(),
      clientId: 'cli-meta',
    };
  };

  it('`map_meta` volta recusado, com o motivo que NOMEIA o tipo', async () => {
    const op = meta('map_meta', mapa.id, mapa.id);
    const res = await push([op]).expect(200);

    const results = res.body.data.results;
    assert.equal(results.length, 1, 'um ack por operação');
    assert.equal(results[0].success, false, 'a recusa não se anuncia como sucesso');
    assert.equal(results[0].rejected, true);
    assert.equal(results[0].status, 'rejected');
    assert.match(results[0].reason, /não conhece o tipo de entidade/);
    assert.match(results[0].reason, /map_meta/, 'e o motivo nomeia o tipo, para a UI e o log');
    // Recusa não queima versão: nem `serverVersion` nem `currentVersion` voltam com número.
    assert.equal(Number.isFinite(results[0].serverVersion), false);
    assert.equal(Number.isFinite(results[0].currentVersion), false);
  });

  it('`atlas_meta` idem, e NENHUM dos dois chega ao log append-only', async () => {
    const op = meta('atlas_meta', atlas.id);
    const res = await push([op]).expect(200);

    assert.equal(res.body.data.results[0].rejected, true);
    assert.match(res.body.data.results[0].reason, /atlas_meta/);

    // A RECUSA VEM ANTES DO INSERT, e essa é a metade que a resposta HTTP não mostra: uma op
    // que ninguém sabe aplicar não pode consumir `server_version` (o cursor do pull
    // incremental) nem ser retransmitida aos pares como um tipo que eles também não conhecem.
    const { rows } = await db.query('SELECT id FROM operations WHERE id = $1', [op.id]);
    assert.equal(rows.length, 0, 'a op recusada não entra no log');
  });

  it('a op sadia do MESMO lote continua sendo aplicada: o lote sobrevive', async () => {
    const boa = feicao();
    const res = await push([meta('map_meta', mapa.id, mapa.id), boa]).expect(200);

    const results = res.body.data.results;
    assert.equal(results.length, 2);
    const recusada = results.filter((r) => r.rejected === true);
    assert.equal(recusada.length, 1, 'só a op de metadados foi recusada');
    const aceita = results.find((r) => r.rejected !== true);
    assert.equal(aceita.success, true, 'a feição do mesmo lote entrou');
    assert.ok(Number.isFinite(aceita.currentVersion), 'e ganhou versão');

    const { rows } = await db.query(
      'SELECT id FROM features WHERE id = $1 AND map_id = $2',
      [boa.entityId, mapa.id],
    );
    assert.equal(rows.length, 1, 'a feição existe no banco');
  });
});

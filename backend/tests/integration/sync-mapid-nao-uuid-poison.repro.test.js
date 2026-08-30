// Path: tests/integration/sync-mapid-nao-uuid-poison.repro.test.js
// REPRO — um `mapId` que não é UUID envenenava o LOTE INTEIRO, com 400 e sem nomear a op.
//
// A CAUSA RAIZ, e ela é sobre ONDE a checagem corre, não sobre o que ela decide. O push
// protege cada operação com um SAVEPOINT e um `catch` que classifica violação de dado
// (`integrityRejectionReason`) e recusa POR OPERAÇÃO, justamente para que uma op ruim não
// trave a fila do cliente. Mas as DUAS recusas que CONSULTAM o banco
// (`lockedMapDenialReason` e `unseenResourceDenialReason`) corriam ANTES do savepoint, e a
// primeira compara `op.mapId` com `maps.id`, que é UUID — enquanto `sync.schemas.js` declara
// `mapId: Joi.string().allow(null)`, sem forma nenhuma. Ou seja, a borda ACEITA a string que
// a consulta não sabe casar: `SELECT locked FROM maps WHERE id = 'Principal'` levanta 22P02
// na própria CHECAGEM, aborta o `tx()` do lote e o `errorHandler` mapeia para 400.
//
// O SINTOMA, medido em 2026-08-30 pelo dono: ao entrar num atlas, `POST /atlas/:id/sync`
// respondendo 400 a cada 1,5 s, para sempre. O cliente não faz dequeue de resposta não-2xx
// (`sync-flush.js`), e a resposta não diz QUAL op ofendeu, então não há nada que ele possa
// descartar. A guarda escrita para impedir que UMA op envenenasse a fila era alcançável por
// fora dela mesma, com sintoma idêntico ao que ela existe para curar.
//
// O `mapId` não-UUID não é hipotético: o mapa local `Principal` é chaveado por NOME. O cliente
// hoje derruba essas ops antes do flush (`operation-dispatcher.js`), mas essa guarda é do
// CLIENTE, não alcança op já enfileirada no IndexedDB de uma versão anterior, e não alcança
// nenhum outro cliente. O servidor tem de sobreviver ao payload que ele mesmo aceita.
//
// O QUE ESTE ARQUIVO PRENDE:
//   (a) VIVACIDADE: 200 no lote, a op boa do MESMO lote persiste, e a ofensora é NOMEADA
//       (`operationId` + `rejected` + `reason`), que é o que o cliente precisa para descartar;
//   (b) a ofensora não escreve e não fica no log de operações;
//   (c) o motivo é genérico (nada de SQLSTATE, nome de coluna ou texto do driver);
//   (d) CONTROLE POSITIVO: a MESMA op com o `mapId` real do atlas persiste — prova que o
//       vermelho vinha da forma do id e não do resto do payload.
//
// CONTROLE NEGATIVO: mova as duas chamadas de `lockedMapDenialReason` /
// `unseenResourceDenialReason` de volta para ANTES do `t.tx(...)` em `pushOperations`
// (sync.service.js) e (a), (b) e (c) caem, com 400 no lugar do 200.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Push com mapId que não é UUID (repro do 400 em laço)', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: `mid_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });

  const criaFeicao = (featureId, mapId) => ({
    id: randomUUID(),
    type: 'create',
    target: 'feature',
    targetId: featureId,
    mapId,
    data: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
      properties: { id: featureId, source: 'point' },
    },
    timestamp: Date.now(),
    clientId: 'mid-client',
  });

  it('recusa POR OPERAÇÃO e deixa a op boa do mesmo lote passar', async () => {
    const idBom = randomUUID();
    const opBoa = criaFeicao(idBom, map.id);
    // 'Principal' é o mapa local chaveado por nome: exatamente o que chegava do cliente.
    const opOfensora = criaFeicao(randomUUID(), 'Principal');

    const res = await push([opBoa, opOfensora]);

    assert.equal(res.status, 200, 'um mapId não-UUID não pode derrubar o lote (era 400 em laço)');

    const results = res.body.data.results;

    const boa = results.find((r) => r.operationId === opBoa.id);
    assert.ok(boa, 'a op boa é acusada por operação');
    assert.equal(boa.success, true);

    const ofensora = results.find((r) => r.operationId === opOfensora.id);
    assert.ok(ofensora, 'a op OFENSORA é identificada — sem isto o cliente não sabe o que descartar');
    assert.equal(ofensora.success, false);
    assert.equal(ofensora.rejected, true);
    assert.equal(typeof ofensora.reason, 'string');
    assert.ok(ofensora.reason.length > 0, 'a recusa vem com um motivo exibível');

    const motivo = ofensora.reason.toLowerCase();
    for (const vazamento of ['22p02', 'sqlstate', 'uuid', 'maps', 'column', 'syntax']) {
      assert.ok(!motivo.includes(vazamento), `o motivo não pode vazar "${vazamento}": ${ofensora.reason}`);
    }

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [idBom]);
    assert.equal(rows.length, 1, 'VIVACIDADE: a op válida do mesmo lote persiste');

    const { rows: logOfensora } = await db.query(
      'SELECT op_id FROM operations WHERE op_id = $1', [opOfensora.id]
    );
    assert.equal(logOfensora.length, 0, 'a ofensora não fica no log (o savepoint reverte log e efeito)');

    const { rows: logBoa } = await db.query(
      'SELECT op_id FROM operations WHERE op_id = $1', [opBoa.id]
    );
    assert.equal(logBoa.length, 1, 'e a op boa fica');
  });

  it('a ofensora sozinha também devolve 200, e não 400', async () => {
    // O caso do relato: a fila só tinha a op envenenada, então não havia op boa para
    // mascarar nada. É este lote que voltava a cada 1,5 s.
    const opOfensora = criaFeicao(randomUUID(), 'Principal');
    const res = await push([opOfensora]);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.results.length, 1);
    assert.equal(res.body.data.results[0].rejected, true);
  });

  it('CONTROLE POSITIVO: a mesma op com o mapId real do atlas persiste', async () => {
    const id = randomUUID();
    const res = await push([criaFeicao(id, map.id)]);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.results[0].success, true);

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [id]);
    assert.equal(rows.length, 1, 'o vermelho do caso acima vinha da FORMA do mapId, não do payload');
  });
});

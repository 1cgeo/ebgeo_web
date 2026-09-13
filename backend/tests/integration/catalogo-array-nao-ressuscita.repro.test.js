// Path: tests/integration/catalogo-array-nao-ressuscita.repro.test.js
//
// CAUSA RAIZ (F8, achado do fechamento 03). `applyCatalogLayerOp` tem duas formas, e só uma
// delas tinha guarda de túmulo. A forma POR CAMADA está certa desde sempre: o `create` só
// revive uma linha que REALMENTE é túmulo (`WHERE catalog_layers.deleted_at IS NOT NULL`, o
// gesto deliberado de re-adicionar) e o `update` exige `deleted_at IS NULL`. A forma ARRAY
// (`data.catalog_layers`, o atalho de compatibilidade do cliente pré-F11) fazia
//
//     ON CONFLICT (map_id, id) DO UPDATE SET data = EXCLUDED.data, deleted_at = NULL, ...
//
// sem `WHERE` nenhum. Consequência medida aqui: UMA op de array ressuscitava TODA camada de
// catálogo apagada cujo id ela por acaso nomeasse, e a trazia de volta com a definição velha
// que o remetente ainda carregava. A exclusão confirmada perdia para um array antigo, e o
// cliente recebia `rejected: undefined` — ou seja, sucesso.
//
// O CONSERTO é convergir para a forma por camada em vez de inventar regra: o array é
// update-shaped (todo emissor dele, passado e presente, carimba `operationType: 'update'`),
// então o ramo de conflito passa a ter a política de UPDATE da forma por camada
// (`WHERE catalog_layers.deleted_at IS NULL`, e sem `deleted_at = NULL` no SET), enquanto o
// ramo sem conflito mantém o INSERT que o atalho precisa.
//
// O QUE ESTE ARQUIVO NÃO AFIRMA, de propósito: que a linha VIVA fique intocada. Escrever a
// linha viva é a semântica declarada do atalho, e `sync-catalog-layer.test.js` a prende. O
// terceiro caso abaixo é o controle ABSOLUTO contra o conserto exagerado: uma guarda posta no
// ramo de conflito inteiro (em vez de só sobre o túmulo) deixaria o atalho mudo, e um atalho
// mudo passa verde em qualquer teste que só olhe o túmulo.
//
// CONTROLE NEGATIVO: devolver `deleted_at = NULL` ao SET e apagar o `WHERE` deixa o primeiro
// caso vermelho (a camada volta viva, com a definição velha).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('F8 — a forma array de catalogLayer não ressuscita exclusão confirmada', () => {
  let app, db, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const owner = await createUser(db, { username: 'arr_tumulo_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Array vs tumulo' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(200);

  /** Per-layer op: the shape the live client mints. */
  const opDeCamada = (operationType, mapId, entityId, data) => ({
    protocolVersion: 2,
    id: randomUUID(),
    entityType: 'catalogLayer',
    operationType,
    entityId,
    mapId,
    data,
    timestamp: Date.now(),
    clientId: 'c-por-camada',
  });

  /** Legacy whole-array op: `entityId` is the MAP id, the payload is the whole list. */
  const opDeArray = (mapId, itens) => ({
    protocolVersion: 2,
    id: randomUUID(),
    entityType: 'catalogLayer',
    operationType: 'update',
    entityId: mapId,
    mapId,
    data: { catalog_layers: itens },
    timestamp: Date.now(),
    clientId: 'c-array-legado',
  });

  const linha = async (mapId, id) => {
    const { rows } = await db.query(
      'SELECT id, data, version, deleted_at FROM catalog_layers WHERE map_id = $1 AND id = $2',
      [mapId, id],
    );
    assert.equal(rows.length, 1, `a linha ${id} existe (uma só)`);
    return rows[0];
  };

  it('a camada apagada por op continua apagada quando um array antigo a nomeia', async () => {
    const map = await createMap(db, atlas.id, { name: 'Tumulo vs array' });

    await push([opDeCamada('create', map.id, 'hillshade', { nome: 'Relevo', visible: true })]);
    await push([opDeCamada('delete', map.id, 'hillshade', {})]);

    const apagada = await linha(map.id, 'hillshade');
    assert.ok(apagada.deleted_at, 'pré-condição: a camada está apagada');
    const dataAntes = apagada.data;
    const versaoAntes = apagada.version;

    // O array que o cliente antigo ainda carrega: ele nunca soube da exclusão.
    const resposta = await push([opDeArray(map.id, [
      { id: 'hillshade', nome: 'Relevo (cópia velha)', visible: true },
    ])]);
    assert.equal(resposta.body.data.acks.length, 1, 'a op foi respondida por operação');
    assert.equal(resposta.body.data.acks[0].rejected, undefined,
      'a forma array continua aceita: o conserto é sobre o EFEITO, não sobre recusá-la');

    const depois = await linha(map.id, 'hillshade');
    assert.ok(depois.deleted_at, 'a exclusão confirmada sobrevive ao array antigo');
    assert.equal(depois.deleted_at.getTime(), apagada.deleted_at.getTime(),
      'e é a MESMA exclusão: o túmulo não foi reescrito');
    assert.deepEqual(depois.data, dataAntes, 'nem a definição velha do array encostou na linha');
    assert.equal(depois.version, versaoAntes, 'nem a versão andou');

    // A outra metade: o snapshot não entrega a camada de volta.
    const snap = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const doMapa = snap.body.data.snapshot.maps.find((m) => m.id === map.id);
    assert.deepEqual(doMapa.catalogLayers, [], 'o snapshot continua sem a camada apagada');
  });

  it('o túmulo de UMA camada não impede o array de materializar as outras', async () => {
    const map = await createMap(db, atlas.id, { name: 'Tumulo ao lado de novas' });

    await push([opDeCamada('create', map.id, 'morta', { nome: 'Morta' })]);
    await push([opDeCamada('delete', map.id, 'morta', {})]);

    await push([opDeArray(map.id, [
      { id: 'morta', nome: 'Morta (velha)' },
      { id: 'nova-a', nome: 'Nova A' },
      { id: 'nova-b', nome: 'Nova B' },
    ])]);

    const { rows } = await db.query(
      `SELECT id FROM catalog_layers
       WHERE map_id = $1 AND deleted_at IS NULL ORDER BY id`,
      [map.id],
    );
    assert.deepEqual(rows.map((r) => r.id), ['nova-a', 'nova-b'],
      'as duas novas entraram e a morta ficou fora');
    assert.ok((await linha(map.id, 'morta')).deleted_at, 'a morta segue morta');
  });

  it('CONTROLE ABSOLUTO: a linha VIVA que o array nomeia continua sendo escrita', async () => {
    // Sem esta asserção, uma guarda posta sobre o ramo de conflito INTEIRO (e não só sobre o
    // túmulo) deixaria o atalho mudo, e os dois casos acima ficariam verdes do mesmo jeito.
    const map = await createMap(db, atlas.id, { name: 'Viva sob array' });

    await push([opDeCamada('create', map.id, 'viva', { nome: 'Viva', visible: true })]);
    const antes = await linha(map.id, 'viva');

    await push([opDeArray(map.id, [{ id: 'viva', nome: 'Viva', visible: false }])]);

    const depois = await linha(map.id, 'viva');
    assert.equal(depois.deleted_at, null, 'ela continua viva');
    assert.equal(depois.data.visible, false, 'e recebeu o que o array carregou');
    assert.equal(depois.version, antes.version + 1, 'a versão andou uma vez');
  });
});

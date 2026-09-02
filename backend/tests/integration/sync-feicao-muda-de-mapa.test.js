// Path: tests/integration/sync-feicao-muda-de-mapa.test.js

/**
 * @fileoverview MOVE-ON-CREATE: a feature create that lands on a LIVE row of ANOTHER map
 * of the SAME atlas moves the row, and the last write wins.
 *
 * WHY THIS FILE EXISTS. The create upsert in `applyOperation` (`src/modules/sync/sync.service.js`)
 * used to guard the DO UPDATE with `WHERE features.deleted_at IS NOT NULL` alone, so `map_id`
 * could never change through a create: only tombstones were revived, and a create aimed at a
 * different map of a LIVE row wrote nothing while still being acked as success. That the upsert
 * "moves the row" was assumed for months and never measured. Moving a whole LAYER to another
 * map is what refuted it: the client mints a new layer in the destination, replays each feature
 * create there with the SAME entity id, and deletes the source layer, emitting NO feature delete
 * (a delete of that id would kill the row it had just moved). With the old guard the destination
 * came back empty and the features stayed in the source map.
 *
 * WHAT EACH CASE PINS, and each one is a different half of the rule:
 *   (a) the move itself: same id, other map of the same atlas, `map_id` and `layer_id` follow
 *       the payload and `version` goes up by exactly one. This is the case the OLD `WHERE`
 *       fails, and it is the negative control of the change.
 *   (b) the guard that stays: a replay of the create in the SAME map is inert, even carrying a
 *       different geometry. This is the property the second disjunct must not cost.
 *   (c) the cross-atlas guard is untouched, and it is not this clause that carries it: the
 *       INSERT ... SELECT ... WHERE EXISTS materialises no row for a foreign atlas's map, so
 *       there is no conflict and the feature does not move.
 *   (d) the layer-delete cascade is scoped by layer AND map, so it does not reach a row that
 *       moved. The case carries a POSITIVE control (a sibling that stayed behind IS deleted),
 *       without which a cascade that had stopped running altogether would pass green.
 *   (e) a delete scoped to the SOURCE map is a no-op on a row that already left, and its
 *       positive control is the same delete aimed at the DESTINATION, which does kill it.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createLayer, loginUser } from '../helpers/fixtures.js';

/**
 * Builds the feature create op the real client emits: a raw GeoJSON Feature whose type and
 * layer live inside `properties` (`deriveFeatureColumns` derives the flat columns from it).
 *
 * @param {string} featureId - Entity id, kept ACROSS the move.
 * @param {string} mapId - Destination map of this create.
 * @param {string|null} layerId - Owning layer in that map.
 * @param {Array<number>} coords - Point coordinates.
 * @param {string} nome - Display name.
 * @returns {Object} A sync operation envelope.
 */
function featureCreateOp(featureId, mapId, layerId, coords, nome) {
  return {
    id: randomUUID(),
    type: 'create',
    target: 'feature',
    targetId: featureId,
    mapId,
    data: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { source: 'point', layerId, nome },
    },
    timestamp: Date.now(),
    clientId: 'move-client',
  };
}

/**
 * @param {string} target - Entity target.
 * @param {string} targetId - Entity id.
 * @param {string} mapId - Map the delete is SCOPED to.
 * @returns {Object} A sync delete operation envelope.
 */
function deleteOp(target, targetId, mapId) {
  return {
    id: randomUUID(),
    type: 'delete',
    target,
    targetId,
    mapId,
    timestamp: Date.now(),
    clientId: 'move-client',
  };
}

describe('Sync: create de feicao carimbado com outro mapa MOVE a linha', () => {
  let app, db, user, token, atlas, atlasVizinho;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: `move_map_${randomUUID().slice(0, 6)}` });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    atlasVizinho = await createAtlas(db, user.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  function pushSync(operations) {
    return supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });
  }

  /**
   * @param {string} featureId - Entity id.
   * @returns {Promise<Object>} The single row, asserted to exist exactly once.
   */
  async function lerFeicao(featureId) {
    const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [featureId]);
    assert.equal(rows.length, 1, 'a feicao existe como UMA linha, movida e nao duplicada');
    return rows[0];
  }

  /**
   * @param {string} mapId - Map id.
   * @returns {Promise<number>} How many live features that map holds.
   */
  async function vivasEm(mapId) {
    const { rows } = await db.query(
      'SELECT count(*)::int AS cnt FROM features WHERE map_id = $1 AND deleted_at IS NULL',
      [mapId]
    );
    return rows[0].cnt;
  }

  it('(a) o mesmo id, criado noutro mapa do MESMO atlas, muda de mapa e de camada', async () => {
    const origem = await createMap(db, atlas.id, { name: 'Origem A' });
    const destino = await createMap(db, atlas.id, { name: 'Destino A' });
    const camadaOrigem = await createLayer(db, origem.id, { name: 'Inimigo' });
    const camadaDestino = await createLayer(db, destino.id, { name: 'Inimigo' });
    const featureId = randomUUID();

    const criacao = await pushSync([
      featureCreateOp(featureId, origem.id, camadaOrigem.id, [-43.2, -22.9], 'Alvo A'),
    ]).expect(200);
    assert.equal(criacao.body.data.results[0].success, true);

    const antes = await lerFeicao(featureId);
    assert.equal(antes.map_id, origem.id);
    assert.equal(antes.layer_id, camadaOrigem.id);

    const mudanca = await pushSync([
      featureCreateOp(featureId, destino.id, camadaDestino.id, [-43.2, -22.9], 'Alvo A'),
    ]).expect(200);
    assert.equal(mudanca.body.data.results[0].success, true);

    const depois = await lerFeicao(featureId);
    assert.equal(depois.map_id, destino.id, 'a linha esta no mapa de destino');
    assert.equal(depois.layer_id, camadaDestino.id, 'e na camada nova, que tem id proprio');
    assert.equal(depois.version, antes.version + 1, 'a version subiu exatamente um');
    assert.equal(depois.deleted_at, null, 'e a linha continua viva');

    assert.equal(await vivasEm(origem.id), 0, 'a origem ficou sem feicao viva');
    assert.equal(await vivasEm(destino.id), 1, 'e o destino tem a feicao movida');
  });

  it('(b) o replay do MESMO create, no MESMO mapa, continua inerte', async () => {
    const mapa = await createMap(db, atlas.id, { name: 'Mapa do replay' });
    const camada = await createLayer(db, mapa.id, { name: 'Camada do replay' });
    const featureId = randomUUID();

    await pushSync([
      featureCreateOp(featureId, mapa.id, camada.id, [-43.2, -22.9], 'Original'),
    ]).expect(200);
    const antes = await lerFeicao(featureId);

    // Mesmo id, mesmo mapa, geometria e nome DIFERENTES: e o create atrasado que o guard
    // antigo existia para recusar, e que o disjunto novo nao pode ter comprado.
    const replay = await pushSync([
      featureCreateOp(featureId, mapa.id, camada.id, [-10.1, -10.1], 'Atrasado'),
    ]).expect(200);
    assert.equal(replay.body.data.results[0].success, true, 'o replay volta acked, nao aplicado');

    const depois = await lerFeicao(featureId);
    assert.deepEqual(
      depois.geometry.coordinates,
      antes.geometry.coordinates,
      'a geometria da linha viva nao mudou'
    );
    assert.equal(depois.properties.nome, 'Original', 'nem as propriedades dela');
    assert.equal(depois.version, antes.version, 'e a version nao andou');
    assert.equal(depois.map_id, mapa.id, 'e ela continua no mesmo mapa');
  });

  it('(c) create com mapa de OUTRO atlas nao move nada e nao escreve linha nenhuma', async () => {
    const origem = await createMap(db, atlas.id, { name: 'Origem C' });
    const camadaOrigem = await createLayer(db, origem.id, { name: 'Camada C' });
    const mapaVizinho = await createMap(db, atlasVizinho.id, { name: 'Mapa de outro atlas' });
    const featureId = randomUUID();

    await pushSync([
      featureCreateOp(featureId, origem.id, camadaOrigem.id, [-43.2, -22.9], 'Alvo C'),
    ]).expect(200);
    const antes = await lerFeicao(featureId);

    const tentativa = await pushSync([
      featureCreateOp(featureId, mapaVizinho.id, null, [-43.2, -22.9], 'Alvo C'),
    ]).expect(200);
    assert.equal(tentativa.body.data.results[0].success, true, 'a op volta acked, e escreve zero linhas');

    const depois = await lerFeicao(featureId);
    assert.equal(depois.map_id, origem.id, 'a feicao ficou onde estava');
    assert.equal(depois.version, antes.version, 'e nada foi escrito nela');
    assert.equal(await vivasEm(mapaVizinho.id), 0, 'o mapa do outro atlas continua vazio');
  });

  it('(d) depois do move, o delete da camada de ORIGEM nao alcanca a linha movida', async () => {
    const origem = await createMap(db, atlas.id, { name: 'Origem D' });
    const destino = await createMap(db, atlas.id, { name: 'Destino D' });
    const camadaOrigem = await createLayer(db, origem.id, { name: 'Inimigo' });
    const camadaDestino = await createLayer(db, destino.id, { name: 'Inimigo' });
    const movidaId = randomUUID();
    const ficouId = randomUUID();

    await pushSync([
      featureCreateOp(movidaId, origem.id, camadaOrigem.id, [-43.2, -22.9], 'Vai embora'),
      featureCreateOp(ficouId, origem.id, camadaOrigem.id, [-43.1, -22.8], 'Fica'),
    ]).expect(200);

    // O move: mesmo id, mapa de destino, camada nova.
    await pushSync([
      featureCreateOp(movidaId, destino.id, camadaDestino.id, [-43.2, -22.9], 'Vai embora'),
    ]).expect(200);

    // O passo 3 da transferencia: apagar a camada de ORIGEM. A cascata do servidor mira
    // (layer_id, map_id), e a linha movida trocou os DOIS.
    const exclusao = await pushSync([deleteOp('layer', camadaOrigem.id, origem.id)]).expect(200);
    assert.equal(exclusao.body.data.results[0].success, true);

    const depoisDaCascata = await lerFeicao(movidaId);
    assert.equal(depoisDaCascata.deleted_at, null, 'a feicao movida sobreviveu a cascata');
    assert.equal(depoisDaCascata.map_id, destino.id, 'e continua no destino');

    // Controle POSITIVO: sem ele, uma cascata que tivesse parado de rodar passaria verde.
    const irma = await lerFeicao(ficouId);
    assert.notEqual(irma.deleted_at, null, 'a irma que ficou na origem foi apagada pela cascata');
  });

  it('(e) delete escopado a ORIGEM e no-op na linha movida, e o do DESTINO a mata', async () => {
    const origem = await createMap(db, atlas.id, { name: 'Origem E' });
    const destino = await createMap(db, atlas.id, { name: 'Destino E' });
    const camadaOrigem = await createLayer(db, origem.id, { name: 'Camada E origem' });
    const camadaDestino = await createLayer(db, destino.id, { name: 'Camada E destino' });
    const featureId = randomUUID();

    await pushSync([
      featureCreateOp(featureId, origem.id, camadaOrigem.id, [-43.2, -22.9], 'Alvo E'),
    ]).expect(200);
    await pushSync([
      featureCreateOp(featureId, destino.id, camadaDestino.id, [-43.2, -22.9], 'Alvo E'),
    ]).expect(200);
    const movida = await lerFeicao(featureId);
    assert.equal(movida.map_id, destino.id);

    await pushSync([deleteOp('feature', featureId, origem.id)]).expect(200);
    const depoisDoDeleteErrado = await lerFeicao(featureId);
    assert.equal(depoisDoDeleteErrado.deleted_at, null, 'o delete escopado a origem e no-op');
    assert.equal(depoisDoDeleteErrado.version, movida.version, 'e nem a version andou');

    // Controle POSITIVO: o mesmo delete, escopado ao mapa em que a linha realmente esta.
    await pushSync([deleteOp('feature', featureId, destino.id)]).expect(200);
    const depoisDoDeleteCerto = await lerFeicao(featureId);
    assert.notEqual(depoisDoDeleteCerto.deleted_at, null, 'e o delete no destino a apaga');
  });
});

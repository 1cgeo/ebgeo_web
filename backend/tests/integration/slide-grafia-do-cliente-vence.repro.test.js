// Path: tests/integration/slide-grafia-do-cliente-vence.repro.test.js
// Regression: a slide that carries BOTH spellings of a field is written with the CLIENT's one.
//
// The server hands a slide back (the canonical receipt of a slide op, the snapshot) with every
// column spread next to the client's camelCase alias: `base_layer` beside `baseLayer`, `map_id` (a
// UUID) beside `mapId` (a NAME), and so on. A client that stores that echo as it came and edits only
// the camelCase field sends the next update with both, the snake_case one STALE. That was every
// client until 2026-09-24, and it is still the tab left open across the switch to main, with its
// queue alive: the client fix (`frontend/src/js/store/sync/slide-shape.js`) reaches only the tabs
// that load the new build.
//
// `normalizeSlidePayload` (`src/modules/sync/sync.service.js`) filled a column from its camelCase
// twin only when the column was absent, so the stale value won: the edit of the base layer, the
// timeline switch, the instant, the map, the 3D model or the 360 photo was acked and never
// written. And because the resource gate reads the same normalized payload, a stale reference to a
// resource that is gone refused the new edit outright.
//
// Owner's decision of 2026-09-26: the client spelling wins when both are present. A payload in one
// spelling only (the 20+ suites that speak snake_case, the current client) is untouched.
//
// Negative control: restore the `rawData[snake] === undefined &&` condition in `fill` and the three
// cases below fail.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createBriefing, loginUser,
  seedCatalogRefs, dropCatalogRefs, seedPublic360Photos, drop360Fixture,
} from '../helpers/fixtures.js';

// Scenery, not the subject: every reference below exists and is public, except the one the third
// case names on purpose. Unique ids, because the catalog tables are shared by the whole suite.
const SUFIXO = randomUUID().slice(0, 8);
const REFS = {
  tilesets: [`grafia-modelo-velho-${SUFIXO}`, `grafia-modelo-novo-${SUFIXO}`],
  basemaps: [`grafia-base-velha-${SUFIXO}`, `grafia-base-nova-${SUFIXO}`],
};
const FOTO_VELHA = `grafia-foto-velha-${SUFIXO}`;
const FOTO_NOVA = `grafia-foto-nova-${SUFIXO}`;
let fotosSemeadas;

before(async () => {
  const env = await setupTestEnv();
  await seedCatalogRefs(env.db, REFS);
  fotosSemeadas = await seedPublic360Photos(env.db, [FOTO_VELHA, FOTO_NOVA]);
  await teardownTestEnv(env.db);
});

after(async () => {
  const env = await setupTestEnv();
  await dropCatalogRefs(env.db, REFS);
  await drop360Fixture(env.db, fotosSemeadas);
  await teardownTestEnv(env.db);
});

describe('slide com as duas grafias: a do cliente vence (repro)', () => {
  let app, db, token, atlas, mapaVelho, mapaNovo;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const owner = await createUser(db, { username: `grafia_${SUFIXO}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Atlas das grafias' });
    mapaVelho = await createMap(db, atlas.id, { name: 'Mapa velho' });
    mapaNovo = await createMap(db, atlas.id, { name: 'Mapa novo' });
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

  const op = (operationType, slideId, briefingId, data) => ({ protocolVersion: 2,
    id: randomUUID(),
    entityType: 'slide',
    operationType,
    entityId: slideId,
    mapId: briefingId,
    data: { id: slideId, order: 0, title: 'Slide', content: '', mode: '2d', ...data },
    timestamp: Date.now(),
    lamportTimestamp: 1,
    clientId: 'aba-antiga',
  });

  /** The six pairs as the first acknowledgement left them, in the CLIENT spelling. */
  const VISTA_VELHA = () => ({
    mapId: 'Mapa velho',
    modelId: REFS.tilesets[0],
    photoId: FOTO_VELHA,
    temporalCursor: 1700000000000,
    baseLayer: REFS.basemaps[0],
    temporalEnabled: false,
  });

  /** The same six in the SERVER spelling, as the echo spread them next to the aliases. */
  const COLUNAS_VELHAS = (briefingId) => ({
    map_id: mapaVelho.id,
    _mapName: 'Mapa velho',
    model_id: REFS.tilesets[0],
    photo_id: FOTO_VELHA,
    temporal_cursor: 1700000000000,
    base_layer: REFS.basemaps[0],
    temporal_enabled: false,
    briefing_id: briefingId,
  });

  const linha = async (slideId) => {
    const { rows } = await db.query(
      `SELECT map_id, model_id, photo_id, temporal_cursor, base_layer, temporal_enabled
         FROM slides WHERE id = $1`, [slideId]);
    assert.equal(rows.length, 1, 'o slide existe no banco');
    return rows[0];
  };

  const criar = async () => {
    const briefing = await createBriefing(db, atlas.id, { name: `Briefing ${randomUUID().slice(0, 6)}` });
    const slideId = randomUUID();
    const res = await push([op('create', slideId, briefing.id, VISTA_VELHA())]);
    assert.equal(res.body.data.results[0].success, true, 'o create foi aplicado');
    const antes = await linha(slideId);
    assert.equal(antes.base_layer, REFS.basemaps[0], 'a vista velha é o ponto de partida');
    return { briefing, slideId };
  };

  it('a edição da aba antiga grava o valor NOVO dos seis campos, não o eco velho', async () => {
    const { briefing, slideId } = await criar();

    const res = await push([op('update', slideId, briefing.id, {
      ...COLUNAS_VELHAS(briefing.id),
      mapId: 'Mapa novo',
      modelId: REFS.tilesets[1],
      photoId: FOTO_NOVA,
      temporalCursor: 1750000000000,
      baseLayer: REFS.basemaps[1],
      temporalEnabled: true,
    })]);
    assert.equal(res.body.data.results[0].success, true, 'o update foi aplicado');

    const depois = await linha(slideId);
    assert.equal(depois.map_id, mapaNovo.id, 'mapa: o nome novo, resolvido para o id');
    assert.equal(depois.model_id, REFS.tilesets[1]);
    assert.equal(depois.photo_id, FOTO_NOVA);
    assert.equal(Number(depois.temporal_cursor), 1750000000000);
    assert.equal(depois.base_layer, REFS.basemaps[1]);
    assert.equal(depois.temporal_enabled, true);
  });

  it('limpar o campo na aba antiga (nulo no cliente) grava nulo, não o eco velho', async () => {
    const { briefing, slideId } = await criar();

    const res = await push([op('update', slideId, briefing.id, {
      ...COLUNAS_VELHAS(briefing.id),
      mapId: null,
      modelId: null,
      photoId: null,
      temporalCursor: null,
      baseLayer: null,
      temporalEnabled: null,
    })]);
    assert.equal(res.body.data.results[0].success, true, 'o update foi aplicado');

    const depois = await linha(slideId);
    // The map is the one that needs more than the precedence: the echo also carried the server's
    // private `_mapName`, and a null `map_id` falls back to it.
    assert.equal(depois.map_id, null, 'mapa: nem o id velho nem o nome velho');
    assert.equal(depois.model_id, null);
    assert.equal(depois.photo_id, null);
    assert.equal(depois.temporal_cursor, null);
    assert.equal(depois.base_layer, null);
    assert.equal(depois.temporal_enabled, null);
  });

  it('uma referência VELHA a recurso que sumiu não recusa a edição nova', async () => {
    const { briefing, slideId } = await criar();

    const res = await push([op('update', slideId, briefing.id, {
      ...COLUNAS_VELHAS(briefing.id),
      base_layer: `grafia-base-que-sumiu-${SUFIXO}`,
      baseLayer: REFS.basemaps[1],
    })]);
    assert.equal(res.body.data.results[0].success, true,
      `o gate lê a base que a pessoa escolheu (veio ${JSON.stringify(res.body.data.results[0])})`);
    assert.equal((await linha(slideId)).base_layer, REFS.basemaps[1]);
  });
});

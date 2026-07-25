// Path: tests/integration/sync-check-constraint-poison.test.js
// Item 23 — operação cujo payload viola um CHECK do schema.
//
// `data` e `changes` são `Joi.object().unknown(true)` no envelope de sync, então o
// CHECK do banco é o ÚNICO validador desses valores, e o push inteiro roda numa
// transação única. Uma única op com `opacity: 1.5` ou `feature_type` fora da lista
// estoura 23514 no meio do lote: as demais são revertidas e o cliente, que só sabe
// reenfileirar, retenta o mesmo lote para sempre — fila de sync travada.
//
// O que este arquivo prende:
//   (a) o CÓDIGO HTTP é 4xx (nunca 500) — `error-handler.js` mapeia 23514 → 400;
//   (b) a ATOMICIDADE do lote (a op boa que veio antes não persiste);
//   (c) o controle positivo com os MESMOS valores válidos (prova que o vermelho
//       veio do CHECK e não do setup);
//   (d) os limites inclusivos de `layers_opacity_range`.
//
// Contrato NÃO atendido hoje, pinado explicitamente no último caso: a resposta 400
// NÃO identifica QUAL op ofendeu, então o cliente não tem como descartar a op
// envenenada. Trocar isso é decisão de produto (exige mudar sync.service.js, fora
// desta fatia); enquanto não muda, fica registrado como comportamento.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createLayer, loginUser } from '../helpers/fixtures.js';

describe('Push com payload que viola CHECK do schema (item 23)', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: `chk_${randomUUID().slice(0, 8)}` });
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

  const criaFeicao = (id, featureType = 'point') => ({
    id: randomUUID(),
    type: 'create',
    target: 'feature',
    targetId: id,
    mapId: map.id,
    data: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
      properties: { id, source: featureType },
    },
    timestamp: Date.now(),
    clientId: 'chk-client',
  });

  /** Empurra [op boa, op ofensora] e devolve a resposta; a op boa NÃO pode persistir. */
  async function pushEnvenenado(opOfensora) {
    const idBom = randomUUID();
    const res = await push([criaFeicao(idBom), opOfensora]);

    assert.ok(res.status >= 400 && res.status < 500,
      `CHECK violado precisa virar 4xx, veio ${res.status}`);
    assert.ok(res.status !== 500, 'nunca 500');

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [idBom]);
    assert.equal(rows.length, 0, 'atomicidade: a op válida do mesmo lote é revertida');

    const { rows: logged } = await db.query(
      'SELECT op_id FROM operations WHERE op_id = ANY($1::text[])',
      [[opOfensora.id]]
    );
    assert.equal(logged.length, 0, 'a op ofensora também não fica no log');
    return res;
  }

  it('layers_opacity_range: changes {opacity: 1.5} não vira 500 e reverte o lote', async () => {
    const layer = await createLayer(db, map.id, { name: 'Camada CHK' });
    const res = await pushEnvenenado({
      id: randomUUID(),
      type: 'update',
      target: 'layer',
      targetId: layer.id,
      mapId: map.id,
      changes: { opacity: 1.5 },
      timestamp: Date.now(),
      clientId: 'chk-client',
    });
    assert.equal(res.body.error.code, 'BAD_REQUEST');

    const { rows } = await db.query('SELECT opacity FROM layers WHERE id = $1', [layer.id]);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].opacity), 1, 'a opacidade original permanece');
  });

  it('valid_feature_type: create com feature_type fora da lista não vira 500', async () => {
    const id = randomUUID();
    const res = await pushEnvenenado({
      id: randomUUID(),
      type: 'create',
      target: 'feature',
      targetId: id,
      mapId: map.id,
      data: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id, source: 'trajetoria' },
      },
      timestamp: Date.now(),
      clientId: 'chk-client',
    });
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('cesium3d_data.data_type inválido não vira 500', async () => {
    const res = await pushEnvenenado({
      id: randomUUID(),
      type: 'create',
      target: 'cesium3d',
      targetId: randomUUID(),
      mapId: map.id,
      data: { data_type: 'heatmap', tileset_id: 'PCL', data: { qualquer: 1 } },
      timestamp: Date.now(),
      clientId: 'chk-client',
    });
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('streetview360_data.data_type inválido não vira 500', async () => {
    const res = await pushEnvenenado({
      id: randomUUID(),
      type: 'create',
      target: 'streetview360',
      targetId: randomUUID(),
      mapId: map.id,
      data: { data_type: 'panorama', photo_name: 'p1', data: { heading: 0 } },
      timestamp: Date.now(),
      clientId: 'chk-client',
    });
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('controle positivo: os MESMOS quatro payloads com valores VÁLIDOS retornam 200 e persistem', async () => {
    const layer = await createLayer(db, map.id, { name: 'Camada OK' });
    const featId = randomUUID();
    const c3dId = randomUUID();
    const sv360Id = randomUUID();

    await push([
      {
        id: randomUUID(), type: 'update', target: 'layer', targetId: layer.id, mapId: map.id,
        changes: { opacity: 0.5 }, timestamp: Date.now(), clientId: 'chk-client',
      },
      criaFeicao(featId, 'point'),
      {
        id: randomUUID(), type: 'create', target: 'cesium3d', targetId: c3dId, mapId: map.id,
        data: { data_type: 'marker', tileset_id: 'PCL', data: { properties: { name: 'ok' } } },
        timestamp: Date.now(), clientId: 'chk-client',
      },
      {
        id: randomUUID(), type: 'create', target: 'streetview360', targetId: sv360Id, mapId: map.id,
        data: { data_type: 'marker', photo_name: 'p1', data: { heading: 0 } },
        timestamp: Date.now(), clientId: 'chk-client',
      },
    ]).expect(200);

    const lay = await db.query('SELECT opacity FROM layers WHERE id = $1', [layer.id]);
    assert.equal(lay.rows.length, 1);
    assert.equal(Number(lay.rows[0].opacity), 0.5);

    const feat = await db.query('SELECT feature_type FROM features WHERE id = $1', [featId]);
    assert.equal(feat.rows.length, 1);
    assert.equal(feat.rows[0].feature_type, 'point');

    const c3d = await db.query('SELECT data_type FROM cesium3d_data WHERE id = $1', [c3dId]);
    assert.equal(c3d.rows.length, 1);
    assert.equal(c3d.rows[0].data_type, 'marker');

    const sv = await db.query('SELECT data_type FROM streetview360_data WHERE id = $1', [sv360Id]);
    assert.equal(sv.rows.length, 1);
    assert.equal(sv.rows[0].data_type, 'marker');
  });

  it('layers_opacity_range: 0 e 1 passam; -0.0001 e 1.0001 não (limites inclusivos)', async () => {
    const layer = await createLayer(db, map.id, { name: 'Camada limites' });
    const set = (opacity) =>
      push([{
        id: randomUUID(), type: 'update', target: 'layer', targetId: layer.id, mapId: map.id,
        changes: { opacity }, timestamp: Date.now(), clientId: 'chk-client',
      }]);

    await set(0).expect(200);
    let cur = await db.query('SELECT opacity FROM layers WHERE id = $1', [layer.id]);
    assert.equal(cur.rows.length, 1);
    assert.equal(Number(cur.rows[0].opacity), 0);

    await set(1).expect(200);
    cur = await db.query('SELECT opacity FROM layers WHERE id = $1', [layer.id]);
    assert.equal(cur.rows.length, 1);
    assert.equal(Number(cur.rows[0].opacity), 1);

    const abaixo = await set(-0.0001);
    assert.equal(abaixo.status, 400);
    const acima = await set(1.0001);
    assert.equal(acima.status, 400);

    cur = await db.query('SELECT opacity FROM layers WHERE id = $1', [layer.id]);
    assert.equal(cur.rows.length, 1);
    assert.equal(Number(cur.rows[0].opacity), 1, 'nenhuma das duas rejeições escreveu');
  });

  it('COMPORTAMENTO ATUAL: a resposta 400 NÃO identifica a op ofensora', async () => {
    // Consequência aceita hoje, pinada para que mudá-la seja decisão explícita: o
    // cliente recebe uma mensagem genérica e não tem como saber QUAL das 500 ops
    // descartar, então só lhe resta retentar o mesmo lote.
    const layer = await createLayer(db, map.id, { name: 'Camada sem nome de op' });
    const ofensora = {
      id: randomUUID(), type: 'update', target: 'layer', targetId: layer.id, mapId: map.id,
      changes: { opacity: 2 }, timestamp: Date.now(), clientId: 'chk-client',
    };
    const res = await push([ofensora]);
    assert.equal(res.status, 400);
    const corpo = JSON.stringify(res.body);
    assert.ok(!corpo.includes(ofensora.id), 'hoje o op.id ofensor não aparece na resposta');
    assert.ok(!corpo.includes('opacity'), 'nem o campo (a mensagem é genérica por segurança)');
  });
});

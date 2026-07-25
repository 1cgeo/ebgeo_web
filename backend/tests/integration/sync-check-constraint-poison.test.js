// Path: tests/integration/sync-check-constraint-poison.test.js
// Item 23 — operação cujo payload viola um CHECK do schema.
//
// `data` e `changes` são `Joi.object().unknown(true)` no envelope de sync, então o
// CHECK do banco é o ÚNICO validador desses valores. Uma única op com `opacity: 1.5`
// ou `feature_type` fora da lista estoura 23514 no meio do lote.
//
// ATÉ 2026-07-25 isso abortava o `tx()` do lote inteiro e devolvia um 400 GENÉRICO. O
// cliente não faz dequeue de não-2xx e a resposta não dizia QUAL op ofendeu, então ele
// reenviava o mesmo lote a cada 1,5 s para sempre: o sync daquele usuário parava, em
// silêncio. Este arquivo pinava esse comportamento — inclusive um caso final que
// afirmava, textualmente, que "a resposta 400 NÃO identifica a op ofensora". Era
// caracterização congelando o defeito, e a decisão que ele dizia estar pendente foi
// tomada: cada op corre no seu próprio SAVEPOINT e uma violação de dado é recusada POR
// OPERAÇÃO, na MESMA forma da recusa de política (`rejected: true` + `reason`, 200 no
// lote), que o cliente já sabe descartar.
//
// O que este arquivo prende agora:
//   (a) VIVACIDADE: a op ofensora é recusada e nomeada (`operationId`), e a op boa do
//       MESMO lote persiste — é isto que impede a fila de travar;
//   (b) o efeito da ofensora não persiste e ela não fica no log de operações
//       (o rollback do savepoint alcança os dois);
//   (c) o `reason` é genérico: nada de nome de constraint, de coluna ou de SQLSTATE
//       (o texto do driver vaza schema e depende do locale);
//   (d) o controle positivo com os MESMOS valores válidos (prova que o vermelho veio do
//       CHECK e não do setup), e os limites inclusivos de `layers_opacity_range`;
//   (e) a FRONTEIRA do recorte: erro que NÃO é violação de dado (403 de política de
//       atlas cruzado) continua abortando o lote inteiro — ver sync-batch-atomicity.
//
// Controle negativo: faça `integrityRejectionReason` (sync.service.js) devolver sempre
// null e (a), (b) e (c) caem.

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

  /**
   * Empurra [op boa, op ofensora] e devolve a resposta.
   * Invariante prendida: 200 no lote, a boa PERSISTE, a ofensora é recusada por
   * operação (nomeada), não escreve e não fica no log.
   */
  async function pushEnvenenado(opOfensora) {
    const idBom = randomUUID();
    const opBoa = criaFeicao(idBom);
    const res = await push([opBoa, opOfensora]);

    assert.equal(res.status, 200, 'uma op inválida não pode mais derrubar o lote');

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [idBom]);
    assert.equal(rows.length, 1, 'VIVACIDADE: a op válida do mesmo lote persiste');

    const results = res.body.data.results;
    const boa = results.find((r) => r.operationId === opBoa.id);
    assert.ok(boa, 'a op boa é acusada por operação');
    assert.equal(boa.success, true);

    const ofensora = results.find((r) => r.operationId === opOfensora.id);
    assert.ok(ofensora, 'a op OFENSORA é identificada no ack — sem isto o cliente não sabe o que descartar');
    assert.equal(ofensora.success, false);
    assert.equal(ofensora.rejected, true);
    assert.equal(typeof ofensora.reason, 'string');
    assert.ok(ofensora.reason.length > 0, 'a recusa vem com um motivo exibível');

    // O motivo não pode carregar o texto cru do Postgres.
    const motivo = ofensora.reason.toLowerCase();
    for (const vazamento of ['constraint', 'check', 'pkey', 'sqlstate', 'violates', 'column', '_range']) {
      assert.ok(!motivo.includes(vazamento), `o motivo não pode vazar "${vazamento}": ${ofensora.reason}`);
    }

    const { rows: logged } = await db.query(
      'SELECT op_id FROM operations WHERE op_id = ANY($1::text[])',
      [[opOfensora.id]]
    );
    assert.equal(logged.length, 0, 'a op ofensora não fica no log (o savepoint reverte log e efeito juntos)');

    const { rows: loggedBoa } = await db.query(
      'SELECT op_id FROM operations WHERE op_id = ANY($1::text[])',
      [[opBoa.id]]
    );
    assert.equal(loggedBoa.length, 1, 'e a op boa fica');
    return res;
  }

  it('layers_opacity_range: changes {opacity: 1.5} é recusado por operação, sem derrubar o lote', async () => {
    const layer = await createLayer(db, map.id, { name: 'Camada CHK' });
    await pushEnvenenado({
      id: randomUUID(),
      type: 'update',
      target: 'layer',
      targetId: layer.id,
      mapId: map.id,
      changes: { opacity: 1.5 },
      timestamp: Date.now(),
      clientId: 'chk-client',
    });

    const { rows } = await db.query('SELECT opacity FROM layers WHERE id = $1', [layer.id]);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].opacity), 1, 'a opacidade original permanece');
  });

  it('valid_feature_type: create com feature_type fora da lista é recusado por operação', async () => {
    const id = randomUUID();
    await pushEnvenenado({
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

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [id]);
    assert.equal(rows.length, 0, 'a feição inválida não foi criada');
  });

  it('cesium3d_data.data_type inválido é recusado por operação', async () => {
    const id = randomUUID();
    await pushEnvenenado({
      id: randomUUID(),
      type: 'create',
      target: 'cesium3d',
      targetId: id,
      mapId: map.id,
      data: { data_type: 'heatmap', tileset_id: 'PCL', data: { qualquer: 1 } },
      timestamp: Date.now(),
      clientId: 'chk-client',
    });

    const { rows } = await db.query('SELECT id FROM cesium3d_data WHERE id = $1', [id]);
    assert.equal(rows.length, 0);
  });

  it('streetview360_data.data_type inválido é recusado por operação', async () => {
    const id = randomUUID();
    await pushEnvenenado({
      id: randomUUID(),
      type: 'create',
      target: 'streetview360',
      targetId: id,
      mapId: map.id,
      data: { data_type: 'panorama', photo_name: 'p1', data: { heading: 0 } },
      timestamp: Date.now(),
      clientId: 'chk-client',
    });

    const { rows } = await db.query('SELECT id FROM streetview360_data WHERE id = $1', [id]);
    assert.equal(rows.length, 0);
  });

  it('22P02: um targetId que não é UUID é recusado por operação (e não 400a o lote)', async () => {
    // O outro SQLSTATE citado no relatório: valor malformado no cast. Ops de atlas
    // (`setting`) usam a sentinela 'atlas' e são desviadas antes do cast; uma feição
    // com id lixo, não.
    await pushEnvenenado({
      id: randomUUID(),
      type: 'update',
      target: 'feature',
      targetId: 'nao-e-uuid',
      mapId: map.id,
      changes: { properties: { nome: 'x' } },
      timestamp: Date.now(),
      clientId: 'chk-client',
    });
  });

  it('FRONTEIRA: erro que não é violação de dado (403 de política) ainda derruba o lote', async () => {
    // O recorte é estreito de propósito: só as classes SQLSTATE 22/23 (função
    // determinística do payload) viram recusa por operação. Um 40001, um 55P03 ou um
    // AppError podem dar certo na retentativa, e descartar op boa é perda de dado.
    const outroAtlas = await createAtlas(db, user.id, { name: 'Atlas vizinho' });
    const outroMapa = await createMap(db, outroAtlas.id);
    const idBom = randomUUID();

    const res = await push([
      criaFeicao(idBom),
      {
        id: randomUUID(), type: 'update', target: 'feature', targetId: randomUUID(),
        mapId: map.id, changes: { map_id: outroMapa.id },
        timestamp: Date.now() + 1, clientId: 'chk-client',
      },
    ]);
    assert.equal(res.status, 403, 'referência a mapa de outro atlas continua abortando o push');

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [idBom]);
    assert.equal(rows.length, 0, 'atomicidade preservada fora do recorte: a op boa é revertida');
  });

  it('controle positivo: os MESMOS quatro payloads com valores VÁLIDOS retornam 200 e persistem', async () => {
    const layer = await createLayer(db, map.id, { name: 'Camada OK' });
    const featId = randomUUID();
    const c3dId = randomUUID();
    const sv360Id = randomUUID();

    const res = await push([
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

    // Nenhuma recusa: senão o verde acima provaria só que o servidor respondeu 200.
    assert.deepEqual(
      res.body.data.results.filter((r) => r.success === false),
      [],
      'nenhuma das quatro ops válidas pode ser recusada'
    );

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

  it('layers_opacity_range: 0 e 1 passam; -0.0001 e 1.0001 são recusados (limites inclusivos)', async () => {
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

    // Fora do intervalo: 200 no lote (nada a envenenar), recusa POR OPERAÇÃO.
    const abaixo = await set(-0.0001);
    assert.equal(abaixo.status, 200);
    assert.equal(abaixo.body.data.results[0].rejected, true);
    const acima = await set(1.0001);
    assert.equal(acima.status, 200);
    assert.equal(acima.body.data.results[0].rejected, true);

    cur = await db.query('SELECT opacity FROM layers WHERE id = $1', [layer.id]);
    assert.equal(cur.rows.length, 1);
    assert.equal(Number(cur.rows[0].opacity), 1, 'nenhuma das duas rejeições escreveu');
  });

  it('a recusa por dado é DETERMINÍSTICA: reenviar a mesma op devolve a mesma recusa, nunca um efeito', async () => {
    // A garantia que autoriza o cliente a descartar a op. (Ela não entra no log, então
    // não há idempotência por op_id para invocar aqui — o que prende a resposta é o
    // CHECK, que não muda.)
    const layer = await createLayer(db, map.id, { name: 'Camada reenvio' });
    const op = {
      id: randomUUID(), type: 'update', target: 'layer', targetId: layer.id, mapId: map.id,
      changes: { opacity: 7 }, timestamp: Date.now(), clientId: 'chk-client',
    };
    const a = await push([op]);
    const b = await push([op]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.data.results[0].rejected, true);
    assert.equal(b.body.data.results[0].rejected, true);
    assert.equal(a.body.data.results[0].reason, b.body.data.results[0].reason);

    const cur = await db.query('SELECT opacity FROM layers WHERE id = $1', [layer.id]);
    assert.equal(Number(cur.rows[0].opacity), 1);
  });
});

// Path: tests/integration/copia-realinha-camada-da-feicao.repro.test.js
//
// A COPIA DE ATLAS (e a duplicacao de mapa) RECUNHA O ID DE CADA CAMADA, E A FEICAO COPIADA
// CONTINUAVA APONTANDO PARA A CAMADA DA ORIGEM.
//
// `cloneMapSubEntities` (`src/modules/atlas/atlas.service.js`) cunha um UUID novo para cada camada
// e remapeia a COLUNA `features.layer_id`, mas copiava `properties` verbatim. Uma feicao escrita
// pelo cliente real carrega `properties.layerId` igual a coluna (o cliente e quem escolhe a camada,
// e `deriveFeatureColumns` deriva a coluna dessa propriedade), e o snapshot serve `properties` do
// JSONB sem reescrever `layerId` a partir da coluna (`transformFeaturesToFrontend`). Resultado: no
// atlas copiado, TODA feicao de camada nao nula chegava ao cliente com `properties.layerId` igual a
// um id que so existe no atlas de ORIGEM.
//
// O que isso custa na tela: o cliente decide camada pela propriedade, nunca pela coluna. O filtro
// de visibilidade do MapLibre e `['in', ['coalesce', ['get','layerId'], 'default'], camadas]`
// (`frontend/src/js/layers/visibility-filter.js`), entao a feicao cuja camada nao existe fica fora
// de todas; a aba de feicoes agrupa por `properties.layerId`; "ocultar/travar camada" pergunta por
// ela (`isFeatureEffectivelyVisible`). A copia nasce com as feicoes gravadas no servidor e sem
// dono na tela.
//
// A importacao ja tinha o realinhamento (`propriedadesRealinhadas`); a copia e a duplicacao nao.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createLayer, loginUser } from '../helpers/fixtures.js';

describe('copia de atlas e duplicacao de mapa realinham properties.layerId com a camada nova', () => {
  let app, db, owner, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `cplayer_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Semeia um atlas com uma camada e uma feicao gravada PELO SYNC, como o cliente real grava. */
  const semear = async () => {
    const atlas = await createAtlas(db, owner.id, { name: `CP ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'Origem' });
    const camada = await createLayer(db, map.id, { name: 'Tropas' });
    const featureId = randomUUID();
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [{
        protocolVersion: 2, id: randomUUID(), entityType: 'feature', operationType: 'create',
        entityId: featureId, mapId: map.id, timestamp: Date.now(), clientId: 'cli-a',
        data: {
          id: featureId, feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-45, -20] },
          properties: { id: featureId, source: 'point', nome: 'Posto', layerId: camada.id },
        },
      }] })
      .expect(200);
    assert.equal(res.body.data.results[0].status, 'applied', 'a feicao de origem precisa ter sido aplicada');
    const { rows } = await db.query('SELECT layer_id, properties FROM features WHERE id = $1', [featureId]);
    // PISO: na origem a propriedade espelha a coluna. Sem isto o caso mediria uma fixture torta.
    assert.equal(rows[0].layer_id, camada.id);
    assert.equal(rows[0].properties.layerId, camada.id);
    return { atlas, map, camada, featureId };
  };

  /** As feicoes e as camadas do mapa `mapId` como o SNAPSHOT as entrega ao cliente. */
  const doSnapshot = async (atlasId, mapId) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlasId}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const mapa = res.body.data.snapshot.maps.find((m) => m.id === mapId);
    assert.ok(mapa, 'o mapa precisa estar no snapshot');
    return { camadas: mapa.layers.map((l) => l.id), pontos: mapa.features.points };
  };

  it('CLONE: a feicao copiada aponta, pela propriedade, para uma camada QUE EXISTE na copia', async () => {
    const { atlas, camada } = await semear();

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    const copia = res.body.data;
    const mapaCopia = copia.maps[0];

    const { camadas, pontos } = await doSnapshot(copia.id, mapaCopia.id);
    assert.equal(pontos.length, 1, 'a feicao foi copiada');
    assert.equal(camadas.length, 1, 'a camada foi copiada');
    assert.notEqual(camadas[0], camada.id, 'a camada da copia tem id proprio');
    assert.equal(pontos[0].properties.layerId, camadas[0],
      'properties.layerId precisa nomear a camada DA COPIA, nao a da origem');

    // A coluna e a propriedade dizem a mesma coisa no banco da copia.
    const { rows } = await db.query('SELECT layer_id, properties FROM features WHERE id = $1',
      [pontos[0].properties.id]);
    assert.equal(rows[0].properties.layerId, rows[0].layer_id);
  });

  it('DUPLICACAO de mapa: a mesma regra, pela mesma funcao de copia', async () => {
    const { atlas, map, camada } = await semear();

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/duplicate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const novoMapaId = res.body.data.id;

    const { camadas, pontos } = await doSnapshot(atlas.id, novoMapaId);
    assert.equal(pontos.length, 1);
    assert.equal(camadas.length, 1);
    assert.notEqual(camadas[0], camada.id);
    assert.equal(pontos[0].properties.layerId, camadas[0]);
  });

  it('BORDA: feicao da camada padrao (layerId "default", coluna nula) continua na camada padrao da copia', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `CPd ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'Origem' });
    await db.query(
      `INSERT INTO features (map_id, feature_type, geometry, properties, layer_id)
       VALUES ($1, 'point', '{"type":"Point","coordinates":[0,0]}'::jsonb,
               '{"source":"point","layerId":"default"}'::jsonb, NULL)`,
      [map.id],
    );
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    const mapaCopia = res.body.data.maps[0];
    const { camadas, pontos } = await doSnapshot(res.body.data.id, mapaCopia.id);
    assert.equal(pontos.length, 1);
    assert.equal(camadas.length, 1, 'ensureMapLayers cria a camada padrao da copia');
    assert.equal(pontos[0].properties.layerId, camadas[0],
      'a feicao sem camada e presa a camada padrao da copia (ensureMapLayers)');
  });

  // A REGRA DO IMPORT: so se reescreve a propriedade que ESPELHAVA a coluna. Uma feicao cuja
  // propriedade ja divergia da coluna na origem fica com a propriedade como estava, e quem decide
  // a camada servida e a coluna (o retrato a deriva dela), dos dois lados da copia.
  it('DIVERGENCIA na origem: a propriedade nao espelhava a coluna e nao e reescrita; o retrato serve a coluna', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `CPv ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'Origem' });
    const camadaA = await createLayer(db, map.id, { name: 'A', sort_order: 0 });
    const camadaB = await createLayer(db, map.id, { name: 'B', sort_order: 1 });
    await db.query(
      `INSERT INTO features (map_id, feature_type, geometry, properties, layer_id)
       VALUES ($1, 'point', '{"type":"Point","coordinates":[0,0]}'::jsonb, $2::jsonb, $3)`,
      [map.id, JSON.stringify({ source: 'point', layerId: camadaB.id }), camadaA.id],
    );
    // A origem ja serve a camada da COLUNA.
    const origem = await doSnapshot(atlas.id, map.id);
    assert.equal(origem.pontos[0].properties.layerId, camadaA.id);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    const mapaCopia = res.body.data.maps[0];
    const { rows } = await db.query('SELECT layer_id, properties FROM features WHERE map_id = $1', [mapaCopia.id]);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].layer_id, camadaA.id, 'a coluna foi remapeada');
    assert.equal(rows[0].properties.layerId, camadaB.id, 'a propriedade que nao espelhava fica como estava');

    const copia = await doSnapshot(res.body.data.id, mapaCopia.id);
    assert.equal(copia.pontos[0].properties.layerId, rows[0].layer_id, 'o retrato da copia serve a coluna');
    const nomeServido = (await db.query('SELECT name FROM layers WHERE id = $1', [rows[0].layer_id])).rows[0].name;
    assert.equal(nomeServido, 'A', 'e a camada servida e a copia da mesma camada que a origem serve');
  });

  // AS COPIAS FEITAS ANTES DO CONSERTO continuam com a coluna certa e a propriedade velha no
  // banco. O retrato as repara na leitura, porque deriva a camada da coluna.
  it('COPIA ANTIGA (propriedade com id da origem): o retrato serve a camada da coluna', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `CPa ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'Copia antiga' });
    const camada = await createLayer(db, map.id, { name: 'Tropas' });
    const idDaOrigem = randomUUID();
    await db.query(
      `INSERT INTO features (map_id, feature_type, geometry, properties, layer_id)
       VALUES ($1, 'point', '{"type":"Point","coordinates":[0,0]}'::jsonb, $2::jsonb, $3)`,
      [map.id, JSON.stringify({ source: 'point', layerId: idDaOrigem }), camada.id],
    );
    const { camadas, pontos } = await doSnapshot(atlas.id, map.id);
    assert.deepEqual(camadas, [camada.id]);
    assert.equal(pontos[0].properties.layerId, camada.id);
  });

  it('BORDA: coluna nula mantem a propriedade como veio', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `CPn ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'Sem camada' });
    await db.query(
      `INSERT INTO features (map_id, feature_type, geometry, properties, layer_id)
       VALUES ($1, 'point', '{"type":"Point","coordinates":[0,0]}'::jsonb,
               '{"source":"point","layerId":"default"}'::jsonb, NULL)`,
      [map.id],
    );
    const { pontos } = await doSnapshot(atlas.id, map.id);
    assert.equal(pontos[0].properties.layerId, 'default');
  });
});

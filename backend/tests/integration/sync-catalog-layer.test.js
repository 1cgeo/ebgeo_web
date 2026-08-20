// Path: tests/integration/sync-catalog-layer.test.js
// Fase 1 Tarefa 4: catalogLayer as a per-layer entity (dedicated table), with
// backward-compatible support for the legacy whole-array form.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Sync — catalogLayer (per-layer)', () => {
  let app, db, owner, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'catlayer_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Catalog Layer Atlas' });
    map = await createMap(db, atlas.id);
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

  const op = (operationType, entityId, data) => ({
    id: randomUUID(),
    entityType: 'catalogLayer',
    operationType,
    entityId,
    mapId: map.id,
    data,
    timestamp: Date.now(),
    clientId: 'c1',
  });

  it('create/update/delete per-layer and exposes survivors in the snapshot', async () => {
    const layer1 = randomUUID();
    const layer2 = randomUUID();

    await push([op('create', layer1, { type: 'wms', name: 'Layer 1', visible: true })]);
    await push([op('create', layer2, { type: 'wms', name: 'Layer 2', visible: true })]);

    // Both rows exist in the dedicated table
    let rows = await db.query('SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL', [map.id]);
    assert.equal(rows.rows.length, 2);

    // Update layer1; delete layer2
    await push([op('update', layer1, { type: 'wms', name: 'Layer 1 (edited)', visible: false })]);
    await push([op('delete', layer2, {})]);

    rows = await db.query('SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL', [map.id]);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].id, layer1);
    assert.equal(rows.rows[0].data.name, 'Layer 1 (edited)');
    assert.equal(rows.rows[0].data.visible, false);

    // Snapshot exposes map.catalogLayers (per-id) with the survivor
    const snap = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const snapMap = snap.body.data.snapshot.maps.find((m) => m.id === map.id);
    assert.ok(Array.isArray(snapMap.catalogLayers));
    assert.equal(snapMap.catalogLayers.length, 1);
    assert.equal(snapMap.catalogLayers[0].id, layer1);
    assert.equal(snapMap.catalogLayers[0].name, 'Layer 1 (edited)');
  });

  it('still accepts the legacy whole-array form, materialised into the dedicated table', async () => {
    // `maps.catalog_layers` is gone, so the compatibility shim writes where the
    // reader is. It UPSERTS and never removes: the column write was a whole-array REPLACE, which
    // was harmless while nothing read the column and would be a wipe against the canonical table.
    // Its own map: the shim writes real rows now, so sharing the suite's map would leak into
    // the per-layer cases above.
    const m = await createMap(db, atlas.id, { name: 'Legacy array form' });
    const opDoMapa = (data) => ({ ...op('update', randomUUID(), data), mapId: m.id });

    const arr = [{ id: 'wms-a', visible: true }, { id: 'wms-b', visible: false }];
    await push([opDoMapa({ catalog_layers: arr })]);

    const { rows } = await db.query(
      'SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL ORDER BY id',
      [m.id]
    );
    assert.deepEqual(rows.map((r) => r.id), ['wms-a', 'wms-b']);
    assert.deepEqual(rows.map((r) => r.data), arr);

    // And it does not remove what the array omits (the destructive capability the column write
    // never had).
    await push([opDoMapa({ catalog_layers: [{ id: 'wms-a', visible: false }] })]);
    const depois = await db.query(
      'SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL ORDER BY id',
      [m.id]
    );
    assert.deepEqual(depois.rows.map((r) => r.id), ['wms-a', 'wms-b'], 'the omitted layer survives');
    assert.equal(depois.rows[0].data.visible, false, 'and the one named was updated');
  });

  // ---------------------------------------------------------------------------
  // The ids the REAL client sends. Every test above uses randomUUID(), which the
  // catalog never produces: CatalogService builds literal ids ('hillshade',
  // `analysis-${id}`, `data-${id}`, `3d-${id}`, `360-${id}` — catalog.service.js
  // :160,:192,:223,:244,:266) and that string travels straight through as the
  // operation entityId. With catalog_layers.id typed UUID the insert raised 22P02,
  // which aborted the whole push transaction (one tx per batch), so the client's
  // queue never drained: a poison pill that killed that client's sync permanently.
  // Testing with UUIDs is what let this pass green for so long.
  // ---------------------------------------------------------------------------
  describe('real catalog ids (non-UUID) round-trip', () => {
    const REAL_IDS = ['hillshade', 'analysis-declividade', 'data-rodovias-federais', '3d-tileset-x', '360-projeto-y'];

    it('accepts every real catalog id shape and exposes them in the snapshot', async () => {
      const m = await createMap(db, atlas.id, { name: 'Real Catalog Ids' });
      const realOp = (operationType, entityId, data) => ({
        id: randomUUID(),
        entityType: 'catalogLayer',
        operationType,
        entityId,
        mapId: m.id,
        data,
        timestamp: Date.now(),
        clientId: 'c-real',
      });

      for (const id of REAL_IDS) {
        await supertest(app)
          .post(`/api/v1/atlas/${atlas.id}/sync`)
          .set('Authorization', `Bearer ${token}`)
          .send({ operations: [realOp('create', id, { type: 'raster', name: id, visible: true })] })
          .expect(200);
      }

      const { rows } = await db.query(
        'SELECT id FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL ORDER BY id', [m.id]
      );
      assert.deepEqual(
        rows.map((r) => r.id).sort(),
        [...REAL_IDS].sort(),
        'every real catalog id persisted with its literal value'
      );

      const snap = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const snapMap = snap.body.data.snapshot.maps.find((mm) => mm.id === m.id);
      assert.deepEqual(
        snapMap.catalogLayers.map((l) => l.id).sort(),
        [...REAL_IDS].sort(),
        'the snapshot returns the same literal ids the client indexes by'
      );
    });

    // The client's layer id is a catalog-wide CONSTANT, not a per-map value: every
    // map that adds "Sombreamento do Relevo" uses the id 'hillshade'. With the old
    // PRIMARY KEY (id) the first map to add it won the row and every other map hit
    // ON CONFLICT (id) DO NOTHING, so the layer silently never appeared there while
    // the push was still acked as success. Invisible for as long as the suite used
    // randomUUID() as the layer id, since UUIDs are globally unique by construction.
    it('the SAME catalog id can exist in two different maps (uniqueness is per map)', async () => {
      const mapA = await createMap(db, atlas.id, { name: 'Shared Id A' });
      const mapB = await createMap(db, atlas.id, { name: 'Shared Id B' });

      const addHillshade = (mapId, name) => supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(), entityType: 'catalogLayer', operationType: 'create',
            entityId: 'hillshade', mapId,
            data: { type: 'raster', name, visible: true },
            timestamp: Date.now(), clientId: 'c-shared',
          }],
        })
        .expect(200);

      await addHillshade(mapA.id, 'Sombreamento em A');
      await addHillshade(mapB.id, 'Sombreamento em B');

      const { rows } = await db.query(
        `SELECT map_id, data->>'name' AS name FROM catalog_layers
          WHERE id = 'hillshade' AND map_id IN ($1, $2) AND deleted_at IS NULL
          ORDER BY data->>'name'`,
        [mapA.id, mapB.id]
      );
      assert.equal(rows.length, 2, "both maps keep their own 'hillshade' row");
      assert.deepEqual(
        rows.map((r) => r.name),
        ['Sombreamento em A', 'Sombreamento em B'],
        'each map keeps its own payload, neither silently swallowed by the other'
      );
    });

    it('a batch mixing a real catalog id with a feature applies BOTH (no poison pill)', async () => {
      const m = await createMap(db, atlas.id, { name: 'Poison Pill Guard' });
      const featureId = randomUUID();

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [
            {
              id: randomUUID(), entityType: 'catalogLayer', operationType: 'create',
              entityId: 'hillshade', mapId: m.id,
              data: { type: 'raster', name: 'Sombreamento do Relevo', visible: true },
              timestamp: Date.now(), clientId: 'c-mix',
            },
            {
              id: randomUUID(), entityType: 'feature', operationType: 'create',
              entityId: featureId, mapId: m.id,
              data: {
                feature_type: 'point',
                geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
                properties: { id: featureId, nome: 'ponto no mesmo lote' },
              },
              timestamp: Date.now(), clientId: 'c-mix',
            },
          ],
        })
        .expect(200);

      const { rows: cl } = await db.query('SELECT id FROM catalog_layers WHERE map_id = $1', [m.id]);
      assert.deepEqual(cl.map((r) => r.id), ['hillshade'], 'the catalog layer applied');

      const { rows: f } = await db.query('SELECT id FROM features WHERE id = $1', [featureId]);
      assert.equal(f.length, 1, 'the sibling feature in the same batch applied too');
    });
  });

  // ---------------------------------------------------------------------------
  // O SHAPE ENTREGUE É CONTRATO CONGELADO com o documento do IndexedDB: o cliente escreve
  // `map.catalogLayers` verbatim (`reshapeSnapshotMap` o passa dentro do `...rest`). Os casos
  // acima afirmam CHAVE A CHAVE ('name', 'visible', 'opacity'), o que pega uma chave que some e
  // NÃO pega uma chave que aparece, nem uma que só sobrevive por acidente. A F11 mudou de ONDE o
  // conteúdo vem, e a única defesa contra ela ter mudado o FORMATO junto é comparar o CONJUNTO.
  //
  // Reforço, não arquivo paralelo: este é o teste de contrato da entidade, e o par de asserções
  // abaixo é o que faltava nele.
  // ---------------------------------------------------------------------------
  describe('shape freeze — o conjunto de chaves entregue', () => {
    /** As chaves de um item, ordenadas: comparar conjunto pega o que some E o que aparece. */
    const chaves = (o) => Object.keys(o).sort();

    it('entrada que NÃO referencia recurso de catálogo atravessa verbatim, com id e sync ao redor', async () => {
      // O caso comum, e o mais fácil de quebrar por engano: uma poda por ALLOWLIST derrubaria
      // `sourceId` (chave que o cliente inventa e que o e2e exige de volta) sem nenhum sinal.
      const m = await createMap(db, atlas.id, { name: 'Shape freeze verbatim' });
      const layerId = randomUUID();
      const guardado = {
        type: 'wms',
        name: 'Hidrografia',
        visible: true,
        opacity: 0.8,
        sourceId: 'hidro-src',
        styleOverrides: { raster: { 'raster-opacity': 0.5 } },
        umaChaveQueOServidorNaoConhece: 42,
      };

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({ operations: [{
          id: randomUUID(), entityType: 'catalogLayer', operationType: 'create',
          entityId: layerId, mapId: m.id, data: guardado,
          timestamp: Date.now(), clientId: 'c-shape',
        }] })
        .expect(200);

      const snap = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const item = snap.body.data.snapshot.maps
        .find((mm) => mm.id === m.id).catalogLayers
        .find((l) => l.id === layerId);

      assert.deepEqual(
        chaves(item), chaves({ ...guardado, id: layerId, sync: null }),
        'o item entregue é o payload guardado mais `id` e `sync`, nem uma chave a mais nem a menos',
      );
      assert.equal(item.umaChaveQueOServidorNaoConhece, 42, 'e o valor da chave desconhecida também');
      assert.deepEqual(item.styleOverrides, guardado.styleOverrides);
      assert.equal(typeof item.sync.version, 'number', '`sync` continua sendo o envelope, não um número');
    });

    it('entrada que REFERENCIA um recurso recebe `name`/`config` no MESMO lugar de sempre', async () => {
      // O item que a F11 reidrata. O shape não pode ter se mexido: `name` continua no topo e
      // `config` continua sendo um objeto ao lado dele, com `config.id` dentro — que é a chave
      // que o cliente usa para endereçar a camada no gerente que a desenha.
      const recurso = `shape-freeze-${randomUUID().slice(0, 8)}`;
      const m = await createMap(db, atlas.id, { name: 'Shape freeze referencia' });
      await db.query(
        `INSERT INTO analysis_layers (id, name, config, sort_order, access_level)
         VALUES ($1, 'Camada do contrato', $2::jsonb, 0, 'public')`,
        [recurso, JSON.stringify({ source: { type: 'raster', url: '/t/{z}/{x}/{y}.png' } })],
      );
      try {
        // O que o cliente PÓS-F11 grava: referência e estado por atlas, sem definição nenhuma.
        const guardado = { type: 'analysis_layer', visible: true, opacity: 1, status: 'active' };
        await supertest(app)
          .post(`/api/v1/atlas/${atlas.id}/sync`)
          .set('Authorization', `Bearer ${token}`)
          .send({ operations: [{
            id: randomUUID(), entityType: 'catalogLayer', operationType: 'create',
            entityId: `analysis-${recurso}`, mapId: m.id, data: guardado,
            timestamp: Date.now(), clientId: 'c-shape',
          }] })
          .expect(200);

        const snap = await supertest(app)
          .get(`/api/v1/atlas/${atlas.id}/sync/0`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        const item = snap.body.data.snapshot.maps
          .find((mm) => mm.id === m.id).catalogLayers
          .find((l) => l.id === `analysis-${recurso}`);

        assert.deepEqual(
          chaves(item),
          chaves({ ...guardado, id: `analysis-${recurso}`, sync: null, name: '', config: {} }),
          'o item entregue é o estado guardado mais `id`, `sync` e a definição (`name` + `config`)',
        );
        assert.equal(item.name, 'Camada do contrato');
        assert.equal(item.config.id, recurso, '`config.id` é a referência, no lugar de sempre');
        assert.equal(item.config.source.url, '/t/{z}/{x}/{y}.png');
      } finally {
        await db.query('DELETE FROM analysis_layers WHERE id = $1', [recurso]);
      }
    });

    it('a entrada da forma LEGADA de array atravessa verbatim, `name` e `config` inclusive', async () => {
      // O mesmo dado que morava na coluna `maps.catalog_layers`, hoje apagada, e que agora é
      // materializado na tabela dedicada. Ele não tem `type`, logo não CLAMA recurso de catálogo
      // nenhum, e precisa sair exatamente como entrou.
      //
      // As chaves `name` e `config` estão no fixture DE PROPÓSITO, e são elas que dão poder de
      // discriminação a este caso: são exatamente as duas que a poda tira. Sem elas a entrada não
      // tem nada a perder, e o `deepEqual` passaria idêntico se alguém fizesse a poda alcançar
      // toda entrada — que é o erro mais fácil de cometer aqui (medido: com a poda incondicional,
      // este caso ficava vermelho, e com o predicado por CLAIM ele continua verde).
      const m = await createMap(db, atlas.id, { name: 'Shape freeze legado' });
      const arr = [{
        id: 'wms-a',
        nome: 'Camada A',
        visible: true,
        opacity: 0.3,
        name: 'Camada A',
        config: { id: 'wms-a', source: { type: 'raster', url: '/legado/{z}/{x}/{y}.png' } },
      }];
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({ operations: [{
          id: randomUUID(), entityType: 'catalogLayer', operationType: 'update',
          entityId: m.id, mapId: m.id, data: { catalog_layers: arr },
          timestamp: Date.now(), clientId: 'c-shape',
        }] })
        .expect(200);

      const snap = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const item = snap.body.data.snapshot.maps
        .find((mm) => mm.id === m.id).catalogLayers
        .find((l) => l.id === 'wms-a');

      assert.deepEqual(
        chaves(item), chaves({ ...arr[0], sync: null }),
        'o item entregue é a entrada legada mais `sync`, nem uma chave a mais nem a menos',
      );
      assert.equal(item.name, 'Camada A', '`name` sobrevive: a entrada não clama recurso');
      assert.deepEqual(item.config, arr[0].config, 'e `config` inteiro, URL inclusive');
    });
  });
});

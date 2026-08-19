// Path: tests/e2e/catalog-layer.e2e.test.js

/**
 * @fileoverview Real end-to-end coverage for `catalogLayer` sync against the live
 * backend. Exercises both shapes the backend accepts:
 *  - Per-layer entity: create/update/delete rows keyed by the layer id, surfaced
 *    in the snapshot as `maps[].catalogLayers`.
 *  - Legacy whole-array form: `data.catalog_layers = [...]` is materialised as one row per
 *    item in the same dedicated table. Migration 022 dropped the `maps.catalog_layers` column
 *    it used to write, so the two shapes now share a single home.
 *
 * Drives the backend only through the public ApiClient + createOperation + the
 * shared harness; every assertion is an observable round-trip via pullSync.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Pulls a fresh snapshot and returns the map object matching `mapId`.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @returns {Promise<Object>} The snapshot map entry.
 */
async function snapshotMap(api, atlasId, mapId) {
    const res = await api.pullSync(atlasId, 0);
    expect(res.isSnapshot).toBe(true);
    expect(res.snapshot).toBeTruthy();
    const map = res.snapshot.maps.find((m) => m.id === mapId);
    expect(map, `map ${mapId} present in snapshot`).toBeTruthy();
    return map;
}

describe.skipIf(E2E_SKIP)('e2e: catalogLayer sync', () => {
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Catalog Layer E2E' });
        const atlas = await createAtlas(api, { name: 'Catalog Layer Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Catálogo' });
    });

    it('creates a per-layer catalogLayer surfaced in maps[].catalogLayers', async () => {
        const layerId = generateUUID();
        const op = createOperation('catalogLayer', 'create', layerId, mapId, {
            name: 'Hidrografia',
            visible: true,
            opacity: 0.8,
            sourceId: 'hidro-src',
        });
        await api.pushOperations(atlasId, [op]);

        const map = await snapshotMap(api, atlasId, mapId);
        expect(Array.isArray(map.catalogLayers)).toBe(true);
        const layer = map.catalogLayers.find((l) => l.id === layerId);
        expect(layer, 'created catalog layer present').toBeTruthy();
        expect(layer.name).toBe('Hidrografia');
        expect(layer.visible).toBe(true);
        expect(layer.opacity).toBe(0.8);
        expect(layer.sourceId).toBe('hidro-src');
        expect(layer.sync).toBeTruthy();
    });

    it('updates a per-layer catalogLayer (data merged/replaced)', async () => {
        const layerId = generateUUID();
        await api.pushOperations(atlasId, [
            createOperation('catalogLayer', 'create', layerId, mapId, {
                name: 'Vegetação',
                visible: true,
                opacity: 1,
            }),
        ]);

        await api.pushOperations(atlasId, [
            createOperation('catalogLayer', 'update', layerId, mapId, {
                name: 'Vegetação Densa',
                visible: false,
                opacity: 0.5,
            }),
        ]);

        const map = await snapshotMap(api, atlasId, mapId);
        const layer = map.catalogLayers.find((l) => l.id === layerId);
        expect(layer, 'updated catalog layer present').toBeTruthy();
        expect(layer.name).toBe('Vegetação Densa');
        expect(layer.visible).toBe(false);
        expect(layer.opacity).toBe(0.5);
    });

    it('soft-deletes a per-layer catalogLayer (drops out of snapshot)', async () => {
        const layerId = generateUUID();
        await api.pushOperations(atlasId, [
            createOperation('catalogLayer', 'create', layerId, mapId, {
                name: 'Curvas de Nível',
                visible: true,
            }),
        ]);

        let map = await snapshotMap(api, atlasId, mapId);
        expect(map.catalogLayers.some((l) => l.id === layerId)).toBe(true);

        await api.pushOperations(atlasId, [
            createOperation('catalogLayer', 'delete', layerId, mapId, null),
        ]);

        map = await snapshotMap(api, atlasId, mapId);
        expect(map.catalogLayers.some((l) => l.id === layerId)).toBe(false);
    });

    it('materialises the legacy whole-array form into the per-layer list', async () => {
        // Legacy form: entityId is the map (the array is map-scoped), payload carries
        // `catalog_layers: [...]`. It used to write the `maps.catalog_layers` column, which
        // migration 022 dropped; it now becomes one row per item in the dedicated table, which
        // is the only surface the client reads.
        const arrayPayload = [
            { id: 'legacy-a', name: 'Camada A', visible: true },
            { id: 'legacy-b', name: 'Camada B', visible: false },
        ];
        const op = createOperation('catalogLayer', 'update', mapId, mapId, {
            catalog_layers: arrayPayload,
        });
        await api.pushOperations(atlasId, [op]);

        const map = await snapshotMap(api, atlasId, mapId);
        expect(map.catalog_layers).toBeUndefined();
        const porId = Object.fromEntries(map.catalogLayers.map((l) => [l.id, l]));
        expect(porId['legacy-a'].name).toBe('Camada A');
        expect(porId['legacy-a'].visible).toBe(true);
        expect(porId['legacy-b'].visible).toBe(false);
    });

    it('keeps the array entries verbatim: no `type`, so nothing is pruned', async () => {
        // The discriminating half of the case above. An array entry carries no `type`, so it
        // CLAIMS no catalog resource, and both the rehydration and the log prune must leave it
        // exactly as it arrived — `name` included. A prune that reached every entry would still
        // pass the round-trip above and fail here.
        const map = await snapshotMap(api, atlasId, mapId);
        const entrada = map.catalogLayers.find((l) => l.id === 'legacy-a');
        expect(entrada.name).toBe('Camada A');
        expect(entrada.type).toBeUndefined();
        expect(entrada.sync).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // O SHAPE É CONTRATO CONGELADO ATRAVÉS DA FRONTEIRA DOS DOIS PACOTES: o item
    // entregue em `maps[].catalogLayers` é escrito no IndexedDB verbatim
    // (`reshapeSnapshotMap` o passa dentro do `...rest`). Os casos acima afirmam
    // chave a chave, o que pega uma chave que SOME e não pega uma que APARECE nem
    // uma que sobrevive por acidente. A F11 mudou de ONDE `name`/`config` vêm, e a
    // única defesa contra ela ter mexido no FORMATO junto é comparar o CONJUNTO,
    // daqui, com o cliente real dirigindo o backend real.
    // -----------------------------------------------------------------------
    it('freezes the delivered key set (nothing added, nothing dropped)', async () => {
        const layerId = generateUUID();
        const payload = {
            type: 'wms',
            name: 'Limites',
            visible: true,
            opacity: 0.4,
            status: 'active',
            styleOverrides: { line: { 'line-width': 2 } },
            sourceId: 'limites-src'
        };
        await api.pushOperations(atlasId, [
            createOperation('catalogLayer', 'create', layerId, mapId, payload)
        ]);

        const map = await snapshotMap(api, atlasId, mapId);
        const layer = map.catalogLayers.find((l) => l.id === layerId);
        expect(Object.keys(layer).sort()).toEqual(
            Object.keys({ ...payload, id: layerId, sync: null }).sort()
        );
        expect(layer.styleOverrides).toEqual(payload.styleOverrides);
        expect(layer.sourceId).toBe('limites-src');
    });

    it('refuses a catalog-layer op whose reference the caller cannot see (F11 write gate)', async () => {
        // O gate de escrita da F11, medido de fora: um id com o prefixo `analysis-`
        // e o `type` correspondente RESOLVE uma referência de recurso, e um recurso
        // que este chamador não enxerga (aqui, um que não existe — "ausente" e
        // "proibido" são indistinguíveis por decisão da casa) faz a op ser recusada
        // POR OP, com o lote sobrevivendo. É o par cruzado do caso acima: entrada
        // que não referencia recurso passa, entrada que referencia é julgada.
        const inexistente = `analysis-${generateUUID()}`;
        const inocente = generateUUID();
        const opGateada = createOperation('catalogLayer', 'create', inexistente, mapId, {
            type: 'analysis_layer',
            visible: true
        });
        const opVizinha = createOperation('catalogLayer', 'create', inocente, mapId, {
            type: 'wms',
            name: 'Sem referência nenhuma',
            visible: true
        });

        const res = await api.pushOperations(atlasId, [opGateada, opVizinha]);

        // O ack de uma op RECUSADA não carrega `entityId` (nada foi gravado): a chave de
        // junção dos dois lados é o `opId`, como no resto do sync.
        const recusada = res.acks.find((a) => a.opId === opGateada.id);
        expect(recusada, 'a op referenciando o recurso invisível foi acked').toBeTruthy();
        expect(recusada.rejected).toBe(true);
        // O motivo é texto de UI, em pt-BR: o cliente o mostra ao usuário.
        expect(recusada.reason).toMatch(/não tem acesso/);

        const passou = res.acks.find((a) => a.opId === opVizinha.id);
        expect(passou.rejected, 'a irmã do mesmo lote não pode ser arrastada').toBeUndefined();

        const map = await snapshotMap(api, atlasId, mapId);
        expect(map.catalogLayers.some((l) => l.id === inexistente)).toBe(false);
        expect(map.catalogLayers.some((l) => l.id === inocente)).toBe(true);
    });

    // -----------------------------------------------------------------------
    // O SEGUNDO RAMO DA MESMA ROTA. Tudo acima mede `pullSync(atlas, 0)`, o ramo de
    // SNAPSHOT, onde a definição é reidratada do catálogo. `GET /atlas/:id/sync/:v` com
    // v > 0 cai no ramo INCREMENTAL, que devolve o LOG de operações, e o log guarda a
    // carga do cliente verbatim: toda camada acrescentada antes da F11 está lá com
    // `config.source.url` dentro. O cliente chega neste ramo sozinho (`ws-client.js`
    // dispara `requestSync(lastVersion)`), então ele não é caminho de ataque, é o
    // caminho comum. A poda da F12 mora na leitura; é daqui que ela se mede.
    // -----------------------------------------------------------------------
    it('the INCREMENTAL branch prunes the definition and keeps the reference (F12)', async () => {
        // A camada que RECLAMA um recurso de catálogo (id com prefixo + `type`), escrita
        // como um cliente pré-F11 a escrevia: definição carimbada dentro da op.
        const comReferencia = createOperation('catalogLayer', 'create', 'data-rodovias-federais', mapId, {
            id: 'data-rodovias-federais',
            type: 'data_layer',
            name: 'Rodovias Federais',
            config: { source: { type: 'vector', url: 'http://interno.invalido/tiles/rodovias' } },
            visible: true,
            styleOverrides: { line: { 'line-width': 3 } },
        });
        // A VIZINHA que não reclama recurso nenhum: mesma batelada, mesmo ramo, e precisa
        // atravessar INTEIRA. Sem ela, uma poda que apagasse `config` de toda op de camada
        // passaria neste arquivo do mesmo jeito.
        const semReferencia = createOperation('catalogLayer', 'create', generateUUID(), mapId, {
            type: 'wms',
            name: 'Serviço externo do usuário',
            config: { source: { type: 'raster', url: 'http://externo.invalido/wms' } },
            visible: true,
        });

        const pushed = await api.pushOperations(atlasId, [comReferencia, semReferencia]);
        expect(pushed.acks.every((a) => a.rejected === undefined)).toBe(true);

        const res = await api.pullSync(atlasId, pushed.serverVersion - 2);
        expect(res.isSnapshot).toBe(false);
        expect(res.operations).toHaveLength(2);

        // NEGATIVO: a definição não sai pelo log.
        const podada = res.operations.find((o) => o.id === comReferencia.id);
        expect(podada, 'a op com referência voltou pelo ramo incremental').toBeTruthy();
        expect(podada.data.config, 'a definição não pode sair pelo log').toBeUndefined();
        expect(podada.data.name, 'o nome também é definição').toBeUndefined();
        // ... e o que o cliente PRECISA continua vindo: referência e estado por atlas.
        expect(podada.data.id).toBe('data-rodovias-federais');
        expect(podada.data.type).toBe('data_layer');
        expect(podada.data.visible).toBe(true);
        expect(podada.data.styleOverrides).toEqual({ line: { 'line-width': 3 } });

        // POSITIVO/DISCRIMINAÇÃO: a vizinha atravessa inteira, definição inclusa.
        const intacta = res.operations.find((o) => o.id === semReferencia.id);
        expect(intacta, 'a op sem referência voltou pelo ramo incremental').toBeTruthy();
        expect(intacta.data.name).toBe('Serviço externo do usuário');
        expect(intacta.data.config).toEqual({
            source: { type: 'raster', url: 'http://externo.invalido/wms' },
        });
    });

    it('ignores a cross-map per-layer create (atlas/map scoping guard)', async () => {
        // Per-layer rows are pinned to a map of THIS atlas via mapId. A bogus mapId
        // must be a no-op: the row is never created, so nothing surfaces anywhere.
        const layerId = generateUUID();
        const bogusMapId = generateUUID();
        await api.pushOperations(atlasId, [
            createOperation('catalogLayer', 'create', layerId, bogusMapId, {
                name: 'Fantasma',
                visible: true,
            }),
        ]);

        const map = await snapshotMap(api, atlasId, mapId);
        expect(map.catalogLayers.some((l) => l.id === layerId)).toBe(false);
    });
});

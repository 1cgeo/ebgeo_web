// Path: tests/e2e/catalog-layer.e2e.test.js

/**
 * @fileoverview Real end-to-end coverage for `catalogLayer` sync against the live
 * backend. Exercises both shapes the backend accepts:
 *  - Per-layer entity: create/update/delete rows keyed by the layer id, surfaced
 *    in the snapshot as `maps[].catalogLayers`.
 *  - Legacy whole-array form: `data.catalog_layers = [...]` writes the
 *    `maps.catalog_layers` column, surfaced in the snapshot as `maps[].catalog_layers`.
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

    it('writes the legacy whole-array form into maps.catalog_layers', async () => {
        // Legacy form: entityId is the map (array is map-scoped), payload carries
        // `catalog_layers: [...]` which the backend writes to the column verbatim.
        const arrayPayload = [
            { id: 'legacy-a', name: 'Camada A', visible: true },
            { id: 'legacy-b', name: 'Camada B', visible: false },
        ];
        const op = createOperation('catalogLayer', 'update', mapId, mapId, {
            catalog_layers: arrayPayload,
        });
        await api.pushOperations(atlasId, [op]);

        const map = await snapshotMap(api, atlasId, mapId);
        expect(Array.isArray(map.catalog_layers)).toBe(true);
        expect(map.catalog_layers).toEqual(arrayPayload);
    });

    it('does not leak the array payload into the per-layer catalogLayers list', async () => {
        // Negative/edge assertion: the legacy column and the per-layer table are
        // independent surfaces — array entries must NOT appear as per-layer rows.
        const map = await snapshotMap(api, atlasId, mapId);
        const perLayerIds = map.catalogLayers.map((l) => l.id);
        expect(perLayerIds).not.toContain('legacy-a');
        expect(perLayerIds).not.toContain('legacy-b');
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

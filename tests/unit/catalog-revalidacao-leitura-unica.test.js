/**
 * @fileoverview F-store-eventos-1 / F-vector-tiles-dados-5.
 *
 * The feature panel refresh used to read the WHOLE map document from IndexedDB
 * twice per refresh (revalidateCatalogLayers, then getCatalogLayers) just to
 * reach a list of 2 or 3 catalog layers. The read cost scales with the number
 * of DRAWN FEATURES, not with the catalog.
 *
 * Worst case the ruler must reject: a map document carrying thousands of
 * features. The count that matters is reads of the document, and the panel
 * path must pay exactly one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockMaps, readCounter } = vi.hoisted(() => ({
    mockMaps: { value: {} },
    readCounter: { value: 0 }
}));

vi.mock('../../src/js/config.js', () => ({
    default: {
        map2d: { hillshade: { enabled: true } },
        analysisLayers: { enabled: true, layers: [{ id: 'declividade' }] },
        dataLayers: { enabled: false, layers: [] },
        tilesets: []
    }
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async (mapName) => {
        readCounter.value += 1;
        return mockMaps.value[mapName];
    }),
    updateMapDataCompat: vi.fn(async (mapName, data) => {
        mockMaps.value[mapName] = data;
    })
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: {
        getCurrentMapName: () => 'MapaTeste',
        getCurrentMapId: () => 'uuid-mapa-teste'
    }
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logCatalogLayerOperation: vi.fn(),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

vi.mock('../../src/js/store/sync/sync-metadata.js', () => ({
    createSyncMetadata: vi.fn(() => ({ version: 1 })),
    touchSyncMetadata: vi.fn((sync) => ({ ...sync, version: (sync.version || 0) + 1 }))
}));

const { revalidateCatalogLayers, getCatalogLayers } =
    await import('../../src/js/store/catalog.operations.js');

/**
 * Builds a degenerate map document: a big drawing and a tiny catalog.
 * @param {number} featureCount - Features to put in the document
 * @returns {Object} Map document
 */
function makeHeavyMapDocument(featureCount) {
    const points = [];
    for (let i = 0; i < featureCount; i++) {
        points.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-53.1 + i * 1e-5, -29.7] },
            properties: { id: `p${i}`, source: 'point', color: '#ff0000' }
        });
    }
    return {
        name: 'MapaTeste',
        features: { points, lines: [], polygons: [] },
        catalogLayers: [
            {
                id: 'cl-1',
                type: 'hillshade',
                name: 'Sombreamento',
                visible: true,
                opacity: 1,
                status: 'active',
                config: { id: 'hillshade' },
                sync: { version: 1 }
            },
            {
                id: 'cl-2',
                type: 'analysis_layer',
                name: 'Declividade',
                visible: false,
                opacity: 1,
                status: 'active',
                originalId: 'declividade',
                config: { id: 'declividade' },
                sync: { version: 1 }
            }
        ]
    };
}

describe('revalidateCatalogLayers: uma leitura do documento por refresh', () => {
    beforeEach(() => {
        readCounter.value = 0;
        mockMaps.value = { MapaTeste: makeHeavyMapDocument(5000) };
    });

    it('devolve as camadas de catalogo junto com o resultado da revalidacao', async () => {
        const result = await revalidateCatalogLayers();

        expect(Array.isArray(result.layers)).toBe(true);
        expect(result.layers.map(l => l.id)).toEqual(['cl-1', 'cl-2']);
        expect(result.reactivated).toEqual([]);
        expect(result.stillUnavailable).toEqual([]);
    });

    it('paga UMA leitura do documento, nao duas (o caminho do painel)', async () => {
        const { layers } = await revalidateCatalogLayers();

        expect(layers).toHaveLength(2);
        expect(readCounter.value).toBe(1);
    });

    it('o caminho ANTIGO (revalidar e depois getCatalogLayers) pagava duas', async () => {
        await revalidateCatalogLayers();
        await getCatalogLayers();

        expect(readCounter.value).toBe(2);
    });

    it('as camadas devolvidas ja trazem o status revalidado', async () => {
        // 'declividade' sai do config: a camada tem de voltar como unavailable
        mockMaps.value.MapaTeste.catalogLayers[1].originalId = 'inexistente';
        mockMaps.value.MapaTeste.catalogLayers[1].config = { id: 'inexistente' };

        const { layers, stillUnavailable } = await revalidateCatalogLayers();

        expect(stillUnavailable).toEqual(['cl-2']);
        expect(layers[1].status).toBe('unavailable');
        // Persisting the status change is a write, never a second read
        expect(readCounter.value).toBe(1);
    });

    it('devolve lista vazia quando o mapa nao tem catalogo, sem estourar', async () => {
        delete mockMaps.value.MapaTeste.catalogLayers;

        const { layers } = await revalidateCatalogLayers();

        expect(layers).toEqual([]);
        expect(readCounter.value).toBe(1);
    });
});

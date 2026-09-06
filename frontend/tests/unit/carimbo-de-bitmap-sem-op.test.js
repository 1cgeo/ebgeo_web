// Path: tests/unit/carimbo-de-bitmap-sem-op.test.js

/**
 * @fileoverview CARIMBAR O BITMAP REGENERADO NÃO PODE VIRAR UMA EDIÇÃO.
 *
 * `stampGeneratedBitmap` (`store/feature.operations.js`) grava no documento LOCAL da feição
 * as propriedades que descrevem o PNG que acabou de ser assado (`width`, `height`,
 * `pixelRatio`, `anchor`, `iconOffset`, `bitmapVersion`). Ninguém editou nada: o blob é cache
 * por cliente, nunca sobe, e a regeneração acontece na carga do mapa, sem clique.
 *
 * POR ISSO A METADE QUE IMPORTA DESTE ARQUIVO É NEGATIVA. Se essa escrita passasse por
 * `updateFeature`, ela enfileiraria uma op UPDATE de saída, subiria `version` e `updatedAt`, e
 * o LWW entregaria a todo par uma escrita que pessoa nenhuma fez — e entregaria na abertura de
 * cada atlas remoto, uma vez por feição antiga. Os casos abaixo cobram, item a item, cada
 * omissão do caminho silencioso: nenhuma op, nenhum carimbo de autoria.
 *
 * `logFeatureOperation` é a ÚNICA porta da fila de saída (`store/sync/`), e é por isso que um
 * espião nela vale como asserção sobre a fila.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockMapData, mockMapManager, mockLockedMaps } = vi.hoisted(() => ({
    mockMapData: { value: null },
    mockMapManager: {
        getCurrentMapName: vi.fn(() => 'TestMap'),
        getCurrentMapId: vi.fn(() => 'map-uuid-123'),
        getMapId: vi.fn(() => 'map-uuid-123'),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn(),
    },
    mockLockedMaps: { value: new Set() },
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked',
    },
    emitStoreError: vi.fn(),
}));

vi.mock('../../src/js/store/store-origin.js', () => ({
    StoreOriginKind: { LOCAL: 'local', REMOTE: 'remote' },
    isRemoteStoreSync: vi.fn(() => false),
    getStoreOriginSync: vi.fn(() => ({ kind: 'local', atlasId: null })),
    loadStoreOrigin: vi.fn(async () => ({ kind: 'local', atlasId: null })),
    setStoreOrigin: vi.fn(async () => {}),
    markStoreRemote: vi.fn(async () => {}),
    markStoreLocal: vi.fn(async () => {}),
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false),
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async () => mockMapData.value),
    updateMapDataCompat: vi.fn(async (mapName, data) => { mockMapData.value = data; }),
    getLayersCompat: vi.fn(async () => []),
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: mockMapManager }));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        set lockedMaps(v) { mockLockedMaps.value = v; },
        currentMap: 'TestMap',
    },
}));

import { stampGeneratedBitmap } from '../../src/js/store/feature.operations.js';
import { updateMapDataCompat } from '../../src/js/store/repositories/index.js';
import { logFeatureOperation } from '../../src/js/store/sync/index.js';
import { SYMBOL_BITMAP_VERSION } from '../../src/js/layers/bitmap-version.js';

/** Metadados de sincronização como estavam ANTES do carimbo. */
const METADADOS = Object.freeze({
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    version: 7,
    ownerId: 'usuario-a',
    dirty: false,
});

function documentoComSimbolo(props = {}) {
    return {
        name: 'TestMap',
        features: {
            military_symbols: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-47, -15] },
                properties: {
                    id: 'sim-1',
                    source: 'military_symbol',
                    width: 100,
                    height: 100,
                    ...METADADOS,
                    ...props,
                },
            }],
            coordination_measures: [],
            points: [],
        },
    };
}

const feicaoEmMaos = (extras = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-47, -15] },
    properties: { id: 'sim-1', source: 'military_symbol', ...extras },
});

const guardado = () => mockMapData.value.features.military_symbols[0].properties;

beforeEach(() => {
    vi.clearAllMocks();
    mockMapData.value = documentoComSimbolo();
});

describe('stampGeneratedBitmap', () => {
    it('grava as propriedades derivadas e o carimbo no documento guardado', async () => {
        const ok = await stampGeneratedBitmap(feicaoEmMaos(), {
            width: 42, height: 30, pixelRatio: 2, anchor: 'bottom', iconOffset: [0, -12],
        });

        expect(ok).toBe(true);
        expect(guardado()).toMatchObject({
            width: 42,
            height: 30,
            pixelRatio: 2,
            anchor: 'bottom',
            iconOffset: [0, -12],
            bitmapVersion: SYMBOL_BITMAP_VERSION,
        });
        expect(updateMapDataCompat).toHaveBeenCalledTimes(1);
    });

    it('A FILA DE SAÍDA NÃO RECEBE NADA: nenhuma operação é registrada', async () => {
        await stampGeneratedBitmap(feicaoEmMaos(), { width: 42, height: 30 });

        expect(logFeatureOperation).not.toHaveBeenCalled();
    });

    it('os metadados de sincronização ficam INTACTOS, um a um', async () => {
        await stampGeneratedBitmap(feicaoEmMaos(), { width: 42, height: 30 });

        const props = guardado();
        expect(props.version).toBe(METADADOS.version);
        expect(props.updatedAt).toBe(METADADOS.updatedAt);
        expect(props.createdAt).toBe(METADADOS.createdAt);
        expect(props.ownerId).toBe(METADADOS.ownerId);
        expect(props.dirty).toBe(false);
    });

    it('deslocamento nulo não vira chave: `iconOffset` [0,0] fica AUSENTE', async () => {
        await stampGeneratedBitmap(feicaoEmMaos(), { width: 42, height: 30, iconOffset: [0, 0] });

        expect('iconOffset' in guardado()).toBe(false);
    });

    it('deslocamento que sumiu no bitmap novo é APAGADO do que estava guardado', async () => {
        mockMapData.value = documentoComSimbolo({ iconOffset: [3, -9] });

        await stampGeneratedBitmap(feicaoEmMaos(), { width: 42, height: 30 });

        expect('iconOffset' in guardado()).toBe(false);
    });

    it('feição que não está no mapa alvo é no-op, e não grava — é o caso normal da op de par', async () => {
        const ok = await stampGeneratedBitmap(
            { properties: { id: 'de-outro-mapa', source: 'military_symbol' } },
            { width: 42, height: 30 },
        );

        expect(ok).toBe(false);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('balde inexistente para o tipo é no-op, não exceção', async () => {
        mockMapData.value = { name: 'TestMap', features: { points: [] } };

        const ok = await stampGeneratedBitmap(feicaoEmMaos(), { width: 42, height: 30 });

        expect(ok).toBe(false);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('sem id, sem source ou sem resultado não escreve nada', async () => {
        expect(await stampGeneratedBitmap(null, { width: 1, height: 1 })).toBe(false);
        expect(await stampGeneratedBitmap({ properties: { source: 'military_symbol' } }, { width: 1, height: 1 })).toBe(false);
        expect(await stampGeneratedBitmap({ properties: { id: 'sim-1' } }, { width: 1, height: 1 })).toBe(false);
        expect(await stampGeneratedBitmap(feicaoEmMaos(), null)).toBe(false);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('carimba a medida de coordenação no balde dela, sem tocar no do símbolo', async () => {
        mockMapData.value.features.coordination_measures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { id: 'med-1', source: 'coordination_measure', ...METADADOS },
        });

        const ok = await stampGeneratedBitmap(
            { properties: { id: 'med-1', source: 'coordination_measure' } },
            { width: 20, height: 14, iconOffset: [0, -7] },
        );

        expect(ok).toBe(true);
        expect(mockMapData.value.features.coordination_measures[0].properties).toMatchObject({
            width: 20, height: 14, iconOffset: [0, -7], bitmapVersion: SYMBOL_BITMAP_VERSION,
        });
        expect(guardado().width).toBe(100);
        expect(logFeatureOperation).not.toHaveBeenCalled();
    });
});

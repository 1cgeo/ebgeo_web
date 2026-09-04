/**
 * @fileoverview F-store-eventos-4.
 *
 * `updateColorUsage` used to schedule one setTimeout and one IndexedDB write per
 * COLOR per FEATURE while the map is the current one (the branch for OTHER maps
 * was already coalesced). Importing or pasting a batch fired hundreds of timers
 * that all wrote the same object.
 *
 * Worst case the ruler must reject: 20 features carrying 3 colors each, all
 * registered on the same tick, against the CURRENT map. Before the fix the
 * counter reads 60; it must read 1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { setColorUsageMock, getColorUsageMock, colorStore } = vi.hoisted(() => {
    const store = { value: {} };
    return {
        colorStore: store,
        setColorUsageMock: vi.fn(async (mapName, data) => { store.value[mapName] = data; }),
        getColorUsageMock: vi.fn(async (mapName) => store.value[mapName] || {})
    };
});

vi.mock('../../src/js/store/repositories/index.js', () => ({
    setSettingCompat: vi.fn(async () => {}),
    getSettingCompat: vi.fn(async () => null),
    getColorUsageCompat: getColorUsageMock,
    setColorUsageCompat: setColorUsageMock,
    removeColorUsageCompat: vi.fn(async () => {}),
    getAllMapKeysCompat: vi.fn(async () => ['MapaA', 'MapaB']),
    getMapDataCompat: vi.fn(async () => ({ features: {} })),
    deleteImageCompat: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/services.js', () => ({
    getGroupManager: () => ({ loadGroupsToMemory: vi.fn(async () => {}) })
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: { resolveToId: (name) => name, isInitialized: true }
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logOperation: vi.fn(),
    EntityType: { SETTING: 'SETTING' },
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
    sessionContext: { getUserId: () => 'user-1' }
}));

const mapManager = (await import('../../src/js/store/store-state-manager.js')).default;

const CORES = ['#ff0000', '#00ff00', '#0000ff'];

describe('updateColorUsage: uma gravacao por rajada, nao uma por cor por feicao', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setColorUsageMock.mockClear();
        getColorUsageMock.mockClear();
        colorStore.value = {};
        mapManager._currentColorTimer = null;
        mapManager.memoryStore.currentMap = 'MapaA';
        mapManager.memoryStore.colorUsageCache = new Map();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('60 chamadas no mesmo tick para o mapa corrente gravam UMA vez', async () => {
        for (let i = 0; i < 20; i++) {
            for (const cor of CORES) {
                mapManager.updateColorUsage(null, cor, 'MapaA');
            }
        }

        expect(setColorUsageMock).toHaveBeenCalledTimes(0);

        await vi.advanceTimersByTimeAsync(200);

        expect(setColorUsageMock).toHaveBeenCalledTimes(1);
    });

    it('a unica gravacao carrega a contagem FINAL das 60 chamadas', async () => {
        for (let i = 0; i < 20; i++) {
            for (const cor of CORES) {
                mapManager.updateColorUsage(null, cor, 'MapaA');
            }
        }

        await vi.advanceTimersByTimeAsync(200);

        const [mapName, gravado] = setColorUsageMock.mock.calls[0];
        expect(mapName).toBe('MapaA');
        expect(gravado).toEqual({ '#ff0000': 20, '#00ff00': 20, '#0000ff': 20 });
    });

    it('uma rajada por mapa: uma gravacao para o corrente e uma para o outro', async () => {
        for (let i = 0; i < 20; i++) {
            for (const cor of CORES) {
                mapManager.updateColorUsage(null, cor, 'MapaA');
                mapManager.updateColorUsage(null, cor, 'MapaB');
            }
        }

        await vi.advanceTimersByTimeAsync(200);

        expect(setColorUsageMock).toHaveBeenCalledTimes(2);
        const mapasGravados = setColorUsageMock.mock.calls.map(c => c[0]).sort();
        expect(mapasGravados).toEqual(['MapaA', 'MapaB']);
    });

    it('uma rajada seguinte, depois do flush, agenda uma nova gravacao', async () => {
        mapManager.updateColorUsage(null, '#ff0000', 'MapaA');
        await vi.advanceTimersByTimeAsync(200);
        expect(setColorUsageMock).toHaveBeenCalledTimes(1);

        mapManager.updateColorUsage(null, '#00ff00', 'MapaA');
        await vi.advanceTimersByTimeAsync(200);
        expect(setColorUsageMock).toHaveBeenCalledTimes(2);
    });

    it('o cache em memoria continua exato, cor a cor', () => {
        for (let i = 0; i < 20; i++) {
            for (const cor of CORES) {
                mapManager.updateColorUsage(null, cor, 'MapaA');
            }
        }
        // Remove one feature worth of colors
        for (const cor of CORES) {
            mapManager.updateColorUsage(cor, null, 'MapaA');
        }

        for (const cor of CORES) {
            expect(mapManager.memoryStore.colorUsageCache.get(cor)).toBe(19);
        }
    });
});

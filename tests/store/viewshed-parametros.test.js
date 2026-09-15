import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted shared state (available to vi.mock factories)
// ============================================================================

const { mockCesium3dData, mockMemoryStore, mockMapManager } = vi.hoisted(() => {
    return {
        mockCesium3dData: { value: null },
        mockMemoryStore: { cesium3d: null },
        mockMapManager: {
            getCurrentMapName: vi.fn(() => 'TestMap'),
            getCurrentMapId: vi.fn(() => 'map-uuid-123')
        }
    };
});

// ============================================================================
// Mock dependencies
// ============================================================================

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_PERSIST_ERROR: 'store:persistError' },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logMarker3dOperation: vi.fn().mockResolvedValue(undefined),
    logMeasurement3dOperation: vi.fn().mockResolvedValue(undefined),
    logViewshed3dOperation: vi.fn().mockResolvedValue(undefined),
    logCameraPosition3dOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getCesium3dCompat: vi.fn(async () => mockCesium3dData.value),
    setCesium3dCompat: vi.fn(async (mapName, data) => {
        mockCesium3dData.value = data;
    })
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: mockMapManager
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: mockMemoryStore
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    addViewshed,
    updateViewshed,
    getViewshedById
} from '../../src/js/store/cesium3d.operations.js';

// ============================================================================
// Helpers
// ============================================================================

const TILESET_ID = 'tileset-1';

const BASE_PARAMS = { horizontalAngle: 120, verticalAngle: 120, distance: 500 };

async function criarViewshed() {
    return addViewshed(TILESET_ID, {
        position: { longitude: -43.2, latitude: -22.9, height: 30 },
        targetPosition: { longitude: -43.19, latitude: -22.9, height: 30 },
        terrainBaseHeight: 30,
        direction: { heading: 90, pitch: 0 },
        parameters: { ...BASE_PARAMS },
        observerHeight: 1.5
    });
}

/** Lê o registro direto do que foi persistido, nunca do retorno da escrita. */
function lerDoDisco(id) {
    return (mockCesium3dData.value?.viewsheds || []).find(v => v.id === id) || null;
}

beforeEach(() => {
    mockCesium3dData.value = { viewsheds: [], markers: [], measurements: [] };
    mockMemoryStore.cesium3d = null;
});

// ============================================================================
// Tests
// ============================================================================

describe('updateViewshed: parâmetros da análise de visibilidade', () => {
    it('grava a distância nova e preserva os demais parâmetros', async () => {
        const viewshed = await criarViewshed();

        const retorno = await updateViewshed(viewshed.id, {
            parameters: { ...BASE_PARAMS, distance: 2000 }
        });

        expect(retorno.parameters.distance).toBe(2000);
        expect(lerDoDisco(viewshed.id).parameters.distance).toBe(2000);
        expect(lerDoDisco(viewshed.id).parameters.horizontalAngle).toBe(120);
        expect(lerDoDisco(viewshed.id).parameters.verticalAngle).toBe(120);
    });

    it('grava o campo horizontal novo e preserva os demais parâmetros', async () => {
        const viewshed = await criarViewshed();

        const retorno = await updateViewshed(viewshed.id, {
            parameters: { ...BASE_PARAMS, horizontalAngle: 300 }
        });

        expect(retorno.parameters.horizontalAngle).toBe(300);
        expect(lerDoDisco(viewshed.id).parameters.horizontalAngle).toBe(300);
        expect(lerDoDisco(viewshed.id).parameters.distance).toBe(500);
    });

    it('sobrevive à releitura pelo getViewshedById, que é o que o painel recarrega', async () => {
        const viewshed = await criarViewshed();

        await updateViewshed(viewshed.id, {
            parameters: { ...BASE_PARAMS, horizontalAngle: 45, distance: 1200 }
        });

        const relido = await getViewshedById(viewshed.id);
        expect(relido.parameters.horizontalAngle).toBe(45);
        expect(relido.parameters.distance).toBe(1200);
    });

    it('funde parâmetro parcial em vez de apagar o que não veio', async () => {
        const viewshed = await criarViewshed();

        await updateViewshed(viewshed.id, { parameters: { distance: 750 } });

        const gravado = lerDoDisco(viewshed.id);
        expect(gravado.parameters.distance).toBe(750);
        expect(gravado.parameters.horizontalAngle).toBe(120);
        expect(gravado.parameters.verticalAngle).toBe(120);
    });

    it('a altura do observador continua gravando (controle que já passava antes)', async () => {
        const viewshed = await criarViewshed();

        await updateViewshed(viewshed.id, { observerHeight: 12 });

        expect(lerDoDisco(viewshed.id).observerHeight).toBe(12);
    });

    it('não mexe nos parâmetros quando a atualização não os cita', async () => {
        const viewshed = await criarViewshed();

        await updateViewshed(viewshed.id, { properties: { nome: 'Cota 300' } });

        const gravado = lerDoDisco(viewshed.id);
        expect(gravado.properties.nome).toBe('Cota 300');
        expect(gravado.parameters).toEqual(BASE_PARAMS);
    });
});

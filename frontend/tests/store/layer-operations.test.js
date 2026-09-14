import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDefaultLayer } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Hoisted shared state
// ============================================================================

const { mockMapManager, mockLockedMaps, mockLayerManager, mockEventBus } = vi.hoisted(() => {
    const layers = { value: [] };
    const activeLayerId = { value: 'default' };

    return {
        mockMapManager: {
            getCurrentMapName: vi.fn(() => 'TestMap'),
            getCurrentMapId: vi.fn(() => 'map-uuid-123')
        },
        mockLockedMaps: { value: new Set() },
        mockLayerManager: {
            getLayers: vi.fn(() => {
                return [...layers.value].sort((a, b) => a.order - b.order);
            }),
            getLayerById: vi.fn((layerId) => {
                return layers.value.find(l => l.id === layerId) || null;
            }),
            getActiveLayerIdSync: vi.fn(() => activeLayerId.value),
            getVisibleLayerIds: vi.fn(() => {
                return layers.value.filter(l => l.visible).map(l => l.id);
            }),
            createLayer: vi.fn((name) => {
                const layer = { id: `layer-${Date.now()}`, name, visible: true, locked: false };
                layers.value.push(layer);
                return layer;
            }),
            createLayerForImport: vi.fn((name) => {
                const layer = { id: `import-${Date.now()}`, name, visible: true, locked: false };
                layers.value.push(layer);
                return layer;
            }),
            setActiveLayer: vi.fn((layerId) => {
                const layer = layers.value.find(l => l.id === layerId);
                if (layer) activeLayerId.value = layerId;
                return layer;
            }),
            renameLayer: vi.fn((layerId, newName) => {
                const layer = layers.value.find(l => l.id === layerId);
                if (layer) layer.name = newName;
                return layer;
            }),
            setLayerVisibility: vi.fn((layerId, visible) => {
                const layer = layers.value.find(l => l.id === layerId);
                if (layer) layer.visible = visible;
                return layer;
            }),
            setLayerLocked: vi.fn((layerId, locked) => {
                const layer = layers.value.find(l => l.id === layerId);
                if (layer) layer.locked = locked;
                return layer;
            }),
            reorderLayers: vi.fn(),
            deleteLayer: vi.fn((layerId) => {
                const idx = layers.value.findIndex(l => l.id === layerId);
                if (idx === -1) return { success: false, reason: 'NOT_FOUND' };
                layers.value.splice(idx, 1);
                return { success: true };
            }),
            loadLayersToMemory: vi.fn(async () => {}),
            clearLayersCache: vi.fn(),
            _layers: layers,
            _activeLayerId: activeLayerId
        },
        mockEventBus: {
            emit: vi.fn(),
            on: vi.fn(),
            off: vi.fn()
        }
    };
});

// ============================================================================
// Mock dependencies
// ============================================================================

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operationBlocked' },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false)
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_LAYER: 'EDIT',
        UPDATE_LAYER: 'EDIT',
        DELETE_LAYER: 'DELETE'
    }
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    setLayersCompat: vi.fn(async () => {}),
    setActiveLayerIdCompat: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: mockMapManager
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        set lockedMaps(v) { mockLockedMaps.value = v; },
        currentMap: 'TestMap'
    }
}));

vi.mock('../../src/js/events', () => ({
    EventTypes: { LAYERS_CHANGED: 'layers:changed' }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    getLayers, getLayerById,
    getVisibleLayerIds, createLayer, createLayerForImport,
    renameLayer,
    setLayerVisibility, setLayerLocked, reorderLayers,
    deleteLayerOnly,
    setMapLayers, setLayerDependencies
} from '../../src/js/store/layer.operations.js';

import { isCurrentMapLockedSync } from '../../src/js/store/map.operations.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';
import { setLayersCompat, setActiveLayerIdCompat } from '../../src/js/store/repositories/index.js';

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    mockLockedMaps.value = new Set();
    mockLayerManager._layers.value = [];
    mockLayerManager._activeLayerId.value = 'default';
    isCurrentMapLockedSync.mockReturnValue(false);
    checkPermission.mockReturnValue({ allowed: true });

    setLayerDependencies({
        eventBus: mockEventBus,
        layerManager: mockLayerManager,
        groupManager: { clearMapGroups: vi.fn() }
    });
});

// ============================================================================
// READ - return value pass-through
// ============================================================================

describe('getLayers', () => {
    it('passes mapName argument through to layerManager', () => {
        getLayers('MapX');
        expect(mockLayerManager.getLayers).toHaveBeenCalledWith('MapX');
    });

    it('defaults mapName to null', () => {
        getLayers();
        expect(mockLayerManager.getLayers).toHaveBeenCalledWith(null);
    });

    it('returns the exact value from layerManager', () => {
        const sentinel = [{ id: 'sentinel' }];
        mockLayerManager.getLayers.mockReturnValueOnce(sentinel);

        const result = getLayers();

        expect(result).toBe(sentinel);
    });
});

describe('getLayerById', () => {
    it('returns exact layerManager result', () => {
        const sentinel = { id: 'x', name: 'X' };
        mockLayerManager.getLayerById.mockReturnValueOnce(sentinel);

        expect(getLayerById('x')).toBe(sentinel);
    });

    it('returns null when layerManager returns null', () => {
        mockLayerManager.getLayerById.mockReturnValueOnce(null);
        expect(getLayerById('missing')).toBeNull();
    });
});

describe('getVisibleLayerIds', () => {
    it('returns only visible layer IDs', () => {
        mockLayerManager._layers.value = [
            { id: 'v1', visible: true },
            { id: 'h1', visible: false },
            { id: 'v2', visible: true }
        ];

        const ids = getVisibleLayerIds();

        expect(ids).toEqual(['v1', 'v2']);
        expect(ids).not.toContain('h1');
    });
});

// ============================================================================
// CREATE - guard ordering and error details
// ============================================================================

describe('createLayer', () => {
    it('checks permission BEFORE checking lock', () => {
        // Both guards active
        checkPermission.mockReturnValue({ allowed: false, reason: 'VIEWER_ROLE' });
        isCurrentMapLockedSync.mockReturnValue(true);

        createLayer();

        // Permission should be checked first, lock never reached
        expect(checkPermission).toHaveBeenCalled();
        expect(isCurrentMapLockedSync).not.toHaveBeenCalled();
    });

    it('emits STORE_OPERATION_BLOCKED with operation name on permission denied', () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'VIEWER_ROLE' });

        createLayer();

        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'createLayer', reason: 'VIEWER_ROLE' })
        );
    });

    it('returns null on locked map and never delegates', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        const result = await createLayer('Test');

        expect(result).toBeNull();
        expect(mockLayerManager.createLayer).not.toHaveBeenCalled();
    });

    it('passes name and mapName to layerManager when allowed', () => {
        createLayer('Camada A', 'MapB');

        expect(mockLayerManager.createLayer).toHaveBeenCalledWith('Camada A', 'MapB');
    });

    it('uses default name "Nova Camada" when none provided', () => {
        createLayer();

        expect(mockLayerManager.createLayer).toHaveBeenCalledWith('Nova Camada', null);
    });
});

// ============================================================================
// OS TRES BLOCOS QUE CONGELAVAM O BURACO
// ============================================================================
//
// Ate 2026-09-13 estes tres afirmavam a AUSENCIA do guard, com estas palavras: "bypasses
// permission AND lock checks" e "does NOT check permission or lock (unrestricted)". Um teste
// que congela o defeito e pior que teste nenhum, porque faz o conserto ficar vermelho e
// parecer a regressao — foi essa a razao de o buraco sobreviver a mais de uma revisao.
//
// `_writeLayers` (`layers/layer.manager.js`) registra uma intencao `layer` para QUALQUER campo
// que mude, `visible` e `locked` inclusive. O olho e o cadeado da aba de feicoes sao desenhados
// para todo papel, entao um Leitor ou um Comentarista clicando neles enfileirava uma op que o
// servidor recusa com 403 no PUSH INTEIRO, e resposta nao-2xx nao e desenfileirada: aquela fila
// reenviava o mesmo lote a cada 1,5 s para sempre.

describe('createLayerForImport', () => {
    it('recusa quem o posto nao autoriza, e nao delega', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'VIEWER_ROLE', required: 'EDIT' });

        await expect(createLayerForImport('Import Layer')).resolves.toBeNull();

        expect(mockLayerManager.createLayerForImport).not.toHaveBeenCalled();
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'createLayerForImport', reason: 'VIEWER_ROLE' })
        );
    });

    it('recusa em mapa travado, e nao delega', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        await expect(createLayerForImport('Import Layer')).resolves.toBeNull();

        expect(mockLayerManager.createLayerForImport).not.toHaveBeenCalled();
    });

    it('delega quando o posto permite e o mapa esta destravado', async () => {
        const layer = await createLayerForImport('Import Layer');

        expect(layer).toBeDefined();
        expect(mockLayerManager.createLayerForImport).toHaveBeenCalledWith('Import Layer', null);
    });
});

// ============================================================================
// UPDATE - guard details
// ============================================================================

describe('renameLayer', () => {
    it('emits correct error details on permission denied', () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'VIEWER' });

        renameLayer('layer-1', 'New');

        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'renameLayer', reason: 'VIEWER' })
        );
        expect(mockLayerManager.renameLayer).not.toHaveBeenCalled();
    });

    it('returns null on locked map', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        await expect(renameLayer('layer-1', 'New')).resolves.toBeNull();
        expect(mockLayerManager.renameLayer).not.toHaveBeenCalled();
    });

    it('passes through layerManager return value', async () => {
        const sentinel = { id: 'layer-1', name: 'New' };
        mockLayerManager.renameLayer.mockReturnValueOnce(sentinel);

        // A fachada virou ASSINCRONA em 2026-09-13 (write-ahead): ela DEVOLVE a promessa do
        // gerente, e o valor que o chamador ve continua sendo o mesmo objeto.
        const result = await renameLayer('layer-1', 'New');

        expect(result).toBe(sentinel);
    });
});

describe('setLayerVisibility', () => {
    it('recusa quem o posto nao autoriza, e nao delega', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'VIEWER_ROLE', required: 'EDIT' });

        await expect(setLayerVisibility('layer-1', false)).resolves.toBeNull();

        expect(mockLayerManager.setLayerVisibility).not.toHaveBeenCalled();
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'setLayerVisibility', reason: 'VIEWER_ROLE' })
        );
    });

    it('recusa em mapa travado, e nao delega', async () => {
        // `layer` esta em `LOCKABLE_CHILD_TARGETS` no servidor, entao a op seria recusada
        // por operacao la: sem esta recusa aqui, quem clicou ve a camada sumir e o par nao.
        isCurrentMapLockedSync.mockReturnValue(true);

        await expect(setLayerVisibility('layer-1', false)).resolves.toBeNull();

        expect(mockLayerManager.setLayerVisibility).not.toHaveBeenCalled();
    });

    it('delega quando o posto permite e o mapa esta destravado', async () => {
        await setLayerVisibility('layer-1', false);

        expect(mockLayerManager.setLayerVisibility).toHaveBeenCalledWith('layer-1', false, null);
    });
});

describe('setLayerLocked', () => {
    it('recusa quem o posto nao autoriza, e nao delega', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'VIEWER_ROLE', required: 'EDIT' });

        await expect(setLayerLocked('layer-1', true)).resolves.toBeNull();

        expect(mockLayerManager.setLayerLocked).not.toHaveBeenCalled();
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'setLayerLocked', reason: 'VIEWER_ROLE' })
        );
    });

    it('recusa em mapa travado, e nao delega', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        await expect(setLayerLocked('layer-1', true)).resolves.toBeNull();

        expect(mockLayerManager.setLayerLocked).not.toHaveBeenCalled();
    });

    it('delega quando o posto permite e o mapa esta destravado', async () => {
        await setLayerLocked('layer-1', true);

        expect(mockLayerManager.setLayerLocked).toHaveBeenCalledWith('layer-1', true, null);
    });
});

// ============================================================================
// REORDER - guard details
// ============================================================================

describe('reorderLayers', () => {
    it('checks permission before lock', () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_EDIT' });
        isCurrentMapLockedSync.mockReturnValue(true);

        reorderLayers(['a', 'b']);

        expect(checkPermission).toHaveBeenCalled();
        expect(isCurrentMapLockedSync).not.toHaveBeenCalled();
    });

    it('emits correct error on permission denied', () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_EDIT' });

        reorderLayers(['a', 'b']);

        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'reorderLayers', reason: 'NO_EDIT' })
        );
    });

    it('returns early on locked map without delegating', () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        reorderLayers(['a', 'b']);

        expect(mockLayerManager.reorderLayers).not.toHaveBeenCalled();
    });

    it('passes ordered IDs and mapName when allowed', () => {
        reorderLayers(['c', 'a', 'b'], 'MapX');

        expect(mockLayerManager.reorderLayers).toHaveBeenCalledWith(
            ['c', 'a', 'b'], 'MapX'
        );
    });
});

// ============================================================================
// DELETE - guard error structure
// ============================================================================

describe('deleteLayerOnly', () => {
    it('returns exact structured error on permission denied', () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_DELETE' });

        const result = deleteLayerOnly('layer-1');

        expect(result).toEqual({ success: false, reason: 'PERMISSION_DENIED' });
        expect(mockLayerManager.deleteLayer).not.toHaveBeenCalled();
    });

    it('returns exact structured error on locked map', () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        const result = deleteLayerOnly('layer-1');

        expect(result).toEqual({ success: false, reason: 'MAP_LOCKED' });
    });

    it('passes through layerManager result on success', () => {
        mockLayerManager.deleteLayer.mockReturnValueOnce({ success: true });

        const result = deleteLayerOnly('layer-1');

        expect(result).toEqual({ success: true });
        expect(mockLayerManager.deleteLayer).toHaveBeenCalledWith('layer-1', null);
    });
});

// ============================================================================
// setMapLayers - REAL LOGIC (conditional branching + event emission)
// ============================================================================

describe('setMapLayers', () => {
    it('persists both layers and activeLayerId when both provided', async () => {
        const layers = [getDefaultLayer()];
        await setMapLayers('TestMap', { layers, activeLayerId: 'default' });

        expect(setLayersCompat).toHaveBeenCalledWith('TestMap', layers);
        expect(setActiveLayerIdCompat).toHaveBeenCalledWith('TestMap', 'default');
    });

    it('reloads memory AND emits event only for current map', async () => {
        await setMapLayers('TestMap', { layers: [getDefaultLayer()] });

        expect(mockLayerManager.loadLayersToMemory).toHaveBeenCalledWith('TestMap');
        expect(mockEventBus.emit).toHaveBeenCalledWith('layers:changed', { mapName: 'TestMap' });
    });

    it('does NOT reload or emit for non-current map', async () => {
        await setMapLayers('OtherMap', { layers: [getDefaultLayer()], activeLayerId: 'default' });

        // Repo calls still happen
        expect(setLayersCompat).toHaveBeenCalledWith('OtherMap', expect.any(Array));
        expect(setActiveLayerIdCompat).toHaveBeenCalledWith('OtherMap', 'default');

        // But no memory reload or event
        expect(mockLayerManager.loadLayersToMemory).not.toHaveBeenCalled();
        expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('skips setLayersCompat when layers not provided', async () => {
        await setMapLayers('TestMap', { activeLayerId: 'layer-1' });

        expect(setLayersCompat).not.toHaveBeenCalled();
        expect(setActiveLayerIdCompat).toHaveBeenCalledWith('TestMap', 'layer-1');
    });

    it('skips setActiveLayerIdCompat when activeLayerId not provided', async () => {
        await setMapLayers('TestMap', { layers: [getDefaultLayer()] });

        expect(setLayersCompat).toHaveBeenCalled();
        expect(setActiveLayerIdCompat).not.toHaveBeenCalled();
    });

    it('handles empty object without errors', async () => {
        await setMapLayers('TestMap', {});

        expect(setLayersCompat).not.toHaveBeenCalled();
        expect(setActiveLayerIdCompat).not.toHaveBeenCalled();
        // Still reloads because it's the current map
        expect(mockLayerManager.loadLayersToMemory).toHaveBeenCalledWith('TestMap');
    });
});

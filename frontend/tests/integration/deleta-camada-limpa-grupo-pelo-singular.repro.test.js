// Path: tests/integration/deleta-camada-limpa-grupo-pelo-singular.repro.test.js

/**
 * @fileoverview REPRO: `deleteLayerFeatures` entregava aos GRUPOS o tipo PLURAL.
 *
 * A CAUSA RAIZ. O vocabulario de tipo de feicao tem duas metades e elas nao sao
 * intercambiaveis: o tipo SINGULAR (`point`, `line`, `polygon`) e' o que a feicao carrega em
 * `properties.source`, e o tipo de ARMAZENAMENTO, plural (`points`, `lines`, `polygons`), e'
 * o nome do balde dentro do documento do mapa. `GroupManager.removeFeatureFromAllGroups`
 * indexa pelo SINGULAR, como todo outro chamador dela passa.
 *
 * `deleteLayerFeatures` varre os baldes, entao a variavel que tinha a mao era o PLURAL, e
 * era ele que ia para os grupos. O resultado nao lancava e nao aparecia: a busca por
 * `points` dentro de um grupo indexado por `point` simplesmente nao casava com nada, a
 * feicao era apagada do mapa e a REFERENCIA a ela continuava dentro do grupo. Grupo com
 * referencia orfa e' um contador que nunca fecha e uma selecao que traz feicao que nao
 * existe mais.
 *
 * O DEFEITO SO' FICOU CARO AGORA porque `transferLayerToMap` (mover camada para outro mapa)
 * chama esta funcao no passo que esvazia a origem: sem o conserto, toda camada movida
 * deixaria para tras o rastro dela em todos os grupos do mapa de origem.
 *
 * O CONTROLE NEGATIVO E' A ULTIMA ASSERCAO DE CADA CASO, e nao um comentario: alem de exigir
 * o singular, cada caso exige que o PLURAL NAO tenha sido passado. Sem essa metade, uma
 * implementacao que passasse os dois (ou que passasse o balde inteiro) tambem passaria.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Hoisted shared state
// ============================================================================

const { mockMaps, mockMapManager, mockLockedMaps } = vi.hoisted(() => ({
    mockMaps: { value: {} },
    mockMapManager: {
        getCurrentMapName: vi.fn(() => 'Mapa'),
        getCurrentMapId: vi.fn(() => 'mapa-uuid'),
        getMapId: vi.fn((name) => `${name}-uuid`),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn()
    },
    mockLockedMaps: { value: new Set() }
}));

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked'
    },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false),
    isMapLocked: vi.fn(async () => false)
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        resolveToId: vi.fn((n) => `${n}-uuid`),
        getIdForName: vi.fn((n) => n)
    }
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn().mockResolvedValue(undefined),
    logLayerOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_FEATURE: 'canEdit',
        UPDATE_FEATURE: 'canEdit',
        DELETE_FEATURE: 'canDelete'
    }
}));

vi.mock('../../src/js/store/settings.operations.js', () => ({
    getImage: vi.fn(async () => null),
    storeImage: vi.fn(async () => {}),
    removeImage: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async (mapName) => mockMaps.value[mapName] || null),
    updateMapDataCompat: vi.fn(async (mapName, data) => { mockMaps.value[mapName] = data; }),
    getLayersCompat: vi.fn(async () => []),
    setLayersCompat: vi.fn(async () => {}),
    setActiveLayerIdCompat: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: mockMapManager }));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        layers: {},
        activeLayerId: 'default',
        currentMap: 'Mapa'
    }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    deleteLayerFeatures,
    setFeatureDependencies
} from '../../src/js/store/feature.operations.js';
import { removeImage } from '../../src/js/store/settings.operations.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * @param {string} id - Id de sync.
 * @param {string|null} source - Tipo SINGULAR, ou `null` para uma feicao sem `source`.
 * @returns {object} A feicao.
 */
function feicao(id, source) {
    const props = { id, nome: `Feição ${id}`, layerId: 'alvo', createdAt: 1, updatedAt: 1, version: 1 };
    if (source) props.source = source;
    return {
        type: 'Feature',
        id: 777,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: props
    };
}

let groupManager;

beforeEach(() => {
    vi.clearAllMocks();
    mockMaps.value = { Mapa: getEmptyMapData() };
    mockLockedMaps.value = new Set();

    groupManager = { removeFeatureFromAllGroups: vi.fn() };
    setFeatureDependencies({
        eventBus: { emit: vi.fn() },
        groupManager,
        layerManager: {
            getLayers: vi.fn(() => []),
            isFeatureEffectivelyVisible: vi.fn(() => true),
            isFeatureEffectivelyLocked: vi.fn(() => false)
        }
    });
});

/** Os tipos que a limpeza de grupo recebeu, na ordem. @returns {string[]} */
const tiposPassados = () => groupManager.removeFeatureFromAllGroups.mock.calls.map((c) => c[0]);

// ============================================================================
// TESTES
// ============================================================================

describe('deleteLayerFeatures limpa os grupos pelo tipo SINGULAR', () => {

    it('passa o singular de cada balde, e NUNCA o plural', async () => {
        mockMaps.value.Mapa.features.points.push(feicao('p1', 'point'));
        mockMaps.value.Mapa.features.lines.push(feicao('l1', 'line'));
        mockMaps.value.Mapa.features.polygons.push(feicao('g1', 'polygon'));

        const mudou = await deleteLayerFeatures('alvo', 'Mapa');

        expect(mudou).toBe(true);
        expect(tiposPassados().sort()).toEqual(['line', 'point', 'polygon']);
        // CONTROLE NEGATIVO: o plural e' o defeito, e ele nao pode ter ido junto.
        for (const plural of ['points', 'lines', 'polygons']) {
            expect(tiposPassados()).not.toContain(plural);
        }
    });

    it('cada feicao e removida dos grupos pelo PROPRIO id', async () => {
        mockMaps.value.Mapa.features.points.push(feicao('p1', 'point'));
        mockMaps.value.Mapa.features.points.push(feicao('p2', 'point'));

        await deleteLayerFeatures('alvo', 'Mapa');

        const chamadas = groupManager.removeFeatureFromAllGroups.mock.calls;
        expect(chamadas).toHaveLength(2);
        expect(chamadas.map((c) => c[1]).sort()).toEqual(['p1', 'p2']);
        // O mapa alvo tambem viaja, senao a limpeza acerta o mapa errado.
        expect(chamadas.every((c) => c[2] === 'Mapa')).toBe(true);
    });

    it('feicao SEM `source` cai no singular derivado do balde, nao no plural', async () => {
        // O caminho de reserva. Um `.ebgeo` antigo pode trazer feicao sem `source`, e sem a
        // derivacao ela voltaria a receber o plural em silencio.
        mockMaps.value.Mapa.features.polygons.push(feicao('sem-fonte', null));

        await deleteLayerFeatures('alvo', 'Mapa');

        expect(tiposPassados()).toEqual(['polygon']);
        expect(tiposPassados()).not.toContain('polygons');
    });

    it('feicao de OUTRA camada nao e tocada', async () => {
        const outra = feicao('x1', 'point');
        outra.properties.layerId = 'outra';
        mockMaps.value.Mapa.features.points.push(outra);
        mockMaps.value.Mapa.features.points.push(feicao('p1', 'point'));

        await deleteLayerFeatures('alvo', 'Mapa');

        expect(groupManager.removeFeatureFromAllGroups).toHaveBeenCalledTimes(1);
        expect(groupManager.removeFeatureFromAllGroups.mock.calls[0][1]).toBe('p1');
        expect(mockMaps.value.Mapa.features.points.map((f) => f.properties.id)).toEqual(['x1']);
    });
});

describe('deleteLayerFeatures e os blobs de imagem', () => {

    it('por padrao LIBERA o blob da feicao de imagem', async () => {
        mockMaps.value.Mapa.features.images.push(feicao('img1', 'image'));

        await deleteLayerFeatures('alvo', 'Mapa');

        expect(removeImage).toHaveBeenCalledWith('img1');
    });

    it('com `releaseImages: false` NAO libera nada', async () => {
        // O caminho de `transferLayerToMap` no modo mover: as feicoes levam os MESMOS ids, e
        // o armazenamento de blob e' chaveado por id de feicao. Liberar aqui deixaria as
        // feicoes recem-movidas apontando para o nada.
        mockMaps.value.Mapa.features.images.push(feicao('img1', 'image'));

        await deleteLayerFeatures('alvo', 'Mapa', { releaseImages: false });

        expect(removeImage).not.toHaveBeenCalled();
        // E a limpeza de grupo continua acontecendo, pelo singular: as duas metades da
        // opcao sao independentes.
        expect(tiposPassados()).toEqual(['image']);
    });
});

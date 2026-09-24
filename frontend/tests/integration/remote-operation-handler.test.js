import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Remote Operation Handler Tests
 *
 * Validates that remote operations (received from other clients)
 * are correctly applied to the local store and emit events.
 * Verifies that remote ops do NOT generate queue entries or undo actions.
 */

// ============================================================================
// Mocks
// ============================================================================

const localStorageMock = (() => {
    const store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; }
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// In-memory map data store for testing
const mapDataStore = new Map();
// In-memory app-settings store (notes/grid/temporal/lock side-stores)
const settingStore = new Map();
// In-memory 3D / 360 per-map stores (keyed by map name)
const cesium3dStore = new Map();
const sv360Store = new Map();
// In-memory layer / group side-stores (keyed by map id)
const layerStore = new Map();
const groupStore = new Map();
// Cada chamada de `transferNameKeyedSideStores` que o tratador faz, na ordem. E' o modo de
// afirmar que ele DELEGA a transferencia ao repositorio em vez de reimplementar a lista de
// prefixos chaveados por nome, que e' o que faz as duas metades do rename divergirem.
const transferCalls = [];

vi.mock('localforage', () => {
    const mockStore = new Map();
    return {
        default: {
            createInstance: () => ({
                setItem: vi.fn(async (key, value) => { mockStore.set(key, value); }),
                getItem: vi.fn(async (key) => mockStore.get(key) || null),
                removeItem: vi.fn(async (key) => { mockStore.delete(key); }),
                keys: vi.fn(async () => [...mockStore.keys()]),
            })
        }
    };
});

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => `uuid-${Date.now()}`),
    isValidUUID: vi.fn(() => true),
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_SYNC_ERROR: 'store:syncError' },
    emitStoreError: vi.fn()
}));

// Mock repositories to use in-memory map data. The side-store setters mirror
// the real LocalRepository key derivation so the test can assert exact keys:
//   saveMapNotes(id, notes)  -> map_notes_<id>   (keyed by map id)
//   saveGridStyle(id, grid)  -> gridStyle_<id>   (keyed by map id)
//   saveSetting(key, value)  -> raw key (temporal_<name> / mapLocked_<name>)
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: vi.fn(() => ({
        getMap: vi.fn(async (mapId) => mapDataStore.get(mapId) || null),
        saveMap: vi.fn(async (mapId, data) => { mapDataStore.set(mapId, data); }),
        saveMapNotes: vi.fn(async (mapId, notes) => { settingStore.set(`map_notes_${mapId}`, notes); }),
        saveGridStyle: vi.fn(async (mapId, grid) => { settingStore.set(`gridStyle_${mapId}`, grid); }),
        saveSetting: vi.fn(async (key, value) => { settingStore.set(key, value); }),
        getCesium3d: vi.fn(async (mapName) => cesium3dStore.get(mapName) || { cameraPositions: {}, markers: [], measurements: [], viewsheds: [] }),
        saveCesium3d: vi.fn(async (mapName, data) => { cesium3dStore.set(mapName, data); }),
        getStreetview360: vi.fn(async (mapName) => sv360Store.get(mapName) || { orientations: {}, markers: [] }),
        saveStreetview360: vi.fn(async (mapName, data) => { sv360Store.set(mapName, data); }),
        getLayers: vi.fn(async (mapId) => layerStore.get(mapId) || []),
        saveLayers: vi.fn(async (mapId, layers) => { layerStore.set(mapId, layers); }),
        saveGroups: vi.fn(async (mapId, groups) => { groupStore.set(mapId, groups); }),
        getSetting: vi.fn(async (key) => (settingStore.has(key) ? settingStore.get(key) : null)),
        deleteSetting: vi.fn(async (key) => { settingStore.delete(key); }),
        getAllMaps: vi.fn(async () => new Map(mapDataStore)),
        deleteMap: vi.fn(async (mapId) => { mapDataStore.delete(mapId); }),
        // Espelha o contrato do metodo real (`LocalRepository.transferNameKeyedSideStores`, que
        // delega ao privado usado por `renameMap`): leva os DOIS prefixos chaveados por nome e so'
        // apaga a chave velha quando nenhum OUTRO registro atende por ela.
        transferNameKeyedSideStores: vi.fn(async (oldName, newName, ownKeys = []) => {
            transferCalls.push({ oldName, newName, ownKeys });
            if (!oldName || !newName || oldName === newName) return;
            const xara = [...mapDataStore.entries()]
                .some(([key, map]) => !ownKeys.includes(key) && map?.name === oldName);
            for (const prefixo of ['temporal_', 'mapLocked_']) {
                if (!settingStore.has(`${prefixo}${oldName}`)) continue;
                settingStore.set(`${prefixo}${newName}`, settingStore.get(`${prefixo}${oldName}`));
                if (!xara) settingStore.delete(`${prefixo}${oldName}`);
            }
        }),
    })),
}));

// Mock localRepository for briefing operations
const briefingStore = new Map();
vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: {
        saveBriefing: vi.fn(async (id, data) => { briefingStore.set(id, data); }),
        getBriefing: vi.fn(async (id) => briefingStore.get(id) || null),
        deleteBriefing: vi.fn(async (id) => { briefingStore.delete(id); }),
    }
}));

// ============================================================================
// Imports
// ============================================================================

import {
    applyRemoteOperation,
    applyRemoteSnapshot,
    setRemoteHandlerEventBus,
    markLocalEditPending,
    resolveLocalEdit,
    reconcilePendingLocalEdits,
} from '../../src/js/store/sync/remote-operation-handler.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { setTracing, clearTrace, getTrace } from '../../src/js/store/sync/diag/trace-core.js';
import { TraceStage } from '../../src/js/store/sync/diag/trace-stages.js';
import { EventTypes } from '../../src/js/events/event_types.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { readFileSync } from 'node:fs';

// ============================================================================
// Helpers
// ============================================================================

function createMockEventBus() {
    return {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn()
    };
}

function createTestMapData() {
    return {
        id: 'map-1',
        features: {
            points: [],
            lines: [],
            polygons: [],
            texts: [],
            images: [],
            circles: [],
            ellipses: [],
            rectangles: [],
            brushes: [],
            arrows: [],
            boundarys: [],
            occupied_fronts: [],
            military_symbols: [],
            coordination_measures: [],
            los: [],
            visibility: [],
            processed_los: [],
            processed_visibility: []
        }
    };
}

// ============================================================================
// Tests
// ============================================================================

let eventBus;

beforeEach(() => {
    mapDataStore.clear();
    briefingStore.clear();
    settingStore.clear();
    cesium3dStore.clear();
    sv360Store.clear();
    layerStore.clear();
    groupStore.clear();
    eventBus = createMockEventBus();
    setRemoteHandlerEventBus(eventBus);
});

describe('Remote Feature Operations', () => {
    const testFeature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.1, -22.9] },
        properties: { id: 'remote-f1', source: 'point', nome: 'Remote Point' }
    };

    beforeEach(() => {
        mapDataStore.set('map-1', createTestMapData());
    });

    it('applies CREATE operation', async () => {
        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: testFeature
        });

        const mapData = mapDataStore.get('map-1');
        expect(mapData.features.points).toHaveLength(1);
        expect(mapData.features.points[0].properties.id).toBe('remote-f1');
    });

    // Regression — bug F: a re-applied/echoed CREATE (e.g. the author's own op
    // returning on a catch-up pull) must be idempotent by id, not append a duplicate.
    it('CREATE is idempotent by id — a re-applied create does not duplicate the feature', async () => {
        const op = {
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: testFeature,
        };

        await applyRemoteOperation(op);
        await applyRemoteOperation(op); // echo / catch-up pull of the same create

        const mapData = mapDataStore.get('map-1');
        expect(mapData.features.points).toHaveLength(1);
        expect(mapData.features.points[0].properties.id).toBe('remote-f1');
    });

    it('a second CREATE with the same id replaces in place (last-write) without duplicating', async () => {
        await applyRemoteOperation({
            entityType: EntityType.FEATURE, operationType: OperationType.CREATE,
            entityId: 'remote-f1', mapId: 'map-1', data: testFeature,
        });
        await applyRemoteOperation({
            entityType: EntityType.FEATURE, operationType: OperationType.CREATE,
            entityId: 'remote-f1', mapId: 'map-1',
            data: { ...testFeature, properties: { ...testFeature.properties, nome: 'Renamed' } },
        });

        const mapData = mapDataStore.get('map-1');
        expect(mapData.features.points).toHaveLength(1);
        expect(mapData.features.points[0].properties.nome).toBe('Renamed');
    });

    it('emits FEATURE_CREATED event', async () => {
        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: testFeature
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.FEATURE_CREATED,
            expect.objectContaining({
                featureId: 'remote-f1',
                featureType: 'point',
                mapId: 'map-1'
            })
        );
    });

    it('applies UPDATE operation', async () => {
        // First create, then update
        const mapData = mapDataStore.get('map-1');
        mapData.features.points.push(testFeature);

        const updatedFeature = {
            ...testFeature,
            properties: { ...testFeature.properties, nome: 'Updated Point' }
        };

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.UPDATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: updatedFeature
        });

        const result = mapDataStore.get('map-1');
        expect(result.features.points[0].properties.nome).toBe('Updated Point');
    });

    it('emits FEATURE_MODIFIED event on update', async () => {
        const mapData = mapDataStore.get('map-1');
        mapData.features.points.push(testFeature);

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.UPDATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: { ...testFeature, properties: { ...testFeature.properties, nome: 'Updated' } }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.FEATURE_MODIFIED,
            expect.objectContaining({ featureId: 'remote-f1' })
        );
    });

    it('applies DELETE operation', async () => {
        const mapData = mapDataStore.get('map-1');
        mapData.features.points.push(testFeature);

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.DELETE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: testFeature
        });

        const result = mapDataStore.get('map-1');
        expect(result.features.points).toHaveLength(0);
    });

    it('emits FEATURE_DELETED event on delete', async () => {
        const mapData = mapDataStore.get('map-1');
        mapData.features.points.push(testFeature);

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.DELETE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: testFeature
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.FEATURE_DELETED,
            expect.objectContaining({
                featureId: 'remote-f1',
                featureType: 'point',
                mapId: 'map-1'
            })
        );
    });

    // Regression: a real DELETE op carries NO `data` (only previousData), so the
    // source/storage bucket can't be derived from it. The handler must search ALL
    // buckets by id — otherwise it defaulted to 'points' and silently dropped the
    // delete of every NON-point type (line/polygon/military symbol/…) cross-client.
    it('DELETE with null data removes a NON-point feature (line) by searching all buckets', async () => {
        const mapData = mapDataStore.get('map-1');
        const lineFeature = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[-43, -22], [-43.1, -22.1]] },
            properties: { id: 'remote-line-1', source: 'line' },
        };
        mapData.features.lines = mapData.features.lines || [];
        mapData.features.lines.push(lineFeature);

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.DELETE,
            entityId: 'remote-line-1',
            mapId: 'map-1',
            data: null, // the real DELETE op shape — no data
        });

        expect(mapDataStore.get('map-1').features.lines).toHaveLength(0);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.FEATURE_DELETED,
            expect.objectContaining({ featureId: 'remote-line-1', featureType: 'line', mapId: 'map-1' }),
        );
    });

    it('DELETE with null data still removes a point (default bucket)', async () => {
        const mapData = mapDataStore.get('map-1');
        mapData.features.points.push(testFeature);

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.DELETE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: null,
        });

        expect(mapDataStore.get('map-1').features.points).toHaveLength(0);
    });

    // Regression — new-map silent drop: a feature/create can arrive before its map/create op
    // (A creates a map and immediately draws on it). It must be BUFFERED, not dropped, and
    // replayed once the map lands. Previously `if (!mapData) return` lost the feature forever.
    it('buffers a feature op whose map is missing and replays it when the map arrives', async () => {
        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: 'pending-feat',
            mapId: 'later-map',
            data: { ...testFeature, properties: { ...testFeature.properties, id: 'pending-feat' } },
        });
        // Not applied yet — the map does not exist locally.
        expect(mapDataStore.get('later-map')).toBeUndefined();

        // The map's create op arrives → the buffered feature is replayed onto it.
        await applyRemoteOperation({
            entityType: EntityType.MAP,
            operationType: OperationType.CREATE,
            entityId: 'later-map',
            mapId: null,
            data: { id: 'later-map', name: 'Later Map', features: { points: [], lines: [] } },
        });

        const map = mapDataStore.get('later-map');
        expect(map).toBeDefined();
        expect(map.features.points.some((f) => f.properties.id === 'pending-feat')).toBe(true);
    });

    // O caso acima prova que o DADO sobrevive ao buffer. Este prova que a OBSERVABILIDADE
    // sobrevive junto, e os dois são independentes: até 2026-07-25 o dado chegava e as chaves
    // de junção não. `applyRemoteFeatureOp` era declarada com 5 parâmetros e chamada com 7, e o
    // buffer guardava só quatro campos, então o span `apply.persist` do replay saía com `opId`
    // indefinido. O elo full-chain se rompia exatamente no caminho bufferizado, que é o mais
    // difícil de diagnosticar justamente por ser o assíncrono.
    it('o span apply.persist do replay carrega opId e traceId (elo do SyncLedger)', async () => {
        setTracing(true);
        clearTrace();
        try {
            await applyRemoteOperation({
                id: 'op-buffered-1',
                traceId: 'trace-buffered-1',
                entityType: EntityType.FEATURE,
                operationType: OperationType.CREATE,
                entityId: 'feat-traced',
                mapId: 'map-traced',
                serverVersion: 7,
                data: { ...testFeature, properties: { ...testFeature.properties, id: 'feat-traced' } },
            });
            // Premissa: nada foi aplicado ainda, ou seja, o caso realmente passou pelo buffer.
            expect(mapDataStore.get('map-traced')).toBeUndefined();

            await applyRemoteOperation({
                entityType: EntityType.MAP,
                operationType: OperationType.CREATE,
                entityId: 'map-traced',
                mapId: null,
                data: { id: 'map-traced', name: 'Map Traced', features: { points: [], lines: [] } },
            });

            const spans = getTrace().filter(
                (s) => s.stage === TraceStage.APPLY_PERSIST && s.entityId === 'feat-traced'
            );
            expect(spans).toHaveLength(1);
            expect(spans[0].opId).toBe('op-buffered-1');
            expect(spans[0].traceId).toBe('trace-buffered-1');
        } finally {
            clearTrace();
            setTracing(false);
        }
    });

    // Regression — concurrent-edit divergence: an UPDATE OLDER (lower serverVersion) than the
    // last applied — a concurrent peer edit that lost the arrival-order race — must be IGNORED,
    // so both clients converge to the highest-serverVersion value (LWW by arrival order).
    it('ignores a feature UPDATE older than the last applied (LWW by serverVersion → convergence)', async () => {
        const line = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { id: 'conv-1', source: 'line', lineColor: '#000000' },
        };
        mapDataStore.get('map-1').features.lines.push(line);
        const colorOf = () => mapDataStore.get('map-1').features.lines.find((f) => f.properties.id === 'conv-1').properties.lineColor;

        // Newer arrival (serverVersion 20) wins.
        await applyRemoteOperation({
            entityType: EntityType.FEATURE, operationType: OperationType.UPDATE, entityId: 'conv-1', mapId: 'map-1', serverVersion: 20,
            data: { ...line, properties: { ...line.properties, lineColor: '#ff0000' } },
        });
        expect(colorOf()).toBe('#ff0000');

        // A LATER-DELIVERED but OLDER op (serverVersion 10) must be dropped — else the clients diverge.
        await applyRemoteOperation({
            entityType: EntityType.FEATURE, operationType: OperationType.UPDATE, entityId: 'conv-1', mapId: 'map-1', serverVersion: 10,
            data: { ...line, properties: { ...line.properties, lineColor: '#0000ff' } },
        });
        expect(colorOf()).toBe('#ff0000'); // unchanged — the stale op was ignored
    });

    it('handles delete of nonexistent feature gracefully', async () => {
        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.DELETE,
            entityId: 'nonexistent-feature',
            mapId: 'map-1',
            data: testFeature
        });

        // Should not throw, just no-op
        const result = mapDataStore.get('map-1');
        expect(result.features.points).toHaveLength(0);
    });
});

describe('Remote Briefing Operations', () => {
    it('applies CREATE briefing operation', async () => {
        const briefingData = {
            id: 'briefing-1',
            name: 'Remote Briefing',
            slides: [],
            settings: {}
        };

        await applyRemoteOperation({
            entityType: EntityType.BRIEFING,
            operationType: OperationType.CREATE,
            entityId: 'briefing-1',
            data: briefingData
        });

        expect(briefingStore.has('briefing-1')).toBe(true);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.BRIEFING_CREATED,
            expect.objectContaining({ briefingId: 'briefing-1' })
        );
    });

    it('applies DELETE briefing operation', async () => {
        briefingStore.set('briefing-1', { id: 'briefing-1', name: 'Test' });

        await applyRemoteOperation({
            entityType: EntityType.BRIEFING,
            operationType: OperationType.DELETE,
            entityId: 'briefing-1',
            data: null
        });

        expect(briefingStore.has('briefing-1')).toBe(false);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.BRIEFING_DELETED,
            expect.objectContaining({ briefingId: 'briefing-1' })
        );
    });

    // BRIEFING entrou em CONVERGENCE_GUARDED em 2026-07-25. Antes disso, o UPDATE de briefing
    // substituía o objeto INTEIRO (array de slides incluído) sem nenhuma checagem de ordem,
    // então dois usuários editando slides do mesmo briefing perdiam trabalho em silêncio: o
    // último frame a chegar levava o array todo, mesmo que fosse o mais VELHO por ordem de
    // chegada no servidor. O slide isolado é no-op inbound e converge pelo pai, então não
    // havia nenhuma outra camada para segurar isso.
    it('ignora um UPDATE de briefing com serverVersion MENOR (LWW por ordem de chegada)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.BRIEFING,
            operationType: OperationType.CREATE,
            entityId: 'briefing-lww',
            serverVersion: 20,
            data: { id: 'briefing-lww', name: 'v20', slides: [{ id: 's1', title: 'do par A' }] },
        });
        expect(briefingStore.get('briefing-lww').name).toBe('v20');

        // Entregue DEPOIS, porém mais velho: tem que ser descartado.
        await applyRemoteOperation({
            entityType: EntityType.BRIEFING,
            operationType: OperationType.UPDATE,
            entityId: 'briefing-lww',
            serverVersion: 10,
            data: { id: 'briefing-lww', name: 'v10-velho', slides: [] },
        });

        const guardado = briefingStore.get('briefing-lww');
        expect(guardado.name).toBe('v20');
        // O slide do par A sobreviveu, que é o dano concreto que o guarda evita.
        expect(guardado.slides).toHaveLength(1);
    });

    it('CONTROLE: um UPDATE de briefing MAIS NOVO continua aplicando', async () => {
        // Sem este caso, um guarda que recusasse TODO update passaria no anterior.
        await applyRemoteOperation({
            entityType: EntityType.BRIEFING,
            operationType: OperationType.CREATE,
            entityId: 'briefing-fwd',
            serverVersion: 5,
            data: { id: 'briefing-fwd', name: 'v5', slides: [] },
        });
        await applyRemoteOperation({
            entityType: EntityType.BRIEFING,
            operationType: OperationType.UPDATE,
            entityId: 'briefing-fwd',
            serverVersion: 9,
            data: { id: 'briefing-fwd', name: 'v9', slides: [{ id: 's2', title: 'novo' }] },
        });
        // Since 2026-09-23 the slide itself arrives by ITS op, right behind the envelope in the
        // same batch (see the describe below); the envelope alone carries name and order.
        await applyRemoteOperation({
            entityType: EntityType.SLIDE,
            operationType: OperationType.CREATE,
            entityId: 's2',
            mapId: 'briefing-fwd',
            serverVersion: 9,
            data: { id: 's2', title: 'novo', order: 0 },
        });

        expect(briefingStore.get('briefing-fwd').name).toBe('v9');
        expect(briefingStore.get('briefing-fwd').slides).toHaveLength(1);
    });
});

// SLIDES DIFERENTES EDITADOS AO MESMO TEMPO (2026-09-23). O envelope de briefing traz a lista de
// slides INTEIRA de quem o mandou, montada antes de ele saber da edicao do colega; aplicado em
// bloco no par, ele apagava do disco do par a edicao que o servidor guardava (cada slide e' uma
// linha la'). Medido com duas browsers em `frontend/tests/e2e-ui/briefing-slides-concorrentes.repro.spec.js`.
describe('Remote briefing envelope vs per-slide ops', () => {
    const envelope = (slides, extra = {}) => ({
        entityType: EntityType.BRIEFING, operationType: OperationType.UPDATE, entityId: 'b-par', ...extra,
        data: { id: 'b-par', name: 'Plano', slides },
    });

    beforeEach(async () => {
        briefingStore.set('b-par', { id: 'b-par', name: 'Plano', slides: [
            { id: 's1', order: 0, title: 'Um (do A)' },
            { id: 's2', order: 1, title: 'Dois' },
        ] });
    });

    it('o envelope do colega NAO devolve o texto velho de um slide que ele nao editou', async () => {
        await applyRemoteOperation(envelope([{ id: 's1', title: 'Um' }, { id: 's2', title: 'Dois' }], { serverVersion: 31 }));
        await applyRemoteOperation({ entityType: EntityType.SLIDE, operationType: OperationType.UPDATE, entityId: 's2',
            mapId: 'b-par', serverVersion: 31, data: { id: 's2', order: 1, title: 'Dois (do B)', briefing_id: 'b-par', _mapName: 'M' } });
        const slides = briefingStore.get('b-par').slides;
        expect(slides.map((s) => s.title)).toEqual(['Um (do A)', 'Dois (do B)']);
        // A forma do cliente: o que a normalizacao do servidor acrescenta nao entra no documento.
        expect(slides[1]).not.toHaveProperty('briefing_id');
        expect(slides[1]).not.toHaveProperty('_mapName');
    });

    it('a ORDEM vem do envelope, e um slide que o envelope nao conhece fica, no fim', async () => {
        briefingStore.get('b-par').slides.push({ id: 's3', order: 2, title: 'Tres (de outro)' });
        await applyRemoteOperation(envelope([{ id: 's2' }, { id: 's1' }], { serverVersion: 32 }));
        const slides = briefingStore.get('b-par').slides;
        expect(slides.map((s) => s.id)).toEqual(['s2', 's1', 's3']);
        expect(slides.map((s) => s.order)).toEqual([0, 1, 2]);
    });

    it('um slide que so o envelope traz NAO ressuscita: quem o cria e a op dele', async () => {
        await applyRemoteOperation(envelope([{ id: 's1' }, { id: 's2' }, { id: 'apagado', title: 'x' }], { serverVersion: 33 }));
        expect(briefingStore.get('b-par').slides.map((s) => s.id)).toEqual(['s1', 's2']);
    });

    it('a op de slide mais VELHA que a ja aplicada naquele slide e descartada (LWW por slide)', async () => {
        await applyRemoteOperation({ entityType: EntityType.SLIDE, operationType: OperationType.UPDATE, entityId: 's2',
            mapId: 'b-par', serverVersion: 40, data: { id: 's2', order: 1, title: 'v40' } });
        await applyRemoteOperation({ entityType: EntityType.SLIDE, operationType: OperationType.UPDATE, entityId: 's2',
            mapId: 'b-par', serverVersion: 39, data: { id: 's2', order: 1, title: 'v39' } });
        expect(briefingStore.get('b-par').slides.find((s) => s.id === 's2').title).toBe('v40');
    });

    it('DELETE de slide remove so aquele slide', async () => {
        await applyRemoteOperation({ entityType: EntityType.SLIDE, operationType: OperationType.DELETE, entityId: 's1',
            mapId: 'b-par', serverVersion: 41, data: null });
        expect(briefingStore.get('b-par').slides.map((s) => s.id)).toEqual(['s2']);
    });
});

describe('Remote operation generic event', () => {
    beforeEach(() => {
        mapDataStore.set('map-1', createTestMapData());
    });

    it('emits REMOTE_OPERATION_APPLIED for all operations', async () => {
        const operation = {
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { id: 'remote-f1', source: 'point' }
            }
        };

        await applyRemoteOperation(operation);

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.REMOTE_OPERATION_APPLIED,
            expect.objectContaining({ operation })
        );
    });
});

describe('Remote 3D / 360 collection operations', () => {
    it('emits MARKERS_3D_CHANGED for marker3d', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MARKER_3D,
            operationType: OperationType.CREATE,
            entityId: 'm3d-1',
            mapId: 'map-1',
            data: { id: 'm3d-1', tilesetId: 't1' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MARKERS_3D_CHANGED,
            expect.objectContaining({ mapName: 'map-1' })
        );
    });

    it('emits MEASUREMENTS_3D_CHANGED for measurement3d', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MEASUREMENT_3D,
            operationType: OperationType.UPDATE,
            entityId: 'meas-1',
            mapId: 'map-1',
            data: { id: 'meas-1' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MEASUREMENTS_3D_CHANGED,
            expect.objectContaining({ mapName: 'map-1' })
        );
    });

    it('emits VIEWSHEDS_3D_CHANGED for viewshed3d', async () => {
        await applyRemoteOperation({
            entityType: EntityType.VIEWSHED_3D,
            operationType: OperationType.DELETE,
            entityId: 'vs-1',
            mapId: 'map-1',
            data: null
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.VIEWSHEDS_3D_CHANGED,
            expect.objectContaining({ mapName: 'map-1' })
        );
    });

    it('emits CAMERA_3D_SAVED for cameraPosition3d create/update', async () => {
        await applyRemoteOperation({
            entityType: EntityType.CAMERA_POSITION_3D,
            operationType: OperationType.CREATE,
            entityId: 'cam-1',
            mapId: 'map-1',
            data: { id: 'cam-1', tilesetId: 'tile-9' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.CAMERA_3D_SAVED,
            expect.objectContaining({ tilesetId: 'tile-9', mapName: 'map-1' })
        );
    });

    it('does NOT emit CAMERA_3D_SAVED for cameraPosition3d delete', async () => {
        await applyRemoteOperation({
            entityType: EntityType.CAMERA_POSITION_3D,
            operationType: OperationType.DELETE,
            entityId: 'cam-1',
            mapId: 'map-1',
            data: null
        });

        const cameraSavedCalls = eventBus.emit.mock.calls.filter(
            ([type]) => type === EventTypes.CAMERA_3D_SAVED
        );
        expect(cameraSavedCalls).toHaveLength(0);
    });

    it('emits ORIENTATION_360_SAVED for orientation360 create/update', async () => {
        await applyRemoteOperation({
            entityType: EntityType.ORIENTATION_360,
            operationType: OperationType.UPDATE,
            entityId: 'or-1',
            mapId: 'map-1',
            data: { id: 'or-1', photoName: 'photo-a' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.ORIENTATION_360_SAVED,
            expect.objectContaining({ photoName: 'photo-a', mapName: 'map-1' })
        );
    });

    it('emits ORIENTATION_360_CLEARED for orientation360 delete', async () => {
        await applyRemoteOperation({
            entityType: EntityType.ORIENTATION_360,
            operationType: OperationType.DELETE,
            entityId: 'or-1',
            mapId: 'map-1',
            data: { id: 'or-1', photoName: 'photo-a' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.ORIENTATION_360_CLEARED,
            expect.objectContaining({ photoName: 'photo-a', mapName: 'map-1' })
        );
    });

    it('emits MARKERS_360_CHANGED for marker360', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MARKER_360,
            operationType: OperationType.CREATE,
            entityId: 'm360-1',
            mapId: 'map-1',
            data: { id: 'm360-1', photoName: 'photo-a' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MARKERS_360_CHANGED,
            expect.objectContaining({ mapName: 'map-1' })
        );
    });
});

// P9 GAP-6/7: a LIVE 3D/360 op must PERSIST into the per-map cesium3d/streetview360 store on
// the peer (previously emit-only → diverged until a snapshot). mapId resolves to the map name
// (resolver empty in the test → identity), so the stores are keyed by 'map-1'.
describe('Remote 3D / 360 operations — persistence (P9)', () => {
    it('persists a remote 3D marker into the cesium3d store (CREATE then DELETE)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MARKER_3D, operationType: OperationType.CREATE,
            entityId: 'm3d-1', mapId: 'map-1', data: { id: 'm3d-1', tilesetId: 't1', nome: 'M1' },
        });
        expect(cesium3dStore.get('map-1').markers.map((m) => m.id)).toEqual(['m3d-1']);

        await applyRemoteOperation({
            entityType: EntityType.MARKER_3D, operationType: OperationType.DELETE,
            entityId: 'm3d-1', mapId: 'map-1', data: null,
        });
        expect(cesium3dStore.get('map-1').markers).toHaveLength(0);
    });

    it('persists remote measurement + viewshed into their buckets', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MEASUREMENT_3D, operationType: OperationType.CREATE,
            entityId: 'meas-1', mapId: 'map-1', data: { id: 'meas-1' },
        });
        await applyRemoteOperation({
            entityType: EntityType.VIEWSHED_3D, operationType: OperationType.CREATE,
            entityId: 'vs-1', mapId: 'map-1', data: { id: 'vs-1' },
        });
        expect(cesium3dStore.get('map-1').measurements.map((m) => m.id)).toEqual(['meas-1']);
        expect(cesium3dStore.get('map-1').viewsheds.map((v) => v.id)).toEqual(['vs-1']);
    });

    it('persists a remote camera position keyed by tilesetId (CREATE then DELETE by id)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.CAMERA_POSITION_3D, operationType: OperationType.CREATE,
            entityId: 'cam-1', mapId: 'map-1', data: { id: 'cam-1', tilesetId: 'tile-9' },
        });
        expect(cesium3dStore.get('map-1').cameraPositions['tile-9'].id).toBe('cam-1');

        await applyRemoteOperation({
            entityType: EntityType.CAMERA_POSITION_3D, operationType: OperationType.DELETE,
            entityId: 'cam-1', mapId: 'map-1', data: null,
        });
        expect(cesium3dStore.get('map-1').cameraPositions['tile-9']).toBeUndefined();
    });

    it('persists a remote 360 orientation keyed by photoName (UPDATE then DELETE by id)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.ORIENTATION_360, operationType: OperationType.UPDATE,
            entityId: 'or-1', mapId: 'map-1', data: { id: 'or-1', photoName: 'photo-a' },
        });
        expect(sv360Store.get('map-1').orientations['photo-a'].id).toBe('or-1');

        await applyRemoteOperation({
            entityType: EntityType.ORIENTATION_360, operationType: OperationType.DELETE,
            entityId: 'or-1', mapId: 'map-1', data: null,
        });
        expect(sv360Store.get('map-1').orientations['photo-a']).toBeUndefined();
    });

    it('persists a remote 360 marker into the streetview360 markers array', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MARKER_360, operationType: OperationType.CREATE,
            entityId: 'm360-1', mapId: 'map-1', data: { id: 'm360-1', photoName: 'photo-a' },
        });
        expect(sv360Store.get('map-1').markers.map((m) => m.id)).toEqual(['m360-1']);

        await applyRemoteOperation({
            entityType: EntityType.MARKER_360, operationType: OperationType.DELETE,
            entityId: 'm360-1', mapId: 'map-1', data: null,
        });
        expect(sv360Store.get('map-1').markers).toHaveLength(0);
    });

    // Convergence: 3D/360 entities are CONVERGENCE_GUARDED, so an UPDATE that arrives LATER but
    // carries a LOWER serverVersion (a concurrent peer edit that lost the arrival-order race) must
    // be IGNORED — otherwise two clients diverge on the same 3D entity.
    it('ignores a stale 3D marker UPDATE (lower serverVersion → LWW convergence)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MARKER_3D, operationType: OperationType.CREATE,
            entityId: 'lww-3d', mapId: 'map-1', serverVersion: 20,
            data: { id: 'lww-3d', tilesetId: 't1', nome: 'v20' },
        });
        const nameOf = () => cesium3dStore.get('map-1').markers.find((m) => m.id === 'lww-3d')?.nome;
        expect(nameOf()).toBe('v20');

        // A LATER-DELIVERED but OLDER op (serverVersion 10) must be dropped.
        await applyRemoteOperation({
            entityType: EntityType.MARKER_3D, operationType: OperationType.UPDATE,
            entityId: 'lww-3d', mapId: 'map-1', serverVersion: 10,
            data: { id: 'lww-3d', tilesetId: 't1', nome: 'v10-stale' },
        });
        expect(nameOf()).toBe('v20'); // unchanged — the stale op was ignored
    });
});

describe('Remote map-setting operations', () => {
    it('emits MAP_MODIFIED for mapPosition', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MAP_POSITION,
            operationType: OperationType.UPDATE,
            entityId: 'map-1',
            mapId: 'map-1',
            data: { center: [0, 0], zoom: 5 }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MAP_MODIFIED,
            expect.objectContaining({ mapId: 'map-1' })
        );
    });

    it('baseLayer: GRAVA o registro do mapa e NAO mexe na tela de quem recebe', async () => {
        // DECISAO DO DONO, 2026-09-20: o mapa base na tela e estado de VISTA de cada pessoa, como a
        // camera. O que chega aqui e a base SALVA com a vista do mapa, gravada pelo par no gesto de
        // salvar, e ela vale na PROXIMA entrada de quem a recebe. Este ramo ja emitiu
        // `BASE_LAYER_CHANGED` (o cartao do seletor anunciava uma base que o mapa nao desenhava) e
        // depois um evento proprio que trocava o estilo do par; os dois sairam, porque trocar a base
        // debaixo de quem esta trabalhando era o defeito de UX.
        mapDataStore.set('map-1', { id: 'map-1', baseLayer: 'carta-topografica', features: {} });

        await applyRemoteOperation({
            entityType: EntityType.BASE_LAYER,
            operationType: OperationType.UPDATE,
            entityId: 'map-1',
            mapId: 'map-1',
            data: { baseLayer: 'osm' }
        });

        // O registro converge com o servidor...
        expect(mapDataStore.get('map-1').baseLayer).toBe('osm');
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MAP_MODIFIED,
            expect.objectContaining({ mapId: 'map-1' })
        );
        // ...e NENHUM evento de base sai: nem o que o seletor ouve, nem outro com outro nome. A
        // varredura e por prefixo de proposito, para pegar um evento novo que alguem reinvente.
        const eventosDeBase = eventBus.emit.mock.calls
            .map(([nome]) => String(nome))
            .filter((nome) => nome.startsWith('baseLayer:'));
        expect(eventosDeBase).toEqual([]);
    });

    it('mapTemporal: grava a config e avisa a CONFIG, nunca o interruptor da tela', async () => {
        // O `ativo` que chega e o valor SALVO com a vista do mapa. Emitir `MAP_TEMPORAL_CHANGED`
        // daqui era o que fazia o gesto de um colega ligar a linha do tempo de todos.
        //
        // O REGISTRO DO MAPA E' PRE-CONDICAO DESTE CASO, e ate 2026-09-21 ele nao era: sem mapa
        // nenhum no repositorio a config era gravada sob `temporal_<uuid>` e o caso passava assim
        // mesmo, porque so' olhava o evento. A chave e' asserida abaixo, junto com ele.
        mapDataStore.set('map-1', { ...createTestMapData(), name: 'Mapa da Config' });

        await applyRemoteOperation({
            entityType: EntityType.MAP_TEMPORAL,
            operationType: OperationType.UPDATE,
            entityId: 'map-1',
            mapId: 'map-1',
            data: { ativo: true, unidade: 'DIA', inicio: 1000, fim: 5000 }
        });

        expect(settingStore.get('temporal_Mapa da Config')).toEqual({ ativo: true, unidade: 'DIA', inicio: 1000, fim: 5000 });
        expect(settingStore.has('temporal_map-1')).toBe(false);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.TEMPORAL_CONFIG_CHANGED,
            expect.objectContaining({ mapName: 'Mapa da Config', config: expect.objectContaining({ ativo: true, inicio: 1000 }) })
        );
        expect(eventBus.emit).not.toHaveBeenCalledWith(EventTypes.MAP_TEMPORAL_CHANGED, expect.anything());
    });

    it('emits MAP_NOTES_REQUESTED and MAP_MODIFIED for mapNotes', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MAP_NOTES,
            operationType: OperationType.UPDATE,
            entityId: 'map-1',
            mapId: 'map-1',
            data: { notes: 'hello' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MAP_NOTES_REQUESTED,
            expect.objectContaining({ mapName: 'map-1' })
        );
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MAP_MODIFIED,
            expect.objectContaining({ mapId: 'map-1' })
        );
    });

    it('emits MAP_MODIFIED for gridStyle', async () => {
        await applyRemoteOperation({
            entityType: EntityType.GRID_STYLE,
            operationType: OperationType.UPDATE,
            entityId: 'map-1',
            mapId: 'map-1',
            data: { color: '#fff' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MAP_MODIFIED,
            expect.objectContaining({ mapId: 'map-1' })
        );
    });

    it('emits LAYERS_CHANGED for catalogLayer', async () => {
        await applyRemoteOperation({
            entityType: EntityType.CATALOG_LAYER,
            operationType: OperationType.CREATE,
            entityId: 'cl-1',
            mapId: 'map-1',
            data: { id: 'cl-1' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.LAYERS_CHANGED,
            expect.objectContaining({ mapName: 'map-1' })
        );
    });
});

// The maps-list ORDERING syncs as an atlas-level `setting` op carrying { mapOrder: [names] }
// (map.operations.setMapOrder → logAtlasSetting). Inbound it must persist under the EXACT local
// setting key getMapOrder() reads ('mapOrder') and trigger a re-render (LAYERS_CHANGED, mapName:
// null). This is the inbound half the e2e (browser-collab-map-order) exercises across two peers;
// it shares the code path of the tested mapBadgeColors / terrainExaggeration setting sync.
describe('Remote atlas-setting operations — mapOrder (maps-list ordering)', () => {
    it('persists mapOrder from a live setting op and emits LAYERS_CHANGED', async () => {
        await applyRemoteOperation({
            entityType: EntityType.SETTING,
            operationType: OperationType.UPDATE,
            entityId: 'atlas',
            data: { mapOrder: ['Mapa B', 'Mapa A', 'Mapa C'] }
        });

        // Keyed exactly as getMapOrder()/setMapOrder() read/write it.
        expect(settingStore.get('mapOrder')).toEqual(['Mapa B', 'Mapa A', 'Mapa C']);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.LAYERS_CHANGED,
            expect.objectContaining({ mapName: null })
        );
    });

    it('rehydrates mapOrder from a snapshot atlas.settings (F5 / new peer)', async () => {
        await applyRemoteSnapshot({
            atlas: { settings: { mapOrder: ['Mapa C', 'Mapa A'] } },
            maps: []
        });

        expect(settingStore.get('mapOrder')).toEqual(['Mapa C', 'Mapa A']);
    });

    it('ignores a non-array mapOrder (defensive — never clobbers the local order)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.SETTING,
            operationType: OperationType.UPDATE,
            entityId: 'atlas',
            data: { mapOrder: 'not-an-array' }
        });

        expect(settingStore.has('mapOrder')).toBe(false);
    });
});

// P9: a LIVE map-setting/catalog op must PERSIST inbound (not just emit), so two clients
// editing live converge — matching the snapshot path. Regression for GAP-1/2/3/4/5.
// ============================================================================
// REPRO: o `map` UPDATE ao vivo carrega SO' o que mudou
// ============================================================================

describe('Remote map UPDATE: o payload PARCIAL nao pode substituir o registro', () => {
    // O DEFEITO, medido em 2026-09-02 e registrado em `.claude/rules/architecture.md` §Lock:
    // depois de o dono travar o mapa, o Editor nao passava a ler o mapa como travado E a contagem
    // de feicoes dele caia de 2 para 0, em tres rodadas de tres. A causa, diagnosticada em
    // 2026-09-13: o ramo de UPDATE fazia uma gravacao CEGA do documento inteiro com o payload
    // parcial. Uma troca de trava viaja como `{ locked: true }` e nada mais (o servidor aplica
    // `MAP_UPDATE_FIELDS` dinamicamente e o broadcast ecoa o payload do cliente), entao gravar
    // aquilo verbatim apagava feicoes, nome e tudo o mais.
    //
    // A SEGUNDA METADE DO MESMO DEFEITO e' a que quase passa batida: `reshapeSnapshotMap` chaveia
    // a trava pelo NOME do mapa (`mapLocked_<name>`), e um payload parcial nao tem nome, entao o
    // UNICO campo que a op carregava nao ia para lugar nenhum.
    beforeEach(() => {
        const mapa = createTestMapData();
        mapa.name = 'Mapa do Chefe';
        mapa.baseLayer = 'carta-topografica';
        mapa.features.points.push(
            { type: 'Feature', properties: { id: 'p1', source: 'point' }, geometry: { type: 'Point', coordinates: [0, 0] } },
            { type: 'Feature', properties: { id: 'p2', source: 'point' }, geometry: { type: 'Point', coordinates: [1, 1] } }
        );
        mapDataStore.set('map-1', mapa);
        memoryStore.lockedMaps.clear();
    });

    it('um UPDATE de `{locked}` PRESERVA feicoes, nome e mapa-base', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: null, data: { locked: true },
        });

        const depois = mapDataStore.get('map-1');
        expect(depois.features.points.map((f) => f.properties.id)).toEqual(['p1', 'p2']);
        expect(depois.name).toBe('Mapa do Chefe');
        expect(depois.baseLayer).toBe('carta-topografica');
        expect(depois.id).toBe('map-1');
    });

    it('e o campo que ele carrega CHEGA: app setting, conjunto em memoria e evento', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: null, data: { locked: true },
        });

        // A chave e' derivada do NOME, e o nome vem do registro guardado, porque o payload nao o
        // traz. Era exatamente aqui que a trava se perdia.
        expect(settingStore.get('mapLocked_Mapa do Chefe')).toBe(true);
        // `isCurrentMapLockedSync` le' este conjunto, e e' ele o gate real de edicao.
        expect(memoryStore.lockedMaps.has('Mapa do Chefe')).toBe(true);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MAP_LOCK_CHANGED, { mapName: 'Mapa do Chefe', locked: true }
        );
    });

    it('destravar percorre o mesmo caminho, e o conjunto perde o mapa', async () => {
        memoryStore.lockedMaps.add('Mapa do Chefe');
        settingStore.set('mapLocked_Mapa do Chefe', true);

        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: null, data: { locked: false },
        });

        expect(settingStore.get('mapLocked_Mapa do Chefe')).toBe(false);
        expect(memoryStore.lockedMaps.has('Mapa do Chefe')).toBe(false);
        expect(mapDataStore.get('map-1').features.points).toHaveLength(2);
    });

    it('um UPDATE de NOME troca o nome e nao mexe em mais nada', async () => {
        // O controle do caso de cima: a mescla nao pode ser "so' a trava passa". Um campo
        // presente SUBSTITUI, um campo ausente PERMANECE.
        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: null, data: { name: 'Renomeado pelo par' },
        });

        const depois = mapDataStore.get('map-1');
        expect(depois.name).toBe('Renomeado pelo par');
        expect(depois.baseLayer).toBe('carta-topografica');
        expect(depois.features.points).toHaveLength(2);
    });

    it('`base_layer` snake_case do servidor vira `baseLayer` e nao arrasta o resto', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: null, data: { base_layer: 'osm' },
        });

        const depois = mapDataStore.get('map-1');
        expect(depois.baseLayer).toBe('osm');
        expect(depois.base_layer).toBeUndefined();
        expect(depois.features.points).toHaveLength(2);
        expect(depois.name).toBe('Mapa do Chefe');
    });
});

describe('Remote map-setting operations — persistence (P9)', () => {
    beforeEach(() => {
        mapDataStore.set('map-1', createTestMapData());
    });

    it('persists baseLayer onto the map record', async () => {
        await applyRemoteOperation({
            entityType: EntityType.BASE_LAYER, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: 'map-1', data: { baseLayer: 'osm' },
        });
        expect(mapDataStore.get('map-1').baseLayer).toBe('osm');
    });

    it('persists map notes to the side-store', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MAP_NOTES, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: 'map-1', data: { title: 'T', description: 'D' },
        });
        expect(settingStore.get('map_notes_map-1')).toEqual({ title: 'T', description: 'D' });
    });

    it('persists grid style to the side-store', async () => {
        await applyRemoteOperation({
            entityType: EntityType.GRID_STYLE, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: 'map-1', data: { format: 'UTM', visible: true },
        });
        expect(settingStore.get('gridStyle_map-1')).toEqual({ format: 'UTM', visible: true });
    });

    it('persists saved map position onto the map record', async () => {
        const pos = { id: 'pos-1', center_lat: -22.9, center_long: -43.1, zoom: 10, bearing: 0, pitch: 0 };
        await applyRemoteOperation({
            entityType: EntityType.MAP_POSITION, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: 'map-1', data: pos,
        });
        const saved = mapDataStore.get('map-1');
        expect(saved.savedPosition).toEqual(pos);
        expect(saved.center_lat).toBe(-22.9);
        expect(saved.zoom).toBe(10);
    });

    // F1 — a limpeza de posição viaja como UPDATE com os cinco campos nulos, porque o DELETE
    // que ela emitia era, no servidor, uma exclusão do MAPA. Sem este ramo o par guardaria um
    // objeto de cinco nulos COMO posição salva: os campos planos leriam limpo enquanto
    // `savedPosition` afirmaria que existe uma.
    it('trata um UPDATE com os cinco campos nulos como limpeza de posição', async () => {
        const m = mapDataStore.get('map-1');
        m.savedPosition = { id: 'pos-1', center_lat: -22.9, zoom: 10 };
        m.center_lat = -22.9;
        m.zoom = 10;
        await applyRemoteOperation({
            entityType: EntityType.MAP_POSITION, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: 'map-1',
            data: { center_lat: null, center_long: null, zoom: null, bearing: null, pitch: null },
        });
        const saved = mapDataStore.get('map-1');
        expect(saved.savedPosition).toBeUndefined();
        expect(saved.center_lat).toBeNull();
        expect(saved.zoom).toBeNull();
    });

    it('um UPDATE com números continua sendo posição, não limpeza', async () => {
        // Controle: a guarda de "tudo nulo" não pode engolir uma posição real com zeros, que
        // é justamente o valor neutro de bearing e pitch.
        const pos = { id: 'pos-2', center_lat: -15.8, center_long: -47.9, zoom: 0, bearing: 0, pitch: 0 };
        await applyRemoteOperation({
            entityType: EntityType.MAP_POSITION, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: 'map-1', data: pos,
        });
        const saved = mapDataStore.get('map-1');
        expect(saved.savedPosition).toEqual(pos);
        expect(saved.zoom).toBe(0);
    });

    it('clears saved position on a DELETE (null data)', async () => {
        const m = mapDataStore.get('map-1');
        m.savedPosition = { id: 'pos-1', center_lat: -22.9 };
        m.center_lat = -22.9;
        await applyRemoteOperation({
            entityType: EntityType.MAP_POSITION, operationType: OperationType.DELETE,
            entityId: 'map-1', mapId: 'map-1', data: null,
        });
        const saved = mapDataStore.get('map-1');
        expect(saved.savedPosition).toBeUndefined();
        expect(saved.center_lat).toBeNull();
    });

    it('persists a remote catalog layer (CREATE replace-by-id / DELETE)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.CATALOG_LAYER, operationType: OperationType.CREATE,
            entityId: 'cl-1', mapId: 'map-1', data: { id: 'cl-1', name: 'WMS', visible: true },
        });
        expect(mapDataStore.get('map-1').catalogLayers).toHaveLength(1);
        expect(mapDataStore.get('map-1').catalogLayers[0].name).toBe('WMS');

        // UPDATE replaces by id (no duplicate).
        await applyRemoteOperation({
            entityType: EntityType.CATALOG_LAYER, operationType: OperationType.UPDATE,
            entityId: 'cl-1', mapId: 'map-1', data: { id: 'cl-1', name: 'WMS', visible: false },
        });
        expect(mapDataStore.get('map-1').catalogLayers).toHaveLength(1);
        expect(mapDataStore.get('map-1').catalogLayers[0].visible).toBe(false);

        // DELETE removes by id.
        await applyRemoteOperation({
            entityType: EntityType.CATALOG_LAYER, operationType: OperationType.DELETE,
            entityId: 'cl-1', mapId: 'map-1', data: null,
        });
        expect(mapDataStore.get('map-1').catalogLayers).toHaveLength(0);
    });
});

describe('applyRemoteSnapshot', () => {
    it('saves all maps and briefings from the snapshot', async () => {
        const snapshot = {
            maps: [
                { id: 'map-a', features: { points: [] }, layers: [] },
                { id: 'map-b', features: { points: [] }, layers: [] }
            ],
            briefings: [
                { id: 'brf-a', name: 'Briefing A', slides: [] }
            ]
        };

        await applyRemoteSnapshot(snapshot);

        expect(mapDataStore.has('map-a')).toBe(true);
        expect(mapDataStore.has('map-b')).toBe(true);
        expect(briefingStore.has('brf-a')).toBe(true);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.LAYERS_CHANGED,
            expect.anything()
        );
    });

    it('is defensive about missing fields', async () => {
        await applyRemoteSnapshot(undefined);
        await applyRemoteSnapshot({});
        await expect(applyRemoteSnapshot({ maps: [null, { features: {} }], briefings: [null] })).rejects.toThrow('Snapshot inválido');

        // No map without an id should have been stored.
        expect(mapDataStore.size).toBe(0);
        expect(briefingStore.size).toBe(0);
    });

    it('reshapes a backend-shaped (snake_case) map and populates side-stores', async () => {
        const snapshot = {
            maps: [
                {
                    id: 'map-id-1',
                    name: 'Mapa Alfa',
                    base_layer: 'osm',
                    notes_title: 'Título',
                    notes_description: 'Descrição da nota',
                    grid_style: { format: 'UTM', visible: true },
                    temporal_config: { ativo: true, unidade: 'dia', inicio: 1, fim: 9 },
                    locked: true,
                    features: { points: [] },
                    layers: []
                }
            ]
        };

        await applyRemoteSnapshot(snapshot);

        // (a) The saved IndexedDB map is camelCase: baseLayer set, no snake_case columns.
        const saved = mapDataStore.get('map-id-1');
        expect(saved).toBeDefined();
        expect(saved.baseLayer).toBe('osm');
        expect(saved.base_layer).toBeUndefined();
        expect(saved.notes_title).toBeUndefined();
        expect(saved.notes_description).toBeUndefined();
        expect(saved.grid_style).toBeUndefined();
        expect(saved.temporal_config).toBeUndefined();
        expect(saved.locked).toBeUndefined();
        // Verbatim collaborative fields survive the reshape. `coordination_lines` is the ONE
        // key the reshape adds (2026-09-03): a peer that predates the Coordination Line tool
        // sends no such bucket, and without it the layer setup builds no source, so the tool
        // activates, accepts clicks and draws nothing. See `ensureMapDataShape`.
        expect(saved.features).toEqual({ points: [], coordination_lines: [], engineering_symbols: [] });
        expect(saved.layers).toEqual([]);

        // (b) Each side-store is populated under the correct key with the correct value.
        // Notes + grid are keyed by map id; temporal + lock by map name.
        expect(settingStore.get('map_notes_map-id-1')).toEqual({
            title: 'Título',
            description: 'Descrição da nota'
        });
        expect(settingStore.get('gridStyle_map-id-1')).toEqual({ format: 'UTM', visible: true });
        expect(settingStore.get('temporal_Mapa Alfa')).toEqual({
            ativo: true, unidade: 'dia', inicio: 1, fim: 9
        });
        expect(settingStore.get('mapLocked_Mapa Alfa')).toBe(true);
    });

    it('does not touch side-stores when backend map omits those columns', async () => {
        await applyRemoteSnapshot({
            maps: [{ id: 'map-bare', name: 'Bare', features: { points: [] }, layers: [] }]
        });

        const saved = mapDataStore.get('map-bare');
        expect(saved).toBeDefined();
        // Empty/absent settings should not create stray side-store entries.
        expect(settingStore.size).toBe(0);
    });
});

// P10: conflicts resolve last-one-wins BY ARRIVAL (no version/timestamp gate), and locks are
// advisory-only — a locked map still accepts remote edits. These pin the model against any
// future drift into version-rejection or lock-blocking on the apply path.
describe('P10 — LWW & no-locks on apply', () => {
    beforeEach(() => {
        mapDataStore.set('map-1', createTestMapData());
    });

    it('a remote UPDATE overwrites local regardless of local version (LWW by arrival)', async () => {
        mapDataStore.get('map-1').features.points.push({
            type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { id: 'f1', source: 'point', nome: 'old', version: 99 },
        });

        // An older-version op still wins because it arrived later (no version gate).
        await applyRemoteOperation({
            entityType: EntityType.FEATURE, operationType: OperationType.UPDATE,
            entityId: 'f1', mapId: 'map-1',
            data: {
                type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] },
                properties: { id: 'f1', source: 'point', nome: 'new', version: 1 },
            },
        });

        const f = mapDataStore.get('map-1').features.points[0];
        expect(f.properties.nome).toBe('new');
        expect(f.properties.version).toBe(1);
    });

    it('a locked map still accepts remote feature ops (lock is advisory only)', async () => {
        memoryStore.lockedMaps.add('map-1');
        try {
            await applyRemoteOperation({
                entityType: EntityType.FEATURE, operationType: OperationType.CREATE,
                entityId: 'f2', mapId: 'map-1',
                data: {
                    type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
                    properties: { id: 'f2', source: 'point' },
                },
            });
            expect(mapDataStore.get('map-1').features.points.some((f) => f.properties.id === 'f2')).toBe(true);
        } finally {
            memoryStore.lockedMaps.delete('map-1');
        }
    });
});

// P11: a pulled snapshot must reconstruct layers / cesium3d / streetview360 into their DEDICATED
// side-stores (where the export loaders + layer manager read them), not only inline in the map doc
// — else a server atlas re-exports as .ebgeo WITHOUT its layers/3D/360 (round-trip data loss).
describe('applyRemoteSnapshot — side-store fidelity (P11)', () => {
    it('persists snapshot layers / cesium3d / streetview360 into their side-stores', async () => {
        await applyRemoteSnapshot({
            maps: [{
                id: 'map-1', name: 'Mapa A',
                features: { points: [] },
                layers: [{ id: 'L1', name: 'Camada', order: 0, visible: true }],
                cesium3d: { cameraPositions: {}, markers: [{ id: 'cm1', tilesetId: 't1' }], measurements: [], viewsheds: [] },
                streetview360: { orientations: {}, markers: [{ id: 'sm1', photoName: 'p' }] },
            }],
        });
        expect(layerStore.get('map-1')).toEqual([{ id: 'L1', name: 'Camada', order: 0, visible: true }]);
        expect(cesium3dStore.get('map-1').markers.map((m) => m.id)).toEqual(['cm1']);
        expect(sv360Store.get('map-1').markers.map((m) => m.id)).toEqual(['sm1']);
    });

    it('persists EVERY cesium3d / 360 sub-type from the snapshot (not just markers)', async () => {
        await applyRemoteSnapshot({
            maps: [{
                id: 'map-1', name: 'Mapa A',
                features: { points: [] },
                cesium3d: {
                    cameraPositions: { t9: { id: 'cam9', tilesetId: 't9' } },
                    markers: [{ id: 'cm1', tilesetId: 't1' }],
                    measurements: [{ id: 'meas1' }],
                    viewsheds: [{ id: 'vs1' }],
                },
                streetview360: {
                    orientations: { 'photo-a': { id: 'or1', photoName: 'photo-a' } },
                    markers: [{ id: 'sm1', photoName: 'p' }],
                },
            }],
        });
        const c = cesium3dStore.get('map-1');
        expect(c.markers.map((m) => m.id)).toEqual(['cm1']);
        expect(c.measurements.map((m) => m.id)).toEqual(['meas1']);
        expect(c.viewsheds.map((v) => v.id)).toEqual(['vs1']);
        expect(c.cameraPositions.t9.id).toBe('cam9');
        const s = sv360Store.get('map-1');
        expect(s.markers.map((m) => m.id)).toEqual(['sm1']);
        expect(s.orientations['photo-a'].id).toBe('or1');
    });
});

// P8: undo/redo is LOCAL per user — a remote op must NEVER enter the undo stack. Remote ops
// apply by mutating the repo directly; they never route through the local undo path
// (store-state-manager.recordAction). This is a structural guarantee — if anyone wires the
// undo machinery into the remote handler, this fails.
describe('P8 — remote ops are never undoable (structural)', () => {
    it('the remote-operation-handler does not touch the undo machinery', () => {
        const src = readFileSync(
            new URL('../../src/js/store/sync/remote-operation-handler.js', import.meta.url),
            'utf8'
        );
        // No IMPORT of the undo machinery and no recordAction CALL (descriptive comments that
        // mention store-state-manager are fine — we match the import/call, not any mention).
        expect(src).not.toMatch(/from\s+['"][^'"]*store-state-manager/);
        expect(src).not.toMatch(/\.recordAction\s*\(/);
    });
});

describe('Unknown entity type', () => {
    it('warns for unknown entity types', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await applyRemoteOperation({
            entityType: 'UNKNOWN_TYPE',
            operationType: OperationType.CREATE,
            entityId: 'x',
            data: {}
        });

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('unknown entity type')
        );
        consoleSpy.mockRestore();
    });
});

// §11 convergence guard — the DEFER / ACK-REPLAY / SELF-HEAL machinery (beyond the simple
// version-drop already covered above). This is what makes two concurrent edits to the SAME feature
// converge to max(serverVersion) WITHOUT per-property merge (feature-level LWW):
//   markLocalEditPending → a concurrent remote op is DEFERRED while the author's edit is un-acked
//   → resolveLocalEdit (push ack) seeds the order and replays the deferred op through the version guard
//   → reconcilePendingLocalEdits (post-flush) self-heals a leaked count (op compacted away / never acked).
describe('Convergence guard — defer / ack-replay / self-heal (§11)', () => {
    const updateOp = (id, color, serverVersion) => ({
        entityType: EntityType.FEATURE,
        operationType: OperationType.UPDATE,
        entityId: id,
        mapId: 'map-1',
        serverVersion,
        data: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { id, source: 'line', lineColor: color },
        },
    });

    function seedLine(id, color) {
        const map = createTestMapData();
        map.features.lines.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { id, source: 'line', lineColor: color },
        });
        mapDataStore.set('map-1', map);
    }
    const colorOf = (id) =>
        mapDataStore.get('map-1').features.lines.find((f) => f.properties.id === id)?.properties.lineColor;

    it('defers a concurrent remote op while the local edit is un-acked (not applied yet)', async () => {
        seedLine('cg-defer', '#000000');   // author's optimistic local value
        markLocalEditPending('cg-defer');  // author has an un-acked edit on this feature

        // Peer's op for the SAME feature arrives before the author's ack → must be deferred, not applied.
        await applyRemoteOperation(updateOp('cg-defer', '#ff0000', 30));
        expect(colorOf('cg-defer')).toBe('#000000');

        // Author's push ack (serverVersion 25) reveals the order and replays the deferred op.
        // 30 > 25 → the peer's edit wins; both clients converge to the higher serverVersion.
        await resolveLocalEdit('cg-defer', 25);
        expect(colorOf('cg-defer')).toBe('#ff0000');
    });

    it("keeps the author's edit when its serverVersion is higher: the deferred older peer op is dropped", async () => {
        seedLine('cg-author', '#000000');  // author's optimistic value — should win
        markLocalEditPending('cg-author');

        await applyRemoteOperation(updateOp('cg-author', '#ff0000', 10)); // older peer op → deferred
        expect(colorOf('cg-author')).toBe('#000000');

        // Author's ack is serverVersion 25 (> the peer's 10) → on replay the stale peer op is dropped.
        await resolveLocalEdit('cg-author', 25);
        expect(colorOf('cg-author')).toBe('#000000'); // converges to v25 (the author's edit)
    });

    it('self-heals a leaked pending count: reconcile clears it and replays the deferred op', async () => {
        seedLine('cg-rec', '#000000');
        markLocalEditPending('cg-rec'); // local edit whose op is later compacted away (never acked)

        await applyRemoteOperation(updateOp('cg-rec', '#00ff00', 40)); // deferred (pending > 0)
        expect(colorOf('cg-rec')).toBe('#000000');

        // The author's op never reaches the server (e.g. CREATE+DELETE compaction) → no ack ever comes.
        // After a flush, reconcile sees 'cg-rec' is no longer queued → clears the leak and replays.
        await reconcilePendingLocalEdits(new Set());
        expect(colorOf('cg-rec')).toBe('#00ff00');
    });
});

// ============================================================================
// Auditoria do sistema temporal de 2026-09-21: S5, S12 e a metade REMOTA do S1
// ============================================================================

/**
 * A config temporal de um mapa e' um app setting chaveado pelo NOME do mapa
 * (`temporal_<nome>`), espelhado em memoria em `memoryStore.temporalConfigs`. Os tres achados
 * abaixo sao do CAMINHO DE ENTRADA, e o que os une e' a chave: ela nao e' o identificador que a
 * op carrega, entao todo ponto de entrada tem de traduzir, e os tres traduziam errado ou nao
 * traduziam.
 *
 * O QUE NENHUM DELES PODE FAZER e' mexer em `memoryStore.temporalView`, que e' o interruptor da
 * tela DESTA pessoa (decisao do dono de 2026-09-20): op remota persiste e nunca repinta a vista
 * de ninguem. A unica excecao e' o rename, que nao muda o VALOR do interruptor, muda o endereco
 * dele.
 */
const CONFIG_TEMPORAL = { ativo: true, modo: 'relativo', unidade: 'HORA', inicio: 1000, fim: 9000, origem: 1000 };

describe('S5 — o retrato repoe o espelho da config temporal, como ja repunha o da trava', () => {
    // O DEFEITO: a ativacao de uma geracao de retrato faz `memoryStore.lockedMaps.clear()` e
    // `memoryStore.temporalConfigs.clear()` na mesma linha, e so' a trava voltava. A trava e'
    // reposta e ANUNCIADA pelos efeitos `present()` de `reshapeSnapshotMap` (`mapLocked_` +
    // `MAP_LOCK_CHANGED`); o temporal so' era gravado em disco, sem espelho e sem evento. Depois
    // de um retrato no meio da sessao, `getMapTemporalConfigSync` respondia os PADROES para o
    // mapa que a pessoa esta vendo (rotulos D+N, passo da regua, filtro de render), e a barra nao
    // relia nada.
    //
    // O ZERAMENTO EM SI mora no ramo de geracao (`applyRemoteSnapshot` com escopo remoto), que
    // exige namespace, ponteiro de geracao e pausa de escrita; o que se prende aqui e' a metade
    // que faltava, a REPOSICAO, mais a FORMA dela (por `present`, que e' o que a poe depois do
    // zeramento).
    beforeEach(() => {
        mapResolver.clear();
        memoryStore.temporalConfigs.clear();
        memoryStore.temporalView.clear();
    });

    it('um mapa COM config no retrato volta ao espelho e avisa a barra', async () => {
        await applyRemoteSnapshot({
            maps: [{ id: 'map-s5', name: 'Mapa Retratado', features: {}, temporal_config: CONFIG_TEMPORAL }],
            briefings: [],
        });

        expect(settingStore.get('temporal_Mapa Retratado')).toEqual(CONFIG_TEMPORAL);
        // O espelho e' o que `getMapTemporalConfigSync` le, e e' ele que o zeramento esvazia.
        expect(memoryStore.temporalConfigs.get('Mapa Retratado')).toEqual(CONFIG_TEMPORAL);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.TEMPORAL_CONFIG_CHANGED,
            { mapName: 'Mapa Retratado', config: CONFIG_TEMPORAL }
        );
    });

    it('e NAO liga a linha do tempo de quem recebe: a vista da pessoa nao se toca', async () => {
        // O `ativo: true` que chega e' o valor SALVO com a vista do mapa pelo autor. O
        // interruptor desta tela e' `temporalView`, e ele continua dizendo o que dizia.
        memoryStore.temporalView.set('Mapa Retratado', false);

        await applyRemoteSnapshot({
            maps: [{ id: 'map-s5', name: 'Mapa Retratado', features: {}, temporal_config: CONFIG_TEMPORAL }],
            briefings: [],
        });

        expect(memoryStore.temporalView.get('Mapa Retratado')).toBe(false);
        expect(eventBus.emit).not.toHaveBeenCalledWith(EventTypes.MAP_TEMPORAL_CHANGED, expect.anything());
    });

    it('um mapa SEM config no retrato nao herda a da geracao anterior', async () => {
        // A borda que o zeramento escondia: sem reposicao o espelho ficava vazio e "certo" por
        // acidente. Com reposicao, um mapa que perdeu a config precisa de APAGAMENTO explicito,
        // senao o valor da geracao anterior sobrevive ao retrato que o desfez.
        memoryStore.temporalConfigs.set('Mapa Retratado', CONFIG_TEMPORAL);

        await applyRemoteSnapshot({
            maps: [{ id: 'map-s5', name: 'Mapa Retratado', features: {}, temporal_config: null }],
            briefings: [],
        });

        expect(memoryStore.temporalConfigs.has('Mapa Retratado')).toBe(false);
        expect(settingStore.has('temporal_Mapa Retratado')).toBe(false);
    });

    it('um `map` UPDATE parcial, que nao carrega a coluna, nao apaga o espelho', async () => {
        // Controle do caso acima: "ausente" e "vazio" sao respostas diferentes. Uma troca de
        // trava viaja como `{locked}` e nada mais, e ela nao pode limpar o temporal de ninguem.
        mapDataStore.set('map-s5', { ...createTestMapData(), id: 'map-s5', name: 'Mapa Retratado' });
        memoryStore.temporalConfigs.set('Mapa Retratado', CONFIG_TEMPORAL);

        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-s5', mapId: null, data: { locked: true },
        });

        expect(memoryStore.temporalConfigs.get('Mapa Retratado')).toEqual(CONFIG_TEMPORAL);
    });

    it('o espelho e escrito por `present`, como o da trava (estrutural)', () => {
        // POR QUE ISTO E' ESTRUTURAL: durante a preparacao de uma geracao, `present` ADIA o
        // efeito, e e' o adiamento que o poe DEPOIS do `temporalConfigs.clear()` da ativacao.
        // Escrito direto, o espelho seria preenchido ANTES do zeramento e apagado por ele, com o
        // caso funcional acima (que roda fora da preparacao) continuando verde.
        const src = readFileSync(
            new URL('../../src/js/store/sync/remote-operation-handler.js', import.meta.url),
            'utf8'
        );
        const reshape = src.slice(
            src.indexOf('async function reshapeSnapshotMap'),
            src.indexOf('export function applyRemoteSnapshot')
        );
        expect(reshape.length).toBeGreaterThan(0);
        expect(reshape).toContain('memoryStore.temporalConfigs');
        // Os dois espelhos, escritos da mesma forma: e' a licao do achado, e nao um detalhe.
        expect(reshape).toMatch(/present\([\s\S]{0,240}memoryStore\.temporalConfigs\./);
        expect(reshape).toMatch(/present\([\s\S]{0,240}memoryStore\.lockedMaps\./);
    });
});

describe('S12 — op temporal que chega antes do mapa nao vira lixo sob o identificador', () => {
    // O DEFEITO: `const mapName = mapResolver.resolveToName(mapId) || mapId`. O `|| mapId` nao e'
    // um padrao razoavel, e' uma chave `temporal_<uuid>` que `setCurrentMap` nunca le, que
    // `deleteMap` nunca remove (ele apaga pelo NOME) e que o rename nunca carrega: lixo que
    // nenhuma exclusao alcanca. A op chega antes do mapa quando o par cria o mapa e ajusta a
    // linha do tempo no mesmo gesto.
    //
    // E A METADE QUE QUASE PASSA BATIDA: `resolveToName` de um UUID desconhecido devolve O
    // PROPRIO UUID, nunca nulo, entao aquele `||` nunca chegava a rodar.
    beforeEach(() => {
        mapResolver.clear();
        memoryStore.temporalConfigs.clear();
        memoryStore.temporalView.clear();
        transferCalls.length = 0;
    });

    const opTemporal = (mapId, data) => ({
        entityType: EntityType.MAP_TEMPORAL, operationType: OperationType.UPDATE,
        entityId: mapId, mapId, data,
    });

    it('sem nome resolvido, NADA e gravado sob o identificador', async () => {
        await applyRemoteOperation(opTemporal('map-s12', CONFIG_TEMPORAL));

        expect([...settingStore.keys()].filter((k) => k.includes('map-s12'))).toEqual([]);
        expect(eventBus.emit).not.toHaveBeenCalledWith(EventTypes.TEMPORAL_CONFIG_CHANGED, expect.anything());
    });

    it('e a config e reaplicada quando o mapa aterrissa', async () => {
        await applyRemoteOperation(opTemporal('map-s12', CONFIG_TEMPORAL));
        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.CREATE,
            entityId: 'map-s12', mapId: null,
            data: { id: 'map-s12', name: 'Mapa Tardio', features: {} },
        });

        expect(settingStore.get('temporal_Mapa Tardio')).toEqual(CONFIG_TEMPORAL);
        expect(memoryStore.temporalConfigs.get('Mapa Tardio')).toEqual(CONFIG_TEMPORAL);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.TEMPORAL_CONFIG_CHANGED,
            { mapName: 'Mapa Tardio', config: CONFIG_TEMPORAL }
        );
    });

    it('o registro do repositorio responde quando o resolvedor ainda nao sabe', async () => {
        // A SEGUNDA FONTE, e e' ela que faz o caminho de recuperacao funcionar: na reprojecao das
        // intencoes pendentes o registro ja esta em disco enquanto o registro no resolvedor ainda
        // e' um efeito `present()` adiado.
        mapDataStore.set('map-s12b', { ...createTestMapData(), id: 'map-s12b', name: 'Mapa Gravado' });

        await applyRemoteOperation(opTemporal('map-s12b', CONFIG_TEMPORAL));

        expect(settingStore.get('temporal_Mapa Gravado')).toEqual(CONFIG_TEMPORAL);
        expect(settingStore.has('temporal_map-s12b')).toBe(false);
    });

    it('so a ULTIMA op bufferizada sobrevive, porque a config e um documento inteiro', async () => {
        // A borda que dispensa teto de tamanho: um ajuste de mapa nao e' incremento, e' o
        // documento todo, entao a op nova SUPERA a anterior em vez de se somar a ela.
        await applyRemoteOperation(opTemporal('map-s12c', CONFIG_TEMPORAL));
        await applyRemoteOperation(opTemporal('map-s12c', { ...CONFIG_TEMPORAL, unidade: 'DIA', fim: 50000 }));
        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.CREATE,
            entityId: 'map-s12c', mapId: null,
            data: { id: 'map-s12c', name: 'Mapa Duplo', features: {} },
        });

        expect(settingStore.get('temporal_Mapa Duplo')).toEqual({ ...CONFIG_TEMPORAL, unidade: 'DIA', fim: 50000 });
    });

    it('o retrato DESCARTA o ajuste bufferizado em vez de aplica-lo por cima', async () => {
        // A op so' chega a este cliente depois de o servidor te-la aplicado, entao a coluna que o
        // retrato traz e' pelo menos tao nova quanto ela. Reaplicar poria um documento VELHO por
        // cima de um novo.
        await applyRemoteOperation(opTemporal('map-s12d', CONFIG_TEMPORAL));

        const doRetrato = { ...CONFIG_TEMPORAL, unidade: 'DIA', fim: 777777 };
        await applyRemoteSnapshot({
            maps: [{ id: 'map-s12d', name: 'Mapa do Retrato', features: {}, temporal_config: doRetrato }],
            briefings: [],
        });
        expect(settingStore.get('temporal_Mapa do Retrato')).toEqual(doRetrato);

        // E o buffer ficou VAZIO: um `map` UPDATE posterior nao pode ressuscitar o ajuste velho.
        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-s12d', mapId: null, data: { locked: false },
        });
        expect(settingStore.get('temporal_Mapa do Retrato')).toEqual(doRetrato);
    });

    it('um mapa EXCLUIDO descarta o ajuste que esperava por ele', async () => {
        await applyRemoteOperation(opTemporal('map-s12e', CONFIG_TEMPORAL));
        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.DELETE,
            entityId: 'map-s12e', mapId: null, data: null,
        });
        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.CREATE,
            entityId: 'map-s12e', mapId: null,
            data: { id: 'map-s12e', name: 'Mapa Renascido', features: {} },
        });

        expect(settingStore.has('temporal_Mapa Renascido')).toBe(false);
    });
});

describe('S1 (metade REMOTA) — o rename vindo do par carrega os laterais chaveados por nome', () => {
    // O DEFEITO: um rename chega como `map` UPDATE com `{name: 'Novo'}`; `mergeRemoteMapUpdate`
    // grava o registro por `saveMap`, que nao sabe de documento lateral nenhum. O par que RECEBE
    // o rename perdia a config temporal daquele mapa (janela, unidade, modo relativo, Dia D) e a
    // vista fixada dele, e `temporal_<nomeAntigo>` ficava orfao no disco. A metade LOCAL mora em
    // `LocalRepository.renameMap`; esta e' a de entrada, e ela REUSA a mesma transferencia do
    // repositorio, porque duas listas de "o que pendura no NOME" divergem.
    //
    // O QUE MUDOU EM 2026-09-21 (ponto N1): este tratador cuida do DISCO e ANUNCIA. A
    // re-chaveagem da MEMORIA saiu daqui, onde era parcial (so' as duas metades temporais, e so'
    // quando o par nao estava com o mapa aberto), e virou `EventTypes.MAP_RENAMED_REMOTELY` mais
    // um assinante em `store/map.operations.js`, que chama as mesmas duas re-chaveagens do autor.
    // O tratador nao pode chama-las aqui porque nao pode importar o gerente de estado (P8).
    let mapaCorrenteAntes;

    beforeEach(() => {
        mapResolver.clear();
        memoryStore.temporalConfigs.clear();
        memoryStore.temporalView.clear();
        transferCalls.length = 0;
        mapaCorrenteAntes = memoryStore.currentMap;
        memoryStore.currentMap = 'Outro Mapa';
        mapDataStore.set('map-s1', { ...createTestMapData(), id: 'map-s1', name: 'Mapa Velho' });
    });

    afterEach(() => {
        memoryStore.currentMap = mapaCorrenteAntes;
    });

    it('leva a config temporal e a trava para a chave nova, e remove a velha', async () => {
        settingStore.set('temporal_Mapa Velho', CONFIG_TEMPORAL);
        settingStore.set('mapLocked_Mapa Velho', true);

        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-s1', mapId: null, data: { name: 'Mapa Novo' },
        });

        expect(settingStore.get('temporal_Mapa Novo')).toEqual(CONFIG_TEMPORAL);
        expect(settingStore.has('temporal_Mapa Velho')).toBe(false);
        expect(settingStore.get('mapLocked_Mapa Novo')).toBe(true);
        // DELEGADO, nao reimplementado: o repositorio e' quem sabe quais prefixos pendurem no
        // nome, e o proprio registro e' excluido da varredura de xara.
        expect(transferCalls).toEqual([{ oldName: 'Mapa Velho', newName: 'Mapa Novo', ownKeys: ['map-s1'] }]);
    });

    it('N1: o ANUNCIO sai, com os dois nomes, e DEPOIS de o disco ja dizer o nome novo', async () => {
        // A ORDEM E' O CONTRATO. O assinante re-chaveia a memoria para o nome NOVO e a aba Mapas
        // le o registro e o ajuste `lastActiveMap` do DISCO logo em seguida: anunciar antes do
        // `saveMap` poria a memoria a frente do disco, que e' o mesmo defeito ao contrario. O
        // caso mede isso do unico jeito que nao depende de ler o codigo: tirando um retrato do
        // disco DENTRO do emissor.
        settingStore.set('temporal_Mapa Velho', CONFIG_TEMPORAL);
        const noMomentoDoAnuncio = [];
        const bus = createMockEventBus();
        bus.emit = vi.fn((tipo, payload) => {
            if (tipo !== EventTypes.MAP_RENAMED_REMOTELY) return;
            noMomentoDoAnuncio.push({
                payload,
                nomeNoDisco: mapDataStore.get('map-s1')?.name ?? null,
                temporalNovoNoDisco: settingStore.get('temporal_Mapa Novo') ?? null,
            });
        });
        setRemoteHandlerEventBus(bus);

        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-s1', mapId: null, data: { name: 'Mapa Novo' },
        });

        expect(noMomentoDoAnuncio).toEqual([{
            payload: { mapId: 'map-s1', oldName: 'Mapa Velho', newName: 'Mapa Novo' },
            nomeNoDisco: 'Mapa Novo',
            temporalNovoNoDisco: CONFIG_TEMPORAL,
        }]);
    });

    it('N1: a re-chaveagem de MEMORIA nao e mais daqui, nem mesmo a temporal', async () => {
        // CONTROLE DA MUDANCA, e nao um verde vazio: este tratador ja' movia `temporalConfigs` e
        // `temporalView` por conta propria, e SO' quando o par nao estava com o mapa aberto. Com
        // o assinante chamando `renameMapInMemory` (que move as duas), manter a copia aqui as
        // moveria duas vezes, com a condicao invertida entre as copias. O sinal de que a metade
        // de memoria saiu e' esta: sem assinante no barramento, a memoria NAO se mexe.
        memoryStore.temporalConfigs.set('Mapa Velho', CONFIG_TEMPORAL);
        memoryStore.temporalView.set('Mapa Velho', true);
        settingStore.set('temporal_Mapa Velho', CONFIG_TEMPORAL);

        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-s1', mapId: null, data: { name: 'Mapa Novo' },
        });

        expect(settingStore.get('temporal_Mapa Novo')).toEqual(CONFIG_TEMPORAL);
        expect(memoryStore.temporalConfigs.get('Mapa Velho')).toEqual(CONFIG_TEMPORAL);
        expect(memoryStore.temporalConfigs.has('Mapa Novo')).toBe(false);
        expect(memoryStore.temporalView.get('Mapa Velho')).toBe(true);
        expect(memoryStore.temporalView.has('Mapa Novo')).toBe(false);
    });

    it('N1: o anuncio sai TAMBEM quando o par esta COM o mapa aberto', async () => {
        // Era exatamente o caso que a versao anterior deixava de fora, com o motivo escrito: com
        // `memoryStore.currentMap` no nome velho, mover so' a config temporal faria a barra do
        // par responder os PADROES. A saida nao era mover menos, era mover TUDO, e quem move tudo
        // e' o assinante. Aqui so' se afirma que o anuncio nao depende de onde o par esta.
        memoryStore.currentMap = 'Mapa Velho';

        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-s1', mapId: null, data: { name: 'Mapa Novo' },
        });

        expect(eventBus.emit).toHaveBeenCalledWith(EventTypes.MAP_RENAMED_REMOTELY, {
            mapId: 'map-s1', oldName: 'Mapa Velho', newName: 'Mapa Novo',
        });
    });

    it('com um XARA vivo a chave velha e copiada, nunca removida', async () => {
        // Documento lateral chaveado por nome pertence a quem ATENDE por aquele nome: enquanto
        // sobrevive um xara, a chave velha e' o dado dele. Mesma guarda do lado local.
        settingStore.set('temporal_Mapa Velho', CONFIG_TEMPORAL);
        mapDataStore.set('map-xara', { ...createTestMapData(), id: 'map-xara', name: 'Mapa Velho' });

        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-s1', mapId: null, data: { name: 'Mapa Novo' },
        });

        expect(settingStore.get('temporal_Mapa Novo')).toEqual(CONFIG_TEMPORAL);
        expect(settingStore.get('temporal_Mapa Velho')).toEqual(CONFIG_TEMPORAL);
    });

    it('um UPDATE que NAO mexe no nome nao transfere nada', async () => {
        // Controle: a trava viaja como `{locked}` e nada mais, e `mergeRemoteMapUpdate` repoe o
        // nome guardado no payload para poder chavear os laterais. Isso nao pode ser lido como
        // rename, ou todo gesto do par pagaria a varredura de xara.
        settingStore.set('temporal_Mapa Velho', CONFIG_TEMPORAL);
        memoryStore.temporalConfigs.set('Mapa Velho', CONFIG_TEMPORAL);

        await applyRemoteOperation({
            entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-s1', mapId: null, data: { locked: true },
        });

        expect(transferCalls).toEqual([]);
        expect(settingStore.get('temporal_Mapa Velho')).toEqual(CONFIG_TEMPORAL);
        expect(memoryStore.temporalConfigs.get('Mapa Velho')).toEqual(CONFIG_TEMPORAL);
        // E NAO ANUNCIA. O assinante recusaria por conta propria (nome igual dos dois lados),
        // mas um anuncio por gesto do par e' ruido que qualquer assinante futuro paga.
        expect(eventBus.emit).not.toHaveBeenCalledWith(
            EventTypes.MAP_RENAMED_REMOTELY, expect.anything(),
        );
    });
});

describe('D1/O3 — a ativacao do retrato repoe a marca e anuncia o mapa corrente (estrutural)', () => {
    // POR QUE ESTE BLOCO E' ESTRUTURAL, e nao funcional como os vizinhos: o trecho que ele mede
    // vive no ramo de escopo REMOTO de `applyRemoteSnapshot`, que exige namespace, ponteiro de
    // geracao e pausa de escrita. Este arquivo aplica retratos em escopo LOCAL, onde o ramo
    // inteiro e' pulado, entao um caso funcional escrito aqui seria verde sem nunca ter executado
    // a linha que interessa. O caso funcional, com IndexedDB e escopo remoto de verdade, esta em
    // `frontend/tests/integration/retrato-repoe-a-marca-do-resolvedor.test.js`; o que se prende
    // aqui e' a FORMA, que e' o que a proxima reescrita pode desfazer sem nada ficar vermelho.
    const fonte = () => readFileSync(
        new URL('../../src/js/store/sync/remote-operation-handler.js', import.meta.url), 'utf8');

    const ativacao = () => {
        const src = fonte();
        const inicio = src.indexOf('export function applyRemoteSnapshot');
        const fim = src.indexOf('function mapaCorrenteMontado');
        expect(inicio, 'o trecho da ativacao do retrato nao foi encontrado').toBeGreaterThan(-1);
        expect(fim).toBeGreaterThan(inicio);
        return src.slice(inicio, fim);
    };

    it('troca o indice por `replaceAll`, e NAO por `clear()` mais um laco', () => {
        // `clear()` derruba `isInitialized` e nada o repunha: o indice ficava cheio e a marca
        // falsa pelo resto da sessao remota, o que desliga a via rapida de `getMap` e manda a
        // contagem de cores para uma chave por NOME.
        const trecho = ativacao();
        expect(trecho).toContain('mapResolver.replaceAll(');
        expect(trecho).not.toContain('mapResolver.clear()');
        expect(trecho).not.toMatch(/for \(const \[id, map\] of maps\) mapResolver\.registerMap/);
    });

    it('anuncia o mapa corrente DEPOIS de a pausa de escrita terminar', () => {
        // O assinante escreve (o ponteiro `lastActiveMap`, e uma troca de mapa inteira quando o
        // mapa sumiu). Emitir de dentro do `try` entregaria esse trabalho a uma janela em que
        // toda escrita do escopo esta' pausada.
        const trecho = ativacao();
        expect(trecho).toMatch(
            /pause\.resume\(\);[\s\S]{0,200}emit\(EventTypes\.CURRENT_MAP_STALE_REMOTELY/);
    });

    it('pergunta pelo mapa corrente ANTES de trocar o indice', () => {
        // O indice VELHO e' o unico que traduz o nome aberto no id que o retrato usa como chave.
        const trecho = ativacao();
        const pergunta = trecho.indexOf('mapaCorrenteMontado()');
        const troca = trecho.indexOf('mapResolver.replaceAll(');
        expect(pergunta).toBeGreaterThan(-1);
        expect(pergunta).toBeLessThan(troca);
    });
});

describe('G2 — o DELETE ao vivo do mapa ABERTO anuncia, porque a aba Mapas pode nem existir', () => {
    // O DEFEITO, medido em 2026-09-21 com duas browsers reais num par que so' desenhava: o unico
    // desvio para fora de um mapa excluido morava em `sidebar/tabs/maps.tab.js`
    // (o ramo de exclusao de `_onRemoteOperation`, removido no mesmo dia), e as abas da barra lateral sao
    // construidas SOB DEMANDA (`SidebarControl._getTabContent`). Quem nunca abriu "Mapas" nao tem
    // aquele assinante: depois de o dono excluir o mapa aberto, `currentMap` e `lastActiveMap`
    // continuavam no mapa morto, sem aviso nenhum, e toda feiçao desenhada era recusada
    // (`map_missing`). Quem reconcilia agora e' o store, que nao depende de tela nenhuma.
    beforeEach(() => {
        mapResolver.clear();
        memoryStore.layers = {};
        memoryStore.currentMap = null;
        mapDataStore.set('map-g2', { ...createTestMapData(), id: 'map-g2', name: 'Mapa Aberto' });
        mapResolver.registerMap('Mapa Aberto', 'map-g2');
    });

    const apagar = (entityId) => applyRemoteOperation({
        entityType: EntityType.MAP, operationType: OperationType.DELETE,
        entityId, mapId: null, data: null,
    });

    it('anuncia quando o mapa excluido E o que esta aba tem MONTADO', async () => {
        memoryStore.currentMap = 'Mapa Aberto';
        memoryStore.layers['Mapa Aberto'] = new Map();

        await apagar('map-g2');

        expect(eventBus.emit).toHaveBeenCalledWith(EventTypes.CURRENT_MAP_STALE_REMOTELY, {
            mapId: 'map-g2', oldName: 'Mapa Aberto', newName: null,
        });
    });

    it('NAO anuncia quando a pessoa esta em outro mapa', async () => {
        memoryStore.currentMap = 'Outro Mapa';
        memoryStore.layers['Outro Mapa'] = new Map();

        await apagar('map-g2');

        expect(eventBus.emit).not.toHaveBeenCalledWith(
            EventTypes.CURRENT_MAP_STALE_REMOTELY, expect.anything());
    });

    it('NAO anuncia quando o nome bate mas nenhum mapa esta montado', async () => {
        // A mesma guarda do retrato, e pela mesma razao: `memoryStore.currentMap` carrega o nome
        // do mapa local padrao logo depois de um `resetMemoryStore`, e um atlas de servidor pode
        // ter um mapa com aquele nome. Sem mapa montado, esta aba nao estava vendo nada.
        memoryStore.currentMap = 'Mapa Aberto';
        memoryStore.layers = {};

        await apagar('map-g2');

        expect(eventBus.emit).not.toHaveBeenCalledWith(
            EventTypes.CURRENT_MAP_STALE_REMOTELY, expect.anything());
    });

    it('o DELETE de um mapa que o indice nao conhece nao anuncia nada', async () => {
        // `getNameForId` devolve `undefined`, e comparar `undefined` com o nome montado tem de dar
        // falso: um anuncio com `oldName` errado tiraria a pessoa de um mapa vivo.
        memoryStore.currentMap = 'Mapa Aberto';
        memoryStore.layers['Mapa Aberto'] = new Map();

        await apagar('map-desconhecido');

        expect(eventBus.emit).not.toHaveBeenCalledWith(
            EventTypes.CURRENT_MAP_STALE_REMOTELY, expect.anything());
    });
});

/**
 * Regression: concurrent store writes lost all but one.
 *
 * Root cause: every store write is a read-modify-write of the WHOLE map document
 * (`getMapDataCompat` -> mutate -> `updateMapDataCompat`), and nothing serialized it.
 * IndexedDB hands each reader its own structured clone, so two overlapping writers read
 * the same snapshot and the second save overwrites the first: last-write-wins over the
 * entire document. Measured before the fix: 20 concurrent `addFeature` calls persisted 1.
 *
 * `runTransaction` never covered this. It orders persistence before side effects; it does
 * not order writers. The serialization lives in `store/document-lock.js`.
 *
 * The repository fake below is the point of the test: it CLONES on read and on write, the
 * way IndexedDB does. A fake that hands out the same object reference makes every writer
 * mutate one shared document and the bug disappears — a green that proves nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Hoisted shared state
// ============================================================================

const h = vi.hoisted(() => ({
    /** @type {Map<string, string>} map key -> serialized document */
    docs: new Map(),
    reads: 0,
    writes: 0,
    /** Hook: awaited at the start of every read, receives the 1-based read number. */
    beforeRead: null,
    /** Microtask hops each read/write takes, so an unserialized interleaving is forced. */
    readHops: 1,
    writeHops: 2,
    mapManager: {
        getCurrentMapName: vi.fn(() => 'TestMap'),
        getCurrentMapId: vi.fn(() => 'map-uuid-123'),
        getMapId: vi.fn(() => 'map-uuid-123'),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn()
    },
    config: {
        map2d: { hillshade: { enabled: false } },
        analysisLayers: { enabled: false, layers: [] },
        dataLayers: { enabled: false, layers: [] },
        tilesets: []
    }
}));

/** One microtask hop. */
const tick = async (n = 1) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../src/js/store/repositories/index.js', () => ({
    // Structured clone in BOTH directions, exactly like IndexedDB: the caller mutates a
    // private copy, and only its save decides what the next reader sees.
    getMapDataCompat: vi.fn(async (mapName) => {
        const n = ++h.reads;
        if (h.beforeRead) await h.beforeRead(n);
        await tick(h.readHops);
        const raw = h.docs.get(mapName);
        return raw ? JSON.parse(raw) : getEmptyMapData();
    }),
    updateMapDataCompat: vi.fn(async (mapName, data) => {
        await tick(h.writeHops);
        h.writes += 1;
        h.docs.set(mapName, JSON.stringify(data));
    }),
    getLayersCompat: vi.fn(async () => [])
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_SYNC_ERROR: 'store:syncError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked'
    },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/store/store-origin.js', () => ({
    StoreOriginKind: { LOCAL: 'local', REMOTE: 'remote' },
    isRemoteStoreSync: vi.fn(() => false),
    getStoreOriginSync: vi.fn(() => ({ kind: 'local', atlasId: null })),
    loadStoreOrigin: vi.fn(async () => ({ kind: 'local', atlasId: null })),
    setStoreOrigin: vi.fn(async () => {}),
    markStoreRemote: vi.fn(async () => {}),
    markStoreLocal: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false)
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn().mockResolvedValue(undefined),
    logCatalogLayerOperation: vi.fn(),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: h.mapManager }));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: { lockedMaps: new Set(), currentMap: 'TestMap' }
}));

vi.mock('../../src/js/config.js', () => ({ default: h.config }));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    addFeature,
    updateFeatureProperty,
    removeFeature,
    moveFeaturesToMap,
    setFeatureDependencies
} from '../../src/js/store/feature.operations.js';
import { addCatalogLayer, toggleCatalogLayerVisibility } from '../../src/js/store/catalog.operations.js';
import {
    withDocumentLock,
    mapDocumentKey,
    getDocumentLockStats,
    resetDocumentLocks
} from '../../src/js/store/document-lock.js';

// ============================================================================
// Helpers
// ============================================================================

const MAP = 'TestMap';

function makeFeature(id) {
    return {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id, source: 'point', nome: `Ponto ${id}`, layerId: 'default' }
    };
}

/** Features of one storage type currently persisted. */
function persisted(type = 'points') {
    const raw = h.docs.get(MAP);
    if (!raw) return [];
    return JSON.parse(raw).features[type] || [];
}

function seedEmptyMap() {
    h.docs.set(MAP, JSON.stringify(getEmptyMapData()));
}

beforeEach(() => {
    h.docs.clear();
    h.reads = 0;
    h.writes = 0;
    h.beforeRead = null;
    h.readHops = 1;
    h.writeHops = 2;
    resetDocumentLocks();
    seedEmptyMap();
});

afterEach(() => {
    h.beforeRead = null;
});

// ============================================================================
// The defect, made deterministic
// ============================================================================

describe('escrita concorrente no documento do mapa', () => {
    it('bloqueia o segundo escritor ANTES da leitura dele (interleaving perdedor, determinístico)', async () => {
        // The losing interleaving is exactly "B reads before A writes". Hold A inside its
        // read and check whether B managed to read: no statistics, no timing, one bit.
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        h.beforeRead = async (n) => { if (n === 1) await gate; };

        const a = addFeature('points', makeFeature('feat-A'));
        const b = addFeature('points', makeFeature('feat-B'));

        // Give every runnable continuation a generous number of hops to run.
        await tick(50);

        // Without serialization B has already taken its (stale) read here: reads === 2.
        expect(h.reads).toBe(1);
        expect(getDocumentLockStats().busy).toEqual([`${mapDocumentKey(MAP)}:addFeature`]);

        release();
        await Promise.all([a, b]);

        expect(persisted().map((f) => f.properties.id)).toEqual(['feat-A', 'feat-B']);
        expect(h.reads).toBe(2);
        expect(h.writes).toBe(2);
    });

    it('20 addFeature concorrentes persistem 20', async () => {
        await Promise.all(
            Array.from({ length: 20 }, (_, i) => addFeature('points', makeFeature(`feat-${i}`)))
        );

        const ids = persisted().map((f) => f.properties.id);
        expect(ids).toHaveLength(20);
        expect(new Set(ids).size).toBe(20);
    });

    it('20 addFeature concorrentes persistem 20 em TODAS as 20 execuções em série', async () => {
        // A race passes in a fraction of the runs, so a single green is indistinguishable
        // from the deterministic case. Measured before the fix: 0/20 runs correct (1 of 20
        // features survived each time). Report the rate, do not trust one sample.
        const RUNS = 20;
        const correct = [];

        for (let run = 0; run < RUNS; run++) {
            h.docs.clear();
            h.reads = 0;
            h.writes = 0;
            resetDocumentLocks();
            seedEmptyMap();

            await Promise.all(
                Array.from({ length: 20 }, (_, i) => addFeature('points', makeFeature(`r${run}-f${i}`)))
            );
            correct.push(persisted().length);
        }

        expect(correct).toEqual(Array(RUNS).fill(20));
    });

    it('mistura de operações concorrentes (add + update + remove) não perde nenhuma', async () => {
        await addFeature('points', makeFeature('base-1'));
        await addFeature('points', makeFeature('base-2'));

        await Promise.all([
            addFeature('points', makeFeature('novo')),
            updateFeatureProperty('points', 'base-1', 'nome', 'renomeado'),
            removeFeature('points', 'base-2')
        ]);

        const ids = persisted().map((f) => f.properties.id);
        expect(ids.sort()).toEqual(['base-1', 'novo']);
        expect(persisted().find((f) => f.properties.id === 'base-1').properties.nome).toBe('renomeado');
    });

    it('escritores de MÓDULOS diferentes no mesmo documento se excluem (feição x camada de catálogo)', async () => {
        // catalogLayers lives inside the same map document as features, so a catalog write
        // and a feature write are rivals. They only exclude each other if both modules
        // derive the SAME lock key.
        await Promise.all([
            addFeature('points', makeFeature('feat-1')),
            addCatalogLayer({ id: 'cat-1', type: 'hillshade', name: 'Relevo', visible: true, opacity: 1 }),
            addFeature('points', makeFeature('feat-2'))
        ]);

        const doc = JSON.parse(h.docs.get(MAP));
        expect(doc.features.points.map((f) => f.properties.id)).toEqual(['feat-1', 'feat-2']);
        expect(doc.catalogLayers.map((l) => l.id)).toEqual(['cat-1']);
    });

    it('mapas diferentes não esperam um pelo outro', async () => {
        // Serialization is per document. A second map must not be blocked by the first, or
        // the fix would trade a data bug for a throughput bug.
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        h.beforeRead = async (n) => { if (n === 1) await gate; };

        const slow = addFeature('points', makeFeature('no-mapa-lento'), MAP);
        const fast = addFeature('points', makeFeature('no-outro-mapa'), 'OutroMapa');

        await fast; // resolves while `slow` is still parked inside its read
        expect(JSON.parse(h.docs.get('OutroMapa')).features.points).toHaveLength(1);

        release();
        await slow;
        expect(persisted()).toHaveLength(1);
    });
});

// ============================================================================
// Deadlock guards: composites that AWAIT a locked leaf must not take the lock
// ============================================================================

describe('composta que aguarda uma operação travada não pode se travar também', () => {
    // These are alarms, not behaviour tests. The queue has no reentrancy, so a composite
    // that took the same key would wait for itself: each of these stops passing and starts
    // TIMING OUT. Verified by construction on the sync side (nesting the drain inside the
    // locked span hung the guard in remote-map-op.test.js).

    it('moveFeaturesToMap conclui (chama addFeatureToMap + removeFeatureFromMap, ambas travadas)', async () => {
        setFeatureDependencies({
            eventBus: null,
            layerManager: null,
            groupManager: { removeFeatureFromAllGroups: vi.fn() }
        });
        h.docs.set('OutroMapa', JSON.stringify(getEmptyMapData()));
        const feature = makeFeature('viajante');
        await addFeature('points', feature);

        await moveFeaturesToMap([JSON.parse(JSON.stringify(feature))], 'OutroMapa');

        expect(persisted()).toHaveLength(0);
        expect(JSON.parse(h.docs.get('OutroMapa')).features.points).toHaveLength(1);
    });

    it('toggleCatalogLayerVisibility conclui (chama updateCatalogLayer, travada)', async () => {
        await addCatalogLayer({ id: 'cat-1', type: 'hillshade', name: 'Relevo', visible: true, opacity: 1 });

        await toggleCatalogLayerVisibility('cat-1', false);

        expect(JSON.parse(h.docs.get(MAP)).catalogLayers[0].visible).toBe(false);
    });
});

// ============================================================================
// The primitive
// ============================================================================

describe('document-lock', () => {
    beforeEach(() => resetDocumentLocks());

    it('roda as seções da mesma chave em ordem FIFO, uma de cada vez', async () => {
        const order = [];
        const section = (name, hops) => async () => {
            order.push(`${name}:inicio`);
            await tick(hops);
            order.push(`${name}:fim`);
        };

        await Promise.all([
            withDocumentLock('doc', 'a', section('a', 5)),
            withDocumentLock('doc', 'b', section('b', 1)),
            withDocumentLock('doc', 'c', section('c', 3))
        ]);

        expect(order).toEqual([
            'a:inicio', 'a:fim',
            'b:inicio', 'b:fim',
            'c:inicio', 'c:fim'
        ]);
    });

    it('uma seção que lança libera a chave, e o erro fica com o chamador dela', async () => {
        const boom = withDocumentLock('doc', 'quebra', async () => {
            throw new Error('persistência falhou');
        });
        const after = withDocumentLock('doc', 'depois', async () => 'passou');

        await expect(boom).rejects.toThrow('persistência falhou');
        await expect(after).resolves.toBe('passou');
        expect(getDocumentLockStats().keys).toBe(0);
    });

    it('libera a chave quando a fila esvazia (sem vazamento de entradas)', async () => {
        await Promise.all([
            withDocumentLock('doc-1', 'x', async () => tick(2)),
            withDocumentLock('doc-2', 'y', async () => tick(1))
        ]);
        await tick(3);
        expect(getDocumentLockStats()).toEqual({ keys: 0, busy: [] });
    });

    it('devolve o valor da seção e propaga argumento inválido como bug do chamador', () => {
        expect(() => withDocumentLock('doc', 'sem-funcao', null)).toThrow(/critical-section/);
    });

    it('aninhar na MESMA chave TRAVA, inclusive quando o aninhamento é síncrono', async () => {
        // This asserts the failure mode ON PURPOSE. The rule "only leaf operations take the
        // lock" is only enforceable if breaking it fails the same way every time, and the
        // first version of this module derived its tail from the running promise: a section
        // that acquired the key synchronously inside another (before the outer's first
        // await) found the tail unset and ran straight through. Nesting then deadlocked or
        // silently overlapped depending on where the outer's first await sat, and the
        // composite guards above were passing without proving anything.
        let innerRan = false;
        const outer = withDocumentLock('trava', 'externa', async () => {
            await withDocumentLock('trava', 'interna', () => { innerRan = true; });
        });

        const outcome = await Promise.race([
            outer.then(() => 'saiu'),
            new Promise((resolve) => setTimeout(() => resolve('travou'), 20))
        ]);

        expect(outcome).toBe('travou');
        expect(innerRan).toBe(false);
        resetDocumentLocks(); // the wedged section is deliberate; drop the queue for the next test
    });
});

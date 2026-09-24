// Path: tests/store/gesto-local-em-massa-um-documento.repro.test.js

/**
 * @fileoverview A LOCAL gesture over N features costs ONE read and ONE write of the map document,
 * not N of each.
 *
 * Every feature of a map lives in one document, so `removeFeature` and `updateFeature` are each a
 * read-modify-write of the WHOLE map, and the controls called them once per selected feature.
 * Measured on 2026-09-24 with two browsers and the real backend, on a 1 000-point map: deleting
 * 1 000 took 19 s of the author's gesture, restyling them 28.6 s, redoing the deletion 41 s and
 * undoing the restyle 16 s, all spent re-reading and re-writing the same document.
 *
 * What this file pins is the COUNT, which is the cause, and it is deterministic: reads of the
 * document (`getExistingMapData`, `getMapDataCompat`), writes of it (`updateMapDataCompat`) and
 * write-ahead transactions (`persistOperationIntents`, one call per transaction). The first case of
 * each block is the negative control, kept on purpose: the loop of the single operation still
 * costs N of each, which is the "before" the plural one is measured against.
 *
 * Beyond the count, what must not fall with the batch: the gate (role and map lock), the analysis
 * output leaving with its input (and re-derived from a written input), the group memberships through
 * the transaction's overlay with the groups document written once, the color counts, one undo entry
 * per feature, and the operation of each feature with the stored feature as `previousData`, in the
 * order of the call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

const { mockMapData, mockMapManager, mockLockedMaps, transacoes } = vi.hoisted(() => ({
    mockMapData: { value: null },
    /** One entry per `persistOperationIntents` call, i.e. per write-ahead transaction. */
    transacoes: { value: [] },
    mockMapManager: {
        getCurrentMapName: vi.fn(() => 'TestMap'),
        getCurrentMapId: vi.fn(() => 'map-uuid-123'),
        getMapId: vi.fn(() => 'map-uuid-123'),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn()
    },
    mockLockedMaps: { value: new Set() }
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
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
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

// The document is handed back as the SAME object, so a read costs nothing here: the count is the
// measure, not the time. In the browser each read and each write is a structured clone of it.
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async () => mockMapData.value),
    getExistingMapData: vi.fn(async () => mockMapData.value ?? null),
    updateMapDataCompat: vi.fn(async (mapName, data) => { mockMapData.value = data; }),
    getLayersCompat: vi.fn(async () => [])
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: mockMapManager }));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        set lockedMaps(v) { mockLockedMaps.value = v; },
        currentMap: 'TestMap'
    }
}));

vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    persistOperationIntents: async (operations) => {
        transacoes.value.push(operations.map(op => ({
            entityType: op.entityType,
            operationType: op.operationType,
            entityId: op.entityId,
            data: op.data,
            previousData: op.previousData,
            storage: op.storage,
        })));
    },
}));

import {
    removeFeature,
    updateFeature,
    removeFeatures,
    updateFeatures,
    setFeatureDependencies
} from '../../src/js/store/feature.operations.js';
import { getExistingMapData, getMapDataCompat, updateMapDataCompat } from '../../src/js/store/repositories/index.js';
import { isCurrentMapLockedSync } from '../../src/js/store/map.operations.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';
import { sessionContext, UserRole } from '../../src/js/store/sync/session-context.js';
import { isRemoteStoreSync } from '../../src/js/store/store-origin.js';
import { derivedOutputIdsOf } from '../../src/js/store/analysis-output.js';

const N = 1000;

function ponto(id, extra = {}) {
    return {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id, source: 'point', nome: `P ${id}`, color: '#ff0000', layerId: 'default', ...extra }
    };
}

function mapaComPontos(n) {
    const data = getEmptyMapData();
    data.features.points = Array.from({ length: n }, (_, i) => ponto(`p${i}`));
    return data;
}

/** A line of sight whose input is split at the obstruction, as the tool leaves it. */
function linhaDeVisada(id) {
    return {
        type: 'Feature',
        id,
        geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[1, 1], [2, 2]]] },
        properties: { id, source: 'los', nome: `LOS ${id}`, layerId: 'default' }
    };
}

function contagem() {
    return {
        leituras: getExistingMapData.mock.calls.length + getMapDataCompat.mock.calls.length,
        escritas: updateMapDataCompat.mock.calls.length,
        transacoes: transacoes.value.length,
    };
}

let groupManager;

beforeEach(() => {
    vi.clearAllMocks();
    mockMapData.value = mapaComPontos(N);
    mockMapManager.getCurrentMapName.mockReturnValue('TestMap');
    mockMapManager.getMapId.mockReturnValue('map-uuid-123');
    mockMapManager.getFeatureColor.mockImplementation(f => f?.properties?.color ?? null);
    mockMapManager.getFeatureColors.mockImplementation(f => (f?.properties?.color ? [f.properties.color] : []));
    isCurrentMapLockedSync.mockReturnValue(false);
    mockLockedMaps.value = new Set();
    transacoes.value = [];
    groupManager = { removeFeatureFromAllGroups: vi.fn(() => null) };
    setFeatureDependencies({ groupManager });
    sessionContext._reset();
    isRemoteStoreSync.mockReturnValue(false);
});

describe('excluir N feições', () => {
    it('CONTROLE NEGATIVO: o laço de removeFeature lê e grava o documento uma vez POR feição', async () => {
        for (let i = 0; i < N; i++) await removeFeature('points', `p${i}`);

        expect(contagem()).toEqual({ leituras: N, escritas: N, transacoes: N });
        expect(mockMapData.value.features.points).toHaveLength(0);
    });

    it('removeFeatures: UMA leitura, UMA escrita e UMA transação para as 1000', async () => {
        const refs = Array.from({ length: N }, (_, i) => ({ type: 'points', id: `p${N - 1 - i}` }));
        const antes = new Map(mockMapData.value.features.points.map(f => [f.properties.id, structuredClone(f)]));

        const removidas = await removeFeatures(refs);

        expect(removidas).toBe(N);
        expect(contagem()).toEqual({ leituras: 1, escritas: 1, transacoes: 1 });
        expect(mockMapData.value.features.points).toHaveLength(0);
        // The operations, in the order of the call, each with the whole stored feature.
        const [ops] = transacoes.value;
        expect(ops.map(op => op.entityId)).toEqual(refs.map(r => r.id));
        expect(ops.every(op => op.operationType === 'DELETE' && op.data === null && op.storage === 'points')).toBe(true);
        expect(ops[0].previousData).toEqual(antes.get(refs[0].id));
        // One undo entry per feature, as the single path records, for the caller's collector.
        expect(mockMapManager.recordAction).toHaveBeenCalledTimes(N);
        expect(mockMapManager.recordAction.mock.calls[0][0]).toMatchObject({
            type: 'removeWithProcessed', mainFeatureType: 'points', processedFeatures: null
        });
        expect(mockMapManager.recordAction.mock.calls[0][0].mainFeature.properties.id).toBe(refs[0].id);
        // The color counts go down once per color, as in the single path.
        expect(mockMapManager.updateColorUsage).toHaveBeenCalledTimes(N);
        expect(mockMapManager.updateColorUsage).toHaveBeenCalledWith('#ff0000', null, 'TestMap');
    });

    it('um id repetido ou ausente não conta nem grava a mais', async () => {
        const removidas = await removeFeatures([
            { type: 'points', id: 'p1' }, { type: 'points', id: 'p1' }, { type: 'points', id: 'nao-existe' }
        ]);

        expect(removidas).toBe(1);
        expect(transacoes.value).toHaveLength(1);
        expect(transacoes.value[0].map(op => op.entityId)).toEqual(['p1']);
        expect(mockMapData.value.features.points).toHaveLength(N - 1);
    });

    it('nada encontrado: nenhuma transação e nenhuma escrita', async () => {
        expect(await removeFeatures([{ type: 'points', id: 'nao-existe' }])).toBe(0);
        expect(contagem()).toEqual({ leituras: 1, escritas: 0, transacoes: 0 });
    });

    it('os grupos passam pelo overlay da MESMA transação e o documento de grupos é gravado uma vez', async () => {
        const gravacoes = [];
        const txs = new Set();
        groupManager.removeFeatureFromAllGroups.mockImplementation((tx, type, id) => {
            txs.add(tx);
            // The overlay makes every closure write the same accumulated document; the one kept
            // is the LAST non-null, and a null answer after it must not drop it.
            if (id === 'p3' || id === 'p5') return () => { gravacoes.push(id); };
            return null;
        });

        await removeFeatures([3, 4, 5, 6].map(i => ({ type: 'points', id: `p${i}` })));

        expect(groupManager.removeFeatureFromAllGroups).toHaveBeenCalledTimes(4);
        expect(groupManager.removeFeatureFromAllGroups.mock.calls.map(c => [c[1], c[2], c[3]])).toEqual([
            ['point', 'p3', 'TestMap'], ['point', 'p4', 'TestMap'], ['point', 'p5', 'TestMap'], ['point', 'p6', 'TestMap']
        ]);
        expect(txs.size).toBe(1);
        expect(gravacoes).toEqual(['p5']);
    });

    it('a saída da análise sai com a entrada, e a entrada desfeita guarda a saída que tinha', async () => {
        const [visivel, obstruida] = derivedOutputIdsOf('los1');
        mockMapData.value.features.los = [linhaDeVisada('los1')];
        mockMapData.value.features.processed_los = [
            { type: 'Feature', geometry: null, properties: { id: visivel, source: 'los' } },
            { type: 'Feature', geometry: null, properties: { id: obstruida, source: 'los' } },
            { type: 'Feature', geometry: null, properties: { id: 'outra-visible', source: 'los' } },
        ];

        await removeFeatures([{ type: 'los', id: 'los1' }, { type: 'points', id: 'p0' }]);

        expect(mockMapData.value.features.los).toHaveLength(0);
        expect(mockMapData.value.features.processed_los.map(f => f.properties.id)).toEqual(['outra-visible']);
        const entrada = mockMapManager.recordAction.mock.calls[0][0];
        expect(entrada.processedFeatures.type).toBe('processed_los');
        expect(entrada.processedFeatures.features.map(f => f.properties.id)).toEqual([visivel, obstruida]);
        // The output never travels: only the input's DELETE is recorded.
        expect(transacoes.value[0].map(op => op.entityId)).toEqual(['los1', 'p0']);
    });

    it('mapa travado: recusa uma vez, sem ler nem gravar', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        expect(await removeFeatures([{ type: 'points', id: 'p0' }, { type: 'points', id: 'p1' }])).toBe(0);

        expect(contagem()).toEqual({ leituras: 0, escritas: 0, transacoes: 0 });
        expect(emitStoreError).toHaveBeenCalledTimes(1);
        expect(emitStoreError).toHaveBeenCalledWith('store:operationBlocked',
            expect.objectContaining({ operation: 'removeFeatures', reason: 'map_locked' }));
    });

    it('posto sem exclusão (Leitor num atlas de servidor): recusa uma vez, sem gravar', async () => {
        isRemoteStoreSync.mockReturnValue(true);
        sessionContext.setSession({ userId: 'leitor', role: UserRole.VIEWER });

        expect(await removeFeatures([{ type: 'points', id: 'p0' }])).toBe(0);

        expect(contagem().escritas).toBe(0);
        expect(emitStoreError).toHaveBeenCalledWith('store:operationBlocked',
            expect.objectContaining({ operation: 'removeFeatures' }));
    });
});

describe('estilo em N feições', () => {
    const verde = f => ({ ...f, properties: { ...f.properties, color: '#00aa00' } });

    it('CONTROLE NEGATIVO: o laço de updateFeature lê e grava o documento uma vez POR feição', async () => {
        const pontos = structuredClone(mockMapData.value.features.points);
        for (const f of pontos) await updateFeature('points', verde(f));

        expect(contagem()).toEqual({ leituras: N, escritas: N, transacoes: N });
    });

    it('updateFeatures: UMA leitura, UMA escrita e UMA transação para as 1000', async () => {
        const pontos = structuredClone(mockMapData.value.features.points);

        const gravadas = await updateFeatures(pontos.map(f => ({ type: 'points', feature: verde(f) })));

        expect(gravadas).toBe(N);
        expect(contagem()).toEqual({ leituras: 1, escritas: 1, transacoes: 1 });
        expect(mockMapData.value.features.points.every(f => f.properties.color === '#00aa00')).toBe(true);
        const [ops] = transacoes.value;
        expect(ops.map(op => op.entityId)).toEqual(pontos.map(f => f.properties.id));
        expect(ops[0]).toMatchObject({ operationType: 'UPDATE', storage: 'points' });
        expect(ops[0].previousData.properties.color).toBe('#ff0000');
        expect(ops[0].data.properties.color).toBe('#00aa00');
        // The same timestamp bump as the single path.
        expect(ops[0].data.properties.version).toBe((pontos[0].properties.version ?? 0) + 1);
        expect(mockMapManager.recordAction).toHaveBeenCalledTimes(N);
        expect(mockMapManager.recordAction.mock.calls[0][0]).toMatchObject({ type: 'update', featureType: 'points' });
        expect(mockMapManager.updateColorUsage).toHaveBeenCalledTimes(N);
        expect(mockMapManager.updateColorUsage).toHaveBeenCalledWith('#ff0000', '#00aa00', 'TestMap');
    });

    it('item sem mudança e id ausente não viram operação; dois itens da MESMA feição se compõem', async () => {
        const [a, b] = structuredClone(mockMapData.value.features.points);

        const gravadas = await updateFeatures([
            { type: 'points', feature: a },                                     // unchanged
            { type: 'points', feature: ponto('nao-existe') },                   // absent
            { type: 'points', feature: { ...b, properties: { ...b.properties, nome: 'um' } } },
            { type: 'points', feature: { ...b, properties: { ...b.properties, color: '#0000ff' } } },
        ]);

        expect(gravadas).toBe(2);
        expect(transacoes.value[0].map(op => op.entityId)).toEqual([b.properties.id, b.properties.id]);
        // The second item read the feature as the first left it, as two calls would.
        expect(transacoes.value[0][1].previousData.properties.nome).toBe('um');
        const final = mockMapData.value.features.points.find(f => f.properties.id === b.properties.id);
        expect(final.properties.color).toBe('#0000ff');
    });

    it('revertFrom e preserveUserData valem por item, como em updateFeature', async () => {
        const alvo = mockMapData.value.features.points[0];
        alvo.properties.color = '#00aa00';
        alvo.properties.attributes = { chave: 'valor' };
        alvo.properties.nome = 'renomeado pelo colega';
        const editado = { ...ponto('p0'), properties: { ...ponto('p0').properties, color: '#00aa00' } };
        const anterior = ponto('p0');

        // An undo of "red -> green" that must keep the peer's later rename and the attributes.
        await updateFeatures([{ type: 'points', feature: anterior, options: { revertFrom: editado } }]);

        const final = mockMapData.value.features.points[0];
        expect(final.properties.color).toBe('#ff0000');
        expect(final.properties.nome).toBe('renomeado pelo colega');
        expect(final.properties.attributes).toEqual({ chave: 'valor' });
    });

    it('uma entrada de análise gravada re-deriva a saída no MESMO documento', async () => {
        mockMapData.value.features.los = [linhaDeVisada('los1')];
        mockMapData.value.features.processed_los = [];
        const nova = linhaDeVisada('los1');
        nova.geometry = { type: 'LineString', coordinates: [[0, 0], [3, 3]] };

        await updateFeatures([{ type: 'los', feature: nova }]);

        expect(contagem().escritas).toBe(1);
        expect(mockMapData.value.features.processed_los.map(f => f.properties.id)).toEqual(derivedOutputIdsOf('los1').slice(0, 1));
        expect(mockMapData.value.features.processed_los[0].geometry.coordinates).toEqual([[0, 0], [3, 3]]);
        expect(transacoes.value[0].map(op => op.entityId)).toEqual(['los1']);
    });

    it('mapa travado: recusa uma vez, sem ler nem gravar', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        expect(await updateFeatures([{ type: 'points', feature: verde(ponto('p0')) }])).toBe(0);

        expect(contagem()).toEqual({ leituras: 0, escritas: 0, transacoes: 0 });
        expect(emitStoreError).toHaveBeenCalledWith('store:operationBlocked',
            expect.objectContaining({ operation: 'updateFeatures', reason: 'map_locked' }));
    });
});

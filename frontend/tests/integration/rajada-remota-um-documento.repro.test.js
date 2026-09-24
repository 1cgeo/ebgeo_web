// Path: tests/integration/rajada-remota-um-documento.repro.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * @fileoverview Um quadro de criacoes remotas custa UMA leitura e UMA gravacao do documento do mapa.
 *
 * O DEFEITO. Toda op de feicao remota le e regrava o documento INTEIRO do mapa (todas as feicoes),
 * e o par aplicava o quadro do colega op a op. Medido em 2026-09-23 no Chromium: 22 ms por op num
 * mapa de ~250 feicoes, 88 ms com ~2 500, 217 ms com ~5 250; 500 criacoes num mapa de 5 000 pontos
 * levaram 109 s para convergir no par. `applyRemoteOperations` aplica as criacoes consecutivas do
 * mesmo mapa com uma ida ao documento.
 *
 * O QUE ESTE ARQUIVO PRENDE, alem da contagem: o contrato de cada op continua o do caminho unico.
 * Toda op ganha o seu evento, a sua versao registrada e o seu `REMOTE_OPERATION_APPLIED`; e a op
 * que precisa de um ramo especial (edicao local pendente, versao mais velha, mapa que nao chegou,
 * eco do proprio autor, outra entidade) devolve o quadro ao caminho de uma em uma SEM que nada
 * tenha sido gravado pelo lote.
 */

const mapDataStore = new Map();
const calls = { getMap: 0, saveMap: 0 };

vi.mock('localforage', () => {
    const mockStore = new Map();
    return {
        default: {
            createInstance: () => ({
                setItem: vi.fn(async (key, value) => { mockStore.set(key, value); }),
                getItem: vi.fn(async (key) => mockStore.get(key) || null),
                removeItem: vi.fn(async (key) => { mockStore.delete(key); }),
                keys: vi.fn(async () => [...mockStore.keys()]),
            }),
        },
    };
});

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => `uuid-${Date.now()}`),
    isValidUUID: vi.fn(() => true),
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_SYNC_ERROR: 'store:syncError' },
    emitStoreError: vi.fn(),
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: vi.fn(() => ({
        getMap: vi.fn(async (mapId) => {
            calls.getMap += 1;
            const stored = mapDataStore.get(mapId);
            return stored ? structuredClone(stored) : null;
        }),
        saveMap: vi.fn(async (mapId, data) => {
            calls.saveMap += 1;
            mapDataStore.set(mapId, structuredClone(data));
        }),
    })),
}));

vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: {},
}));

import {
    applyRemoteOperation,
    applyRemoteOperations,
    setRemoteHandlerEventBus,
    markLocalEditPending,
    reconcilePendingLocalEdits,
    resolveLocalEdits,
} from '../../src/js/store/sync/remote-operation-handler.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { EventTypes } from '../../src/js/events/event_types.js';

let eventBus;
let version = 1000;

const emitted = (type) => eventBus.emit.mock.calls.filter(([t]) => t === type);

function emptyMap(id) {
    return { id, name: id, features: { points: [], lines: [], polygons: [] } };
}

/**
 * @param {string} id
 * @param {Object} [extra]
 * @returns {Object} A peer's feature CREATE.
 */
function create(id, extra = {}) {
    version += 1;
    return {
        id: `op-${id}`,
        entityType: EntityType.FEATURE,
        operationType: OperationType.CREATE,
        entityId: id,
        mapId: 'map-1',
        serverVersion: version,
        data: {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { id, source: 'point', nome: id },
        },
        ...extra,
    };
}

beforeEach(() => {
    mapDataStore.clear();
    calls.getMap = 0;
    calls.saveMap = 0;
    eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    setRemoteHandlerEventBus(eventBus);
    mapDataStore.set('map-1', emptyMap('map-1'));
});

describe('applyRemoteOperations: criacoes do mesmo quadro', () => {
    it('25 criacoes custam UMA leitura e UMA gravacao, e cada op tem o seu contrato', async () => {
        const frame = Array.from({ length: 25 }, (_, i) => create(`f${i}-${version}`));
        expect(await applyRemoteOperations(frame)).toBe(true);

        expect(calls).toEqual({ getMap: 1, saveMap: 1 });
        const stored = mapDataStore.get('map-1').features.points.map((f) => f.properties.id);
        expect(stored).toEqual(frame.map((op) => op.entityId));
        expect(emitted(EventTypes.FEATURE_CREATED)).toHaveLength(25);
        expect(emitted(EventTypes.REMOTE_OPERATION_APPLIED).map(([, p]) => p.operation.id))
            .toEqual(frame.map((op) => op.id));
    });

    it('a versao registrada pelo lote barra a op mais velha depois dele, como no caminho unico', async () => {
        const [a, b] = [create('va'), create('vb')];
        await applyRemoteOperations([a, b]);
        const velha = { ...a, id: 'op-velha', operationType: OperationType.UPDATE, serverVersion: a.serverVersion - 500,
            data: { ...a.data, properties: { ...a.data.properties, nome: 'velha' } } };
        await applyRemoteOperation(velha);
        expect(mapDataStore.get('map-1').features.points.find((f) => f.properties.id === 'va').properties.nome).toBe('va');
    });

    it('um eco repetido no mesmo mapa substitui por id, nao duplica', async () => {
        const [a, b] = [create('ea'), create('eb')];
        await applyRemoteOperations([a, b]);
        await applyRemoteOperations([{ ...a, serverVersion: version + 1 }, { ...b, serverVersion: version + 2 }]);
        expect(mapDataStore.get('map-1').features.points).toHaveLength(2);
    });

    it('edicao local pendente num membro: o quadro volta ao caminho unico, e o membro espera', async () => {
        const frame = [create('p1'), create('p2'), create('p3')];
        markLocalEditPending('p2');
        // Como o motor chama: `waitForDeferred` segura o quadro atras da op adiada.
        const aplicando = applyRemoteOperations(frame, { waitForDeferred: true });
        const ids = () => (mapDataStore.get('map-1').features.points ?? []).map((f) => f.properties.id);
        await vi.waitFor(() => expect(ids()).toEqual(['p1']));
        await reconcilePendingLocalEdits(new Set());
        expect(await aplicando).toBe(true);
        expect(ids()).toEqual(['p1', 'p2', 'p3']);
        // Caminho unico: uma ida ao documento por op, nenhuma pelo lote.
        expect(calls.saveMap).toBe(3);
    });

    it('mapa que ainda nao chegou: nada e gravado pelo lote, e a primeira op responde como no caminho unico', async () => {
        const frame = [create('m1', { mapId: 'map-9' }), create('m2', { mapId: 'map-9' })];
        const sozinha = await applyRemoteOperation(create('m0', { mapId: 'map-8' }));
        expect(await applyRemoteOperations(frame)).toBe(sozinha);
        expect(calls.saveMap).toBe(0);
        expect(mapDataStore.has('map-9')).toBe(false);
    });

    it('um quadro misto quebra em corridas: criacao, atualizacao e criacao de novo', async () => {
        const [a, b] = [create('x1'), create('x2')];
        version += 1;
        const update = { ...a, id: 'op-upd', operationType: OperationType.UPDATE, serverVersion: version,
            data: { ...a.data, properties: { ...a.data.properties, nome: 'renomeada' } } };
        const [c, d] = [create('x3'), create('x4')];
        await applyRemoteOperations([a, b, update, c, d]);
        const points = mapDataStore.get('map-1').features.points;
        expect(points.map((f) => f.properties.id)).toEqual(['x1', 'x2', 'x3', 'x4']);
        expect(points[0].properties.nome).toBe('renomeada');
        // Duas corridas de criacao (uma gravacao cada) mais a atualizacao sozinha.
        expect(calls.saveMap).toBe(3);
        expect(emitted(EventTypes.REMOTE_OPERATION_APPLIED).map(([, p]) => p.operation.id))
            .toEqual(['op-x1', 'op-x2', 'op-upd', 'op-x3', 'op-x4']);
    });

    // B6.1 (2026-09-24): o eco do proprio autor e a MUDANCA de mapa entram na corrida. O autor
    // recebe de volta cada op que enviou (e repara pelo recibo), e uma camada de mil feicoes movida
    // para outro mapa sao mil criacoes com `previousMapId`: pagas uma a uma, uma importacao de 5 000
    // drenava a 4 ops/s no autor.
    it('os recibos de um push reparam o autor numa escrita so (resolveLocalEdits)', async () => {
        const ops = Array.from({ length: 50 }, (_, i) => create(`ack${i}`));
        for (const op of ops) markLocalEditPending(op.entityId);
        await resolveLocalEdits(ops.map((op) => ({ entityId: op.entityId, serverVersion: op.serverVersion, localOp: op })));
        expect(calls.saveMap).toBe(1);
        expect(mapDataStore.get('map-1').features.points).toHaveLength(50);
        // O freio de convergencia soltou: uma op remota nova dessas feicoes aplica direto.
        const depois = { ...ops[0], id: 'op-depois', operationType: OperationType.UPDATE, serverVersion: version + 100,
            data: { ...ops[0].data, properties: { ...ops[0].data.properties, nome: 'depois' } } };
        await applyRemoteOperation(depois);
        expect(mapDataStore.get('map-1').features.points[0].properties.nome).toBe('depois');
    });

    it('o eco do proprio autor entra na corrida: uma escrita, sem aviso de sobrescrita', async () => {
        const eco = [create('r1', { localRepair: true, authorUserId: 'eu' }), create('r2', { localRepair: true, authorUserId: 'eu' })];
        await applyRemoteOperations(eco);
        expect(calls.saveMap).toBe(1);
        expect(emitted(EventTypes.REMOTE_EDIT_OVERWRITTEN)).toHaveLength(0);
        expect(mapDataStore.get('map-1').features.points.map((f) => f.properties.id)).toEqual(['r1', 'r2']);
    });

    it('uma corrida de mudancas do mesmo mapa de origem: uma escrita na origem, uma no destino', async () => {
        const origem = emptyMap('map-0');
        origem.features.points.push(...['mv1', 'mv2', 'fica'].map((id) => ({ type: 'Feature', properties: { id, source: 'point' } })));
        mapDataStore.set('map-0', origem);
        const movidas = [create('mv1'), create('mv2')].map((op) => ({ ...op, data: { ...op.data, previousMapId: 'map-0' } }));
        await applyRemoteOperations(movidas);
        expect(calls.saveMap).toBe(2);
        expect(mapDataStore.get('map-0').features.points.map((f) => f.properties.id)).toEqual(['fica']);
        expect(mapDataStore.get('map-1').features.points.map((f) => f.properties.id)).toEqual(['mv1', 'mv2']);
        expect(emitted(EventTypes.FEATURE_DELETED)).toHaveLength(2);
    });

    it('origens diferentes quebram a corrida', async () => {
        mapDataStore.set('map-0', emptyMap('map-0'));
        mapDataStore.set('map-9', emptyMap('map-9'));
        const [a, b] = [create('o1'), create('o2')];
        await applyRemoteOperations([
            { ...a, data: { ...a.data, previousMapId: 'map-0' } },
            { ...b, data: { ...b.data, previousMapId: 'map-9' } },
        ]);
        expect(mapDataStore.get('map-1').features.points.map((f) => f.properties.id)).toEqual(['o1', 'o2']);
    });

    it('uma visada dentro da rajada chega com a saida DERIVADA, como no caminho unico', async () => {
        // A camada da entrada (`los`) pinta com opacidade zero: sem as metades derivadas a visada
        // do colega fica invisivel. O caminho unico deriva em `replaceDerivedOutput`; a rajada
        // precisa fazer o mesmo, senao colar ou importar varias feicoes com uma visada no meio
        // entrega ao par uma analise que ninguem ve.
        const losId = '11111111-1111-4111-8111-111111111111';
        const visada = create(losId, {
            data: {
                type: 'Feature',
                geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[1, 1], [2, 2]]] },
                properties: { id: losId, source: 'los', nome: 'Linha de Visada #1', width: 5, opacity: 1 },
            },
        });
        expect(await applyRemoteOperations([create('antes'), visada, create('depois')])).toBe(true);

        expect(calls.saveMap).toBe(1);
        const doc = mapDataStore.get('map-1').features;
        expect(doc.los.map((f) => f.properties.id)).toEqual([losId]);
        expect((doc.processed_los ?? []).map((f) => f.properties?.id ?? f.id).sort())
            .toEqual([`${losId}-obstructed`, `${losId}-visible`]);
    });

    it('a falha de gravacao sobe, como no caminho unico', async () => {
        const { getRepository } = await import('../../src/js/store/repositories/index.js');
        getRepository.mockImplementationOnce(() => ({
            getMap: async (id) => structuredClone(mapDataStore.get(id)),
            saveMap: async () => { throw new Error('quota'); },
        }));
        await expect(applyRemoteOperations([create('q1'), create('q2')])).rejects.toThrow('quota');
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression: group sync ops must be tagged with the map's UUID, NOT its name.
 *
 * A group op logged with a non-UUID map id is rejected by the backend and POISONS the
 * client's whole flush batch — every op queued after it (renames, new features, …) never
 * reaches peers, so creating a group while online silently broke ALL further sync for
 * that client. (Same flush-poison class as the feature/layer/temporal map-id bugs.) This
 * pins that group_manager resolves the map NAME → UUID before logging the op.
 *
 * Only the seams are mocked (store barrel, the op logger, the resolver); the REAL
 * GroupManager runs.
 */

const MAP_NAME = 'Mapa Tático';
const MAP_UUID = '4a22f7df-df6d-47df-80bb-f26df86d31ec';

// Hoisted so the (hoisted) vi.mock factories can reference these without a TDZ error.
const h = vi.hoisted(() => ({
    memoryStore: { currentMap: 'Mapa Tático', groups: {} },
    logGroupOperation: vi.fn(),
    logGroupFeatureOperation: vi.fn(),
    resolveToId: vi.fn(),
}));

// The store barrel: GroupManager only needs these three.
vi.mock('../../src/js/store/index.js', () => ({
    memoryStore: h.memoryStore,
    setMapGroups: vi.fn(),
    getMapGroupsFromDB: vi.fn(async () => ({})),
}));

// Capture every logged group op.
vi.mock('../../src/js/store/sync/index.js', () => ({
    logGroupOperation: h.logGroupOperation,
    logGroupFeatureOperation: h.logGroupFeatureOperation,
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' },
}));

// The resolver under test: a real atlas map NAME → its UUID; anything else passes through.
// `getIdForName` entrou junto com a trava de documento: `sideDocumentKey` a usa para dobrar
// nome e UUID na MESMA chave, e um duplo sem ela quebra com TypeError na primeira escrita.
vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: { resolveToId: h.resolveToId, getIdForName: h.resolveToId },
}));
// As TRÊS entradas migradas em 2026-09-13 (bloco B4) declaram a intenção por
// `tx.recordOperation` DENTRO de `runTransaction`, e o diário vai ao disco ANTES do documento
// de grupos. Este espelho traduz a descrição durável de volta para a chamada de logger que as
// asserções deste arquivo já cobriam, nos DOIS alvos: `group` e `group_feature`, este último com
// a assinatura de `logGroupFeatureOperation` (o id da op é descartável e não entra nela, porque o
// que ela nomeia é o par grupo/feição). Um alvo que não seja nenhum dos dois ESTOURA de
// propósito: espelho calado é o que transforma um alvo novo em cobertura vazia. As entradas
// ainda no caminho antigo (`combineGroups`, `removeFeatureFromAllGroups`) continuam chamando o
// logger direto, então as duas metades convivem aqui.
vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    persistOperationIntents: vi.fn(async (descriptions) => {
        for (const op of descriptions) {
            if (op.entityType === 'group') {
                const args = [op.operationType, op.entityId, op.mapId, op.data];
                if (op.previousData != null) args.push(op.previousData);
                h.logGroupOperation(...args);
                continue;
            }
            if (op.entityType === 'group_feature') {
                h.logGroupFeatureOperation(
                    op.operationType, op.data.group_id, op.data.feature_id,
                    op.data.feature_type, op.mapId,
                );
                continue;
            }
            throw new Error(`Alvo nao classificado: ${op.entityType}`);
        }
        return async () => {};
    })
}));


import { createGroupManager } from '../../src/js/tool_manager/group_manager.js';

const pt = (id) => ({ properties: { id, source: 'point' } });

let gm;
beforeEach(() => {
    vi.clearAllMocks();
    h.resolveToId.mockImplementation((n) => (n === MAP_NAME ? MAP_UUID : n));
    h.memoryStore.currentMap = MAP_NAME;
    h.memoryStore.groups = {};
    gm = createGroupManager({ emit: vi.fn() });
});

describe('group_manager — sync ops carry the map UUID (flush-poison guard)', () => {
    it('createGroup logs the op with the map UUID as mapId, not the name', async () => {
        const group = await gm.createGroup([pt('f1'), pt('f2')], MAP_NAME);

        expect(h.logGroupOperation).toHaveBeenCalledTimes(1);
        const [opType, groupId, mapId, data] = h.logGroupOperation.mock.calls[0];
        expect(opType).toBe('create');
        expect(groupId).toBe(group.id);
        // The defining assertion: mapId is the resolved UUID, never the raw name.
        expect(mapId).toBe(MAP_UUID);
        expect(mapId).not.toBe(MAP_NAME);
        expect(data.features).toHaveLength(2);

        // A MEMBRESIA carrega o MESMO UUID de mapa, e é ela que o servidor usa para remontar
        // `group.features`: o `group` update nunca toca a tabela de junção, então uma membresia
        // carimbada com o NOME seria descartada antes do envio e o grupo chegaria vazio ao par.
        expect(h.logGroupFeatureOperation).toHaveBeenCalledTimes(2);
        for (const [opType, groupId2, , , mapId2] of h.logGroupFeatureOperation.mock.calls) {
            expect(opType).toBe('create');
            expect(groupId2).toBe(group.id);
            expect(mapId2).toBe(MAP_UUID);
        }
    });

    it('createGroup with mapName=null resolves the CURRENT map name to a UUID', async () => {
        await gm.createGroup([pt('a'), pt('b')]); // null → current map (MAP_NAME)
        const [, , mapId] = h.logGroupOperation.mock.calls[0];
        expect(mapId).toBe(MAP_UUID);
    });

    it('updateGroupProperty logs the UPDATE op with the map UUID', async () => {
        const group = await gm.createGroup([pt('f1'), pt('f2')], MAP_NAME);
        h.logGroupOperation.mockClear();

        // Aguardado porque a entrada virou write-ahead: sem o await a asserção corre antes do
        // diário, e o caso passaria a medir o nada.
        await gm.updateGroupProperty(group.id, 'visible', false, MAP_NAME);

        expect(h.logGroupOperation).toHaveBeenCalledTimes(1);
        const [opType, , mapId] = h.logGroupOperation.mock.calls[0];
        expect(opType).toBe('update');
        expect(mapId).toBe(MAP_UUID);
    });

    it('ungroupFeatures logs the DELETE op with the map UUID', async () => {
        const group = await gm.createGroup([pt('f1'), pt('f2')], MAP_NAME);
        h.logGroupOperation.mockClear();

        await gm.ungroupFeatures(group.id, MAP_NAME);

        const deleteCall = h.logGroupOperation.mock.calls.find((c) => c[0] === 'delete');
        expect(deleteCall, 'a DELETE group op was logged').toBeTruthy();
        expect(deleteCall[2]).toBe(MAP_UUID);
    });
});

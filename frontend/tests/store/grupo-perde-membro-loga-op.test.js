// Path: tests/store/grupo-perde-membro-loga-op.test.js
//
// Regressão: sair de um grupo tem de virar OPERAÇÃO.
//
// `GroupManager.removeFeatureFromAllGroups` tirava a feição de `group.features`, mexia no
// metadado de sync e soft-deletava o grupo que ficasse com um membro ou menos, e não logava
// NADA. Ela tem cinco chamadores fora do arquivo (toda exclusão de feição, o mover para outro
// mapa, a transferência de camada), então o par e o servidor guardavam o grupo com a referência
// à feição que já tinha saído, sem erro em lugar nenhum.
//
// POR QUE A OP É `group_feature` E NÃO UM UPDATE DE `group`. Conferido no servidor
// (`backend/src/modules/sync/sync.service.js`): `UPDATE_FIELDS.group` são name/visible/locked/
// style/parent_id, e o INSERT de `groups` também não lê `data.features`. A lista de membros mora
// na tabela de junção `group_features`, escrita SÓ pelas ops de alvo `group_feature`, e é dela
// que o snapshot remonta `group.features`. Ou seja, um `group` update carregando a lista nova é
// aplicado com a lista descartada em silêncio: o par converge ao vivo (o inbound troca o
// documento inteiro) e o servidor fica com a membresia velha, que volta no próximo snapshot ou
// F5. Um teste de duas browsers passaria verde sobre esse desenho. Isso está fixado do outro
// lado por `frontend/tests/e2e/group-ops.e2e.test.js`, que assere `features` vazio depois de um
// `group` create.
//
// O QUE ESTE ARQUIVO PRENDE, e o controle negativo de cada caso está escrito no próprio caso:
// quantas ops, de que tipo, com que payload e com que mapId. Só as costuras são duplicadas
// (barril da store, loggers, resolvedor de mapa); o GroupManager real é que roda.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const MAP_NAME = 'Mapa Tático';
const MAP_UUID = '4a22f7df-df6d-47df-80bb-f26df86d31ec';

const h = vi.hoisted(() => ({
    memoryStore: { currentMap: 'Mapa Tático', groups: {} },
    logGroupOperation: vi.fn(),
    logGroupFeatureOperation: vi.fn(),
    resolveToId: vi.fn(),
}));

vi.mock('../../src/js/store/index.js', () => ({
    memoryStore: h.memoryStore,
    setMapGroups: vi.fn(),
    getMapGroupsFromDB: vi.fn(async () => ({})),
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logGroupOperation: h.logGroupOperation,
    logGroupFeatureOperation: h.logGroupFeatureOperation,
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' },
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: { resolveToId: h.resolveToId },
}));

import { createGroupManager } from '../../src/js/tool_manager/group_manager.js';

/** @param {string} id @returns {Object} A minimal point feature. */
const pt = (id) => ({ properties: { id, source: 'point' } });

/** @returns {Array<Array>} The arguments of every membership op logged so far. */
const membershipCalls = () => h.logGroupFeatureOperation.mock.calls;

/** @returns {Array<Array>} The arguments of every group op logged so far. */
const groupCalls = () => h.logGroupOperation.mock.calls;

let gm;
beforeEach(() => {
    vi.clearAllMocks();
    h.resolveToId.mockImplementation((n) => (n === MAP_NAME ? MAP_UUID : n));
    h.memoryStore.currentMap = MAP_NAME;
    h.memoryStore.groups = {};
    gm = createGroupManager({ emit: vi.fn() });
});

describe('removeFeatureFromAllGroups: a saída de um membro vira operação', () => {
    it('grupo de 3 perde 1: UMA op group_feature delete, e NENHUM delete de grupo', () => {
        const group = gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);
        vi.clearAllMocks();

        gm.removeFeatureFromAllGroups('point', 'f2', MAP_NAME);

        // A op de membresia, com o par que o servidor consome.
        expect(membershipCalls()).toHaveLength(1);
        const [opType, groupId, featureId, featureType, mapId] = membershipCalls()[0];
        expect(opType).toBe('delete');
        expect(groupId).toBe(group.id);
        expect(featureId).toBe('f2');
        expect(featureType).toBe('point');
        // Mesma regra de todo op deste arquivo: UUID do mapa, nunca o nome (poison de flush).
        expect(mapId).toBe(MAP_UUID);
        expect(mapId).not.toBe(MAP_NAME);

        // O grupo continua vivo com dois membros: nada de delete de grupo.
        expect(groupCalls()).toHaveLength(0);
        expect(group.features.map((f) => f.id)).toEqual(['f1', 'f3']);
        expect(gm.getGroupById(group.id, MAP_NAME)).toBeTruthy();
    });

    it('grupo de 2 perde 1: a op de membresia MAIS o delete do grupo que se dissolveu', () => {
        const group = gm.createGroup([pt('a'), pt('b')], MAP_NAME);
        vi.clearAllMocks();

        gm.removeFeatureFromAllGroups('point', 'a', MAP_NAME);

        expect(membershipCalls()).toHaveLength(1);
        expect(membershipCalls()[0].slice(0, 3)).toEqual(['delete', group.id, 'a']);

        // O soft-delete local já existia; o que faltava era ele viajar.
        expect(groupCalls()).toHaveLength(1);
        const [opType, deletedId, mapId, data, previous] = groupCalls()[0];
        expect(opType).toBe('delete');
        expect(deletedId).toBe(group.id);
        expect(mapId).toBe(MAP_UUID);
        expect(data).toBeNull();
        // O estado anterior viaja para o undo, como em ungroupFeatures.
        expect(previous.id).toBe(group.id);
        expect(gm.getGroupById(group.id, MAP_NAME), 'grupo dissolvido localmente').toBeNull();
    });

    it('feição fora de todo grupo: ZERO ops (idempotência)', () => {
        gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);
        vi.clearAllMocks();

        gm.removeFeatureFromAllGroups('point', 'forasteira', MAP_NAME);

        expect(membershipCalls()).toHaveLength(0);
        expect(groupCalls()).toHaveLength(0);
    });

    it('chamar duas vezes a mesma remoção loga só na primeira', () => {
        gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);
        vi.clearAllMocks();

        gm.removeFeatureFromAllGroups('point', 'f3', MAP_NAME);
        const depoisDaPrimeira = membershipCalls().length;
        gm.removeFeatureFromAllGroups('point', 'f3', MAP_NAME);

        expect(depoisDaPrimeira).toBe(1);
        expect(membershipCalls()).toHaveLength(1);
    });

    it('o TIPO faz parte da identidade do membro: mesmo id, outro tipo, não sai', () => {
        // `group.features` guarda `{type, id}`, e o filtro casa os dois. Um teste que só
        // olhasse o id passaria com um filtro pela metade.
        gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);
        vi.clearAllMocks();

        gm.removeFeatureFromAllGroups('polygon', 'f2', MAP_NAME);

        expect(membershipCalls()).toHaveLength(0);
        expect(groupCalls()).toHaveLength(0);
    });

    it('dois grupos afetados: uma op de membresia POR GRUPO, com o id de cada um', () => {
        // A feição não pode estar em dois grupos por `createGroup` (ele recusa), então os dois
        // grupos são montados direto no cache, que é a forma como um snapshot os entrega.
        const cache = {};
        for (const [gid, ids] of [['g1', ['x', 'y', 'z']], ['g2', ['x', 'w', 'v']]]) {
            cache[gid] = {
                id: gid,
                name: gid,
                features: ids.map((id) => ({ type: 'point', id })),
                visible: true,
                locked: false,
                sync: { createdAt: 1, updatedAt: 1, version: 1, deleted: false },
            };
        }
        h.memoryStore.groups[MAP_NAME] = cache;

        gm.removeFeatureFromAllGroups('point', 'x', MAP_NAME);

        expect(membershipCalls()).toHaveLength(2);
        expect(membershipCalls().map((c) => c[1]).sort()).toEqual(['g1', 'g2']);
        expect(membershipCalls().every((c) => c[0] === 'delete' && c[2] === 'x')).toBe(true);
        expect(groupCalls(), 'os dois continuam com dois membros').toHaveLength(0);
    });

    it('grupo já soft-deletado não loga nada', () => {
        const group = gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);
        gm.ungroupFeatures(group.id, MAP_NAME);
        vi.clearAllMocks();

        gm.removeFeatureFromAllGroups('point', 'f1', MAP_NAME);

        expect(membershipCalls()).toHaveLength(0);
        expect(groupCalls()).toHaveLength(0);
    });

    it('grupo degenerado ALHEIO não é dissolvido de carona', () => {
        // O código anterior soft-deletava TODO grupo ativo com um membro ou menos a cada
        // chamada, relacionada ou não. Inerte enquanto nada era logado; assim que o
        // soft-delete virou op, isso passaria a dissolver no PAR um grupo que este gesto não
        // tocou. O `continue` por "não mudou nada" é o que impede isso, e é este caso que o
        // prende: sem ele, `groupCalls()` teria um delete de `solitario`.
        h.memoryStore.groups[MAP_NAME] = {
            solitario: {
                id: 'solitario',
                name: 'Sobrevivente',
                features: [{ type: 'point', id: 'unico' }],
                visible: true,
                locked: false,
                sync: { createdAt: 1, updatedAt: 1, version: 1, deleted: false },
            },
        };

        gm.removeFeatureFromAllGroups('point', 'outra-coisa', MAP_NAME);

        expect(groupCalls()).toHaveLength(0);
        expect(membershipCalls()).toHaveLength(0);
        expect(gm.getGroupById('solitario', MAP_NAME), 'grupo alheio intacto').toBeTruthy();
    });

    it('mapName null resolve o mapa CORRENTE para UUID', () => {
        gm.createGroup([pt('f1'), pt('f2'), pt('f3')]);
        vi.clearAllMocks();

        gm.removeFeatureFromAllGroups('point', 'f1');

        expect(membershipCalls()).toHaveLength(1);
        expect(membershipCalls()[0][4]).toBe(MAP_UUID);
    });
});

describe('a membresia também NASCE como operação', () => {
    // Sem isto a correção acima seria inerte no caso dominante: o servidor não guarda membro
    // nenhum de grupo criado ao vivo (o INSERT de `groups` ignora `data.features`), então um
    // delete de junção não teria linha para apagar. As duas metades vão juntas.
    it('createGroup loga o grupo e DEPOIS uma op de membresia por feição', () => {
        const group = gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);

        expect(groupCalls()).toHaveLength(1);
        expect(groupCalls()[0][0]).toBe('create');

        expect(membershipCalls()).toHaveLength(3);
        expect(membershipCalls().map((c) => c[2])).toEqual(['f1', 'f2', 'f3']);
        for (const [opType, groupId, , featureType, mapId] of membershipCalls()) {
            expect(opType).toBe('create');
            expect(groupId).toBe(group.id);
            expect(featureType).toBe('point');
            expect(mapId).toBe(MAP_UUID);
        }

        // A ORDEM é contrato: o INSERT da junção é gateado por EXISTS sobre a linha do grupo,
        // então uma membresia que chegasse antes do grupo escreveria ZERO linhas e voltaria
        // acked como sucesso. O que se pode medir AQUI é só a ordem de CHAMADA, porque este
        // arquivo duplica os loggers e nunca alcança a fila.
        //
        // ORDEM DE CHAMADA NÃO É ORDEM DE SAÍDA, e a diferença já custou um defeito real: quem
        // decide a saída é a chave da fila mais o `.sort()` lexicográfico de `_getOrderedKeys`
        // (`frontend/src/js/store/sync/operation-queue.js`), e enquanto a chave foi
        // `op_<ts>_<uuid>` o desempate entre ops do mesmo milissegundo caía num UUID ALEATÓRIO,
        // de modo que a membresia saía na frente do grupo em 3 de 4 execuções com 3 membros.
        // Esta asserção passava verde o tempo todo naquele estado. Quem prende a ordem de
        // saída de verdade é `frontend/tests/integration/grupo-membresia-ordem-na-fila.test.js`,
        // que roda a fila REAL e pergunta a ela; esta aqui fica como a metade barata (o
        // GroupManager chama na ordem certa), nomeando a outra para que ninguém a confunda
        // com a garantia.
        expect(h.logGroupOperation.mock.invocationCallOrder[0])
            .toBeLessThan(h.logGroupFeatureOperation.mock.invocationCallOrder[0]);
    });

    it('combineGroups loga a membresia do grupo NOVO, e só dele', () => {
        const g1 = gm.createGroup([pt('a'), pt('b')], MAP_NAME);
        const g2 = gm.createGroup([pt('c'), pt('d')], MAP_NAME);
        vi.clearAllMocks();

        const combinado = gm.combineGroups([g1.id, g2.id], [], MAP_NAME);

        expect(membershipCalls()).toHaveLength(4);
        expect(membershipCalls().every((c) => c[0] === 'create' && c[1] === combinado.id)).toBe(true);
        expect(membershipCalls().map((c) => c[2]).sort()).toEqual(['a', 'b', 'c', 'd']);
        // Os dois antigos saem por delete de GRUPO (soft), não por delete de membresia: eles
        // somem do snapshot inteiros.
        const deletes = groupCalls().filter((c) => c[0] === 'delete').map((c) => c[1]);
        expect(deletes.sort()).toEqual([g1.id, g2.id].sort());
    });
});

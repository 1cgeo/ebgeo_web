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
// propósito: espelho calado é o que transforma um alvo novo em cobertura vazia. Desde a última
// onda de B4 TODAS as entradas deste arquivo passam por aqui, `combineGroups` e
// `removeFeatureFromAllGroups` inclusive: os loggers de entidade não são mais chamados por
// nenhuma delas, e é o espelho que traduz a intenção durável para as asserções abaixo.
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
import { runTransaction } from '../../src/js/store/store-transaction.js';

/** @param {string} id @returns {Object} A minimal point feature. */
const pt = (id) => ({ properties: { id, source: 'point' } });

/**
 * Drives one removal exactly as its four callers do since it became write-ahead: the
 * intentions are recorded during the PREPARE phase of the caller's transaction, and the
 * groups-document write it returns is chained onto the caller's persistence function.
 *
 * Este ajudante É a mudança de contrato deste lote. Antes o caso chamava a função solta e o
 * logger rodava fora de transação nenhuma; agora uma chamada sem `tx` nem começa, e é isso que
 * impede que alguém a chame de dentro de um `deferSync` outra vez.
 *
 * @param {string} type - Feature source type
 * @param {string} featureId - Feature id
 * @param {string} [mapName] - Map name (undefined exercises the current-map default)
 * @returns {Promise<void>}
 */
async function removerEmTransacao(type, featureId, mapName) {
    await runTransaction(async (tx) => {
        const persistGroups = mapName === undefined
            ? gm.removeFeatureFromAllGroups(tx, type, featureId)
            : gm.removeFeatureFromAllGroups(tx, type, featureId, mapName);
        return async () => { await persistGroups?.(); };
    });
}

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
    it('grupo de 3 perde 1: UMA op group_feature delete, e NENHUM delete de grupo', async () => {
        const group = await gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);
        vi.clearAllMocks();

        await removerEmTransacao('point', 'f2', MAP_NAME);

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
        // Lido pelo gerente, e NUNCA pela referência devolvida por `createGroup`: o documento
        // do grupo é SUBSTITUÍDO no cache, não mutado no lugar, que é o que mantém invisível
        // uma gravação que falhe. Uma asserção sobre a referência antiga mediria o contrário.
        expect(gm.getGroupById(group.id, MAP_NAME).features.map((f) => f.id)).toEqual(['f1', 'f3']);
        expect(group.features.map((f) => f.id), 'a cópia anterior não é mutada').toEqual(['f1', 'f2', 'f3']);
    });

    it('grupo de 2 perde 1: a op de membresia MAIS o delete do grupo que se dissolveu', async () => {
        const group = await gm.createGroup([pt('a'), pt('b')], MAP_NAME);
        vi.clearAllMocks();

        await removerEmTransacao('point', 'a', MAP_NAME);

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

    it('feição fora de todo grupo: ZERO ops (idempotência)', async () => {
        await gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);
        vi.clearAllMocks();

        await removerEmTransacao('point', 'forasteira', MAP_NAME);

        expect(membershipCalls()).toHaveLength(0);
        expect(groupCalls()).toHaveLength(0);
    });

    it('chamar duas vezes a mesma remoção loga só na primeira', async () => {
        await gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);
        vi.clearAllMocks();

        await removerEmTransacao('point', 'f3', MAP_NAME);
        const depoisDaPrimeira = membershipCalls().length;
        await removerEmTransacao('point', 'f3', MAP_NAME);

        expect(depoisDaPrimeira).toBe(1);
        expect(membershipCalls()).toHaveLength(1);
    });

    it('o TIPO faz parte da identidade do membro: mesmo id, outro tipo, não sai', async () => {
        // `group.features` guarda `{type, id}`, e o filtro casa os dois. Um teste que só
        // olhasse o id passaria com um filtro pela metade.
        await gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);
        vi.clearAllMocks();

        await removerEmTransacao('polygon', 'f2', MAP_NAME);

        expect(membershipCalls()).toHaveLength(0);
        expect(groupCalls()).toHaveLength(0);
    });

    it('dois grupos afetados: uma op de membresia POR GRUPO, com o id de cada um', async () => {
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

        await removerEmTransacao('point', 'x', MAP_NAME);

        expect(membershipCalls()).toHaveLength(2);
        expect(membershipCalls().map((c) => c[1]).sort()).toEqual(['g1', 'g2']);
        expect(membershipCalls().every((c) => c[0] === 'delete' && c[2] === 'x')).toBe(true);
        expect(groupCalls(), 'os dois continuam com dois membros').toHaveLength(0);
    });

    it('grupo já soft-deletado não loga nada', async () => {
        const group = await gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);
        // Aguardado porque `ungroupFeatures` virou write-ahead: sem o await o grupo ainda está
        // ativo quando a remoção de membro roda, e o caso mediria o contrário do que diz.
        await gm.ungroupFeatures(group.id, MAP_NAME);
        vi.clearAllMocks();

        await removerEmTransacao('point', 'f1', MAP_NAME);

        expect(membershipCalls()).toHaveLength(0);
        expect(groupCalls()).toHaveLength(0);
    });

    it('grupo degenerado ALHEIO não é dissolvido de carona', async () => {
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

        await removerEmTransacao('point', 'outra-coisa', MAP_NAME);

        expect(groupCalls()).toHaveLength(0);
        expect(membershipCalls()).toHaveLength(0);
        expect(gm.getGroupById('solitario', MAP_NAME), 'grupo alheio intacto').toBeTruthy();
    });

    it('mapName null resolve o mapa CORRENTE para UUID', async () => {
        await gm.createGroup([pt('f1'), pt('f2'), pt('f3')]);
        vi.clearAllMocks();

        await removerEmTransacao('point', 'f1');

        expect(membershipCalls()).toHaveLength(1);
        expect(membershipCalls()[0][4]).toBe(MAP_UUID);
    });
});

describe('a membresia também NASCE como operação', () => {
    // Sem isto a correção acima seria inerte no caso dominante: o servidor não guarda membro
    // nenhum de grupo criado ao vivo (o INSERT de `groups` ignora `data.features`), então um
    // delete de junção não teria linha para apagar. As duas metades vão juntas.
    it('createGroup loga o grupo e DEPOIS uma op de membresia por feição', async () => {
        const group = await gm.createGroup([pt('f1'), pt('f2'), pt('f3')], MAP_NAME);

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

    it('combineGroups loga a membresia do grupo NOVO, e só dele', async () => {
        const g1 = await gm.createGroup([pt('a'), pt('b')], MAP_NAME);
        const g2 = await gm.createGroup([pt('c'), pt('d')], MAP_NAME);
        vi.clearAllMocks();

        const combinado = await gm.combineGroups([g1.id, g2.id], [], MAP_NAME);

        expect(membershipCalls()).toHaveLength(4);
        expect(membershipCalls().every((c) => c[0] === 'create' && c[1] === combinado.id)).toBe(true);
        expect(membershipCalls().map((c) => c[2]).sort()).toEqual(['a', 'b', 'c', 'd']);
        // Os dois antigos saem por delete de GRUPO (soft), não por delete de membresia: eles
        // somem do snapshot inteiros.
        const deletes = groupCalls().filter((c) => c[0] === 'delete').map((c) => c[1]);
        expect(deletes.sort()).toEqual([g1.id, g2.id].sort());
    });
});

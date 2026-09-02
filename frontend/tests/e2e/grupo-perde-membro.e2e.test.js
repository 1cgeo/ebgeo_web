// Path: tests/e2e/grupo-perde-membro.e2e.test.js

/**
 * @fileoverview E2E: uma feição sai de um grupo, e a saída CHEGA ao servidor.
 *
 * O defeito que este arquivo fecha: `GroupManager.removeFeatureFromAllGroups` tirava a feição
 * de `group.features` e não logava operação nenhuma, então o servidor guardava a referência à
 * feição que já tinha saído. Ela é chamada por toda exclusão de feição, pelo mover para outro
 * mapa e pela transferência de camada.
 *
 * A VERIFICAÇÃO QUE DECIDIU O DESENHO, e ela é o segundo caso deste arquivo. O servidor NÃO
 * tem coluna de membros em `groups`: `UPDATE_FIELDS.group` (`backend/src/modules/sync/
 * sync.service.js`) são name/visible/locked/style/parent_id, e o INSERT de `groups` também não
 * lê `data.features`. A membresia mora na tabela de junção `group_features`, escrita só pelas
 * ops de alvo `group_feature`, e é dela que o snapshot remonta `group.features`. Logo, a op
 * certa para "feição saiu do grupo" é `group_feature` delete, e um `group` update carregando a
 * lista nova é aplicado com a lista descartada em SILÊNCIO. Como o inbound do cliente troca o
 * documento de grupo inteiro, esse desenho errado convergiria os pares ao vivo e passaria verde
 * num teste de duas browsers, com o servidor errado por baixo. O caso "um update de grupo NÃO
 * move a membresia" existe para que essa escolha não possa ser desfeita sem ficar vermelha.
 *
 * O envelope aqui é montado com `createOperation` sobre o payload que
 * `logGroupFeatureOperation` (`frontend/src/js/store/sync/operation-dispatcher.js`) produz:
 * `{ group_id, feature_id, feature_type }`, com um UUID descartável no slot de entityId.
 * `frontend/tests/store/grupo-perde-membro-loga-op.test.js` prende o lado de cá (quais ops o
 * GroupManager loga); este prende o lado de lá (o que o servidor faz com elas).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Pulls a full snapshot and returns the group with the given id.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @param {string} groupId
 * @returns {Promise<Object|undefined>}
 */
async function pullGroup(api, atlasId, mapId, groupId) {
    const res = await api.pullSync(atlasId, 0);
    expect(res.isSnapshot).toBe(true);
    const map = res.snapshot.maps.find((m) => m.id === mapId);
    expect(map, 'map present in snapshot').toBeTruthy();
    return (map.groups || []).find((g) => g.id === groupId);
}

/**
 * The membership envelope the client now emits. Mirrors `logGroupFeatureOperation`: the
 * entity id is a throwaway UUID (`operations.entity_id` is a UUID column, and a per-op id is
 * what keeps queue compaction from collapsing several membership changes into one), and the
 * pair the server consumes rides in `data`.
 * @param {'create'|'delete'} opType
 * @param {string} groupId
 * @param {string} featureId
 * @param {string} featureType
 * @param {string} mapId
 * @returns {Object}
 */
function membershipOp(opType, groupId, featureId, featureType, mapId) {
    return createOperation('group_feature', opType, generateUUID(), mapId, {
        group_id: groupId,
        feature_id: featureId,
        feature_type: featureType,
    });
}

/**
 * A point feature op, shaped as the client's feature ops are (the flat `feature_type`
 * column is derived from `properties.source` by the backend).
 * @param {string} featureId
 * @param {string} mapId
 * @param {Array<number>} coords
 * @returns {Object}
 */
function pointOp(featureId, mapId, coords) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: { source: 'point', id: featureId },
    });
}

/** @param {Object|undefined} group @returns {Array<string>} Member ids, sorted. */
const memberIds = (group) => (group?.features || []).map((f) => f.id).sort();

describe.skipIf(E2E_SKIP)('e2e: o grupo perde um membro e o servidor sabe', () => {
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Grupo Membro E2E' });
        const atlas = await createAtlas(api, { name: 'Atlas Membresia' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Membresia' });
    }, 20000);

    it('grupo de 3 perde 1: o snapshot volta com 2, e com OS DOIS certos', async () => {
        const groupId = generateUUID();
        const [f1, f2, f3] = [generateUUID(), generateUUID(), generateUUID()];

        // O gesto de agrupar: a op do grupo e, DEPOIS, uma op de membresia por feição, porque
        // o INSERT da junção é gateado por EXISTS sobre a linha do grupo e a membresia que
        // chegue antes escreve ZERO linhas voltando acked como sucesso.
        //
        // ESTE ARRAY NÃO PROVA A ORDEM, ele a assume: aqui ela está escrita à mão. Quem garante
        // que o CLIENTE entrega nessa ordem é a chave monotônica da fila, e quem prende isso é
        // `frontend/tests/integration/grupo-membresia-ordem-na-fila.test.js`, que roda a fila
        // real. A primeira versão deste comentário dizia "como o cliente o emite hoje", e era
        // falso: com a chave antiga (`op_<ts>_<uuid>`) o desempate no mesmo milissegundo caía
        // num UUID aleatório e a membresia saía na frente em 3 de 4 execuções.
        await api.pushOperations(atlasId, [
            pointOp(f1, mapId, [-43.2, -22.9]),
            pointOp(f2, mapId, [-43.1, -22.8]),
            pointOp(f3, mapId, [-43.0, -22.7]),
            createOperation('group', 'create', groupId, mapId, {
                name: 'Pelotão Alfa',
                visible: true,
                locked: false,
                features: [
                    { type: 'point', id: f1 },
                    { type: 'point', id: f2 },
                    { type: 'point', id: f3 },
                ],
            }),
            membershipOp('create', groupId, f1, 'point', mapId),
            membershipOp('create', groupId, f2, 'point', mapId),
            membershipOp('create', groupId, f3, 'point', mapId),
        ]);

        let group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group, 'grupo criado').toBeTruthy();
        expect(memberIds(group), 'os três membros chegaram').toEqual([f1, f2, f3].sort());

        // A op que a etapa de verificação escolheu: `group_feature` delete.
        await api.pushOperations(atlasId, [membershipOp('delete', groupId, f2, 'point', mapId)]);

        group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group, 'o grupo continua vivo com dois membros').toBeTruthy();
        expect(group.features).toHaveLength(2);
        // Positivo E negativo do mesmo par: quem ficou ficou, quem saiu saiu. Só o comprimento
        // passaria igual se o servidor tivesse apagado a linha errada.
        expect(memberIds(group)).toEqual([f1, f3].sort());
        expect(group.features.some((f) => f.id === f2), 'f2 saiu').toBe(false);

        // Idempotência: repetir a mesma remoção não tira mais ninguém.
        await api.pushOperations(atlasId, [membershipOp('delete', groupId, f2, 'point', mapId)]);
        group = await pullGroup(api, atlasId, mapId, groupId);
        expect(memberIds(group)).toEqual([f1, f3].sort());
    }, 30000);

    it('um UPDATE de grupo NÃO move a membresia: é por isso que a op é `group_feature`', async () => {
        // O controle que sustenta o desenho. Se alguém "simplificar" a correção para um
        // `group` update com a lista nova, este caso é o que fica vermelho, e a mensagem diz
        // por quê. Repare que ele também afirma o efeito que o update TEM: as colunas de
        // verdade mudam, o que descarta "o update inteiro não chegou" como explicação.
        const groupId = generateUUID();
        const [a, b] = [generateUUID(), generateUUID()];

        await api.pushOperations(atlasId, [
            pointOp(a, mapId, [-44.2, -23.9]),
            pointOp(b, mapId, [-44.1, -23.8]),
            createOperation('group', 'create', groupId, mapId, { name: 'Controle', visible: true }),
            membershipOp('create', groupId, a, 'point', mapId),
            membershipOp('create', groupId, b, 'point', mapId),
        ]);

        expect(memberIds(await pullGroup(api, atlasId, mapId, groupId))).toEqual([a, b].sort());

        // O desenho REJEITADO, empurrado de propósito: a lista nova dentro de um update.
        await api.pushOperations(atlasId, [
            createOperation('group', 'update', groupId, mapId, {
                name: 'Controle renomeado',
                features: [{ type: 'point', id: a }],
            }),
        ]);

        const group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group.name, 'as colunas do update de fato mudaram').toBe('Controle renomeado');
        expect(
            memberIds(group),
            'o servidor passou a mover membresia por update de grupo. Se isso foi deliberado'
            + ' (uma coluna nova, ou um insert/delete de junção dentro do update), a correção do'
            + ' cliente pode ser revista; enquanto for `UPDATE_FIELDS.group`, a lista dentro de'
            + ' um update é descartada em silêncio e a membresia só viaja como `group_feature`.',
        ).toEqual([a, b].sort());
    }, 30000);

    it('grupo de 2 perde 1: some do snapshot, porque o cliente também loga o delete do grupo', async () => {
        const groupId = generateUUID();
        const [x, y] = [generateUUID(), generateUUID()];

        await api.pushOperations(atlasId, [
            pointOp(x, mapId, [-45.2, -24.9]),
            pointOp(y, mapId, [-45.1, -24.8]),
            createOperation('group', 'create', groupId, mapId, { name: 'Dupla', visible: true }),
            membershipOp('create', groupId, x, 'point', mapId),
            membershipOp('create', groupId, y, 'point', mapId),
        ]);

        expect(memberIds(await pullGroup(api, atlasId, mapId, groupId))).toEqual([x, y].sort());

        // O par de ops que `removeFeatureFromAllGroups` emite quando o grupo cai a um membro.
        await api.pushOperations(atlasId, [
            membershipOp('delete', groupId, x, 'point', mapId),
            createOperation('group', 'delete', groupId, mapId, null),
        ]);

        expect(
            await pullGroup(api, atlasId, mapId, groupId),
            'o grupo dissolvido não volta no snapshot',
        ).toBeUndefined();
    }, 30000);

    it('a feição excluída junto: a referência não sobrevive por nenhuma das duas portas', async () => {
        // O caminho real de `removeFeature`: a feição é soft-deletada E sai do grupo. As duas
        // ops viajam. Sem a de membresia, a linha de junção ficava para trás e só o filtro de
        // órfão do snapshot a escondia, que é uma rede de segurança, não a correção: ela some
        // da lista porque a FEIÇÃO sumiu, e voltaria se a feição fosse recriada com o mesmo id.
        const groupId = generateUUID();
        const [p, q, r] = [generateUUID(), generateUUID(), generateUUID()];

        await api.pushOperations(atlasId, [
            pointOp(p, mapId, [-46.2, -25.9]),
            pointOp(q, mapId, [-46.1, -25.8]),
            pointOp(r, mapId, [-46.0, -25.7]),
            createOperation('group', 'create', groupId, mapId, { name: 'Trio', visible: true }),
            membershipOp('create', groupId, p, 'point', mapId),
            membershipOp('create', groupId, q, 'point', mapId),
            membershipOp('create', groupId, r, 'point', mapId),
        ]);

        await api.pushOperations(atlasId, [
            createOperation('feature', 'delete', q, mapId, null),
            membershipOp('delete', groupId, q, 'point', mapId),
        ]);

        const group = await pullGroup(api, atlasId, mapId, groupId);
        expect(memberIds(group)).toEqual([p, r].sort());

        // A prova de que a linha de junção FOI apagada, e não só escondida pelo filtro de
        // órfão: recriar a feição com o MESMO id não ressuscita a membresia.
        await api.pushOperations(atlasId, [pointOp(q, mapId, [-46.1, -25.8])]);

        const depois = await pullGroup(api, atlasId, mapId, groupId);
        expect(
            memberIds(depois),
            'a feição recriada voltou para o grupo: a linha de `group_features` tinha ficado'
            + ' para trás e o filtro de órfão do snapshot só a estava escondendo',
        ).toEqual([p, r].sort());
    }, 30000);
});

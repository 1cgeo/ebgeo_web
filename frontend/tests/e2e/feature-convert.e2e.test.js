// Path: tests/e2e/feature-convert.e2e.test.js

/**
 * @fileoverview E2E de CONTRATO: converter uma feição é um CREATE de um id NOVO mais um
 * DELETE do id ANTIGO, e os dois viajam no MESMO push.
 *
 * ================= A LACUNA QUE ELE FECHA ====================================
 *
 * Nada neste repositório empurrava esse par junto. `feature-crud.e2e.test.js` cria num push e
 * apaga noutro; `batch-atomicity` mede três creates e um 403; `undo-redo.e2e` repete o MESMO
 * id. O par de ids DIFERENTES na mesma transação é exatamente a forma que a conversão produz,
 * e ela tem duas propriedades que só se medem juntas: os dois acks numa transação só, e o
 * fato de o mapa TRAVADO recusar AS DUAS metades, deixando o estado consistente.
 *
 * ================= POR QUE O MAPA TRAVADO É O CASO CENTRAL ===================
 *
 * A recusa do mapa travado é POR OPERAÇÃO (200 com `rejected: true`), dentro de um SAVEPOINT,
 * e o lote segue. Se ela alcançasse só o CREATE, a conversão se perderia e a feição antiga
 * sobreviveria: chato, e seguro. Se alcançasse só o DELETE, o mapa ficaria com AS DUAS
 * feições, que é duplicação silenciosa de dado. Este arquivo afirma que ela alcança as duas,
 * porque `feature` está entre os alvos filhos do cadeado e as duas ops carregam o mesmo
 * `mapId`.
 *
 * Tudo passa pelo ApiClient público + `createOperation` + harness; nenhum acesso direto ao
 * banco. Cada bloco é dono do próprio usuário, atlas e mapa.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';
import { ApiError } from '../../src/js/store/sync/api-client.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';
import { realLineFeature, realBoundaryFeature, realArrowFeature } from '../helpers/real-fixtures.js';

/** Um CREATE carregando a forma REAL que a ferramenta emite para aquele tipo. */
function createOp(featureId, mapId, feature) {
    return createOperation('feature', 'create', featureId, mapId, feature);
}

/** O DELETE da feição de origem: só o id viaja. */
function deleteOp(featureId, mapId) {
    return createOperation('feature', 'delete', featureId, mapId, null);
}

/** Liga/desliga a trava do mapa (só o dono consegue). */
function setMapLocked(api, atlasId, mapId, locked) {
    return api.pushOperations(atlasId, [createOperation('map', 'update', mapId, null, { locked })]);
}

/** Puxa um snapshot fresco e devolve o mapa pedido. */
async function pullMap(api, atlasId, mapId) {
    const r = await api.pullSync(atlasId, 0);
    expect(r.isSnapshot).toBe(true);
    const map = r.snapshot.maps.find((m) => m.id === mapId);
    expect(map, 'map present in snapshot').toBeTruthy();
    return map;
}

describe.skipIf(E2E_SKIP)('e2e: conversão de feição (CREATE novo + DELETE antigo no MESMO push)', () => {
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Convert Owner' });
        const atlas = await createAtlas(api, { name: 'Convert Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa da Conversão' });
    }, 30000);

    it('linha -> limite: os dois acks saem juntos e o snapshot troca de balde', async () => {
        const lineId = generateUUID();
        const boundaryId = generateUUID();

        // Estado inicial: a linha existe.
        const semeadura = await api.pushOperations(atlasId, [
            createOp(lineId, mapId, realLineFeature({ id: lineId })),
        ]);
        expect(semeadura.results[0].success).toBe(true);

        const antes = await pullMap(api, atlasId, mapId);
        expect(antes.features.lines.some((f) => f.properties.id === lineId)).toBe(true);

        // A CONVERSÃO: um push, duas ops, ids DIFERENTES.
        const res = await api.pushOperations(atlasId, [
            createOp(boundaryId, mapId, realBoundaryFeature({ id: boundaryId })),
            deleteOp(lineId, mapId),
        ]);
        expect(res.results).toHaveLength(2);
        expect(res.results.every((r) => r.success), 'as duas metades foram aceitas').toBe(true);

        const depois = await pullMap(api, atlasId, mapId);

        // A nova está no balde do TIPO dela — `boundarys`, com o `y`, que é o nome irregular
        // do registro e o tipo de detalhe que um teste escrito de cabeça erra.
        const limite = depois.features.boundarys.find((f) => f.properties.id === boundaryId);
        expect(limite, 'o limite caiu no balde boundarys').toBeTruthy();
        expect(limite.properties.source).toBe('boundary');
        expect(limite.geometry.type).toBe('MultiLineString');

        // ...e a antiga sumiu. Asserção NEGATIVA: sem ela, "converteu" seria indistinguível
        // de "duplicou".
        expect(depois.features.lines.some((f) => f.properties.id === lineId)).toBe(false);
        // E não vazou para o balde errado.
        expect(depois.features.lines.some((f) => f.properties.id === boundaryId)).toBe(false);
    });

    it('o envelope do limite chega inteiro: eixo autoral, âncora de zoom e escalão', async () => {
        // O que a conversão grava não é só a geometria: a âncora de zoom e o eixo AUTORAL são
        // o que permite ao par recalcular o desenho. `properties` é JSONB sem esquema, então o
        // que prova que elas atravessam é isto, e não a leitura do servidor.
        const boundaryId = generateUUID();
        await api.pushOperations(atlasId, [
            createOp(boundaryId, mapId, realBoundaryFeature({ id: boundaryId })),
        ]);

        const map = await pullMap(api, atlasId, mapId);
        const limite = map.features.boundarys.find((f) => f.properties.id === boundaryId);
        expect(limite).toBeTruthy();
        expect(limite.properties.createdAtZoom).toBe(12.3);
        expect(limite.properties.zoomCorrectionEnabled).toBe(true);
        expect(limite.properties.echelon).toBe('XXX');
        expect(limite.properties.symbol_instances).toEqual([{ ratio: 0.5, showLabels: true }]);
        expect(limite.properties.baseCoordinates).toHaveLength(3);
    });

    it('a ORDEM dentro do lote não importa: DELETE antes do CREATE dá o mesmo resultado', async () => {
        // A ordem dentro de um push NÃO é a do gesto (a fila ordena por chave, e a chave leva
        // um timestamp mais um UUID aleatório de desempate), então a conversão tem de
        // convergir nas duas ordens ou converge por sorte.
        const arrowId = generateUUID();
        const lineId = generateUUID();

        await api.pushOperations(atlasId, [createOp(arrowId, mapId, realArrowFeature({ id: arrowId }))]);

        const res = await api.pushOperations(atlasId, [
            deleteOp(arrowId, mapId),
            createOp(lineId, mapId, realLineFeature({ id: lineId })),
        ]);
        expect(res.results).toHaveLength(2);
        expect(res.results.every((r) => r.success)).toBe(true);

        const map = await pullMap(api, atlasId, mapId);
        expect(map.features.lines.some((f) => f.properties.id === lineId)).toBe(true);
        expect(map.features.arrows.some((f) => f.properties.id === arrowId)).toBe(false);
    });
});

describe.skipIf(E2E_SKIP)('e2e: conversão num mapa TRAVADO recusa AS DUAS metades', () => {
    let ownerApi;
    let writerApi;
    let atlasId;
    let mapId;
    let openMapId;
    const lineId = generateUUID();
    const boundaryId = generateUUID();
    const siblingId = generateUUID();

    beforeAll(async () => {
        ownerApi = makeApi();
        writerApi = makeApi();
        await registerAndLogin(ownerApi, { nome: 'Lock Owner' });
        const writer = await registerAndLogin(writerApi, { nome: 'Lock Writer' });

        const atlas = await createAtlas(ownerApi, { name: 'Convert Lock Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(ownerApi, atlasId, { name: 'Mapa Travado' });
        openMapId = await createMap(ownerApi, atlasId, { name: 'Mapa Aberto' });

        await ownerApi._request('POST', `/atlas/${atlasId}/sharing/users`, {
            body: { userId: writer.user.id, permission: 'write' },
        });

        // A linha nasce com o mapa AINDA destravado, para haver o que converter.
        const semeadura = await writerApi.pushOperations(atlasId, [
            createOp(lineId, mapId, realLineFeature({ id: lineId })),
        ]);
        expect(semeadura.results[0].success).toBe(true);
    }, 40000);

    it('CONTROLE POSITIVO: destravado, a conversão passa', async () => {
        // Sem este passo, todas as asserções de recusa abaixo passariam para uma conversão
        // simplesmente quebrada.
        const provaId = generateUUID();
        const descartavelId = generateUUID();
        await writerApi.pushOperations(atlasId, [
            createOp(descartavelId, openMapId, realLineFeature({ id: descartavelId })),
        ]);
        const res = await writerApi.pushOperations(atlasId, [
            createOp(provaId, openMapId, realArrowFeature({ id: provaId })),
            deleteOp(descartavelId, openMapId),
        ]);
        expect(res.results.every((r) => r.success)).toBe(true);
    });

    it('o dono trava o mapa', async () => {
        const res = await setMapLocked(ownerApi, atlasId, mapId, true);
        expect(res.results[0].success).toBe(true);
        const map = await pullMap(ownerApi, atlasId, mapId);
        expect(map.locked).toBe(true);
    });

    it('as DUAS metades são recusadas por operação, e nada muda no mapa', async () => {
        const res = await writerApi.pushOperations(atlasId, [
            createOp(boundaryId, mapId, realBoundaryFeature({ id: boundaryId })),
            deleteOp(lineId, mapId),
            // A irmã, num mapa ABERTO do mesmo lote: a recusa é por operação, e um mapa
            // travado não pode envenenar o lote inteiro (era o 409 que congelava a fila).
            createOp(siblingId, openMapId, realLineFeature({ id: siblingId })),
        ]);

        expect(res.results).toHaveLength(3);
        expect(res.results[0].success, 'o CREATE foi recusado').toBe(false);
        expect(res.results[0].rejected).toBe(true);
        expect(res.results[0].reason).toMatch(/bloquead/i);

        expect(res.results[1].success, 'o DELETE também foi recusado').toBe(false);
        expect(res.results[1].rejected).toBe(true);
        expect(res.results[1].reason).toMatch(/bloquead/i);

        expect(res.results[2].success, 'a irmã no mapa aberto passou').toBe(true);

        // O ESTADO CONTINUA CONSISTENTE, que é a propriedade inteira deste arquivo: a antiga
        // viva, a nova ausente. Recusar só o DELETE deixaria as DUAS, que é duplicação
        // silenciosa; recusar só o CREATE perderia a conversão.
        const map = await pullMap(ownerApi, atlasId, mapId);
        expect(map.features.lines.some((f) => f.properties.id === lineId), 'a linha sobreviveu').toBe(true);
        expect(map.features.boundarys.some((f) => f.properties.id === boundaryId), 'o limite não entrou').toBe(false);

        const aberto = await pullMap(ownerApi, atlasId, openMapId);
        expect(aberto.features.lines.some((f) => f.properties.id === siblingId)).toBe(true);
    });

    it('destravado de novo, a MESMA conversão passa', async () => {
        const res = await setMapLocked(ownerApi, atlasId, mapId, false);
        expect(res.results[0].success).toBe(true);

        const push = await writerApi.pushOperations(atlasId, [
            createOp(boundaryId, mapId, realBoundaryFeature({ id: boundaryId })),
            deleteOp(lineId, mapId),
        ]);
        expect(push.results.every((r) => r.success)).toBe(true);

        const map = await pullMap(ownerApi, atlasId, mapId);
        expect(map.features.boundarys.some((f) => f.properties.id === boundaryId)).toBe(true);
        expect(map.features.lines.some((f) => f.properties.id === lineId)).toBe(false);
    });
});

describe.skipIf(E2E_SKIP)('e2e: um Leitor não converte (403 no LOTE, não por operação)', () => {
    let ownerApi;
    let viewerApi;
    let atlasId;
    let mapId;
    const lineId = generateUUID();

    beforeAll(async () => {
        ownerApi = makeApi();
        viewerApi = makeApi();
        await registerAndLogin(ownerApi, { nome: 'Convert Owner 2' });
        const viewer = await registerAndLogin(viewerApi, { nome: 'Convert Viewer' });

        const atlas = await createAtlas(ownerApi, { name: 'Convert Viewer Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(ownerApi, atlasId, { name: 'Mapa do Leitor' });

        await ownerApi._request('POST', `/atlas/${atlasId}/sharing/users`, {
            body: { userId: viewer.user.id, permission: 'read' },
        });

        await ownerApi.pushOperations(atlasId, [createOp(lineId, mapId, realLineFeature({ id: lineId }))]);
    }, 40000);

    it('o push do Leitor levanta 403 e NENHUMA das duas metades entra', async () => {
        // A DIFERENÇA DE FORMA IMPORTA, e é o motivo de este caso existir ao lado do mapa
        // travado: violação de POSTO derruba o LOTE (403, lançado antes do savepoint),
        // enquanto o cadeado recusa POR OPERAÇÃO (200 com `rejected`). O cliente só faz
        // dequeue em 2xx, então o 403 CONGELA a fila de saída — que é exatamente por que o
        // comando de conversão não pode ser desenhado para quem não tem o posto.
        const boundaryId = generateUUID();
        let thrown;
        try {
            await viewerApi.pushOperations(atlasId, [
                createOp(boundaryId, mapId, realBoundaryFeature({ id: boundaryId })),
                deleteOp(lineId, mapId),
            ]);
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(ApiError);
        expect(thrown.status).toBe(403);

        const map = await pullMap(ownerApi, atlasId, mapId);
        expect(map.features.lines.some((f) => f.properties.id === lineId), 'a linha do dono sobreviveu').toBe(true);
        expect(map.features.boundarys.some((f) => f.properties.id === boundaryId)).toBe(false);
    });

    it('CONTROLE POSITIVO: o dono empurra a MESMA conversão e ela passa', async () => {
        const boundaryId = generateUUID();
        const res = await ownerApi.pushOperations(atlasId, [
            createOp(boundaryId, mapId, realBoundaryFeature({ id: boundaryId })),
            deleteOp(lineId, mapId),
        ]);
        expect(res.results.every((r) => r.success)).toBe(true);

        const map = await pullMap(ownerApi, atlasId, mapId);
        expect(map.features.boundarys.some((f) => f.properties.id === boundaryId)).toBe(true);
        expect(map.features.lines.some((f) => f.properties.id === lineId)).toBe(false);
    });
});

// Path: tests/e2e/layer-transfer.e2e.test.js

/**
 * @fileoverview CONTRATO DE SERVIDOR PARA "MOVER OU COPIAR UMA CAMADA INTEIRA".
 *
 * O que este arquivo mede e o que ele NAO mede, porque a distincao decide se um verde aqui
 * vale alguma coisa. `transferLayerToMap` (cliente) nao fala com o servidor: ela escreve na
 * store e a store enfileira OPS. Este arquivo empurra EXATAMENTE as ops que aquele fluxo
 * enfileira, na ordem em que ele as enfileira, e pergunta ao snapshot o que o servidor fez
 * com elas. A logica do cliente e' medida em `tests/store/layer-transfer.test.js`; o que so'
 * o servidor pode responder e' o que esta' aqui.
 *
 * AS OPS QUE UM MOVER ENFILEIRA, na ordem:
 *   1. `layer create` no mapa de DESTINO (a camada nova, com id proprio, porque id de camada
 *      nao e' unico entre mapas);
 *   2. `feature create` por feicao, tambem no mapa de DESTINO, com o MESMO entityId de antes
 *      (mover mantem a identidade: e' o mesmo objeto numa casa nova);
 *   3. `layer delete` no mapa de ORIGEM.
 * Repare no que NAO ha: nenhuma op de DELETE de feicao. O `deleteLayerFeatures` do cliente
 * esvazia o documento local sem logar op, e quem move a feicao no servidor e' o upsert do
 * passo 2, que reescreve o `map_id` da linha. E' essa propriedade, e nao a intencao do
 * cliente, que este arquivo afirma: depois do lote, a feicao esta' no destino E NAO ESTA' na
 * origem.
 *
 * A SEGUNDA METADE E' A TRAVA DO DESTINO, e ela pertence ao servidor por inteiro:
 * `lockedMapDenialReason` recusa POR OPERACAO toda escrita cujo alvo esteja em
 * `LOCKABLE_CHILD_TARGETS`, e `layer` e' um deles. Duas coisas se afirmam juntas, porque uma
 * sem a outra engana: a op recusada volta com `rejected: true` e uma razao, e o LOTE NAO CAI
 * com ela, ou seja, a op irma que mira um mapa destravado continua sendo aplicada. Um lote
 * que caisse inteiro congelaria a fila de saida do cliente, que e' o defeito caro desta
 * familia.
 *
 * A trava NAO isenta o dono. O gate le' `maps.locked` e nao pergunta quem esta' escrevendo,
 * o que casa com o comportamento medido no navegador (o dono que trava bloqueia a si mesmo).
 * Por isso este arquivo nao precisa de um segundo usuario compartilhado.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * @param {string} layerId - Layer id
 * @param {string} mapId - Owning map id
 * @param {string} name - Layer name
 * @param {number} order - Sort order
 * @returns {Object} A layer create op
 */
function layerCreateOp(layerId, mapId, name, order) {
    return createOperation('layer', 'create', layerId, mapId, {
        name, visible: true, locked: false, opacity: 1, order,
    });
}

/**
 * @param {string} featureId - Feature id
 * @param {string} mapId - Owning map id
 * @param {string} layerId - Owning layer id
 * @param {string} nome - Display name
 * @returns {Object} A feature create op
 */
function featureCreateOp(featureId, mapId, layerId, nome) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { source: 'point', layerId, nome },
    });
}

/**
 * Pulls a fresh snapshot and returns the map object matching `mapId`.
 * @param {Object} api - Api client
 * @param {string} atlasId - Atlas id
 * @param {string} mapId - Map id
 * @returns {Promise<Object>} The map as the snapshot describes it
 */
async function pullMap(api, atlasId, mapId) {
    const r = await api.pullSync(atlasId, 0);
    expect(r.isSnapshot).toBe(true);
    expect(r.snapshot).toBeTruthy();
    const map = r.snapshot.maps.find((m) => m.id === mapId);
    expect(map, `map ${mapId} present in snapshot`).toBeTruthy();
    return map;
}

/**
 * @param {Object} map - A snapshot map
 * @returns {Array<Object>} Its point features
 */
function pointsOf(map) {
    return map?.features?.points || [];
}

describe.skipIf(E2E_SKIP)('e2e: layer transfer between maps', () => {
    let api;
    let atlasId;
    let sourceMapId;
    let targetMapId;
    let lockedMapId;

    const sourceLayerId = generateUUID();
    const targetLayerId = generateUUID();
    const featureAId = generateUUID();
    const featureBId = generateUUID();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Layer Transfer Owner' });

        const atlas = await createAtlas(api, { name: 'Layer Transfer Atlas' });
        atlasId = atlas.id;
        sourceMapId = await createMap(api, atlasId, { name: 'Mapa Origem' });
        targetMapId = await createMap(api, atlasId, { name: 'Mapa Destino' });
        lockedMapId = await createMap(api, atlasId, { name: 'Mapa Travado' });

        // O estado de partida: uma camada na ORIGEM com duas feicoes nela.
        const res = await api.pushOperations(atlasId, [
            layerCreateOp(sourceLayerId, sourceMapId, 'Inimigo', 0),
            featureCreateOp(featureAId, sourceMapId, sourceLayerId, 'Alvo A'),
            featureCreateOp(featureBId, sourceMapId, sourceLayerId, 'Alvo B'),
        ]);
        expect(res.results.every((r) => r.success)).toBe(true);
    }, 30000);

    it('parte com a camada e as duas feicoes na origem', async () => {
        const origem = await pullMap(api, atlasId, sourceMapId);
        expect((origem.layers || []).map((l) => l.id)).toContain(sourceLayerId);
        expect(pointsOf(origem).map((f) => f.properties.id).sort())
            .toEqual([featureAId, featureBId].sort());

        const destino = await pullMap(api, atlasId, targetMapId);
        expect(pointsOf(destino)).toHaveLength(0);
    });

    it('a camada nasce no mapa de destino, com id proprio', async () => {
        const res = await api.pushOperations(atlasId, [
            layerCreateOp(targetLayerId, targetMapId, 'Inimigo', 0),
        ]);
        expect(res.results[0].success).toBe(true);

        const destino = await pullMap(api, atlasId, targetMapId);
        const nova = (destino.layers || []).find((l) => l.id === targetLayerId);
        expect(nova, 'a camada nova existe no destino').toBeTruthy();
        expect(nova.name).toBe('Inimigo');

        // E a camada da ORIGEM continua sendo outra linha, com outro id: ids de camada nao
        // sao unicos entre mapas, e por isso o cliente sempre cunha um novo.
        const origem = await pullMap(api, atlasId, sourceMapId);
        expect((origem.layers || []).map((l) => l.id)).toContain(sourceLayerId);
        expect(targetLayerId).not.toBe(sourceLayerId);
    });

    it('as feicoes trocam de map_id: aparecem no destino e somem da origem', async () => {
        // O upsert por entityId e' quem move a linha. O cliente nao envia DELETE de feicao,
        // entao se o servidor tratasse este create como "outra feicao", a feicao ficaria nos
        // DOIS mapas e a origem so' pareceria vazia no cliente.
        const res = await api.pushOperations(atlasId, [
            featureCreateOp(featureAId, targetMapId, targetLayerId, 'Alvo A'),
            featureCreateOp(featureBId, targetMapId, targetLayerId, 'Alvo B'),
        ]);
        expect(res.results.every((r) => r.success)).toBe(true);

        const destino = await pullMap(api, atlasId, targetMapId);
        const noDestino = pointsOf(destino);
        expect(noDestino.map((f) => f.properties.id).sort())
            .toEqual([featureAId, featureBId].sort());
        for (const f of noDestino) {
            expect(f.properties.layerId).toBe(targetLayerId);
        }

        const origem = await pullMap(api, atlasId, sourceMapId);
        expect(pointsOf(origem), 'a origem ficou vazia').toHaveLength(0);
    });

    it('o registro da camada sai da origem, e o do destino fica', async () => {
        const res = await api.pushOperations(atlasId, [
            createOperation('layer', 'delete', sourceLayerId, sourceMapId, null),
        ]);
        expect(res.results[0].success).toBe(true);

        const origem = await pullMap(api, atlasId, sourceMapId);
        expect((origem.layers || []).map((l) => l.id)).not.toContain(sourceLayerId);

        const destino = await pullMap(api, atlasId, targetMapId);
        expect((destino.layers || []).map((l) => l.id)).toContain(targetLayerId);
    });

    it('destino TRAVADO: a op volta rejeitada e o lote NAO cai com ela', async () => {
        const trava = await api.pushOperations(atlasId, [
            createOperation('map', 'update', lockedMapId, null, { locked: true }),
        ]);
        expect(trava.results[0].success).toBe(true);
        expect((await pullMap(api, atlasId, lockedMapId)).locked).toBe(true);

        const recusadaId = generateUUID();
        const irmaId = generateUUID();
        const res = await api.pushOperations(atlasId, [
            layerCreateOp(recusadaId, lockedMapId, 'Nao Entra', 0),
            layerCreateOp(irmaId, targetMapId, 'Entra', 1),
        ]);

        expect(res.results).toHaveLength(2);
        expect(res.results[0].success).toBe(false);
        expect(res.results[0].rejected).toBe(true);
        expect(res.results[0].reason).toMatch(/bloquead/i);

        // A METADE QUE IMPORTA TANTO QUANTO: a irma passou. Um lote que caisse inteiro
        // congelaria a fila de saida do cliente na primeira recusa.
        expect(res.results[1].success).toBe(true);
        expect(res.results[1].rejected).toBeUndefined();

        const travado = await pullMap(api, atlasId, lockedMapId);
        expect((travado.layers || []).map((l) => l.id)).not.toContain(recusadaId);
        const destino = await pullMap(api, atlasId, targetMapId);
        expect((destino.layers || []).map((l) => l.id)).toContain(irmaId);
    });

    it('destravado o destino, a mesma op passa', async () => {
        // CONTROLE: sem ele, a recusa acima poderia vir de qualquer outra coisa (id invalido,
        // permissao, forma do payload) e o caso continuaria verde.
        const destrava = await api.pushOperations(atlasId, [
            createOperation('map', 'update', lockedMapId, null, { locked: false }),
        ]);
        expect(destrava.results[0].success).toBe(true);

        const agoraVaiId = generateUUID();
        const res = await api.pushOperations(atlasId, [
            layerCreateOp(agoraVaiId, lockedMapId, 'Agora Entra', 0),
        ]);
        expect(res.results[0].success).toBe(true);

        const mapa = await pullMap(api, atlasId, lockedMapId);
        expect((mapa.layers || []).map((l) => l.id)).toContain(agoraVaiId);
    });
});

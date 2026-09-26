// Path: tests/e2e/desfazer-camada-criada.e2e.test.js

/**
 * @fileoverview DESFAZER E REFAZER UM PROCESSAMENTO (ou uma importação) NUM ATLAS DE SERVIDOR, com
 * o backend real (decisão do dono de 2026-09-26).
 *
 * Desde aquela data a entrada de desfazer desses gestos leva a camada de saída junto com as
 * feições (`addFeatures` com `createdLayer`). Do lado do servidor isso vira dois lotes que nenhum
 * gesto mandava antes: o desfazer exclui as feições e depois a camada, num lote só; o refazer cria a
 * camada com o MESMO id e restaura as feições, também num lote só. O primeiro depende da cascata
 * de camada não tocar feição já excluída (senão a versão dela muda e a restauração seguinte é
 * recusada por base vencida); o segundo depende do upsert de camada reviver o túmulo
 * (`deleted_at = NULL`) em vez de recusar o id conhecido. Os dois comportamentos já estavam no
 * servidor, e este arquivo os prende ao uso que o cliente passou a fazer.
 *
 * As ops são as do cliente (`createBatchOperations`), e a restauração encadeia `baseOperationId`
 * na exclusão, como `persistOperationIntents` faz.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    confirmedFeature,
} from './helpers/harness.js';
import { createBatchOperations } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

function ponto(id, layerId, coords) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: { id, source: 'point', layerId, nome: `Saída ${id.slice(0, 4)}` } };
}

async function retrato(api, atlasId, mapId) {
    const { snapshot } = await api.pullSync(atlasId, 0);
    return snapshot.maps.find((m) => m.id === mapId);
}

describe.skipIf(E2E_SKIP)('desfazer e refazer a camada criada por um gesto (backend real)', () => {
    let api;
    let atlasId;
    let mapId;
    const camada = { id: generateUUID(), name: 'Buffer - Resultado', visible: true, locked: false, opacity: 1, order: 5 };
    const f1 = generateUUID();
    const f2 = generateUUID();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Desfazer Camada' });
        atlasId = (await createAtlas(api, { name: 'Desfazer Camada Atlas' })).id;
        mapId = await createMap(api, atlasId, { name: 'Mapa' });

        // O gesto: a camada de saída e as feições dela.
        const semeadura = await api.pushOperations(atlasId, createBatchOperations([
            { entityType: 'layer', operationType: 'create', entityId: camada.id, mapId, data: camada },
            { entityType: 'feature', operationType: 'create', entityId: f1, mapId, data: ponto(f1, camada.id, [0, 0]) },
            { entityType: 'feature', operationType: 'create', entityId: f2, mapId, data: ponto(f2, camada.id, [1, 1]) },
        ]));
        expect(semeadura.results.every((r) => r.success), JSON.stringify(semeadura.results)).toBe(true);
    });

    it('o desfazer (feições e depois a camada, num lote) aplica inteiro, e o refazer (a camada com o mesmo id e as feições restauradas) também', async () => {
        const antes1 = await confirmedFeature(api, atlasId, mapId, f1);
        const antes2 = await confirmedFeature(api, atlasId, mapId, f2);

        const desfazer = createBatchOperations([
            { entityType: 'feature', operationType: 'delete', entityId: f1, mapId, data: null, previousData: antes1 },
            { entityType: 'feature', operationType: 'delete', entityId: f2, mapId, data: null, previousData: antes2 },
            { entityType: 'layer', operationType: 'delete', entityId: camada.id, mapId },
        ]);
        const r1 = await api.pushOperations(atlasId, desfazer);
        expect(r1.results.every((r) => r.success), JSON.stringify(r1.results)).toBe(true);

        let mapa = await retrato(api, atlasId, mapId);
        expect(mapa.layers.map((l) => l.id), 'a camada saiu no servidor').not.toContain(camada.id);
        expect(mapa.features.points.map((f) => f.properties.id)).not.toEqual(expect.arrayContaining([f1]));

        const refazer = createBatchOperations([
            { entityType: 'layer', operationType: 'create', entityId: camada.id, mapId, data: camada },
            { entityType: 'feature', operationType: 'create', entityId: f1, mapId, data: ponto(f1, camada.id, [0, 0]), previousData: ponto(f1, camada.id, [0, 0]), featureIntent: 'restore' },
            { entityType: 'feature', operationType: 'create', entityId: f2, mapId, data: ponto(f2, camada.id, [1, 1]), previousData: ponto(f2, camada.id, [1, 1]), featureIntent: 'restore' },
        ]);
        // O encadeamento que o despachante carimba: a restauração nomeia a exclusão que ela desfaz.
        refazer[1].baseOperationId = desfazer[0].id;
        refazer[2].baseOperationId = desfazer[1].id;
        const r2 = await api.pushOperations(atlasId, refazer);
        expect(r2.results.every((r) => r.success), JSON.stringify(r2.results)).toBe(true);

        mapa = await retrato(api, atlasId, mapId);
        const devolvida = mapa.layers.find((l) => l.id === camada.id);
        expect(devolvida, 'a camada voltou com o MESMO id').toBeTruthy();
        expect(devolvida.name).toBe(camada.name);
        const pontos = mapa.features.points.filter((f) => f.properties.layerId === camada.id).map((f) => f.properties.id);
        expect(pontos.sort()).toEqual([f1, f2].sort());
    });
});

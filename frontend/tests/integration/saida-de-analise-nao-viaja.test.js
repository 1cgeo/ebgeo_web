// Path: tests/integration/saida-de-analise-nao-viaja.test.js

/**
 * @fileoverview O despachante descarta a escrita de uma SAÍDA de análise pelo TIPO, e só por ele.
 *
 * A saída (`processed_*`) é derivada por cada cliente (`src/js/store/analysis-output.js`), e o id
 * dela (`<entrada>-visible`) não é UUID: enviada, o servidor a recusa e o autor fica com a recusa
 * para sempre. Três coisas que este arquivo prende sobre `persistOperationIntents`:
 *
 * - uma transação que SÓ reescreve a saída é escrita local legítima num atlas de servidor, e não
 *   "edição sem identidade" (que lança `OperationIntentRefusedError`);
 * - a entrada da mesma transação continua indo para a fila;
 * - um id não-UUID de OUTRO tipo continua saindo (o servidor o recusa alto), porque a regra é por
 *   tipo, nunca pelo formato do id.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { activateScope, getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import { persistOperationIntents, enableOperationLogging, disableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';

afterEach(() => disableOperationLogging());

const MAPA = '77777777-7777-4777-8777-777777777777';
const LOS = '11111111-1111-4111-8111-111111111111';

const feicao = (id, source, extra = {}) => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    properties: { id, source, ...extra },
});

async function escopoLimpo(atlasId) {
    const scope = remoteScope(atlasId);
    activateScope(scope);
    await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    enableOperationLogging();
    return scope;
}

describe('saida de analise nao viaja', () => {
    it('transacao que so escreve a saida: nao lanca e nao enfileira nada', async () => {
        const scope = await escopoLimpo('88888888-8888-4888-8888-888888888888');
        const materializar = await persistOperationIntents([
            { entityType: 'feature', operationType: 'create', entityId: `${LOS}-visible`, mapId: MAPA,
                data: feicao(`${LOS}-visible`, 'los'), previousData: null, storage: 'processed_los' },
            { entityType: 'feature', operationType: 'update', entityId: `${LOS}-obstructed`, mapId: MAPA,
                data: feicao(`${LOS}-obstructed`, 'los', { color: '#FF0000' }),
                previousData: feicao(`${LOS}-obstructed`, 'los'), storage: 'processed_los' },
        ], { scope });
        expect(materializar).toBeUndefined();
        expect(await new OperationQueue(scope).count()).toBe(0);
    });

    it('a entrada da mesma transacao continua indo; a saida de viewshed tambem fica', async () => {
        const scope = await escopoLimpo('99999999-9999-4999-8999-999999999999');
        await (await persistOperationIntents([
            { entityType: 'feature', operationType: 'create', entityId: LOS, mapId: MAPA,
                data: feicao(LOS, 'los'), previousData: null, storage: 'los' },
            { entityType: 'feature', operationType: 'delete', entityId: `${LOS}-visible`, mapId: MAPA,
                data: null, previousData: feicao(`${LOS}-visible`, 'visibility'), storage: 'processed_visibility' },
        ], { scope }))();
        const fila = await new OperationQueue(scope).getAll();
        expect(fila.map((op) => op.entityId)).toEqual([LOS]);
    });

    it('id nao-UUID de OUTRO tipo continua saindo: a regra e por tipo, nao pelo formato', async () => {
        const scope = await escopoLimpo('66666666-6666-4666-8666-666666666666');
        await (await persistOperationIntents([
            { entityType: 'feature', operationType: 'create', entityId: 'nao-e-uuid', mapId: MAPA,
                data: feicao('nao-e-uuid', 'line'), previousData: null, storage: 'lines' },
        ], { scope }))();
        const fila = await new OperationQueue(scope).getAll();
        expect(fila.map((op) => op.entityId)).toEqual(['nao-e-uuid']);
        // O carimbo de balde e só para a decisão local: ele não viaja no envelope.
        expect(Object.hasOwn(fila[0], 'storage')).toBe(false);
    });

    it('as saidas que um cliente ANTIGO enfileirou (sem carimbo) saem da fila, com a recusa duravel, e so elas', async () => {
        const scope = await escopoLimpo('55555555-5555-4555-8555-555555555555');
        // Sem `storage`: e' a forma que uma versao anterior a 2026-09-23 gravou no diario.
        await (await persistOperationIntents([
            { entityType: 'feature', operationType: 'create', entityId: `${LOS}-visible`, mapId: MAPA,
                data: feicao(`${LOS}-visible`, 'los'), previousData: null },
        ], { scope }))();
        await (await persistOperationIntents([
            { entityType: 'feature', operationType: 'create', entityId: `${LOS}-obstructed`, mapId: MAPA,
                data: feicao(`${LOS}-obstructed`, 'visibility'), previousData: null },
            { entityType: 'feature', operationType: 'create', entityId: LOS, mapId: MAPA,
                data: feicao(LOS, 'los'), previousData: null },
            { entityType: 'feature', operationType: 'create', entityId: 'linha-visible', mapId: MAPA,
                data: feicao('linha-visible', 'line'), previousData: null },
        ], { scope }))();
        const fila = new OperationQueue(scope);
        const [recusada] = await fila.getAll();
        await fila.recordIssue(recusada, { rejected: true, success: false, reason: 'Alteração descartada: identificador ou valor com formato inválido.' });
        expect((await fila.countByState()).problemas, 'a premissa: a recusa duravel esta la').toBeGreaterThan(0);

        expect(await fila.discardDerivedOutputOperations()).toBe(2);

        const resto = await new OperationQueue(scope).getAll();
        // A entrada fica; o id nao-UUID de OUTRO tipo (linha) fica tambem, e o servidor o recusa alto.
        expect(resto.map((op) => op.entityId).sort()).toEqual([LOS, 'linha-visible'].sort());
        expect(await new OperationQueue(scope).getIssues()).toEqual([]);
        expect((await new OperationQueue(scope).countByState()).problemas).toBe(0);
        // Idempotente: uma segunda passada nao acha nada.
        expect(await new OperationQueue(scope).discardDerivedOutputOperations()).toBe(0);
    });
});

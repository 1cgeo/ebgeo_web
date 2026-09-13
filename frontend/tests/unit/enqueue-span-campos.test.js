// Path: tests/unit/enqueue-span-campos.test.js

/**
 * @fileoverview O SPAN `enqueue` DO CAMINHO WRITE-AHEAD CARREGA OS MESMOS CAMPOS DOS IRMÃOS.
 *
 * O DEFEITO QUE ESTE ARQUIVO PRENDE. `persistOperationIntents` emitia o span de `enqueue` com
 * `{opId, traceId, entityType, entityId, outcome}` e nada mais, enquanto `logOperation` e
 * `logBatchOperations`, no mesmo arquivo, emitiam também `operationType`, `mapId`, `batchId` e
 * `lamportTimestamp`. Todo leitor de `enqueue` estreita por `operationType`
 * (`waitForEntitySpan`, em `tests/e2e-ui/helpers/trace-helpers.js`), então o span nunca casava e
 * a espera estourava dizendo que a op JAMAIS foi enfileirada, quando ela tinha sido. Custou 5
 * casos de collab na primeira rodada completa de Playwright.
 *
 * A ASSERÇÃO É DE ESPELHO, e é isso que a mantém viva nos dois sentidos: ela compara o CONJUNTO
 * DE CHAVES do span dos três emissores, então um campo novo posto só num deles reprova, e não só
 * o buraco de hoje. Ela leva junto asserção ABSOLUTA dos valores, porque comparar dois spans
 * sozinho passaria verde com os dois errados do mesmo jeito.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { activateScope, getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import {
    persistOperationIntents,
    logBatchOperations,
    logOperation,
    enableOperationLogging,
    disableOperationLogging,
} from '../../src/js/store/sync/operation-dispatcher.js';
import { setTracing, clearTrace, getTrace } from '../../src/js/store/sync/diag/trace-core.js';
import { TraceStage, TraceOutcome } from '../../src/js/store/sync/diag/trace-stages.js';

const MAP_ID = '55555555-5555-4555-8555-555555555555';
const FEATURE_ID = '66666666-6666-4666-8666-666666666666';

let scope;

beforeEach(async () => {
    scope = remoteScope('11111111-1111-4111-8111-111111111111');
    await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    activateScope(scope);
    enableOperationLogging();
    setTracing(true);
    clearTrace();
});

afterEach(() => {
    disableOperationLogging();
    setTracing(false);
    clearTrace();
});

/** @returns {Array<Object>} The `enqueue` spans captured so far, oldest first. */
function enqueueSpans() {
    return getTrace(s => s.stage === TraceStage.ENQUEUE);
}

/** @returns {Array<string>} Span keys minus the envelope every span carries. */
function payloadKeys(span) {
    const envelope = new Set(['v', 'seq', 'monoTs', 'ts', 'clientId', 'stage']);
    return Object.keys(span).filter(k => !envelope.has(k)).sort();
}

it('o span de enqueue do write-ahead nomeia a operação, o mapa, o lote e o relógio', async () => {
    const materialize = await persistOperationIntents([{
        entityType: 'feature', operationType: 'create', entityId: FEATURE_ID, mapId: MAP_ID,
        data: { id: FEATURE_ID },
    }], { scope, traceId: 'gesto-1' });
    await materialize?.();

    const spans = enqueueSpans();
    expect(spans).toHaveLength(1);
    // Absolutos: sem eles, um espelho de dois spans vazios passaria verde.
    expect(spans[0].entityType).toBe('feature');
    expect(spans[0].operationType).toBe('create');
    expect(spans[0].entityId).toBe(FEATURE_ID);
    expect(spans[0].mapId).toBe(MAP_ID);
    expect(spans[0].traceId).toBe('gesto-1');
    expect(spans[0].outcome).toBe(TraceOutcome.OK);
    expect(spans[0].opId).toEqual(expect.any(String));
    expect(spans[0].batchId).toEqual(expect.any(String));
    expect(spans[0].lamportTimestamp).toEqual(expect.any(Number));
});

it('os três emissores de enqueue do despachante descrevem a op com o mesmo conjunto de campos', async () => {
    await persistOperationIntents([{
        entityType: 'feature', operationType: 'create', entityId: FEATURE_ID, mapId: MAP_ID,
        data: { id: FEATURE_ID },
    }], { scope, traceId: 'gesto-1' });
    await logBatchOperations([{
        entityType: 'feature', operationType: 'update', entityId: FEATURE_ID, mapId: MAP_ID,
        data: { id: FEATURE_ID },
    }]);
    await logOperation('feature', 'delete', FEATURE_ID, MAP_ID, null, { id: FEATURE_ID });

    const spans = enqueueSpans();
    expect(spans).toHaveLength(3);
    const [writeAhead, batch, single] = spans;
    // O campo que o defeito custou, afirmado por nome nos três antes da comparação de conjuntos:
    // um conjunto igual e VAZIO nos três também seria "igual".
    for (const span of spans) {
        expect(span.operationType, `span ${span.stage} sem operationType`).toBeTruthy();
        expect(span.mapId).toBe(MAP_ID);
    }
    // `lamportTimestamp` só o emissor de op única e o write-ahead publicam hoje; o conjunto
    // comparado é o do write-ahead contra a UNIÃO dos dois legados, que é o contrato real.
    const legado = new Set([...payloadKeys(batch), ...payloadKeys(single)]);
    for (const key of payloadKeys(writeAhead)) {
        expect(legado.has(key), `o write-ahead publica "${key}" e nenhum irmão publica`).toBe(true);
    }
    for (const key of legado) {
        expect(payloadKeys(writeAhead).includes(key), `os irmãos publicam "${key}" e o write-ahead não`).toBe(true);
    }
});

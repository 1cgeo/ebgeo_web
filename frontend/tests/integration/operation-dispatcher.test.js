import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localforage before importing dispatcher (operation-queue uses it)
vi.mock('localforage', () => {
    const store = new Map();
    return {
        default: {
            createInstance: () => ({
                setItem: vi.fn(async (key, value) => { store.set(key, value); }),
                getItem: vi.fn(async (key) => store.get(key) ?? null),
                removeItem: vi.fn(async (key) => { store.delete(key); }),
                keys: vi.fn(async () => [...store.keys()]),
                clear: vi.fn(async () => { store.clear(); })
            })
        }
    };
});

// Mock store-errors
vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_SYNC_ERROR: 'store:syncError',
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked'
    },
    emitStoreError: vi.fn()
}));

// Mock localStorage for operation-factory
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (key) => store[key] ?? null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; }
    };
})();
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });
}

import {
    enableOperationLogging,
    disableOperationLogging,
    isOperationLoggingEnabled,
    logOperation,
    logFeatureOperation,
    logMapOperation,
    logBaseLayerOperation,
    logBatchOperations,
    persistOperationIntents,
    OperationIntentRefusedError
} from '../../src/js/store/sync/operation-dispatcher.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { emitStoreError, StoreErrorEvents } from '../../src/js/store/store-errors.js';
import { activateScope, clearActiveScope, remoteScope, localScope } from '../../src/js/store/atlas-namespace.js';
import { setTracing, clearTrace, getTrace } from '../../src/js/store/sync/diag/trace-core.js';
import { TraceStage, TraceOutcome, DropReason } from '../../src/js/store/sync/diag/trace-stages.js';

beforeEach(async () => {
    disableOperationLogging();
    clearActiveScope();
    setTracing(false);
    clearTrace();
    vi.clearAllMocks();
    localStorageMock.clear();
});

// ============================================================================
// Enable/disable toggle
// ============================================================================

describe('Operation logging toggle', () => {
    it('starts disabled', () => {
        expect(isOperationLoggingEnabled()).toBe(false);
    });

    it('can be enabled and disabled', () => {
        enableOperationLogging();
        expect(isOperationLoggingEnabled()).toBe(true);
        disableOperationLogging();
        expect(isOperationLoggingEnabled()).toBe(false);
    });
});

// ============================================================================
// Logging when disabled
// ============================================================================

describe('Logging when disabled', () => {
    it('logFeatureOperation does nothing when disabled', async () => {
        disableOperationLogging();
        await logFeatureOperation(OperationType.CREATE, 'f1', 'map-1', { nome: 'test' });
        const count = await operationQueue.count();
        expect(count).toBe(0);
    });

    it('logBatchOperations does nothing when disabled', async () => {
        disableOperationLogging();
        await logBatchOperations([
            { entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f1' }
        ]);
        const count = await operationQueue.count();
        expect(count).toBe(0);
    });
});

// ============================================================================
// Logging when enabled
// ============================================================================

describe('Logging when enabled', () => {
    beforeEach(async () => {
        enableOperationLogging();
        await operationQueue.clear();
    });

    it('logFeatureOperation enqueues operation', async () => {
        await logFeatureOperation(OperationType.CREATE, 'f1', '4a22f7df-df6d-47df-80bb-f26df86d31ec', { nome: 'Ponto A' });
        const count = await operationQueue.count();
        expect(count).toBe(1);

        const ops = await operationQueue.peek(1);
        expect(ops[0].entityType).toBe('feature');
        expect(ops[0].operationType).toBe(OperationType.CREATE);
        expect(ops[0].entityId).toBe('f1');
        expect(ops[0].data.nome).toBe('Ponto A');
    });

    it('logMapOperation enqueues with null mapId for atlas-level', async () => {
        await logMapOperation(OperationType.CREATE, 'map-1', { name: 'Mapa 1' });
        const ops = await operationQueue.peek(1);
        expect(ops[0].entityType).toBe('map');
        expect(ops[0].mapId).toBeNull();
    });

    // Regression — bug D: a map-setting op (baseLayer/mapPosition/mapNotes) keyed by a
    // NON-UUID map id (e.g. the local "Principal" default) can never be pushed; the
    // backend rejects the non-UUID id and that one op fails the ENTIRE flush batch,
    // blocking all sync. Such ops must NOT be enqueued.
    it('logBaseLayerOperation skips a non-UUID map id (un-syncable — would poison the flush)', async () => {
        await logBaseLayerOperation(OperationType.UPDATE, 'Principal', { baseLayer: 'osm' });
        expect(await operationQueue.count()).toBe(0);
    });

    it('logBaseLayerOperation enqueues for a real UUID map id', async () => {
        const mapId = '4a22f7df-df6d-47df-80bb-f26df86d31ec';
        await logBaseLayerOperation(OperationType.UPDATE, mapId, { baseLayer: 'osm' });

        const ops = await operationQueue.peek(1);
        expect(await operationQueue.count()).toBe(1);
        expect(ops[0].entityType).toBe('baseLayer');
        expect(ops[0].entityId).toBe(mapId);
        expect(ops[0].mapId).toBe(mapId);
    });

    // Regression — bug D (extended to feature/layer/group): an op whose CONTEXT mapId is not
    // a UUID (a feature on the local 'Principal' map, which is name-keyed) can never be
    // pushed and would poison the flush batch. logOperation must drop it before enqueue.
    it('logFeatureOperation skips a non-UUID context mapId', async () => {
        await logFeatureOperation(OperationType.CREATE, 'f1', 'Principal', { nome: 'Ponto A' });
        expect(await operationQueue.count()).toBe(0);
    });

    // Regression — bug D (extended): a SETTING op keyed by a non-UUID LOCAL key (e.g.
    // 'lastActiveMap', the per-client active map) can never be pushed — the backend
    // rejects it (22P02) and that one op fails the whole flush batch, blocking sync.
    it('logOperation skips a SETTING op with a non-UUID local key', async () => {
        await logOperation(EntityType.SETTING, OperationType.UPDATE, 'lastActiveMap', null, { value: 'Mapa A' });
        expect(await operationQueue.count()).toBe(0);
    });

    it('logOperation enqueues a SETTING op scoped to the atlas (UUID id or "atlas" sentinel)', async () => {
        await logOperation(EntityType.SETTING, OperationType.UPDATE, '1b2d5b48-d232-4672-b6ce-fee86375df52', null, { mapBadgeColors: {} });
        await logOperation(EntityType.SETTING, OperationType.UPDATE, 'atlas', null, { customIcons: [] });
        expect(await operationQueue.count()).toBe(2);
    });

    it('logBatchOperations enqueues all operations', async () => {
        const mapId = '4a22f7df-df6d-47df-80bb-f26df86d31ec';
        await logBatchOperations([
            { entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f1', mapId },
            { entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f2', mapId }
        ]);
        const count = await operationQueue.count();
        expect(count).toBe(2);
    });

    // Regression — bug D for the BATCH path: a batch op with a non-UUID mapId can never be
    // pushed and would poison the whole flush batch. Such ops are dropped before enqueue.
    it('logBatchOperations drops batch ops with a non-UUID mapId', async () => {
        await logBatchOperations([
            { entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f1', mapId: 'Principal' },
            { entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f2', mapId: '4a22f7df-df6d-47df-80bb-f26df86d31ec' }
        ]);
        expect(await operationQueue.count()).toBe(1); // only the UUID-mapId op survives
    });
});

// ============================================================================
// F7 — a janela do dispatcher: escopo remoto com o registro desligado
// ============================================================================

const remoteAtlas = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
const uuidMap = '4a22f7df-df6d-47df-80bb-f26df86d31ec';

describe('F7 — registro desligado em escopo remoto', () => {
    it('o produtor antigo (logOperation) emite STORE_OPERATION_BLOCKED em vez de voltar mudo', async () => {
        activateScope(remoteScope(remoteAtlas));
        disableOperationLogging();

        await logFeatureOperation(OperationType.CREATE, 'f1', uuidMap, { nome: 'Ponto A' });

        expect(emitStoreError).toHaveBeenCalledWith(
            StoreErrorEvents.STORE_OPERATION_BLOCKED,
            expect.objectContaining({ reason: DropReason.LOGGING_DISABLED, entityId: 'f1' })
        );
    });

    it('o lote antigo tambem fala, e nomeia a contagem', async () => {
        activateScope(remoteScope(remoteAtlas));
        disableOperationLogging();

        await logBatchOperations([
            { entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f1', mapId: uuidMap }
        ]);

        expect(emitStoreError).toHaveBeenCalledWith(
            StoreErrorEvents.STORE_OPERATION_BLOCKED,
            expect.objectContaining({ reason: DropReason.LOGGING_DISABLED, operation: 'batch (1 ops)' })
        );
    });

    // A METADE QUE NAO PODE FALAR. Atlas local nao tem fila de envio, entao o registro
    // desligado ali e' o estado normal: um aviso a cada edicao local seria ruido, e ruido e'
    // o que faz a pessoa parar de ler o aviso que importa.
    it('em atlas LOCAL o mesmo caminho segue silencioso', async () => {
        activateScope(localScope('local-1', 'local-1'));
        disableOperationLogging();

        await logFeatureOperation(OperationType.CREATE, 'f1', uuidMap, { nome: 'Ponto A' });

        expect(emitStoreError).not.toHaveBeenCalled();
    });

    it('persistOperationIntents recusa a edicao remota e nao devolve undefined', async () => {
        const scope = remoteScope(remoteAtlas);
        activateScope(scope);
        disableOperationLogging();

        await expect(persistOperationIntents(
            [{ entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f1', mapId: uuidMap }],
            { scope }
        )).rejects.toBeInstanceOf(OperationIntentRefusedError);
    });
});

// O FILTRO DE IDENTIDADE VOLTOU A DEIXAR RASTRO. O caminho antigo (`logOperation`) sempre
// registrou `preflush.drop`; o caminho write-ahead descartava calado, e uma op que some sem
// linha nenhuma e' indistinguivel de uma op que nunca foi pedida.
describe('F7 — filtro de identidade no caminho write-ahead', () => {
    it('registra PREFLUSH_DROP com NON_UUID_MAPID e mantem as demais descricoes', async () => {
        const scope = remoteScope(remoteAtlas);
        activateScope(scope);
        enableOperationLogging();
        await operationQueue.forScope(scope).clear();
        setTracing(true);
        clearTrace();

        await persistOperationIntents([
            { entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f1', mapId: 'Principal' },
            { entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f2', mapId: uuidMap }
        ], { scope });

        const drops = getTrace(s => s.stage === TraceStage.PREFLUSH_DROP);
        expect(drops).toHaveLength(1);
        expect(drops[0]).toMatchObject({
            entityId: 'f1', mapId: 'Principal',
            outcome: TraceOutcome.DROPPED, reason: DropReason.NON_UUID_MAPID
        });
        // A descricao sadia sobreviveu: o filtro descarta uma, nao o gesto inteiro. Ela entra
        // PREPARADA (o diario antecede a entidade), e `count()` responde so o enviavel, entao
        // a prova e a contagem por estado, nao a contagem de envio.
        const estados = await operationQueue.forScope(scope).countByState();
        expect(estados.preparadas).toBe(1);
        expect(estados.pendentes + estados.preparadas + estados.problemas).toBe(1);
    });

    it('registra NON_UUID_SETTING_ID para uma chave local de setting', async () => {
        const scope = remoteScope(remoteAtlas);
        activateScope(scope);
        enableOperationLogging();
        await operationQueue.forScope(scope).clear();
        setTracing(true);
        clearTrace();

        await expect(persistOperationIntents(
            [{ entityType: EntityType.SETTING, operationType: OperationType.UPDATE, entityId: 'lastActiveMap', mapId: null }],
            { scope }
        )).rejects.toBeInstanceOf(OperationIntentRefusedError);

        const drops = getTrace(s => s.stage === TraceStage.PREFLUSH_DROP);
        expect(drops).toHaveLength(1);
        expect(drops[0]).toMatchObject({
            entityId: 'lastActiveMap', reason: DropReason.NON_UUID_SETTING_ID
        });
    });
});

// ============================================================================
// Error handling
// ============================================================================

describe('Dispatcher error handling', () => {
    it('emits STORE_SYNC_ERROR on queue failure', async () => {
        enableOperationLogging();

        // Make queue fail
        const origEnqueue = operationQueue.enqueue.bind(operationQueue);
        operationQueue.enqueue = vi.fn().mockRejectedValue(new Error('DB full'));

        await logFeatureOperation(OperationType.CREATE, 'f1', '4a22f7df-df6d-47df-80bb-f26df86d31ec');

        expect(emitStoreError).toHaveBeenCalledWith(
            'store:syncError',
            expect.objectContaining({
                operation: 'create feature',
                entityId: 'f1'
            })
        );

        // Restore
        operationQueue.enqueue = origEnqueue;
    });
});

// ============================================================================
// Encadeamento de edicoes dependentes, para TODA entidade que declara base
// ============================================================================

/**
 * O ENCADEAMENTO ERA SO DE FEICAO, e a declaracao de base ja era de todo mundo.
 *
 * Quem escreve duas vezes na mesma camada antes de o primeiro recibo voltar declara nas DUAS ops
 * a base que a PRIMEIRA observou, porque quem move o `confirmedVersion` do documento local e o
 * recibo. O servidor aplica a primeira, leva a fronteira da unidade adiante e recusa a segunda
 * nomeando a unidade que a primeira acabou de mover: o autor perde para si mesmo. O remedio ja
 * existia no servidor (`baseOperationId` -> `resolveObservedBase`), e o cliente nao o carimbava
 * fora da feicao. O contrato do servidor esta medido em
 * `tests/e2e/edicao-encadeada-por-entidade.e2e.test.js`; aqui fica o carimbo.
 */
describe('edicao dependente: `baseOperationId` para entidade que nao e feicao', () => {
    const camada = 'b0f2a4d6-3c11-4d0a-9a6e-3f0f7c1d5e21';

    /** Uma descricao de update de camada, com ou sem base confirmada no documento anterior. */
    const edicao = (mudanca, base) => ({
        entityType: EntityType.LAYER,
        operationType: OperationType.UPDATE,
        entityId: camada,
        mapId: uuidMap,
        data: { id: camada, name: 'Alfa', opacity: 1, ...mudanca },
        previousData: { id: camada, name: 'Alfa', opacity: 1, ...(base === null ? {} : { confirmedVersion: base }) }
    });

    it('a segunda edicao aponta para a PRIMEIRA, que ainda esta pendente', async () => {
        const scope = remoteScope(remoteAtlas);
        activateScope(scope);
        enableOperationLogging();
        const fila = operationQueue.forScope(scope);
        await fila.clear();

        const materializar = await persistOperationIntents([edicao({ name: 'Beta' }, 3)], { scope });
        await materializar?.();
        const materializar2 = await persistOperationIntents([edicao({ opacity: 0.55 }, 3)], { scope });
        await materializar2?.();

        const enfileiradas = await fila.peek(10);
        expect(enfileiradas).toHaveLength(2);
        const [primeira, segunda] = enfileiradas;
        // PISO: as duas declaram a MESMA base, que e o que faz desta a edicao dependente. Sem
        // esta linha o caso passaria verde medindo duas edicoes independentes.
        expect(primeira.baseVersion).toBe(3);
        expect(segunda.baseVersion).toBe(3);
        expect(primeira.baseOperationId).toBeUndefined();
        expect(segunda.baseOperationId).toBe(primeira.id);
        expect(segunda.dependsOn).toEqual([primeira.id]);
    });

    it('SEM base declarada nao ha encadeamento: a op continua sendo aplicada por chegada', async () => {
        // O ESTREITAMENTO E DELIBERADO. Um `baseOperationId` sozinho TROCA o regime de chegada por
        // uma recusa quando o recibo do antecessor nao for encontrado, entao so quem ja declara
        // base e encadeado: a mudanca nao pode recusar o que hoje se aplica.
        const scope = remoteScope(remoteAtlas);
        activateScope(scope);
        enableOperationLogging();
        const fila = operationQueue.forScope(scope);
        await fila.clear();

        (await persistOperationIntents([edicao({ name: 'Beta' }, null)], { scope }))?.();
        const materializar = await persistOperationIntents([edicao({ opacity: 0.55 }, null)], { scope });
        await materializar?.();

        const enfileiradas = await fila.peek(10);
        expect(enfileiradas).toHaveLength(2);
        expect(enfileiradas[0].baseVersion).toBeNull();
        expect(enfileiradas[1].baseVersion).toBeNull();
        expect(enfileiradas[1].baseOperationId).toBeUndefined();
    });
});

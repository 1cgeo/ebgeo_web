// Path: tests/integration/recovery-sync-engine.test.js
import { it, expect, beforeEach, vi } from 'vitest';

/**
 * Sync Engine Tests (hermetic unit).
 *
 * The orchestrator wires together HTTP (apiClient), WebSocket (wsClient), the
 * operation queue, the remote handler, and the session context. Every one of
 * those subsystems is mocked here so we exercise ONLY the routing/orchestration
 * logic: login mirrors identity, connect pulls + wires handlers + opens the WS,
 * flush drains the queue, disconnect closes the WS, and logout tears down.
 */

// ============================================================================
// Mocks (declared before the SUT import; vi.mock is hoisted)
// ============================================================================

const localStorageMock = (() => {
    const store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; }
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Shared mock state/handles. Created via vi.hoisted so they exist before the
// hoisted vi.mock factories run.
const h = vi.hoisted(() => {
    const queueState = { ops: [], dequeued: [], issues: [] };
    return {
        queueState,
        apiClientMock: {
            // O registro AINDA CARREGA `org_role` de propósito: o backend legado (e um
            // token legado) continua mandando o campo, e o contrato de hoje é que ele seja
            // IGNORADO. Um dublê que já viesse sem o campo mediria a ausência dele, não a
            // indiferença a ele, e passaria verde com a contaminação de volta.
            login: vi.fn(async () => ({ id: 'user-1', org_role: 'editor' })),
            // The real endpoint answers `{ success: true }` and nothing else, whether it
            // created the account or found the username/e-mail taken (anti-enumeration).
            // A mock echoing back a user would let a caller depend on data that never
            // arrives in production.
            register: vi.fn(async () => ({ success: true })),
            logout: vi.fn(async () => {}),
            pullSync: vi.fn(async () => ({ currentVersion: 0, isSnapshot: false })),
            pushOperations: vi.fn(async (_atlasId, ops) => ({ results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 1 })), serverVersion: 1 })),
            createAtlas: vi.fn(async (p) => ({ id: 'atlas-1', ...p })),
            setTokens: vi.fn(),
            wsUrl: vi.fn(() => 'ws://test/collab'),
        },
        configureApiClientMock: vi.fn(),
        showWarningMock: vi.fn(),
        wsClientMock: {
            _handlers: {},
            on: vi.fn(function (event, handler) { this._handlers[event] = handler; return this; }),
            connect: vi.fn(async () => ({ sessionId: 's1', userId: 'user-1', permission: 'editor', role: 'editor' })),
            disconnect: vi.fn(),
            setLastVersion: vi.fn(),
            isConnected: vi.fn(() => false),
        },
        operationQueueMock: {
            peek: vi.fn(async (count) => queueState.ops.slice(0, count)),
            recordIssue: vi.fn(async (operation, result) => {
                queueState.issues.push({ operation, result });
                queueState.ops = queueState.ops.filter(op => op.id !== operation.id);
            }),
            dequeue: vi.fn(async (ids) => {
                queueState.dequeued.push(...ids);
                queueState.ops = queueState.ops.filter(op => !ids.includes(op.id));
                return ids.length;
            }),
            // Required by the post-flush step `_reconcileConvergenceGuard`, which reads the
            // WHOLE remaining queue. This mock lacked it until 2026-08-13, so every flush
            // test threw `operationQueue.getAll is not a function` inside that step — and the
            // SUT swallows it in a `catch`. The suite stayed green over a branch that never
            // executed. It returns a COPY: the SUT must not be able to mutate the fixture.
            getAll: vi.fn(async () => queueState.ops.slice()),
        },
        enableOperationLogging: vi.fn(),
        disableOperationLogging: vi.fn(),
        // `isAuthenticated` entrou junto com a soma dos recursos concedidos: o
        // `disconnect` a consulta para decidir se re-soma a concessão PESSOAL (que
        // não depende de atlas nenhum). Um mock sem ela derruba o disconnect inteiro
        // num TypeError, que é o modo de falha que um mock parcial sempre teve.
        // `updateRole` entrou com o handler de troca de dono: ele re-resolve o papel
        // LOCALMENTE a partir do frame. Sem ele no dublê, o handler morre num TypeError
        // antes de chegar à re-soma, e o caso mediria o TypeError, não a re-soma.
        sessionContextMock: {
            setSession: vi.fn(), clearSession: vi.fn(), updateRole: vi.fn(),
            isAuthenticated: vi.fn(() => false),
            // O PAPEL E DO ATLAS E SAI COM ELE: `disconnect` o esquece, para que o `owner`
            // do atlas A nao valha na janela de conexao do atlas B (2026-08-25).
            forgetAtlasRole: vi.fn(),
        },
        applyRemoteOperation: vi.fn(async () => {}),
        applyRemoteSnapshot: vi.fn(async () => {}),
        setRemoteHandlerEventBus: vi.fn(),
        // The other half of the convergence guard the engine drives: it seeds the author's
        // own applied serverVersion from the push ack, and self-heals the pending-edit map
        // after each flush. Both were MISSING from the mock, so `recordPushAcks` and
        // `_reconcileConvergenceGuard` blew up on `undefined`.
        recordLocalAppliedVersion: vi.fn(),
        reconcilePendingLocalEdits: vi.fn(async () => {}),
        syncGatewayMock: {
            setRemoteOperationHandler: vi.fn(),
            applyRemoteOperation: vi.fn(async () => {}),
        },
        eventBusMock: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        // syncResponse only arrives while connected; the engine now gates its apply on this.
        connectionStateMock: { isOnline: vi.fn(() => true) },
        // A SOMA DOS RECURSOS PRIVADOS PRECISA DE DUBLÊ, e não é conveniência.
        // Sem ele o módulo real roda contra o `apiClient` dublado (que não tem
        // `getVisibleResources`), o TypeError cai no `catch` de best-effort do próprio
        // serviço e a chamada fica INVISÍVEL: um caso que afirmasse "não chamou" passaria
        // verde com e sem a mudança, que é a cobertura vazia nomeada na constituição.
        refreshVisibleResourcesMock: vi.fn(async () => true),
        clearVisibleResourcesMock: vi.fn(),
        setImageSyncAtlasMock: vi.fn(),
    };
});

const { queueState, apiClientMock, wsClientMock, recordLocalAppliedVersion } = h;

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: h.apiClientMock,
    configureApiClient: h.configureApiClientMock,
}));

vi.mock('../../src/js/store/sync/ws-client.js', () => ({
    wsClient: h.wsClientMock,
}));

vi.mock('../../src/js/store/sync/operation-queue.js', () => ({
    operationQueue: h.operationQueueMock,
}));

vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    enableOperationLogging: h.enableOperationLogging,
    disableOperationLogging: h.disableOperationLogging,
}));

// Só o SINGLETON é dublê. `sessionUserInfoFromMe` vem do módulo REAL de propósito: ele é a
// forma do payload de hidratação (papel por atlas, papel global e escopo de produção), e uma
// cópia escrita aqui deixaria de acompanhar a de produção sem ficar vermelha.
vi.mock('../../src/js/store/sync/session-context.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        sessionContext: h.sessionContextMock,
    };
});

// The engine imports SIX names from this module. Stubbing only three left the other three
// `undefined`, and the two code paths that use them (the push-ack version seeding and the
// post-flush reconciliation) died on a TypeError the SUT catches — silently.
// CONVERGENCE_GUARDED comes from the REAL module on purpose: it is the single source for both
// halves of the guard (here and in operation-dispatcher.js), so a hand-copied Set here would
// drift from production the next time an entity type joins it, and the drift would show up as a
// test that keeps passing.
vi.mock('../../src/js/store/sync/remote-operation-handler.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        applyRemoteOperation: h.applyRemoteOperation,
        applyRemoteSnapshot: h.applyRemoteSnapshot,
        setRemoteHandlerEventBus: h.setRemoteHandlerEventBus,
        recordLocalAppliedVersion: h.recordLocalAppliedVersion,
        reconcilePendingLocalEdits: h.reconcilePendingLocalEdits,
        CONVERGENCE_GUARDED: actual.CONVERGENCE_GUARDED,
    };
});

vi.mock('../../src/js/store/sync/sync-gateway.js', () => ({
    syncGateway: h.syncGatewayMock,
}));

vi.mock('../../src/js/store/sync/connection-state.js', () => ({
    connectionState: h.connectionStateMock,
}));

vi.mock('../../src/js/store/sync/resource-access.service.js', () => ({
    refreshVisibleResources: h.refreshVisibleResourcesMock,
    clearVisibleResources: h.clearVisibleResourcesMock,
}));

vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: vi.fn(() => h.eventBusMock),
}));

// O DESTINO DAS IMAGENS é a terceira coisa que guarda "em que atlas eu estou" (as outras duas
// são `_atlasId` e `_lastVersion`), e `disconnect({ forgetAtlas: true })` tem de zerá-lo junto.
// Ele entra como dublê só para ser OBSERVÁVEL: o módulo real escreve num ponteiro de módulo que
// nenhuma asserção alcança de fora.
vi.mock('../../src/js/store/sync/image-sync.js', () => ({
    setImageSyncAtlas: h.setImageSyncAtlasMock,
}));

// The engine warns the user when the server refuses an operation per-op.
vi.mock('../../src/js/utilities/toast_service.js', () => ({
    showWarning: h.showWarningMock,
    showToast: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showInChannel: vi.fn(),
}));

// ============================================================================
// Imports (SUT after the mocks)
// ============================================================================

import { syncEngine } from '../../src/js/store/sync/sync-engine.js';
// O barramento é dublê, mas os NOMES dos eventos vêm do módulo real: uma cópia literal
// aqui deixaria de acompanhar a de produção sem ficar vermelha.

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    queueState.ops = [];
    queueState.dequeued = [];
    queueState.issues = [];
    syncEngine._session?.close();
    syncEngine._session = null;
    wsClientMock._handlers = {};
    // Reset orchestrator internal state between tests.
    syncEngine._atlasId = null;
    syncEngine._lastVersion = 0;
    syncEngine._handlersWired = false;
    apiClientMock.pullSync.mockResolvedValue({ currentVersion: 0, isSnapshot: false });
    // `vi.clearAllMocks()` clears CALLS, not implementations, so a `mockRejectedValue` /
    // `mockImplementation` set by one test survives into every test that follows it. The
    // poisoned-batch describe leaves a 400-rejecting push behind, and a later test that never
    // touches `pushOperations` then silently runs the isolation path instead of a clean flush
    // — passing, but proving something else. Restore the default explicitly.
    // (`mockResolvedValueOnce` in individual tests still takes precedence over this.)
    apiClientMock.pushOperations.mockImplementation(
        async (_atlasId, ops) => ({ results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 1 })), serverVersion: 1 })
    );
});

// ============================================================================
// Tests
// ============================================================================


it('AUDIT refused op must not seed local winning version',async()=>{
 queueState.ops=[{id:'audit-denied',entityType:'feature',entityId:'audit-f',operationType:'update',data:{x:2}}];
 apiClientMock.pushOperations.mockResolvedValueOnce({results:[{operationId:'audit-denied',success:false,rejected:true,reason:'locked',currentVersion:100}],serverVersion:100});
 recordLocalAppliedVersion.mockClear();
 await syncEngine.flush();
 expect(recordLocalAppliedVersion).not.toHaveBeenCalled();
});

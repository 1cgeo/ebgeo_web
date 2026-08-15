import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    const queueState = { ops: [], dequeued: [] };
    return {
        queueState,
        apiClientMock: {
            login: vi.fn(async () => ({ id: 'user-1', org_role: 'editor' })),
            // The real endpoint answers `{ success: true }` and nothing else, whether it
            // created the account or found the username/e-mail taken (anti-enumeration).
            // A mock echoing back a user would let a caller depend on data that never
            // arrives in production.
            register: vi.fn(async () => ({ success: true })),
            logout: vi.fn(async () => {}),
            pullSync: vi.fn(async () => ({ currentVersion: 0, isSnapshot: false })),
            pushOperations: vi.fn(async () => ({ results: [], acks: [], serverVersion: 1 })),
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
        sessionContextMock: { setSession: vi.fn(), clearSession: vi.fn() },
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
    };
});

const {
    queueState,
    apiClientMock,
    configureApiClientMock,
    wsClientMock,
    operationQueueMock,
    enableOperationLogging,
    disableOperationLogging,
    sessionContextMock,
    applyRemoteOperation,
    applyRemoteSnapshot,
    setRemoteHandlerEventBus,
    recordLocalAppliedVersion,
    reconcilePendingLocalEdits,
    syncGatewayMock,
    eventBusMock,
} = h;

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

vi.mock('../../src/js/store/sync/session-context.js', () => ({
    sessionContext: h.sessionContextMock,
}));

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

vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: vi.fn(() => h.eventBusMock),
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
import { setTracing, clearTrace, getTrace } from '../../src/js/store/sync/diag/trace-core.js';

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    queueState.ops = [];
    queueState.dequeued = [];
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
        async () => ({ results: [], acks: [], serverVersion: 1 })
    );
});

// ============================================================================
// Tests
// ============================================================================

describe('configure', () => {
    it('forwards options to configureApiClient', () => {
        syncEngine.configure({ baseUrl: 'http://h/api/v1', fetch: globalThis.fetch });
        expect(configureApiClientMock).toHaveBeenCalledWith({
            baseUrl: 'http://h/api/v1',
            fetch: globalThis.fetch,
        });
    });
});

describe('login', () => {
    it('logs in and mirrors identity into the session context', async () => {
        const user = await syncEngine.login({ username: 'alice', password: 'pw' });

        expect(apiClientMock.login).toHaveBeenCalledWith('alice', 'pw');
        expect(sessionContextMock.setSession).toHaveBeenCalledWith({
            userId: 'user-1',
            role: 'editor',
            globalRole: 'user',
            username: 'alice',
        });
        expect(user).toEqual({ id: 'user-1', org_role: 'editor' });
    });

    it('defaults role to viewer when org_role is absent', async () => {
        apiClientMock.login.mockResolvedValueOnce({ id: 'user-9' });
        await syncEngine.login({ username: 'bob', password: 'pw' });
        expect(sessionContextMock.setSession).toHaveBeenCalledWith({
            userId: 'user-9',
            role: 'viewer',
            globalRole: 'user',
            username: 'bob',
        });
    });

    it('forwards the global role (admin) from the login response', async () => {
        apiClientMock.login.mockResolvedValueOnce({ id: 'user-7', org_role: 'editor', role: 'admin' });
        await syncEngine.login({ username: 'root', password: 'pw' });
        expect(sessionContextMock.setSession).toHaveBeenCalledWith({
            userId: 'user-7',
            role: 'editor',
            globalRole: 'admin',
            username: 'root',
        });
    });
});

describe('register', () => {
    it('delegates to apiClient.register', async () => {
        const out = await syncEngine.register({ username: 'u', password: 'p', nome: 'N' });
        expect(apiClientMock.register).toHaveBeenCalledWith({
            username: 'u', password: 'p', nome: 'N',
        });
        expect(out).toEqual({ success: true });
    });
});

describe('connect', () => {
    it('does an initial pull, wires handlers, and opens the WS', async () => {
        apiClientMock.pullSync.mockResolvedValueOnce({
            snapshot: { maps: {} },
            currentVersion: 7,
            isSnapshot: true,
        });

        const payload = await syncEngine.connect('atlas-1');

        // Initial pull from version 0 + snapshot applied.
        expect(apiClientMock.pullSync).toHaveBeenCalledWith('atlas-1', 0);
        expect(applyRemoteSnapshot).toHaveBeenCalledWith({ maps: {} });
        expect(syncEngine.lastVersion).toBe(7);

        // Handler wiring (idempotent).
        expect(setRemoteHandlerEventBus).toHaveBeenCalledWith(eventBusMock);
        expect(syncGatewayMock.setRemoteOperationHandler).toHaveBeenCalledWith(applyRemoteOperation);
        expect(enableOperationLogging).toHaveBeenCalledTimes(1);
        expect(wsClientMock.on).toHaveBeenCalledWith('operation', expect.any(Function));
        expect(wsClientMock.on).toHaveBeenCalledWith('syncResponse', expect.any(Function));

        // WS opened with the pulled version.
        expect(wsClientMock.connect).toHaveBeenCalledWith('atlas-1', { lastVersion: 7 });
        expect(syncEngine.atlasId).toBe('atlas-1');
        expect(payload).toMatchObject({ sessionId: 's1' });
    });

    it('skips the initial pull when initialPull is false', async () => {
        await syncEngine.connect('atlas-2', { initialPull: false });
        expect(apiClientMock.pullSync).not.toHaveBeenCalled();
        expect(wsClientMock.connect).toHaveBeenCalledWith('atlas-2', { lastVersion: 0 });
    });

    // Regression — bug C: the connect payload carries the PER-ATLAS role
    // (owner/editor/viewer, mapped by the backend from the atlas permission). The
    // engine must mirror it into the session, else a self-registered owner or a
    // write-shared collaborator stays gated as 'viewer' (their global org_role) and
    // cannot edit the atlas. The old code only set the role from org_role at login.
    it('reflects the per-atlas role from the connect payload into the session', async () => {
        wsClientMock.connect.mockResolvedValueOnce({ sessionId: 's1', userId: 'user-7', permission: 'write', role: 'editor' });

        await syncEngine.connect('atlas-1', { initialPull: false });

        expect(sessionContextMock.setSession).toHaveBeenCalledWith({ userId: 'user-7', role: 'editor' });
    });

    it('promotes the atlas OWNER to the owner role on connect (not their global org_role)', async () => {
        wsClientMock.connect.mockResolvedValueOnce({ sessionId: 's1', userId: 'owner-1', permission: 'owner', role: 'owner' });

        await syncEngine.connect('atlas-1', { initialPull: false });

        expect(sessionContextMock.setSession).toHaveBeenCalledWith({ userId: 'owner-1', role: 'owner' });
    });

    // Regression — the atlas OWNER is promoted the INSTANT the snapshot lands (its atlas.sync
    // carries ownerId), BEFORE the WS handshake. This is what makes the owner's account config
    // buttons appear immediately on an F5 reconnect instead of waiting on — or being lost to —
    // the socket handshake (which used to be the only thing that applied the role).
    it('promotes the OWNER from the snapshot (before the WS handshake) when the user owns the atlas', async () => {
        sessionContextMock.userId = 'owner-9';
        sessionContextMock.username = 'Dona';
        apiClientMock.pullSync.mockResolvedValueOnce({
            snapshot: { atlas: { sync: { ownerId: 'owner-9' } }, maps: {} },
            currentVersion: 3,
            isSnapshot: true,
        });

        await syncEngine.connect('atlas-1');

        expect(sessionContextMock.setSession).toHaveBeenCalledWith({
            userId: 'owner-9', role: 'owner', username: 'Dona',
        });
    });

    it('does NOT promote from the snapshot when the user is not the atlas owner', async () => {
        sessionContextMock.userId = 'user-2';
        sessionContextMock.username = 'Colab';
        apiClientMock.pullSync.mockResolvedValueOnce({
            snapshot: { atlas: { sync: { ownerId: 'someone-else' } }, maps: {} },
            currentVersion: 3,
            isSnapshot: true,
        });
        wsClientMock.connect.mockResolvedValueOnce({ sessionId: 's1', userId: 'user-2', permission: 'write', role: 'editor' });

        await syncEngine.connect('atlas-1');

        expect(sessionContextMock.setSession).not.toHaveBeenCalledWith(
            expect.objectContaining({ role: 'owner' })
        );
    });

    it('leaves the session untouched on connect when the payload carries no role', async () => {
        wsClientMock.connect.mockResolvedValueOnce({ sessionId: 's1', userId: 'user-1', permission: null });

        await syncEngine.connect('atlas-1', { initialPull: false });

        expect(sessionContextMock.setSession).not.toHaveBeenCalled();
    });

    it('wires WS handlers only once across reconnects', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        await syncEngine.connect('atlas-1', { initialPull: false });
        // 7 events ('operation','syncResponse','atlasDeleted','atlasOwnerChanged','sharingUpdated',
        // 'atlasSettings','serverResync') wired exactly once total.
        expect(wsClientMock.on).toHaveBeenCalledTimes(7);
        // Operation logging is now enabled per authenticated connect (not in wire-once), so two
        // connects enable it twice.
        expect(enableOperationLogging).toHaveBeenCalledTimes(2);
    });

    it('on "atlas_deleted" the engine disconnects (stops chasing the dead room)', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        wsClientMock.disconnect.mockClear();
        await wsClientMock._handlers.atlasDeleted({ atlasId: 'atlas-1' });
        // disconnect() closes the socket + stops the auto-reconnect backoff.
        expect(wsClientMock.disconnect).toHaveBeenCalled();
    });

    it('routes inbound "operation" frames through the sync gateway', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        const op = { entityType: 'feature', operationType: 'create', entityId: 'f1' };
        await wsClientMock._handlers.operation(op);
        expect(syncGatewayMock.applyRemoteOperation).toHaveBeenCalledWith(op);
    });

    it('applies a snapshot syncResponse and advances lastVersion', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        await wsClientMock._handlers.syncResponse({
            isSnapshot: true,
            snapshot: { maps: { a: 1 } },
            currentVersion: 12,
        });
        expect(applyRemoteSnapshot).toHaveBeenCalledWith({ maps: { a: 1 } });
        expect(syncEngine.lastVersion).toBe(12);
        expect(wsClientMock.setLastVersion).toHaveBeenCalledWith(12);
    });

    it('applies ops from a non-snapshot syncResponse', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        const ops = [{ entityId: 'a' }, { entityId: 'b' }];
        await wsClientMock._handlers.syncResponse({ isSnapshot: false, ops, currentVersion: 3 });
        expect(applyRemoteOperation).toHaveBeenCalledTimes(2);
        expect(syncEngine.lastVersion).toBe(3);
    });

    // ========================================================================
    // Structural marker ops (backend maps.service.js MAP_MERGE_ENTITY_TYPE)
    // ========================================================================
    // A map merge moves rows in bulk over REST, so no per-entity op describes it.
    // Live peers learn of it from the `maps_merged` broadcast; a peer that was
    // OFFLINE during the merge only sees the marker op in its reconnect replay, and
    // must answer it with a snapshot. Applying the tail would leave it stale — which
    // is what happened before the marker existed, except the replay was then empty
    // and the peer believed it was up to date.

    it('a map_merge marker in the replay triggers a resync instead of a per-op apply', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        apiClientMock.pullSync.mockClear();
        applyRemoteOperation.mockClear();

        apiClientMock.pullSync.mockResolvedValueOnce({
            snapshot: { maps: { merged: true } },
            currentVersion: 42,
        });

        await wsClientMock._handlers.syncResponse({
            isSnapshot: false,
            ops: [
                { entityType: 'feature', entityId: 'f1' },
                { entityType: 'map_merge', entityId: 'dest-1', data: { destMapId: 'dest-1' } },
            ],
            currentVersion: 9,
        });

        // Snapshot from version 0 — the marker cannot be applied entity by entity.
        expect(apiClientMock.pullSync).toHaveBeenCalledWith('atlas-1', 0);
        expect(applyRemoteSnapshot).toHaveBeenCalledWith({ maps: { merged: true } });
        expect(applyRemoteOperation).not.toHaveBeenCalled();
        // The version comes from the snapshot, not from the superseded tail.
        expect(syncEngine.lastVersion).toBe(42);
    });

    it('an ordinary replay is unaffected by the marker check', async () => {
        // Guards the blast radius: the resync must fire only on the marker, not on
        // every batch, or each reconnect would drag a full snapshot.
        await syncEngine.connect('atlas-1', { initialPull: false });
        apiClientMock.pullSync.mockClear();
        applyRemoteOperation.mockClear();

        await wsClientMock._handlers.syncResponse({
            isSnapshot: false,
            ops: [{ entityType: 'feature', entityId: 'f1' }, { entityType: 'layer', entityId: 'l1' }],
            currentVersion: 7,
        });

        expect(apiClientMock.pullSync).not.toHaveBeenCalled();
        expect(applyRemoteOperation).toHaveBeenCalledTimes(2);
        expect(syncEngine.lastVersion).toBe(7);
    });
});

// ============================================================================
// Per-operation policy denials (backend sync.service.js operationDenialReason)
// ============================================================================
// The server acks a refused operation with 200 + `rejected` + `reason` so ONE denial
// no longer rolls back its siblings and no longer freezes the outbound queue forever.
// Dequeuing it is correct — retrying a policy denial can never succeed — but doing so
// SILENTLY is its own defect: the entity is already gone from the local store, the
// server kept it, and the next snapshot brings it back with no explanation. The user
// watches their action undo itself minutes later. The server sends `reason` precisely
// so the client can say why.

describe('rejected operations are surfaced to the user', () => {
    it('warns with the server reason when an op is refused', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        // No entityType/entityId on purpose: the convergence-guard bookkeeping is
        // exercised in its own describe below. This test is about whether the refusal
        // reaches the user.
        queueState.ops = [{ id: 'op-1' }];
        apiClientMock.pushOperations.mockResolvedValueOnce({
            results: [{
                operationId: 'op-1',
                success: false,
                rejected: true,
                reason: 'Apenas o dono ou um co-Gestor do atlas pode excluir um mapa',
            }],
            serverVersion: 5,
        });

        await syncEngine.flush();

        expect(h.showWarningMock).toHaveBeenCalledWith(
            'Apenas o dono ou um co-Gestor do atlas pode excluir um mapa'
        );
        // Still dequeued: a policy denial must not be retried forever.
        expect(queueState.dequeued).toContain('op-1');
    });

    it('does not warn when everything was accepted', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }];
        apiClientMock.pushOperations.mockResolvedValueOnce({
            results: [
                { operationId: 'op-1', success: true },
                { operationId: 'op-2', success: true },
            ],
            serverVersion: 6,
        });

        await syncEngine.flush();
        expect(h.showWarningMock).not.toHaveBeenCalled();
    });

    it('collapses repeated reasons into a single warning', async () => {
        // A batch can carry several denials with the same cause; N identical toasts
        // is noise, not information.
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' }];
        apiClientMock.pushOperations.mockResolvedValueOnce({
            results: [
                { operationId: 'op-1', success: false, rejected: true, reason: 'mesma razão' },
                { operationId: 'op-2', success: false, rejected: true, reason: 'mesma razão' },
                { operationId: 'op-3', success: true },
            ],
            serverVersion: 7,
        });

        await syncEngine.flush();
        expect(h.showWarningMock).toHaveBeenCalledTimes(1);
    });
});

describe('flush', () => {
    it('drains the queue in batches and dequeues accepted ops', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [
            { id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' },
        ];

        const result = await syncEngine.flush();

        expect(apiClientMock.pushOperations).toHaveBeenCalledWith(
            'atlas-1',
            [{ id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' }],
        );
        expect(operationQueueMock.dequeue).toHaveBeenCalledWith(['op-1', 'op-2', 'op-3']);
        expect(queueState.ops).toHaveLength(0);
        expect(result).toEqual({ pushed: 3 });
    });

    it('returns pushed:0 and pushes nothing when the queue is empty', async () => {
        const result = await syncEngine.flush();
        expect(apiClientMock.pushOperations).not.toHaveBeenCalled();
        expect(result).toEqual({ pushed: 0 });
    });

    // O dequeue era do LOTE: bastava o push resolver para as três saírem da fila, tendo o
    // servidor falado sobre as três ou sobre uma. Uma op que ele não menciona não foi
    // aplicada e não tem versão; tirá-la da fila é como uma feição some de uma máquina e
    // não aparece em nenhuma outra.
    it('desenfileira SÓ as ops que o servidor confirmou, e mantém as demais', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' }];

        apiClientMock.pushOperations
            // O servidor fala sobre op-1 e op-3; op-2 ele ignorou.
            .mockResolvedValueOnce({
                results: [
                    { operationId: 'op-1', success: true, currentVersion: 9 },
                    { operationId: 'op-3', success: true, currentVersion: 9 },
                ],
                serverVersion: 9,
            })
            // A op não confirmada é RETENTADA no mesmo laço; aqui a rede cai, e é isso que
            // deixa o estado final observável.
            .mockRejectedValueOnce(httpError(503));

        await expect(syncEngine.flush()).rejects.toThrow();

        expect(queueState.dequeued).toEqual(['op-1', 'op-3']);
        expect(queueState.ops.map((o) => o.id)).toEqual(['op-2']);
    });

    it('falha ALTO quando o servidor não confirma nenhuma op (em vez de girar em vazio)', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }];
        apiClientMock.pushOperations.mockResolvedValue({
            results: [{ operationId: 'de-outro-cliente', success: true }],
            serverVersion: 9,
        });

        await expect(syncEngine.flush()).rejects.toThrow(/não confirmou nenhuma/);
        // Nada perdido: o trabalho continua na fila, e o `sync-flush` conta a falha e avisa.
        expect(queueState.dequeued).toEqual([]);
        expect(queueState.ops).toHaveLength(2);
    });
});

// ============================================================================
// Rede de segurança contra lote envenenado
// ============================================================================
// O servidor recusa violação de integridade POR OPERAÇÃO (200 + `rejected`), então
// este caminho só existe para a recusa permanente que a classificação de lá não cobre.
// Sem ele, o lote volta idêntico para a fila e é reenviado a cada 1,5 s para sempre: o
// sync do usuário para, em silêncio, e nada aparece na UI.
//
// A op ofensora é achada POR CONSTRUÇÃO — o lote encolhe para UMA op —, nunca por um id
// que o servidor mande. É isso que garante que nenhuma op boa seja descartada por
// engano: irmã só sai da fila quando o servidor a aceita.

/** Erro de push com status HTTP, como o ApiError real. */
function httpError(status) {
    const err = new Error(`HTTP ${status}`);
    err.status = status;
    return err;
}

describe('lote envenenado: isolamento e descarte da op ofensora', () => {
    beforeEach(() => {
        // Sem `results`, `recordPushAcks` cai no fallback por índice e nada é recusado.
        apiClientMock.pushOperations.mockResolvedValue({ results: [], serverVersion: 1 });
    });

    it('encolhe o lote, descarta SÓ a op recusada com 400 e drena o resto', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-boa-1' }, { id: 'op-ruim' }, { id: 'op-boa-2' }];

        // O 400 acompanha a op ofensora, esteja ela em lote grande ou sozinha.
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => {
            if (ops.some((o) => o.id === 'op-ruim')) throw httpError(400);
            return { results: [], serverVersion: 1 };
        });

        const result = await syncEngine.flush();

        // As duas boas foram ACEITAS pelo servidor antes de sair da fila; a ruim saiu
        // por ter sido recusada sozinha.
        expect(queueState.dequeued).toEqual(['op-boa-1', 'op-ruim', 'op-boa-2']);
        expect(queueState.ops).toHaveLength(0);
        expect(result).toEqual({ pushed: 2 });

        // Enquanto isola, o lote é de 1 — reverter para 100 a cada sucesso custaria um
        // round-trip perdido por op boa que precede a ofensora.
        const tamanhos = apiClientMock.pushOperations.mock.calls.map(([, ops]) => ops.length);
        expect(tamanhos).toEqual([3, 1, 1, 1]);

        // Descarte silencioso é o outro defeito: o usuário precisa saber.
        expect(h.showWarningMock).toHaveBeenCalledTimes(1);
    });

    it.each([401, 403, 409, 429, 500, 503])(
        'NÃO descarta nada quando o servidor responde %i (pode dar certo depois)',
        async (status) => {
            await syncEngine.connect('atlas-1', { initialPull: false });
            queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }];
            apiClientMock.pushOperations.mockRejectedValue(httpError(status));

            await expect(syncEngine.flush()).rejects.toThrow();
            expect(queueState.dequeued).toEqual([]);
            expect(queueState.ops).toHaveLength(2);
            expect(h.showWarningMock).not.toHaveBeenCalled();
        }
    );

    // 404/410 é classe TERMINAL e DISTINTA: o atlas sumiu do servidor. Isolar op a op
    // contra um endereço que não existe é um round-trip por op, para sempre; e descartar
    // seria jogar fora o trabalho que o resgate ainda pode salvar. Então: nada sai da fila,
    // o lote NÃO encolhe, e o erro sobe para o `sync-flush` classificar e avisar.
    it.each([404, 410])('atlas ausente (%i): não isola, não descarta, e diz o que houve', async (status) => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' }];
        apiClientMock.pushOperations.mockRejectedValue(httpError(status));

        setTracing(true);
        clearTrace();
        try {
            await expect(syncEngine.flush()).rejects.toThrow();
        } finally {
            setTracing(false);
        }

        expect(queueState.dequeued).toEqual([]);
        expect(queueState.ops).toHaveLength(3);
        // UMA tentativa, com o lote inteiro: se o modo de isolamento tivesse engatado,
        // haveria uma segunda chamada com lote de tamanho 1.
        const tamanhos = apiClientMock.pushOperations.mock.calls.map(([, ops]) => ops.length);
        expect(tamanhos).toEqual([3]);
        expect(h.showWarningMock).not.toHaveBeenCalled();

        // A classe é NOMEADA no ledger. Sem isto, "o atlas sumiu" e "a rede caiu" são o
        // mesmo vermelho, que é a leitura errada que travava a fila em silêncio.
        const motivos = getTrace((s) => s.stage === 'flush.push').map((s) => s.reason);
        expect(motivos).toContain('atlas_gone');
    });

    it('não gira em vazio quando a fila não avança (dequeue removeu 0)', async () => {
        // Se o descarte não remover nada, repetir o mesmo peek é laço infinito. O erro
        // sobe — fila parada, que é recuperável, nunca um giro sem fim.
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-unica' }];
        apiClientMock.pushOperations.mockRejectedValue(httpError(400));
        operationQueueMock.dequeue.mockResolvedValueOnce(0);

        await expect(syncEngine.flush()).rejects.toThrow();
        expect(queueState.ops).toHaveLength(1);
    });
});

// ============================================================================
// Convergence guard: the two halves the engine drives
// ============================================================================
// The author filters its OWN WebSocket echo, so the push ack is the only place it can
// learn the server arrival order of its own op — and a local edit stays "pending" (which
// DEFERS every inbound op for that entity) until something resolves it. The engine owns
// both halves: `recordPushAcks` seeds the version per acked op, and `_reconcileConvergenceGuard`
// clears whatever leaked, comparing the pending set against what is STILL queued.
//
// Neither half ran under test until 2026-08-13: the queue mock had no `getAll` and the
// handler mock had neither function, so `_reconcileConvergenceGuard` threw a TypeError that
// the SUT's own `catch` swallowed. Thirty-five tests were green over a step that never
// executed. These tests exist so that stays visible: if the reconciliation is dropped, or is
// fed the wrong set, they go red instead of quietly printing to a console nobody reads.

describe('post-flush convergence-guard reconciliation', () => {
    it('reconciles with an EMPTY set after the queue drains completely', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [
            { id: 'op-1', entityType: 'feature', entityId: 'f1' },
            { id: 'op-2', entityType: 'feature', entityId: 'f2' },
        ];

        const result = await syncEngine.flush();

        // Pinned so this case cannot silently degrade into the ISOLATION path (batch of 1,
        // op discarded) and still assert an empty set for the wrong reason: mock
        // implementations leak between tests here, and the poisoned-batch describe above
        // leaves a rejecting `pushOperations` behind.
        expect(result).toEqual({ pushed: 2 });
        expect(apiClientMock.pushOperations).toHaveBeenCalledTimes(1);

        // Everything was acked and dequeued, so NO local edit is still pending: both
        // entities must be released. Passing the ids that were just pushed (instead of the
        // ids that remain) would leave f1/f2 deferred forever — inbound ops for them would
        // pile up unapplied and the peers would silently diverge.
        expect(reconcilePendingLocalEdits).toHaveBeenCalledTimes(1);
        const [remaining] = reconcilePendingLocalEdits.mock.calls[0];
        expect(remaining).toBeInstanceOf(Set);
        expect([...remaining]).toEqual([]);
    });

    it('reconciles with the ids STILL queued when the push fails transiently', async () => {
        // A 503 dequeues nothing, so both edits are legitimately still un-acked and must
        // STAY pending. Reconciling with an empty set here would release a pending edit
        // whose op never reached the server — exactly the window the guard exists to cover.
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [
            { id: 'op-1', entityType: 'feature', entityId: 'f1' },
            { id: 'op-2', entityType: 'layer', entityId: 'l1' },
        ];
        apiClientMock.pushOperations.mockRejectedValue(httpError(503));

        await expect(syncEngine.flush()).rejects.toThrow();

        expect(reconcilePendingLocalEdits).toHaveBeenCalledTimes(1);
        const [remaining] = reconcilePendingLocalEdits.mock.calls[0];
        expect([...remaining].sort()).toEqual(['f1', 'l1']);
    });

    it('reconciles once even when the flush isolates and discards a poisoned op', async () => {
        // The isolation loop re-peeks several times; the reconciliation is a POST-drain step
        // and must not fire per batch (each call replays deferred ops, so N calls would be N
        // replays of the same backlog).
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [
            { id: 'op-boa', entityType: 'feature', entityId: 'f1' },
            { id: 'op-ruim', entityType: 'feature', entityId: 'f2' },
        ];
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => {
            if (ops.some((o) => o.id === 'op-ruim')) throw httpError(400);
            return { results: [], serverVersion: 1 };
        });

        await syncEngine.flush();

        expect(reconcilePendingLocalEdits).toHaveBeenCalledTimes(1);
        expect([...reconcilePendingLocalEdits.mock.calls[0][0]]).toEqual([]);
    });

    it('reconciles BEFORE re-throwing when the queue refuses to advance', async () => {
        // The stalled-queue escape hatch (dequeue removed 0) throws to avoid an infinite
        // loop. Throwing without reconciling would strand the pending edits of every op it
        // did manage to push earlier in the same flush.
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-unica', entityType: 'feature', entityId: 'f9' }];
        apiClientMock.pushOperations.mockRejectedValue(httpError(400));
        operationQueueMock.dequeue.mockResolvedValueOnce(0);

        await expect(syncEngine.flush()).rejects.toThrow();

        expect(reconcilePendingLocalEdits).toHaveBeenCalledTimes(1);
        expect([...reconcilePendingLocalEdits.mock.calls[0][0]]).toEqual(['f9']);
    });

    it('seeds the applied serverVersion ONLY for convergence-guarded entity types', async () => {
        // The seed is what lets a later concurrent op from a peer lose to the author's newer
        // value (LWW by server arrival). Seeding an UNGUARDED type would be worse than
        // useless: nothing reads it, and the map grows per op forever.
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [
            { id: 'op-1', entityType: 'feature', entityId: 'f1' },
            { id: 'op-2', entityType: 'map', entityId: 'm1' },        // not guarded
            { id: 'op-3', entityType: 'briefing', entityId: 'b1' },   // guarded since 2026-07-25
            { id: 'op-4', entityType: 'feature' },                    // no entityId → nothing to key on
        ];
        apiClientMock.pushOperations.mockResolvedValueOnce({ results: [], serverVersion: 11 });

        await syncEngine.flush();

        expect(recordLocalAppliedVersion.mock.calls).toEqual([['f1', 11], ['b1', 11]]);
    });

    it('prefers the per-op version from the ack over the batch serverVersion', async () => {
        // Two ops in one batch land at DIFFERENT server versions; collapsing both onto the
        // batch-level number would record an arrival order the server never assigned.
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [
            { id: 'op-1', entityType: 'feature', entityId: 'f1' },
            { id: 'op-2', entityType: 'feature', entityId: 'f2' },
        ];
        apiClientMock.pushOperations.mockResolvedValueOnce({
            results: [
                { operationId: 'op-1', success: true, currentVersion: 20 },
                { operationId: 'op-2', success: true, currentVersion: 21 },
            ],
            serverVersion: 21,
        });

        await syncEngine.flush();

        expect(recordLocalAppliedVersion.mock.calls).toEqual([['f1', 20], ['f2', 21]]);
    });
});

describe('pull', () => {
    it('applies missed operations and advances lastVersion', async () => {
        syncEngine._atlasId = 'atlas-1';
        syncEngine._lastVersion = 5;
        apiClientMock.pullSync.mockResolvedValueOnce({
            operations: [{ entityId: 'x' }],
            currentVersion: 9,
            isSnapshot: false,
        });

        await syncEngine.pull();

        expect(apiClientMock.pullSync).toHaveBeenCalledWith('atlas-1', 5);
        expect(applyRemoteOperation).toHaveBeenCalledWith({ entityId: 'x' });
        expect(syncEngine.lastVersion).toBe(9);
    });
});

describe('disconnect', () => {
    it('closes the WebSocket', () => {
        syncEngine.disconnect();
        expect(wsClientMock.disconnect).toHaveBeenCalledTimes(1);
    });
});

describe('logoutAndDisconnect', () => {
    it('disconnects, logs out, clears the session, and stops logging', async () => {
        await syncEngine.logoutAndDisconnect();
        expect(wsClientMock.disconnect).toHaveBeenCalledTimes(1);
        expect(apiClientMock.logout).toHaveBeenCalledTimes(1);
        expect(sessionContextMock.clearSession).toHaveBeenCalledTimes(1);
        expect(disableOperationLogging).toHaveBeenCalledTimes(1);
    });
});

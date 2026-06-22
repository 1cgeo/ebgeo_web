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
            register: vi.fn(async (payload) => ({ id: 'user-2', ...payload })),
            logout: vi.fn(async () => {}),
            pullSync: vi.fn(async () => ({ currentVersion: 0, isSnapshot: false })),
            pushOperations: vi.fn(async () => ({ results: [], acks: [], serverVersion: 1 })),
            createAtlas: vi.fn(async (p) => ({ id: 'atlas-1', ...p })),
            setTokens: vi.fn(),
            wsUrl: vi.fn(() => 'ws://test/collab'),
        },
        configureApiClientMock: vi.fn(),
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
        },
        enableOperationLogging: vi.fn(),
        disableOperationLogging: vi.fn(),
        sessionContextMock: { setSession: vi.fn(), clearSession: vi.fn() },
        applyRemoteOperation: vi.fn(async () => {}),
        applyRemoteSnapshot: vi.fn(async () => {}),
        setRemoteHandlerEventBus: vi.fn(),
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

vi.mock('../../src/js/store/sync/remote-operation-handler.js', () => ({
    applyRemoteOperation: h.applyRemoteOperation,
    applyRemoteSnapshot: h.applyRemoteSnapshot,
    setRemoteHandlerEventBus: h.setRemoteHandlerEventBus,
}));

vi.mock('../../src/js/store/sync/sync-gateway.js', () => ({
    syncGateway: h.syncGatewayMock,
}));

vi.mock('../../src/js/store/sync/connection-state.js', () => ({
    connectionState: h.connectionStateMock,
}));

vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: vi.fn(() => h.eventBusMock),
}));

// ============================================================================
// Imports (SUT after the mocks)
// ============================================================================

import { syncEngine } from '../../src/js/store/sync/sync-engine.js';

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
            username: 'bob',
        });
    });
});

describe('register', () => {
    it('delegates to apiClient.register', async () => {
        const out = await syncEngine.register({ username: 'u', password: 'p', nome: 'N' });
        expect(apiClientMock.register).toHaveBeenCalledWith({
            username: 'u', password: 'p', nome: 'N',
        });
        expect(out).toMatchObject({ username: 'u' });
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

    it('leaves the session untouched on connect when the payload carries no role', async () => {
        wsClientMock.connect.mockResolvedValueOnce({ sessionId: 's1', userId: 'user-1', permission: null });

        await syncEngine.connect('atlas-1', { initialPull: false });

        expect(sessionContextMock.setSession).not.toHaveBeenCalled();
    });

    it('wires WS handlers only once across reconnects', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        await syncEngine.connect('atlas-1', { initialPull: false });
        // 5 events ('operation','syncResponse','atlasDeleted','atlasOwnerChanged','atlasSettings')
        // wired exactly once total.
        expect(wsClientMock.on).toHaveBeenCalledTimes(5);
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

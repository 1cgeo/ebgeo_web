import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted shared state (available to vi.mock factories)
// ============================================================================

const h = vi.hoisted(() => {
    let uuidCounter = 0;
    return {
        comments: { value: {} },
        authenticated: { value: true },
        generateUUID: vi.fn(() => `comment-uuid-${++uuidCounter}`),
        resetUuid: () => { uuidCounter = 0; },
        logCommentOperation: vi.fn(),
        emit: vi.fn(),
    };
});

// ============================================================================
// Mock dependencies (the source's import block tells us exactly what to mock)
// ============================================================================

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: () => ({
        getMapComments: vi.fn(async () => h.comments.value),
        saveMapComments: vi.fn(async (mapName, collection) => { h.comments.value = collection; }),
    }),
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: {
        getCurrentMapName: vi.fn(() => 'TestMap'),
        getMapId: vi.fn(() => 'map-uuid-123'),
    },
}));

vi.mock('../../src/js/store/sync/session-context.js', () => ({
    sessionContext: {
        get userId() { return 'user-1'; },
        isAuthenticated: () => h.authenticated.value,
    },
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logCommentOperation: (...a) => h.logCommentOperation(...a),
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' },
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_COMMENT: 'CREATE_COMMENT',
        UPDATE_COMMENT: 'UPDATE_COMMENT',
        DELETE_COMMENT: 'DELETE_COMMENT',
    },
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    emitStoreError: vi.fn(),
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:blocked' },
}));

// runTransaction mirrors the real ordering: persistence first, then deferSync, then deferAsync.
vi.mock('../../src/js/store/store-transaction.js', () => ({
    runTransaction: async (work) => {
        const sync = [];
        const async_ = [];
        const tx = { deferSync: (fn) => sync.push(fn), deferAsync: (fn) => async_.push(fn) };
        const persist = await work(tx);
        if (typeof persist === 'function') await persist();
        for (const fn of sync) fn();
        for (const fn of async_) await fn();
    },
}));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: (...a) => h.generateUUID(...a),
}));

vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: () => ({ emit: (...a) => h.emit(...a) }),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

const { addComment, addReply, resolveComment, getComments } = await import(
    '../../src/js/store/comment.operations.js'
);

// ============================================================================
// Tests
// ============================================================================

describe('comment.operations — addReply', () => {
    beforeEach(() => {
        h.comments.value = {};
        h.authenticated.value = true;
        h.resetUuid();
        h.logCommentOperation.mockClear();
        h.emit.mockClear();
    });

    it('adds a reply to an open root comment', async () => {
        const root = await addComment({ lng: 1, lat: 2, text: 'raiz' });
        const reply = await addReply(root.id, { text: 'resposta' });

        expect(reply).toBeTruthy();
        expect(reply.parentId).toBe(root.id);
        const all = await getComments('TestMap');
        expect(Object.values(all).filter((c) => c.parentId === root.id)).toHaveLength(1);
    });

    it('refuses to reply to a RESOLVED comment (must be reopened first)', async () => {
        const root = await addComment({ lng: 1, lat: 2, text: 'raiz' });
        await resolveComment(root.id, true);
        h.logCommentOperation.mockClear();

        const reply = await addReply(root.id, { text: 'tentativa' });

        expect(reply).toBeUndefined();
        const all = await getComments('TestMap');
        expect(Object.values(all).filter((c) => c.parentId === root.id)).toHaveLength(0);
        // No sync op should be logged for the rejected reply.
        expect(h.logCommentOperation).not.toHaveBeenCalled();
    });

    it('refuses to reply to a DELETED (missing) root', async () => {
        const reply = await addReply('nonexistent-id', { text: 'orfã' });
        expect(reply).toBeUndefined();
    });

    it('blocks replies when the session is not authenticated (no author)', async () => {
        const root = await addComment({ lng: 1, lat: 2, text: 'raiz' });
        h.authenticated.value = false;

        const reply = await addReply(root.id, { text: 'anônima' });
        expect(reply).toBeUndefined();
    });
});

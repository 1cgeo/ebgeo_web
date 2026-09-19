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
    EntityType: { COMMENT: 'comment' },
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
        const tx = { recordOperation: (_entity, ...args) => h.logCommentOperation(...args), deferSync: (fn) => sync.push(fn), deferAsync: (fn) => async_.push(fn) };
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

const { addComment, addReply, resolveComment, getComments, updateComment } = await import(
    '../../src/js/store/comment.operations.js'
);

// ============================================================================
// Tests
// ============================================================================

describe('comment.operations — addReply', () => {
    it('blocks a foreign text edit before persistence, events or enqueue, even with forged authorship', async () => {
        h.comments.value = { foreign: { id: 'foreign', authorId: 'other', text: 'Original' } };
        expect(await updateComment({ id: 'foreign', authorId: 'user-1', text: 'Changed' })).toBe(false);
        expect(h.comments.value.foreign.text).toBe('Original');
        expect(h.comments.value.foreign.authorId).toBe('other');
        expect(h.logCommentOperation).not.toHaveBeenCalled();
        expect(h.emit).not.toHaveBeenCalled();
        expect(await updateComment({ id: 'foreign', lng: 20, status: 'open' })).toBe(false);
        expect(h.logCommentOperation).not.toHaveBeenCalled();
    });
    it('allows the author to edit their own text', async () => {
        h.comments.value = { mine: { id: 'mine', authorId: 'user-1', text: 'Original' } };
        expect(await updateComment({ id: 'mine', text: 'Corrected' })).toBe(true);
        expect(h.comments.value.mine.text).toBe('Corrected');
        expect(h.logCommentOperation).toHaveBeenCalledTimes(1);
    });
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

    it('persists first-person local coordinates without inventing latitude or longitude', async () => {
        const root = await addComment({ surface: 'fp', tilesetId: 'museum', x: 3.82, y: -0.5, z: 1.42, text: 'vitrine' });
        expect((await getComments('TestMap'))[root.id]).toMatchObject({
            surface: 'fp', tilesetId: 'museum', x: 3.82, y: -0.5, z: 1.42, lng: null, lat: null,
        });
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

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../../src/js/store/sync/operation-queue.js', () => {
    const mockQueue = {
        size: vi.fn().mockResolvedValue(5),
        peek: vi.fn().mockResolvedValue([]),
        dequeue: vi.fn().mockResolvedValue(0)
    };
    return { operationQueue: mockQueue };
});

vi.mock('../../src/js/store/sync/operation-factory.js', () => ({
    advanceLamportClock: vi.fn()
}));

vi.mock('../../src/js/store/sync/connection-state.js', () => ({
    connectionState: {
        isOnline: vi.fn(() => false)
    }
}));

import { SyncGateway } from '../../src/js/store/sync/sync-gateway.js';
import { connectionState } from '../../src/js/store/sync/connection-state.js';
import { advanceLamportClock } from '../../src/js/store/sync/operation-factory.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';

let gateway;

beforeEach(() => {
    vi.clearAllMocks();
    gateway = new SyncGateway();
    connectionState.isOnline.mockReturnValue(false);
});

// ============================================================================
// sendPendingOperations
// ============================================================================

describe('sendPendingOperations', () => {
    it('returns sent:0 when offline', async () => {
        const result = await gateway.sendPendingOperations();
        expect(result.sent).toBe(0);
        expect(result.failed).toBe(0);
        expect(result.remaining).toBe(5);
    });

    it('queries queue size even when offline', async () => {
        await gateway.sendPendingOperations();
        expect(operationQueue.size).toHaveBeenCalled();
    });

    it('returns sent:0 when online (not yet implemented)', async () => {
        connectionState.isOnline.mockReturnValue(true);
        const result = await gateway.sendPendingOperations();
        expect(result.sent).toBe(0);
    });
});

// ============================================================================
// applyRemoteOperation
// ============================================================================

describe('applyRemoteOperation', () => {
    it('no-op when offline', async () => {
        const op = { lamportTimestamp: 42, entityType: 'feature' };
        await gateway.applyRemoteOperation(op);
        expect(advanceLamportClock).not.toHaveBeenCalled();
    });

    it('advances Lamport clock when online', async () => {
        connectionState.isOnline.mockReturnValue(true);
        const op = { lamportTimestamp: 42, entityType: 'feature' };
        await gateway.applyRemoteOperation(op);
        expect(advanceLamportClock).toHaveBeenCalledWith(42);
    });

    it('calls registered handler when online', async () => {
        connectionState.isOnline.mockReturnValue(true);
        const handler = vi.fn().mockResolvedValue(undefined);
        gateway.setRemoteOperationHandler(handler);

        const op = { lamportTimestamp: 10, entityType: 'feature', data: { id: 'f1' } };
        await gateway.applyRemoteOperation(op);

        expect(handler).toHaveBeenCalledWith(op);
    });

    it('does not call handler when offline', async () => {
        const handler = vi.fn();
        gateway.setRemoteOperationHandler(handler);

        await gateway.applyRemoteOperation({ lamportTimestamp: 10 });
        expect(handler).not.toHaveBeenCalled();
    });
});

// ============================================================================
// setRemoteOperationHandler
// ============================================================================

describe('setRemoteOperationHandler', () => {
    it('throws if handler is not a function', () => {
        expect(() => gateway.setRemoteOperationHandler('bad')).toThrow();
    });

    it('accepts a function', () => {
        expect(() => gateway.setRemoteOperationHandler(() => {})).not.toThrow();
    });
});

// ============================================================================
// getPendingCount
// ============================================================================

describe('getPendingCount', () => {
    it('returns queue size', async () => {
        operationQueue.size.mockResolvedValue(42);
        const count = await gateway.getPendingCount();
        expect(count).toBe(42);
    });
});

// ============================================================================
// _reset
// ============================================================================

describe('_reset', () => {
    it('clears handler', async () => {
        const handler = vi.fn();
        gateway.setRemoteOperationHandler(handler);
        gateway._reset();

        connectionState.isOnline.mockReturnValue(true);
        await gateway.applyRemoteOperation({ lamportTimestamp: 1 });
        expect(handler).not.toHaveBeenCalled();
    });
});

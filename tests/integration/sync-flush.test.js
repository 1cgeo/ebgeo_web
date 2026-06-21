import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Sync Auto-Flush Tests
 *
 * Validates that startAutoFlush/stopAutoFlush:
 * - is idempotent (start twice -> single timer)
 * - flushes on the interval only when ONLINE and the queue is non-empty
 * - never overlaps two flushes (in-flight lock)
 * - flushes immediately on start
 * - flushes on a local/remote change event
 * - stops cleanly (timer cleared, no further flushes)
 */

// ============================================================================
// Mocks (must be declared before importing the module under test)
// ============================================================================

const busListeners = {};
const mockBus = {
    on: vi.fn((event, fn) => {
        (busListeners[event] ||= []).push(fn);
    }),
    off: vi.fn((event, fn) => {
        busListeners[event] = (busListeners[event] || []).filter(f => f !== fn);
    }),
    emit: (event, payload) => {
        (busListeners[event] || []).forEach(fn => fn(payload));
    },
};

vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: () => mockBus,
}));

// Stub the sync engine singleton so importing sync-flush.js does not pull in
// the whole sync stack; tests inject their own fake engine anyway.
vi.mock('../../src/js/store/sync/sync-engine.js', () => ({
    syncEngine: { flush: vi.fn(async () => ({ pushed: 0 })) },
}));

const queueState = { pending: 0 };
vi.mock('../../src/js/store/sync/operation-queue.js', () => ({
    operationQueue: { count: vi.fn(async () => queueState.pending) },
}));

// ============================================================================
// Imports
// ============================================================================

import { startAutoFlush, stopAutoFlush } from '../../src/js/store/sync/sync-flush.js';
import { connectionState, ConnectionStates } from '../../src/js/store/sync/connection-state.js';
import { EventTypes } from '../../src/js/events/event_types.js';

// ============================================================================
// Helpers
// ============================================================================

function createFakeEngine() {
    return {
        flushCount: 0,
        resolvers: [],
        flush: vi.fn(function flush() {
            this.flushCount += 1;
            return new Promise((resolve) => {
                this.resolvers.push(() => resolve({ pushed: 1 }));
            });
        }),
        // Resolve all pending flush promises.
        settle() {
            const pending = this.resolvers.splice(0);
            pending.forEach(r => r());
        },
    };
}

function goOnline() {
    connectionState.transition(ConnectionStates.CONNECTING);
    connectionState.transition(ConnectionStates.ONLINE);
}

// ============================================================================
// Lifecycle
// ============================================================================

let engine;

beforeEach(() => {
    vi.useFakeTimers();
    connectionState._reset();
    queueState.pending = 0;
    for (const k of Object.keys(busListeners)) delete busListeners[k];
    mockBus.on.mockClear();
    mockBus.off.mockClear();
    engine = createFakeEngine();
});

afterEach(() => {
    stopAutoFlush();
    vi.useRealTimers();
});

// ============================================================================
// Tests
// ============================================================================

describe('online + work gating', () => {
    it('does not flush when offline even with pending ops', async () => {
        queueState.pending = 5;
        startAutoFlush(engine, { intervalMs: 1000 });

        await vi.advanceTimersByTimeAsync(3000);

        expect(engine.flush).not.toHaveBeenCalled();
    });

    it('does not flush when online but the queue is empty', async () => {
        goOnline();
        queueState.pending = 0;
        startAutoFlush(engine, { intervalMs: 1000 });

        await vi.advanceTimersByTimeAsync(3000);

        expect(engine.flush).not.toHaveBeenCalled();
    });

    it('flushes on the interval when online with pending ops', async () => {
        goOnline();
        queueState.pending = 2;
        startAutoFlush(engine, { intervalMs: 1000 });

        // Immediate flush on start.
        await vi.advanceTimersByTimeAsync(0);
        engine.settle();
        expect(engine.flush).toHaveBeenCalledTimes(1);

        // Next interval.
        await vi.advanceTimersByTimeAsync(1000);
        engine.settle();
        expect(engine.flush).toHaveBeenCalledTimes(2);
    });
});

describe('immediate flush on start', () => {
    it('flushes once immediately without waiting an interval', async () => {
        goOnline();
        queueState.pending = 1;
        startAutoFlush(engine, { intervalMs: 99999 });

        await vi.advanceTimersByTimeAsync(0);
        engine.settle();

        expect(engine.flush).toHaveBeenCalledTimes(1);
    });
});

describe('in-flight lock', () => {
    it('does not overlap two flushes', async () => {
        goOnline();
        queueState.pending = 3;
        startAutoFlush(engine, { intervalMs: 500 });

        // Trigger the immediate flush; leave it unresolved (in-flight).
        await vi.advanceTimersByTimeAsync(0);
        expect(engine.flush).toHaveBeenCalledTimes(1);

        // Several intervals pass while the first flush is still pending.
        await vi.advanceTimersByTimeAsync(2000);
        expect(engine.flush).toHaveBeenCalledTimes(1);

        // Resolve it; the next tick may flush again.
        engine.settle();
        await vi.advanceTimersByTimeAsync(500);
        engine.settle();
        expect(engine.flush).toHaveBeenCalledTimes(2);
    });
});

describe('change-event triggering', () => {
    it('flushes immediately on a local change event', async () => {
        goOnline();
        queueState.pending = 1;
        startAutoFlush(engine, { intervalMs: 99999 });

        // Drain the immediate start flush and let its in-flight lock release.
        await vi.advanceTimersByTimeAsync(0);
        engine.settle();
        await vi.advanceTimersByTimeAsync(0);
        const baseline = engine.flush.mock.calls.length;

        mockBus.emit(EventTypes.FEATURE_CREATED, {});
        // flushOnce() awaits operationQueue.count() (a microtask) before calling
        // engine.flush(); advance the (async) timer queue so the call lands.
        await vi.advanceTimersByTimeAsync(0);
        engine.settle();

        expect(engine.flush.mock.calls.length).toBe(baseline + 1);
    });

    it('subscribes to REMOTE_OPERATION_APPLIED', () => {
        startAutoFlush(engine, { intervalMs: 99999 });
        const events = mockBus.on.mock.calls.map(c => c[0]);
        expect(events).toContain(EventTypes.REMOTE_OPERATION_APPLIED);
    });
});

describe('idempotency + stop', () => {
    it('calling start twice does not create a second timer', async () => {
        goOnline();
        queueState.pending = 1;
        startAutoFlush(engine, { intervalMs: 1000 });
        startAutoFlush(engine, { intervalMs: 1000 });

        await vi.advanceTimersByTimeAsync(0);
        engine.settle();
        await vi.advanceTimersByTimeAsync(1000);
        engine.settle();

        // 1 immediate + 1 interval == 2 (not 4 from a doubled timer).
        expect(engine.flush).toHaveBeenCalledTimes(2);
    });

    it('stop clears the timer and unsubscribes', async () => {
        goOnline();
        queueState.pending = 1;
        startAutoFlush(engine, { intervalMs: 1000 });

        await vi.advanceTimersByTimeAsync(0);
        engine.settle();
        const before = engine.flush.mock.calls.length;

        stopAutoFlush();
        expect(mockBus.off).toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(5000);
        engine.settle();
        expect(engine.flush.mock.calls.length).toBe(before);

        // A change event after stop must not flush.
        mockBus.emit(EventTypes.FEATURE_CREATED, {});
        await vi.advanceTimersByTimeAsync(0);
        expect(engine.flush.mock.calls.length).toBe(before);
    });

    it('stop is safe to call when not running', () => {
        expect(() => stopAutoFlush()).not.toThrow();
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventBus } from '../../src/js/events/event_bus.js';
import {
    StoreErrorEvents,
    setStoreErrorEventBus,
    emitStoreError
} from '../../src/js/store/store-errors.js';

// ============================================================================
// SETUP
// ============================================================================

let eventBus;

beforeEach(() => {
    eventBus = createEventBus();
    setStoreErrorEventBus(eventBus);
});

// ============================================================================
// TESTS
// ============================================================================

describe('Event-driven error lifecycle', () => {

    // ========================================================================
    // STORE_PERSIST_ERROR flow
    // ========================================================================

    describe('STORE_PERSIST_ERROR flow', () => {
        it('emitStoreError(PERSIST_ERROR) → listener receives event with payload', () => {
            const handler = vi.fn();
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, handler);

            const payload = {
                operation: 'addFeature',
                error: 'QuotaExceededError',
                timestamp: Date.now()
            };
            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, payload);

            expect(handler).toHaveBeenCalledOnce();
            expect(handler).toHaveBeenCalledWith(payload);
        });

        it('payload contains operation, error message, and timestamp', () => {
            const handler = vi.fn();
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, handler);

            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, {
                operation: 'updateMapData',
                error: 'disk full',
                timestamp: 1707123456000
            });

            const received = handler.mock.calls[0][0];
            expect(received).toHaveProperty('operation', 'updateMapData');
            expect(received).toHaveProperty('error', 'disk full');
            expect(received).toHaveProperty('timestamp', 1707123456000);
        });

        it('multiple listeners all receive the event', () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            const handler3 = vi.fn();

            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, handler1);
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, handler2);
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, handler3);

            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, { operation: 'test' });

            expect(handler1).toHaveBeenCalledOnce();
            expect(handler2).toHaveBeenCalledOnce();
            expect(handler3).toHaveBeenCalledOnce();
        });
    });

    // ========================================================================
    // STORE_SYNC_ERROR flow
    // ========================================================================

    describe('STORE_SYNC_ERROR flow', () => {
        it('listener receives consecutiveFailures count', () => {
            const handler = vi.fn();
            eventBus.on(StoreErrorEvents.STORE_SYNC_ERROR, handler);

            emitStoreError(StoreErrorEvents.STORE_SYNC_ERROR, {
                operation: 'CREATE feature',
                entityId: 'feat-1',
                error: 'network timeout',
                consecutiveFailures: 3
            });

            const received = handler.mock.calls[0][0];
            expect(received.consecutiveFailures).toBe(3);
            expect(received.entityId).toBe('feat-1');
        });

        it('multiple errors increment consecutiveFailures in payload', () => {
            const payloads = [];
            eventBus.on(StoreErrorEvents.STORE_SYNC_ERROR, (p) => payloads.push(p));

            for (let i = 1; i <= 5; i++) {
                emitStoreError(StoreErrorEvents.STORE_SYNC_ERROR, {
                    operation: 'enqueue',
                    entityId: 'feat-1',
                    error: 'timeout',
                    consecutiveFailures: i
                });
            }

            expect(payloads).toHaveLength(5);
            expect(payloads[0].consecutiveFailures).toBe(1);
            expect(payloads[4].consecutiveFailures).toBe(5);
        });
    });

    // ========================================================================
    // STORE_OPERATION_BLOCKED flow
    // ========================================================================

    describe('STORE_OPERATION_BLOCKED flow', () => {
        it('listener receives mapName in payload', () => {
            const handler = vi.fn();
            eventBus.on(StoreErrorEvents.STORE_OPERATION_BLOCKED, handler);

            emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
                operation: 'addFeature',
                mapName: 'Mapa Principal'
            });

            const received = handler.mock.calls[0][0];
            expect(received.mapName).toBe('Mapa Principal');
            expect(received.operation).toBe('addFeature');
        });
    });

    // ========================================================================
    // Error isolation
    // ========================================================================

    describe('error isolation', () => {
        it('one error listener throwing does not block others', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const handler1 = vi.fn();
            const handler2 = vi.fn(() => { throw new Error('listener crash'); });
            const handler3 = vi.fn();

            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, handler1);
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, handler2);
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, handler3);

            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, { operation: 'test' });

            expect(handler1).toHaveBeenCalledOnce();
            expect(handler2).toHaveBeenCalledOnce();
            expect(handler3).toHaveBeenCalledOnce();

            errorSpy.mockRestore();
        });

        it('emit returns true when listeners exist', () => {
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, () => {});

            const result = eventBus.emit(StoreErrorEvents.STORE_PERSIST_ERROR, {});
            expect(result).toBe(true);
        });

        it('emit returns false when no listeners exist', () => {
            const result = eventBus.emit('nonexistent:event', {});
            expect(result).toBe(false);
        });
    });

    // ========================================================================
    // EventBus not initialized (fallback)
    // ========================================================================

    describe('EventBus not initialized (fallback)', () => {
        it('emitStoreError falls back to console.error when no EventBus', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            // Remove EventBus
            setStoreErrorEventBus(null);

            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, {
                operation: 'test',
                error: 'no bus'
            });

            expect(errorSpy).toHaveBeenCalledWith(
                '[store-errors] EventBus not available, error:',
                StoreErrorEvents.STORE_PERSIST_ERROR,
                expect.objectContaining({ error: 'no bus' })
            );

            errorSpy.mockRestore();

            // Restore EventBus for other tests
            setStoreErrorEventBus(eventBus);
        });
    });

    // ========================================================================
    // Unsubscribe patterns
    // ========================================================================

    describe('unsubscribe patterns', () => {
        it('returned unsubscribe function removes listener', () => {
            const handler = vi.fn();
            const unsub = eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, handler);

            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, { operation: 'first' });
            expect(handler).toHaveBeenCalledOnce();

            unsub();

            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, { operation: 'second' });
            expect(handler).toHaveBeenCalledOnce(); // Still 1, not 2
        });

        it('once() listener fires only once', () => {
            const handler = vi.fn();
            eventBus.once(StoreErrorEvents.STORE_PERSIST_ERROR, handler);

            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, { operation: 'first' });
            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, { operation: 'second' });

            expect(handler).toHaveBeenCalledOnce();
        });

        it('off() removes specific listener', () => {
            const handler = vi.fn();
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, handler);

            eventBus.off(StoreErrorEvents.STORE_PERSIST_ERROR, handler);

            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, { operation: 'test' });
            expect(handler).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // FIFO listener execution order
    // ========================================================================

    describe('FIFO listener execution order', () => {
        it('listeners execute in registration order', () => {
            const order = [];
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, () => order.push('first'));
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, () => order.push('second'));
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, () => order.push('third'));

            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, {});

            expect(order).toEqual(['first', 'second', 'third']);
        });
    });

    // ========================================================================
    // Diagnostics
    // ========================================================================

    describe('diagnostics', () => {
        it('listenerCount tracks active listeners', () => {
            expect(eventBus.listenerCount(StoreErrorEvents.STORE_PERSIST_ERROR)).toBe(0);

            const unsub1 = eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, () => {});
            const unsub2 = eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, () => {});
            expect(eventBus.listenerCount(StoreErrorEvents.STORE_PERSIST_ERROR)).toBe(2);

            unsub1();
            expect(eventBus.listenerCount(StoreErrorEvents.STORE_PERSIST_ERROR)).toBe(1);

            unsub2();
            expect(eventBus.listenerCount(StoreErrorEvents.STORE_PERSIST_ERROR)).toBe(0);
        });

        it('debug() returns listener summary', () => {
            eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, () => {});
            eventBus.on(StoreErrorEvents.STORE_SYNC_ERROR, () => {});
            eventBus.on(StoreErrorEvents.STORE_SYNC_ERROR, () => {});

            const debug = eventBus.debug();
            expect(debug.totalListeners).toBe(3);
            expect(debug.listenersByEvent[StoreErrorEvents.STORE_PERSIST_ERROR]).toBe(1);
            expect(debug.listenersByEvent[StoreErrorEvents.STORE_SYNC_ERROR]).toBe(2);
        });
    });

    // ========================================================================
    // waitFor pattern
    // ========================================================================

    // ========================================================================
    // EventEmitter validation
    // ========================================================================

    describe('EventEmitter input validation', () => {
        it('on() rejects non-function callback', () => {
            expect(() => eventBus.on('test:event', 'not-a-function')).toThrow(TypeError);
        });

        it('on() rejects empty event name', () => {
            expect(() => eventBus.on('', () => {})).toThrow(TypeError);
        });

        it('on() rejects non-string event name', () => {
            expect(() => eventBus.on(123, () => {})).toThrow(TypeError);
        });
    });

    // ========================================================================
    // offAll and hasListeners
    // ========================================================================

    describe('offAll and hasListeners', () => {
        it('offAll() removes all listeners for a specific event', () => {
            eventBus.on('test:event', () => {});
            eventBus.on('test:event', () => {});
            eventBus.on('other:event', () => {});
            expect(eventBus.listenerCount('test:event')).toBe(2);

            eventBus.offAll('test:event');
            expect(eventBus.listenerCount('test:event')).toBe(0);
            // Other event listeners should be unaffected
            expect(eventBus.listenerCount('other:event')).toBe(1);
        });

        it('hasListeners() returns correct state', () => {
            expect(eventBus.hasListeners('test:event')).toBe(false);
            const unsub = eventBus.on('test:event', () => {});
            expect(eventBus.hasListeners('test:event')).toBe(true);
            unsub();
            expect(eventBus.hasListeners('test:event')).toBe(false);
        });
    });

    // ========================================================================
    // waitFor pattern
    // ========================================================================

    describe('waitFor pattern', () => {
        it('resolves when event is emitted', async () => {
            const promise = eventBus.waitFor(StoreErrorEvents.STORE_PERSIST_ERROR, 1000);

            // Emit after a short delay
            setTimeout(() => {
                emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, { operation: 'delayed' });
            }, 10);

            const payload = await promise;
            expect(payload.operation).toBe('delayed');
        });

        it('rejects on timeout', async () => {
            await expect(
                eventBus.waitFor('never:fires', 50)
            ).rejects.toThrow('Timeout');
        });
    });
});

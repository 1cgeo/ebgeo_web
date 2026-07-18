import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventBus } from '../../src/js/events/event_bus.js';

let bus;

beforeEach(() => {
    bus = createEventBus();
});

// ============================================================================
// Basic emit/on
// ============================================================================

describe('EventBus emit/on', () => {
    it('delivers payload to listeners', () => {
        const handler = vi.fn();
        bus.on('test', handler);
        bus.emit('test', { data: 42 });
        expect(handler).toHaveBeenCalledWith({ data: 42 });
    });

    it('supports multiple listeners on same event', () => {
        const h1 = vi.fn();
        const h2 = vi.fn();
        bus.on('test', h1);
        bus.on('test', h2);
        bus.emit('test', 'payload');
        expect(h1).toHaveBeenCalledWith('payload');
        expect(h2).toHaveBeenCalledWith('payload');
    });

    it('returns true when event has listeners', () => {
        bus.on('test', () => {});
        expect(bus.emit('test')).toBe(true);
    });

    it('returns false when event has no listeners', () => {
        expect(bus.emit('unknown')).toBe(false);
    });

    it('calls listeners in FIFO order', () => {
        const order = [];
        bus.on('test', () => order.push(1));
        bus.on('test', () => order.push(2));
        bus.on('test', () => order.push(3));
        bus.emit('test');
        expect(order).toEqual([1, 2, 3]);
    });
});

// ============================================================================
// Unsubscribe
// ============================================================================

describe('EventBus unsubscribe', () => {
    it('on() returns unsubscribe function', () => {
        const handler = vi.fn();
        const unsub = bus.on('test', handler);
        unsub();
        bus.emit('test');
        expect(handler).not.toHaveBeenCalled();
    });

    it('off() removes specific listener', () => {
        const h1 = vi.fn();
        const h2 = vi.fn();
        bus.on('test', h1);
        bus.on('test', h2);
        bus.off('test', h1);
        bus.emit('test');
        expect(h1).not.toHaveBeenCalled();
        expect(h2).toHaveBeenCalled();
    });

    it('off() returns false for unknown listener', () => {
        expect(bus.off('test', () => {})).toBe(false);
    });

    it('offAll() removes all listeners for event', () => {
        bus.on('test', vi.fn());
        bus.on('test', vi.fn());
        bus.offAll('test');
        expect(bus.hasListeners('test')).toBe(false);
    });

    it('offAll() without arg removes everything', () => {
        bus.on('a', vi.fn());
        bus.on('b', vi.fn());
        bus.offAll();
        expect(bus.totalListenerCount()).toBe(0);
    });
});

// ============================================================================
// once
// ============================================================================

describe('EventBus once', () => {
    it('fires handler only once', () => {
        const handler = vi.fn();
        bus.once('test', handler);
        bus.emit('test', 'first');
        bus.emit('test', 'second');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('first');
    });

    it('can be unsubscribed before firing', () => {
        const handler = vi.fn();
        const unsub = bus.once('test', handler);
        unsub();
        bus.emit('test');
        expect(handler).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Error isolation
// ============================================================================

describe('EventBus error isolation', () => {
    it('one failing handler does not prevent others from running', () => {
        const h1 = vi.fn(() => { throw new Error('handler 1 fails'); });
        const h2 = vi.fn();

        // Suppress console.error for this test
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        bus.on('test', h1);
        bus.on('test', h2);
        bus.emit('test');

        expect(h2).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});

// ============================================================================
// waitFor
// ============================================================================

describe('EventBus waitFor', () => {
    it('resolves with payload when event fires', async () => {
        setTimeout(() => bus.emit('ready', { status: 'ok' }), 10);
        const payload = await bus.waitFor('ready', 1000);
        expect(payload).toEqual({ status: 'ok' });
    });

    it('rejects on timeout', async () => {
        await expect(bus.waitFor('never', 50))
            .rejects.toThrow('Timeout waiting for event "never"');
    });
});

// ============================================================================
// Diagnostics
// ============================================================================

describe('EventBus diagnostics', () => {
    it('listenerCount returns correct count', () => {
        bus.on('a', vi.fn());
        bus.on('a', vi.fn());
        bus.on('b', vi.fn());
        expect(bus.listenerCount('a')).toBe(2);
        expect(bus.listenerCount('b')).toBe(1);
        expect(bus.listenerCount('c')).toBe(0);
    });

    it('totalListenerCount returns sum', () => {
        bus.on('a', vi.fn());
        bus.on('b', vi.fn());
        bus.on('b', vi.fn());
        expect(bus.totalListenerCount()).toBe(3);
    });

    it('eventNames returns registered events', () => {
        bus.on('alpha', vi.fn());
        bus.on('beta', vi.fn());
        expect(bus.eventNames()).toContain('alpha');
        expect(bus.eventNames()).toContain('beta');
    });

    it('debug() returns structured info', () => {
        bus.on('x', vi.fn());
        bus.on('y', vi.fn());
        bus.on('y', vi.fn());
        const info = bus.debug();
        expect(info.totalListeners).toBe(3);
        expect(info.listenersByEvent.x).toBe(1);
        expect(info.listenersByEvent.y).toBe(2);
    });

    it('hasListeners returns correct state', () => {
        expect(bus.hasListeners('test')).toBe(false);
        bus.on('test', vi.fn());
        expect(bus.hasListeners('test')).toBe(true);
    });
});

// ============================================================================
// Validation
// ============================================================================

describe('EventBus validation', () => {
    it('throws on non-function callback', () => {
        expect(() => bus.on('test', 'not a function')).toThrow('callback must be a function');
    });

    it('throws on empty event name', () => {
        expect(() => bus.on('', vi.fn())).toThrow('event must be a non-empty string');
    });
});

// ============================================================================
// Sync lifecycle events (backend integration pattern)
// ============================================================================

describe('EventBus lifecycle event patterns', () => {
    it('simulates FEATURE_CREATED event with full payload', () => {
        const handler = vi.fn();
        bus.on('feature:created', handler);

        const payload = {
            featureId: 'f-123',
            featureType: 'polygon',
            mapId: 'map-456',
            feature: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] } },
            previousFeature: null
        };

        bus.emit('feature:created', payload);
        expect(handler).toHaveBeenCalledWith(payload);
    });

    it('simulates multiple listeners for FEATURE_MODIFIED (UI + sync)', () => {
        const uiHandler = vi.fn();
        const syncHandler = vi.fn();

        bus.on('feature:modified', uiHandler);
        bus.on('feature:modified', syncHandler);

        const payload = { featureId: 'f-1', version: 5 };
        bus.emit('feature:modified', payload);

        expect(uiHandler).toHaveBeenCalledWith(payload);
        expect(syncHandler).toHaveBeenCalledWith(payload);
    });

    it('simulates store error event chain', () => {
        const errorHandler = vi.fn();
        bus.on('store:persistError', errorHandler);

        bus.emit('store:persistError', {
            operation: 'addFeature',
            error: 'QuotaExceeded',
            timestamp: Date.now()
        });

        expect(errorHandler).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'addFeature' })
        );
    });
});

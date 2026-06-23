// Path: tests/unit/event-emitter-onany.test.js

/**
 * Regression tests for EventEmitter.onAny() — the wildcard tap the SyncLedger tracer
 * relies on. The load-bearing invariant: a throwing tap must NEVER break delivery to
 * real listeners, and the tap must see events that have no specific listeners.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../src/js/events/event_emitter.js';

describe('EventEmitter.onAny', () => {
    it('fires for every emit as (event, payload), including events with no specific listeners', () => {
        const bus = new EventEmitter();
        const seen = [];
        bus.onAny((event, payload) => seen.push([event, payload]));

        bus.emit('alpha', { a: 1 });
        bus.emit('beta', 2); // no specific listener registered

        expect(seen).toEqual([
            ['alpha', { a: 1 }],
            ['beta', 2],
        ]);
    });

    it('does not break delivery to specific listeners when a tap throws', () => {
        const bus = new EventEmitter();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const specific = vi.fn();
        const otherTap = vi.fn();

        bus.onAny(() => { throw new Error('tap boom'); });
        bus.onAny(otherTap);
        bus.on('alpha', specific);

        expect(() => bus.emit('alpha', 'payload')).not.toThrow();
        expect(specific).toHaveBeenCalledWith('payload');
        expect(otherTap).toHaveBeenCalledWith('alpha', 'payload');
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it('unsubscribe stops further notifications', () => {
        const bus = new EventEmitter();
        const tap = vi.fn();
        const off = bus.onAny(tap);

        bus.emit('x', 1);
        off();
        bus.emit('x', 2);

        expect(tap).toHaveBeenCalledTimes(1);
        expect(tap).toHaveBeenCalledWith('x', 1);
    });

    it('rejects a non-function callback', () => {
        const bus = new EventEmitter();
        expect(() => bus.onAny(null)).toThrow(TypeError);
    });
});

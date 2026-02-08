import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectionState, ConnectionStates } from '../../src/js/store/sync/connection-state.js';

let state;

beforeEach(() => {
    state = new ConnectionState();
});

// ============================================================================
// Initial state
// ============================================================================

describe('ConnectionState initial state', () => {
    it('starts in OFFLINE', () => {
        expect(state.getState()).toBe(ConnectionStates.OFFLINE);
    });

    it('isOnline returns false', () => {
        expect(state.isOnline()).toBe(false);
    });

    it('isConnected returns false', () => {
        expect(state.isConnected()).toBe(false);
    });
});

// ============================================================================
// Valid transitions
// ============================================================================

describe('Valid transitions', () => {
    it('OFFLINE → CONNECTING', () => {
        state.transition(ConnectionStates.CONNECTING);
        expect(state.getState()).toBe(ConnectionStates.CONNECTING);
    });

    it('CONNECTING → ONLINE', () => {
        state.transition(ConnectionStates.CONNECTING);
        state.transition(ConnectionStates.ONLINE);
        expect(state.getState()).toBe(ConnectionStates.ONLINE);
        expect(state.isOnline()).toBe(true);
    });

    it('ONLINE → RECONNECTING', () => {
        state.transition(ConnectionStates.CONNECTING);
        state.transition(ConnectionStates.ONLINE);
        state.transition(ConnectionStates.RECONNECTING);
        expect(state.getState()).toBe(ConnectionStates.RECONNECTING);
        expect(state.isConnected()).toBe(true);
    });

    it('RECONNECTING → ONLINE', () => {
        state.transition(ConnectionStates.CONNECTING);
        state.transition(ConnectionStates.ONLINE);
        state.transition(ConnectionStates.RECONNECTING);
        state.transition(ConnectionStates.ONLINE);
        expect(state.isOnline()).toBe(true);
    });

    it('any state → OFFLINE', () => {
        state.transition(ConnectionStates.CONNECTING);
        state.transition(ConnectionStates.OFFLINE);
        expect(state.getState()).toBe(ConnectionStates.OFFLINE);

        state.transition(ConnectionStates.CONNECTING);
        state.transition(ConnectionStates.ONLINE);
        state.transition(ConnectionStates.OFFLINE);
        expect(state.getState()).toBe(ConnectionStates.OFFLINE);

        state.transition(ConnectionStates.CONNECTING);
        state.transition(ConnectionStates.ONLINE);
        state.transition(ConnectionStates.RECONNECTING);
        state.transition(ConnectionStates.OFFLINE);
        expect(state.getState()).toBe(ConnectionStates.OFFLINE);
    });

    it('same state transition is a no-op', () => {
        const listener = vi.fn();
        state.onStateChanged(listener);
        state.transition(ConnectionStates.OFFLINE);
        expect(listener).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Invalid transitions
// ============================================================================

describe('Invalid transitions', () => {
    it('OFFLINE → ONLINE throws', () => {
        expect(() => state.transition(ConnectionStates.ONLINE)).toThrow('Invalid connection state transition');
    });

    it('OFFLINE → RECONNECTING throws', () => {
        expect(() => state.transition(ConnectionStates.RECONNECTING)).toThrow('Invalid');
    });

    it('CONNECTING → RECONNECTING throws', () => {
        state.transition(ConnectionStates.CONNECTING);
        expect(() => state.transition(ConnectionStates.RECONNECTING)).toThrow('Invalid');
    });

    it('ONLINE → CONNECTING throws', () => {
        state.transition(ConnectionStates.CONNECTING);
        state.transition(ConnectionStates.ONLINE);
        expect(() => state.transition(ConnectionStates.CONNECTING)).toThrow('Invalid');
    });
});

// ============================================================================
// Observer
// ============================================================================

describe('onStateChanged', () => {
    it('notifies on transition', () => {
        const listener = vi.fn();
        state.onStateChanged(listener);
        state.transition(ConnectionStates.CONNECTING);

        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith({
            previousState: ConnectionStates.OFFLINE,
            currentState: ConnectionStates.CONNECTING
        });
    });

    it('returns unsubscribe function', () => {
        const listener = vi.fn();
        const unsub = state.onStateChanged(listener);
        unsub();
        state.transition(ConnectionStates.CONNECTING);
        expect(listener).not.toHaveBeenCalled();
    });

    it('throws if callback is not a function', () => {
        expect(() => state.onStateChanged('bad')).toThrow();
    });

    it('does not crash if listener throws', () => {
        state.onStateChanged(() => { throw new Error('boom'); });
        expect(() => state.transition(ConnectionStates.CONNECTING)).not.toThrow();
    });

    it('multiple listeners all notified', () => {
        const l1 = vi.fn();
        const l2 = vi.fn();
        state.onStateChanged(l1);
        state.onStateChanged(l2);
        state.transition(ConnectionStates.CONNECTING);
        expect(l1).toHaveBeenCalledOnce();
        expect(l2).toHaveBeenCalledOnce();
    });
});

// ============================================================================
// _reset
// ============================================================================

describe('_reset', () => {
    it('returns to OFFLINE and clears listeners', () => {
        const listener = vi.fn();
        state.onStateChanged(listener);
        state.transition(ConnectionStates.CONNECTING);
        state._reset();

        expect(state.getState()).toBe(ConnectionStates.OFFLINE);

        state.transition(ConnectionStates.CONNECTING);
        expect(listener).toHaveBeenCalledTimes(1); // Only the first call
    });
});

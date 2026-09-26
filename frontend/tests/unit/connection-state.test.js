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

// ============================================================================
// HTTP_ONLY: sem tempo real (2026-09-25)
// ============================================================================

describe('HTTP_ONLY: o servidor responde e o socket não abriu', () => {
    /** Walks the machine to `alvo` through legal moves only. */
    function ate(...caminho) {
        for (const estado of caminho) state.transition(estado);
    }

    it('entra pela abertura (CONNECTING) e pela sonda depois da queda (RECONNECTING)', () => {
        ate(ConnectionStates.CONNECTING, ConnectionStates.HTTP_ONLY);
        expect(state.getState()).toBe(ConnectionStates.HTTP_ONLY);

        const outro = new ConnectionState();
        outro.transition(ConnectionStates.CONNECTING);
        outro.transition(ConnectionStates.ONLINE);
        outro.transition(ConnectionStates.RECONNECTING);
        outro.transition(ConnectionStates.HTTP_ONLY);
        expect(outro.isHttpOnly()).toBe(true);
    });

    it('sai para ONLINE (o socket voltou), RECONNECTING (o HTTP parou) e OFFLINE (saída)', () => {
        for (const destino of [ConnectionStates.ONLINE, ConnectionStates.RECONNECTING, ConnectionStates.OFFLINE]) {
            const maquina = new ConnectionState();
            maquina.transition(ConnectionStates.CONNECTING);
            maquina.transition(ConnectionStates.HTTP_ONLY);
            maquina.transition(destino);
            expect(maquina.getState()).toBe(destino);
        }
    });

    it('não se entra direto do ONLINE nem do OFFLINE, e não se volta a CONNECTING', () => {
        const online = new ConnectionState();
        online.transition(ConnectionStates.CONNECTING);
        online.transition(ConnectionStates.ONLINE);
        expect(() => online.transition(ConnectionStates.HTTP_ONLY)).toThrow();
        expect(() => state.transition(ConnectionStates.HTTP_ONLY)).toThrow();
        ate(ConnectionStates.CONNECTING, ConnectionStates.HTTP_ONLY);
        expect(() => state.transition(ConnectionStates.CONNECTING)).toThrow();
    });

    it('as duas perguntas: o canal ao vivo não está de pé, e o servidor é alcançável', () => {
        ate(ConnectionStates.CONNECTING, ConnectionStates.HTTP_ONLY);
        expect(state.isOnline()).toBe(false);
        expect(state.canReachServer()).toBe(true);
    });

    it('canReachServer só é verdade em ONLINE e HTTP_ONLY', () => {
        const respostas = {};
        const maquina = new ConnectionState();
        respostas[maquina.getState()] = maquina.canReachServer();
        maquina.transition(ConnectionStates.CONNECTING);
        respostas[maquina.getState()] = maquina.canReachServer();
        maquina.transition(ConnectionStates.ONLINE);
        respostas[maquina.getState()] = maquina.canReachServer();
        maquina.transition(ConnectionStates.RECONNECTING);
        respostas[maquina.getState()] = maquina.canReachServer();
        maquina.transition(ConnectionStates.HTTP_ONLY);
        respostas[maquina.getState()] = maquina.canReachServer();
        expect(respostas).toEqual({
            [ConnectionStates.OFFLINE]: false,
            [ConnectionStates.CONNECTING]: false,
            [ConnectionStates.ONLINE]: true,
            [ConnectionStates.RECONNECTING]: false,
            [ConnectionStates.HTTP_ONLY]: true,
        });
        // Every state of the enum was visited: a sixth state would have to be classified here.
        expect(Object.keys(respostas).sort()).toEqual(Object.values(ConnectionStates).sort());
    });
});

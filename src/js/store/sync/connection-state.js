// Path: js/store/sync/connection-state.js

/**
 * @fileoverview Connection state machine for sync system.
 * Tracks the connection state between the client and the backend.
 *
 * States: OFFLINE → CONNECTING → ONLINE → RECONNECTING → OFFLINE
 * Any state can transition to OFFLINE.
 *
 * Without a backend, the state is permanently OFFLINE.
 * When the WebSocket client is implemented, it controls transitions.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Connection states.
 * @readonly
 * @enum {string}
 */
export const ConnectionStates = Object.freeze({
    OFFLINE: 'offline',
    CONNECTING: 'connecting',
    ONLINE: 'online',
    RECONNECTING: 'reconnecting'
});

/**
 * Valid state transitions.
 * Keys are current states, values are arrays of allowed next states.
 * @type {Object.<string, string[]>}
 */
const VALID_TRANSITIONS = Object.freeze({
    [ConnectionStates.OFFLINE]: [ConnectionStates.CONNECTING],
    [ConnectionStates.CONNECTING]: [ConnectionStates.ONLINE, ConnectionStates.OFFLINE],
    [ConnectionStates.ONLINE]: [ConnectionStates.RECONNECTING, ConnectionStates.OFFLINE],
    [ConnectionStates.RECONNECTING]: [ConnectionStates.ONLINE, ConnectionStates.OFFLINE]
});

// ============================================================================
// CONNECTION STATE CLASS
// ============================================================================

/**
 * Manages connection state and notifies subscribers on transitions.
 */
class ConnectionState {
    constructor() {
        /** @type {string} */
        this._state = ConnectionStates.OFFLINE;

        /** @type {Set<Function>} */
        this._listeners = new Set();
    }

    /**
     * Current connection state.
     * @returns {string}
     */
    getState() {
        return this._state;
    }

    /**
     * Whether the connection is online.
     * @returns {boolean}
     */
    isOnline() {
        return this._state === ConnectionStates.ONLINE;
    }

    /**
     * Whether there is an active or recovering connection.
     * @returns {boolean}
     */
    isConnected() {
        return this._state === ConnectionStates.ONLINE || this._state === ConnectionStates.RECONNECTING;
    }

    /**
     * Transitions to a new state.
     * Validates the transition and notifies subscribers.
     * @param {string} newState - Target state (from ConnectionStates)
     * @throws {Error} If the transition is invalid
     */
    transition(newState) {
        if (newState === this._state) return;

        const allowed = VALID_TRANSITIONS[this._state];
        if (!allowed || !allowed.includes(newState)) {
            throw new Error(
                `Invalid connection state transition: ${this._state} → ${newState}`
            );
        }

        const previousState = this._state;
        this._state = newState;
        this._notifyListeners(previousState, newState);
    }

    /**
     * Subscribes to state changes.
     * @param {Function} callback - Called with { previousState, currentState }
     * @returns {Function} Unsubscribe function
     */
    onStateChanged(callback) {
        if (typeof callback !== 'function') {
            throw new Error('callback must be a function');
        }
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    // ===== INTERNAL =====

    /** @private */
    _notifyListeners(previousState, currentState) {
        for (const listener of this._listeners) {
            try {
                listener({ previousState, currentState });
            } catch (error) {
                console.warn('ConnectionState listener error:', error);
            }
        }
    }

    /**
     * Resets to initial state (for testing).
     */
    _reset() {
        this._state = ConnectionStates.OFFLINE;
        this._listeners.clear();
    }
}

// ============================================================================
// SINGLETON
// ============================================================================

/**
 * Singleton ConnectionState instance.
 * @type {ConnectionState}
 */
export const connectionState = new ConnectionState();

// Export class for testing
export { ConnectionState };

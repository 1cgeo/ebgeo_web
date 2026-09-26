// Path: js/store/sync/connection-state.js

/**
 * @fileoverview Connection state machine for sync system.
 * Tracks the connection state between the client and the backend.
 *
 * States: OFFLINE → CONNECTING → ONLINE → RECONNECTING → OFFLINE, plus HTTP_ONLY below.
 * Any state can transition to OFFLINE.
 *
 * HTTP_ONLY ("sem tempo real", owner's decision of 2026-09-25) is the fifth state: the server
 * answers over HTTP and the collaboration socket does not open (a proxy that drops the upgrade).
 * The atlas stays open, the flush sends over HTTP and a periodic pull brings the colleagues'
 * edits; presence does not exist. It is entered from CONNECTING (the opening) or RECONNECTING (a
 * socket that dropped and an HTTP probe that answered), and left to ONLINE by the socket's own
 * `connected` frame, or to RECONNECTING when the HTTP stops answering too. The SYNC ENGINE drives
 * those transitions (`sync-engine.js`); the socket client only stays out of them while it retries
 * in the background. The rules live in `sem-tempo-real.js`.
 *
 * TWO QUESTIONS, TWO METHODS, and confusing them is the defect to avoid: {@link
 * ConnectionState#isOnline} is "is the LIVE channel up" (presence, the socket's frames, the replay
 * guards), and {@link ConnectionState#canReachServer} is "can this tab talk to the server" (the
 * flush, the image uploads, the REST gestures that need the server).
 *
 * Without a backend, the state is permanently OFFLINE.
 */

/**
 * Connection states.
 * @readonly
 * @enum {string}
 */
export const ConnectionStates = Object.freeze({
    OFFLINE: 'offline',
    CONNECTING: 'connecting',
    ONLINE: 'online',
    RECONNECTING: 'reconnecting',
    HTTP_ONLY: 'http-only'
});

/**
 * Valid state transitions.
 * Keys are current states, values are arrays of allowed next states.
 * @type {Object.<string, string[]>}
 */
const VALID_TRANSITIONS = Object.freeze({
    [ConnectionStates.OFFLINE]: [ConnectionStates.CONNECTING],
    [ConnectionStates.CONNECTING]: [ConnectionStates.ONLINE, ConnectionStates.OFFLINE, ConnectionStates.HTTP_ONLY],
    [ConnectionStates.ONLINE]: [ConnectionStates.RECONNECTING, ConnectionStates.OFFLINE],
    [ConnectionStates.RECONNECTING]: [ConnectionStates.ONLINE, ConnectionStates.OFFLINE, ConnectionStates.HTTP_ONLY],
    [ConnectionStates.HTTP_ONLY]: [ConnectionStates.ONLINE, ConnectionStates.OFFLINE, ConnectionStates.RECONNECTING]
});

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
     * Whether the server answers over HTTP while the live channel is down ("sem tempo real").
     * @returns {boolean}
     */
    isHttpOnly() {
        return this._state === ConnectionStates.HTTP_ONLY;
    }

    /**
     * Whether this tab can talk to the server right now, live channel or not: ONLINE or HTTP_ONLY.
     * The question of whoever sends over HTTP (the flush, the image uploads, a REST gesture).
     * @returns {boolean}
     */
    canReachServer() {
        return this._state === ConnectionStates.ONLINE
            || this._state === ConnectionStates.HTTP_ONLY;
    }

    /**
     * Whether there is an active or recovering connection.
     * @returns {boolean}
     */
    isConnected() {
        return this._state === ConnectionStates.ONLINE
            || this._state === ConnectionStates.RECONNECTING;
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
        if (!allowed?.includes(newState)) {
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

/**
 * Singleton ConnectionState instance.
 * @type {ConnectionState}
 */
export const connectionState = new ConnectionState();

export { ConnectionState };

// Path: js/store/sync/ws-client.js

/**
 * @fileoverview WebSocket transport for real-time collaboration (the WS half of
 * the sync layer; the HTTP half is `api-client.js`).
 *
 * Connects to the backend collab gateway (`…/api/v1/collab?atlasId=&token=&clientId=`),
 * drives the {@link connectionState} machine, and routes the documented protocol:
 *
 *   inbound  : connected | operation | operations | ack | ack_batch | sync_response |
 *              cursor | selection | temporal | user_joined | user_left | user_away |
 *              user_back | pong | error | adaptive-settings | briefing_edit_started/ended
 *   outbound : operation | operations | ping | cursor | selection | temporal |
 *              briefing_edit_start | briefing_edit_end | sync_request | leave
 *
 * Features: heartbeat ping, exponential-backoff reconnect, and on (re)connect a
 * `sync_request` with the last applied version so the server replays missed ops.
 *
 * The socket constructor is injectable (`socketFactory`) so tests can drive a fake
 * socket; in the browser / Node ≥21 it defaults to the global `WebSocket`.
 *
 * @dependencies api-client.js, connection-state.js
 */

import { connectionState as defaultConnectionState, ConnectionStates } from './connection-state.js';
import { apiClient as defaultApiClient } from './api-client.js';

const DEFAULT_HEARTBEAT_MS = 25000;
const DEFAULT_RECONNECT_BASE_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 30000;

/** Close code used for an intentional client-side disconnect. */
const CLOSE_INTENTIONAL = 1000;

/**
 * Real-time collaboration WebSocket client.
 */
export class WsClient {
    /**
     * @param {Object} [opts]
     * @param {import('./api-client.js').ApiClient} [opts.apiClient] - For wsUrl()/token.
     * @param {import('./connection-state.js').ConnectionState} [opts.connectionState]
     * @param {(url: string) => WebSocket} [opts.socketFactory] - Defaults to global WebSocket.
     * @param {string} [opts.clientId] - Stable client id (presence/idempotency).
     * @param {number} [opts.heartbeatMs]
     * @param {number} [opts.reconnectBaseMs]
     * @param {number} [opts.reconnectMaxMs]
     */
    constructor({
        apiClient = defaultApiClient,
        connectionState = defaultConnectionState,
        socketFactory,
        clientId,
        heartbeatMs = DEFAULT_HEARTBEAT_MS,
        reconnectBaseMs = DEFAULT_RECONNECT_BASE_MS,
        reconnectMaxMs = DEFAULT_RECONNECT_MAX_MS,
    } = {}) {
        this._api = apiClient;
        this._conn = connectionState;
        this._socketFactory = socketFactory || ((url) => new globalThis.WebSocket(url));
        this._clientId = clientId || null;
        this._heartbeatMs = heartbeatMs;
        this._reconnectBaseMs = reconnectBaseMs;
        this._reconnectMaxMs = reconnectMaxMs;

        /** @type {WebSocket|null} */
        this._socket = null;
        /** @type {string|null} */
        this._atlasId = null;
        /** Whether the consumer wants an active connection (controls reconnect). */
        this._wantConnected = false;
        /** Last server version applied locally (drives replay on reconnect). */
        this._lastVersion = 0;
        this._reconnectAttempts = 0;
        this._heartbeatTimer = null;
        this._reconnectTimer = null;
        this._connectResolve = null;
        this._connectReject = null;

        /** @type {Object<string, Function>} Inbound handlers (set via on()). */
        this._handlers = {};
        /** Session info from the last `connected` frame. */
        this.session = null;
    }

    // ===== PUBLIC API =====

    /**
     * Registers a handler for an inbound event. Known events:
     * 'connected', 'operation', 'ack', 'syncResponse', 'presence', 'cursor',
     * 'selection', 'temporal', 'error', 'adaptiveSettings', 'briefingEdit',
     * 'stateChange'.
     * @param {string} event
     * @param {Function} handler
     * @returns {this}
     */
    on(event, handler) {
        this._handlers[event] = handler;
        return this;
    }

    /**
     * Opens a connection for an atlas. Resolves on the `connected` frame.
     * @param {string} atlasId
     * @param {Object} [opts]
     * @param {number} [opts.lastVersion=0] - Version already applied locally.
     * @returns {Promise<Object>} The `connected` payload (sessionId, permission, role, ...).
     */
    connect(atlasId, { lastVersion = 0 } = {}) {
        this._atlasId = atlasId;
        this._lastVersion = lastVersion;
        this._wantConnected = true;
        this._reconnectAttempts = 0;
        return this._open();
    }

    /** Closes the connection intentionally (no reconnect). */
    disconnect() {
        this._wantConnected = false;
        this._clearTimers();
        if (this._socket) {
            try {
                this._sendRaw({ type: 'leave' });
                this._socket.close(CLOSE_INTENTIONAL, 'leave');
            } catch {
                /* already closing */
            }
        }
        this._socket = null;
        this._safeTransition(ConnectionStates.OFFLINE);
    }

    /** @returns {boolean} Whether the socket is open and handshaken. */
    isConnected() {
        return this._conn.isOnline();
    }

    /**
     * Records the highest server version applied locally (used to replay on reconnect).
     * @param {number} version
     */
    setLastVersion(version) {
        if (Number.isFinite(version) && version > this._lastVersion) {
            this._lastVersion = version;
        }
    }

    /**
     * Sends a single operation. Returns false if not connected (caller keeps it queued).
     * @param {Object} op - Operation envelope from the operation factory.
     * @returns {boolean}
     */
    sendOperation(op) {
        return this._sendRaw({ type: 'operation', op });
    }

    /**
     * Sends a batch of operations.
     * @param {Object[]} ops
     * @returns {boolean}
     */
    sendOperations(ops) {
        return this._sendRaw({ type: 'operations', ops });
    }

    /**
     * Sends a cursor position (presence).
     * @param {{ position: Object, mapId: string }} payload
     * @returns {boolean}
     */
    sendCursor({ position, mapId }) {
        return this._sendRaw({ type: 'cursor', position, mapId });
    }

    /**
     * Sends the current feature selection (presence).
     * @param {{ featureIds: string[], mapId: string }} payload
     * @returns {boolean}
     */
    sendSelection({ featureIds, mapId }) {
        return this._sendRaw({ type: 'selection', featureIds, mapId });
    }

    /**
     * Sends the local temporal viewing state (presence). The timeline is local
     * per user, so this is awareness only — peers render the instant/playback.
     * @param {*} state - Opaque temporal state blob (cursor/playing/ctx).
     * @param {string} mapId - Active map id.
     * @returns {boolean}
     */
    sendTemporal(state, mapId) {
        return this._sendRaw({ type: 'temporal', state, mapId });
    }

    /**
     * Announces that this user started editing a briefing (presence/awareness).
     * @param {string} briefingId
     * @returns {boolean}
     */
    sendBriefingEditStart(briefingId) {
        return this._sendRaw({ type: 'briefing_edit_start', briefingId });
    }

    /**
     * Announces that this user stopped editing a briefing (presence/awareness).
     * @param {string} briefingId
     * @returns {boolean}
     */
    sendBriefingEditEnd(briefingId) {
        return this._sendRaw({ type: 'briefing_edit_end', briefingId });
    }

    /**
     * Requests replay of operations since a version (server returns ops or a snapshot).
     * @param {number} [lastVersion] - Defaults to the tracked last version.
     * @returns {boolean}
     */
    requestSync(lastVersion = this._lastVersion) {
        return this._sendRaw({ type: 'sync_request', lastVersion });
    }

    // ===== INTERNAL: CONNECTION LIFECYCLE =====

    /** @private Opens the socket and wires lifecycle handlers. */
    _open() {
        const url = this._api.wsUrl(this._atlasId, { clientId: this._clientId });
        this._safeTransition(ConnectionStates.CONNECTING);

        return new Promise((resolve, reject) => {
            this._connectResolve = resolve;
            this._connectReject = reject;

            let socket;
            try {
                socket = this._socketFactory(url);
            } catch (err) {
                this._handleConnectFailure(err);
                reject(err);
                return;
            }
            this._socket = socket;

            socket.onopen = () => {
                // The handshake completes on the server's `connected` frame, not here.
            };
            socket.onmessage = (event) => this._onMessage(event);
            socket.onerror = (event) => {
                this._emit('error', { kind: 'socket', event });
            };
            socket.onclose = (event) => this._onClose(event);
        });
    }

    /** @private Handles an inbound socket message. */
    _onMessage(event) {
        let msg;
        try {
            msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        } catch {
            return;
        }

        switch (msg.type) {
            case 'connected':
                this._onConnected(msg);
                break;
            case 'operation':
                this._applyInboundOps(msg.op ? [msg.op] : []);
                break;
            case 'operations':
                this._applyInboundOps(Array.isArray(msg.ops) ? msg.ops : []);
                break;
            case 'ack':
                this._emit('ack', { opIds: [msg.opId], serverVersion: msg.serverVersion, results: msg.result ? [msg.result] : [] });
                break;
            case 'ack_batch':
                this._emit('ack', { opIds: msg.opIds || [], serverVersion: msg.serverVersion, results: msg.results || [] });
                break;
            case 'sync_response':
                if (Number.isFinite(msg.currentVersion)) this.setLastVersion(msg.currentVersion);
                this._emit('syncResponse', msg);
                break;
            case 'pong':
                this._pongPending = false;
                break;
            case 'cursor':
                this._emit('cursor', msg);
                break;
            case 'selection':
                this._emit('selection', msg);
                break;
            case 'temporal':
                this._emit('temporal', msg);
                break;
            case 'user_joined':
            case 'user_left':
            case 'user_away':
            case 'user_back':
                this._emit('presence', msg);
                break;
            case 'briefing_edit_started':
            case 'briefing_edit_ended':
                this._emit('briefingEdit', msg);
                break;
            case 'adaptive-settings':
                this._emit('adaptiveSettings', msg);
                break;
            case 'error':
                this._emit('error', { kind: 'server', code: msg.code, message: msg.message });
                break;
            default:
                // Unknown/forward-compatible message — ignore.
                break;
        }
    }

    /** @private Routes a batch of inbound operations, skipping this client's own echoes. */
    _applyInboundOps(ops) {
        const handler = this._handlers.operation;
        if (!handler) return;
        for (const op of ops) {
            // The HTTP-push broadcast can't exclude the sender; ignore our own echo.
            if (op.clientId && this._clientId && op.clientId === this._clientId) continue;
            // SERIALIZE: the handler does an async read-modify-write of the map's store
            // entry. Applying ops concurrently (a batch broadcast, or rapid ops) races —
            // concurrent IndexedDB writes to the same map key clobber each other, losing
            // all but one. Chain each apply after the previous one fully completes.
            this._applyChain = (this._applyChain || Promise.resolve())
                .then(() => handler(op))
                .catch((err) => { console.warn('Remote op apply failed:', err); });
        }
    }

    /** @private Completes the handshake on the server `connected` frame. */
    _onConnected(msg) {
        const wasReconnecting = this._conn.getState() === ConnectionStates.RECONNECTING;
        this.session = msg;
        this._reconnectAttempts = 0;
        this._safeTransition(ConnectionStates.ONLINE);
        this._startHeartbeat();
        this._emit('connected', msg);

        // On reconnect, ask the server to replay everything since our last version.
        if (wasReconnecting) {
            this.requestSync(this._lastVersion);
        }

        if (this._connectResolve) {
            this._connectResolve(msg);
            this._connectResolve = null;
            this._connectReject = null;
        }
    }

    /** @private Handles socket close: reconnect (if wanted) or go offline. */
    _onClose(event) {
        this._clearHeartbeat();
        this._socket = null;

        if (!this._wantConnected) {
            this._safeTransition(ConnectionStates.OFFLINE);
            return;
        }

        // Unexpected drop while we want to stay connected → reconnect with backoff.
        this._safeTransition(
            this._conn.isOnline() ? ConnectionStates.RECONNECTING : ConnectionStates.RECONNECTING
        );
        this._emit('error', { kind: 'closed', code: event?.code, reason: event?.reason });
        this._scheduleReconnect();
    }

    /** @private Reports a failure to open the socket. */
    _handleConnectFailure(err) {
        this._emit('error', { kind: 'connect', error: err });
        if (this._wantConnected) this._scheduleReconnect();
        else this._safeTransition(ConnectionStates.OFFLINE);
    }

    /** @private Schedules a reconnect attempt with exponential backoff. */
    _scheduleReconnect() {
        if (this._reconnectTimer) return;
        const delay = Math.min(
            this._reconnectBaseMs * 2 ** this._reconnectAttempts,
            this._reconnectMaxMs
        );
        this._reconnectAttempts++;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (!this._wantConnected) return;
            // From RECONNECTING we must go through CONNECTING again per the state machine.
            this._open().catch(() => { /* _onClose will reschedule */ });
        }, delay);
        if (typeof this._reconnectTimer?.unref === 'function') this._reconnectTimer.unref();
    }

    // ===== INTERNAL: HEARTBEAT =====

    /** @private Starts the heartbeat ping loop. */
    _startHeartbeat() {
        this._clearHeartbeat();
        this._pongPending = false;
        this._heartbeatTimer = setInterval(() => {
            // If the previous ping was never ponged, treat the link as dead.
            if (this._pongPending && this._socket) {
                try { this._socket.close(4000, 'heartbeat timeout'); } catch { /* noop */ }
                return;
            }
            this._pongPending = true;
            this._sendRaw({ type: 'ping' });
        }, this._heartbeatMs);
        if (typeof this._heartbeatTimer?.unref === 'function') this._heartbeatTimer.unref();
    }

    /** @private */
    _clearHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    /** @private */
    _clearTimers() {
        this._clearHeartbeat();
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    // ===== INTERNAL: HELPERS =====

    /**
     * @private Sends a JSON message if the socket is open.
     * @returns {boolean} Whether the message was sent.
     */
    _sendRaw(message) {
        const OPEN = globalThis.WebSocket?.OPEN ?? 1;
        if (!this._socket || this._socket.readyState !== OPEN) return false;
        try {
            this._socket.send(JSON.stringify(message));
            return true;
        } catch {
            return false;
        }
    }

    /** @private Transitions connection state, ignoring no-op/invalid transitions. */
    _safeTransition(state) {
        try {
            this._conn.transition(state);
            this._emit('stateChange', { state });
        } catch {
            // Same-state or invalid transition — ignore (machine stays consistent).
        }
    }

    /** @private Invokes a registered handler. */
    _emit(event, payload) {
        const handler = this._handlers[event];
        if (handler) {
            try {
                handler(payload);
            } catch (err) {
                console.warn(`WsClient handler "${event}" error:`, err);
            }
        }
    }
}

/** Shared singleton WS client. */
export const wsClient = new WsClient();

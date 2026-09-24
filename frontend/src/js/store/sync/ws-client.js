// Path: js/store/sync/ws-client.js

/**
 * @fileoverview WebSocket transport for real-time collaboration (the WS half of
 * the sync layer; the HTTP half is `api-client.js`).
 *
 * Connects to the backend collab gateway (`…/api/v1/collab?atlasId=&token=&clientId=`),
 * drives the {@link connectionState} machine, and routes the documented protocol:
 *
 *   inbound  : connected | operation | operations | ack | ack_batch | sync_response |
 *              cursor | selection | viewer_context | user_joined | user_left | user_away |
 *              user_back | pong | error | adaptive-settings | briefing_edit_started/ended
 *   outbound : operation | operations | ping | cursor | selection | viewer_context |
 *              briefing_edit_start | briefing_edit_end | sync_request | leave
 *
 * NÃO HÁ QUADRO `temporal` NESTA LISTA desde 2026-09-21, por decisão do dono: o instante da
 * linha do tempo de uma pessoa deixou de se propagar. Um SERVIDOR antigo ainda pode mandar um,
 * e ele cai no `default` do roteamento de entrada, que já descarta tipo desconhecido em silêncio.
 *
 * Features: heartbeat ping, exponential-backoff reconnect, and on (re)connect a
 * `sync_request` with the last applied version so the server replays missed ops. That frame also
 * carries `haveSnapshot: true` when the local state is COMPLETE at that version, which is the
 * only way to say "up to date" about an atlas still at version zero (see {@link requestSync}).
 *
 * The socket constructor is injectable (`socketFactory`) so tests can drive a fake
 * socket; in the browser / Node ≥21 it defaults to the global `WebSocket`.
 *
 * @dependencies api-client.js, connection-state.js
 */

import { connectionState as defaultConnectionState, ConnectionStates } from './connection-state.js';
import { apiClient as defaultApiClient } from './api-client.js';
import { clientIdInstallation, getClientId } from './operation-factory.js';
import { record } from './diag/trace-core.js';
import { TraceStage, TraceOutcome, DropReason } from './diag/trace-stages.js';
import { relatarErro } from '@js/session/erro-telemetria.js';
import { OrigemDeErro } from '@js/session/origens-de-erro.js';

const DEFAULT_HEARTBEAT_MS = 25000;

/**
 * The most heartbeat ticks a pong may stay overdue before the socket is closed, once the
 * tolerance has escalated (see {@link WsClient#_startHeartbeat}): 16 ticks of 25 s is 400 s,
 * enough for a 2 MB frame at 40 kbps.
 */
const HEARTBEAT_MAX_MISSED_TICKS = 16;
const DEFAULT_RECONNECT_BASE_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 30000;

/** Coalescable presence frame types — safe to drop under local outbound backpressure. */
const COALESCABLE_TYPES = new Set(['cursor', 'cursors', 'selection']);
/** Drop coalescable presence frames when the local outbound buffer exceeds this (bytes). */
const PRESENCE_BUFFER_LIMIT = 1 << 20; // 1 MiB

/** Close code used for an intentional client-side disconnect. */
const CLOSE_INTENTIONAL = 1000;

/**
 * What a RECONNECT does with the credential it is about to put in the upgrade URL. Pure, so the
 * rule is testable without a socket (`tests/integration/ws-reconexao-renova-credencial.repro.test.js`).
 *
 * THE UPGRADE ANSWERS AN EXPIRED JWT WITH 401 (`backend/src/modules/collab/collab.gateway.js`), and
 * a browser reports that as a close with no status, identical to a network drop. Until 2026-09-22 a
 * reconnect reused whatever token was in memory, so after a sleep longer than the access token's
 * life (15 min) every backoff step hit 401, forever or until some unrelated HTTP request renewed the
 * session: the HTTP flush that would have done it is gated on being ONLINE, which is precisely what
 * the socket was trying to become. Measured on the test stack: 24 refused upgrades in four days.
 *
 * @param {{token: (string|null), expired: boolean, renewable: boolean}|null|undefined} credencial
 *   What `apiClient.socketCredential()` answered, after renewing when it could.
 * @returns {'reabrir'|'parar-sessao-perdida'|'parar-credencial-vencida'}
 *   - `reabrir`: open the socket (also when the answer is unknown: the previous behaviour);
 *   - `parar-sessao-perdida`: the renewal failed TERMINALLY and cleared the tokens; the auth-lost
 *     handler already tells the person, and an empty token would only buy a 400 per backoff step;
 *   - `parar-credencial-vencida`: the token is past its expiry and nothing can renew it (the
 *     public-link visitor, whose token is ephemeral and has no refresh): every attempt is a 401.
 */
export function decidirReconexao(credencial) {
    if (!credencial || typeof credencial !== 'object') return 'reabrir';
    if (!credencial.token) return 'parar-sessao-perdida';
    if (credencial.expired === true && credencial.renewable !== true) return 'parar-credencial-vencida';
    return 'reabrir';
}

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
        /** Whether the local state is COMPLETE at `_lastVersion` (travels in `sync_request`). */
        this._haveSnapshot = false;
        this._reconnectAttempts = 0;
        this._heartbeatTimer = null;
        /** Heartbeat ticks the pending pong has been overdue on the current socket. */
        this._missedTicks = 0;
        /**
         * Overdue ticks tolerated before closing. Starts at 1 (the historical behaviour), doubles
         * after each heartbeat close and survives the reconnect, back to 1 on a timely pong or a
         * new `connect()`. See {@link WsClient#_startHeartbeat}.
         */
        this._missedTicksAllowed = 1;
        this._reconnectTimer = null;
        this._connectResolve = null;
        this._connectReject = null;
        /**
         * Bumped by `connect()` and `disconnect()`. A reconnect that awaited a token renewal
         * compares it afterwards, so a switch of atlas (or a logout) during that await never
         * ends with a second socket opened for the previous intent.
         */
        this._geracao = 0;

        /** @type {Object<string, Function>} Inbound handlers (set via on()). */
        this._handlers = {};
        /** Session info from the last `connected` frame. */
        this.session = null;
    }

    /**
     * @private Whether an inbound op was authored by THIS browser (not merely by this tab).
     * Compares the installation half of the client id, so an op queued before a reload — stamped
     * with the previous tab suffix — is still recognized as ours. Instance-scoped rather than the
     * module's `isOwnClientId` because test instances carry their own `clientId`.
     * @param {string} id
     * @returns {boolean}
     */
    _isOwnClientId(id) {
        const theirs = clientIdInstallation(id);
        return Boolean(theirs && theirs === clientIdInstallation(this._clientId));
    }

    // ===== PUBLIC API =====

    /**
     * Registers a handler for an inbound event. Known events:
     * 'connected', 'operation', 'ack', 'syncResponse', 'presence', 'cursor',
     * 'selection', 'viewerContext', 'error', 'adaptiveSettings', 'briefingEdit',
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
     * @param {boolean} [opts.haveSnapshot=false] - The local state is COMPLETE at `lastVersion`
     *   (the caller applied a snapshot, or a tail over a complete generation). Without it the
     *   handshake cannot tell a version-zero client that is up to date from one that holds
     *   nothing, and the server answers both with a full snapshot.
     * @returns {Promise<Object>} The `connected` payload (sessionId, permission, role, ...).
     */
    connect(atlasId, { lastVersion = 0, haveSnapshot = false } = {}) {
        this._atlasId = atlasId;
        this._lastVersion = lastVersion;
        this._haveSnapshot = haveSnapshot === true;
        this._wantConnected = true;
        this._reconnectAttempts = 0;
        this._missedTicksAllowed = 1;
        this._geracao += 1;
        return this._open();
    }

    /** Closes the connection intentionally (no reconnect). */
    disconnect() {
        this._wantConnected = false;
        this._geracao += 1;
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
     * Sends a cursor position (presence) on one of the three surfaces.
     *
     * `surface` + its scope key (mapId for 2D, tilesetId for 3D, photoName for 360) mirror what
     * `sendSelection` already carries, and the POSITION's shape follows the surface: `{lng,lat}`
     * on the map, `{heading,pitch}` inside a panorama, `{lng,lat,alt}` inside the 3D scene. The
     * backend validates one shape per surface, so shipping the wrong pair is refused, not drawn
     * in the wrong place.
     * @param {{ position: Object|null, mapId: string, surface?: '2d'|'3d'|'360',
     *   tilesetId?: string|null, photoName?: string|null }} payload
     * @returns {boolean}
     */
    sendCursor({ position, mapId, surface, tilesetId, photoName }) {
        return this._sendRaw({ type: 'cursor', position, mapId, surface, tilesetId, photoName });
    }

    /**
     * Sends the current feature selection (presence) across the 2D/3D/360 surfaces.
     * `surface` + its scope (mapId for 2D, tilesetId for 3D, photoName for 360) let a
     * peer render the selection only on the matching surface; `featureMeta` (optional)
     * ships the per-feature type so a 2D peer resolves the highlight without a lookup.
     * @param {{ featureIds: string[], mapId: string, surface?: string,
     *   featureMeta?: Array<{id: string, type: string}>, tilesetId?: string,
     *   photoName?: string }} payload
     * @returns {boolean}
     */
    sendSelection({ featureIds, mapId, surface, featureMeta, tilesetId, photoName }) {
        const msg = { type: 'selection', featureIds, mapId };
        if (surface) msg.surface = surface;
        if (Array.isArray(featureMeta)) msg.featureMeta = featureMeta;
        if (tilesetId != null) msg.tilesetId = tilesetId;
        if (photoName != null) msg.photoName = photoName;
        return this._sendRaw(msg);
    }

    /**
     * Announces which immersive viewer this user has open (presence/awareness): `'3d'` with the
     * model's `tilesetId`, `'fp'` with the walkable scene's `tilesetId`, `'360'` with the
     * `photoName`, or `'2d'` when the viewers are closed.
     *
     * ONLY THE IDENTIFIER GOES OUT, never a name: the server resolves the label from the catalog
     * and decides, per recipient, who may read it (a private model's name reaches only who can see
     * it). See `backend/src/modules/collab/collab.viewer.js`.
     * @param {{ surface: '2d'|'3d'|'360'|'fp', tilesetId?: string|null, photoName?: string|null }} payload
     * @returns {boolean}
     */
    sendViewer({ surface, tilesetId, photoName }) {
        const msg = { type: 'viewer_context', surface };
        if (tilesetId != null) msg.tilesetId = tilesetId;
        if (photoName != null) msg.photoName = photoName;
        return this._sendRaw(msg);
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
     * Records whether this client holds a COMPLETE local state at {@link _lastVersion}, which is
     * what lets `sync_request` ask for a tail instead of a snapshot at version zero.
     * @param {boolean} value
     */
    setHaveSnapshot(value) {
        this._haveSnapshot = value === true;
    }

    /**
     * Requests replay of operations since a version (server returns ops or a snapshot).
     * @param {number} [lastVersion] - Defaults to the tracked last version.
     * @param {Object} [opts]
     * @param {boolean} [opts.haveSnapshot] - Defaults to the tracked completeness flag.
     * @returns {boolean}
     */
    requestSync(lastVersion = this._lastVersion, { haveSnapshot = this._haveSnapshot } = {}) {
        // THE FIELD IS SENT ONLY WHEN TRUE, and that asymmetry is the compatibility rule. The
        // server reads an absent field as "send me everything", which is exactly what an older
        // client means and exactly what a client that cannot prove completeness means: the two
        // are indistinguishable on the wire on purpose. Sending `false` explicitly would say the
        // same thing in a second way, and a second way is a second thing to keep in agreement.
        return haveSnapshot === true
            ? this._sendRaw({ type: 'sync_request', lastVersion, haveSnapshot: true })
            : this._sendRaw({ type: 'sync_request', lastVersion });
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
            socket.onmessage = (event) => {
                if (this._socket === socket) this._onMessage(event);
            };
            socket.onerror = (event) => {
                if (this._socket !== socket) return;
                this._emit('error', { kind: 'socket', event });
            };
            socket.onclose = (event) => {
                if (this._socket === socket) this._onClose(event);
            };
        });
    }

    /** @private Handles an inbound socket message. */
    _onMessage(event) {
        let msg;
        try {
            msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        } catch {
            record(TraceStage.WS_INBOUND, { outcome: TraceOutcome.DROPPED, reason: DropReason.PARSE_ERROR });
            return;
        }

        switch (msg.type) {
            case 'connected':
                this._onConnected(msg);
                break;
            case 'operation':
                this._applyInboundOps(msg.op ? [msg.op] : [], msg.userId ?? null);
                break;
            case 'operations':
                this._applyInboundOps(Array.isArray(msg.ops) ? msg.ops : [], msg.userId ?? null);
                break;
            case 'ack': {
                const r = msg.result || {};
                record(TraceStage.PUSH_ACK, {
                    opId: msg.opId, serverVersion: msg.serverVersion ?? r.currentVersion,
                    outcome: r.idempotent ? TraceOutcome.IDEMPOTENT : TraceOutcome.OK,
                });
                this._emit('ack', { opIds: [msg.opId], serverVersion: msg.serverVersion, results: msg.result ? [msg.result] : [] });
                break;
            }
            case 'ack_batch': {
                const ids = msg.opIds || [];
                const results = msg.results || [];
                ids.forEach((id, i) => {
                    const rr = results[i] || {};
                    record(TraceStage.PUSH_ACK, {
                        opId: id, serverVersion: msg.serverVersion ?? rr.currentVersion,
                        outcome: rr.idempotent ? TraceOutcome.IDEMPOTENT : TraceOutcome.OK,
                    });
                });
                this._emit('ack', { opIds: ids, serverVersion: msg.serverVersion, results });
                break;
            }
            case 'sync_response':
                this._queueApply(async (isCurrent) => {
                    if (!this._handlers.syncResponse) return false;
                    const applied = await this._handlers.syncResponse(msg);
                    if (applied === false) throw new Error('Snapshot não aplicado.');
                    if (isCurrent()) this.setLastVersion(msg.currentVersion);
                });
                break;
            case 'pong':
                // Answered within its own tick: the link is not congested, so a later large frame
                // starts again from the strict tolerance.
                if (this._missedTicks === 0) this._missedTicksAllowed = 1;
                this._missedTicks = 0;
                this._pongPending = false;
                break;
            case 'cursor':
                this._emit('cursor', msg);
                break;
            case 'cursors':
                // LOTE DE CURSOR. O servidor deixou de retransmitir cada quadro e passou a emitir,
                // a cada `WS_CURSOR_BATCH_MS`, um lote por sala com a ÚLTIMA posição de cada
                // cliente. O motivo está medido: a sala era `atlasId -> Set<WebSocket>` sem
                // subcanal, então cada quadro virava uma escrita em socket POR PAR, e a sala de
                // 400 pedia 971.086 escritas por segundo contra um teto de cerca de 60 mil.
                //
                // O lote é expandido aqui, no fio, e o resto do cliente não muda: `presence-bridge`
                // e a camada de cursores remotos continuam recebendo o mesmo evento de sempre.
                //
                // O PRÓPRIO ECO É DESCARTADO AQUI, e é obrigação nova. Antes o servidor excluía o
                // remetente do fan-out; agora ele serializa UMA vez para a sala inteira, que é de
                // onde vem o ganho. A comparação é de `clientId` EXATO, nunca por instalação: duas
                // abas do mesmo navegador são duas presenças legítimas, e filtrar por instalação
                // apagaria o cursor da outra aba.
                for (const item of msg.lote || []) {
                    if (item.clientId && item.clientId === this._clientId) continue;
                    this._emit('cursor', { type: 'cursor', ...item });
                }
                break;
            case 'selection':
                this._emit('selection', msg);
                break;
            case 'viewer_context':
                this._emit('viewerContext', msg);
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
            case 'atlas_deleted':
                this._emit('atlasDeleted', msg);
                break;
            case 'atlas_owner_changed':
                this._emit('atlasOwnerChanged', msg);
                break;
            case 'atlas_settings_updated':
                this._emit('atlasSettings', msg);
                break;
            case 'atlas_resources_updated':
                // O frame NAO carrega os recursos: o conjunto visivel e diferente
                // por pessoa, entao mandar a lista de um no frame de todos seria
                // vazamento pelo canal de tempo real. Ele so avisa "mudou"; quem
                // recebe pede o proprio payload aditivo.
                this._emit('atlasResources', msg);
                break;
            case 'atlas_updated':
            case 'map_duplicated':
            case 'maps_merged':
                // These create/alter server-side data OUTSIDE the CRDT op log (REST clone/merge/
                // rename), so peers never receive the entities as ops. Trigger a snapshot re-pull
                // so the change is actually picked up (it was silently dropped at `default`).
                // Structural recovery is part of applying this stream, including its failure
                // boundary. A rejected fetch must reconnect from the previous cursor; merely
                // logging a rejected event handler leaves the missing change unnoticed.
                this._queueApply(async () => {
                    const handler = this._handlers.serverResync;
                    if (!handler || await handler(msg) === false) throw new Error('Recuperação estrutural não aplicada.');
                });
                break;
            case 'sharing_updated':
                this._emit('sharingUpdated', msg);
                break;
            case 'error':
                this._emit('error', { kind: 'server', code: msg.code, message: msg.message });
                break;
            default:
                // Unknown/forward-compatible message — ignored, but surfaced so a
                // protocol mismatch isn't completely invisible.
                record(TraceStage.WS_INBOUND, { type: msg.type, outcome: TraceOutcome.DROPPED, reason: DropReason.UNKNOWN_TYPE });
                break;
        }
    }

    /** @private Routes a batch of inbound operations, skipping this client's own echoes. */
    _applyInboundOps(ops, authorUserId = null) {
        const handler = this._handlers.operation;
        // THE WHOLE FRAME IN ONE APPLY when the engine registered the batch handler: it keeps the
        // per-operation contract (in order, stop at the first `false`) and lets consecutive creates
        // on one map share a single write of the map document (`applyRemoteOperations`).
        const batchHandler = ops.length > 1 ? this._handlers.operationBatch : null;
        const batch = [];
        for (const raw of ops) {
            // O AUTOR VEM NO QUADRO, NAO NA OP. O servidor manda `{type, userId, ops}`
            // (`broadcastOperations`), entao quem quiser saber quem escreveu precisa receber isso
            // aqui: sem esta linha o caminho de aplicacao tem a mudanca e nao tem o autor, que e a
            // metade que importa para avisar alguem de que foi atropelado.
            const op = { ...raw,
                ...(authorUserId ? { authorUserId } : {}),
                ...(this._isOwnClientId(raw.clientId) ? { localRepair: true } : {}),
            };
            record(TraceStage.WS_INBOUND, {
                opId: op.id, traceId: op.traceId, clientId: op.clientId,
                entityType: op.entityType, operationType: op.operationType,
                entityId: op.entityId, mapId: op.mapId, outcome: TraceOutcome.OK,
            });

            // A live event proves only this operation was delivered. Controllers can broadcast
            // after another transaction's event, so its version is not a complete replay boundary.
            // Only a fully applied sync_response advances that boundary; replay may safely repeat
            // live events. Atlas versions use a global sequence and need not be contiguous.

            // The author's canonical result must be materialized too. Local optimism is
            // not proof that the server accepted exactly those values.
            if (batchHandler) {
                batch.push(op);
                continue;
            }
            if (!handler) continue;
            // SERIALIZE: the handler does an async read-modify-write of the map's store
            // entry. Applying ops concurrently (a batch broadcast, or rapid ops) races —
            // concurrent IndexedDB writes to the same map key clobber each other, losing
            // all but one. Chain each apply after the previous one fully completes.
            this._queueApply(async () => {
                const applied = await handler(op);
                if (applied === false) throw new Error('Alteração remota não aplicada.');
            });
        }
        if (batchHandler && batch.length > 0) {
            this._queueApply(async () => {
                const applied = await batchHandler(batch);
                if (applied === false) throw new Error('Alteração remota não aplicada.');
            });
        }
    }

    /** Serialize all receive paths. A failed write closes the stream before its cursor can skip data. */
    _queueApply(work) {
        const socket = this._socket;
        this._applyChain = (this._applyChain || Promise.resolve()).then(async () => {
            if (this._socket !== socket) return;
            try {
                await work(() => this._socket === socket);
            } catch (error) {
                console.warn('Remote op apply failed:', error);
                if (this._socket === socket) socket?.close(4000, 'local apply failed');
            }
        });
        return this._applyChain;
    }

    /** @private Completes the handshake on the server `connected` frame. */
    _onConnected(msg) {
        this.session = msg;
        this._reconnectAttempts = 0;
        this._safeTransition(ConnectionStates.ONLINE);
        this._startHeartbeat();
        this._emit('connected', msg);

        // On reconnect, ask the server to replay everything since our last version. The
        // completeness flag rides along, so a client already in step with a version-zero atlas
        // gets an empty tail instead of a full snapshot it would refuse to re-enact anyway.
        this.requestSync(this._lastVersion);

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

        // Settle a handshake that never completed. A rejected UPGRADE (403: account or org
        // disabled, revoked session, no atlas permission) closes the socket WITHOUT a
        // `connected` frame, so nothing ever resolved the promise `syncEngine.connect` is
        // awaiting — the atlas-opening flow hung forever with no timeout anywhere.
        // The reconnect loop is deliberately left running: `_open()` reinstalls a fresh
        // resolve/reject pair, and `_scheduleReconnect` swallows its rejection, so a drop
        // after an established session still reconnects.
        if (this._connectReject) {
            const rejectHandshake = this._connectReject;
            this._connectResolve = null;
            this._connectReject = null;
            rejectHandshake(new Error(
                `Conexão encerrada antes do handshake (code ${event?.code ?? 'n/d'})`
            ));
        }

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
            this._reabrirComCredencialFresca();
        }, delay);
        if (typeof this._reconnectTimer?.unref === 'function') this._reconnectTimer.unref();
    }

    /**
     * @private A reconnect attempt: renews the credential FIRST, then opens the socket. See
     * {@link decidirReconexao} for why the renewal cannot be left to the HTTP layer.
     *
     * Only the RECONNECT goes through here. The first `connect()` of an atlas stays synchronous:
     * it always follows an HTTP pull that already renewed the token, and callers rely on the
     * socket existing when `connect()` returns.
     * @returns {Promise<void>}
     */
    async _reabrirComCredencialFresca() {
        const geracao = this._geracao;
        let credencial = null;
        try {
            credencial = await this._api.socketCredential?.();
        } catch {
            // The renewal swallows its own failures by contract; an unexpected throw falls back to
            // the previous behaviour (open with what is in memory) instead of stopping the loop.
            credencial = null;
        }
        // A `connect()` or `disconnect()` happened during the await: that intent owns the socket.
        if (geracao !== this._geracao || !this._wantConnected || this._socket) return;

        const decisao = decidirReconexao(credencial);
        if (decisao !== 'reabrir') {
            this._pararReconexao();
            if (decisao === 'parar-credencial-vencida') this._emit('credentialExpired', {});
            return;
        }
        // From RECONNECTING we must go through CONNECTING again per the state machine.
        this._open().catch(() => { /* _onClose will reschedule */ });
    }

    /**
     * @private Gives up reconnecting: no socket, no timer, OFFLINE. A later `connect()` (a new
     * login, a reopened atlas) starts over.
     * @returns {void}
     */
    _pararReconexao() {
        this._wantConnected = false;
        this._clearTimers();
        this._safeTransition(ConnectionStates.OFFLINE);
    }

    // ===== INTERNAL: HEARTBEAT =====

    /**
     * @private Starts the heartbeat ping loop.
     *
     * AN OVERDUE PONG IS NOT A DEAD LINK WHEN A LARGE FRAME IS AHEAD OF IT, and until 2026-09-23 the
     * loop could not tell the two apart. The browser delivers a WebSocket message only when the whole
     * frame has arrived, and the server's `pong` travels BEHIND whatever it queued before on the same
     * TCP stream. On the 40 kbps link the product targets, a 324 KB frame (one detailed feature a
     * colleague imported, or the `sync_response` replay of what this client missed offline) takes
     * about 65 s, and the loop closed the socket at its second tick (25 to 50 s). The reconnect asked
     * `sync_request` from the SAME cursor, the server answered with the SAME frame, and the loop cut
     * it again, forever: that peer never converged. Measured with
     * `tests/e2e-ui/ws-quadro-grande-em-link-lento.repro.spec.js`.
     *
     * So the tolerance ESCALATES: a heartbeat close doubles the number of overdue ticks the next
     * socket may wait ({@link HEARTBEAT_MAX_MISSED_TICKS} at most), and a pong answered within its
     * own tick brings it back to one. A congested link converges on the second or third socket; a
     * dead one is still closed, only later once it has already been closed for silence.
     *
     * WHILE WAITING, THE PING KEEPS GOING UP. The server reaps a socket that sent nothing for a whole
     * 30 s sweep (`heartbeatSweep`, `backend/src/modules/collab/collab.gateway.js`), and its own
     * protocol ping is stuck behind the same large frame, so the client's ping is the frame that
     * keeps the server from killing the download halfway.
     */
    _startHeartbeat() {
        this._clearHeartbeat();
        this._pongPending = false;
        this._missedTicks = 0;
        this._heartbeatTimer = setInterval(() => {
            if (this._pongPending && this._socket) {
                this._missedTicks += 1;
                if (this._missedTicks >= this._missedTicksAllowed) {
                    this._missedTicksAllowed = Math.min(this._missedTicksAllowed * 2, HEARTBEAT_MAX_MISSED_TICKS);
                    try { this._socket.close(4000, 'heartbeat timeout'); } catch { /* noop */ }
                    return;
                }
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
        // Backpressure: if the local outbound buffer is backed up, drop coalescable presence
        // frames (the next frame supersedes them) but never durable ops / control frames.
        if (COALESCABLE_TYPES.has(message?.type) && (this._socket.bufferedAmount || 0) > PRESENCE_BUFFER_LIMIT) {
            return false;
        }
        try {
            this._socket.send(JSON.stringify(message));
            return true;
        } catch {
            return false;
        }
    }

    /** @private Transitions connection state, ignoring no-op/invalid transitions. */
    _safeTransition(state) {
        let fromState = null;
        try {
            fromState = this._conn.getState();
        } catch {
            // State machine not ready — fromState stays null.
        }
        try {
            this._conn.transition(state);
            record(TraceStage.CONN_TRANSITION, { fromState, toState: state, outcome: TraceOutcome.OK });
            this._emit('stateChange', { state });
        } catch {
            // Same-state or invalid transition — ignore (machine stays consistent), but
            // surface the swallowed transition so an illegal one isn't invisible (inv I9).
            record(TraceStage.CONN_TRANSITION, { fromState, toState: state, outcome: TraceOutcome.FAILED });
        }
    }

    /**
     * @private Invokes a registered handler.
     *
     * O RELATO DE ERRO SAI DAQUI, e não dos quatro pontos que emitem `error`, por duas razões. A
     * primeira é alcance: os quatro (`socket`, `server`, `closed`, `connect`) são as quatro formas
     * de o transporte falhar, e um quinto que nascesse amanhã ficaria de fora de uma fiação feita
     * ponto a ponto. A segunda é que o teste da transição mora aqui, ao lado do contador.
     *
     * SÓ NA TRANSIÇÃO, NUNCA POR TENTATIVA DE RECONEXÃO. `_reconnectAttempts` é zero na PRIMEIRA
     * falha de uma sequência (`_scheduleReconnect` só o incrementa depois deste ponto) e volta a
     * zero quando o handshake completa, então `=== 0` é exatamente "esta é a notícia nova". Sem a
     * guarda, um servidor fora do ar por dez minutos produziria uma dezena de relatos idênticos
     * espaçados pelo backoff, gastando o teto de vinte envios da sessão com a MESMA queda: o
     * dedupe por assinatura pegaria a maioria, mas `closed` carrega o `code` e `connect` carrega
     * a mensagem do erro, que variam entre tentativas.
     *
     * A `causa` É O `kind`, que é vocabulário fechado do protocolo; nada do payload viaja, porque
     * `message` de um erro de servidor pode carregar texto sobre a entidade que a pessoa editava.
     */
    _emit(event, payload) {
        if (event === 'error' && this._reconnectAttempts === 0) {
            relatarErro(`WebSocket de colaboração: ${payload?.kind ?? 'desconhecido'}`, {
                origem: OrigemDeErro.WS,
                contexto: { causa: payload?.kind, conexao: this._conn?.getState?.() },
            });
        }
        const handler = this._handlers[event];
        if (handler) {
            try {
                const result = handler(payload);
                result?.catch?.(err => console.warn(`WsClient handler "${event}" error:`, err));
            } catch (err) {
                console.warn(`WsClient handler "${event}" error:`, err);
            }
        }
    }
}

/** Shared singleton WS client. */
// The singleton MUST carry the stable clientId (the same id the ops are stamped with): the WS
// handshake needs it for presence, and `_applyInboundOps` uses it to RECONHECER o proprio eco e
// carimba-lo com `localRepair`. Sem ele `_clientId` fica nulo, nenhum quadro e reconhecido como
// proprio e o autor reaplica as proprias ops como se fossem de outra pessoa, com aviso de
// atropelo e tudo. (Test instances still pass their own clientId, so this only wires the real app.)
//
// O ECO DEIXOU DE SER DESCARTADO em `f8e109ea`, e este comentario dizia "drops our own echoed ops"
// ate 2026-09-13: a marca substituiu o descarte porque o resultado que o servidor aceitou e o
// CANONICO, e otimismo local nao prova que ele foi aceito daquele jeito.
export const wsClient = new WsClient({ clientId: getClientId() });

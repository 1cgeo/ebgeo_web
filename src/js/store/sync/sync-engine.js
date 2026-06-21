// Path: js/store/sync/sync-engine.js

/**
 * @fileoverview High-level sync orchestrator for the EBGeo collaboration layer.
 *
 * `syncEngine` is the single public entry point the app uses to go online:
 * it wires together the HTTP client ({@link apiClient}), the WebSocket client
 * ({@link wsClient}), the local operation queue, the remote operation handler,
 * and the session context. Callers never touch those subsystems directly —
 * they call `configure/login/connect/flush/pull/disconnect` here.
 *
 * Responsibilities:
 * - Auth: login/register via the REST client and mirror identity into
 *   {@link sessionContext} (so permission guards work).
 * - Connect: do an initial pull (snapshot), wire idempotent WS handlers that
 *   feed inbound operations/snapshots into the remote handler, then open the WS.
 * - Flush: drain the local operation queue to the server over HTTP.
 * - Pull: catch up missed operations since the last applied version.
 *
 * The actual local-store mutation is delegated to `remote-operation-handler.js`
 * (`applyRemoteOperation` / `applyRemoteSnapshot`); this module only routes.
 *
 * @dependencies api-client.js, ws-client.js, operation-queue.js,
 *   operation-dispatcher.js, session-context.js, remote-operation-handler.js,
 *   sync-gateway.js, ../services.js
 */

import { apiClient, configureApiClient } from './api-client.js';
import { wsClient } from './ws-client.js';
import { operationQueue } from './operation-queue.js';
import { enableOperationLogging, disableOperationLogging } from './operation-dispatcher.js';
import { sessionContext } from './session-context.js';
import {
    applyRemoteOperation,
    applyRemoteSnapshot,
    setRemoteHandlerEventBus,
} from './remote-operation-handler.js';
import { syncGateway } from './sync-gateway.js';
import { setImageSyncAtlas } from './image-sync.js';
import { getEventBus } from '../services.js';

/** Max operations pushed per HTTP batch when flushing the queue. */
const FLUSH_BATCH_SIZE = 100;

/**
 * Orchestrates the online sync lifecycle: auth, initial pull, WebSocket wiring,
 * queue flush, and catch-up pull. A single shared instance ({@link syncEngine})
 * is used app-wide.
 */
class SyncEngine {
    constructor() {
        /** @type {string|null} The atlas currently connected (null when offline). */
        this._atlasId = null;
        /** @type {number} Highest server version applied locally. */
        this._lastVersion = 0;
        /** Whether WS inbound handlers have been wired (wire-once guard). */
        this._handlersWired = false;
    }

    /** @returns {string|null} The connected atlas id, or null. */
    get atlasId() {
        return this._atlasId;
    }

    /** @returns {number} The highest server version applied locally. */
    get lastVersion() {
        return this._lastVersion;
    }

    /**
     * Points the underlying HTTP client at a backend (base URL + fetch impl).
     * @param {{ baseUrl?: string, fetch?: typeof fetch }} opts
     * @returns {void}
     */
    configure(opts) {
        configureApiClient(opts);
    }

    /**
     * Logs in and mirrors the user identity into the session context so that
     * permission guards reflect the authenticated role.
     * @param {{ username: string, password: string }} credentials
     * @returns {Promise<Object>} The authenticated user.
     */
    async login({ username, password }) {
        const user = await apiClient.login(username, password);
        sessionContext.setSession({
            userId: user.id,
            role: user.org_role || 'viewer',
        });
        return user;
    }

    /**
     * Registers a new user (self-registration; gated server-side).
     * @param {{ username: string, password: string, nome: string }} payload
     * @returns {Promise<Object>} The created user.
     */
    async register({ username, password, nome }) {
        return apiClient.register({ username, password, nome });
    }

    /**
     * Goes online for an atlas: wires the remote handler + WS inbound routing,
     * (optionally) pulls the initial snapshot, then opens the WebSocket.
     * @param {string} atlasId
     * @param {Object} [opts]
     * @param {boolean} [opts.initialPull=true] - Pull a snapshot before connecting.
     * @returns {Promise<Object>} The WS `connected` payload.
     */
    async connect(atlasId, { initialPull = true } = {}) {
        this._wireOnce();

        if (initialPull) {
            const result = await apiClient.pullSync(atlasId, 0);
            if (result?.snapshot) {
                await applyRemoteSnapshot(result.snapshot);
            }
            this._lastVersion = result?.currentVersion ?? 0;
        }

        this._atlasId = atlasId;
        setImageSyncAtlas(atlasId);
        const payload = await wsClient.connect(atlasId, { lastVersion: this._lastVersion });

        // Reflect the PER-ATLAS role from the connect payload (owner/editor/viewer),
        // not just the global org_role login set — otherwise a self-registered owner
        // or a write-shared collaborator is wrongly gated as viewer and cannot edit
        // this atlas. The backend maps the atlas permission to the role here.
        if (payload?.role) {
            sessionContext.setSession({
                userId: payload.userId ?? sessionContext.userId,
                role: payload.role,
            });
        }

        return payload;
    }

    /**
     * Drains the local operation queue to the server over HTTP, dequeuing each
     * batch only after the server accepts it.
     * @returns {Promise<{ pushed: number }>}
     */
    async flush() {
        let pushed = 0;
        let ops = await operationQueue.peek(FLUSH_BATCH_SIZE);
        while (ops && ops.length > 0) {
            await apiClient.pushOperations(this._atlasId, ops);
            await operationQueue.dequeue(ops.map(op => op.id));
            pushed += ops.length;
            ops = await operationQueue.peek(FLUSH_BATCH_SIZE);
        }
        return { pushed };
    }

    /**
     * Pulls operations (or a snapshot) missed since the last applied version
     * and applies them locally, advancing `lastVersion`.
     * @returns {Promise<void>}
     */
    async pull() {
        const result = await apiClient.pullSync(this._atlasId, this._lastVersion);
        if (result?.snapshot) {
            await applyRemoteSnapshot(result.snapshot);
        } else if (result?.operations) {
            for (const op of result.operations) {
                await applyRemoteOperation(op);
            }
        }
        this._lastVersion = result?.currentVersion ?? this._lastVersion;
    }

    /**
     * Closes the WebSocket (no reconnect). Local state is retained.
     * @returns {void}
     */
    disconnect() {
        wsClient.disconnect();
    }

    /**
     * Full teardown: disconnect, revoke tokens server-side, clear the session,
     * and stop logging local operations.
     * @returns {Promise<void>}
     */
    async logoutAndDisconnect() {
        this.disconnect();
        setImageSyncAtlas(null);
        await apiClient.logout();
        sessionContext.clearSession();
        disableOperationLogging();
    }

    /**
     * Wires the remote handler event bus, the sync gateway, the WS inbound
     * handlers, and enables operation logging. Idempotent (wire-once).
     * @private
     */
    _wireOnce() {
        if (this._handlersWired) return;

        // Feed remote-handler events into the app event bus when the service
        // container is up. In headless / flush-only usage (no `initServices()`),
        // `getEventBus()` throws — the engine can still queue/flush/sync without a
        // UI bus, and the remote handler guards a null bus, so we degrade quietly.
        try {
            setRemoteHandlerEventBus(getEventBus());
        } catch {
            // Services not initialized — proceed without UI event emission.
        }
        syncGateway.setRemoteOperationHandler(applyRemoteOperation);

        // Return the promise so the ws-client can SERIALIZE applies (the handler does an
        // async read-modify-write of the map; a block body that didn't return the promise
        // let a batch of ops apply concurrently and clobber each other — all but one lost).
        wsClient.on('operation', (op) => syncGateway.applyRemoteOperation(op));

        wsClient.on('syncResponse', async (msg) => {
            if (msg?.isSnapshot) {
                await applyRemoteSnapshot(msg.snapshot);
            } else {
                for (const op of (msg?.ops || [])) {
                    await applyRemoteOperation(op);
                }
            }
            const version = msg?.currentVersion;
            if (Number.isFinite(version)) {
                this._lastVersion = version;
                wsClient.setLastVersion(version);
            }
        });

        enableOperationLogging();
        this._handlersWired = true;
    }
}

/** Shared singleton sync orchestrator. */
export const syncEngine = new SyncEngine();

export { SyncEngine };

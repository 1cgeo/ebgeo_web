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
import { connectionState } from './connection-state.js';
import { setImageSyncAtlas } from './image-sync.js';
import { applyAtlasSettings, revertAtlasSettings } from './atlas-settings.service.js';
import { getEventBus } from '../services.js';
import { EventTypes } from '../../events/event_types.js';

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
            username: user.username || user.nome || username,
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

        let snapshot = null;
        if (initialPull) {
            const result = await apiClient.pullSync(atlasId, 0);
            snapshot = result?.snapshot ?? null;
            if (snapshot) {
                await applyRemoteSnapshot(snapshot);
            }
            this._lastVersion = result?.currentVersion ?? 0;
        }

        this._atlasId = atlasId;
        setImageSyncAtlas(atlasId);
        // Authenticated connect → log local mutations for outbound sync. Re-enabled explicitly here
        // because a prior public-visitor connect (connectPublic) disables logging.
        enableOperationLogging();
        const payload = await wsClient.connect(atlasId, { lastVersion: this._lastVersion });

        // Reflect the PER-ATLAS role from the connect payload (owner/editor/viewer), not just the
        // global org_role login set, so a self-registered owner or a write-shared collaborator can
        // edit. PRESERVE the restored username — setSession would otherwise null it, blanking the
        // account avatar on an F5-reconnect (where this is the only session set after restore).
        if (payload?.role) {
            sessionContext.setSession({
                userId: payload.userId ?? sessionContext.userId,
                role: payload.role,
                username: sessionContext.username,
            });
        }

        // Apply the per-atlas config overlay from the snapshot's settings (no extra round-trip).
        await this._applyAtlasSettingsOverlay(atlasId, snapshot?.atlas?.settings);
        return payload;
    }

    /**
     * Goes online for a PUBLIC atlas as an anonymous, read-only visitor (the public viewer-link
     * flow). Same wiring as {@link connect}, but the session becomes a "visitante" (VIEWER) rather
     * than an authenticated identity. The caller must have set the ephemeral public token on the
     * api client and marked the store remote first.
     * @param {string} atlasId
     * @returns {Promise<Object>} The WS `connected` payload.
     */
    async connectPublic(atlasId) {
        this._wireOnce();

        const result = await apiClient.pullSync(atlasId, 0);
        const snapshot = result?.snapshot ?? null;
        if (snapshot) {
            await applyRemoteSnapshot(snapshot);
        }
        this._lastVersion = result?.currentVersion ?? 0;

        this._atlasId = atlasId;
        setImageSyncAtlas(atlasId);
        // Anonymous read-only visitor: NEVER log ops — there is no token to push them and they would
        // orphan the op queue for a later real login (which would then flush them to the wrong atlas).
        disableOperationLogging();
        const payload = await wsClient.connect(atlasId, { lastVersion: this._lastVersion });

        // Anonymous read-only visitor: the permission guard blocks editing the remote store, and
        // isAuthenticated() stays false (no account menu).
        sessionContext.setVisitorSession();

        // The per-atlas config overlay still applies — a visitor respects 3D/360/basemap availability.
        await this._applyAtlasSettingsOverlay(atlasId, snapshot?.atlas?.settings);
        return payload;
    }

    /**
     * @private Applies the connected atlas's per-atlas config overlay (3D/360/basemap availability)
     * as a restrictive intersection over the deploy config, then lets the UI re-gate. Prefers the
     * settings already carried in the pulled snapshot (no extra round-trip); falls back to a REST
     * fetch only when they aren't present. Best-effort: a failure leaves the deploy config intact.
     * @param {string} atlasId
     * @param {Object} [snapshotSettings] - atlas.settings from the pulled snapshot, if any.
     */
    async _applyAtlasSettingsOverlay(atlasId, snapshotSettings) {
        try {
            const settings = snapshotSettings ?? await apiClient.getAtlasSettings(atlasId);
            applyAtlasSettings(settings);
            getEventBus().emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings });
        } catch {
            // No settings reachable / no UI bus — non-fatal.
        }
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
        // The per-atlas config overlay no longer applies — restore the deploy-level config and
        // re-gate the UI back to its defaults.
        revertAtlasSettings();
        try {
            getEventBus().emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings: null });
        } catch {
            // No UI bus (headless).
        }
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
        // Forget the atlas so a subsequent boot/connect starts clean and nothing thinks
        // a server atlas is still open.
        this._atlasId = null;
        this._lastVersion = 0;
    }

    /**
     * Wires the remote handler event bus, the sync gateway, and the WS inbound handlers.
     * Idempotent (wire-once). Operation logging is toggled per connect path (connect enables it,
     * connectPublic disables it for the read-only visitor), NOT here.
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
            // Drop a late sync_response that arrives after a disconnect (e.g. during the
            // disconnect→clear window of a logout/atlas-switch) so it can't persist remote
            // data into a store being torn down (inv 2/3). The inbound op path is already
            // gated by syncGateway.isOnline(); the snapshot path was not.
            if (!connectionState.isOnline()) return;
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

        // The connected atlas was deleted server-side (`atlas_deleted` broadcast). Stop the
        // auto-reconnect from chasing the dead room, then notify the UI to tear down + redirect.
        wsClient.on('atlasDeleted', (msg) => {
            this.disconnect();
            try {
                getEventBus().emit(EventTypes.ATLAS_DELETED_REMOTE, { atlasId: msg?.atlasId });
            } catch {
                // No UI bus (headless) — disconnect already handled the transport teardown.
            }
        });

        // Ownership changed server-side (`atlas_owner_changed`). Re-resolve THIS client's role
        // locally from the broadcast (it carries the new owner id) so the UI re-gates immediately;
        // the WS heartbeat reconcile is the server-side fallback that adjusts ws.permission.
        wsClient.on('atlasOwnerChanged', (msg) => {
            const myId = sessionContext.userId;
            if (myId) {
                if (msg?.newOwnerId === myId) {
                    sessionContext.updateRole('owner');
                } else if (sessionContext.role === 'owner') {
                    sessionContext.updateRole('manager'); // demoted ex-owner → co-Gestor
                }
            }
            try {
                getEventBus().emit(EventTypes.ATLAS_OWNER_CHANGED, {
                    atlasId: msg?.atlasId,
                    newOwnerId: msg?.newOwnerId,
                });
            } catch {
                // No UI bus (headless).
            }
        });

        // Atlas settings changed server-side (`atlas_settings_updated`) — re-apply the per-atlas
        // config overlay (3D/360/basemap availability), then notify the UI to re-gate.
        wsClient.on('atlasSettings', (msg) => {
            applyAtlasSettings(msg?.settings);
            try {
                getEventBus().emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings: msg?.settings });
            } catch {
                // No UI bus (headless).
            }
        });

        this._handlersWired = true;
    }
}

/** Shared singleton sync orchestrator. */
export const syncEngine = new SyncEngine();

export { SyncEngine };

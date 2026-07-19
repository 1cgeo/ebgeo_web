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
    recordLocalAppliedVersion,
    reconcilePendingLocalEdits,
    CONVERGENCE_GUARDED,
} from './remote-operation-handler.js';
import { syncGateway } from './sync-gateway.js';
import { connectionState } from './connection-state.js';
import { setImageSyncAtlas } from './image-sync.js';
import { applyAtlasSettings, revertAtlasSettings } from './atlas-settings.service.js';
import { getEventBus } from '../services.js';
import { EventTypes } from '../../events/event_types.js';
import { record } from './diag/trace-core.js';
import { TraceStage, TraceOutcome } from './diag/trace-stages.js';
import { showWarning } from '../../utilities/toast_service.js';

/** Max operations pushed per HTTP batch when flushing the queue. */
const FLUSH_BATCH_SIZE = 100;

/**
 * Entity types of MARKER operations: a structural change made over REST that moved
 * rows in bulk, so no per-entity operation describes it.
 *
 * Live peers already learn about these from the `maps_merged` broadcast, which
 * triggers a resync. A peer that was OFFLINE during the change missed that
 * broadcast, and before the marker existed its reconnect replay was empty by
 * construction: no op had been written, so `atlas.current_version` had not moved and
 * the incremental pull answered "nothing new". It kept showing features under the
 * old map until a manual reload.
 *
 * Shared contract with the backend (MAP_MERGE_ENTITY_TYPE in maps.service.js).
 */
const STRUCTURAL_RESYNC_OPS = new Set(['map_merge']);

/**
 * Records a `push.ack` span per op from the server's push response — binding each
 * op.id to its server-assigned version and surfacing idempotent re-applies. The
 * flush path historically discarded this response entirely.
 * @param {Object} resp - The pushOperations response ({ results?, acks?, serverVersion? }).
 * @param {Object[]} ops - The ops that were pushed (in order).
 */
function recordPushAcks(resp, ops) {
    if (!resp) return;
    const results = resp.results || resp.acks || [];
    const rejections = [];
    ops.forEach((op, i) => {
        const r = results.find((x) => x && (x.operationId === op.id || x.opId === op.id)) || results[i] || {};
        const sv = r.currentVersion ?? r.serverVersion ?? resp.serverVersion;

        // A policy denial (map delete without the `manage` tier, lock/unlock without
        // owner) is acked per-operation with 200 + rejected, so the batch is NOT
        // retried — retrying a denial can never succeed, and retrying it forever is
        // what used to freeze the whole outbound queue.
        //
        // But being dequeued silently is its own defect: the entity is already gone
        // from the local store, the server kept it, and the next snapshot brings it
        // back with no explanation. The user sees their action undo itself minutes
        // later. The server sends a `reason` precisely so the client can say what
        // happened; it was being discarded here.
        if (r.rejected === true || r.success === false) {
            rejections.push(r.reason || 'O servidor recusou uma alteração.');
        }
        record(TraceStage.PUSH_ACK, {
            opId: op.id,
            traceId: op.traceId,
            serverVersion: sv,
            outcome: r.idempotent ? TraceOutcome.IDEMPOTENT : (r.success === false ? TraceOutcome.FAILED : TraceOutcome.OK),
        });
        // Seed the author's own applied serverVersion (LWW convergence): the author filters its
        // own WS echo, so without this it would never learn its op's server arrival order, and a
        // peer's concurrent OLDER op could overwrite the author's (correct) value. Applies to all
        // guarded entity types (feature/layer/group/3D/360).
        if (sv != null && op.entityId && CONVERGENCE_GUARDED.has(op.entityType)) {
            recordLocalAppliedVersion(op.entityId, sv);
        }
    });

    // One toast per distinct reason, not per operation: a batch can carry several
    // denials with the same cause and stacking N identical toasts is noise.
    for (const reason of new Set(rejections)) {
        try {
            showWarning(reason);
        } catch {
            // Headless (tests, worker): no UI to tell.
        }
    }
}

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
            globalRole: user.role || 'user',
            username: user.username || user.nome || username,
        });
        return user;
    }

    /**
     * Registers a new user (self-registration; gated server-side). Forwards the full payload so the
     * optional military attributes (and, once enabled, the e-mail) reach the backend untouched.
     * @param {{ username: string, password: string, nome: string, posto_graduacao?: string,
     *   organizacao_militar?: string, email?: string }} payload
     * @returns {Promise<Object>} The created user.
     */
    async register(payload) {
        return apiClient.register(payload);
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

        // Elevate the role for the atlas OWNER the instant the snapshot lands — BEFORE the WS
        // handshake — so the owner's account config buttons (Configurar/Compartilhar/Excluir)
        // appear immediately on an F5 reconnect instead of waiting on, or being lost to, the
        // socket handshake (which is the only thing that applied the role before, via `payload`
        // below). The `connected` payload still re-confirms the role and resolves the non-owner
        // roles (manager/editor/commenter/viewer).
        const ownerId = snapshot?.atlas?.sync?.ownerId;
        if (ownerId && sessionContext.userId && ownerId === sessionContext.userId) {
            sessionContext.setSession({
                userId: sessionContext.userId,
                role: 'owner',
                username: sessionContext.username,
            });
        }

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
            const opIds = ops.map(op => op.id);
            record(TraceStage.FLUSH_PUSH, {
                atlasId: this._atlasId, opIds, batchSize: ops.length, outcome: TraceOutcome.OK,
            });
            let resp;
            try {
                resp = await apiClient.pushOperations(this._atlasId, ops);
            } catch (error) {
                // A rejected batch is NOT dequeued — the queue re-peeks the same ops next
                // flush. Surface the poison batch (which op ids stalled) instead of the
                // historic silent stall.
                record(TraceStage.FLUSH_PUSH, {
                    atlasId: this._atlasId, opIds, outcome: TraceOutcome.FAILED,
                    error: error?.message || String(error),
                });
                await this._reconcileConvergenceGuard();
                throw error;
            }
            recordPushAcks(resp, ops);
            await operationQueue.dequeue(opIds);
            pushed += ops.length;
            ops = await operationQueue.peek(FLUSH_BATCH_SIZE);
        }
        await this._reconcileConvergenceGuard();
        return { pushed };
    }

    /**
     * @private Self-heals the pending-local-edit convergence guard against the operation queue
     * after a flush (clears leaked deferrals; see reconcilePendingLocalEdits). Never throws.
     * @returns {Promise<void>}
     */
    async _reconcileConvergenceGuard() {
        try {
            const remaining = await operationQueue.getAll();
            const remainingIds = new Set(remaining.map((o) => o.entityId).filter(Boolean));
            await reconcilePendingLocalEdits(remainingIds);
        } catch (err) {
            console.warn('reconcilePendingLocalEdits failed:', err);
        }
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
            // Same structural-marker guard as the syncResponse handler. Without it a
            // `map_merge` marker would fall through to applyRemoteOperation's
            // `default:` branch — a console.warn and a silent no-op — leaving this peer
            // stale with no sign anything was missed. Harmless today only because
            // pull() has no caller left in src/; a guard that exists in one of two
            // twin paths is the kind of asymmetry that becomes a bug the day the dead
            // path is revived.
            if (result.operations.some((op) => STRUCTURAL_RESYNC_OPS.has(op?.entityType))) {
                await this.resync();
                return;
            }
            for (const op of result.operations) {
                await applyRemoteOperation(op);
            }
        }
        this._lastVersion = result?.currentVersion ?? this._lastVersion;
    }

    /**
     * Re-pulls a FRESH FULL snapshot and applies it. Used when a peer performs a server-side
     * operation OUTSIDE the CRDT op log (duplicate/merge a map, rename the atlas, import) — the new
     * state never arrives as ops, so an incremental pull would miss it; only a snapshot picks it
     * up. Best-effort and guarded against overlapping runs.
     * @returns {Promise<void>}
     */
    async resync() {
        if (this._resyncing || !this._atlasId) return;
        this._resyncing = true;
        try {
            const result = await apiClient.pullSync(this._atlasId, 0);
            if (result?.snapshot) {
                await applyRemoteSnapshot(result.snapshot);
                this._lastVersion = result.currentVersion ?? this._lastVersion;
                wsClient.setLastVersion(this._lastVersion);
            }
        } catch (error) {
            console.warn('[sync] resync failed:', error);
        } finally {
            this._resyncing = false;
        }
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
                const ops = msg?.ops || [];
                // A structural REST change (map merge) moves rows in bulk, so no
                // per-entity op describes it. The backend logs a MARKER op instead
                // (see MAP_MERGE_ENTITY_TYPE in backend maps.service.js), which this
                // peer resolves the same way the live `maps_merged` broadcast is
                // resolved: by taking a snapshot. Applying the rest of the tail
                // first would be wasted work, since the snapshot supersedes it.
                if (ops.some((op) => STRUCTURAL_RESYNC_OPS.has(op?.entityType))) {
                    await this.resync();
                    return; // resync() re-reads the version from the snapshot
                }
                for (const op of ops) {
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

        // A share for THIS client changed live (`sharing_updated`): re-gate the local role from the
        // broadcast (which carries the affected user's new frontend `role`) so the safe view engages on
        // a write→read downgrade and the toolbars return on an upgrade — without a reconnect. Only the
        // affected user reacts; a global admin keeps full access regardless of per-atlas shares. The
        // updateRole() fires SESSION_CHANGED, which the view-mode driver and maps tab already consume.
        wsClient.on('sharingUpdated', (msg) => {
            const myId = sessionContext.userId;
            if (!myId || String(msg?.userId) !== String(myId)) return;
            if (sessionContext.isAdmin()) return;
            if ((msg.action === 'user_updated' || msg.action === 'user_added') && msg.role) {
                sessionContext.updateRole(msg.role);
            }
        });

        // Atlas settings changed server-side (`atlas_settings_updated`) — re-apply the per-atlas
        // config overlay (3D/360/basemap availability), then notify the UI to re-gate.
        wsClient.on('atlasSettings', (msg) => {
            // Drop a late atlas_settings_updated frame arriving after a disconnect (the
            // disconnect→revert window): re-applying with no connected atlas would re-capture the
            // just-restored config as a new baseline and wrongly re-restrict it (mirrors the
            // sync_response gate above).
            if (!connectionState.isOnline()) return;
            applyAtlasSettings(msg?.settings);
            try {
                getEventBus().emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings: msg?.settings });
            } catch {
                // No UI bus (headless).
            }
        });

        // A peer created/altered server-side data OUTSIDE the CRDT op log (duplicate/merge a map,
        // rename the atlas). The entities never arrive as ops, so re-pull a fresh snapshot to pick
        // them up, then refresh the UI. (These events were silently dropped before.)
        wsClient.on('serverResync', async () => {
            await this.resync();
            try {
                getEventBus().emit(EventTypes.LAYERS_CHANGED, { mapName: null });
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

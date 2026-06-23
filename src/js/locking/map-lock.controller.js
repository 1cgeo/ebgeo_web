// Path: js/locking/map-lock.controller.js

/**
 * @fileoverview Map-lock UX controller (Slice 3 of the multiuser UX).
 *
 * Owns the lock *state + actions* surface the UI binds to. The backend is the
 * real guarantee: a map update `{ locked }` requires OWNER (403 for write
 * users), and a locked map rejects child mutations (409). This controller is
 * the best-effort frontend layer — a toggle, a permission gate, local
 * persistence, sync logging, and reacting to remote lock changes.
 *
 * Reuse over duplication: lock state lives on the map record in the store
 * (`memoryStore.lockedMaps`, persisted under `mapLocked_<map>`); the store's
 * `toggleMapLock`/`isCurrentMapLockedSync` own that. This controller wraps them
 * with the role gate and the sync op, then mirrors remote lock changes
 * (delivered as MAP_MODIFIED) back onto MAP_LOCK_CHANGED so the existing UI —
 * which already listens on MAP_LOCK_CHANGED — re-reads.
 *
 * @dependencies @store (toggleMapLock / isCurrentMapLockedSync / getCurrentMapIdSync),
 *   @store/services (getEventBus), @store/sync/session-context (role/offline),
 *   @store/sync/operation-dispatcher (logMapOperation), @utils (showError),
 *   @events/event_types, @utils/event-cleanup
 */

import {
    toggleMapLock as storeToggleMapLock,
    isCurrentMapLockedSync,
    getCurrentMapIdSync,
} from '@store';
import { getEventBus } from '@store/services.js';
import { sessionContext, UserRole } from '@store/sync/session-context.js';
import { isRemoteStoreSync } from '@store/store-origin.js';
import { logMapOperation } from '@store/sync/operation-dispatcher.js';
import { showError } from '@utils/index.js';
import { EventTypes } from '@events/event_types.js';
import { setupCleanup, subscribe, cleanup } from '@utils/event-cleanup.js';

/** Roles allowed to lock/unlock a map when online (owner is also backend-enforced). */
const LOCK_CAPABLE_ROLES = Object.freeze([UserRole.OWNER, UserRole.ADMIN]);

/** Message shown when a non-privileged online user attempts to toggle the lock. */
const NO_PERMISSION_MESSAGE = 'Apenas o dono pode bloquear o mapa';

/**
 * Lock state + actions for the active map. Singleton; `start()`/`stop()` are
 * idempotent so the bootstrap can wire it without guarding double-calls.
 */
export class MapLockController {
    constructor() {
        /** @type {boolean} Whether start() has wired the subscriptions. */
        this._started = false;

        setupCleanup(this);
    }

    /**
     * Whether the given map (default: active map) is locked.
     * Reads the store's synchronous lock flag for the active map.
     * @returns {boolean} True if locked.
     */
    isMapLocked() {
        return isCurrentMapLockedSync();
    }

    /**
     * Whether the current session may toggle a map's lock.
     * Offline = full local control; online = only OWNER/ADMIN (the backend also
     * enforces OWNER, so a write user is blocked there regardless).
     * @returns {boolean}
     */
    canToggleLock() {
        if (sessionContext.isOffline()) {
            return true;
        }
        return LOCK_CAPABLE_ROLES.includes(sessionContext.role);
    }

    /**
     * Whether the active remote session is READ-ONLY: a connected remote atlas where the user is a
     * viewer/commenter, OR an anonymous public-link visitor (a VIEWER). In that case the map must
     * present as locked and the padlock must NOT be toggleable. The local store is never read-only
     * (offline/local = full control), so this returns false there.
     * @returns {boolean}
     */
    isReadOnly() {
        if (!isRemoteStoreSync()) return false;
        const role = sessionContext.role;
        return role === UserRole.VIEWER || role === UserRole.COMMENTER;
    }

    /**
     * Toggles the lock on the given map (default: active map).
     * Gated by {@link canToggleLock}: a blocked user gets an error toast and the
     * current state is returned unchanged. On success the new state is persisted
     * locally (store op), logged for sync (`map` update `{ locked }`), and a
     * MAP_MODIFIED signal is emitted so the local UI re-reads.
     * @param {string} [mapId] - Map id (default: active map id).
     * @returns {Promise<boolean>} The resulting lock state.
     */
    async toggleMapLock(mapId) {
        const current = this.isMapLocked(mapId);

        if (!this.canToggleLock()) {
            showError(NO_PERMISSION_MESSAGE);
            return current;
        }

        const targetId = mapId || getCurrentMapIdSync();
        const next = !current;

        // Persist + flip the in-memory lock set via the store op (it also emits
        // MAP_LOCK_CHANGED). Falls back to the computed value if the store op
        // returns null (e.g. its own permission guard short-circuits).
        const result = await storeToggleMapLock();
        const resolved = typeof result === 'boolean' ? result : next;

        // Log the lock change for sync so it travels to the backend as a `map`
        // update; the auto-flush wired in Slice 1 sends it while connected.
        logMapOperation('update', targetId, { locked: resolved });

        getEventBus().emit(EventTypes.MAP_MODIFIED, { mapId: targetId });

        return resolved;
    }

    /**
     * Subscribes to MAP_MODIFIED so remote lock changes re-emit MAP_LOCK_CHANGED,
     * letting the existing lock UI re-read the active map's state. Idempotent.
     */
    start() {
        if (this._started) {
            return;
        }
        this._started = true;

        subscribe(this, getEventBus(), EventTypes.MAP_MODIFIED, (payload) => {
            this._onMapModified(payload);
        });
    }

    /**
     * Removes subscriptions. Safe to call when already stopped.
     */
    stop() {
        if (!this._started) {
            return;
        }
        cleanup(this);
        this._started = false;
    }

    /**
     * Re-emits the active map's lock state on MAP_LOCK_CHANGED so UI components
     * bound to that event react to a (possibly remote) modification.
     * @param {{ mapId?: string }} [payload] - MAP_MODIFIED payload.
     * @private
     */
    _onMapModified(payload) {
        const mapId = (payload && payload.mapId) || getCurrentMapIdSync();
        getEventBus().emit(EventTypes.MAP_LOCK_CHANGED, {
            mapName: mapId,
            locked: this.isMapLocked(mapId),
        });
    }
}

/** @type {MapLockController} Shared singleton. */
export const mapLockController = new MapLockController();

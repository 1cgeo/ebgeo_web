// Path: js/locking/map-lock.controller.js

/**
 * @fileoverview Map-lock UX controller (Slice 3 of the multiuser UX).
 *
 * Owns the lock *state + actions* surface the UI binds to. The backend is the
 * real guarantee: a map update `{ locked }` requires manage or above (refused for write
 * users), and a locked map rejects child mutations per operation. This controller is
 * the best-effort frontend layer — a toggle, a permission gate, and reacting to
 * remote lock changes. Local persistence AND the outbound op belong to the store
 * op it calls.
 *
 * Reuse over duplication: lock state lives on the map record in the store
 * (`memoryStore.lockedMaps`, persisted under `mapLocked_<map>`); the store's
 * `toggleMapLock`/`isCurrentMapLockedSync` own that, AND SINCE 2026-09-13 the store op also owns
 * the outbound `map` update `{ locked }`, journaled before its own write. This controller wraps it
 * with the role gate, then mirrors remote lock changes (delivered as MAP_MODIFIED) back onto
 * MAP_LOCK_CHANGED so the existing UI — which already listens on MAP_LOCK_CHANGED — re-reads.
 *
 * @dependencies @store (toggleMapLock / isCurrentMapLockedSync / getCurrentMapIdSync),
 *   @store/services (getEventBus), @store/sync/session-context (role/offline),
 *   @utils (showError), @events/event_types, @utils/event-cleanup
 */

import {
    toggleMapLock as storeToggleMapLock,
    isCurrentMapLockedSync,
    getCurrentMapIdSync,
} from '@store';
import { getEventBus } from '@store/services.js';
import { sessionContext } from '@store/sync/session-context.js';
// A ÚNICA implementação da escada por atlas. Os dois predicados deste arquivo eram listas
// fechadas de `UserRole` (uma do TOPO, outra do FUNDO), e o `UserRole` do cliente não é
// comparável à escada de cinco valores do servidor sem a tradução que estes dois fazem.
import { atlasRoleHasAtLeast } from '@js/projects/permission-levels.js';
import { isRemoteStoreSync } from '@store/store-origin.js';
import { showError } from '@utils/index.js';
import { EventTypes } from '@events/event_types.js';
import { setupCleanup, subscribe, cleanup } from '@utils/event-cleanup.js';

/** Message shown when a non-privileged online user attempts to toggle the lock. */
const NO_PERMISSION_MESSAGE = 'Apenas o dono ou um gestor pode bloquear ou desbloquear o mapa';

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
     * Whether the ACTIVE map is locked.
     * Reads the store's synchronous lock flag. There is deliberately no map
     * argument: the store flag is active-map only, and an accepted-but-ignored
     * parameter is an API that lies.
     * @returns {boolean} True if locked.
     */
    isMapLocked() {
        return isCurrentMapLockedSync();
    }

    /**
     * Whether the current session may toggle a map's lock.
     *
     * The gate is the STORE, not the session: the local store is always fully
     * editable (principle P1), so being logged in does not hand the padlock of a
     * local map over to the atlas role. Only a connected remote atlas is gated,
     * and there the manage tier and above may lock or unlock.
     *
     * @returns {boolean}
     */
    canToggleLock() {
        if (!isRemoteStoreSync()) {
            return true;
        }
        return atlasRoleHasAtLeast(sessionContext.role, 'manage');
    }

    /**
     * Whether the active remote session is READ-ONLY: a connected remote atlas where the user does
     * not reach the `write` rung, which today means Visualizador and Comentarista, the anonymous
     * public-link visitor included (the server hands them `read`). In that case the map must
     * present as locked and the padlock must NOT be toggleable. The local store is never read-only
     * (offline/local = full control), so this returns false there.
     *
     * BY HIERARCHY, and stated as the ABSENCE of `write`. The closed list of the BOTTOM that stood
     * here (`viewer || commenter`) is the same defect as a closed list of the top, only turned
     * around, and it failed OPEN: a role this build does not recognize was not viewer and not
     * commenter, so the padlock unlocked itself for it. `atlasRoleHasAtLeast` ranks an unknown
     * role below `read`, so the same input now reads as read-only.
     * @returns {boolean}
     */
    isReadOnly() {
        if (!isRemoteStoreSync()) return false;
        return !atlasRoleHasAtLeast(sessionContext.role, 'write');
    }

    /**
     * Toggles the lock on the ACTIVE map.
     * Gated by {@link canToggleLock}: a blocked user gets an error toast and the
     * current state is returned unchanged. On success the store op persists the new
     * state, journals the `map` update `{ locked }` and emits MAP_LOCK_CHANGED; this
     * method adds the MAP_MODIFIED signal so the local UI re-reads.
     *
     * IT NO LONGER LOGS THE OP ITSELF, since 2026-09-13. It used to call
     * `logMapOperation` right after the store op, which made the op be born OUTSIDE
     * any transaction and AFTER the local write, and left the store op itself
     * unsynced for every other caller (a test that toggled the raw op locked only
     * its own client, which is why two specs of this repository failed forever). The
     * intention now belongs to the store op, before its own write, and this method
     * only calls it.
     * @returns {Promise<boolean>} The resulting lock state.
     */
    async toggleMapLock() {
        const current = this.isMapLocked();

        if (!this.canToggleLock()) {
            showError(NO_PERMISSION_MESSAGE);
            return current;
        }

        // Journal + persist + flip the in-memory lock set via the store op (it also
        // emits MAP_LOCK_CHANGED). Keeps the prior state if the store op
        // returns null (e.g. permission changed while awaiting the store).
        const result = await storeToggleMapLock();
        const resolved = typeof result === 'boolean' ? result : current;

        getEventBus().emit(EventTypes.MAP_MODIFIED, { mapId: getCurrentMapIdSync() });

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
            locked: this.isMapLocked(),
        });
    }
}

/** @type {MapLockController} Shared singleton. */
export const mapLockController = new MapLockController();

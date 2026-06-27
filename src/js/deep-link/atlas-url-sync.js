// Path: js/deep-link/atlas-url-sync.js

/**
 * @module deep-link/atlas-url-sync
 * @description Keeps the address-bar `?atlas=&map=` in sync with the live connection REACTIVELY, so
 * every way of opening an atlas (project picker, URL deep link, post-login resume, F5 reconnect)
 * updates the URL uniformly — no open path has to remember to write it.
 *
 * Rules:
 *   - Authenticated + connected to a remote atlas → write `?atlas=<id>&map=<currentMapId>`.
 *   - Logged out → strip the params.
 *   - Authenticated but not (yet) connected → leave the URL untouched, so a pending `?atlas=` deep
 *     link survives the boot window until the router consumes it (and a transient network drop keeps
 *     the intended atlas in the URL for reconnect).
 *
 * A PUBLIC (anonymous) atlas is excluded — it is not authenticated, so it keeps `?atlasPublico=`.
 */

import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { sessionContext } from '@store/sync/session-context.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { getCurrentMapIdSync } from '@store';
import { isValidUUID } from '@utils/uuid.js';
import { writeAtlasUrl, clearAtlasUrl } from './atlas-link.js';

let _wired = false;

/** Reconciles the URL with the current session/connection/map state. */
function syncAtlasUrl() {
    if (sessionContext.isAuthenticated() && syncEngine.atlasId) {
        // Only stamp `?map=` once it is a real UUID; until the resolver populates it is a name, and
        // writeAtlasUrl preserves an existing good `?map=<uuid>` when we pass null here.
        const rawMapId = getCurrentMapIdSync();
        writeAtlasUrl(syncEngine.atlasId, isValidUUID(rawMapId) ? rawMapId : null);
    } else if (!sessionContext.isAuthenticated()) {
        clearAtlasUrl();
    }
}

/**
 * Wires the URL reconciliation to connection/map/session events. Idempotent; call once at boot
 * (after services init). The listeners live for the app lifetime (singletons), so no teardown.
 */
export function initAtlasUrlSync() {
    if (_wired) return;
    _wired = true;
    const bus = getEventBus();
    // Atlas connected/disconnected (atlasId appears/clears).
    bus.on(EventTypes.CONNECTION_STATE_CHANGED, syncAtlasUrl);
    // Map switched within the atlas → refresh `?map=` (setCurrentMap emits MAP_LOCK_CHANGED).
    bus.on(EventTypes.MAP_LOCK_CHANGED, syncAtlasUrl);
    // Login/logout → write or strip the atlas params.
    bus.on(EventTypes.SESSION_CHANGED, syncAtlasUrl);
}

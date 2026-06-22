// Path: js/store/store-origin.js

/**
 * @fileoverview Tracks whether the local IndexedDB currently holds a LOCAL atlas
 * (data the user owns and persists on THIS machine — including the logged-out
 * "general" atlas) or a REMOTE atlas (a server atlas being edited collaboratively,
 * which only lives here TEMPORARILY while connected and must be discarded on
 * disconnect/logout).
 *
 * This is the explicit, additive separation between "what persists on the machine"
 * and "what only persists because of an active connection". It exists so a logged-out
 * user can never keep editing a remote server atlas: on boot, if the store holds remote
 * data but nobody is authenticated, the remote data is discarded back to a blank local
 * atlas (see store.js). To keep working on a remote atlas offline the user must download
 * its `.ebgeo` (which becomes a local atlas).
 *
 * ADDITIVE GUARANTEE: the origin defaults to LOCAL and is absent for every pre-existing
 * offline user, so the offline/standalone workflow (IndexedDB + `.ebgeo`) is completely
 * untouched — the remote machinery only ever engages after an explicit server connect.
 */

import { getSettingCompat, setSettingCompat } from './repositories/index.js';

/** Origin kinds. */
export const StoreOriginKind = Object.freeze({ LOCAL: 'local', REMOTE: 'remote' });

/** appStore key holding the persisted origin marker. */
const ORIGIN_KEY = '__store_origin__';

/** Default origin: a fresh/offline store is always LOCAL. */
const DEFAULT_ORIGIN = Object.freeze({ kind: StoreOriginKind.LOCAL, atlasId: null });

/**
 * In-memory mirror of the persisted origin, for synchronous reads on hot/boot paths.
 * @type {{ kind: string, atlasId: string|null }}
 */
let _origin = { ...DEFAULT_ORIGIN };

/**
 * Loads the persisted origin marker into the in-memory mirror. Call once on boot before
 * any synchronous origin read. Defaults to LOCAL when absent or on any read error.
 * @returns {Promise<{ kind: string, atlasId: string|null }>}
 */
export async function loadStoreOrigin() {
    try {
        const stored = await getSettingCompat(ORIGIN_KEY);
        _origin = stored && stored.kind
            ? { kind: stored.kind, atlasId: stored.atlasId ?? null }
            : { ...DEFAULT_ORIGIN };
    } catch {
        _origin = { ...DEFAULT_ORIGIN };
    }
    return _origin;
}

/**
 * @returns {{ kind: string, atlasId: string|null }} The current in-memory origin.
 */
export function getStoreOriginSync() {
    return _origin;
}

/**
 * @returns {boolean} True when the local store currently holds a REMOTE (server) atlas.
 */
export function isRemoteStoreSync() {
    return _origin.kind === StoreOriginKind.REMOTE;
}

/**
 * Persists the origin marker and updates the in-memory mirror.
 * @param {string} kind - One of StoreOriginKind.
 * @param {string|null} [atlasId=null] - The connected atlas id (REMOTE only).
 * @returns {Promise<void>}
 */
export async function setStoreOrigin(kind, atlasId = null) {
    _origin = { kind, atlasId: atlasId ?? null };
    await setSettingCompat(ORIGIN_KEY, _origin);
}

/**
 * Marks the local store as holding a REMOTE (server) atlas. Called after a successful
 * connect, so a later boot knows this data is ephemeral.
 * @param {string} atlasId
 * @returns {Promise<void>}
 */
export async function markStoreRemote(atlasId) {
    await setStoreOrigin(StoreOriginKind.REMOTE, atlasId);
}

/**
 * Marks the local store as holding a LOCAL (machine-owned) atlas. Called after clearing
 * data on disconnect/logout, and by the boot guard when discarding orphaned remote data.
 * @returns {Promise<void>}
 */
export async function markStoreLocal() {
    await setStoreOrigin(StoreOriginKind.LOCAL, null);
}

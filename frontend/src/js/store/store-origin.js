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
 *
 * WHERE THE MARKER LIVES, AND WHY IT IS THE ONE SETTING THAT CANNOT BE NAMESPACED:
 * it used to be an appStore key (`ebgeo_app_settings`), which is a PER-ATLAS database now.
 * This marker is read BEFORE any scope is active and is what DECIDES the scope, so keeping
 * it per atlas would mean choosing a namespace in order to discover which namespace to
 * choose. It therefore lives in the global database (`GlobalKey.STORE_ORIGIN`).
 *
 * Reading it from the new home alone would be a silent invariant break for anyone
 * upgrading mid-session: their marker is in the legacy unsuffixed `ebgeo_app_settings`,
 * the new home is empty, the read would default to LOCAL, and `enforceLocalStoreWhenLoggedOut`
 * would keep a server atlas as permanent local data. Hence the legacy fallback below. It
 * cannot wait for the schema migration either: `loadStoreOrigin` runs in the boot guard,
 * BEFORE `initializeRepository` runs any migration.
 */

import {
    GlobalKey,
    LEGACY_DB_SUFFIX,
    StoreName,
    getGlobalStore,
    getStoreFor,
    localScope
} from './atlas-namespace.js';

/** Origin kinds. */
export const StoreOriginKind = Object.freeze({ LOCAL: 'local', REMOTE: 'remote' });

/** Global-database key holding the persisted origin marker. */
const ORIGIN_KEY = GlobalKey.STORE_ORIGIN;

/**
 * Diagnostic id of the scope used to read the PRE-NAMESPACE settings database. It never
 * reaches a database name (the empty `LEGACY_DB_SUFFIX` does), and this read is the only
 * reason the module knows the legacy layout exists.
 */
const LEGACY_ORIGIN_SCOPE_ID = 'legacy-origin';

/** Default origin: a fresh/offline store is always LOCAL. */
const DEFAULT_ORIGIN = Object.freeze({ kind: StoreOriginKind.LOCAL, atlasId: null });

/**
 * In-memory mirror of the persisted origin, for synchronous reads on hot/boot paths.
 * @type {{ kind: string, atlasId: string|null }}
 */
let _origin = { ...DEFAULT_ORIGIN };

/**
 * Normalizes a persisted value into an origin, or null when it is absent/malformed.
 * @param {*} stored - Raw persisted value.
 * @returns {{ kind: string, atlasId: string|null }|null}
 */
function normalizeOrigin(stored) {
    return stored && stored.kind
        ? { kind: stored.kind, atlasId: stored.atlasId ?? null }
        : null;
}

/**
 * Reads the marker from the pre-namespace settings database (the unsuffixed
 * `ebgeo_app_settings`, which the migration adopts as local slot #1).
 * @returns {Promise<{ kind: string, atlasId: string|null }|null>}
 */
async function readLegacyOrigin() {
    try {
        const legacyScope = localScope(LEGACY_ORIGIN_SCOPE_ID, LEGACY_DB_SUFFIX);
        const legacySettings = getStoreFor(StoreName.SETTINGS, legacyScope);
        return normalizeOrigin(await legacySettings.getItem(ORIGIN_KEY));
    } catch {
        return null;
    }
}

/**
 * Moves a marker found in the legacy settings database into the global database.
 *
 * Order is the whole point: WRITE the new home first, and only then remove the legacy
 * copy. The failure mode of that order is a duplicated marker (inert, because the global
 * copy wins every later read); the reverse order loses the marker if the write fails, and
 * a lost REMOTE marker is a server atlas that becomes permanent local data. Leaving the
 * legacy copy in place forever is not an option either: a global database that is later
 * evicted would resurrect a stale REMOTE marker and the boot guard would discard local
 * work the user has done since.
 *
 * @param {{ kind: string, atlasId: string|null }} origin - Marker read from the legacy database.
 * @returns {Promise<void>}
 */
async function promoteLegacyOrigin(origin) {
    try {
        await getGlobalStore().setItem(ORIGIN_KEY, origin);
        const legacyScope = localScope(LEGACY_ORIGIN_SCOPE_ID, LEGACY_DB_SUFFIX);
        await getStoreFor(StoreName.SETTINGS, legacyScope).removeItem(ORIGIN_KEY);
    } catch {
        // Best effort: the in-memory mirror already holds the correct value for this boot,
        // and the legacy copy is still there to be promoted on the next one.
    }
}

/**
 * Loads the persisted origin marker into the in-memory mirror. Call once on boot before
 * any synchronous origin read, and before `initLocalAtlases()`, which needs the origin to
 * decide whether to activate a local slot or the remote scratch. Defaults to LOCAL when
 * absent or on any read error.
 * @returns {Promise<{ kind: string, atlasId: string|null }>}
 */
export async function loadStoreOrigin() {
    let stored = null;
    try {
        stored = normalizeOrigin(await getGlobalStore().getItem(ORIGIN_KEY));
    } catch {
        stored = null;
    }

    if (!stored) {
        stored = await readLegacyOrigin();
        if (stored) await promoteLegacyOrigin(stored);
    }

    _origin = stored ?? { ...DEFAULT_ORIGIN };
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
    await getGlobalStore().setItem(ORIGIN_KEY, { ..._origin });
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

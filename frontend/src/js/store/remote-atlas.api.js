// Path: js/store/remote-atlas.api.js

/**
 * @fileoverview The registry of REMOTE (server) atlas namespaces, and the wipe derived
 * from it. Sibling of `local-atlas.api.js`, and deliberately shaped like it: the local
 * atlases got an explicit registry and a wipe derived from that registry, and this is the
 * same move for the other side of the store-origin split.
 *
 * WHY IT EXISTS. Every server atlas now owns its ten databases
 * (`ebgeo_maps__remote-<atlasId>`, `atlas-namespace.js` Decision 1), because two tabs may
 * sit in two DIFFERENT server atlases and a single shared scratch would make them the same
 * ten databases. The price of that is this file: with a fixed scratch the logout wipe was a
 * constant list, and with N namespaces it needs to know WHICH namespaces exist. It cannot
 * ask the browser (`indexedDB.databases()` is not available everywhere), so it asks a
 * registry that is written BEFORE any namespace is used.
 *
 * THE INVARIANT, unchanged and non-negotiable: no data belonging to a server atlas
 * survives a logout. Three properties hold it up, and each one is a test:
 *
 *   1. REGISTER BEFORE THE FIRST WRITE. `activateRemoteAtlas` persists the entry and only
 *      then activates the scope, so a namespace can never receive a byte before the wipe
 *      knows it exists. The reverse order fails silently and forever.
 *   2. ONE KEY PER ATLAS (`remote_atlas:<atlasId>` in the global database), never one array
 *      under one key. Two tabs connecting to two atlases would each read the array, add
 *      their entry and write it back, and the loser's entry would vanish, which is exactly
 *      the unreachable residue this registry prevents. Separate keys do not race.
 *   3. THE PURGE READS FROM DISK, ALWAYS. There is no in-memory mirror in this module on
 *      purpose: a mirror loaded at boot cannot know about the atlas another tab opened
 *      afterwards, and logging out here has to wipe THAT one too.
 *
 * THE IDENTITY IS IN THE KEY, not in the stored value. A record that fails to parse still
 * yields its atlas id from the key, so a corrupted value cannot hide a server atlas from
 * the purge.
 *
 * THE ONE EXIT THAT KEEPS THE DATA: `adoptRemoteAtlasAsLocal` (implemented in
 * `local-atlas.api.js`, which owns the local registry). When a session dies with unsynced
 * operations, `AccountControl._handleLogout` deliberately preserves the work as local; with
 * a namespace per remote atlas that rescue is no longer "flip the origin marker", it is
 * "move the claim from this registry to the local one". Until that call site is wired, the
 * purge below is what runs, and it deletes. The purge SKIPS a namespace already claimed by
 * a local registry entry, so the two registries can disagree for a moment without anyone
 * losing data, and it removes the stale remote key when it finds one.
 */

import {
    GlobalKey,
    atlasIdFromRemoteAtlasKey,
    clearActiveScope,
    clearAtlasDatabases,
    dropAtlasDatabases,
    getActiveScope,
    getGlobalStore,
    isRemoteAtlasKey,
    activateScope,
    remoteAtlasKey,
    remoteScope,
    StoreScopeKind
} from './atlas-namespace.js';

/**
 * @typedef {Object} RemoteAtlasEntry
 * @property {string} atlasId - Server atlas id, the identity of the namespace.
 * @property {string} dbSuffix - Database suffix derived from it (`remote-<atlasId>`).
 * @property {number} createdAt - Epoch ms of the first registration.
 * @property {number} updatedAt - Epoch ms of the last activation.
 */

/**
 * @typedef {Object} RemotePurgeReport
 * @property {string[]} atlases - Atlas ids whose namespace was emptied.
 * @property {string[]} cleared - Database names emptied (the invariant-carrying step).
 * @property {string[]} dropped - Database names confirmed deleted from disk.
 * @property {string[]} blocked - Database names still on disk: emptied, delete not
 *   confirmed. Their registry entry is KEPT so the next logged-out boot retries.
 * @property {string[]} adopted - Atlas ids skipped because a local atlas claims their
 *   namespace. Their data is local now and must not be touched.
 * @property {boolean} deactivated - True when the active scope was one of the destroyed
 *   ones and was therefore cleared.
 */

/**
 * Reads every remote registry entry straight from the global database.
 *
 * No cache, by design (see the fileoverview): the set this returns is what another tab may
 * have changed one millisecond ago, and a wipe that consults a stale copy leaves server
 * data behind while reporting success.
 *
 * @returns {Promise<RemoteAtlasEntry[]>} Entries, oldest registration first.
 */
export async function listRemoteAtlases() {
    const globalStore = getGlobalStore();
    const keys = await globalStore.keys();
    const entries = [];

    for (const key of keys) {
        if (!isRemoteAtlasKey(key)) continue;
        const atlasId = atlasIdFromRemoteAtlasKey(key);
        if (!atlasId) continue;

        // The value is metadata; the KEY is the identity. A malformed value still produces
        // a usable entry, because a namespace the purge cannot see is the failure mode this
        // whole module exists to remove.
        const stored = await globalStore.getItem(key);
        entries.push({
            atlasId,
            dbSuffix: remoteScope(atlasId).dbSuffix,
            createdAt: Number.isFinite(stored?.createdAt) ? stored.createdAt : 0,
            updatedAt: Number.isFinite(stored?.updatedAt) ? stored.updatedAt : 0
        });
    }

    return entries.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Records that a server atlas owns a namespace on this machine. Idempotent: re-registering
 * keeps `createdAt` and refreshes `updatedAt`.
 *
 * CALL THIS BEFORE THE FIRST WRITE to the namespace, which is why `activateRemoteAtlas`
 * exists and why nothing else should call `activateScope(remoteScope(...))` directly.
 *
 * @param {string} atlasId - Server atlas id.
 * @returns {Promise<{ entry: RemoteAtlasEntry, scope: Object }>}
 * @throws {Error} When `atlasId` is missing or not an opaque id (caller bug: it reaches a
 *   database name).
 */
export async function registerRemoteAtlas(atlasId) {
    const scope = remoteScope(atlasId);
    const globalStore = getGlobalStore();
    const key = remoteAtlasKey(atlasId);

    const existing = await globalStore.getItem(key);
    const now = Date.now();
    const entry = {
        atlasId,
        dbSuffix: scope.dbSuffix,
        createdAt: Number.isFinite(existing?.createdAt) ? existing.createdAt : now,
        updatedAt: now
    };

    await globalStore.setItem(key, entry);
    return { entry, scope };
}

/**
 * Registers a server atlas and points every subsequent `getStore()` at its namespace.
 *
 * THE ORDER IS THE CONTRACT: if the registry write fails, this throws and NOTHING is
 * activated, so the caller cannot end up writing into a namespace no wipe can find.
 *
 * @param {string} atlasId - Server atlas id.
 * @returns {Promise<Object>} The activated scope.
 */
export async function activateRemoteAtlas(atlasId) {
    const { scope } = await registerRemoteAtlas(atlasId);
    activateScope(scope);
    return scope;
}

/**
 * @returns {Promise<Set<string>>} Database suffixes claimed by a LOCAL atlas. Read straight
 *   from the global database rather than through `local-atlas.api.js` so the purge works at
 *   boot, before any registry is loaded into memory.
 */
async function locallyClaimedSuffixes() {
    const stored = await getGlobalStore().getItem(GlobalKey.LOCAL_ATLASES);
    const atlases = Array.isArray(stored?.atlases) ? stored.atlases : [];
    return new Set(atlases.map(entry => entry?.dbSuffix).filter(s => typeof s === 'string'));
}

/**
 * Destroys the namespace of ONE registered remote atlas: empties it, then deletes the empty
 * databases, then removes the registry entry.
 *
 * @param {RemoteAtlasEntry} entry - Entry to destroy.
 * @param {number|undefined} dropTimeoutMs - Bound on each delete.
 * @returns {Promise<{ cleared: string[], dropped: string[], blocked: string[] }>}
 */
async function destroyRemoteAtlas(entry, dropTimeoutMs) {
    const scope = remoteScope(entry.atlasId);

    // Step 1 carries the invariant and cannot be blocked; step 2 is hygiene and can.
    const cleared = await clearAtlasDatabases(scope);
    const { dropped, blocked } = await dropAtlasDatabases(
        scope,
        dropTimeoutMs === undefined ? {} : { timeoutMs: dropTimeoutMs }
    );

    if (blocked.length === 0) {
        await getGlobalStore().removeItem(remoteAtlasKey(entry.atlasId));
    } else {
        // The entry SURVIVES on purpose: the data is already gone, and keeping the claim is
        // what makes the retry derived instead of remembered. The next boot without a
        // session finds it and deletes the shells, once the other tab has let go.
        console.warn(
            `[remote-atlas] delete blocked for atlas ${entry.atlasId}; data was emptied, `
            + `${blocked.length} empty database(s) stay until the next logged-out boot`
        );
    }

    return { cleared, dropped, blocked };
}

/**
 * THE LOGGED-OUT WIPE. Empties and deletes every registered remote namespace.
 *
 * It is derived from the registry, never from a hand-written list of atlases and never
 * from the store-origin marker: the marker describes the atlas this tab last had mounted,
 * while the residue that outlives a session is whatever any tab ever opened. That is why
 * `store.js` calls this whenever nobody is authenticated, INCLUDING when the marker says
 * LOCAL, which is the case a crash leaves behind.
 *
 * @param {Object} [options]
 * @param {number} [options.dropTimeoutMs] - Bound on each database delete.
 * @returns {Promise<RemotePurgeReport>}
 */
export async function purgeAllRemoteAtlases({ dropTimeoutMs } = {}) {
    const entries = await listRemoteAtlases();
    const report = {
        atlases: [],
        cleared: [],
        dropped: [],
        blocked: [],
        adopted: [],
        deactivated: false
    };
    if (entries.length === 0) return report;

    const claimed = await locallyClaimedSuffixes();

    for (const entry of entries) {
        if (claimed.has(entry.dbSuffix)) {
            // A local atlas owns these databases now (the unsynced-work rescue). The data
            // is local by decision, so only the stale remote claim goes.
            await getGlobalStore().removeItem(remoteAtlasKey(entry.atlasId));
            report.adopted.push(entry.atlasId);
            continue;
        }

        const result = await destroyRemoteAtlas(entry, dropTimeoutMs);
        report.atlases.push(entry.atlasId);
        report.cleared.push(...result.cleared);
        report.dropped.push(...result.dropped);
        report.blocked.push(...result.blocked);
    }

    // Every remote namespace has just been emptied, so an active remote scope now points at
    // a scope that must not be written to again (see `clearActiveScope`).
    if (report.atlases.length > 0 && getActiveScope()?.kind === StoreScopeKind.REMOTE) {
        clearActiveScope();
        report.deactivated = true;
    }

    return report;
}

/**
 * Destroys ONE remote namespace and forgets it. For the caller that leaves a server atlas
 * while the session stays alive; the logged-out sweep is `purgeAllRemoteAtlases`.
 *
 * @param {string} atlasId - Server atlas id.
 * @param {Object} [options]
 * @param {number} [options.dropTimeoutMs] - Bound on each database delete.
 * @returns {Promise<{ cleared: string[], dropped: string[], blocked: string[] }>}
 */
export async function forgetRemoteAtlas(atlasId, { dropTimeoutMs } = {}) {
    const scope = remoteScope(atlasId);
    const result = await destroyRemoteAtlas(
        { atlasId, dbSuffix: scope.dbSuffix, createdAt: 0, updatedAt: 0 },
        dropTimeoutMs
    );

    if (getActiveScope()?.kind === StoreScopeKind.REMOTE
        && getActiveScope()?.dbSuffix === scope.dbSuffix) {
        clearActiveScope();
    }
    return result;
}

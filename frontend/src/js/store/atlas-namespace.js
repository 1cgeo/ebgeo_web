// Path: js/store/atlas-namespace.js

/**
 * @fileoverview Single factory for every IndexedDB instance the store owns.
 *
 * It answers one question: given a logical store (maps, images, layers, ...) and the
 * currently active atlas, WHICH database do I write to. The answer used to be a
 * constant (`ebgeo_maps`), replicated across 33 call sites in 7 files, all evaluated at
 * module load, before any atlas was known. Here it becomes a lookup with a cache, so
 * those call sites turn into lazy accessors (`getStore(StoreName.MAPS)`) and a switch
 * of atlas re-points all of them at once.
 *
 * IT IS NOT YET THE ONLY CALLER OF `localforage.createInstance` IN `src/`, and writing
 * that it is would be a comfortable lie: 21 of the 33 call sites moved here, and the
 * other 12 stay in the four OLD migrations under `store/migration/`, which must keep
 * opening the pre-namespace database names or they would migrate the wrong database.
 * They are enumerated in the `PENDENTES` allowlist of the structural guard
 * (`frontend/tests/unit/repository-namespace.test.js`), which fails on any NEW caller.
 * The rule for new code is this module; the exception is listed, never implied.
 *
 * THE NAMESPACE GOES IN THE DATABASE NAME, NOT IN THE OBJECT-STORE NAME.
 * This is a measured decision, not a preference. Creating a database with a new name
 * while another tab holds sibling databases open completed 21/21 with zero `blocked`
 * events and ~1 ms each. Creating a new object store INSIDE a shared database is an
 * IndexedDB version upgrade: it fires `versionchange` on every other connection and
 * stays PENDING for as long as any holder refuses to close, with `blocked` as the only
 * signal and nobody listening to it (measured: 21/21 pending until released). It also
 * turns the database version into a monotonic counter driven by user actions. So
 * "create an atlas" must never be an upgrade of an existing database.
 *
 * ---------------------------------------------------------------------------
 * DECISION 1: WHERE THE REMOTE ATLAS LIVES
 * ---------------------------------------------------------------------------
 * Every server atlas gets a namespace of its OWN (`ebgeo_maps__remote-<atlasId>`, built by
 * `remoteScope`). One reason, and it is not about locking: two tabs may sit in two
 * DIFFERENT server atlases at the same time, and a single shared scratch would make those
 * two tabs the same ten databases. That is not contention a lock can arbitrate, it is one
 * address with two owners.
 *
 * THIS BLOCK USED TO SAY THE OPPOSITE, with a real reason: the invariant that REMOTE DATA
 * MUST NOT SURVIVE LOGOUT was enforced by wiping a KNOWN, SINGLE target, and per-atlas
 * names make that target stop being knowable. `indexedDB.databases()` is not available on
 * every engine the app supports, so a wipe cannot discover what exists by asking the
 * browser, and one missed name leaves a logged out user with a persistent, editable copy
 * of a server atlas.
 *
 * The answer is the same one the LOCAL atlases already use (`local-atlas.api.js`): the
 * wipe is DERIVED FROM A REGISTRY. `remote-atlas.api.js` writes one global-database key
 * per remote namespace BEFORE that namespace is ever written to, and `purgeAllRemoteAtlases`
 * iterates the registry. Two ordering rules carry the whole invariant:
 *
 *   - REGISTER BEFORE THE FIRST WRITE (`activateRemoteAtlas` registers, then activates).
 *     A namespace written to before it is registered is data no wipe can find.
 *   - ONE KEY PER ATLAS, never one array. Two tabs registering two atlases would clobber
 *     each other inside a read-modify-write of a shared array, and a lost entry is exactly
 *     the unreachable residue the registry exists to prevent.
 *
 * What happens on a switch of REMOTE atlas: the previous namespace stays on disk, holding
 * a snapshot that is refetched anyway, until the session ends. What ends it is the logged
 * out purge, which runs BOTH at boot and on the active logout path (`store.js`), and which
 * therefore also collects the namespaces of a tab that crashed.
 *
 * Corollary for the migration: the legacy unsuffixed databases become LOCAL slot #1
 * (see `LEGACY_DB_SUFFIX`), so no byte of local data is copied. That adoption is only
 * safe after reading the origin marker: if the store holds REMOTE data at that moment,
 * adopting it would manufacture a permanent local copy of a server atlas. Hence
 * `adoptLegacyDatabases` is an explicit input of the bootstrap, defaulting to "adopt
 * only when the persisted origin is LOCAL" (see `local-atlas.api.js`).
 *
 * ---------------------------------------------------------------------------
 * DECISION 2: WHAT IS GLOBAL TO THE INSTALLATION AND NEVER GETS A NAMESPACE
 * ---------------------------------------------------------------------------
 * Getting this wrong makes switching atlas erase the user's identity, so the list is
 * explicit and lives in code (`GlobalKey`, and `perAtlas: false` in the descriptors):
 *
 *   - NOT IN INDEXEDDB AT ALL, therefore untouched by this module and by any switch:
 *     `ebgeo_client_id`, the JWT access/refresh tokens, `ebgeo_global_color_usage`, the
 *     attribute-table config and the default 3D/360/measurement marker styles. They live
 *     in localStorage. The tab-lock persists nothing (BroadcastChannel). Nothing here
 *     reads or writes them, and nothing should "fix" that.
 *   - GLOBAL DATABASES: `ebgeo_global` (the local-atlas registry, the current-atlas
 *     pointer and the store-origin marker) and `ebgeo`/`operation_queue` (the outbound
 *     sync queue). The queue stays global because the operation envelope carries no
 *     atlas id (`createOperation`), so a per-atlas queue would record the atlas in a
 *     place nobody reads, would create up to 10 local queues that never drain (flush is
 *     gated on `connectionState.isOnline()`), and a queue keyed by remote atlas id is
 *     the editable server residue the store-origin marker forbids. The price is that a
 *     switch of local atlas must clear the queue, which today comes for free inside
 *     `clearAllDataStore`.
 *   - PER ATLAS, and therefore namespaced: the ten data databases below, including
 *     `schemaVersion`, which describes the SHAPE of one slot's data and must be read per
 *     slot (a single global marker would let a slot with older data be compared against
 *     an already-current global version and skip its migration in silence).
 *
 * The one key that MUST stay global even though it lives in app settings today is
 * `__store_origin__`: it is read before anything is scoped, and it decides which scope
 * to use. Namespacing it would mean choosing a namespace in order to discover which
 * namespace to choose.
 *
 * ---------------------------------------------------------------------------
 * DECISION 3: HOW THE CURRENT ATLAS IS CHOSEN AT BOOT, AND WHERE THE POINTER LIVES
 * ---------------------------------------------------------------------------
 * The pointer is `GlobalKey.CURRENT_LOCAL_ATLAS` in `ebgeo_global`. It cannot live
 * inside a namespace for the same reason as the origin marker: reading it would require
 * already knowing which namespace to open.
 *
 * Boot order (implemented by `initLocalAtlases` in `local-atlas.api.js`):
 *   1. read the origin marker from the global database (absent means LOCAL);
 *   2. origin REMOTE with a live session: activate the remote scratch scope, and do not
 *      touch any local slot;
 *   3. otherwise activate a LOCAL slot: the pointer if it resolves to a live registry
 *      entry, else the most recently updated entry, else bootstrap "Meu Atlas";
 *   4. the bootstrap entry adopts the legacy unsuffixed databases when the origin is
 *      LOCAL, which is what makes the migration a zero-copy operation, and what makes a
 *      fresh install and a migrated install end up with the SAME shape.
 *
 * The pointer is written only by `setCurrentLocalAtlas` and by the bootstrap. This phase
 * still opens exactly one atlas at boot, so no visible behavior changes.
 *
 * ---------------------------------------------------------------------------
 * DECISION 4: A DELETE THAT CANNOT COMPLETE MUST NOT BE A SILENT WAIT
 * ---------------------------------------------------------------------------
 * Measured, and it now matters: `deleteDatabase` fires `versionchange` on every other
 * connection and stays PENDING while any holder refuses to close (21 of 21 pending until
 * the holder released). Nobody listens to the `blocked` event. With a single shared
 * scratch two remote tabs were impossible, so this could not happen; with a namespace per
 * remote atlas, tab A logging out while tab B holds an atlas open is an ordinary Tuesday.
 *
 * So `dropAtlasDatabases` WAITS WITH A BOUND and reports `blocked` as data instead of
 * hanging, and the destruction of remote data is split in two, in this order:
 *
 *   1. `clearAtlasDatabases` EMPTIES every database of the scope. This needs no exclusive
 *      access, takes effect immediately for every tab, and is the step that carries the
 *      invariant: after it, no byte of the server atlas is readable anywhere.
 *   2. `dropAtlasDatabases` deletes the empty shells. This is HYGIENE, not the invariant,
 *      so a blocked delete is survivable: the registry entry is kept and the next boot
 *      without a session retries.
 *
 * The rejected alternative was asking the other tab over the tab-lock channel before
 * deleting. It puts the strongest invariant of the store in the hands of the least
 * reliable actor: a frozen or throttled background tab either stalls the logout or is
 * assumed absent, and both readings are a guess. Emptying needs no permission at all.
 */

import localforage from 'localforage';

/** Kinds of scope a store instance can be resolved for. */
export const StoreScopeKind = Object.freeze({
    LOCAL: 'local',
    REMOTE: 'remote'
});

/** Logical store ids. Use these, never a raw database name. */
export const StoreName = Object.freeze({
    ATLAS: 'atlas',
    MAPS: 'maps',
    IMAGES: 'images',
    SETTINGS: 'settings',
    GROUPS: 'groups',
    LAYERS: 'layers',
    CESIUM3D: 'cesium3d',
    STREETVIEW360: 'streetview360',
    BRIEFINGS: 'briefings',
    COMMENTS: 'comments',
    OPERATION_QUEUE: 'operationQueue',
    GLOBAL: 'global'
});

/**
 * Separator between a base database name and a scope suffix. FROZEN: changing it
 * orphans every existing database without raising a single error.
 */
export const NAMESPACE_SEPARATOR = '__';

/**
 * First segment of every REMOTE database suffix (`remote-<atlasId>`, Decision 1). It is a
 * label for a human reading `chrome://indexeddb-internals`, never the thing that decides
 * what gets wiped: the wipe is derived from the registry in `remote-atlas.api.js`, because
 * a name is not an inventory.
 */
const REMOTE_SUFFIX_PREFIX = 'remote';

/**
 * Separator INSIDE a suffix (`remote-<atlasId>`). A hyphen, not the `__` that separates the
 * base name from the suffix: a second `__` would make `ebgeo_maps__remote__<id>` parse into
 * two different things depending on which separator a reader splits on first.
 */
const NAMESPACE_SEPARATOR_IN_SUFFIX = '-';

/**
 * Suffix of the slot that owns the legacy unsuffixed databases. Empty on purpose: it is
 * what makes the migration of the pre-namespace workspace a zero-copy operation.
 */
export const LEGACY_DB_SUFFIX = '';

/** Key of the single atlas record inside a scoped `atlas` store. */
export const ATLAS_RECORD_KEY = 'current_atlas';

/** Keys of the global database. Anything not listed here is per atlas (Decision 2). */
export const GlobalKey = Object.freeze({
    /** Registry of local atlas slots: { version, atlases: [...] } */
    LOCAL_ATLASES: 'local_atlases',
    /** Id of the local slot to open at boot (Decision 3). */
    CURRENT_LOCAL_ATLAS: 'current_local_atlas',
    /** LOCAL vs REMOTE marker, read before anything is scoped. */
    STORE_ORIGIN: '__store_origin__',
    /**
     * PREFIX, not a key: the remote registry is ONE KEY PER ATLAS
     * (`remote_atlas:<atlasId>`), never one array under one key (Decision 1). Use
     * `remoteAtlasKey()` to build one and `isRemoteAtlasKey()` to recognise one.
     */
    REMOTE_ATLAS_PREFIX: 'remote_atlas:'
});

/**
 * @param {string} atlasId - Server atlas id.
 * @returns {string} Global-database key of that atlas's registry entry.
 */
export function remoteAtlasKey(atlasId) {
    return `${GlobalKey.REMOTE_ATLAS_PREFIX}${atlasId}`;
}

/**
 * @param {string} key - A key read from the global database.
 * @returns {boolean} True when it is a remote-registry entry.
 */
export function isRemoteAtlasKey(key) {
    return typeof key === 'string' && key.startsWith(GlobalKey.REMOTE_ATLAS_PREFIX);
}

/**
 * @param {string} key - A key read from the global database.
 * @returns {string|null} The atlas id carried BY THE KEY, or null.
 *
 * The identity lives in the key and never only in the stored value: a value that fails to
 * parse must still leave the namespace reachable by the purge, otherwise a corrupted
 * record would hide a server atlas from the wipe.
 */
export function atlasIdFromRemoteAtlasKey(key) {
    return isRemoteAtlasKey(key) ? key.slice(GlobalKey.REMOTE_ATLAS_PREFIX.length) : null;
}

/**
 * @typedef {Object} StoreDescriptor
 * @property {string} id - Logical id (a `StoreName` value).
 * @property {string} dbName - Base IndexedDB database name.
 * @property {string|null} storeName - Object store inside the database, when not the default.
 * @property {boolean} perAtlas - True when the database is namespaced per atlas.
 */

/**
 * The canonical list of every database the store owns. Adding a database means adding a
 * line here, which is what lets the clear/wipe paths be DERIVED instead of hand-listed
 * in three places.
 * @type {ReadonlyArray<StoreDescriptor>}
 */
export const STORE_DESCRIPTORS = Object.freeze([
    Object.freeze({ id: StoreName.ATLAS, dbName: 'ebgeo_atlas', storeName: null, perAtlas: true }),
    Object.freeze({ id: StoreName.MAPS, dbName: 'ebgeo_maps', storeName: null, perAtlas: true }),
    Object.freeze({ id: StoreName.IMAGES, dbName: 'ebgeo_images', storeName: null, perAtlas: true }),
    Object.freeze({ id: StoreName.SETTINGS, dbName: 'ebgeo_app_settings', storeName: null, perAtlas: true }),
    Object.freeze({ id: StoreName.GROUPS, dbName: 'ebgeo_groups', storeName: null, perAtlas: true }),
    Object.freeze({ id: StoreName.LAYERS, dbName: 'ebgeo_layers', storeName: null, perAtlas: true }),
    Object.freeze({ id: StoreName.CESIUM3D, dbName: 'ebgeo_cesium3d', storeName: null, perAtlas: true }),
    Object.freeze({ id: StoreName.STREETVIEW360, dbName: 'ebgeo_streetview360', storeName: null, perAtlas: true }),
    Object.freeze({ id: StoreName.BRIEFINGS, dbName: 'ebgeo_briefings', storeName: null, perAtlas: true }),
    Object.freeze({ id: StoreName.COMMENTS, dbName: 'ebgeo_comments', storeName: null, perAtlas: true }),
    Object.freeze({ id: StoreName.OPERATION_QUEUE, dbName: 'ebgeo', storeName: 'operation_queue', perAtlas: false }),
    Object.freeze({ id: StoreName.GLOBAL, dbName: 'ebgeo_global', storeName: null, perAtlas: false })
]);

/** @type {Map<string, StoreDescriptor>} */
const DESCRIPTORS_BY_ID = new Map(STORE_DESCRIPTORS.map(d => [d.id, d]));

/**
 * A suffix ends up in a database name, so it must be opaque and inert: an id, never a
 * user-typed atlas name (which carries accents and spaces, and is renameable).
 */
const VALID_SUFFIX = /^[A-Za-z0-9-]*$/;

/** Instance cache, keyed by `${storeId}|${scopeKey}`. */
const _instances = new Map();

/**
 * The scope every `getStore()` call resolves against.
 * @type {{ kind: string, atlasId: string|null, dbSuffix: string }|null}
 */
let _activeScope = null;

/**
 * Builds the scope of ONE server atlas. The id reaches the database name here (it did not
 * before, when every remote atlas shared one scratch), so it is validated exactly like a
 * local suffix: an opaque id, never user text.
 *
 * It THROWS on a missing or non-opaque id instead of falling back to a shared name. A
 * fallback would silently map two server atlases onto one set of databases, which is the
 * defect this decision exists to remove, and it would do it at the one moment nobody is
 * watching (a connect).
 *
 * @param {string} atlasId - Connected server atlas id.
 * @returns {{ kind: string, atlasId: string, dbSuffix: string }}
 */
export function remoteScope(atlasId) {
    if (typeof atlasId !== 'string' || atlasId.length === 0) {
        throw new Error('remoteScope: atlasId must be a non-empty string');
    }
    if (!VALID_SUFFIX.test(atlasId)) {
        throw new Error(`remoteScope: invalid atlasId "${atlasId}" (opaque id characters only)`);
    }
    return {
        kind: StoreScopeKind.REMOTE,
        atlasId,
        dbSuffix: `${REMOTE_SUFFIX_PREFIX}${NAMESPACE_SEPARATOR_IN_SUFFIX}${atlasId}`
    };
}

/**
 * Builds a local slot scope.
 *
 * WHAT IT REFUSES, AND WHAT IT DELIBERATELY ALLOWS: the bare `remote` suffix is reserved
 * (it was the single shared scratch, and a local slot landing on it would be a local atlas
 * living in the drawer the logout purge empties). A `remote-<atlasId>` suffix is ALLOWED,
 * because that is precisely what an ADOPTED namespace keeps: when a session dies with
 * unsynced work, `adoptRemoteAtlasAsLocal` moves the claim from the remote registry to the
 * local one, and refusing the suffix here would force a copy of ten databases (one of them
 * full of image blobs) on the single path that exists to rescue data.
 *
 * @param {string} atlasId - Local atlas id (registry entry id).
 * @param {string} dbSuffix - Persisted, opaque database suffix of that slot.
 * @returns {{ kind: string, atlasId: string, dbSuffix: string }}
 */
export function localScope(atlasId, dbSuffix) {
    if (typeof atlasId !== 'string' || atlasId.length === 0) {
        throw new Error('localScope: atlasId must be a non-empty string');
    }
    if (typeof dbSuffix !== 'string' || !VALID_SUFFIX.test(dbSuffix)) {
        throw new Error(`localScope: invalid dbSuffix "${dbSuffix}" (opaque id characters only)`);
    }
    if (dbSuffix === REMOTE_SUFFIX_PREFIX) {
        throw new Error('localScope: the remote scratch suffix is reserved');
    }
    return { kind: StoreScopeKind.LOCAL, atlasId, dbSuffix };
}

/**
 * @param {string} dbSuffix - A database suffix.
 * @returns {boolean} True when the suffix belongs to the remote namespace space. Useful
 *   for a diagnostic or an assertion; it is NOT how the purge finds what to wipe.
 */
export function isRemoteDbSuffix(dbSuffix) {
    return typeof dbSuffix === 'string'
        && dbSuffix.startsWith(`${REMOTE_SUFFIX_PREFIX}${NAMESPACE_SEPARATOR_IN_SUFFIX}`);
}

/**
 * @param {string} storeId
 * @returns {StoreDescriptor}
 */
function descriptorOf(storeId) {
    const descriptor = DESCRIPTORS_BY_ID.get(storeId);
    if (!descriptor) {
        throw new Error(`Unknown store id "${storeId}". Add it to STORE_DESCRIPTORS.`);
    }
    return descriptor;
}

/**
 * @param {{ kind: string, dbSuffix: string }} scope
 * @returns {string} Cache key fragment for a scope.
 */
function scopeKey(scope) {
    return `${scope.kind}:${scope.dbSuffix}`;
}

/**
 * Resolves the effective database name of a store in a scope.
 * @param {string} storeId - A `StoreName` value.
 * @param {{ kind: string, dbSuffix: string }} [scope] - Defaults to the active scope.
 * @returns {string} Database name.
 */
export function resolveDbName(storeId, scope = null) {
    const descriptor = descriptorOf(storeId);
    if (!descriptor.perAtlas) {
        return descriptor.dbName;
    }
    const effective = scope ?? requireActiveScope(storeId);
    return effective.dbSuffix === LEGACY_DB_SUFFIX
        ? descriptor.dbName
        : `${descriptor.dbName}${NAMESPACE_SEPARATOR}${effective.dbSuffix}`;
}

/**
 * @param {string} storeId - For the error message only.
 * @returns {{ kind: string, atlasId: string|null, dbSuffix: string }}
 */
function requireActiveScope(storeId) {
    if (!_activeScope) {
        throw new Error(
            `atlas-namespace: no active atlas scope when resolving "${storeId}". ` +
            'Call initLocalAtlases() (or activateScope) before touching per-atlas storage.'
        );
    }
    return _activeScope;
}

/**
 * Returns the localforage instance of a store in an explicit scope. Instances are cached
 * per (store, scope), so every caller of a given database shares ONE handle: two handles
 * for the same logical store are how a switch of atlas leaves one of them writing to the
 * previous namespace.
 * @param {string} storeId - A `StoreName` value.
 * @param {{ kind: string, dbSuffix: string }} [scope] - Defaults to the active scope.
 * @returns {import('localforage').default} localforage instance.
 */
export function getStoreFor(storeId, scope = null) {
    const descriptor = descriptorOf(storeId);
    const effective = descriptor.perAtlas ? (scope ?? requireActiveScope(storeId)) : null;
    const key = `${storeId}|${effective ? scopeKey(effective) : 'global'}`;

    const cached = _instances.get(key);
    if (cached) return cached;

    const options = { name: resolveDbName(storeId, effective) };
    if (descriptor.storeName) options.storeName = descriptor.storeName;

    const instance = localforage.createInstance(options);
    _instances.set(key, instance);
    return instance;
}

/**
 * Returns the localforage instance of a store in the ACTIVE scope.
 * @param {string} storeId - A `StoreName` value.
 * @returns {import('localforage').default} localforage instance.
 */
export function getStore(storeId) {
    return getStoreFor(storeId, null);
}

/**
 * Returns the global database (registry, current-atlas pointer, origin marker).
 * @returns {import('localforage').default} localforage instance.
 */
export function getGlobalStore() {
    return getStoreFor(StoreName.GLOBAL);
}

/**
 * Every per-atlas store of a scope, for derived wipes (the two parallel `clearAll*` lists
 * in `store.js` exist because this list was hand-written twice).
 * @param {{ kind: string, dbSuffix: string }} [scope] - Defaults to the active scope.
 * @returns {Array<{ id: string, store: import('localforage').default }>}
 */
export function listAtlasStores(scope = null) {
    return STORE_DESCRIPTORS
        .filter(d => d.perAtlas)
        .map(d => ({ id: d.id, store: getStoreFor(d.id, scope) }));
}

/**
 * Points every subsequent `getStore()` at a scope.
 * @param {{ kind: string, atlasId: string|null, dbSuffix: string }} scope
 * @returns {void}
 */
export function activateScope(scope) {
    if (!scope || typeof scope.dbSuffix !== 'string' || !scope.kind) {
        throw new Error('activateScope: expected a scope built by localScope()/remoteScope()');
    }
    _activeScope = scope;
}

/**
 * @returns {{ kind: string, atlasId: string|null, dbSuffix: string }|null} Active scope.
 */
export function getActiveScope() {
    return _activeScope;
}

/**
 * Forgets the active scope, so the next `getStore()` has nothing to resolve against.
 *
 * This is part of DESTROYING a scope, not a convenience: leaving a just deleted scope
 * active lets the next write recreate its databases, and a namespace recreated after its
 * registry entry was removed is unreachable residue, which is the one thing the remote
 * registry exists to prevent. The caller re-points at a live scope (or lets
 * `ensureAtlasScope` fall back to the legacy local one).
 * @returns {void}
 */
export function clearActiveScope() {
    _activeScope = null;
}

/**
 * Drops the cached instances (all of them, or only those of one scope). Instances are
 * not closed here: localforage reopens on demand, and dropping the cache is what forces
 * the next `getStore()` to re-resolve the name.
 * @param {{ kind: string, dbSuffix: string }} [scope] - Limit to one scope.
 * @returns {void}
 */
export function clearStoreCache(scope = null) {
    if (!scope) {
        _instances.clear();
        return;
    }
    const suffix = `|${scopeKey(scope)}`;
    for (const key of [..._instances.keys()]) {
        if (key.endsWith(suffix)) _instances.delete(key);
    }
}

/**
 * How long a single `deleteDatabase` may stay pending before it is reported as blocked
 * (Decision 4). Long enough for a healthy tab to answer `versionchange` and close, short
 * enough that a logout is never held hostage by a frozen one.
 */
export const DROP_TIMEOUT_MS = 3000;

/**
 * EMPTIES every per-atlas database of a scope, without deleting any of them.
 *
 * This is the step that carries the "no remote data survives logout" invariant: `clear()`
 * needs no exclusive access, so unlike a delete it cannot be blocked by another tab
 * (Decision 4). `repository.clearAllAtlasStores()` is the same operation aimed at the
 * ACTIVE scope; this one takes the scope explicitly, which is what a wipe of N registered
 * remote namespaces needs.
 *
 * @param {{ kind: string, dbSuffix: string }} scope - Scope to empty.
 * @returns {Promise<string[]>} Database names emptied, in descriptor order.
 */
export async function clearAtlasDatabases(scope) {
    if (!scope || typeof scope.dbSuffix !== 'string') {
        throw new Error('clearAtlasDatabases: expected a scope built by localScope()/remoteScope()');
    }
    const cleared = [];
    for (const descriptor of STORE_DESCRIPTORS) {
        if (!descriptor.perAtlas) continue;
        await getStoreFor(descriptor.id, scope).clear();
        cleared.push(resolveDbName(descriptor.id, scope));
    }
    return cleared;
}

/**
 * Deletes one database, waiting only up to `timeoutMs`.
 * @param {string} name - Database name.
 * @param {number} timeoutMs - Upper bound on the wait.
 * @returns {Promise<boolean>} True when the delete CONFIRMED. False covers both a pending
 *   delete (another connection is holding the database) and a rejected one: from the
 *   caller's side they are the same fact, the database is still on disk.
 */
async function dropOneDatabase(name, timeoutMs) {
    let timer = null;
    try {
        const confirmed = localforage.dropInstance({ name }).then(() => true, () => false);
        const expired = new Promise(resolve => {
            timer = setTimeout(() => resolve(false), timeoutMs);
        });
        return await Promise.race([confirmed, expired]);
    } finally {
        if (timer !== null) clearTimeout(timer);
    }
}

/**
 * Deletes the per-atlas databases of a scope from disk. `clear()` only empties a
 * database and leaves it standing, which with 10 slots would leave up to 100 empty
 * databases behind.
 *
 * IT NEVER WAITS FOREVER, and it never lies about what happened (Decision 4). A delete
 * that another tab is holding open is reported in `blocked` and the caller decides:
 * `purgeAllRemoteAtlases` keeps the registry entry so the next boot without a session
 * retries, which is why a blocked delete costs disk space and never costs the invariant.
 *
 * The deletes run in PARALLEL so the worst case is one timeout, not ten.
 *
 * @param {{ kind: string, dbSuffix: string }} scope - Scope to destroy.
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=DROP_TIMEOUT_MS] - Bound on each delete.
 * @returns {Promise<{ dropped: string[], blocked: string[] }>} Names confirmed deleted, and
 *   names still on disk, both in descriptor order.
 */
export async function dropAtlasDatabases(scope, { timeoutMs = DROP_TIMEOUT_MS } = {}) {
    if (!scope || typeof scope.dbSuffix !== 'string') {
        throw new Error('dropAtlasDatabases: expected a scope built by localScope()/remoteScope()');
    }
    const names = STORE_DESCRIPTORS
        .filter(d => d.perAtlas)
        .map(d => resolveDbName(d.id, scope));

    const confirmations = await Promise.all(names.map(name => dropOneDatabase(name, timeoutMs)));

    const dropped = names.filter((_, i) => confirmations[i]);
    const blocked = names.filter((_, i) => !confirmations[i]);

    clearStoreCache(scope);
    return { dropped, blocked };
}

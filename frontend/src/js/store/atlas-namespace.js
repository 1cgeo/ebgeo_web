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
 *   - THE ONE GLOBAL DATABASE: `ebgeo_global` (the local-atlas registry, the current-atlas
 *     pointer and the store-origin marker).
 *   - PER ATLAS, and therefore namespaced: the ten data databases below, including
 *     `schemaVersion`, which describes the SHAPE of one slot's data and must be read per
 *     slot (a single global marker would let a slot with older data be compared against
 *     an already-current global version and skip its migration in silence).
 *   - PER ATLAS BUT NOT DATA: `ebgeo`/`operation_queue`, the outbound sync queue. See the
 *     next block, because it is the one database that belongs to an atlas and is NOT part
 *     of its data.
 *
 * ---------------------------------------------------------------------------
 * DECISION 2b: THE OUTBOUND QUEUE IS PER ATLAS, AND IT IS NOT ATLAS DATA
 * ---------------------------------------------------------------------------
 * The queue used to be the second global database, and the argument for it was that the
 * operation envelope carried no atlas id. It does now (`createOperation` stamps
 * `scopeSuffix` and `atlasId`), so the argument is spent, and what was left was a shared
 * mutable table read by every tab: two tabs in two atlases wrote their pending work into
 * one place, and every read had to be filtered to be correct. A filter is a rule somebody
 * can forget; a separate database is a fact of the browser.
 *
 * `perAtlas: true` therefore, with the LEGACY suffix keeping the name `ebgeo` exactly as it
 * is today, so the pre-namespace queue IS the queue of local slot #1 and no byte moves for
 * the ordinary installation (`store/sync/operation-queue-migration.js` routes the rest).
 *
 * BUT IT IS NOT ATLAS DATA (`atlasData: false`), and that distinction is the whole reason
 * the flag is not a single boolean. The two lists derived here differ:
 *
 *   - `listAtlasStores` (the ten with `atlasData: true`) is the ATLAS WIPE: what
 *     `clearAllAtlasStores` empties when a tab leaves a project, mounts another, imports a
 *     file or clears everything. The queue MUST NOT be in it. `openRemoteAtlas` activates
 *     the namespace of the atlas it is opening and empties three lines later, so a queue
 *     inside that list would be the pending work OF THE ATLAS BEING OPENED, destroyed
 *     immediately before the `connect` that would have drained it.
 *   - `clearAtlasDatabases` / `dropAtlasDatabases` (everything with `perAtlas: true`) is
 *     DESTRUCTION of a namespace. The queue IS in it, and it has to be: an operation carries
 *     the entity payload, so a queue left standing after its server atlas was destroyed is
 *     readable server data surviving a logout, which is the one invariant this file exists
 *     to hold.
 *
 * The rescue inherits the queue for free, and that is a gain the global queue could not
 * give: `adoptRemoteAtlasAsLocal` moves the claim and zero bytes, so the adopted slot keeps
 * the very databases of the server atlas, queue included, and the record of what never got
 * uploaded survives with the work it describes.
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
 * RE-MEASURED 2026-08-15 WITH THE REAL localforage, AND THE NUMBERS ABOVE NEED A QUALIFIER
 * (`tests/unit/idb-decisao4-medicao.test.js` is the measurement, and it is kept as a test so
 * the next person re-runs it instead of trusting this paragraph). "Stays pending" is NOT a
 * property of the operation: it is a property of a holder that does not close. localforage
 * installs `db.onversionchange = e => e.target.close()` and reconnects on the next
 * transaction, so a holder that went through localforage RELEASES, and the same delete
 * completed 21/21. What still reproduces exactly as written is the case this decision is
 * about: a holder that ignores `versionchange` blocks the delete 21/21, with `blocked` as the
 * only signal. The bound and the two-step split below are therefore still right, and for the
 * stated reason; what would be wrong is to read the first paragraph as "deletes never
 * complete while another tab is open".
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
 *
 * ---------------------------------------------------------------------------
 * DECISION 5: "SOMEBODY HAS THIS MOUNTED" IS A WEB LOCK, NOT A ROSTER
 * ---------------------------------------------------------------------------
 * Mounting a scope takes `navigator.locks.request(atlasMountLockName(dbSuffix), {mode:'shared'})`
 * with a promise that only resolves on unmount; destroying that namespace requires the SAME
 * name in `{mode:'exclusive', ifAvailable:true}`. No grant means a live client has it mounted,
 * and the destruction is skipped (`remote-atlas.api.js` reports it as `spared`).
 *
 * WHY NOT THE TAB-LOCK ROSTER, which already knows who holds what: it is a clock, and
 * `utilities/tab-lock.js` documents three windows where it lies by construction (a tab in
 * bfcache posts RELEASE, the degraded mode leaves the roster permanently empty, and the boot
 * purge runs before the lock exists at all). A Web Lock is a fact of the browser: it is
 * released by the DEATH of the client, never by its silence, and a frozen tab KEEPS it, which
 * is the case every heartbeat scheme gets wrong.
 *
 * MEASURED IN THE SUITE'S OWN RUNTIME (node v24.13.1, 2026-08-15), because building on an
 * assumed primitive is how a guard ends up guarding nothing: `navigator.locks` exists; with a
 * shared lock held, `exclusive ifAvailable` yields null 200/200; on another name it is granted
 * 200/200; after the release promise settles it is granted 200/200 with no delay needed. Two
 * more facts that shape the code below: the LockManager is shared across worker threads but NOT
 * across processes (vitest's default `forks` pool gives every test file its own), and a lock
 * that is never released does not keep the process alive.
 *
 * WHAT THIS IS NOT. It is not fencing: it says "a live client has this mounted", it does not
 * stop that client from writing. And in a NON-SECURE context (plain HTTP) `navigator.locks`
 * does not exist at all; there the destruction proceeds unconditionally, because the hard
 * invariant (no server data survives a logout) outranks the convenience of sparing.
 *
 * THE HOLDER IS PER CLIENT, AND IT LIVES ON `globalThis` FOR THAT REASON. A tab mounts one
 * atlas at a time, so this module holds at most one shared lock; a module INSTANCE, however, is
 * not the client. Vite's HMR and `vi.resetModules()` both build a second instance of this file
 * inside the same client, and a lock leaked by the discarded instance would be a namespace no
 * purge could ever destroy again, silently and forever.
 *
 * ---------------------------------------------------------------------------
 * DECISION 6: "WHICH ATLAS DOES THIS TAB MOUNT" IS A PER-TAB QUESTION
 * ---------------------------------------------------------------------------
 * Every pointer above (`CURRENT_LOCAL_ATLAS`, the origin marker) is GLOBAL to the installation,
 * which was right while a tab could only ever be looking at the one atlas the installation had.
 * With a namespace per atlas two tabs sit in two different atlases at the same time, and a global
 * pointer then answers the wrong tab: tab A presses F5 and boots into tab B's atlas, because the
 * last write to the shared pointer was B's.
 *
 * So the mount is remembered in `sessionStorage` (`TAB_MOUNT_KEY`), which is per tab and survives
 * F5, and `activateScope` writes it. The global keys stay exactly where they are and keep their
 * old meaning, now demoted to a FALLBACK: they say what the installation last did, which is the
 * right answer for a tab that has never mounted anything (a brand new tab).
 *
 * THE BOOT READS A SNAPSHOT, NOT THE LIVE KEY, and that is the part that is easy to get wrong.
 * The boot MOUNTS SOMETHING BEFORE IT DECIDES what to mount: the repository bridge
 * (`ensureAtlasScope`) activates the legacy local scope on the first store access, and the
 * logged-out guard runs store code before `activateBootAtlasScope` by design. So the live key is
 * already overwritten by the time the decision is made. `bootTabMountPointer()` captures the
 * pre-mount value once and hands that out; `readTabMountPointer()` is the live read.
 *
 * WHAT IT IS NOT. It is not an arbitration primitive and it never refuses anything: two tabs that
 * end up on the same atlas are the mount lock's business and the tab lock's, not this pointer's.
 * And sessionStorage is INHERITED by a DUPLICATED tab, so a duplicate boots holding its parent's
 * pointer and mounts the same atlas; that is the pre-existing behaviour of every other
 * sessionStorage flag in the app (`ebgeo_local_intent`), and telling the two apart needs a live
 * probe of the mount lock, not a stamp — a stamp written to sessionStorage is inherited with it.
 *
 * THE STORED VALUE IS NOT TRUSTED, it is REBUILT: the reader feeds the stored fields back through
 * `localScope()`/`remoteScope()`, so a hand-edited `dbSuffix` cannot point a mount at a database
 * its id does not name, and a malformed record reads as "no pointer" instead of as a scope.
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
    /**
     * LEGACY key of the local registry: `{ version, atlases: [...] }`, one array under one
     * key. Read once by the migration in `local-atlas.api.js` and then removed; nothing
     * writes it any more. See `LOCAL_ATLAS_PREFIX` for why.
     */
    LOCAL_ATLASES: 'local_atlases',
    /** Id of the local slot to open at boot (Decision 3). */
    CURRENT_LOCAL_ATLAS: 'current_local_atlas',
    /** LOCAL vs REMOTE marker, read before anything is scoped. */
    STORE_ORIGIN: '__store_origin__',
    /**
     * PREFIX, not a key: the remote registry is ONE KEY PER ATLAS
     * (`remote_atlas:<atlasId>`), never one array under one key (Decision 1). Use
     * `remoteAtlasRegistryKey()` to build one and `isRemoteAtlasRegistryKey()` to recognise one.
     */
    REMOTE_ATLAS_PREFIX: 'remote_atlas:',
    /**
     * PREFIX, and the local registry follows the remote one for the SAME reason, which it
     * ignored for a whole phase: one array under one key is a read-modify-write, and two
     * tabs writing it lose one entry each time. The losing entry is a slot whose ten
     * databases exist on disk and appear in no registry, so no purge and no UI can reach
     * them. It is reachable by a plain gesture: two tabs whose session dies together both
     * run the rescue (`adoptRemoteAtlasAsLocal`), and the second overwrites the first.
     */
    LOCAL_ATLAS_PREFIX: 'local_atlas:',
    /**
     * THE HAND-OVER SLOT of a `.ebgeo` chosen on `atlas.html` and imported by the map.
     *
     * It is a KEY of the global database and not a store descriptor of its own, and that is the
     * whole decision. A new object store INSIDE an existing database is an IndexedDB version
     * upgrade (the opening block of this file), and a thirteenth database would be a namespace
     * for something that belongs to no atlas. A key inherits exactly the treatment this needs
     * from `ebgeo_global`'s flags: `perAtlas:false` keeps it out of `clearAtlasDatabases` /
     * `dropAtlasDatabases`, `atlasData:false` keeps it out of `listAtlasStores` (hence out of
     * every atlas wipe), and `getStoreFor` resolves it with NO active scope, which is what lets a
     * page that mounts nothing write it.
     *
     * The flip side is that NO wipe collects it, so it must collect itself: see
     * {@link takePendingImport}, which removes before it validates, and expires by age.
     */
    PENDING_IMPORT: 'pending_import'
});

/**
 * THE NAME CARRIES `Registry` BECAUSE THERE IS A HOMONYM, and importing the wrong one is a
 * mistake nothing else would catch. `utilities/tab-lock.js` exports a `remoteAtlasKey` too, and
 * it builds something else entirely: a CLAIM key `{kind:'remote', atlasId}` broadcast between
 * tabs, never a string and never a database key. The two names sat one import away from each
 * other for a whole phase (P8). The local side already said `localAtlasRegistryKey`, so this is
 * the symmetry it was missing, and the suffix is what makes a wrong import fail at the call
 * instead of at the invariant.
 *
 * @param {string} atlasId - Server atlas id.
 * @returns {string} Global-database key of that atlas's registry entry.
 */
export function remoteAtlasRegistryKey(atlasId) {
    return `${GlobalKey.REMOTE_ATLAS_PREFIX}${atlasId}`;
}

/**
 * @param {string} key - A key read from the global database.
 * @returns {boolean} True when it is a remote-registry entry.
 */
export function isRemoteAtlasRegistryKey(key) {
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
export function atlasIdFromRemoteRegistryKey(key) {
    return isRemoteAtlasRegistryKey(key) ? key.slice(GlobalKey.REMOTE_ATLAS_PREFIX.length) : null;
}

/**
 * @param {string} atlasId - Local atlas id.
 * @returns {string} Global-database key of that slot's registry entry.
 */
export function localAtlasRegistryKey(atlasId) {
    return `${GlobalKey.LOCAL_ATLAS_PREFIX}${atlasId}`;
}

/**
 * @param {string} key - A key read from the global database.
 * @returns {boolean} True when it is a local-registry entry.
 */
export function isLocalAtlasRegistryKey(key) {
    return typeof key === 'string' && key.startsWith(GlobalKey.LOCAL_ATLAS_PREFIX);
}

/**
 * @param {string} key - A key read from the global database.
 * @returns {string|null} The atlas id carried BY THE KEY, or null.
 *
 * Same rule as the remote side: identity lives in the key, so a value that fails to parse
 * still leaves the slot enumerable instead of turning it into unreachable disk.
 */
export function atlasIdFromLocalRegistryKey(key) {
    return isLocalAtlasRegistryKey(key) ? key.slice(GlobalKey.LOCAL_ATLAS_PREFIX.length) : null;
}

/**
 * Every local slot recorded on disk, from BOTH registry shapes.
 *
 * The one-key-per-slot form is the current one; the legacy array is still read because an
 * installation that has not booted since the change still carries it, and the two readers
 * outside `local-atlas.api.js` run BEFORE any registry is loaded into memory: the logged-out
 * purge (which must know which suffixes a local slot claims, or it deletes rescued work) and
 * the 2.3 migration (which must not re-bootstrap an installation that already has slots).
 *
 * READ FROM DISK, NEVER FROM A MIRROR, for the same reason the remote registry does: a mirror
 * loaded at boot cannot know about a slot another tab created afterwards.
 *
 * @returns {Promise<Array<{id: string, name?: string, dbSuffix?: string}>>}
 */
export async function readLocalAtlasRegistry() {
    const globalStore = getGlobalStore();
    const out = [];
    const seen = new Set();

    for (const key of await globalStore.keys()) {
        if (!isLocalAtlasRegistryKey(key)) continue;
        const value = await globalStore.getItem(key);
        const id = atlasIdFromLocalRegistryKey(key);
        if (!value || typeof value !== 'object' || seen.has(id)) continue;
        seen.add(id);
        out.push({ ...value, id });
    }

    const legacy = await globalStore.getItem(GlobalKey.LOCAL_ATLASES);
    for (const entry of Array.isArray(legacy?.atlases) ? legacy.atlases : []) {
        if (!entry?.id || seen.has(entry.id)) continue;
        seen.add(entry.id);
        out.push({ ...entry });
    }

    return out;
}

/**
 * WHO CLAIMS THE NAMESPACE OF ONE SERVER ATLAS, asked of the two registries and of nothing else.
 *
 * It exists so the durable origin marker can stop being a second source of truth: the marker is a
 * per-tab intention written by a caller, while the registries are what every destructive path is
 * DERIVED from (`purgeAllRemoteAtlases`, `readLocalAtlasRegistry`). When the two disagree the
 * registry has to win, and this is the reading that lets `store-origin.js` say so.
 *
 * `'none'` MEANS "NEITHER REGISTRY NAMES IT", AND IT IS NOT EVIDENCE OF ANYTHING. Two very
 * different installations produce it and they demand opposite treatment, so a caller that reads
 * absence as a verdict gets one of them badly wrong:
 *
 *   - a PRE-NAMESPACE (2.2) install has no registry at all and keeps the server atlas in the
 *     UNSUFFIXED databases, where the origin marker is the only evidence it is there;
 *   - a namespaced install that swept the atlas and died before flipping the marker.
 *
 * Telling them apart by "does a local registry exist yet" was tried and is WRONG, measured: the
 * boot BOOTSTRAPS a local slot (`initLocalAtlases`) before the schema migration asks this
 * question, so the same install answers "no registry" at the first read and "registry" at the
 * second, and the 2.2 upgrade stopped discarding a server atlas it was holding. Only the POSITIVE
 * claims below are stable enough to overrule a marker.
 *
 * @param {string} atlasId - Server atlas id.
 * @returns {Promise<'remote'|'local'|'none'>} `'local'` when a local slot adopted the namespace
 *   (the rescue), `'remote'` when the remote registry still names it, `'none'` otherwise.
 */
export async function describeRemoteNamespaceClaim(atlasId) {
    let dbSuffix;
    try {
        dbSuffix = remoteScope(atlasId).dbSuffix;
    } catch {
        // An id that cannot name a namespace claims none.
        return 'none';
    }

    // THE LOCAL CLAIM IS CHECKED FIRST, and the order is the rescue's: `adoptRemoteAtlasAsLocal`
    // writes the local entry BEFORE removing the remote one, so a crash in between leaves both
    // standing. Reading the remote key first would call a rescued slot "server data".
    const localEntries = await readLocalAtlasRegistry();
    if (localEntries.some(entry => entry?.dbSuffix === dbSuffix)) return 'local';

    return await getGlobalStore().getItem(remoteAtlasRegistryKey(atlasId)) ? 'remote' : 'none';
}

/**
 * @typedef {Object} StoreDescriptor
 * @property {string} id - Logical id (a `StoreName` value).
 * @property {string} dbName - Base IndexedDB database name.
 * @property {string|null} storeName - Object store inside the database, when not the default.
 * @property {boolean} perAtlas - True when the database is namespaced per atlas, and therefore
 *   destroyed with that atlas (`clearAtlasDatabases` / `dropAtlasDatabases`).
 * @property {boolean} atlasData - True when the database holds the atlas's DATA, and is therefore
 *   emptied by an atlas wipe (`listAtlasStores`, i.e. `clearAllAtlasStores`). Only the outbound
 *   queue is `perAtlas` WITHOUT being `atlasData`; Decision 2b says why the two lists differ.
 */

/**
 * The canonical list of every database the store owns. Adding a database means adding a
 * line here, which is what lets the clear/wipe paths be DERIVED instead of hand-listed
 * in three places.
 * @type {ReadonlyArray<StoreDescriptor>}
 */
export const STORE_DESCRIPTORS = Object.freeze([
    Object.freeze({ id: StoreName.ATLAS, dbName: 'ebgeo_atlas', storeName: null, perAtlas: true, atlasData: true }),
    Object.freeze({ id: StoreName.MAPS, dbName: 'ebgeo_maps', storeName: null, perAtlas: true, atlasData: true }),
    Object.freeze({ id: StoreName.IMAGES, dbName: 'ebgeo_images', storeName: null, perAtlas: true, atlasData: true }),
    Object.freeze({ id: StoreName.SETTINGS, dbName: 'ebgeo_app_settings', storeName: null, perAtlas: true, atlasData: true }),
    Object.freeze({ id: StoreName.GROUPS, dbName: 'ebgeo_groups', storeName: null, perAtlas: true, atlasData: true }),
    Object.freeze({ id: StoreName.LAYERS, dbName: 'ebgeo_layers', storeName: null, perAtlas: true, atlasData: true }),
    Object.freeze({ id: StoreName.CESIUM3D, dbName: 'ebgeo_cesium3d', storeName: null, perAtlas: true, atlasData: true }),
    Object.freeze({ id: StoreName.STREETVIEW360, dbName: 'ebgeo_streetview360', storeName: null, perAtlas: true, atlasData: true }),
    Object.freeze({ id: StoreName.BRIEFINGS, dbName: 'ebgeo_briefings', storeName: null, perAtlas: true, atlasData: true }),
    Object.freeze({ id: StoreName.COMMENTS, dbName: 'ebgeo_comments', storeName: null, perAtlas: true, atlasData: true }),
    Object.freeze({ id: StoreName.OPERATION_QUEUE, dbName: 'ebgeo', storeName: 'operation_queue', perAtlas: true, atlasData: false }),
    Object.freeze({ id: StoreName.GLOBAL, dbName: 'ebgeo_global', storeName: null, perAtlas: false, atlasData: false })
]);

/**
 * The scope the outbound queue resolves against while NO atlas is mounted (the boot window
 * before `initLocalAtlases`, and the instant between a destroyed scope and the next mount).
 *
 * It is the LEGACY suffix, so the queue keeps the name it has always had (`ebgeo`) and a
 * caller that touches it too early neither throws nor invents a database. An operation
 * written there is not lost: it carries no address, and an unaddressed operation is
 * readable from any scope (`operationBelongsToScope`).
 */
export const UNMOUNTED_QUEUE_SCOPE = Object.freeze({
    kind: StoreScopeKind.LOCAL,
    atlasId: null,
    dbSuffix: LEGACY_DB_SUFFIX
});

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
 * The server atlas whose namespace a suffix names, if any.
 *
 * It exists because a LOCAL slot can carry a `remote-<atlasId>` suffix: `adoptRemoteAtlasAsLocal`
 * rescues unsynced work by moving the claim between registries and ZERO bytes between databases
 * (`local-atlas.api.js`). Such a slot and that server atlas are the same ten databases, and the
 * tab lock has to know it (`utilities/tab-lock.js`, the ADOPTED SLOT paragraph). Parsing lives
 * here, next to the code that builds the suffix, so the two cannot drift apart.
 *
 * @param {string} dbSuffix - A persisted database suffix.
 * @returns {string|null} The atlas id, or null when the suffix names no remote atlas.
 */
export function remoteAtlasIdFromDbSuffix(dbSuffix) {
    if (!isRemoteDbSuffix(dbSuffix)) return null;
    const atlasId = dbSuffix.slice(
        REMOTE_SUFFIX_PREFIX.length + NAMESPACE_SEPARATOR_IN_SUFFIX.length
    );
    return atlasId.length > 0 ? atlasId : null;
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

// ===========================================================================================
// THE PENDING `.ebgeo` (GlobalKey.PENDING_IMPORT)
// ===========================================================================================

/**
 * Shape version of the stored hand-over. A record written by another version reads as ABSENT,
 * for the same reason the tab pointer does: this one decides which bytes get imported into an
 * atlas, and guessing at an unknown shape is how a file lands in the wrong slot.
 */
/**
 * Shape version of the hand-over record.
 *
 * BUMPED TO 2 IN 2026-08-16, when the slot stopped being created by the producer. A v1 record
 * named a local slot (`atlasId`) that `atlas.html` had already created for it; a v2 record names
 * only the FILE, and the consumer creates the slot. Reading a v1 record with the v2 consumer would
 * create a SECOND slot and leave the producer's one behind — exactly the orphan this phase removes
 * — so the old shape is dropped rather than accepted. The cost is one lost hand-over for whoever
 * was mid-navigation across the deploy, and the file is still on their disk.
 */
const PENDING_IMPORT_VERSION = 2;

/**
 * How long a hand-over may sit unclaimed. It exists because the producer and the consumer are two
 * PAGE LOADS: the user can pick a file and close the tab before the map ever boots, and no wipe in
 * this codebase reaches the global database. A day is generous for a navigation that normally takes
 * milliseconds, and short enough that a file cannot surprise its owner weeks later.
 */
export const PENDING_IMPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Hands a `.ebgeo` over to the next map boot IN THIS BROWSER.
 *
 * The producer is the chooser page, which has no store and no importer; the consumer is the map,
 * which has both. Passing the bytes through the global database is what keeps the importer from
 * being written a second time (`import_export/export-import.service.js` stays the only one).
 *
 * THE BYTES TRAVEL AS AN ArrayBuffer, never as a `File`. A `File`/`Blob` is structured-cloneable
 * and IndexedDB does store it, but the name and the type are carried in the record instead, so the
 * consumer rebuilds a `File` it can reason about rather than trusting whatever a previous deploy
 * wrote.
 *
 * THE RECORD NAMES THE FILE, NEVER A SLOT. It used to carry `atlasId` as well, because the page
 * created the local slot before navigating; a boot that then DECLINED the import (a deep link in
 * the URL, an importer that never registered, a file that fails to parse) left that slot behind,
 * populated with the blank `Principal` the store boot writes, and no guard could tell it from an
 * atlas the user made. The slot is now born on the consuming side, at the moment the import is
 * actually going to run (`deep-link/pending-import.js`), so a refused hand-over costs nothing.
 *
 * The name is REQUIRED and non-empty for the same reason: it is no longer decoration on a slot
 * that already exists, it is the name the new atlas will be created with.
 *
 * @param {Object} record
 * @param {string} record.name - Atlas name, i.e. the file name minus its extension.
 * @param {ArrayBuffer} record.data - Raw archive bytes.
 * @returns {Promise<void>}
 */
export async function savePendingImport({ name, data }) {
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('savePendingImport: name must be a non-empty string');
    }
    if (!(data instanceof ArrayBuffer)) {
        throw new Error('savePendingImport: data must be an ArrayBuffer');
    }
    await getGlobalStore().setItem(GlobalKey.PENDING_IMPORT, {
        version: PENDING_IMPORT_VERSION,
        name: name.trim(),
        savedAt: Date.now(),
        data
    });
}

/**
 * Takes the pending `.ebgeo`, if there is one, AND REMOVES IT EITHER WAY.
 *
 * READ-AND-REMOVE, in that order and unconditionally, is the whole contract. The record lives in
 * the one database no wipe reaches (`GlobalKey.PENDING_IMPORT` says why), so a reader that removed
 * only on success would leave megabytes of a file that failed to parse behind forever, and would
 * retry that same failure on every reload. The consumer therefore gets ONE attempt, which is the
 * right number: the user still has the file on disk.
 *
 * A record of an unknown version, of the wrong shape, or older than `PENDING_IMPORT_MAX_AGE_MS`
 * is dropped and reported as absent rather than repaired.
 *
 * @returns {Promise<{name: string, savedAt: number, data: ArrayBuffer}|null>}
 */
export async function takePendingImport() {
    const globalStore = getGlobalStore();
    const stored = await globalStore.getItem(GlobalKey.PENDING_IMPORT);
    if (stored === null || stored === undefined) return null;

    await globalStore.removeItem(GlobalKey.PENDING_IMPORT);

    if (typeof stored !== 'object'
        || stored.version !== PENDING_IMPORT_VERSION
        // Non-empty, because the consumer creates an atlas WITH this name and `createLocalAtlas`
        // throws on a blank one — a record that cannot name an atlas is not repairable here.
        || typeof stored.name !== 'string'
        || stored.name.length === 0
        || !(stored.data instanceof ArrayBuffer)) {
        return null;
    }
    const savedAt = Number(stored.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > PENDING_IMPORT_MAX_AGE_MS) return null;

    return {
        name: stored.name,
        savedAt,
        data: stored.data
    };
}

/**
 * Drops a hand-over the producer decided not to make after all (the slot it needed was refused).
 * Separate from {@link takePendingImport} because the producer is not consuming anything.
 * @returns {Promise<void>}
 */
export async function clearPendingImport() {
    await getGlobalStore().removeItem(GlobalKey.PENDING_IMPORT);
}

/**
 * Every store holding the DATA of a scope, for derived wipes (the two parallel `clearAll*`
 * lists in `store.js` exist because this list was hand-written twice).
 *
 * THE OUTBOUND QUEUE IS DELIBERATELY ABSENT (`atlasData: false`, Decision 2b). This list is
 * what an atlas WIPE empties, and `openRemoteAtlas` wipes three lines after activating the
 * namespace of the atlas it is opening: a queue in here would be that atlas's own pending
 * work, destroyed immediately before the `connect` that would have drained it. Destroying a
 * namespace is a different list (`clearAtlasDatabases` / `dropAtlasDatabases`), and the queue
 * IS in that one.
 *
 * @param {{ kind: string, dbSuffix: string }} [scope] - Defaults to the active scope.
 * @returns {Array<{ id: string, store: import('localforage').default }>}
 */
export function listAtlasStores(scope = null) {
    return STORE_DESCRIPTORS
        .filter(d => d.perAtlas && d.atlasData)
        .map(d => ({ id: d.id, store: getStoreFor(d.id, scope) }));
}

// ===========================================================================================
// THE PER-TAB MOUNT POINTER (Decision 6)
// ===========================================================================================

/** sessionStorage key holding the scope THIS TAB has mounted. */
export const TAB_MOUNT_KEY = 'ebgeo_tab_mount';

/**
 * Shape version of the stored pointer. A record written by another version reads as ABSENT
 * rather than being coerced: this pointer decides which databases a boot writes to, so guessing
 * at an unknown shape is how a tab silently mounts the wrong atlas.
 */
const TAB_MOUNT_VERSION = 1;

/**
 * @returns {Storage|null} The tab-scoped storage, or null where it does not exist. Null is a
 *   supported answer, not an error: node (the unit suite's runtime) has no `sessionStorage`, and
 *   a browser with storage disabled must still mount an atlas. Without it the boot simply falls
 *   back to the installation-wide pointers, which is where it was before Decision 6.
 */
function tabStorage() {
    try {
        return globalThis.sessionStorage ?? null;
    } catch {
        // Accessing `sessionStorage` THROWS (not returns null) in a cross-origin iframe with
        // storage blocked, so the guard has to be a try, not a truthiness test.
        return null;
    }
}

/**
 * The scope this tab has mounted RIGHT NOW, rebuilt through the scope constructors.
 *
 * REBUILT, NOT READ BACK. `remoteScope(atlasId)` DERIVES the suffix from the id, so a stored
 * `dbSuffix` that disagrees with its id cannot survive the trip; `localScope` re-validates the
 * suffix and still refuses the reserved bare `remote`. Anything that fails to rebuild is
 * reported as no pointer at all, which sends the boot to the fallback instead of to a database
 * nobody registered.
 *
 * FOR A BOOT DECISION USE `bootTabMountPointer()` INSTEAD, never this one. See there.
 *
 * @returns {{ kind: string, atlasId: string, dbSuffix: string }|null}
 */
export function readTabMountPointer() {
    const storage = tabStorage();
    if (!storage) return null;

    let raw = null;
    try {
        raw = storage.getItem(TAB_MOUNT_KEY);
    } catch {
        return null;
    }
    if (typeof raw !== 'string' || raw.length === 0) return null;

    try {
        const stored = JSON.parse(raw);
        if (stored?.version !== TAB_MOUNT_VERSION) return null;
        return stored.kind === StoreScopeKind.REMOTE
            ? remoteScope(stored.atlasId)
            : localScope(stored.atlasId, stored.dbSuffix);
    } catch {
        return null;
    }
}

/**
 * Where this tab was BEFORE this page load mounted anything. `undefined` until captured.
 *
 * A MODULE VARIABLE, unlike the mount lock, and the difference is not an oversight. The lock is a
 * resource of the CLIENT and a second module instance leaking it would strand a namespace
 * forever; this is a memory of ONE page load, and a second instance built mid-session (HMR,
 * `vi.resetModules()`) capturing the live value is exactly right, because by then the boot has
 * already decided. In the suite that is what makes `vi.resetModules()` model a reload.
 * @type {{ kind: string, atlasId: string, dbSuffix: string }|null|undefined}
 */
let _bootPointer;

/**
 * Captures the pre-mount value, once. Called by every reader AND by the writer, and the writer
 * is the reason it exists at all.
 * @returns {void}
 */
function captureBootPointer() {
    if (_bootPointer === undefined) _bootPointer = readTabMountPointer();
}

/**
 * WHERE THIS TAB WAS WHEN THE PAGE LOADED, which is the only version of the question a boot may
 * ask, and it is not the same as the live pointer.
 *
 * MEASURED, NOT ASSUMED: the boot mounts something BEFORE it decides what to mount. The
 * repository bridge (`ensureAtlasScope`, `repositories/local.repository.js`) activates the legacy
 * local scope on the first store access, and the logged-out guard runs store code before
 * `activateBootAtlasScope` on purpose. So by the time the boot asks, the live pointer has already
 * been overwritten with the bridge's fallback, and a boot reading it would answer "this tab was
 * in the legacy local slot" for every tab, every time, including the one that was in a server
 * atlas. Four cases of the integration suite failed exactly this way before the snapshot existed.
 *
 * The snapshot is taken lazily on first use, and the WRITER takes it too, which is what makes the
 * order safe: whichever happens first, a mount performed by this page load can never be mistaken
 * for the memory of the previous one.
 *
 * @returns {{ kind: string, atlasId: string, dbSuffix: string }|null}
 */
export function bootTabMountPointer() {
    captureBootPointer();
    return _bootPointer;
}

/**
 * Records the scope this tab has mounted. Called by `activateScope`, never by a caller that
 * merely intends to mount: an intent that is not a mount is the disagreement this replaces.
 *
 * BEST EFFORT, and deliberately silent on failure. The pointer is an optimisation of the boot
 * (it says which of several equally valid atlases to reopen), so a storage that refuses the
 * write costs the tab its memory of where it was and nothing else. Throwing here would abort a
 * mount that has already succeeded.
 *
 * NOT EXPORTED, and that is the guard: "this tab mounted an atlas" is a fact only a mount may
 * state, so the single caller is `activateScope`, in the same module. An exported writer would be
 * a way to claim a mount that never happened, which is the class of defect this whole pointer
 * exists to remove.
 *
 * @param {{ kind: string, atlasId: string|null, dbSuffix: string }} scope - Scope being mounted.
 * @returns {void}
 */
function writeTabMountPointer(scope) {
    captureBootPointer();
    const storage = tabStorage();
    if (!storage) return;
    try {
        storage.setItem(TAB_MOUNT_KEY, JSON.stringify({
            version: TAB_MOUNT_VERSION,
            kind: scope.kind,
            atlasId: scope.atlasId ?? null,
            dbSuffix: scope.dbSuffix
        }));
    } catch {
        // Quota, private mode, storage disabled mid-session: see above.
    }
}

/**
 * Forgets where this tab is, live pointer and boot memory alike. Called when the scope is
 * DESTROYED: a boot that reopened it would recreate the databases of a namespace the registry
 * no longer names. NOT EXPORTED for the same reason as the writer: its one caller is
 * `clearActiveScope`, and disowning a SERVER namespace from outside this module is
 * `forgetRemoteTabMount`, which says exactly what it will and will not forget.
 * @returns {void}
 */
function clearTabMountPointer() {
    captureBootPointer();
    _bootPointer = null;

    const storage = tabStorage();
    if (!storage) return;
    try {
        storage.removeItem(TAB_MOUNT_KEY);
    } catch {
        // See `writeTabMountPointer`.
    }
}

/**
 * Forgets a tab mount that names a SERVER namespace, and only that.
 *
 * The caller is `markStoreLocal`, i.e. somebody saying "this tab is done with that server
 * atlas": a failed connect, an atlas deleted on the server, the logged-out guard, the rescue.
 * Leaving the pointer in place would make the next F5 remount the very atlas just disowned, and
 * on the failed-connect path that is the endless retry of a dead atlas the durable marker was
 * flipped to LOCAL to prevent.
 *
 * IT CHECKS BOTH THE LIVE POINTER AND THE BOOT MEMORY, because during a boot they legitimately
 * differ: the bridge may already have written a LOCAL live pointer over a REMOTE memory, and it
 * is the memory that the mount decision three lines later is going to read.
 *
 * A LOCAL pointer is left alone even when its suffix is `remote-<id>`: that is a slot the rescue
 * adopted, its data is local, and forgetting it would send the next boot somewhere else while
 * the rescued work sits unopened.
 *
 * @returns {boolean} True when something was forgotten.
 */
export function forgetRemoteTabMount() {
    captureBootPointer();
    const bootIsRemote = _bootPointer?.kind === StoreScopeKind.REMOTE;
    const liveIsRemote = readTabMountPointer()?.kind === StoreScopeKind.REMOTE;
    if (!bootIsRemote && !liveIsRemote) return false;

    if (bootIsRemote) _bootPointer = null;
    if (liveIsRemote) {
        const storage = tabStorage();
        try {
            storage?.removeItem(TAB_MOUNT_KEY);
        } catch {
            // See `writeTabMountPointer`.
        }
    }
    return true;
}

/**
 * Points every subsequent `getStore()` at a scope, and takes the shared MOUNT LOCK that tells
 * every other client "somebody is alive in these databases" (Decision 5). Switching scopes
 * releases the previous lock, because a client mounts one atlas at a time.
 * @param {{ kind: string, atlasId: string|null, dbSuffix: string }} scope
 * @returns {void}
 */
export function activateScope(scope) {
    if (!scope || typeof scope.dbSuffix !== 'string' || !scope.kind) {
        throw new Error('activateScope: expected a scope built by localScope()/remoteScope()');
    }
    _activeScope = scope;
    // The per-tab pointer is written BY THE MOUNT (Decision 6), never by whoever remembered to
    // update it: a caller that mounts and forgets is the defect this removes, and it is the same
    // shape of defect as declaring an origin without activating a namespace.
    writeTabMountPointer(scope);
    acquireMountLock(scope);
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
 *
 * The mount lock goes with it: nothing is mounted any more, so no other client should be told
 * otherwise. The release is not awaited here (this function is synchronous and its callers
 * depend on that); a destroyer that needs the release to have LANDED calls `releaseMountLock`
 * and awaits it, which is what `purgeAllRemoteAtlases` does before asking for the exclusive.
 *
 * The per-tab pointer goes with it too, and for the same reason the lock does: this scope was
 * just destroyed, so a boot that reopened it would recreate the databases of a namespace the
 * registry no longer names.
 * @returns {void}
 */
export function clearActiveScope() {
    _activeScope = null;
    clearTabMountPointer();
    releaseMountLock().catch(() => undefined);
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

// ===========================================================================================
// MOUNT LOCKS (Decision 5)
// ===========================================================================================

/**
 * Prefix of every mount-lock name. The suffix is appended after a `#`, which cannot appear in
 * a `dbSuffix` (`VALID_SUFFIX`), so the mapping suffix -> name is injective and the LEGACY
 * empty suffix gets a name of its own instead of colliding with a slot called "legacy".
 */
const MOUNT_LOCK_PREFIX = 'ebgeo-atlas:';

/**
 * @param {string} dbSuffix - Database suffix of a scope.
 * @returns {string} Name of the Web Lock that means "a live client has this mounted".
 */
export function atlasMountLockName(dbSuffix) {
    return `${MOUNT_LOCK_PREFIX}#${dbSuffix}`;
}

/**
 * @returns {LockManager|null} The lock manager, or null where it does not exist (a NON-SECURE
 *   context, i.e. plain HTTP). Null is a supported answer, not an error: see Decision 5.
 */
function lockManager() {
    return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

/**
 * @returns {boolean} Whether this runtime can arbitrate mounts at all. Exported so a caller
 *   (and a test) can state which of the two regimes it is in, instead of inferring it.
 */
export function hasMountLockSupport() {
    return lockManager() !== null;
}

/**
 * Where the single mount lock of this CLIENT is remembered. On `globalThis`, not in a module
 * variable, and the reason is in Decision 5: a second instance of this module inside the same
 * client (HMR, `vi.resetModules()`) would otherwise leak the first one's lock forever.
 */
const MOUNT_LOCK_HOLDER = Symbol.for('ebgeo.store.atlasMountLock');

/** @returns {{ name: string, release: () => void, settled: Promise<*> }|null} */
function heldMountLock() {
    return globalThis[MOUNT_LOCK_HOLDER] ?? null;
}

/**
 * @param {{ name: string, release: () => void, settled: Promise<*> }|null} held
 * @returns {void}
 */
function setHeldMountLock(held) {
    globalThis[MOUNT_LOCK_HOLDER] = held;
}

/**
 * Releases the mount lock this client holds, if any.
 *
 * @param {{ dbSuffix: string }} [scope] - Release ONLY when the held lock is this scope's.
 * @returns {Promise<boolean>} True when a lock was actually released. It awaits the request
 *   promise, which is what makes a subsequent `exclusive ifAvailable` on the same name
 *   deterministic (measured 200/200) instead of a race with the lock queue.
 */
export async function releaseMountLock(scope = null) {
    const held = heldMountLock();
    if (!held) return false;
    if (scope && held.name !== atlasMountLockName(scope.dbSuffix)) return false;

    setHeldMountLock(null);
    held.release();
    await held.settled;
    return true;
}

/**
 * Releases the mount lock when it names a REMOTE namespace, whatever the active scope says.
 *
 * IT DOES NOT CONSULT `_activeScope` ON PURPOSE. The caller is the logged-out sweep, and the
 * fact it needs is "does THIS client still claim a server namespace", which outlives the module
 * instance that activated it. Reading the active scope instead would leave a lock held by a
 * discarded instance in place, and a namespace nobody can destroy is the exact residue the
 * remote registry exists to prevent.
 *
 * @returns {Promise<boolean>} True when a remote mount lock was released.
 */
export async function releaseRemoteMountLock() {
    const held = heldMountLock();
    if (!held || !held.name.startsWith(MOUNT_LOCK_PREFIX)) return false;
    const dbSuffix = held.name.slice(MOUNT_LOCK_PREFIX.length + 1);
    if (!isRemoteDbSuffix(dbSuffix)) return false;
    return releaseMountLock();
}

/**
 * Takes the shared mount lock of a scope. Fire and forget by design: `activateScope` is
 * synchronous and every caller of `getStore()` depends on that, while a shared lock is
 * advisory. The grant still orders correctly against a later `exclusive ifAvailable` (measured:
 * the exclusive is refused 200/200 even when the shared request has not been granted yet),
 * because the lock queue is FIFO per name.
 *
 * @param {{ dbSuffix: string }} scope - Scope being mounted.
 * @returns {void}
 */
function acquireMountLock(scope) {
    const manager = lockManager();
    if (!manager) return;

    const name = atlasMountLockName(scope.dbSuffix);
    const held = heldMountLock();
    if (held?.name === name) return;

    // A switch of scope IS an unmount of the previous one: this client no longer has it.
    releaseMountLock().catch(() => undefined);

    try {
        let release;
        const untilUnmount = new Promise(resolve => { release = resolve; });
        const settled = manager
            .request(name, { mode: 'shared' }, () => untilUnmount)
            .catch(() => undefined);
        setHeldMountLock({ name, release, settled });
    } catch {
        // No lock is a degraded mode, never a failed mount: the store must keep working on a
        // runtime that refuses the request, and the purge then destroys instead of sparing.
        setHeldMountLock(null);
    }
}

/**
 * Runs `task` only if NO live client has the scope mounted.
 *
 * @param {{ dbSuffix: string }} scope - Scope about to be destroyed.
 * @param {() => Promise<*>} task - The destruction, run while the exclusive lock is held.
 * @returns {Promise<{ granted: boolean, result: * }>} `granted:false` means somebody has it
 *   mounted and NOTHING ran. Without a lock manager (non-secure context) it is always granted:
 *   the hard invariant wins over sparing (Decision 5).
 */
export async function withExclusiveAtlasLock(scope, task) {
    const manager = lockManager();
    if (!manager) {
        return { granted: true, result: await task() };
    }
    return manager.request(
        atlasMountLockName(scope.dbSuffix),
        { mode: 'exclusive', ifAvailable: true },
        async lock => (lock === null
            ? { granted: false, result: null }
            : { granted: true, result: await task() })
    );
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
 * IT SEPARATES "I EMPTIED IT" FROM "I OPENED AN EMPTY ONE" (P3, the defect this used to have).
 * `clear()` goes through localforage's `ready()`, which OPENS the database, and opening a name
 * that does not exist CREATES it. So emptying a scope that was never written manufactured its
 * ten databases and reported all ten as `cleared`, and `purgeReachedAtlas` then answered true
 * for an atlas that had never been there, which makes the boot guard SKIP the wipe of the atlas
 * that really is mounted. A destroyer that fabricates what it claims to destroy is a verifier
 * that lies.
 *
 * THE SIGNAL IS THE STORE'S OWN KEYS, and that is the whole point of the choice. The previous
 * attempt asked `indexedDB.databases()` and was reverted: it is a DIFFERENT source of truth from
 * the localforage double the unit suites install, so the two disagreed and six suites went red
 * for a reason that had nothing to do with the app. `keys()` travels the SAME handle as the
 * write, so anything that can answer `getItem` answers this too, real driver or double.
 *
 * WHAT IT STILL DOES NOT DO: it cannot avoid CREATING the shell, because reading the keys opens
 * the database just as clearing it does, and the only API that answers without opening is the
 * one that was rejected above. The shell is transient in the one path that matters (the purge
 * deletes it immediately afterwards); what is fixed here is the REPORT, which is what every
 * decision downstream is derived from.
 *
 * IT COVERS THE OUTBOUND QUEUE TOO, unlike the atlas wipe (`listAtlasStores`). This is
 * destruction, and an operation carries the entity payload it describes: a queue left standing
 * after its server atlas was destroyed is readable server data surviving a logout.
 *
 * @param {{ kind: string, dbSuffix: string }} scope - Scope to empty.
 * @returns {Promise<{ names: string[], cleared: string[] }>} `names` is every per-atlas database
 *   of the scope (the ten data ones plus the queue), in descriptor order; `cleared` is the subset
 *   that actually HELD DATA and was emptied. An empty `cleared` means there was nothing there to
 *   destroy.
 */
export async function clearAtlasDatabases(scope) {
    if (!scope || typeof scope.dbSuffix !== 'string') {
        throw new Error('clearAtlasDatabases: expected a scope built by localScope()/remoteScope()');
    }
    const names = [];
    const cleared = [];
    for (const descriptor of STORE_DESCRIPTORS) {
        if (!descriptor.perAtlas) continue;
        const store = getStoreFor(descriptor.id, scope);
        const name = resolveDbName(descriptor.id, scope);
        names.push(name);

        const keys = await store.keys();
        if (keys.length === 0) continue;
        await store.clear();
        cleared.push(name);
    }
    return { names, cleared };
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
 * The deletes run in PARALLEL so the worst case is one timeout, not eleven.
 *
 * ELEVEN, not ten: the outbound queue of the scope goes with it, for the reason spelled out in
 * `clearAtlasDatabases`. Deleting the ten data databases and leaving `ebgeo__<suffix>` standing
 * would leave the entity payloads of that atlas on disk under a name nothing else ever opens.
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

/**
 * Copia TODOS os bancos de dados de um atlas para outro, chave por chave.
 *
 * É A OPERAÇÃO QUE "FAZER UMA CÓPIA" DE UM ATLAS LOCAL PRECISA, e a alternativa tentada antes
 * mostra por que ela existe: um round-trip de `.ebgeo` (exportar em memória, criar o slot,
 * importar) reusa código pronto, mas arrasta tudo o que o import carrega — um `clearAllDataStore`
 * que deixa um mapa "Principal" vazio ao lado do importado, a memória do app apontando para o
 * atlas anterior, e a necessidade de recarregar a página para desfazer os dois. Copiar os bancos
 * não interpreta nada: o que estava lá passa a estar aqui, com as mesmas chaves e os mesmos ids.
 *
 * SÓ OS BANCOS DE DADO DO ATLAS (`atlasData: true`), que é o mesmo conjunto que o wipe de entrada
 * alcança. A fila de saída fica de fora de propósito: ela é por atlas mas NÃO é dado do atlas, e
 * copiar operações pendentes faria a cópia tentar sincronizar como se fosse o original.
 *
 * O DESTINO É PRESUMIDO VAZIO (um slot recém-criado). A cópia não apaga o que houver lá antes:
 * escrever por cima chave a chave é o que preserva a semântica de "cópia" mesmo se o chamador
 * errar, em vez de destruir dado alheio por conta de um argumento trocado.
 *
 * @param {StoreScope} from - Escopo de origem.
 * @param {StoreScope} to - Escopo de destino.
 * @returns {Promise<{stores: number, keys: number}>} Quanto foi copiado — o chamador usa isso para
 *   não anunciar sucesso sobre uma cópia que não moveu nada.
 */
export async function copyAtlasDatabases(from, to) {
    if (!from || !to) throw new Error('copyAtlasDatabases: both scopes are required');
    if (scopeKey(from) === scopeKey(to)) {
        throw new Error('copyAtlasDatabases: source and destination are the same namespace');
    }

    let keys = 0;
    const descriptors = STORE_DESCRIPTORS.filter(d => d.perAtlas && d.atlasData);
    for (const descriptor of descriptors) {
        const origem = getStoreFor(descriptor.id, from);
        const destino = getStoreFor(descriptor.id, to);
        // `iterate` em vez de `keys()` + `getItem`: uma passada só por banco, e o localforage já
        // devolve o valor desserializado (Blob de imagem incluso).
        const pares = [];
        await origem.iterate((value, key) => { pares.push([key, value]); });
        for (const [key, value] of pares) {
            await destino.setItem(key, value);
            keys += 1;
        }
    }
    return { stores: descriptors.length, keys };
}

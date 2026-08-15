// Path: tests/helpers/atlas-registry-disk.js

/**
 * @fileoverview One answer to "which atlas slots exist ON DISK", for every test that used to
 * know the registry layout by heart.
 *
 * WHY THIS FILE EXISTS. The local registry stopped being one array under `local_atlases` and
 * became ONE KEY PER SLOT (`local_atlas:<id>`), because the old shape was a read-modify-write
 * between tabs that silently dropped entries. That change broke 31 tests and NOT ONE of them
 * by a bug in the code: they all read the layout straight out of the fake disk. They were
 * patched with a private reader copied into each file (`lerRegistroLocal`,
 * `lerRegistroLocalFixture`, and inline `startsWith('local_atlas:')` loops), which leaves the
 * coupling exactly where it was, only now spread over more files that will drift apart.
 *
 * WHY IT DOES NOT CALL `readLocalAtlasRegistry`. There IS a production reader for this
 * (`src/js/store/atlas-namespace.js`), and delegating to it would be the obvious move. It
 * would also stop being an instrument: a bug inside that function would be invisible, because
 * subject and measurement would agree BY CONSTRUCTION. So this file reads the RAW KEYS of the
 * fake global database and re-implements nothing else. The literal key names below are a
 * SECOND, independent statement of the disk contract; the test that pins them against
 * `GlobalKey` (in `tests/unit/atlas-namespace.test.js`) is what makes a drift between the two
 * statements fail loudly instead of quietly.
 *
 * WHY IT IS NOT MERGED WITH THE LEGACY ARRAY. `readLocalAtlasRegistry` deliberately reports
 * both shapes as one list, because production must not lose a slot from an installation that
 * has not booted since the change. A test instrument that did the same could not tell
 * "migrated" from "not migrated yet", which is precisely the property the migration tests
 * measure. Here the two shapes are two separate readings, and the caller says which one it
 * means.
 *
 * SOURCE OF THE ENTRIES. Every namespace suite installs its own `localforage` double backed
 * by a `Map` keyed by database name, so the source is passed in rather than reached for: a
 * helper that guessed at one file's fake would be a third coupling. Pass the `Map` of the
 * global database, a plain object, any iterable of `[key, value]`, or a store handle (via
 * `entriesFromStore`).
 */

/** Prefix of a local slot's registry key. One key per slot, never one array. */
export const LOCAL_ATLAS_KEY_PREFIX = 'local_atlas:';

/** Prefix of a remote atlas's registry key. */
export const REMOTE_ATLAS_KEY_PREFIX = 'remote_atlas:';

/** LEGACY key: the whole local registry as one array under one key. */
export const LEGACY_LOCAL_REGISTRY_KEY = 'local_atlases';

/** Key of the pointer to the local slot the next boot opens. */
export const CURRENT_LOCAL_ATLAS_KEY = 'current_local_atlas';

/**
 * @param {string} id - Local atlas id.
 * @returns {string} The disk key that slot's entry lives under.
 */
export function localAtlasDiskKey(id) {
    return `${LOCAL_ATLAS_KEY_PREFIX}${id}`;
}

/**
 * @param {string} atlasId - Server atlas id.
 * @returns {string} The disk key that atlas's registry entry lives under.
 */
export function remoteAtlasDiskKey(atlasId) {
    return `${REMOTE_ATLAS_KEY_PREFIX}${atlasId}`;
}

/**
 * Normalises the several shapes a fake global database comes in.
 * @param {Map<string, *>|Object<string, *>|Iterable<[string, *]>|null|undefined} source
 * @returns {Array<[string, *]>} Key/value pairs, empty when the database does not exist.
 */
function pairsOf(source) {
    if (!source) return [];
    if (source instanceof Map) return [...source.entries()];
    if (typeof source[Symbol.iterator] === 'function') return [...source];
    return Object.entries(source);
}

/**
 * Reads every key/value of a store handle into the shape the readers below take.
 *
 * Uses only `keys()` and `getItem()`, which every double in the suite implements, and never
 * `readLocalAtlasRegistry`: the point is to reach the disk by a path the subject does not own.
 *
 * @param {{keys: () => Promise<string[]>, getItem: (k: string) => Promise<*>}} store
 * @returns {Promise<Map<string, *>>}
 */
export async function entriesFromStore(store) {
    const out = new Map();
    for (const key of await store.keys()) out.set(key, await store.getItem(key));
    return out;
}

/**
 * Every local slot recorded in the CURRENT shape, oldest first.
 *
 * The id comes from the KEY, exactly as production insists it must: a value that failed to
 * parse still has to leave the slot enumerable, otherwise a corrupted record hides ten
 * databases from every purge.
 *
 * @param {Map<string, *>|Object<string, *>|Iterable<[string, *]>|null|undefined} source -
 *   Contents of the global database.
 * @returns {Array<{id: string, name?: string, dbSuffix?: string, createdAt?: number}>}
 */
export function localSlotsOnDisk(source) {
    return pairsOf(source)
        .filter(([key]) => typeof key === 'string' && key.startsWith(LOCAL_ATLAS_KEY_PREFIX))
        .map(([key, value]) => ({
            ...(value && typeof value === 'object' ? value : {}),
            id: key.slice(LOCAL_ATLAS_KEY_PREFIX.length)
        }))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id));
}

/**
 * Every remote atlas recorded on disk, by the same rule (identity in the key).
 * @param {Map<string, *>|Object<string, *>|Iterable<[string, *]>|null|undefined} source
 * @returns {Array<{atlasId: string, dbSuffix?: string}>}
 */
export function remoteAtlasesOnDisk(source) {
    return pairsOf(source)
        .filter(([key]) => typeof key === 'string' && key.startsWith(REMOTE_ATLAS_KEY_PREFIX))
        .map(([key, value]) => ({
            ...(value && typeof value === 'object' ? value : {}),
            atlasId: key.slice(REMOTE_ATLAS_KEY_PREFIX.length)
        }))
        .sort((a, b) => a.atlasId.localeCompare(b.atlasId));
}

/**
 * The LEGACY array, read on purpose as a separate fact: "the old key is gone" and "the slots
 * are there" are two assertions, and a reader that merged them could not tell them apart.
 * @param {Map<string, *>|Object<string, *>|Iterable<[string, *]>|null|undefined} source
 * @returns {*} The stored value, or null when the key is absent.
 */
export function legacyLocalRegistryOnDisk(source) {
    const found = pairsOf(source).find(([key]) => key === LEGACY_LOCAL_REGISTRY_KEY);
    return found ? found[1] : null;
}

/**
 * @param {Map<string, *>|Object<string, *>|Iterable<[string, *]>|null|undefined} source
 * @returns {string|null} Id of the slot the next boot opens, or null.
 */
export function currentLocalAtlasOnDisk(source) {
    const found = pairsOf(source).find(([key]) => key === CURRENT_LOCAL_ATLAS_KEY);
    return found ? (found[1] ?? null) : null;
}

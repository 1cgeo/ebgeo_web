// Path: tests/helpers/idb-helpers.js

/**
 * @fileoverview The minimum every namespace harness needs from a REAL IndexedDB: seed a
 * database by ABSOLUTE name, read one back, list what exists, and reset between tests.
 *
 * It is deliberately dumb about names. Nothing here rebuilds `ebgeo_maps__remote-<id>`:
 * that belongs to `resolveDbName()` in `src/js/store/atlas-namespace.js`, and a second
 * implementation of the naming rule inside the test helpers would be a copy that drifts and
 * then certifies the drift. Callers import the real one and pass the string it returns.
 *
 * THE ONE TRAP THIS FILE EXISTS TO CLOSE. Opening a database CREATES it, in raw IndexedDB
 * and in localforage alike. So the obvious "read it and see if it is empty" fabricates the
 * very database it was asked about, and every gate that needs to tell an ABSENT namespace
 * from an EMPTY one gets the same answer for both. (This is not hypothetical: the plan
 * records `clearAtlasDatabases` calling `getStoreFor().clear()` and thereby manufacturing
 * ten empty databases while reporting them as destroyed.) Everything below therefore asks
 * `indexedDB.databases()` FIRST and never opens a name that is not already there, and
 * `databaseState()` returns the three-way answer instead of a boolean.
 *
 * Values are written and read through localforage, with the same options the store uses, so
 * a database seeded here is byte-for-byte one the app can read. The instances are built per
 * call and never cached: a handle cached across a reset is how a test ends up reading the
 * previous test's namespace.
 */

import localforage from 'localforage';

/** localforage's default object store name (its `storeName` default). */
export const DEFAULT_STORE_NAME = 'keyvaluepairs';

/**
 * Fails loudly when the setup file did not run, instead of letting the caller get a
 * localforage that quietly resolved to no driver.
 * @returns {IDBFactory} The global factory.
 */
function requireIndexedDB() {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
        throw new Error(
            'idb-helpers: no global indexedDB. `tests/setup/indexeddb.setup.js` must run ' +
            '(it is wired as a vitest setupFile); a test that reaches here would be ' +
            'measuring a fallback driver, not IndexedDB.'
        );
    }
    return indexedDB;
}

/**
 * Builds an uncached localforage instance for one absolute database name.
 * @param {string} dbName - Absolute IndexedDB database name.
 * @param {Object} [options]
 * @param {string} [options.storeName] - Object store inside the database.
 * @returns {import('localforage').default} localforage instance.
 */
export function storeAt(dbName, { storeName } = {}) {
    requireIndexedDB();
    const config = { name: dbName, driver: localforage.INDEXEDDB };
    if (storeName) config.storeName = storeName;
    return localforage.createInstance(config);
}

/**
 * Asserts that a localforage instance really resolved to the IndexedDB driver.
 *
 * This is the point where the instrument can lie: localforage falls back to localStorage or
 * to its in-memory driver without raising, and every test written on top of the fallback
 * passes without touching IndexedDB at all. Call it once wherever it matters.
 *
 * @param {import('localforage').default} store - A localforage instance.
 * @returns {Promise<string>} The active driver name (`localforage.INDEXEDDB`).
 */
export async function assertIndexedDbDriver(store) {
    await store.ready();
    const driver = store.driver();
    if (driver !== localforage.INDEXEDDB) {
        throw new Error(
            `idb-helpers: localforage resolved to driver "${driver}", not IndexedDB ` +
            `("${localforage.INDEXEDDB}"). Every assertion built on this instance would be ` +
            'about a fallback store.'
        );
    }
    return driver;
}

/**
 * @returns {Promise<string[]>} Names of every existing database, sorted. Never creates one.
 */
export async function listDatabases() {
    const factory = requireIndexedDB();
    const entries = await factory.databases();
    return entries.map(entry => entry.name).sort();
}

/**
 * @param {string} dbName - Absolute database name.
 * @returns {Promise<boolean>} True when the database exists on disk. Never creates it.
 */
export async function databaseExists(dbName) {
    return (await listDatabases()).includes(dbName);
}

/**
 * Writes entries into a database by absolute name, creating it.
 * @param {string} dbName - Absolute database name.
 * @param {Object<string, *>} entries - Key/value pairs to write.
 * @param {Object} [options]
 * @param {string} [options.storeName] - Object store inside the database.
 * @returns {Promise<void>}
 */
export async function seedDatabase(dbName, entries, { storeName } = {}) {
    const store = storeAt(dbName, { storeName });
    await assertIndexedDbDriver(store);
    for (const [key, value] of Object.entries(entries)) {
        await store.setItem(key, value);
    }
}

/**
 * Reads every key/value of a database WITHOUT creating it.
 * @param {string} dbName - Absolute database name.
 * @param {Object} [options]
 * @param {string} [options.storeName] - Object store inside the database.
 * @returns {Promise<Object<string, *>|null>} The contents, or null when the database does
 *   not exist. `{}` (existing but empty) and `null` (absent) are different answers on
 *   purpose.
 */
export async function readDatabase(dbName, { storeName } = {}) {
    if (!(await databaseExists(dbName))) return null;
    const store = storeAt(dbName, { storeName });
    await assertIndexedDbDriver(store);
    const contents = {};
    await store.iterate((value, key) => {
        contents[key] = value;
    });
    return contents;
}

/**
 * Reads one key WITHOUT creating the database.
 * @param {string} dbName - Absolute database name.
 * @param {string} key - Key to read.
 * @param {Object} [options]
 * @param {string} [options.storeName] - Object store inside the database.
 * @returns {Promise<*>} The value, or null when the key or the database is absent.
 */
export async function readKey(dbName, key, { storeName } = {}) {
    if (!(await databaseExists(dbName))) return null;
    return storeAt(dbName, { storeName }).getItem(key);
}

/**
 * The three-way answer several gates need: a namespace that was never created and a
 * namespace that was emptied are different facts, and a boolean cannot say which.
 * @param {string} dbName - Absolute database name.
 * @param {Object} [options]
 * @param {string} [options.storeName] - Object store inside the database.
 * @returns {Promise<'absent'|'empty'|'populated'>}
 */
export async function databaseState(dbName, { storeName } = {}) {
    if (!(await databaseExists(dbName))) return 'absent';
    const store = storeAt(dbName, { storeName });
    await assertIndexedDbDriver(store);
    return (await store.length()) > 0 ? 'populated' : 'empty';
}

/**
 * @param {string} dbName - Absolute database name.
 * @param {Object} [options]
 * @param {string} [options.storeName] - Object store inside the database.
 * @returns {Promise<number|null>} Number of stored keys, or null when the database is absent.
 */
export async function countKeys(dbName, { storeName } = {}) {
    if (!(await databaseExists(dbName))) return null;
    return storeAt(dbName, { storeName }).length();
}

/**
 * Deletes a single database by absolute name, bounded so a held connection reports instead
 * of hanging.
 * @param {string} dbName - Absolute database name.
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=1000] - Upper bound on the wait.
 * @returns {Promise<{ deleted: boolean, blocked: boolean }>} Whether the delete confirmed,
 *   and whether the `blocked` event fired at any point.
 */
export function deleteDatabase(dbName, { timeoutMs = 1000 } = {}) {
    const factory = requireIndexedDB();
    return new Promise(resolve => {
        let blocked = false;
        let settled = false;
        const finish = deleted => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ deleted, blocked });
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        const request = factory.deleteDatabase(dbName);
        request.onblocked = () => { blocked = true; };
        request.onsuccess = () => finish(true);
        request.onerror = () => finish(false);
    });
}

/**
 * Empties the whole fake IndexedDB between tests.
 *
 * It deletes every database from the SAME factory object instead of swapping
 * `globalThis.indexedDB` for a fresh one. Swapping is tempting and wrong: localforage
 * captures the factory once at module load, so after a swap the app under test would keep
 * writing to the discarded factory while the helpers inspected the new one, and every
 * assertion would be about a database nobody wrote to.
 *
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=1000] - Upper bound on each delete.
 * @returns {Promise<{ deleted: string[], blocked: string[] }>} What went and what refused.
 */
export async function resetIndexedDB({ timeoutMs = 1000 } = {}) {
    const names = await listDatabases();
    const deleted = [];
    const blocked = [];
    for (const name of names) {
        const result = await deleteDatabase(name, { timeoutMs });
        (result.deleted ? deleted : blocked).push(name);
    }
    return { deleted, blocked };
}

/**
 * Holds a raw connection open, the way another TAB would.
 *
 * `withVersionChangeValve` picks which kind of holder is being modelled, and the choice is
 * the whole experiment in Decision 4:
 *   - `true` reproduces what localforage installs on every connection it opens
 *     (`db.onversionchange = e => e.target.close()`, `node_modules/localforage/dist/localforage.js`),
 *     i.e. an ordinary, responsive EBGeo tab;
 *   - `false` models a tab that never answers `versionchange` (frozen, throttled, or code
 *     that simply does not listen), which is the only holder that can keep a delete pending.
 *
 * @param {string} dbName - Absolute database name.
 * @param {Object} [options]
 * @param {boolean} [options.withVersionChangeValve=true] - Install localforage's valve.
 * @param {string} [options.storeName='holder'] - Object store to create on first open.
 * @returns {Promise<{ db: IDBDatabase, close: () => void, closedByVersionChange: () => boolean }>}
 */
export function holdDatabaseOpen(dbName, {
    withVersionChangeValve = true,
    storeName = 'holder'
} = {}) {
    const factory = requireIndexedDB();
    return new Promise((resolve, reject) => {
        const request = factory.open(dbName);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            let closedByVersionChange = false;
            if (withVersionChangeValve) {
                db.onversionchange = () => {
                    closedByVersionChange = true;
                    db.close();
                };
            }
            resolve({
                db,
                close: () => db.close(),
                closedByVersionChange: () => closedByVersionChange
            });
        };
    });
}

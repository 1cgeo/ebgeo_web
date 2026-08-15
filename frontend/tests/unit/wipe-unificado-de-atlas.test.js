// Path: tests/unit/wipe-unificado-de-atlas.test.js

/**
 * @fileoverview The wipe of the mounted atlas, pinned end to end.
 *
 * `store.js` used to carry TWO hand-written lists of the same ten databases: one in the
 * logged-out boot guard (`enforceLocalStoreWhenLoggedOut`) and one in `clearAllDataStore`.
 * Nothing forced them to agree, so a side-store added to one and forgotten in the other
 * would leave server data behind on exactly one of the two paths, silently. Both now route
 * through a single derived wipe (`clearAllAtlasStores` -> `listAtlasStores()`).
 *
 * WHAT WOULD THIS GREEN PROVE IF THE CODE WERE WRONG: each test seeds a sentinel key into
 * every per-atlas database and requires it to be GONE afterwards, so a database left out of
 * the wipe keeps its sentinel and fails by name. Deriving the expectation from the same
 * list the code derives from would pass with an empty list, so the ten names are written
 * out ABSOLUTELY here and the factory's descriptors are checked against that literal.
 *
 * It also pins the distinction the phase must not lose: unmounting an atlas EMPTIES its
 * databases (`clear`) and never DELETES them (`dropInstance`), which is a separate
 * operation owned by the deletion of a named local atlas.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// A fake IndexedDB keyed by (database name, object store), so the test can see WHICH
// database each call reached. It survives `vi.resetModules()` on purpose: that is what
// makes it behave like a disk across a simulated reload.
// ============================================================================

const { databases, dropped, storeOf, seed, readKey, resetDisk } = vi.hoisted(() => {
    const databases = new Map();
    const dropped = [];

    function keyOf(name, storeName) {
        return `${name}::${storeName || 'keyvaluepairs'}`;
    }

    function backingOf(name, storeName = null) {
        const key = keyOf(name, storeName);
        if (!databases.has(key)) databases.set(key, new Map());
        return databases.get(key);
    }

    function storeOf({ name, storeName = null }) {
        const backing = backingOf(name, storeName);
        return {
            __dbName: name,
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            length: vi.fn(async () => backing.size),
            clear: vi.fn(async () => { backing.clear(); }),
            iterate: vi.fn(async (callback) => {
                for (const [k, v] of backing.entries()) callback(v, k);
            })
        };
    }

    return {
        databases,
        dropped,
        storeOf,
        seed: (name, key, value, storeName = null) => backingOf(name, storeName).set(key, value),
        readKey: (name, key, storeName = null) => backingOf(name, storeName).get(key) ?? null,
        resetDisk: () => { databases.clear(); dropped.length = 0; }
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(storeOf),
        dropInstance: vi.fn(async ({ name }) => { dropped.push(name); })
    }
}));

// ============================================================================
// The ten per-atlas databases, written out instead of derived from the module under test.
// ============================================================================

const ATLAS_DATABASES = [
    'ebgeo_atlas',
    'ebgeo_maps',
    'ebgeo_images',
    'ebgeo_app_settings',
    'ebgeo_groups',
    'ebgeo_layers',
    'ebgeo_cesium3d',
    'ebgeo_streetview360',
    'ebgeo_briefings',
    'ebgeo_comments'
];

/** The databases that belong to the INSTALLATION and must survive a wipe of the atlas. */
const GLOBAL_DATABASE = 'ebgeo_global';

const SENTINEL = '__sentinela_do_teste__';

/** Seeds the sentinel into every per-atlas database plus the global one. */
function seedSentinels() {
    for (const name of ATLAS_DATABASES) seed(name, SENTINEL, { alvo: name });
    seed(GLOBAL_DATABASE, SENTINEL, { alvo: GLOBAL_DATABASE });
}

/** @returns {string[]} Names of the per-atlas databases that still hold the sentinel. */
function databasesStillHoldingSentinel() {
    return ATLAS_DATABASES.filter(name => readKey(name, SENTINEL) !== null);
}

/**
 * A store facade on a fresh module graph. `initServices()` is the real boot wiring (it
 * calls `initStoreEvents` itself), so the paths under test run against the real managers
 * rather than against stubs that could hide a missing store.
 * @returns {Promise<{ store: Object, services: Object }>}
 */
async function loadStoreFacade() {
    vi.resetModules();
    const { initServices } = await import('@store/services.js');
    const services = initServices();
    const store = await import('@store/store.js');
    return { store, services };
}

beforeEach(() => {
    resetDisk();
    vi.clearAllMocks();
});

// ============================================================================
// The derived list
// ============================================================================

describe('a lista de bases do atlas', () => {
    it('tem exatamente estas dez bases marcadas como por atlas', async () => {
        const { STORE_DESCRIPTORS } = await import('@store/atlas-namespace.js');
        const perAtlas = STORE_DESCRIPTORS.filter(d => d.perAtlas).map(d => d.dbName);

        expect(perAtlas).toHaveLength(10);
        expect(perAtlas).toEqual(ATLAS_DATABASES);
    });

    it('deixa de fora as duas bases da instalação, que nenhum wipe de atlas pode tocar', async () => {
        const { STORE_DESCRIPTORS } = await import('@store/atlas-namespace.js');
        const globals = STORE_DESCRIPTORS.filter(d => !d.perAtlas).map(d => d.dbName);

        expect(globals).toHaveLength(2);
        expect(globals).toEqual(['ebgeo', GLOBAL_DATABASE]);
    });
});

// ============================================================================
// Path 1: "limpar todos os dados" / troca de atlas
// ============================================================================

describe('clearAllDataStore', () => {
    it('esvazia TODAS as dez bases do atlas montado', async () => {
        const { store } = await loadStoreFacade();
        seedSentinels();

        await store.clearAllDataStore();

        expect(databasesStillHoldingSentinel()).toEqual([]);
    });

    it('não toca na base global da instalação', async () => {
        const { store } = await loadStoreFacade();
        seedSentinels();

        await store.clearAllDataStore();

        expect(readKey(GLOBAL_DATABASE, SENTINEL)).toEqual({ alvo: GLOBAL_DATABASE });
    });

    it('esvazia a fila de saída, que é global e sobreviveria à troca de atlas', async () => {
        const { store } = await loadStoreFacade();
        seed('ebgeo', 'op_teste', { id: 'op_teste' }, 'operation_queue');

        await store.clearAllDataStore();

        expect(readKey('ebgeo', 'op_teste', 'operation_queue')).toBeNull();
    });

    it('desmonta sem destruir: nenhuma base é apagada do disco', async () => {
        const localforage = (await import('localforage')).default;
        const { store } = await loadStoreFacade();
        seedSentinels();

        await store.clearAllDataStore();

        expect(localforage.dropInstance).not.toHaveBeenCalled();
        expect(dropped).toEqual([]);
    });

    it('mantém os nomes de banco de hoje enquanto existe um único atlas local', async () => {
        const { store } = await loadStoreFacade();
        seedSentinels();

        await store.clearAllDataStore();

        const touched = [...databases.keys()].map(k => k.split('::')[0]);
        for (const name of ATLAS_DATABASES) {
            expect(touched).toContain(name);
        }
        expect(touched.filter(name => name.includes('__'))).toEqual([]);
    });
});

// ============================================================================
// Path 2: o guarda de boot do usuário deslogado
// ============================================================================

describe('guarda de boot com dado remoto e ninguém autenticado', () => {
    it('esvazia as mesmas dez bases, pela mesma lista', async () => {
        const { store } = await loadStoreFacade();
        seedSentinels();
        // The marker that makes the guard fire: the store holds a server atlas.
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: 'atlas-do-servidor' });

        await store.initializeWithLastActiveMap();

        expect(databasesStillHoldingSentinel()).toEqual([]);
    });

    it('não apaga banco nenhum: quem só deslogou continua com seus slots de pé', async () => {
        const localforage = (await import('localforage')).default;
        const { store } = await loadStoreFacade();
        seedSentinels();
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: 'atlas-do-servidor' });

        await store.initializeWithLastActiveMap();

        expect(localforage.dropInstance).not.toHaveBeenCalled();
    });

    it('não dispara com origem local: o dado do usuário offline fica onde está', async () => {
        const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
        const { store } = await loadStoreFacade();
        seedSentinels();
        // Without a schema version the boot takes the fresh-install path and discards the
        // legacy subset, which would hide the negative control behind unrelated cleanup.
        seed('ebgeo_app_settings', 'schemaVersion', ATLAS_SCHEMA_VERSION);

        await store.initializeWithLastActiveMap();

        expect(databasesStillHoldingSentinel()).toEqual(ATLAS_DATABASES);
    });
});

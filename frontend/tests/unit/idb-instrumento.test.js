// Path: tests/unit/idb-instrumento.test.js

/**
 * @fileoverview Verifies the INSTRUMENT, before anything is verified WITH it.
 *
 * Every gate of the multi-tab plan is going to read databases by absolute name. If the
 * instrument lies once (localforage silently on a fallback driver, a helper that fabricates
 * the database it was asked to inspect, a reset that resets nothing), every gate built on
 * top of it is green and worthless. So each block below names, in its own comment, the
 * concrete change that turns it red.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import localforage from 'localforage';
import {
    storeAt,
    seedDatabase,
    readDatabase,
    readKey,
    listDatabases,
    databaseExists,
    databaseState,
    countKeys,
    resetIndexedDB,
    assertIndexedDbDriver,
    DEFAULT_STORE_NAME
} from '../helpers/idb-helpers.js';
import {
    StoreName,
    remoteScope,
    localScope,
    getStoreFor,
    resolveDbName
} from '@store/atlas-namespace.js';

beforeEach(async () => {
    await resetIndexedDB();
});

describe('instrumento :: o IndexedDB existe e o localforage está de fato sobre ele', () => {
    // RED IF: `setupFiles` is removed from `vitest.config.js`.
    it('há um indexedDB global sob o ambiente node da suíte', () => {
        expect(typeof indexedDB).not.toBe('undefined');
        expect(typeof indexedDB.databases).toBe('function');
    });

    // RED IF: localforage falls back to localStorage/memory (which is exactly the silent
    // failure this assertion exists for). The driver NAME alone is not enough, so the
    // second half proves it by an independent path: the database has to become visible to
    // `indexedDB.databases()`, which knows nothing about localforage.
    it('o driver ativo é INDEXEDDB, e o dado aparece para o factory', async () => {
        const store = storeAt('instrumento_driver_db');
        const driver = await assertIndexedDbDriver(store);

        expect(driver).toBe(localforage.INDEXEDDB);
        expect(driver).toBe('asyncStorage');

        await store.setItem('k', { v: 1 });
        expect(await listDatabases()).toContain('instrumento_driver_db');
        expect(await store.getItem('k')).toEqual({ v: 1 });
    });

    // RED IF: `assertIndexedDbDriver` stops checking. A store that resolved to something
    // other than IndexedDB must be REFUSED, otherwise the check above cannot distinguish
    // "IndexedDB" from "whatever localforage happened to pick". localforage 1.10 ships no
    // memory driver (its three are asyncStorage/webSQLStorage/localStorageWrapper, and the
    // last two do not exist under node), so the fallback is built here with `defineDriver`,
    // which is also the honest shape of the failure: a store that answers every call
    // without an `indexedDB` in sight.
    it('recusa explicitamente um driver que não seja IndexedDB', async () => {
        const memoria = new Map();
        await localforage.defineDriver({
            _driver: 'testMemoryDriver',
            _initStorage: () => Promise.resolve(),
            clear: () => { memoria.clear(); return Promise.resolve(); },
            getItem: key => Promise.resolve(memoria.has(key) ? memoria.get(key) : null),
            iterate: () => Promise.resolve(),
            key: () => Promise.resolve(null),
            keys: () => Promise.resolve([...memoria.keys()]),
            length: () => Promise.resolve(memoria.size),
            removeItem: key => { memoria.delete(key); return Promise.resolve(); },
            setItem: (key, value) => { memoria.set(key, value); return Promise.resolve(value); }
        });

        const store = localforage.createInstance({ name: 'instrumento_fallback_db' });
        await store.setDriver('testMemoryDriver');
        expect(store.driver()).toBe('testMemoryDriver');

        // It happily stores and returns data, which is exactly why the driver check is not
        // optional: nothing about the writes below would look wrong to a test.
        await store.setItem('k', 1);
        expect(await store.getItem('k')).toBe(1);
        expect(await listDatabases()).not.toContain('instrumento_fallback_db');

        await expect(assertIndexedDbDriver(store)).rejects.toThrow(/not IndexedDB/);
    });
});

describe('instrumento :: ausente e vazio são respostas diferentes', () => {
    // RED IF: `readDatabase`/`databaseState` drop the `databaseExists` guard and just open
    // the database. Opening CREATES it, so the second half of each assertion is the one
    // that matters: the name must still not exist after the read.
    it('ler um banco ausente devolve null e NÃO o cria', async () => {
        expect(await databaseExists('instrumento_ausente')).toBe(false);

        expect(await readDatabase('instrumento_ausente')).toBeNull();
        expect(await readKey('instrumento_ausente', 'k')).toBeNull();
        expect(await countKeys('instrumento_ausente')).toBeNull();
        expect(await databaseState('instrumento_ausente')).toBe('absent');

        expect(await listDatabases()).not.toContain('instrumento_ausente');
    });

    // RED IF: `databaseState` collapses to a boolean. The three states have to be three.
    it('distingue absent, empty e populated', async () => {
        expect(await databaseState('instrumento_tres')).toBe('absent');

        await seedDatabase('instrumento_tres', { a: 1 });
        expect(await databaseState('instrumento_tres')).toBe('populated');
        expect(await countKeys('instrumento_tres')).toBe(1);

        await storeAt('instrumento_tres').clear();
        expect(await databaseState('instrumento_tres')).toBe('empty');
        expect(await countKeys('instrumento_tres')).toBe(0);
        // Emptied, not gone: this is the distinction the wipe/purge gates depend on.
        expect(await databaseExists('instrumento_tres')).toBe(true);
        expect(await readDatabase('instrumento_tres')).toEqual({});
    });

    it('semear e reler devolve exatamente o que foi escrito, por nome absoluto', async () => {
        await seedDatabase('instrumento_seed', { um: 1, dois: { aninhado: true } });
        expect(await readDatabase('instrumento_seed')).toEqual({
            um: 1,
            dois: { aninhado: true }
        });
    });

    // RED IF: the helper ignores `storeName`. The queue descriptor is the only store with a
    // non-null `storeName`, so a helper that silently used the default would read an empty
    // object store and report "vazio" for a full queue.
    it('respeita um storeName não padrão dentro do mesmo banco', async () => {
        await seedDatabase('instrumento_stores', { q: 'fila' }, { storeName: 'operation_queue' });
        await seedDatabase('instrumento_stores', { d: 'default' });

        expect(await readDatabase('instrumento_stores', { storeName: 'operation_queue' }))
            .toEqual({ q: 'fila' });
        expect(await readDatabase('instrumento_stores', { storeName: DEFAULT_STORE_NAME }))
            .toEqual({ d: 'default' });
    });
});

describe('instrumento :: reset', () => {
    // RED IF: `resetIndexedDB` becomes a no-op. The POSITIVE assertion before the
    // destructive step is mandatory: without it "não existe depois" is indistinguishable
    // from "nunca existiu".
    it('apaga tudo, e o antes é asserido', async () => {
        await seedDatabase('instrumento_reset_a', { a: 1 });
        await seedDatabase('instrumento_reset_b', { b: 2 });

        const antes = await listDatabases();
        expect(antes).toContain('instrumento_reset_a');
        expect(antes).toContain('instrumento_reset_b');
        expect(await databaseState('instrumento_reset_a')).toBe('populated');

        const report = await resetIndexedDB();

        expect(report.blocked).toEqual([]);
        expect(report.deleted).toEqual(expect.arrayContaining([
            'instrumento_reset_a',
            'instrumento_reset_b'
        ]));
        expect(await listDatabases()).toEqual([]);
        expect(await databaseState('instrumento_reset_a')).toBe('absent');
    });

    // RED IF: `resetIndexedDB` swaps `globalThis.indexedDB` for a fresh factory instead of
    // emptying the current one. localforage captured the factory at module load, so after a
    // swap this write would land somewhere `listDatabases()` cannot see.
    it('depois do reset, o localforage continua escrevendo no factory que os helpers leem', async () => {
        await seedDatabase('instrumento_pos_reset', { antes: true });
        await resetIndexedDB();

        const store = storeAt('instrumento_pos_reset');
        await store.setItem('depois', true);

        expect(await listDatabases()).toContain('instrumento_pos_reset');
        expect(await readDatabase('instrumento_pos_reset')).toEqual({ depois: true });
    });
});

describe('instrumento :: a fábrica real do store escreve onde os helpers leem', () => {
    // This is the join that makes every later gate meaningful: the module under test and
    // the instrument must be over the SAME storage, addressed by the SAME name.
    // RED IF: `getStoreFor` stops applying the namespace, or `resolveDbName` changes the
    // name it builds without the harness following. Both halves are asserted absolutely.
    it('getStoreFor(MAPS, remoteScope) cai em ebgeo_maps__remote-<id>', async () => {
        const scope = remoteScope('atlas-1111');
        const dbName = resolveDbName(StoreName.MAPS, scope);
        expect(dbName).toBe('ebgeo_maps__remote-atlas-1111');

        const store = getStoreFor(StoreName.MAPS, scope);
        await assertIndexedDbDriver(store);
        await store.setItem('sentinela', { mapa: 'X' });

        expect(await databaseState(dbName)).toBe('populated');
        expect(await readKey(dbName, 'sentinela')).toEqual({ mapa: 'X' });
        // And nowhere else: the unsuffixed database must not have been touched.
        expect(await databaseState('ebgeo_maps')).toBe('absent');
    });

    // RED IF: two scopes ever resolve to one database. That is the defect the whole
    // namespace phase exists to prevent, so it is asserted over real storage, not doubles.
    it('dois escopos são dois bancos, sem vazamento cruzado', async () => {
        const x = remoteScope('atlas-x');
        const y = localScope('slot-2', 'slot2');

        await getStoreFor(StoreName.MAPS, x).setItem('quem', 'X');
        await getStoreFor(StoreName.MAPS, y).setItem('quem', 'Y');

        expect(await readKey('ebgeo_maps__remote-atlas-x', 'quem')).toBe('X');
        expect(await readKey('ebgeo_maps__slot2', 'quem')).toBe('Y');

        const nomes = await listDatabases();
        expect(nomes).toContain('ebgeo_maps__remote-atlas-x');
        expect(nomes).toContain('ebgeo_maps__slot2');
    });
});

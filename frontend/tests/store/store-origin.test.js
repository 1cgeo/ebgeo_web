import { describe, it, expect, vi } from 'vitest';

// §item9: the origin marker is the explicit, additive separation between data that
// PERSISTS on the machine (local atlas — incl. the logged-out default) and data that
// only lives here TEMPORARILY while connected (a remote server atlas). It must default
// to LOCAL so the offline/standalone user is never affected.
//
// Since the namespace factory landed, WHERE the marker lives is part of the invariant:
// it is read before any scope is active and it decides the scope, so it lives in the
// GLOBAL database, not in the per-atlas app settings. The fake below is keyed by
// database name precisely so those two are distinguishable.

const { dbs, control, makeStore, resetFake } = vi.hoisted(() => {
    const dbs = new Map();
    const control = { failWritesTo: null };

    function keyOf(name, storeName) {
        return `${name}::${storeName || 'keyvaluepairs'}`;
    }

    function backingOf(name, storeName = null) {
        const key = keyOf(name, storeName);
        const existing = dbs.get(key);
        if (existing) return existing;
        const created = new Map();
        dbs.set(key, created);
        return created;
    }

    function makeStore({ name, storeName = null }) {
        const backing = backingOf(name, storeName);
        return {
            setItem: async (k, v) => {
                if (control.failWritesTo === name) throw new Error('QuotaExceeded (simulated)');
                backing.set(k, v);
                return v;
            },
            getItem: async (k) => (backing.has(k) ? backing.get(k) : null),
            removeItem: async (k) => { backing.delete(k); },
            keys: async () => [...backing.keys()],
            clear: async () => { backing.clear(); }
        };
    }

    function resetFake() {
        dbs.clear();
        control.failWritesTo = null;
    }

    return { dbs, control, makeStore, resetFake };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(async () => {})
    }
}));

const GLOBAL_DB = 'ebgeo_global';
const LEGACY_SETTINGS_DB = 'ebgeo_app_settings';
const ORIGIN_KEY = '__store_origin__';

/** Both modules keep module-level state (the instance cache, the in-memory mirror). */
async function loadFresh() {
    vi.resetModules();
    resetFake();
    const namespace = await import('../../src/js/store/atlas-namespace.js');
    const origin = await import('../../src/js/store/store-origin.js');
    return { namespace, origin };
}

/** Writes straight into a fake database, bypassing the module under test. */
function seed(dbName, key, value) {
    const mapKey = `${dbName}::keyvaluepairs`;
    if (!dbs.has(mapKey)) dbs.set(mapKey, new Map());
    dbs.get(mapKey).set(key, value);
}

/** Reads straight from a fake database. */
function read(dbName, key) {
    return dbs.get(`${dbName}::keyvaluepairs`)?.get(key) ?? null;
}

/** @returns {boolean} Whether a database holds the key at all. */
function has(dbName, key) {
    return dbs.get(`${dbName}::keyvaluepairs`)?.has(key) ?? false;
}

describe('store-origin marker', () => {
    it('defaults to LOCAL when nothing is persisted (offline user untouched)', async () => {
        const { origin } = await loadFresh();
        await origin.loadStoreOrigin();
        expect(origin.getStoreOriginSync().kind).toBe(origin.StoreOriginKind.LOCAL);
        expect(origin.isRemoteStoreSync()).toBe(false);
    });

    it('markStoreRemote persists the atlas id and survives a reload', async () => {
        const { origin } = await loadFresh();
        await origin.markStoreRemote('atlas-123');
        expect(origin.isRemoteStoreSync()).toBe(true);
        expect(origin.getStoreOriginSync()).toEqual({ kind: 'remote', atlasId: 'atlas-123' });

        await origin.loadStoreOrigin(); // simulate a fresh boot reading the persisted value
        expect(origin.isRemoteStoreSync()).toBe(true);
        expect(origin.getStoreOriginSync().atlasId).toBe('atlas-123');
    });

    it('markStoreLocal clears the remote marker', async () => {
        const { origin } = await loadFresh();
        await origin.markStoreRemote('atlas-123');
        await origin.markStoreLocal();
        expect(origin.isRemoteStoreSync()).toBe(false);
        expect(origin.getStoreOriginSync()).toEqual({ kind: 'local', atlasId: null });
    });

    it('loadStoreOrigin falls back to LOCAL on a malformed persisted value', async () => {
        const { origin } = await loadFresh();
        await origin.setStoreOrigin('remote', 'x');
        seed(GLOBAL_DB, ORIGIN_KEY, { bogus: true }); // no kind field
        await origin.loadStoreOrigin();
        expect(origin.getStoreOriginSync().kind).toBe(origin.StoreOriginKind.LOCAL);
    });
});

describe('store-origin lives in the global database, never in a namespace', () => {
    it('writes the marker to ebgeo_global and to no per-atlas settings database', async () => {
        const { namespace, origin } = await loadFresh();
        namespace.activateScope(namespace.localScope('atlas-a', 'aaa'));

        await origin.markStoreRemote('server-1');

        expect(read(GLOBAL_DB, ORIGIN_KEY)).toEqual({ kind: 'remote', atlasId: 'server-1' });
        expect(has(LEGACY_SETTINGS_DB, ORIGIN_KEY)).toBe(false);
        expect(has('ebgeo_app_settings__aaa', ORIGIN_KEY)).toBe(false);
    });

    it('is readable with NO scope active, which is what lets it decide the scope', async () => {
        const { namespace, origin } = await loadFresh();
        expect(namespace.getActiveScope()).toBeNull();

        await origin.markStoreRemote('server-1');
        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'remote', atlasId: 'server-1' });
    });

    it('survives a switch of local atlas (a per-atlas marker would vanish)', async () => {
        const { namespace, origin } = await loadFresh();
        namespace.activateScope(namespace.localScope('atlas-a', 'aaa'));
        await origin.markStoreRemote('server-1');

        namespace.activateScope(namespace.localScope('atlas-b', 'bbb'));
        await origin.loadStoreOrigin();

        expect(origin.isRemoteStoreSync()).toBe(true);
        expect(origin.getStoreOriginSync().atlasId).toBe('server-1');
    });
});

describe('store-origin legacy fallback (the upgrade boot)', () => {
    it('reads a REMOTE marker left in the pre-namespace settings database', async () => {
        // The invariant: an installation that upgrades while holding a server atlas must
        // still be seen as REMOTE, or the boot guard keeps that atlas as local data.
        const { origin } = await loadFresh();
        seed(LEGACY_SETTINGS_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'server-9' });

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'remote', atlasId: 'server-9' });
        expect(origin.isRemoteStoreSync()).toBe(true);
    });

    it('promotes the legacy marker to the global database and removes the old copy', async () => {
        const { origin } = await loadFresh();
        seed(LEGACY_SETTINGS_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'server-9' });

        await origin.loadStoreOrigin();

        expect(read(GLOBAL_DB, ORIGIN_KEY)).toEqual({ kind: 'remote', atlasId: 'server-9' });
        expect(has(LEGACY_SETTINGS_DB, ORIGIN_KEY)).toBe(false);
    });

    it('keeps the legacy copy when the promotion write fails, and still reports REMOTE', async () => {
        // A failed promotion must never downgrade the boot to LOCAL, and must never delete
        // the only surviving copy of the marker.
        const { origin } = await loadFresh();
        seed(LEGACY_SETTINGS_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'server-9' });
        control.failWritesTo = GLOBAL_DB;

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'remote', atlasId: 'server-9' });
        expect(has(GLOBAL_DB, ORIGIN_KEY)).toBe(false);
        expect(has(LEGACY_SETTINGS_DB, ORIGIN_KEY)).toBe(true);
    });

    it('prefers the global marker over a stale legacy one', async () => {
        const { origin } = await loadFresh();
        seed(GLOBAL_DB, ORIGIN_KEY, { kind: 'local', atlasId: null });
        seed(LEGACY_SETTINGS_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'stale' });

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'local', atlasId: null });
        // The stale copy is left alone: only a promotion (global was empty) touches it.
        expect(read(LEGACY_SETTINGS_DB, ORIGIN_KEY)).toEqual({ kind: 'remote', atlasId: 'stale' });
    });

    it('ignores a malformed legacy marker and stays LOCAL', async () => {
        const { origin } = await loadFresh();
        seed(LEGACY_SETTINGS_DB, ORIGIN_KEY, { atlasId: 'x' }); // no kind

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'local', atlasId: null });
        expect(has(GLOBAL_DB, ORIGIN_KEY)).toBe(false);
    });
});

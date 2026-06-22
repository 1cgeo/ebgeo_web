import { describe, it, expect, beforeEach, vi } from 'vitest';

// §item9: the origin marker is the explicit, additive separation between data that
// PERSISTS on the machine (local atlas — incl. the logged-out default) and data that
// only lives here TEMPORARILY while connected (a remote server atlas). It must default
// to LOCAL so the offline/standalone user is never affected.

const settings = new Map();
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getSettingCompat: vi.fn(async (k) => (settings.has(k) ? settings.get(k) : null)),
    setSettingCompat: vi.fn(async (k, v) => { settings.set(k, v); })
}));

import {
    StoreOriginKind,
    loadStoreOrigin,
    getStoreOriginSync,
    isRemoteStoreSync,
    markStoreRemote,
    markStoreLocal,
    setStoreOrigin
} from '../../src/js/store/store-origin.js';

beforeEach(() => {
    settings.clear();
});

describe('store-origin marker', () => {
    it('defaults to LOCAL when nothing is persisted (offline user untouched)', async () => {
        await loadStoreOrigin();
        expect(getStoreOriginSync().kind).toBe(StoreOriginKind.LOCAL);
        expect(isRemoteStoreSync()).toBe(false);
    });

    it('markStoreRemote persists the atlas id and survives a reload', async () => {
        await markStoreRemote('atlas-123');
        expect(isRemoteStoreSync()).toBe(true);
        expect(getStoreOriginSync()).toEqual({ kind: 'remote', atlasId: 'atlas-123' });

        await loadStoreOrigin(); // simulate a fresh boot reading the persisted value
        expect(isRemoteStoreSync()).toBe(true);
        expect(getStoreOriginSync().atlasId).toBe('atlas-123');
    });

    it('markStoreLocal clears the remote marker', async () => {
        await markStoreRemote('atlas-123');
        await markStoreLocal();
        expect(isRemoteStoreSync()).toBe(false);
        expect(getStoreOriginSync()).toEqual({ kind: 'local', atlasId: null });
    });

    it('loadStoreOrigin falls back to LOCAL on a malformed persisted value', async () => {
        await setStoreOrigin('remote', 'x');
        settings.set('__store_origin__', { bogus: true }); // no kind field
        await loadStoreOrigin();
        expect(getStoreOriginSync().kind).toBe(StoreOriginKind.LOCAL);
    });
});

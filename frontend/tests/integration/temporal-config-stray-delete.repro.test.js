// Path: tests/integration/temporal-config-stray-delete.repro.test.js

/**
 * @fileoverview Regression: the per-map temporal config never reached a peer (P11).
 *
 * Root cause (proved by an ordered in-page trace on the real E2E stack): the atlas snapshot
 * DID arrive and DID persist `temporal_<nome>` — and then `activateAtlasInitialMap` deleted the
 * local stray map of the SAME name ('Principal'), whose `deleteMap` unconditionally removed the
 * name-keyed side stores `temporal_<nome>` and `mapLocked_<nome>`. Those stores are shared by
 * NAME, so the delete erased the surviving atlas map's timeline microseconds after it was
 * written. The grid survived the same delete because it is keyed by map id (`gridStyle_<id>`),
 * which is exactly why the round-trip lost the timeline and nothing else.
 *
 * The guard: a name-keyed side store may only be dropped when no OTHER map record still answers
 * to that name.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock localforage (same in-memory harness as repository-contract.test.js)
// ============================================================================

const { stores } = vi.hoisted(() => ({ stores: {} }));

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(({ name }) => {
            if (!stores[name]) {
                const map = new Map();
                stores[name] = {
                    setItem: vi.fn(async (key, value) => { map.set(key, value); }),
                    getItem: vi.fn(async (key) => {
                        const val = map.get(key);
                        return val !== undefined ? val : null;
                    }),
                    removeItem: vi.fn(async (key) => { map.delete(key); }),
                    keys: vi.fn(async () => [...map.keys()]),
                    clear: vi.fn(async () => { map.clear(); }),
                    iterate: vi.fn(async (callback) => {
                        for (const [key, value] of map.entries()) {
                            callback(value, key);
                        }
                    }),
                    _map: map
                };
            }
            return stores[name];
        })
    }
}));

vi.mock('../../src/js/store/atlas/atlas.entity.js', () => ({
    createAtlas: vi.fn((name) => ({ id: 'atlas-uuid', name: name || 'Projeto sem nome', maps: [] })),
    isValidAtlas: vi.fn(() => true)
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        resolveToId: vi.fn((nameOrId) => nameOrId),
        resolveToName: vi.fn((id) => id),
        registerMap: vi.fn()
    }
}));

import { LocalRepository } from '../../src/js/store/repositories/local.repository.js';

const ATLAS_MAP_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_MAP_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const TEMPORAL = { ativo: true, unidade: 'HORA', inicio: null, fim: null, modo: 'absoluto', origem: null };

let repo;

beforeEach(() => {
    for (const storeName of Object.keys(stores)) {
        stores[storeName]._map.clear();
    }
    vi.clearAllMocks();
    repo = new LocalRepository();
});

describe('deleting a stray map must not erase a namesake map’s name-keyed settings', () => {
    it('keeps temporal + lock of the UUID-keyed atlas map when the same-named local stray is dropped', async () => {
        // The post-snapshot state: the local stray (created at boot, name-keyed) and the atlas
        // map (UUID-keyed, written by the snapshot) coexist under the same name. Saved in that
        // order because `saveMap` resolves a NAME onto an existing record of that name — saving
        // the stray last would overwrite the atlas map instead of creating a second record.
        await repo.saveMap('Principal', { id: 'Principal', name: 'Principal' });
        await repo.saveMap(ATLAS_MAP_ID, { id: ATLAS_MAP_ID, name: 'Principal' });
        await repo.saveSetting('temporal_Principal', TEMPORAL);
        await repo.saveSetting('mapLocked_Principal', true);
        await repo.saveGridStyle(ATLAS_MAP_ID, { format: 'utm', visible: true });

        // What activateAtlasInitialMap does: drop the stray by its storage key.
        await repo.deleteMap('Principal');

        expect(await repo.getSetting('temporal_Principal')).toEqual(TEMPORAL);
        expect(await repo.getSetting('mapLocked_Principal')).toBe(true);
        // The stray itself is gone and the atlas map (with its id-keyed grid) is untouched.
        expect(await repo.getMapById('Principal')).toBeNull();
        expect(await repo.getMapById(ATLAS_MAP_ID)).not.toBeNull();
        expect(await repo.getGridStyle(ATLAS_MAP_ID)).toEqual({ format: 'utm', visible: true });
    });

    it('still clears them when the deleted map is the LAST one with that name (no resurrection)', async () => {
        // The invariant the guard must not break: a new map of the same name is born unlocked
        // and without the dead map's timeline.
        await repo.saveMap(ATLAS_MAP_ID, { id: ATLAS_MAP_ID, name: 'Principal' });
        await repo.saveSetting('temporal_Principal', TEMPORAL);
        await repo.saveSetting('mapLocked_Principal', true);

        await repo.deleteMap(ATLAS_MAP_ID);

        expect(await repo.getSetting('temporal_Principal')).toBeNull();
        expect(await repo.getSetting('mapLocked_Principal')).toBeNull();
    });

    it('edge: with three namesakes the settings survive every delete but the LAST', async () => {
        // The boundary of the guard: it must hold while any namesake remains and release on the
        // final one — an off-by-one that counted the record being deleted would never clear.
        await repo.saveMap('Principal', { id: 'Principal', name: 'Principal' });
        await repo.saveMap(ATLAS_MAP_ID, { id: ATLAS_MAP_ID, name: 'Principal' });
        await repo.saveMap(OTHER_MAP_ID, { id: OTHER_MAP_ID, name: 'Principal' });
        await repo.saveSetting('temporal_Principal', TEMPORAL);

        await repo.deleteMap('Principal');
        expect(await repo.getSetting('temporal_Principal')).toEqual(TEMPORAL);

        await repo.deleteMap(ATLAS_MAP_ID);
        expect(await repo.getSetting('temporal_Principal')).toEqual(TEMPORAL);

        await repo.deleteMap(OTHER_MAP_ID);
        expect(await repo.getSetting('temporal_Principal')).toBeNull();
    });
});

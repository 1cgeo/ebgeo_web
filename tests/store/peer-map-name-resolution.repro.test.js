import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression for §item2 ("creating a map doesn't sync to peers", receiver side).
//
// A map created by another user arrives over sync keyed by its UUID
// (applyRemoteMapOp / applyRemoteSnapshot call saveMap(uuid, data)). Before the fix,
// saveMap did NOT register the name↔UUID resolver mapping for UUID-keyed maps, so the
// maps list — which renders storage keys resolved to display names — showed the raw
// UUID instead of the map's name. saveMap now registers the resolver for UUID-keyed
// maps, while leaving name-keyed local maps untouched (phantom-map invariant).

const { stores } = vi.hoisted(() => ({ stores: {} }));
vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(({ name }) => {
            if (!stores[name]) {
                const map = new Map();
                stores[name] = {
                    setItem: vi.fn(async (k, v) => { map.set(k, v); }),
                    getItem: vi.fn(async (k) => (map.has(k) ? map.get(k) : null)),
                    removeItem: vi.fn(async (k) => { map.delete(k); }),
                    keys: vi.fn(async () => [...map.keys()]),
                    clear: vi.fn(async () => { map.clear(); }),
                    iterate: vi.fn(async (cb) => { for (const [k, v] of map.entries()) cb(v, k); }),
                    _map: map
                };
            }
            return stores[name];
        })
    }
}));

import { LocalRepository } from '../../src/js/store/repositories/local.repository.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { generateUUID, isValidUUID } from '../../src/js/utilities/uuid.js';

let repo;
beforeEach(() => {
    for (const s of Object.keys(stores)) stores[s]._map.clear();
    mapResolver.clear();
    repo = new LocalRepository();
});

describe('peer (UUID-keyed) map name resolution', () => {
    it('saveMap registers the name↔UUID mapping for a UUID-keyed map', async () => {
        const id = generateUUID();
        expect(isValidUUID(id)).toBe(true);

        // As a peer's applyRemoteMapOp would: save under the UUID with a display name.
        await repo.saveMap(id, { id, name: 'Operação Fronteira', features: { points: [] } });

        // The storage key is the UUID...
        expect(await repo.getAllMapIds()).toEqual([id]);
        // ...but it now resolves back to the display name (so the maps list shows the name).
        expect(mapResolver.resolveToName(id)).toBe('Operação Fronteira');
        expect(mapResolver.resolveToId('Operação Fronteira')).toBe(id);
    });

    it('does NOT register a mapping for a name-keyed local map (phantom-map invariant)', async () => {
        // A local/anonymous map saved under its name stays name-keyed with no UUID resolver
        // entry — otherwise a later name-resolving save would duplicate it under a UUID.
        await repo.saveMap('Principal', { name: 'Principal', features: { points: [] } });

        expect(await repo.getAllMapIds()).toEqual(['Principal']);
        expect(mapResolver.resolveToName('Principal')).toBe('Principal');
        expect(mapResolver.getIdForName('Principal')).toBeUndefined();
    });
});

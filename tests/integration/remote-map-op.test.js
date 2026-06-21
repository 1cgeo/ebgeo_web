// Path: tests/integration/remote-map-op.test.js
// §1.8/§1.9: a remote map op is atlas-level — its identity is `entityId` (the map id)
// while `mapId` (the op context) is null. The handler emits MAP_CREATED/MODIFIED/
// DELETED with the real id AND persists the change to the local (repo-backed) store
// so a map another user created/deleted appears/disappears for collaborators.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    mapStore: new Map(),
    saveMap: vi.fn(),
    deleteMap: vi.fn(),
    registerMap: vi.fn(),
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: () => ({
        getMap: async (id) => h.mapStore.get(id) || null,
        saveMap: async (id, d) => { h.mapStore.set(id, d); h.saveMap(id, d); },
        deleteMap: async (id) => { h.mapStore.delete(id); h.deleteMap(id); },
        getAtlas: vi.fn(),
        saveAtlas: vi.fn(),
    }),
}));
vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: { saveBriefing: vi.fn(), getBriefing: vi.fn(), deleteBriefing: vi.fn() },
}));
vi.mock('../../src/js/store/control.registry.js', () => ({
    getControl: () => undefined,
    registerControl: vi.fn(),
}));
vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        registerMap: (name, id) => h.registerMap(name, id),
        unregisterMapById: vi.fn(),
        getNameForId: vi.fn(),
    },
}));

import { applyRemoteOperation, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { EventTypes } from '../../src/js/events/event_types.js';

let bus;
beforeEach(() => {
    h.mapStore.clear();
    h.saveMap.mockClear();
    h.deleteMap.mockClear();
    h.registerMap.mockClear();
    bus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    setRemoteHandlerEventBus(bus);
});

describe('remote map op carries the map id (entityId) and persists to the local store', () => {
    it('CREATE persists the map, registers the resolver, and emits MAP_CREATED with the id', async () => {
        await applyRemoteOperation({ entityType: 'map', operationType: 'create', entityId: 'map-uuid-2', mapId: null, data: { name: 'Novo' } });
        expect(h.saveMap).toHaveBeenCalledWith('map-uuid-2', { name: 'Novo' });
        expect(h.registerMap).toHaveBeenCalledWith('Novo', 'map-uuid-2');
        expect(bus.emit).toHaveBeenCalledWith(EventTypes.MAP_CREATED, { mapId: 'map-uuid-2', map: { name: 'Novo' } });
    });

    it('DELETE removes the map from the local store and emits MAP_DELETED with the id', async () => {
        h.mapStore.set('map-uuid-1', { name: 'Velho' });
        await applyRemoteOperation({ entityType: 'map', operationType: 'delete', entityId: 'map-uuid-1', mapId: null });
        expect(h.deleteMap).toHaveBeenCalledWith('map-uuid-1');
        expect(h.mapStore.has('map-uuid-1')).toBe(false);
        expect(bus.emit).toHaveBeenCalledWith(EventTypes.MAP_DELETED, { mapId: 'map-uuid-1' });
    });

    it('UPDATE persists changes and emits MAP_MODIFIED with the id', async () => {
        await applyRemoteOperation({ entityType: 'map', operationType: 'update', entityId: 'map-uuid-3', mapId: null, data: { name: 'X' } });
        expect(h.saveMap).toHaveBeenCalledWith('map-uuid-3', { name: 'X' });
        expect(bus.emit).toHaveBeenCalledWith(EventTypes.MAP_MODIFIED, { mapId: 'map-uuid-3', map: { name: 'X' } });
    });
});

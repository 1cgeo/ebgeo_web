import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression: group sync ops must be tagged with the map's UUID, NOT its name.
 *
 * A group op logged with a non-UUID map id is rejected by the backend and POISONS the
 * client's whole flush batch — every op queued after it (renames, new features, …) never
 * reaches peers, so creating a group while online silently broke ALL further sync for
 * that client. (Same flush-poison class as the feature/layer/temporal map-id bugs.) This
 * pins that group_manager resolves the map NAME → UUID before logging the op.
 *
 * Only the seams are mocked (store barrel, the op logger, the resolver); the REAL
 * GroupManager runs.
 */

const MAP_NAME = 'Mapa Tático';
const MAP_UUID = '4a22f7df-df6d-47df-80bb-f26df86d31ec';

// Hoisted so the (hoisted) vi.mock factories can reference these without a TDZ error.
const h = vi.hoisted(() => ({
    memoryStore: { currentMap: 'Mapa Tático', groups: {} },
    logGroupOperation: vi.fn(),
    resolveToId: vi.fn(),
}));

// The store barrel: GroupManager only needs these three.
vi.mock('../../src/js/store/index.js', () => ({
    memoryStore: h.memoryStore,
    setMapGroups: vi.fn(),
    getMapGroupsFromDB: vi.fn(async () => ({})),
}));

// Capture every logged group op.
vi.mock('../../src/js/store/sync/index.js', () => ({
    logGroupOperation: h.logGroupOperation,
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' },
}));

// The resolver under test: a real atlas map NAME → its UUID; anything else passes through.
vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: { resolveToId: h.resolveToId },
}));

import { createGroupManager } from '../../src/js/tool_manager/group_manager.js';

const pt = (id) => ({ properties: { id, source: 'point' } });

let gm;
beforeEach(() => {
    vi.clearAllMocks();
    h.resolveToId.mockImplementation((n) => (n === MAP_NAME ? MAP_UUID : n));
    h.memoryStore.currentMap = MAP_NAME;
    h.memoryStore.groups = {};
    gm = createGroupManager({ emit: vi.fn() });
});

describe('group_manager — sync ops carry the map UUID (flush-poison guard)', () => {
    it('createGroup logs the op with the map UUID as mapId, not the name', () => {
        const group = gm.createGroup([pt('f1'), pt('f2')], MAP_NAME);

        expect(h.logGroupOperation).toHaveBeenCalledTimes(1);
        const [opType, groupId, mapId, data] = h.logGroupOperation.mock.calls[0];
        expect(opType).toBe('create');
        expect(groupId).toBe(group.id);
        // The defining assertion: mapId is the resolved UUID, never the raw name.
        expect(mapId).toBe(MAP_UUID);
        expect(mapId).not.toBe(MAP_NAME);
        expect(data.features).toHaveLength(2);
    });

    it('createGroup with mapName=null resolves the CURRENT map name to a UUID', () => {
        gm.createGroup([pt('a'), pt('b')]); // null → current map (MAP_NAME)
        const [, , mapId] = h.logGroupOperation.mock.calls[0];
        expect(mapId).toBe(MAP_UUID);
    });

    it('updateGroupProperty logs the UPDATE op with the map UUID', () => {
        const group = gm.createGroup([pt('f1'), pt('f2')], MAP_NAME);
        h.logGroupOperation.mockClear();

        gm.updateGroupProperty(group.id, 'visible', false, MAP_NAME);

        expect(h.logGroupOperation).toHaveBeenCalledTimes(1);
        const [opType, , mapId] = h.logGroupOperation.mock.calls[0];
        expect(opType).toBe('update');
        expect(mapId).toBe(MAP_UUID);
    });

    it('ungroupFeatures logs the DELETE op with the map UUID', () => {
        const group = gm.createGroup([pt('f1'), pt('f2')], MAP_NAME);
        h.logGroupOperation.mockClear();

        gm.ungroupFeatures(group.id, MAP_NAME);

        const deleteCall = h.logGroupOperation.mock.calls.find((c) => c[0] === 'delete');
        expect(deleteCall, 'a DELETE group op was logged').toBeTruthy();
        expect(deleteCall[2]).toBe(MAP_UUID);
    });
});

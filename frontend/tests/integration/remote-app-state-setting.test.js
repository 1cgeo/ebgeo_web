// Path: tests/integration/remote-app-state-setting.test.js
// datamodel-13/14: a remote `setting` op (and a snapshot's atlas.settings) carrying
// mapBadgeColors / colorUsage / customIcons must be applied to the SAME local store
// keys the local setters use:
//   - mapBadgeColors → repo.saveSetting('mapBadgeColors', obj)
//   - colorUsage     → repo.saveSetting('color_usage_<mapName>', counts) per map
//   - customIcons    → repo.saveSetting('custom_icons', list) + cache invalidation

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    settings: new Map(),
    atlas: { settings: {} },
    invalidate: vi.fn(),
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: () => ({
        getMap: vi.fn(),
        saveMap: vi.fn(),
        getAtlas: async () => h.atlas,
        saveAtlas: async (a) => { h.atlas = a; },
        saveSetting: async (k, v) => { h.settings.set(k, v); },
        getSetting: async (k) => h.settings.get(k),
    }),
}));

vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: { saveBriefing: vi.fn(), getBriefing: vi.fn(), deleteBriefing: vi.fn() },
}));

vi.mock('../../src/js/store/control.registry.js', () => ({
    getControl: () => undefined,
    registerControl: vi.fn(),
}));

vi.mock('../../src/js/store/customIcons.operations.js', () => ({
    invalidateCustomIconsCache: (...a) => h.invalidate(...a),
}));

import {
    applyRemoteOperation,
    applyRemoteSnapshot,
    setRemoteHandlerEventBus,
} from '../../src/js/store/sync/remote-operation-handler.js';

beforeEach(() => {
    h.settings.clear();
    h.atlas = { settings: {} };
    h.invalidate.mockClear();
    setRemoteHandlerEventBus({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });
});

const settingOp = (data) => applyRemoteOperation({
    entityType: 'setting', operationType: 'update', entityId: 'atlas', mapId: null, data,
});

describe('remote app-state setting op (datamodel-13/14)', () => {
    it('datamodel-13: applies mapBadgeColors to the mapBadgeColors store key', async () => {
        const mapBadgeColors = { Alfa: '#3b82f6', Bravo: '#f59e0b' };
        await settingOp({ mapBadgeColors });
        expect(h.settings.get('mapBadgeColors')).toEqual(mapBadgeColors);
    });

    it('datamodel-13: applies colorUsage per map under color_usage_<mapName>', async () => {
        await settingOp({ colorUsage: { Alfa: { '#ff0000': 3 }, Bravo: { '#00ff00': 1 } } });
        expect(h.settings.get('color_usage_Alfa')).toEqual({ '#ff0000': 3 });
        expect(h.settings.get('color_usage_Bravo')).toEqual({ '#00ff00': 1 });
    });

    it('datamodel-14: applies customIcons to custom_icons and invalidates the registry cache', async () => {
        const customIcons = [{ id: 'i1', name: 'Tank', type: 'image/png', createdAt: 1 }];
        await settingOp({ customIcons });
        expect(h.settings.get('custom_icons')).toEqual(customIcons);
        expect(h.invalidate).toHaveBeenCalledTimes(1);
    });

    it('ignores a setting op without any app-state key (no store writes)', async () => {
        await settingOp({ somethingElse: 1 });
        expect(h.settings.size).toBe(0);
        expect(h.invalidate).not.toHaveBeenCalled();
    });
});

describe('snapshot distributes atlas.settings app-state keys (datamodel-13/14)', () => {
    it('writes mapBadgeColors / colorUsage / customIcons from snapshot.atlas.settings to local stores', async () => {
        await applyRemoteSnapshot({
            atlas: {
                id: 'atlas-1',
                settings: {
                    terrainExaggeration: 2,
                    mapBadgeColors: { Alfa: '#111111' },
                    colorUsage: { Alfa: { '#ff0000': 7 } },
                    customIcons: [{ id: 'i9', name: 'Jet', type: 'image/png', createdAt: 2 }],
                },
            },
            maps: [],
            briefings: [],
        });

        expect(h.settings.get('mapBadgeColors')).toEqual({ Alfa: '#111111' });
        expect(h.settings.get('color_usage_Alfa')).toEqual({ '#ff0000': 7 });
        expect(h.settings.get('custom_icons')).toEqual([{ id: 'i9', name: 'Jet', type: 'image/png', createdAt: 2 }]);
        expect(h.invalidate).toHaveBeenCalled();
    });

    it('is a no-op when the snapshot has no atlas settings', async () => {
        await applyRemoteSnapshot({ maps: [], briefings: [] });
        expect(h.settings.size).toBe(0);
    });
});

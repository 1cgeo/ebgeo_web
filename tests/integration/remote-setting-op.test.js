// Path: tests/integration/remote-setting-op.test.js
// §24.8: a remote atlas-level `setting` op (terrainExaggeration) must persist to the
// local atlas and apply LIVE to the terrain control so connected peers update.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    atlasStore: { atlas: { settings: {} } },
    terrainSpy: vi.fn(),
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: () => ({
        getMap: vi.fn(),
        saveMap: vi.fn(),
        getAtlas: async () => h.atlasStore.atlas,
        saveAtlas: async (a) => { h.atlasStore.atlas = a; },
    }),
}));

vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: { saveBriefing: vi.fn(), getBriefing: vi.fn(), deleteBriefing: vi.fn() },
}));

vi.mock('../../src/js/store/control.registry.js', () => ({
    getControl: (name) => (name === 'terrain' ? { setExaggeration: h.terrainSpy } : undefined),
    registerControl: vi.fn(),
}));

import { applyRemoteOperation, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';

beforeEach(() => {
    h.atlasStore.atlas = { settings: {} };
    h.terrainSpy.mockClear();
    setRemoteHandlerEventBus({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });
});

describe('remote setting op (§24.8 terrainExaggeration)', () => {
    it('persists terrainExaggeration to the local atlas and applies it to the terrain control', async () => {
        await applyRemoteOperation({
            entityType: 'setting', operationType: 'update', entityId: 'atlas', mapId: null,
            data: { terrainExaggeration: 2.5 },
        });
        expect(h.atlasStore.atlas.settings.terrainExaggeration).toBe(2.5);
        expect(h.terrainSpy).toHaveBeenCalledWith(2.5);
    });

    it('ignores a setting op without terrainExaggeration (no terrain change)', async () => {
        await applyRemoteOperation({
            entityType: 'setting', operationType: 'update', entityId: 'atlas', mapId: null,
            data: { somethingElse: 1 },
        });
        expect(h.terrainSpy).not.toHaveBeenCalled();
    });
});

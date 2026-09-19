import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetIndexedDB } from '../helpers/idb-helpers.js';

beforeEach(async () => { vi.resetModules(); await resetIndexedDB(); });
afterEach(async () => { vi.restoreAllMocks(); await resetIndexedDB(); });

async function seed(settingsVersion, recordVersion, suffix = 'audit-checkpoint') {
    const ns = await import('@store/atlas-namespace.js');
    const scope = ns.localScope('checkpoint', suffix);
    const settings = ns.getStoreFor(ns.StoreName.SETTINGS, scope);
    if (settingsVersion !== null) await settings.setItem('schemaVersion', settingsVersion);
    if (recordVersion !== null) {
        await ns.getStoreFor(ns.StoreName.ATLAS, scope).setItem('current_atlas', {
            id: 'checkpoint', name: 'Antigo', schemaVersion: recordVersion, mapOrder: ['M'],
        });
    }
    await ns.getStoreFor(ns.StoreName.MAPS, scope).setItem('M', { name: 'M', features: {
        points: [{ properties: { id: 'point', source: 'point' } }, { properties: { id: 'zero', source: 'point', sizeCreatedAtZoom: 0 } }],
        images: [{ properties: { id: 'photo', source: 'image' } }],
    } });
    await ns.getStoreFor(ns.StoreName.IMAGES, scope).setItem('photo', new Uint8Array([1, 2, 3]));
    return { ns, scope, settings };
}

it.each([['2.0', '3.0'], ['3.0', '2.0'], ['2.1', '3.0'], ['3.0', '2.1']])(
    'resumes mismatched checkpoints settings=%s atlas=%s without remapping images', async (settingsVersion, recordVersion) => {
        const { ns, scope, settings } = await seed(settingsVersion, recordVersion);
        const { safelyMigrate, detectMigrationNeeded } = await import('@store/migration/migration.service.js');
        expect((await detectMigrationNeeded(scope)).needed).toBe(true);
        await safelyMigrate(scope);
        expect(await settings.getItem('schemaVersion')).toBe('3.0');
        expect((await detectMigrationNeeded(scope)).needed).toBe(false);
        const map = await ns.getStoreFor(ns.StoreName.MAPS, scope).getItem('M');
        if ([settingsVersion, recordVersion].includes('2.0')) expect(map.features.points[0].properties.sizeCreatedAtZoom).toBe(10);
        expect(map.features.points[1].properties.sizeCreatedAtZoom).toBe(0);
        expect(map.features.images[0].properties.id).toBe('photo');
        expect(await ns.getStoreFor(ns.StoreName.IMAGES, scope).getItem('photo')).toEqual(new Uint8Array([1, 2, 3]));
    });

it('a failure between version-marker writes resumes the same data in the same namespace', async () => {
    const { ns, scope, settings } = await seed('2.0', '2.0');
    const other = ns.localScope('other', 'other');
    ns.activateScope(other);
    const otherStore = ns.getStoreFor(ns.StoreName.MAPS, other);
    await otherStore.setItem('Unchanged', { value: 42 });
    const write = settings.setItem.bind(settings);
    const spy = vi.spyOn(settings, 'setItem').mockImplementation((key, value) => {
        if (key === 'schemaVersion' && value === '2.1') return Promise.reject(new Error('simulated interruption'));
        return write(key, value);
    });
    const { safelyMigrate } = await import('@store/migration/migration.service.js');
    await expect(safelyMigrate(scope)).rejects.toThrow(/simulated interruption/);
    spy.mockRestore();
    vi.resetModules();
    const resumed = await import('@store/migration/migration.service.js');
    await resumed.safelyMigrate(scope);
    expect(await settings.getItem('schemaVersion')).toBe('3.0');
    expect(await otherStore.getItem('Unchanged')).toEqual({ value: 42 });
    expect(await ns.getStoreFor(ns.StoreName.IMAGES, scope).keys()).toEqual(['photo']);
});

it.each(['1.3.0', '1.7.0', '2.4.0', '3.0.0'])('isolates and migrates browser patch marker %s, preserving the original', async version => {
    const { ns, scope } = await seed(version, null, '');
    const { inventoryScope, prepareLegacyTransition } = await import('@store/migration/legacy-transition.js');
    const before = await inventoryScope(scope);
    const { state } = await prepareLegacyTransition();
    const target = ns.localScope(state.entry.id, state.destination);
    expect(await ns.getStoreFor(ns.StoreName.SETTINGS, target).getItem('schemaVersion')).toBe('3.0');
    expect(await inventoryScope(scope)).toEqual(before);
    const map = await ns.getStoreFor(ns.StoreName.MAPS, target).getItem('M');
    expect(await ns.getStoreFor(ns.StoreName.IMAGES, target).getItem(map.features.images[0].properties.id)).toEqual(new Uint8Array([1, 2, 3]));
    if (version === '1.3.0') expect(map.features.points[0].properties.layerId).toBe('default');
});

it.each([['3.1', '2.4'], ['2.4', '3.1'], ['broken', '2.4'], ['2.4', 'broken']])(
    'rejects incompatible browser markers %s/%s before copying or changing the origin', async (settings, record) => {
        const { ns, scope } = await seed(settings, record, '');
        const { inventoryScope, prepareLegacyTransition } = await import('@store/migration/legacy-transition.js');
        const before = await inventoryScope(scope);
        await expect(prepareLegacyTransition()).rejects.toThrow();
        expect(await inventoryScope(scope)).toEqual(before);
        expect(await ns.readLocalAtlasRegistry()).toEqual([]);
    });

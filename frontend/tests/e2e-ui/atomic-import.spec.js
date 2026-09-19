// Path: tests/e2e-ui/atomic-import.spec.js
import { test, expect } from '@playwright/test';
import { readState } from './state.js';

test.describe.configure({ retries: 0 });

async function boot(page) {
    const state = readState();
    expect(state.skip).toBe(false);
    await page.goto('/');
    await page.waitForFunction(() => typeof globalThis.__ebgeoSwitchAtlas === 'function', null, { timeout: 45000 });
    await expect(page.locator('.loading-background')).toHaveCount(0);
}

test('interrupted preparation preserves the original across a real reload', async ({ page }) => {
    await boot(page);
    const original = await page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const scope = ns.getActiveScope();
        await ns.getStore(ns.StoreName.IMAGES).setItem('original-photo', new Blob(['original bytes'], { type: 'image/png' }));
        const { replaceAtlasFromImport } = await import('/src/js/account/open-atlas.service.js');
        globalThis.__preparation = replaceAtlasFromImport(scope, 'Interrupted', async destination => {
            await ns.getStoreFor(ns.StoreName.MAPS, destination).setItem('partial', { name: 'Partial' });
            globalThis.__preparingScope = destination;
            await new Promise(() => {});
        });
        return scope;
    });
    await page.waitForFunction(() => globalThis.__preparingScope);
    await boot(page);
    const result = await page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        return { scope: ns.getActiveScope(), bytes: await (await ns.getStore(ns.StoreName.IMAGES).getItem('original-photo')).text(),
            journals: (await ns.getGlobalStore().keys()).filter(key => key.startsWith('__local_atlas_import__:')) };
    });
    expect(result).toEqual({ scope: original, bytes: 'original bytes', journals: [] });
});

test('quota failure importing an actual archive keeps maps and images, then retry succeeds', async ({ page }, testInfo) => {
    await boot(page);
    await page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        await ns.getStore(ns.StoreName.IMAGES).setItem('original-photo', new Blob(['original bytes']));
        globalThis.__originalScope = ns.getActiveScope();
        const { getControl } = await import('/src/js/store/index.js');
        const service = getControl('exportImport');
        // Use the application's own ZIP export, with an image, as the import fixture.
        const JSZip = (await import('/node_modules/.vite/deps/jszip.js')).default;
        const zip = new JSZip();
        zip.file('data.json', JSON.stringify({ version: '3.0', currentMap: 'Imported', maps: { Imported: { features: {} } } }));
        zip.file('images/photo.png', new Uint8Array([1, 2, 3]));
        globalThis.__archive = new File([await zip.generateAsync({ type: 'blob' })], 'Imported.ebgeo');
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
            if (this.transaction.db.name.startsWith('ebgeo_images__import-')) throw new DOMException('Injected quota', 'QuotaExceededError');
            return put.apply(this, args);
        };
        try { await service.processFileDirectly(globalThis.__archive); } finally { IDBObjectStore.prototype.put = put; }
    });
    await expect(page.getByText(/O atlas anterior foi preservado/)).toBeVisible();
    expect(await page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        return { unchanged: ns.getActiveScope().dbSuffix === globalThis.__originalScope.dbSuffix,
            photo: await (await ns.getStore(ns.StoreName.IMAGES).getItem('original-photo')).text() };
    })).toEqual({ unchanged: true, photo: 'original bytes' });
    await page.screenshot({ path: testInfo.outputPath('quota-preserva-original.png') });
    await page.evaluate(async () => {
        const { getControl } = await import('/src/js/store/index.js');
        await getControl('exportImport').processFileDirectly(globalThis.__archive);
    });
    await expect(page.getByText('1 mapa carregados!', { exact: true })).toBeVisible();
    await boot(page);
    const restored = await page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const names = [];
        await ns.getStore(ns.StoreName.MAPS).iterate(map => { names.push(map.name); });
        return { names, images: await ns.getStore(ns.StoreName.IMAGES).keys() };
    });
    expect(restored).toEqual({ names: ['Imported'], images: ['photo'] });
});

test('a reload after publication but before mounting opens the complete replacement', async ({ page }) => {
    await boot(page);
    const published = await page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const api = await import('/src/js/store/local-atlas.api.js');
        const { prepareEbgeoScope } = await import('/src/js/import_export/prepare-ebgeo-scope.js');
        const source = ns.getActiveScope();
        const result = await api.importLocalAtlasAtomically({ targetId: source.atlasId, expectedSuffix: source.dbSuffix },
            (scope, entry) => prepareEbgeoScope(scope, entry, { maps: { Completed: { features: {} } } }, { files: {} }));
        return { entry: result.atlas, mountedSuffix: ns.getActiveScope().dbSuffix };
    });
    expect(published.entry.dbSuffix).not.toBe(published.mountedSuffix);
    await boot(page);
    const restored = await page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const maps = [];
        await ns.getStore(ns.StoreName.MAPS).iterate(map => { maps.push(map.name); });
        return { scope: ns.getActiveScope(), maps };
    });
    expect(restored.scope.dbSuffix).toBe(published.entry.dbSuffix);
    expect(restored.maps).toEqual(['Completed']);
});

test('additive image-write failure preserves the old atlas; retry and reload preserve both image identities', async ({ page }, testInfo) => {
    await boot(page);
    const before = await page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const original = ns.getActiveScope();
        await ns.getStore(ns.StoreName.IMAGES).setItem('photo', new Blob(['original bytes']));
        const JSZip = (await import('/node_modules/.vite/deps/jszip.js')).default;
        const zip = new JSZip();
        zip.file('data.json', JSON.stringify({ version: '3.0', maps: { Principal: { features: { images: [{ type: 'Feature',
            geometry: { type: 'Point', coordinates: [-47, -15] }, properties: { id: 'photo', source: 'image' } }] } } } }));
        const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
        zip.file('images/photo.png', png);
        globalThis.__additiveArchive = new File([await zip.generateAsync({ type: 'blob' })], 'Append.ebgeo');
        const { getControl } = await import('/src/js/store/index.js');
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
            if (this.transaction.db.name.startsWith('ebgeo_images__import-') && args[1] !== 'photo') throw new DOMException('Injected quota', 'QuotaExceededError');
            return put.apply(this, args);
        };
        try { await getControl('exportImport').processFileDirectly(globalThis.__additiveArchive, true); } finally { IDBObjectStore.prototype.put = put; }
        return { original, after: ns.getActiveScope(), keys: await ns.getStore(ns.StoreName.MAPS).keys(),
            bytes: await (await ns.getStore(ns.StoreName.IMAGES).getItem('photo')).text() };
    });
    expect(before.after).toEqual(before.original);
    expect(before.keys).toHaveLength(1);
    expect(before.bytes).toBe('original bytes');
    await page.screenshot({ path: testInfo.outputPath('additive-quota-original.png') });
    await page.evaluate(async () => {
        const { getControl } = await import('/src/js/store/index.js');
        await getControl('exportImport').processFileDirectly(globalThis.__additiveArchive, true);
    });
    await expect(page.getByText('1 mapa adicionados!', { exact: true })).toBeVisible();
    await boot(page);
    const result = await page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const maps = [];
        await ns.getStore(ns.StoreName.MAPS).iterate(map => { maps.push(map); });
        const photoId = maps.find(map => map.name === 'Principal_1').features.images[0].properties.id;
        const image = await createImageBitmap(await ns.getStore(ns.StoreName.IMAGES).getItem(photoId));
        return { names: maps.map(map => map.name).sort(), photoId, decoded: [image.width, image.height],
            original: await (await ns.getStore(ns.StoreName.IMAGES).getItem('photo')).text() };
    });
    expect(result.names).toEqual(['Principal', 'Principal_1']);
    expect(result.photoId).not.toBe('photo');
    expect(result.decoded).toEqual([1, 1]);
    expect(result.original).toBe('original bytes');
});

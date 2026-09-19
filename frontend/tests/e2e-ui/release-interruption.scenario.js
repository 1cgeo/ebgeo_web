import { test, expect } from '@playwright/test';
import { readState } from './state.js';

test.beforeAll(() => expect(readState().skip, 'backend obrigatório').toBe(false));

test('edição ainda não gravada avisa ao fechar; após o commit deixa de bloquear', async ({ page }) => {
    await blank(page);
    await page.evaluate(async () => {
        const { DebouncedPersist } = await import('/src/js/utilities/debounced-persist.js');
        const button = document.createElement('button');
        button.textContent = 'Editar';
        document.body.append(button);
        const persist = new DebouncedPersist({ delay: 10000, warnBeforeUnload: true });
        button.onclick = () => persist.schedule('style', () => new Promise(resolve => { globalThis.finishSave = resolve; }));
        globalThis.flushEdit = () => persist.flush('style');
    });
    await page.getByRole('button', { name: 'Editar' }).click();
    const dialogSeen = page.waitForEvent('dialog');
    await page.close({ runBeforeUnload: true });
    const dialog = await dialogSeen;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    expect(page.isClosed()).toBe(false);
    await page.evaluate(() => { globalThis.flushTask = globalThis.flushEdit(); });
    await page.waitForFunction(() => Boolean(globalThis.finishSave));
    await page.evaluate(async () => { globalThis.finishSave(); await globalThis.flushTask; });
    let extraDialog = false;
    page.on('dialog', async dialog => { extraDialog = true; await dialog.accept(); });
    await page.reload();
    expect(extraDialog).toBe(false);
});

async function blank(page) {
    await page.route('**/__release_interrupt__', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><title>Interrupção</title>'
    }));
    await page.goto('/__release_interrupt__');
}

test('fechar a aba no meio da cópia não publica destino parcial; novo boot limpa a preparação', async ({ context }) => {
    const page = await context.newPage();
    await blank(page);
    const original = await page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const api = await import('/src/js/store/local-atlas.api.js');
        const { current } = await api.initLocalAtlases();
        const scope = api.scopeOfLocalAtlas(current);
        await ns.getStoreFor(ns.StoreName.MAPS, scope).setItem('mapa', { name: 'Original', features: { points: [{ id: 'intacto' }] } });
        await ns.getStoreFor(ns.StoreName.IMAGES, scope).setItem('foto', new Blob(['imagem original']));
        const arrayBuffer = Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer = function () {
            if (this.size === 15) {
                globalThis.copyPaused = true;
                return new Promise(() => {});
            }
            return arrayBuffer.call(this);
        };
        globalThis.copyTask = api.duplicateLocalAtlas(current.id, 'Cópia interrompida');
        return current;
    });
    await page.waitForFunction(() => globalThis.copyPaused === true);
    const pending = await page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const store = ns.getGlobalStore();
        const key = (await store.keys()).find(key => key.startsWith('__local_atlas_copy__:'));
        return { entry: await store.getItem(key), registry: await ns.readLocalAtlasRegistry() };
    });
    expect(pending.registry.map(entry => entry.id)).toEqual([original.id]);
    expect(pending.entry.name).toBe('Cópia interrompida');
    await page.close(); // kills the JS task and releases the cross-tab Web Lock
    const reopened = await context.newPage();
    await blank(reopened);
    const recovered = await reopened.evaluate(async ({ original, pending }) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const api = await import('/src/js/store/local-atlas.api.js');
        const state = await api.initLocalAtlases();
        const scope = api.scopeOfLocalAtlas(original);
        const image = await ns.getStoreFor(ns.StoreName.IMAGES, scope).getItem('foto');
        return { entries: state.atlases, journal: (await ns.getGlobalStore().keys()).filter(key => key.startsWith('__local_atlas_copy__:')),
            partialDatabases: (await indexedDB.databases()).filter(db => db.name.includes(pending.entry.dbSuffix)),
            map: await ns.getStoreFor(ns.StoreName.MAPS, scope).getItem('mapa'), image: await image.text() };
    }, { original, pending });
    expect(recovered.entries.map(entry => entry.id)).toEqual([original.id]);
    expect(recovered.journal).toEqual([]);
    expect(recovered.partialDatabases).toEqual([]);
    expect(recovered.map.features.points).toEqual([{ id: 'intacto' }]);
    expect(recovered.image).toBe('imagem original');
});

for (const loseRegistry of [false, true]) {
test(`cópia publicada com journal pendente é preservada ${loseRegistry ? 'pelo espelho após perder o registro' : 'pelo registro'}`, async ({ page }) => {
    await blank(page);
    const copied = await page.evaluate(async loseRegistry => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const api = await import('/src/js/store/local-atlas.api.js');
        const { current } = await api.initLocalAtlases();
        await ns.getStoreFor(ns.StoreName.MAPS, api.scopeOfLocalAtlas(current)).setItem('mapa', { name: 'Preservado' });
        const copy = await api.duplicateLocalAtlas(current.id, 'Cópia concluída');
        // Durable state of a crash between the registry commit and journal removal.
        await ns.getGlobalStore().setItem('__local_atlas_copy__:' + copy.atlas.id, copy.atlas);
        if (loseRegistry) {
            const store = ns.getGlobalStore();
            for (const key of await store.keys()) {
                if (ns.isLocalAtlasRegistryKey(key) || key === ns.GlobalKey.LOCAL_ATLASES) await store.removeItem(key);
            }
        }
        return copy.atlas;
    }, loseRegistry);
    await page.reload();
    const result = await page.evaluate(async copied => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const api = await import('/src/js/store/local-atlas.api.js');
        const state = await api.initLocalAtlases();
        return { entries: state.atlases, map: await ns.getStoreFor(ns.StoreName.MAPS, api.scopeOfLocalAtlas(copied)).getItem('mapa') };
    }, copied);
    expect(result.entries.some(entry => entry.id === copied.id)).toBe(true);
    expect(result.map).toEqual({ name: 'Preservado' });
});
}

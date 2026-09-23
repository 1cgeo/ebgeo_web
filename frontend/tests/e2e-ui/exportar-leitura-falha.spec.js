// Path: tests/e2e-ui/exportar-leitura-falha.spec.js
// Fail the IndexedDB read, then use the real export buttons to cancel or save an explicit partial file.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Falha de leitura durante exportação', () => {
    test('avisa, permite cancelar e só baixa a cópia parcial depois da confirmação', async ({ page }, testInfo) => {
        test.setTimeout(120000);
        await page.addInitScript(() => {
            const get = IDBObjectStore.prototype.get;
            IDBObjectStore.prototype.get = function (...args) {
                if (window.__failGroupReads && this.transaction.db.name.startsWith('ebgeo_groups')) {
                    throw new DOMException('Injected unavailable group database', 'InvalidStateError');
                }
                return get.apply(this, args);
            };
        });
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
        await page.waitForFunction(() => !!globalThis.__ebgeoMap?.getZoom);
        await expect(page.locator('.loading-background')).toHaveCount(0);
        const source = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const { getRepository } = await import('/src/js/store/repositories/index.js');
            const name = await store.getCurrentMapName();
            const id = crypto.randomUUID();
            const groups = { [id]: { id, name: 'Grupo que deve continuar na origem', features: [] } };
            await getRepository().saveGroups(name, groups);
            return { name, groups: await getRepository().getGroups(name) };
        });
        expect(Object.keys(source.groups)).toHaveLength(1);
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        const downloads = [];
        page.on('download', download => downloads.push(download));

        async function requestExport() {
            await page.locator('#maps-action-save').click();
            await expect(page.locator('.export-modal-container')).toBeVisible();
            await page.evaluate(() => { window.__failGroupReads = true; });
            await page.locator('.export-modal-btn-confirm').click();
            const warning = page.locator('.confirm-modal-container');
            await expect(warning.locator('.confirm-modal-title')).toHaveText('Não foi possível ler parte do atlas');
            await expect(warning).toContainText(`grupos no mapa "${source.name}"`);
            return warning;
        }

        const first = await requestExport();
        await page.screenshot({ path: testInfo.outputPath('aviso-exportacao-parcial.png'), fullPage: true });
        await first.locator('.confirm-modal-btn-cancel').click();
        await expect(first).not.toBeVisible();
        expect(downloads).toHaveLength(0);

        const second = await requestExport();
        const downloading = page.waitForEvent('download');
        await second.locator('.confirm-modal-btn-confirm').click();
        const file = testInfo.outputPath('copia-parcial.ebgeo');
        await (await downloading).saveAs(file);
        await expect(page.locator('.toast', { hasText: 'Cópia parcial exportada.' })).toBeVisible();
        const bytes = await readFile(file);
        const zip = await JSZip.loadAsync(bytes.subarray(6).map(byte => byte ^ 0xAA));
        const document = JSON.parse(await zip.file('data.json').async('string'));
        expect(Object.keys(document.maps)).toContain(source.name);
        expect(Object.keys(document.groups)).toEqual([]);

        await page.evaluate(() => { window.__failGroupReads = false; });
        await page.reload();
        await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
        await expect(page.locator('.loading-background')).toHaveCount(0, { timeout: 30000 });
        const groups = await page.evaluate(async name => {
            const { getRepository } = await import('/src/js/store/repositories/index.js');
            return getRepository().getGroups(name);
        }, source.name);
        expect(groups).toEqual(source.groups);
    });
});

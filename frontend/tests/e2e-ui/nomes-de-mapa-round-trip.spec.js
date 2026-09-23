// Path: tests/e2e-ui/nomes-de-mapa-round-trip.spec.js
// User map names must survive the actual file picker, download and a fresh reload.
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const names = ['__proto__', 'constructor', 'toString'];

async function waitForMap(page) {
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(() => !!globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
    // Both MapLibre and the account toolbar exist before the atlas finishes mounting.
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 30000 });
    await expect(page.locator('.loading-background')).toHaveCount(0, { timeout: 30000 });
}

async function importFile(page, file) {
    await page.goto('/atlas.html');
    await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible();
    await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(file);
    await page.waitForURL(url => !url.pathname.endsWith('atlas.html'));
    await waitForMap(page);
    await expect(page.locator('.toast', { hasText: '3 mapas carregados.' })).toBeVisible({ timeout: 60000 });
}

describeOrSkip('Nomes de mapa no arquivo', () => {
test('nomes de propriedades JavaScript preservam mapas e pontos no arquivo e depois de F5', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    test.info().annotations.push({ type: 'regression', description: 'Map names are data, including __proto__.' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const maps = Object.fromEntries(names.map((name, index) => [name, {
        id: randomUUID(), name,
        position: { center_lat: -22, center_long: -43, zoom: 8, bearing: 0, pitch: 0 },
        features: { points: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-43 + index / 10, -22] },
            properties: { id: randomUUID(), source: 'point', nome: `Ponto ${name}`, color: '#ff0000' } }] },
    }]));
    const zip = new JSZip();
    zip.file('data.json', JSON.stringify({ version: '2.4', maps, currentMap: names[0], mapOrder: names }));
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const buffer = Buffer.concat([Buffer.from('EBGXOR'), bytes.map(byte => byte ^ 0xAA)]);
    await importFile(page, { name: 'nomes.ebgeo', mimeType: 'application/octet-stream', buffer });
    await page.reload();
    await waitForMap(page);
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await expect(page.locator('.maps-tab .map-list-item[data-map-name]')).toHaveCount(3);
    await page.locator('#maps-action-save').click();
    const modal = page.locator('.export-modal-container');
    await expect(modal.locator('.export-map-item')).toHaveCount(3);
    const downloading = page.waitForEvent('download');
    await modal.locator('.export-modal-btn-confirm').click();
    const download = await downloading;
    const path = testInfo.outputPath('nomes-round-trip.ebgeo');
    await download.saveAs(path);
    const exportedBytes = await readFile(path);
    expect(exportedBytes.subarray(0, 6).toString()).toBe('EBGXOR');
    const exportedZip = await JSZip.loadAsync(exportedBytes.subarray(6).map(byte => byte ^ 0xAA));
    const exported = JSON.parse(await exportedZip.file('data.json').async('string'));
    expect(Object.keys(exported.maps).sort()).toEqual([...names].sort());
    for (const name of names) {
        expect(exported.maps[name].features.points).toEqual(maps[name].features.points);
    }
    await importFile(page, path);
    await page.reload();
    await waitForMap(page);
    const actual = await page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const mapNames = await store.getAllMapNamesStore();
        // Transport pairs, not an object: Playwright's serializer itself assigns object keys.
        return Promise.all(mapNames.sort().map(async name => [name,
            (await store.getCurrentMapFeatures(name)).points.map(point => point.properties.nome)]));
    });
    expect(actual).toEqual([...names].sort().map(name => [name, [`Ponto ${name}`]]));
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await expect(page.locator('.maps-tab .map-list-item[data-map-name]')).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath('nomes-preservados.png'), fullPage: true });
    expect(errors).toEqual([]);
});
});

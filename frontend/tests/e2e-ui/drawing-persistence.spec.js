import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

const cases = [
    ['point', 'points', 'draw', 'single'],
    ['text', 'texts', 'draw', 'single'],
    ['line', 'lines', 'draw', 'vertices'],
    ['polygon', 'polygons', 'draw', 'vertices'],
    ['rectangle', 'rectangles', 'draw', 'pair'],
    ['circle', 'circles', 'draw', 'pair'],
    ['ellipse', 'ellipses', 'draw', 'pair'],
    ['sector', 'setores', 'draw', 'pair'],
    ['brush', 'brushes', 'draw', 'stroke'],
    ['arrow', 'arrows', 'military', 'vertices'],
    ['boundary', 'boundarys', 'military', 'vertices'],
    ['engineeringSymbol', 'engineering_symbols', 'military', 'single'],
    ['coordination', 'coordination_measures', 'military', 'single'],
    ['declination', 'magnetic_declinations', 'military', 'single'],
    ['occupiedFront', 'occupied_fronts', 'military', 'pair'],
    ['coordinationLine', 'coordination_lines', 'military', 'vertices'],
    ['militarySymbol', 'military_symbols', 'military', 'single'],
];

for (const [tool, storage, group, gesture] of cases) {
    test(`${tool}: a real drawing is stored, displayed and preserved after reload`, async ({ page }) => {
        const read = () => page.evaluate(async storage => {
            const store = await import('/src/js/store/index.js');
            return (await store.getCurrentMapFeatures())[storage] ?? [];
        }, storage);
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect.poll(() => page.evaluate(async () =>
            (await import('/src/js/store/index.js')).getCurrentMapNameSync())).toEqual(expect.any(String));
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await page.locator(`.toolbar-group[data-group-id="${group}"] .toolbar-group-btn`).click();
        await page.locator(`[data-tool-id="${tool}"]`).click();
        await expect(page.locator(`[data-tool-id="${tool}"]`)).toHaveAttribute('data-active', 'true');
        if (gesture === 'stroke') {
            await page.mouse.move(520, 300);
            await page.mouse.down();
            await page.mouse.move(650, 430, { steps: 8 });
            await page.mouse.move(790, 300, { steps: 8 });
            await page.mouse.up();
        } else {
            await page.mouse.click(520, 300);
            if (gesture !== 'single') await page.mouse.click(650, 430);
            if (gesture === 'vertices') await page.mouse.click(790, 300, { button: 'right' });
        }
        await expect.poll(async () => (await read()).length).toBe(1);
        const [saved] = await read();
        expect(saved.properties.id).toEqual(expect.any(String));
        expect(saved.geometry.coordinates.length).toBeGreaterThan(0);
        const visibleIds = () => page.evaluate(async storage => {
            const source = globalThis.__ebgeoMap?.getSource(storage);
            return source ? (await source.getData()).features.map(f => f.properties.id) : [];
        }, storage);
        await expect.poll(visibleIds).toEqual([saved.properties.id]);
        await page.reload();
        await expect.poll(async () => (await read()).map(f => f.properties.id)).toEqual([saved.properties.id]);
        expect((await read())[0].geometry).toEqual(saved.geometry);
        await expect.poll(visibleIds).toEqual([saved.properties.id]);
    });
}

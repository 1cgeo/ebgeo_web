import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';
import { readFeatures } from './helpers/collab-helpers.js';

const state = readState();
test.skip(state.skip, 'Requires the real backend for application configuration');
test.describe.configure({ retries: 0 });

const read = page => readFeatures(page, 'engineering_symbols');

test('engineering symbol: real drawing, validation, cancel, apply, undo and durable reload', async ({ page }, info) => {
    test.setTimeout(120000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#toolbar-container')).toBeVisible({ timeout: 30000 });
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await page.locator('.toolbar-tool-btn[data-tool-id="engineeringSymbol"]').click();
    await esperarFerramentaPronta(page, 'engineeringSymbol');
    const canvas = page.locator('#map-sig .maplibregl-canvas');
    await canvas.click({ position: { x: 630, y: 340 } });
    await expect.poll(async () => (await read(page)).length).toBe(1);
    const initial = (await read(page))[0];
    expect(initial.props.source).toBe('engineering_symbol');
    expect(initial.props.pointCode).toBe('9');
    await page.getByRole('button', { name: 'Configurar Símbolo', exact: true }).click();
    const dialog = page.locator('.point-selector-modal-container');
    const bridgeClass = dialog.locator('.coord-text-field').filter({ hasText: 'Classe da ponte' }).locator('input');
    await bridgeClass.fill('abc');
    await expect(dialog.locator('.point-selector-btn-apply')).toBeDisabled();
    await expect(dialog.locator('.engineering-error')).not.toBeEmpty();
    await bridgeClass.fill('95');
    await expect(dialog.locator('.point-selector-btn-apply')).toBeEnabled();
    await dialog.locator('.point-selector-btn-cancel').click();
    expect((await read(page))[0].props.engineering).toEqual(initial.props.engineering);
    await page.getByRole('button', { name: 'Configurar Símbolo', exact: true }).click();
    await bridgeClass.fill('95');
    await expect(dialog.locator('.engineering-preview')).toContainText('95');
    await page.screenshot({ path: info.outputPath('engineering-bridge-config.png'), animations: 'disabled' });
    await dialog.locator('.point-selector-btn-apply').click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(async () => (await read(page))[0].props.engineering.values.class).toBe('95');
    await page.evaluate(async () => {
        const { getEventBus } = await import('/src/js/store/services.js');
        const { EventTypes } = await import('/src/js/events/event_types.js');
        globalThis.__engineeringRebuilds = 0;
        getEventBus().on(EventTypes.BASE_LAYER_CHANGED, () => { globalThis.__engineeringRebuilds++; });
    });
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await read(page))[0]?.props.engineering.values.class).toBe(initial.props.engineering.values.class);
    // MapLibre can already be loaded while the application still rebuilds its features.
    // Observe the existing completion event before issuing the next keyboard gesture.
    await page.waitForFunction(() => globalThis.__engineeringRebuilds === 1);
    await page.keyboard.press('Control+y');
    await expect.poll(async () => (await read(page))[0]?.props.engineering.values.class).toBe('95');
    await page.waitForFunction(() => globalThis.__engineeringRebuilds === 2);
    await page.reload();
    await expect.poll(async () => (await read(page))[0]?.props.engineering.values.class).toBe('95');
    const bitmap = await page.evaluate(async id => {
        const store = await import('/src/js/store/index.js');
        const blob = await store.getImage(id);
        const image = await createImageBitmap(blob);
        const size = { width: image.width, height: image.height, bytes: blob.size };
        image.close();
        return size;
    }, initial.props.id);
    expect(bitmap.width).toBeGreaterThan(20);
    expect(bitmap.height).toBeGreaterThan(20);
    expect(bitmap.bytes).toBeGreaterThan(100);
    expect(errors).toEqual([]);
});

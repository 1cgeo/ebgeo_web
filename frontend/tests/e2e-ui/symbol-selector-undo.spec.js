import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';
import { readFeatures } from './helpers/collab-helpers.js';

const state = readState();
test.skip(state.skip, 'Requires the real backend');
test.describe.configure({ retries: 0 });

for (const cfg of [
    { tool: 'militarySymbol', source: 'military_symbols', modal: '.symbol-selector-modal-container', field: '.text-modifiers__field', label: 'Designação', prop: 'uniqueDesignation' },
    { tool: 'coordination', active: 'coordinationMeasure', source: 'coordination_measures', modal: '.point-selector-modal-container', field: '.coord-text-field', label: 'Identificação', prop: 'identificacao' },
]) {
    test(`${cfg.tool}: apply is one durable edit that can be undone and redone`, async ({ page }) => {
        test.setTimeout(120000);
        const read = () => readFeatures(page, cfg.source);
        await page.goto('/');
        await expect(page.locator('#toolbar-container')).toBeVisible({ timeout: 30000 });
        await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
        await page.locator(`.toolbar-tool-btn[data-tool-id="${cfg.tool}"]`).click();
        await esperarFerramentaPronta(page, cfg.active ?? cfg.tool);
        await page.locator('#map-sig .maplibregl-canvas').click({ position: { x: 630, y: 340 } });
        await expect.poll(async () => (await read()).length).toBe(1);
        const original = (await read())[0].props[cfg.prop] ?? null;
        await page.getByRole('button', { name: 'Configurar Símbolo', exact: true }).click();
        const modal = page.locator(cfg.modal);
        if (cfg.tool === 'militarySymbol') await modal.getByRole('button', { name: 'Texto', exact: true }).click();
        await modal.locator(cfg.field).filter({ hasText: cfg.label }).locator('input').fill('AUDIT SYMBOL');
        await modal.getByRole('button', { name: 'Aplicar', exact: true }).click();
        await expect(modal).not.toBeVisible();
        await expect.poll(async () => (await read())[0].props[cfg.prop]).toBe('AUDIT SYMBOL');
        await page.evaluate(async () => {
            const { getEventBus } = await import('/src/js/store/services.js');
            const { EventTypes } = await import('/src/js/events/event_types.js');
            globalThis.__symbolRebuilds = 0;
            getEventBus().on(EventTypes.BASE_LAYER_CHANGED, () => { globalThis.__symbolRebuilds++; });
        });
        await page.keyboard.press('Control+z');
        await expect.poll(async () => (await read())[0]?.props[cfg.prop] ?? null).toBe(original);
        await page.waitForFunction(() => globalThis.__symbolRebuilds === 1);
        await page.keyboard.press('Control+y');
        await expect.poll(async () => (await read())[0]?.props[cfg.prop]).toBe('AUDIT SYMBOL');
        await page.waitForFunction(() => globalThis.__symbolRebuilds === 2);
        await page.reload();
        await expect.poll(async () => (await read())[0]?.props[cfg.prop]).toBe('AUDIT SYMBOL');
    });
}

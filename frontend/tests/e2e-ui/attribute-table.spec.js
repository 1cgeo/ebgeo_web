// Path: e2e-ui/attribute-table.spec.js

/**
 * §18.1-3,7,10-14 Attribute Table — local (🟢) pure-UI interactions driven by REAL
 * clicks in real Chromium, with NO backend. Features are seeded LOCALLY through the
 * real draw flow (point/line tools → canvas clicks → store.addFeature), so the table
 * has rows without any server. The table is then opened from the real layers tab
 * ("camadas") "Tabela de atributos" button (.table-toggle), and we assert REAL
 * observable effects on the rendered panel: it becomes visible with rows; sorting a
 * column flips its data-sort and reorders the rendered name cells; the global search
 * filters the rendered rows; toggling a type-filter chip filters rows by feature type;
 * minimize flips the panel data-state and close removes the panel. The app boots from
 * the Vite dev server; no login is needed (the toolbar + sidebar render on boot).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D map + toolbar + sidebar to be ready. */
async function bootApp(page) {
    await page.goto('/');
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () =>
            globalThis.__ebgeoMap &&
            typeof globalThis.__ebgeoMap.getZoom === 'function' &&
            globalThis.__ebgeoMap.loaded(),
        null,
        { timeout: 20000 },
    );
}

/** Returns the viewport-centre point of the live map canvas. */
async function canvasCenter(page) {
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    expect(box).not.toBeNull();
    return box;
}

/** Group button for the "Desenho" (draw) group. */
const drawGroupBtn = (page) =>
    page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn');

/** Tool button (inside the draw popup) by its tool id. */
const drawToolBtn = (page, toolId) =>
    page.locator(`.toolbar-group[data-group-id="draw"] .toolbar-tool-btn[data-tool-id="${toolId}"]`);

/** Opens the draw group's popup and activates the given draw tool. */
async function activateDrawTool(page, toolId) {
    await drawGroupBtn(page).click();
    await expect(
        page.locator('.toolbar-group[data-group-id="draw"] .toolbar-popup'),
    ).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    const btn = drawToolBtn(page, toolId);
    await btn.click();
    await expect(btn).toHaveAttribute('data-active', 'true', { timeout: 5000 });
}

/**
 * Creates `count` point features via the real draw flow. Each point: activate the
 * point tool then a single canvas click (the tool persists the feature and
 * self-deactivates), at distinct offsets so they are distinct features.
 */
async function seedPoints(page, count) {
    const box = await canvasCenter(page);
    for (let i = 0; i < count; i++) {
        await activateDrawTool(page, 'point');
        const x = box.x + box.width / 2 + (i - 1) * 60;
        const y = box.y + box.height / 2 + (i - 1) * 50;
        await page.mouse.click(x, y);
        // The point tool deactivates itself after creating the feature.
        await expect(drawGroupBtn(page)).toHaveAttribute('data-active', 'false', { timeout: 5000 });
    }
}

/**
 * Creates one line feature via the real draw flow: two left-clicks then a right-click
 * to finish (which appends the final vertex, persists the line, and deactivates).
 */
async function seedLine(page) {
    const box = await canvasCenter(page);
    await activateDrawTool(page, 'line');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.click(cx - 90, cy + 90);
    await page.mouse.click(cx + 90, cy + 90);
    await page.mouse.click(cx + 90, cy - 90, { button: 'right' });
    await expect(drawGroupBtn(page)).toHaveAttribute('data-active', 'false', { timeout: 5000 });
}

/** Opens the layers ("camadas") tab and clicks a layer's "Tabela de atributos" button. */
async function openAttributeTable(page) {
    await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    const tableBtn = page.locator('.table-toggle').first();
    await expect(tableBtn).toBeVisible({ timeout: 10000 });
    await tableBtn.click();
}

/** The attribute-table panel element. */
const panel = (page) => page.locator('.attribute-table-panel');
/** The rendered (non-empty) data rows. */
const rows = (page) => page.locator('.attribute-table-panel tr.attribute-table-row');
/** The rendered name-cell values, in DOM (= render) order. */
async function nameCells(page) {
    return rows(page).locator('td.attribute-table-cell-name .attribute-table-cell-value').allInnerTexts();
}

describeOrSkip('§18 Attribute table (real browser, local pure-UI)', () => {
    test('§18.1-3 opens from the layers-tab button and shows the seeded rows', async ({ page }) => {
        await bootApp(page);
        await seedPoints(page, 3);

        // Panel is not in the DOM until opened.
        await expect(panel(page)).toHaveCount(0);

        await openAttributeTable(page);

        await expect(panel(page)).toBeVisible({ timeout: 10000 });
        await expect(panel(page)).toHaveAttribute('data-state', 'expanded');
        // The three seeded points are rendered as data rows.
        await expect(rows(page)).toHaveCount(3, { timeout: 10000 });
    });

    test('§18.10-11 sorting the Nome column toggles asc/desc and reorders the rows', async ({ page }) => {
        await bootApp(page);
        await seedPoints(page, 3);
        await openAttributeTable(page);
        await expect(rows(page)).toHaveCount(3, { timeout: 10000 });

        const nameHeader = page.locator('.attribute-table-panel th[data-column-key="nome"]');

        // First click → ascending. The header advertises its sort direction.
        await nameHeader.click();
        await expect(nameHeader).toHaveAttribute('data-sort', 'asc', { timeout: 5000 });
        const ascOrder = await nameCells(page);
        const sortedAsc = [...ascOrder].sort((a, b) =>
            a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true }),
        );
        expect(ascOrder).toEqual(sortedAsc);

        // Second click → descending; the rendered order is the reverse of ascending.
        await nameHeader.click();
        await expect(nameHeader).toHaveAttribute('data-sort', 'desc', { timeout: 5000 });
        await expect.poll(async () => (await nameCells(page)).join('|'), { timeout: 5000 }).toBe(
            [...ascOrder].reverse().join('|'),
        );
    });

    test('§18.12 the global search filters the rendered rows', async ({ page }) => {
        await bootApp(page);
        await seedPoints(page, 3);
        await openAttributeTable(page);
        await expect(rows(page)).toHaveCount(3, { timeout: 10000 });

        // Pick a substring unique to exactly one seeded row's name.
        const names = await nameCells(page);
        const target = names[0];
        expect(target.length).toBeGreaterThan(0);

        const search = page.locator('.attribute-table-panel .attribute-table-search-input');
        await search.fill(target);
        // Search is debounced (300ms); poll until it narrows to the matching row.
        await expect.poll(async () => rows(page).count(), { timeout: 5000 }).toBe(1);
        await expect(rows(page).locator('td.attribute-table-cell-name .attribute-table-cell-value')).toHaveText(target);

        // Clearing the search restores all rows.
        await search.fill('');
        await expect.poll(async () => rows(page).count(), { timeout: 5000 }).toBe(3);
    });

    test('§18.13 toggling a type-filter chip filters rows by feature type', async ({ page }) => {
        await bootApp(page);
        await seedPoints(page, 2);
        await seedLine(page);
        await openAttributeTable(page);
        // 2 points + 1 line.
        await expect(rows(page)).toHaveCount(3, { timeout: 10000 });

        // Two type chips render (point + line); all start active (= all rows shown).
        const pointChip = page.locator('.attribute-table-panel .attribute-table-type-chip[data-type="point"]');
        const lineChip = page.locator('.attribute-table-panel .attribute-table-type-chip[data-type="line"]');
        await expect(pointChip).toBeVisible({ timeout: 5000 });
        await expect(lineChip).toBeVisible();
        await expect(pointChip).toHaveClass(/active/);
        await expect(lineChip).toHaveClass(/active/);

        // Clicking the "point" chip while all are active narrows to ONLY points.
        await pointChip.click();
        await expect(lineChip).not.toHaveClass(/active/, { timeout: 5000 });
        await expect.poll(async () => rows(page).count(), { timeout: 5000 }).toBe(2);
        // Every remaining row is a point feature.
        await expect(rows(page)).toHaveCount(2);
        const types = await rows(page).evaluateAll((trs) => trs.map((tr) => tr.dataset.featureType));
        expect(types.every((t) => t === 'point')).toBe(true);
    });

    test('§18.7,14 minimize collapses the panel and close removes it', async ({ page }) => {
        await bootApp(page);
        await seedPoints(page, 2);
        await openAttributeTable(page);
        await expect(panel(page)).toHaveAttribute('data-state', 'expanded', { timeout: 10000 });

        // §18.7 Minimize flips the panel state to "minimized".
        await page.locator('.attribute-table-panel .attribute-table-minimize-btn').click();
        await expect(panel(page)).toHaveAttribute('data-state', 'minimized', { timeout: 5000 });

        // Maximize again restores the expanded state.
        await page.locator('.attribute-table-panel .attribute-table-minimize-btn').click();
        await expect(panel(page)).toHaveAttribute('data-state', 'expanded', { timeout: 5000 });

        // §18.14 Close removes the panel from the DOM entirely.
        await page.locator('.attribute-table-panel .attribute-table-close-btn').click();
        await expect(panel(page)).toHaveCount(0, { timeout: 5000 });
    });
});

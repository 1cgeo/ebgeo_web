// Path: e2e-ui/browser-view-mode.spec.js

/**
 * Frente 8 / D1 — safe view ↔ edit. A role that cannot edit the connected remote atlas (a
 * Visualizador shared at 'read') is locked to the safe view: the create/edit toolbars
 * (draw/military/analysis) are hidden via the `is-view-only` body class. The owner edits normally and
 * can toggle the safe view voluntarily with Shift+E.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, openLayersTab, setSharePermission } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const hasViewOnly = (page) => page.evaluate(() => document.body.classList.contains('is-view-only'));

describeOrSkip('Safe view ↔ edit (NORMAL_VIEW)', () => {
    test('a Visualizador is locked to the safe view; the owner edits and can toggle it (Shift+E)', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'read' });
        const owner = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const viewer = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Viewer: safe view applied → no create toolbars.
            await expect.poll(() => hasViewOnly(viewer), { timeout: 15000 }).toBe(true);
            await expect(viewer.locator('.toolbar-group[data-group-id="draw"]')).toBeHidden();

            // Owner: full edit → toolbars visible.
            await expect.poll(() => hasViewOnly(owner), { timeout: 15000 }).toBe(false);
            await expect(owner.locator('.toolbar-group[data-group-id="draw"]')).toBeVisible();

            // Owner toggles into the safe view voluntarily (Shift+E), then back.
            await owner.locator('#map-sig').click({ position: { x: 220, y: 220 } });
            await owner.keyboard.press('Shift+E');
            await expect.poll(() => hasViewOnly(owner), { timeout: 5000 }).toBe(true);
            await expect(owner.locator('.toolbar-group[data-group-id="draw"]')).toBeHidden();

            await owner.keyboard.press('Shift+E');
            await expect.poll(() => hasViewOnly(owner), { timeout: 5000 }).toBe(false);
            await expect(owner.locator('.toolbar-group[data-group-id="draw"]')).toBeVisible();
        } finally {
            await owner.context().close();
            await viewer.context().close();
        }
    });

    test('a Visualizador sees a read-only legend (editing controls hidden in the layers tree)', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'read' });
        const owner = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const viewer = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            await expect.poll(() => hasViewOnly(viewer), { timeout: 15000 }).toBe(true);
            await openLayersTab(owner);
            await openLayersTab(viewer);

            // Owner: editing controls present (the "Nova camada" button + per-layer lock).
            await expect(owner.locator('.sidebar-section-header-btn.edit-affordance').first()).toBeVisible();
            await expect(owner.locator('.layer-controls .lock-toggle').first()).toBeVisible();

            // Viewer: those controls are hidden — a read-only legend.
            await expect(viewer.locator('.sidebar-section-header-btn.edit-affordance').first()).toBeHidden();
            await expect(viewer.locator('.layer-controls .lock-toggle').first()).toBeHidden();
            await expect(viewer.locator('.layer-delete-btn').first()).toBeHidden();
        } finally {
            await owner.context().close();
            await viewer.context().close();
        }
    });

    test('a live downgrade (write→read) engages the safe view without a reconnect', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const owner = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const editor = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Editor starts with full edit (write) → toolbars visible, not in the safe view.
            await expect.poll(() => hasViewOnly(editor), { timeout: 15000 }).toBe(false);
            await expect(editor.locator('.toolbar-group[data-group-id="draw"]')).toBeVisible();

            // Owner downgrades the editor to read-only — the sharing_updated broadcast carries the role.
            const status = await setSharePermission(owner, state.baseUrl, seed.userA, seed.atlasId, seed.userB.id, 'read');
            expect(status, 'PUT share permission succeeded').toBeLessThan(300);

            // The editor's UI re-gates LIVE (no reconnect): the safe view engages, draw toolbar hidden.
            await expect.poll(() => hasViewOnly(editor), { timeout: 15000 }).toBe(true);
            await expect(editor.locator('.toolbar-group[data-group-id="draw"]')).toBeHidden();
        } finally {
            await owner.context().close();
            await editor.context().close();
        }
    });
});

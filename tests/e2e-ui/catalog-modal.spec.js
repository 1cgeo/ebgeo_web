// Path: e2e-ui/catalog-modal.spec.js

/**
 * §19.1-3 External-layers catalog modal — local (🟢) pure-UI interactions driven by
 * REAL clicks/typing in real Chromium. The catalog modal is opened from its sidebar
 * chip (`#chip-catalog`), then asserted against REAL observable DOM effects: the
 * overlay's `data-visible` flips to "true"; typing a non-matching query in the search
 * input collapses the rendered grid to its empty state and clearing it restores the
 * cards; clicking a type filter (Modelos 3D / Imagens 360 / Análise / Dados) flips its
 * `data-active` and narrows the rendered `.catalog-card` set to that type; the close
 * (X) button hides the overlay. No backend writes and no login — the modal is local UI.
 *
 * The catalog chip only renders when the local dev config exposes catalog items
 * (tilesets / 360 / analysis / data layers). When the running config has none, the
 * chip is absent and every test self-skips at runtime (the modal cannot be exercised).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the sidebar chips + 2D map to be ready. */
async function bootApp(page) {
    await page.goto('/');
    await expect(page.locator('#chips-container')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/**
 * Opens the catalog modal from its chip and waits for the grid to render.
 * Skips the test at runtime when the local config exposes no catalog items
 * (the catalog chip is then never created).
 * @returns {Promise<import('@playwright/test').Locator>} the visible overlay locator
 */
async function openCatalog(page) {
    const chip = page.locator('#chip-catalog');
    if ((await chip.count()) === 0) {
        test.skip(true, 'no catalog items in local config (catalog chip not rendered)');
    }
    await expect(chip).toBeVisible({ timeout: 20000 });

    const overlay = page.locator('#catalog-modal-overlay');
    await expect(overlay).toHaveAttribute('data-visible', 'false');

    await chip.click();
    await expect(overlay).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await expect(overlay).toBeVisible();

    // Items load asynchronously after show(); wait for the grid to populate with cards.
    await expect(overlay.locator('.catalog-card').first()).toBeVisible({ timeout: 10000 });
    return overlay;
}

describeOrSkip('§19.1-3 External-layers catalog modal (real browser, local pure-UI)', () => {
    test('§19.1 opens from the catalog chip and closes via the X button', async ({ page }) => {
        await bootApp(page);
        const overlay = await openCatalog(page);

        // Real content rendered: the filters sidebar + at least one card.
        await expect(overlay.locator('.catalog-filter-btn').first()).toBeVisible();
        expect(await overlay.locator('.catalog-card').count()).toBeGreaterThan(0);

        // Close via the X button.
        await overlay.locator('.modal-close-btn').click();
        await expect(overlay).toHaveAttribute('data-visible', 'false', { timeout: 5000 });
    });

    test('§19.2 typing in the search filters the rendered card list', async ({ page }) => {
        await bootApp(page);
        const overlay = await openCatalog(page);

        const cards = overlay.locator('.catalog-card');
        const totalBefore = await cards.count();
        expect(totalBefore).toBeGreaterThan(0);

        // A query that matches nothing collapses the grid to its empty state.
        const search = overlay.locator('.catalog-search-input');
        await search.fill('zzz-no-such-item-zzz');
        await expect(overlay.locator('.catalog-empty')).toBeVisible({ timeout: 5000 });
        await expect(cards).toHaveCount(0);

        // Seeding the search with the first card's real name narrows to a non-empty,
        // strictly-smaller-or-equal subset that still contains a match.
        await search.fill('');
        await expect.poll(() => cards.count(), { timeout: 5000 }).toBe(totalBefore);
        const firstName = (await cards.first().innerText()).split('\n')[0].trim();
        const token = firstName.slice(0, Math.min(4, firstName.length));
        await search.fill(token);
        await expect.poll(() => cards.count(), { timeout: 5000 }).toBeGreaterThan(0);
        expect(await cards.count()).toBeLessThanOrEqual(totalBefore);

        await overlay.locator('.modal-close-btn').click();
        await expect(overlay).toHaveAttribute('data-visible', 'false', { timeout: 5000 });
    });

    test('§19.3 clicking a type filter flips its active state and narrows the list', async ({ page }) => {
        await bootApp(page);
        const overlay = await openCatalog(page);

        const cards = overlay.locator('.catalog-card');
        const totalBefore = await cards.count();
        expect(totalBefore).toBeGreaterThan(0);

        // Pick a filter whose live count badge is > 0 so the click yields a real,
        // non-empty filtered set (the dev config decides which types exist).
        const filterButtons = overlay.locator('.catalog-filter-btn');
        const filterCount = await filterButtons.count();
        let chosen = null;
        let chosenType = null;
        for (let i = 0; i < filterCount; i += 1) {
            const btn = filterButtons.nth(i);
            const badge = await btn.locator('.filter-count').innerText();
            if (Number(badge) > 0) {
                chosen = btn;
                chosenType = await btn.getAttribute('data-type');
                break;
            }
        }
        expect(chosen, 'at least one type filter has items').not.toBeNull();

        // Activate the filter — its data-active flips true.
        await expect(chosen).toHaveAttribute('data-active', 'false');
        await chosen.click();
        await expect(chosen).toHaveAttribute('data-active', 'true', { timeout: 5000 });

        // Every rendered card now matches the chosen type, and the set is non-empty.
        await expect.poll(() => cards.count(), { timeout: 5000 }).toBeGreaterThan(0);
        const visibleTypes = await cards.evaluateAll((els) =>
            [...new Set(els.map((el) => el.dataset.type))],
        );
        // analysis_layer includes hillshade items; otherwise the set is exactly one type.
        expect(visibleTypes.length).toBeGreaterThan(0);
        if (chosenType !== 'analysis_layer') {
            expect(visibleTypes).toEqual([chosenType]);
        } else {
            for (const t of visibleTypes) {
                expect(['analysis_layer', 'hillshade']).toContain(t);
            }
        }
        const filteredCount = await cards.count();
        expect(filteredCount).toBeLessThanOrEqual(totalBefore);

        // Toggling the filter off restores the full set.
        await chosen.click();
        await expect(chosen).toHaveAttribute('data-active', 'false', { timeout: 5000 });
        await expect.poll(() => cards.count(), { timeout: 5000 }).toBe(totalBefore);

        await overlay.locator('.modal-close-btn').click();
        await expect(overlay).toHaveAttribute('data-visible', 'false', { timeout: 5000 });
    });
});

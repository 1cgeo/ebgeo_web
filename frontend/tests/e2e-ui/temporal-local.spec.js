// Path: e2e-ui/temporal-local.spec.js

/**
 * §29.2-7 Temporal timeline bar — local (🟢) per-user playback view-state driven by
 * REAL clicks/drags in real Chromium. NO backend: the bar is revealed by clicking the
 * per-map clock toggle (#current-map-temporal-btn, §1.19) on the Maps-tab current-map
 * card, which persists the temporal config to the local IndexedDB store and emits
 * TEMPORAL_CONFIG_CHANGED — the TemporalController then mounts the bar visible
 * ([data-testid="temporal-bar"][data-hidden="false"]). With no features the controller
 * falls back to a now→now+24h window, so the scrubber/labels are live.
 *
 * Every assertion is a REAL observable effect on the bar's own DOM:
 *   §29.2 Play/Pause flips the play button's pause/play affordance (aria-label/title);
 *   §29.3 dragging the track moves the cursor (aria-valuenow + the displayed instant);
 *   §29.5 the Nx speed selector changes the selected playback speed;
 *   §29.7 the reveal (eye) button toggles its pressed state.
 *
 * The app boots from the Vite dev server; no login (these are local controls).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D map + bottom controls to be ready. */
async function bootApp(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/**
 * Opens the Maps tab and clicks the per-map clock toggle, then waits for the temporal
 * bar to be mounted visible. Returns the visible bar locator.
 * @param {import('@playwright/test').Page} page
 */
async function enableTemporalBar(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const clock = page.locator('#current-map-temporal-btn');
    await expect(clock).toBeVisible({ timeout: 10000 });
    await expect(clock).toHaveAttribute('data-temporal', 'false');

    await clock.click();
    // The toggle persists locally and flips the button state...
    await expect(clock).toHaveAttribute('data-temporal', 'true', { timeout: 5000 });

    // ...and the controller mounts the bar visible (data-hidden flips to "false").
    const bar = page.locator('[data-testid="temporal-bar"]');
    await expect(bar).toHaveAttribute('data-hidden', 'false', { timeout: 5000 });
    await expect(bar).toBeVisible();
    // The fallback now→now+24h window resolves an instant label (not the "—" placeholder).
    await expect.poll(() => bar.locator('.temporal-bar__time').innerText(), { timeout: 6000 }).not.toBe('—');
    return bar;
}

describeOrSkip('§29.2-7 Temporal timeline bar (real browser, local playback UI)', () => {
    test('§29.2 Play/Pause toggles the playing affordance on the play button', async ({ page }) => {
        await bootApp(page);
        const bar = await enableTemporalBar(page);

        const playBtn = bar.locator('.temporal-bar__play');
        // Starts paused: the button offers "Reproduzir" (play).
        await expect(playBtn).toHaveAttribute('aria-label', 'Reproduzir');

        // Click → playing: the affordance flips to "Pausar".
        await playBtn.evaluate((el) => el.click()); // dispatch the real click listener (bar docks at the viewport bottom)
        await expect(playBtn).toHaveAttribute('aria-label', 'Pausar', { timeout: 5000 });
        await expect(playBtn).toHaveAttribute('title', 'Pausar');

        // Click again → paused: back to "Reproduzir".
        await playBtn.evaluate((el) => el.click()); // dispatch the real click listener (bar docks at the viewport bottom)
        await expect(playBtn).toHaveAttribute('aria-label', 'Reproduzir', { timeout: 5000 });
    });

    test('§29.3 scrubbing the track moves the cursor instant and aria-valuenow', async ({ page }) => {
        await bootApp(page);
        const bar = await enableTemporalBar(page);

        const track = bar.locator('.temporal-bar__track');
        const timeLabel = bar.locator('.temporal-bar__time');

        const valueBefore = Number(await track.getAttribute('aria-valuenow'));
        const textBefore = await timeLabel.innerText();
        const box = await track.boundingBox();
        expect(box).not.toBeNull();

        // Real pointer drag from the left third toward the right edge of the track.
        const yMid = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width * 0.25, yMid);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.9, yMid, { steps: 10 });
        await page.mouse.up();

        // The cursor moved forward: aria-valuenow (epoch ms) increased measurably...
        await expect
            .poll(() => track.getAttribute('aria-valuenow').then(Number), { timeout: 6000 })
            .toBeGreaterThan(valueBefore);
        // ...and the displayed instant changed shape too.
        await expect.poll(() => timeLabel.innerText(), { timeout: 6000 }).not.toBe(textBefore);
    });

    test('§29.5 the Nx speed selector changes the selected playback speed', async ({ page }) => {
        await bootApp(page);
        const bar = await enableTemporalBar(page);

        const speed = bar.locator('.temporal-bar__speed');
        // Default playback speed is 1x.
        await expect(speed).toHaveValue('1');

        // Pick a distinct speed — the selector reflects the new value.
        await speed.selectOption('5');
        await expect(speed).toHaveValue('5', { timeout: 5000 });

        await speed.selectOption('0.5');
        await expect(speed).toHaveValue('0.5', { timeout: 5000 });
    });

    test('§29.7 the reveal (eye) button toggles its pressed/active state', async ({ page }) => {
        await bootApp(page);
        const bar = await enableTemporalBar(page);

        const reveal = bar.locator('.temporal-bar__reveal');
        // Reveal-hidden starts off.
        await expect(reveal).toHaveAttribute('aria-pressed', 'false');

        await reveal.click();
        await expect(reveal).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
        await expect(reveal).toHaveAttribute('data-active', 'true');

        await reveal.click();
        await expect(reveal).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });
        await expect(reveal).toHaveAttribute('data-active', 'false');
    });
});

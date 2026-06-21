// Path: e2e-ui/deep-link.spec.js

/**
 * §27.3-4 Deep links — local (🟢) pure-UI hash routing driven in real Chromium. The
 * app boots from the Vite dev server with NO backend. On boot, map_sig.js imports the
 * deep-link module and calls handleDeepLink(); a VALID descriptor (#view=3d&tileset=…
 * or #view=360&photo=…) is DETECTED and the hash is cleared immediately (clearHash via
 * history.replaceState) — that hash-clear is the real, observable mode-activation
 * signal we assert when the viewer needs backend data we don't have. For the 3D case
 * we additionally assert the 3D-mode DOM flips synchronously: #map-3d-container becomes
 * visible and #close-3d-viewer-button is shown. An invalid hash is NOT cleared (proving
 * detection is selective). Finally the hashchange listener (initDeepLinkListener) is
 * exercised on an already-open page: setting location.hash to a valid link makes the
 * debounced handler react and clear it. No login needed.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const HASH_3D = '#view=3d&tileset=PCL&lon=-43.2&lat=-22.9&h=100&heading=0&pitch=-30&roll=0';
const HASH_360 = '#view=360&photo=00000000-0000-0000-0000-000000000000&lon=10&lat=5&fov=75';

/** Boots the app at the given hash and waits for the 2D map + deep-link handling. */
async function bootApp(page, hash = '') {
    await page.goto(`/${hash}`);
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/** Reads the live document hash from the page. */
const currentHash = (page) => page.evaluate(() => window.location.hash);

describeOrSkip('§27.3-4 Deep links (real browser, local hash routing)', () => {
    test('§27.3 a #view=3d deep link is detected on boot: 3D-mode DOM flips and the hash is cleared', async ({ page }) => {
        await bootApp(page, HASH_3D);

        // Detection side-effect: handleDeepLink() parsed a valid descriptor and called
        // clearHash() immediately. The hash is wiped via history.replaceState.
        await expect.poll(() => currentHash(page), { timeout: 10000 }).toBe('');

        // 3D-mode state flips synchronously inside openViewer(): the 3D split container
        // is revealed (display:block) and the close-3D button is shown (display:flex),
        // even though the Cesium tileset itself has no backend tiles to load.
        await expect(page.locator('#map-3d-container')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#close-3d-viewer-button')).toBeVisible({ timeout: 10000 });
    });

    test('§27.4 a #view=360 deep link is detected on boot (hash cleared = mode activated)', async ({ page }) => {
        await bootApp(page, HASH_360);

        // The 360 viewer needs the photo BLOB (backend), so we assert the parse/detection
        // signal: a valid #view=360 descriptor triggers handleDeepLink() → clearHash().
        await expect.poll(() => currentHash(page), { timeout: 10000 }).toBe('');
    });

    test('§27.3-4 an invalid hash is NOT treated as a deep link (hash is preserved)', async ({ page }) => {
        // No view= key → parseDeepLink() returns null → clearHash() is never called.
        await bootApp(page, '#foo=bar&baz=1');

        // The unrelated hash survives (detection is selective, not a blanket wipe).
        await expect.poll(() => currentHash(page), { timeout: 6000 }).toBe('#foo=bar&baz=1');
        // And the 3D viewer stayed closed.
        await expect(page.locator('#map-3d-container')).toBeHidden();
    });

    test('§27.3 the hashchange listener reacts to a link set on an already-open page', async ({ page }) => {
        // Boot clean (no deep link) so initDeepLinkListener() is registered and idle.
        await bootApp(page, '');
        await expect.poll(() => currentHash(page), { timeout: 6000 }).toBe('');

        // Paste a shareable 3D link into the already-open tab.
        await page.evaluate((h) => { window.location.hash = h; }, HASH_3D);
        // The browser now shows the hash; the debounced (100ms) handler then detects it
        // and clears it again — proving the live hashchange listener reacted.
        await expect.poll(() => currentHash(page), { timeout: 10000 }).toBe('');

        // The reaction also drove the 3D-mode DOM open.
        await expect(page.locator('#map-3d-container')).toBeVisible({ timeout: 10000 });
    });
});

// Path: e2e-ui/viewer-360-open.spec.js

/**
 * §21.1-2,8-14 360 (Three.js) panorama viewer — local (🟢) pure-UI interactions
 * driven by REAL clicks/keys in real Chromium. Two layers are exercised, both with
 * REAL observable effects and NO mocking:
 *
 *  - §21.1-2 The "Imagens 360°" feature toggle (#feature-toggle-panorama, rendered by
 *    BottomControlsControl) flips the 360 photo-layer mode on: clicking it sets the
 *    button's data-active/aria-pressed to "true" and activates the AddStreetViewControl
 *    (the 2D map gains the photo point/line layers). This mode flip needs no panorama
 *    photo and no Three.js — it is the always-local open-attempt signal.
 *
 *  - §21.8-14 The Three.js equirectangular viewer itself. We open it through the REAL
 *    public API (openViewer360WithPhoto, imported live from the Vite dev server — the
 *    same module the app dynamically imports). The viewer's critical setup makes the
 *    #street-view-container visible and tags <body class="streetview-active"> BEFORE it
 *    awaits the (here-absent) photo texture, so the OPEN signal is observable even when
 *    no project .db photo exists in the test env. We then assert:
 *      §21.10-12 the arrow/WASD rotate shortcuts change the camera lon/lat,
 *      §21.13    the +/- zoom shortcuts change the camera FOV,
 *      §21.14    Escape closes the viewer (container hidden, body class removed),
 *    reading the REAL viewer state via the module's exported getters.
 *
 * WEBGL/DATA CAVEAT: the rotate/zoom assertions need the Three.js camera, which only
 * exists if WebGLRenderer initialized. MapLibre (the 2D map this suite waits for) needs
 * WebGL too, so it is normally present — but if the camera genuinely cannot mount
 * headless, the camera-state checks runtime test.skip() with a clear reason. The
 * toggle-mode flip and the open/close signals are asserted unconditionally.
 *
 * The app boots from the Vite dev server; no login needed (these are local controls).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const VIEWER_MODULE = '/src/js/street_view_tool/street_view_viewer.js';

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
 * Opens the Three.js 360 viewer via the REAL public API and returns the live viewer
 * state. The container/body signals flip before the (absent) photo texture is awaited,
 * so this resolves even with no panorama data. `cameraReady` reflects whether the
 * WebGL-backed Three.js camera initialized (gate for the rotate/zoom assertions).
 * @param {import('@playwright/test').Page} page
 */
function openViewer(page) {
    return page.evaluate(async (moduleUrl) => {
        const mod = await import(moduleUrl);
        await mod.openViewer360WithPhoto(`e2e_probe_${Date.now()}`, {});
        const st = mod.getViewer360State();
        return {
            isOpen: mod.isStreetView360Open(),
            cameraReady: Boolean(st.camera),
        };
    }, VIEWER_MODULE);
}

/** Reads the live 360 camera state (rotation + FOV) from the viewer module. */
function readCamera(page) {
    return page.evaluate(async (moduleUrl) => {
        const mod = await import(moduleUrl);
        return { rotation: mod.getCameraRotation(), fov: mod.getCameraFOV() };
    }, VIEWER_MODULE);
}

describeOrSkip('§21 360 panorama viewer (real browser, local UI)', () => {
    test.afterEach(async ({ page }) => {
        // Always tear the viewer down so a failed test never leaks the open state /
        // the document-level keyboard handler into the next test in this worker.
        await page.evaluate(async (moduleUrl) => {
            try {
                const mod = await import(moduleUrl);
                if (mod.isStreetView360Open()) await mod.closeViewer360();
            } catch {
                /* module may not have loaded; nothing to close */
            }
        }, VIEWER_MODULE);
    });

    test('§21.1-2 the "Imagens 360°" toggle flips the panorama mode on and off', async ({ page }) => {
        await bootApp(page);

        const toggle = page.locator('#feature-toggle-panorama');
        // The toggle only renders when the panorama feature is enabled in config; if it
        // is absent the feature is disabled in this build — a genuine env limit.
        if ((await toggle.count()) === 0) {
            test.skip(true, 'panorama feature disabled in config (no #feature-toggle-panorama)');
        }
        await expect(toggle).toBeVisible({ timeout: 10000 });

        // A disabled toggle means the feature has no data/resources available here.
        if (await toggle.isDisabled()) {
            test.skip(true, 'panorama toggle disabled (no 360 data available in test env)');
        }

        // Starts inactive.
        await expect(toggle).toHaveAttribute('data-active', 'false');
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');

        // Click → 360 photo-layer mode activates (real ToolManager viewer activation).
        await toggle.click();
        await expect(toggle).toHaveAttribute('data-active', 'true', { timeout: 6000 });
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');

        // Click again → mode deactivates.
        await toggle.click();
        await expect(toggle).toHaveAttribute('data-active', 'false', { timeout: 6000 });
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });

    test('§21.8 opening the viewer reveals the 360 container + flips the active signal', async ({ page }) => {
        await bootApp(page);

        const container = page.locator('#street-view-container');
        const closeBtn = page.locator('#close-street-view-button');
        // Closed on boot: container + close button are display:none.
        await expect(container).toBeHidden();
        await expect(closeBtn).toBeHidden();
        await expect(page.locator('body')).not.toHaveClass(/streetview-active/);

        const { isOpen } = await openViewer(page);
        expect(isOpen).toBe(true);

        // Real DOM signals: container visible, close button visible, body tagged.
        await expect(container).toBeVisible({ timeout: 6000 });
        await expect(closeBtn).toBeVisible();
        await expect(page.locator('body')).toHaveClass(/streetview-active/);
        // The 360 toolbar (marker/orientation/share/help) is mounted visible too.
        await expect(page.locator('#toolbar-360')).toBeVisible();
    });

    test('§21.14 Escape closes the open 360 viewer', async ({ page }) => {
        await bootApp(page);

        const { isOpen } = await openViewer(page);
        expect(isOpen).toBe(true);
        await expect(page.locator('#street-view-container')).toBeVisible({ timeout: 6000 });
        await expect(page.locator('body')).toHaveClass(/streetview-active/);

        // Move focus off any control, then press Escape — the 360 keyboard service
        // (document keydown) routes Escape to closeViewer360 (priority 4: no popup /
        // tool / selected POI when freshly opened).
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Escape');

        // Real DOM signals reverse: container hidden, body class removed.
        await expect(page.locator('#street-view-container')).toBeHidden({ timeout: 6000 });
        await expect(page.locator('body')).not.toHaveClass(/streetview-active/);
        const stillOpen = await page.evaluate(async (moduleUrl) => {
            const mod = await import(moduleUrl);
            return mod.isStreetView360Open();
        }, VIEWER_MODULE);
        expect(stillOpen).toBe(false);
    });

    test('§21.10-13 arrow/WASD rotate + −/+ zoom keyboard shortcuts move the camera', async ({ page }) => {
        await bootApp(page);

        const { isOpen, cameraReady } = await openViewer(page);
        expect(isOpen).toBe(true);
        await expect(page.locator('#street-view-container')).toBeVisible({ timeout: 6000 });

        // The rotate/zoom shortcuts mutate the Three.js camera, which only exists if the
        // WebGLRenderer initialized. If it genuinely could not mount headless, skip the
        // camera-state assertions (the open/close signals above still cover the viewer).
        if (!cameraReady) {
            test.skip(true, 'Three.js WebGL camera could not initialize headless (no 360 camera)');
        }

        // Focus the body so document keydown reaches the 360 keyboard service (and the
        // target is not an input — the handler ignores typing in inputs).
        await page.locator('body').click({ position: { x: 5, y: 5 } });

        const before = await readCamera(page);

        // §21.10-11 ArrowRight rotates yaw (lon += 5° per press).
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await expect
            .poll(() => readCamera(page).then((c) => c.rotation.lon), { timeout: 6000 })
            .toBeGreaterThan(before.rotation.lon);

        // §21.12 'w' (WASD up) rotates pitch up (lat decreases — clamped at -85°).
        const afterYaw = await readCamera(page);
        await page.keyboard.press('w');
        await expect
            .poll(() => readCamera(page).then((c) => c.rotation.lat), { timeout: 6000 })
            .toBeLessThan(afterYaw.rotation.lat);

        // §21.13 '+' zooms in (FOV decreases, clamped 10-75°); '-' zooms back out.
        const fovStart = (await readCamera(page)).fov;
        await page.keyboard.press('+');
        await expect
            .poll(() => readCamera(page).then((c) => c.fov), { timeout: 6000 })
            .toBeLessThan(fovStart);

        const fovZoomedIn = (await readCamera(page)).fov;
        await page.keyboard.press('-');
        await expect
            .poll(() => readCamera(page).then((c) => c.fov), { timeout: 6000 })
            .toBeGreaterThan(fovZoomedIn);
    });
});

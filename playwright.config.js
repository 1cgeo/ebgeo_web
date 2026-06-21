// Path: playwright.config.js

/**
 * @fileoverview Playwright config for the browser-E2E layer (tests/e2e-ui/). Vite
 * serves the app (webServer); global-setup spawns the real backend with CORS
 * allowing the Vite origin so the browser can talk to it cross-origin.
 *
 * Run: `npm run test:e2e:ui` (after `npm install` + `npx playwright install chromium`).
 */

import { defineConfig, devices } from '@playwright/test';
import { APP_ORIGIN, APP_PORT } from './tests/e2e-ui/constants.js';

// The mega harness (browser-collab-mega) is a long, two-browser DEMONSTRATION piece, not a
// regression guard — its dimensions are each covered by the focused browser-collab-* specs.
// Keep it OUT of the normal suite (`npm run test:e2e:ui`) so it doesn't slow CI, but still
// runnable when targeted explicitly: `npx playwright test browser-collab-mega --headed`
// (or `npm run test:e2e:mega`). This config runs in the main CLI process, so process.argv
// carries the file filter — when the user names the mega, we don't ignore it.
const TARGETING_MEGA = process.argv.some((arg) => arg.includes('browser-collab-mega'));

export default defineConfig({
    testDir: './tests/e2e-ui',
    testMatch: '**/*.spec.js',
    testIgnore: TARGETING_MEGA ? [] : ['**/browser-collab-mega.spec.js'],
    globalSetup: './tests/e2e-ui/global-setup.js',
    globalTeardown: './tests/e2e-ui/global-teardown.js',
    fullyParallel: false,
    workers: 1,
    // One retry: the heavy collaboration specs (2–3 real browsers) are correct in
    // isolation but can miss a timing window under sustained full-suite load (a long
    // serial run on a loaded machine). A retry re-runs only the flaked test and reports
    // it as "flaky", keeping the suite honest without masking real (both-attempt) failures.
    retries: 1,
    timeout: 60000,
    expect: { timeout: 10000 },
    reporter: [['list']],
    use: {
        baseURL: APP_ORIGIN,
        headless: true,
        trace: 'on-first-retry',
    },
    webServer: {
        command: `npm run dev -- --port ${APP_PORT} --strictPort`,
        url: APP_ORIGIN,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        stdout: 'ignore',
        // The app's optional /api/config override proxies to the dev backend (:8080),
        // which is not up during e2e:ui, so Vite logs a benign ECONNREFUSED for that
        // fallback (the app uses bundled config; specs hit the real backend cross-origin).
        // Ignore the webServer stderr so the e2e output stays clean — Vite-startup
        // failures are still caught by the webServer `url` health-check above.
        stderr: 'ignore',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

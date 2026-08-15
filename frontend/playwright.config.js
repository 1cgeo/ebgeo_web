// Path: playwright.config.js

/**
 * @fileoverview Playwright config for the browser-E2E layer (tests/e2e-ui/). Vite
 * serves the app (webServer); global-setup spawns the real backend with CORS
 * allowing the Vite origin so the browser can talk to it cross-origin.
 *
 * Run: `npm run test:e2e:ui` (after `npm install` + `npx playwright install chromium`).
 */

import { defineConfig, devices } from '@playwright/test';
import { APP_ORIGIN, APP_PORT, BACKEND_PORT } from './tests/e2e-ui/constants.js';

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
    //
    // ONE FILE OPTS OUT, IN ITSELF: `browser-multi-tab-namespace.spec.js` calls
    // `test.describe.configure({ retries: 0 })`. There the retry would be the bug: two tabs of one
    // profile racing over the same IndexedDB is the very thing under test, and a race that only
    // loses sometimes would be re-run and reported as "flaky", which is a green run. The opt-out
    // lives in the spec (not as a project here) so the rest of the suite keeps its retry and the
    // reason travels with the file that needs it.
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
        // Roda com cwd em frontend/, entao o `vite` daqui e o do proprio pacote, nao o stack
        // completo (esse e o `dev` da RAIZ, que sobe backend junto e nem repassaria o `--port`).
        // O global-setup ja sobe o backend descartavel.
        //
        // NAO e o `vite.config.js` da raiz do pacote, e a diferenca importa: `tests/e2e-ui/
        // vite.e2e.config.js` e o mesmo config com o WATCHER e o HMR removidos. Servido pelo
        // config normal, um `src/` editado durante a rodada reinjeta o modulo com `?t=<epoch>`
        // e recarrega a pagina no meio da medicao, o que ja derrubou 6 de 10 casos de
        // `browser-multi-tab-namespace` por motivo que nao e do app. A razao medida esta no
        // `@fileoverview` daquele arquivo, junto do controle que prova que o HMR esta mesmo fora.
        command: `npx vite --config ./tests/e2e-ui/vite.e2e.config.js --port ${APP_PORT} --strictPort`,
        url: APP_ORIGIN,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        stdout: 'ignore',
        // Point the Vite same-origin `/api` proxy at the throwaway E2E backend (:3912) the
        // global-setup spawns. Boot is fail-fast on `GET /api/config` (backend is the single
        // config source), so the pure-UI specs that boot WITHOUT injecting __EBGEO_BACKEND_URL__
        // still need a reachable backend — the proxy gives them one same-origin (the dev :8080
        // backend is not up during e2e). Backend-connected specs that inject the cross-origin URL
        // bypass the proxy and are unaffected.
        env: { EBGEO_DEV_API_TARGET: `http://127.0.0.1:${BACKEND_PORT}` },
        // Ignore the webServer stderr so the e2e output stays clean — Vite-startup
        // failures are still caught by the webServer `url` health-check above.
        stderr: 'ignore',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

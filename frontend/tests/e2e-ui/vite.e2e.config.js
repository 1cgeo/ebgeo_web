// Path: e2e-ui/vite.e2e.config.js

/**
 * @fileoverview The Vite dev server the Playwright layer runs against: the repo's real
 * `vite.config.js` with the FILE WATCHER AND HMR REMOVED, and nothing else changed.
 *
 * WHY, MEASURED (2026-08-15). The browser-E2E layer is served by a dev server that watches
 * `src/`. Any write to a source file during a run makes Vite re-serve that module with a
 * `?t=<epoch>` cache-bust and, for a non-accepting module, reload the page. In a run of
 * `browser-multi-tab-namespace.spec.js` that happened while another worktree edited the
 * migration files, and one spec file produced four different corpses at once:
 *
 *   - `page.evaluate: ReferenceError: localforage is not defined` at
 *     `store/migration/v2-to-v2.1.migration.js?t=1786818899456` (the `?t=` is the signature);
 *   - `page.evaluate: Execution context was destroyed, most likely because of a navigation`,
 *     twice, in tests that navigate nowhere at that point;
 *   - `page.evaluate: TypeError: Failed to fetch` inside the seeding `ApiClient`.
 *
 * Six of ten cases went red, none of them for a reason belonging to the app. A run of the same
 * file minutes earlier and minutes later was clean. This is the "instrument measuring another
 * copy of the subject" trap of the constitution, in its coarsest form: the page under
 * measurement was swapped mid-measurement.
 *
 * WHY THIS IS NOT MASKING A RACE. Nothing in `tests/e2e-ui/` ever edits a source file, so the
 * watcher has no legitimate work during a run: every event it can deliver is an artifact of the
 * editor (or of a parallel agent) and not of the product. Removing it does not widen a timing
 * window, it deletes an input the product does not have in production. `server.watch: null` is
 * Vite's own supported switch for this (it installs a noop watcher, `vite/dist/node`), and
 * `hmr: false` removes the HMR socket, so the reload path is structurally absent rather than
 * merely quiet.
 *
 * THE CONTROL that proves it is in effect: `browser-multi-tab-namespace.spec.js` asserts that a
 * booted tab opened NO WebSocket back to the app origin (the HMR socket) and fetched no
 * `?t=<epoch>` module. Without a control, "no reload happened" and "reloads happen but not this
 * time" read the same.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baseConfig from '../../vite.config.js';

/** `frontend/` — pinned absolutely because the base config says `root: '.'`, which would
 *  resolve against this file's directory or the cwd instead of the package. */
const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default async (env) => {
    const base = typeof baseConfig === 'function' ? await baseConfig(env) : baseConfig;
    return {
        ...base,
        root: FRONTEND_ROOT,
        server: {
            ...base.server,
            // No browser window per e2e run (the base config opens one for `npm run dev`).
            open: false,
            // No HMR socket: nothing can push an update or a reload into a page under test.
            hmr: false,
            // No file watcher: a source edit mid-run cannot invalidate a module either.
            watch: null,
        },
    };
};

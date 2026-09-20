import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@js': resolve(__dirname, 'src/js'),
            '@css': resolve(__dirname, 'src/css'),
            '@store': resolve(__dirname, 'src/js/store'),
            '@state': resolve(__dirname, 'src/js/state'),
            '@utils': resolve(__dirname, 'src/js/utilities'),
            '@tools': resolve(__dirname, 'src/js/tool_manager'),
            '@toolbar': resolve(__dirname, 'src/js/toolbar'),
            '@modals': resolve(__dirname, 'src/js/modals'),
            '@sidebar': resolve(__dirname, 'src/js/sidebar'),
            '@layers': resolve(__dirname, 'src/js/layers'),
            '@catalog': resolve(__dirname, 'src/js/catalog'),
            '@ui': resolve(__dirname, 'src/js/ui'),
            '@events': resolve(__dirname, 'src/js/events')
        }
    },
    test: {
        include: ['tests/**/*.test.js'],
        // The E2E specs (`tests/e2e/**/*.e2e.test.js`) require a live backend and
        // run under their own config (`vitest.e2e.config.js`); the Playwright browser
        // specs live in `tests/e2e-ui/` (run via `npm run test:e2e:ui`). Keep both out
        // of the hermetic unit/integration run.
        exclude: ['node_modules/**', 'tests/e2e/**', 'tests/e2e-ui/**'],
        environment: 'node',
        // `fake-indexeddb` for every file, on purpose. The rationale (and the measured
        // cost) is in the fileoverview of the setup file itself.
        setupFiles: ['tests/setup/indexeddb.setup.js'],
        globals: true,
        // 20 s, NOT the 5 s default, and the number is measured (2026-09-20). A case that does
        // `await import(...)` of a large graph pays the TRANSFORM of those modules inside its own
        // budget the first time the worker sees them: 175 ms idle, 7.7 to 11.2 s with the machine
        // oversubscribed (two or three sessions running suites and Playwright at once), while the
        // code under test took 19 ms. Three flakes in one day had this root, each dismissed by a
        // different session as "not mine, passes alone". 20 s is the measured worst case with
        // margin. THE PRICE: a test that truly hangs is now reported after 20 s instead of 5,
        // per hanging case, which costs seconds on a failure path and nothing on a green run.
        // A case that still needs more declares it in the third argument of `it`, and the right
        // fix for a heavy cold import remains warming it in a `beforeAll`.
        testTimeout: 20000,
        hookTimeout: 30000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            reportsDirectory: './coverage',
            include: ['src/js/**/*.js'],
            // Report-only baseline (no thresholds yet — see TESTING.md).
            // `all: true` counts untested files so the report shows the real gap.
            all: true,
            exclude: ['src/js/**/index.js']
        }
    }
});

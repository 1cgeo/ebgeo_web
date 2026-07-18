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
        globals: true,
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

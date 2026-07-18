// Path: vitest.e2e.config.js

/**
 * @fileoverview Vitest config for the END-TO-END suite. Unlike the unit/integration
 * config (`vitest.config.js`), this one boots the REAL backend once via globalSetup
 * and runs the `*.e2e.test.js` specs against it in a single fork (one backend, so we
 * avoid cross-test races on the shared server).
 */

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
        include: ['tests/e2e/**/*.e2e.test.js'],
        environment: 'node',
        globals: true,
        globalSetup: ['./tests/e2e/global-setup.js'],
        // Runs inside the test fork: registers an in-memory LocalForage driver so
        // operation-queue.js (IndexedDB-backed) works under Node.
        setupFiles: ['./tests/e2e/setup-storage.js'],
        testTimeout: 30000,
        hookTimeout: 40000,
        // One backend for the whole run: a single fork avoids races on the shared
        // server. Vitest 4 moved this from `poolOptions.forks.singleFork` to a
        // top-level `fileParallelism: false`.
        pool: 'forks',
        fileParallelism: false
    }
});

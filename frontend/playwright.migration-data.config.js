import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Explicit opt-in: normal CI does not depend on a user's external data directory.
if (!process.env.EBGEO_MIGRATION_DATA_DIR) throw new Error('Informe EBGEO_MIGRATION_DATA_DIR.');
// O guarda do "verde por pulo" entra no `testMatch` de toda rodada (2026-09-22); censo em
// `tests/unit/configs-do-playwright-coletam-o-guarda.test.js`.
export default defineConfig({ ...base,
    testMatch: ['**/migration-external-data.scenario.js', '**/_backend-required.spec.js'],
    retries: 0, timeout: 180000 });

import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Explicit opt-in: normal CI does not depend on a user's external data directory.
if (!process.env.EBGEO_MIGRATION_DATA_DIR) throw new Error('Informe EBGEO_MIGRATION_DATA_DIR.');
export default defineConfig({ ...base, testMatch: '**/migration-external-data.scenario.js',
    retries: 0, timeout: 180000 });

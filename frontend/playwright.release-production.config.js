import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({ ...base, testMatch: '**/release-production.scenario.js', retries: 0, timeout: 300000,
    globalSetup: './tests/e2e-ui/release-production-setup.js',
    use: { ...base.use, baseURL: 'https://127.0.0.1:44431', ignoreHTTPSErrors: true },
    webServer: { command: 'node tests/helpers/release-https-server.mjs', url: 'https://127.0.0.1:44431/release.json',
        ignoreHTTPSErrors: true, reuseExistingServer: false, timeout: 30000 }
});

// Path: playwright.atlas-safety.config.js
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({ ...base, testMatch: '**/atlas-data-safety.scenario.js',
    outputDir: './test-results/atlas-safety', retries: 0, timeout: 90000,
    reporter: [['list'], ['json', { outputFile: './test-results/atlas-safety-report.json' }]] });

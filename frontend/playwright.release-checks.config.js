import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// O guarda do "verde por pulo" entra no `testMatch` de toda rodada (2026-09-22); censo em
// `tests/unit/configs-do-playwright-coletam-o-guarda.test.js`.
export default defineConfig({ ...base,
    testMatch: ['**/release-interruption.scenario.js', '**/_backend-required.spec.js'],
    retries: 0, timeout: 90000 });

// Path: playwright.atlas-safety.config.js
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
// O GUARDA DO "VERDE POR PULO" ENTRA NO `testMatch` DE TODA RODADA (2026-09-22), e quem cobra é
// `tests/unit/configs-do-playwright-coletam-o-guarda.test.js`, varrido por `git ls-files`. O
// spread traz o `testIgnore` do base, e ele não alcança o guarda, então não há o que sobrescrever
// aqui (ao contrário do config de tablet, que ignoraria as próprias specs).
export default defineConfig({ ...base,
    testMatch: ['**/atlas-data-safety.scenario.js', '**/_backend-required.spec.js'],
    outputDir: './test-results/atlas-safety', retries: 0, timeout: 90000,
    reporter: [['list'], ['json', { outputFile: './test-results/atlas-safety-report.json' }]] });

// Path: playwright.release-large-atlas.config.js
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Cenário de release do ATLAS GRANDE (decisão D2 de 2026-09-23): 1 000 a 30 000 feições abertas,
// editadas, recarregadas e listadas por um cliente real. Só roda por aqui
// (`npm run test:e2e:atlas-grande`, e `-- --project=firefox` para o segundo navegador); o
// `testMatch` do base é `*.spec.js` e nunca coleta um `*.scenario.js`.
//
// O `timeout` daqui NÃO alcança o projeto `firefox`, que declara o próprio (180 s) e vence o do
// config; o cenário chama `test.setTimeout` por dentro. `outputDir` próprio pela mesma razão do
// config da sessão longa: o Playwright esvazia o diretório de saída ao começar uma rodada.
//
// O guarda do "verde por pulo" entra no `testMatch` de toda rodada (2026-09-22); censo em
// `tests/unit/configs-do-playwright-coletam-o-guarda.test.js`.
export default defineConfig({ ...base,
    testMatch: ['**/release-large-atlas.scenario.js', '**/_backend-required.spec.js'],
    outputDir: './test-results/atlas-grande', retries: 0, timeout: 600000 });

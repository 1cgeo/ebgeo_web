import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// O GUARDA DO "VERDE POR PULO" ENTRA AQUI TAMBÉM (2026-09-22), e este é o config em que ele tem
// MENOS a provar hoje e MAIS a prender amanhã. Ele lê o `STATE_FILE` de `tests/e2e-ui/constants.js`,
// que é o mesmo arquivo que o `globalSetup` PRÓPRIO desta rodada escreve, então a leitura é a
// certa. O que ela não pode acusar hoje é a ausência de backend: `release-production-setup.js` não
// tem `try/catch`, então Postgres fora derruba a rodada no setup em vez de gravar `skip: true`.
// O guarda entra porque é a única metade MECÂNICA: `release-production.scenario.js` é a única das
// quatro cenas sem um `test.beforeAll` que assere `readState().skip`, e no dia em que aquele setup
// ganhar um `catch` (ou apontar para o `global-setup.js` compartilhado) o falso verde nasce sem
// nada vermelho. Censo: `tests/unit/configs-do-playwright-coletam-o-guarda.test.js`.
export default defineConfig({ ...base,
    testMatch: ['**/release-production.scenario.js', '**/_backend-required.spec.js'],
    retries: 0, timeout: 300000,
    globalSetup: './tests/e2e-ui/release-production-setup.js',
    use: { ...base.use, baseURL: 'https://127.0.0.1:44431', ignoreHTTPSErrors: true },
    webServer: { command: 'node tests/helpers/release-https-server.mjs', url: 'https://127.0.0.1:44431/release.json',
        ignoreHTTPSErrors: true, reuseExistingServer: false, timeout: 30000 }
});

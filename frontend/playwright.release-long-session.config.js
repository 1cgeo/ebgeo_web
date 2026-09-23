// Path: playwright.release-long-session.config.js
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Cenário de release de NOVENTA MINUTOS de relógio (decisão D2 de 2026-09-23): dois clientes, três
// quedas de rede, renovação do token de acesso e recargas. Só roda por aqui
// (`npm run test:e2e:sessao-longa`, e `-- --project=firefox` para o segundo navegador); o
// `testMatch` do base é `*.spec.js` e nunca coleta um `*.scenario.js`.
//
// O `timeout` daqui NÃO alcança o projeto `firefox`, que declara o próprio (180 s) e vence o do
// config: foi isso que derrubou uma rodada da auditoria aos 3 min. Por isso o cenário chama
// `test.setTimeout` por dentro, e o valor abaixo vale só como teto do Chromium.
//
// `outputDir` próprio porque o Playwright ESVAZIA o diretório de saída ao começar uma rodada: sem
// ele, outro cenário lançado do mesmo checkout durante estes noventa minutos apagaria as amostras,
// as capturas e o `diagnostics.json` desta.
//
// O guarda do "verde por pulo" entra no `testMatch` de toda rodada (2026-09-22); censo em
// `tests/unit/configs-do-playwright-coletam-o-guarda.test.js`.
export default defineConfig({ ...base,
    testMatch: ['**/release-long-session.scenario.js', '**/_backend-required.spec.js'],
    outputDir: './test-results/sessao-longa', retries: 0, timeout: 100 * 60 * 1000 });

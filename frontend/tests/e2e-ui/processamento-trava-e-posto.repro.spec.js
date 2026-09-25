// Path: e2e-ui/processamento-trava-e-posto.repro.spec.js

/**
 * @fileoverview O PAINEL DE PROCESSAMENTO: A MENSAGEM DE SUCESSO.
 *
 * Defeito medido com navegador real (`processing/processing-panel.js`): a mensagem de sucesso
 * escapava o nome da camada duas vezes, e "Zona & Norte" aparecia como "Zona &amp; Norte", porque a
 * frase era escapada ao ser montada e de novo ao ser desenhada.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test processamento-trava-e-posto --retries=0 --workers=1
 */

import { collabTest, expect, drawPointUI } from './helpers/collab.fixtures.js';

const PONTO = [-43.2, -22.9];

const camadas = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (store.getLayers() ?? []).map((l) => l.name);
});

async function abrirBuffer(page) {
    const aba = page.locator('.processing-algorithm-list');
    if (!(await aba.isVisible().catch(() => false))) await page.locator('.sidebar-nav-btn[data-tab="processamento"]').click();
    await expect(aba).toBeVisible({ timeout: 10000 });
    await page.locator('.processing-card[data-algorithm-id="buffer"]').evaluate((el) => el.click());
    const painel = page.locator('.processing-panel[data-testid="processing-panel"][data-algorithm-id="buffer"]');
    await expect(painel).toBeVisible({ timeout: 8000 });
    return painel;
}

collabTest.describe('Mensagem de sucesso do processamento', () => {
    collabTest('nomeia a camada de saída como ela foi escrita', async ({ collab }) => {
        collabTest.setTimeout(150000);
        const A = collab.author;
        await drawPointUI(A, PONTO);
        await A.keyboard.press('Escape');

        const painel = await abrirBuffer(A);
        await painel.locator('.processing-panel__output-name').fill('Zona & Norte');
        await painel.locator('.processing-panel__execute-btn').click();
        await expect(painel.locator('.processing-panel__result--success'), 'o nome saiu escapado duas vezes')
            .toHaveText('1 feição criada na camada "Zona & Norte"', { timeout: 20000 });
        await expect.poll(() => camadas(A), { timeout: 10000 }).toContain('Zona & Norte');
    });
});

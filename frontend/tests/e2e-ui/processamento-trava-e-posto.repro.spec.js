// Path: e2e-ui/processamento-trava-e-posto.repro.spec.js

/**
 * @fileoverview O BOTAO EXECUTAR DO PROCESSAMENTO DIANTE DA TRAVA DO MAPA E DO NIVEL DE QUEM OLHA.
 *
 * Tres defeitos medidos com dois navegadores reais (`processing/processing-panel.js`):
 *  1. ESTADO: o painel lia a trava UMA vez, ao nascer, e desligava o botao pela propriedade
 *     `disabled`. Aberto com o mapa travado, o botao seguia morto depois que o dono destravava (so'
 *     reabrir o painel o trazia de volta), e o clique, que e' como o motivo chega a pessoa, nao
 *     disparava nada. Aberto destravado, a trava que chegava depois nao mudava o botao.
 *  2. POSTO: um Leitor via o botao, clicava, e lia "Falha ao criar camada de saida", uma falha que
 *     nao aconteceu: o que houve foi a recusa do nivel dele.
 *  3. A mensagem de sucesso escapava o nome da camada duas vezes: "Zona & Norte" aparecia como
 *     "Zona &amp; Norte".
 *
 * A regra da casa (CLAUDE.md, "o POSTO some, o ESTADO recusa o clique"): para o Leitor o comando
 * nao se desenha e uma frase diz por que; com o mapa travado o comando e' desenhado com
 * `aria-disabled` e o clique recusa nomeando a trava. O clique no botao com `aria-disabled` vai por
 * `dispatchEvent`, porque o `click()` do Playwright espera para sempre por ele
 * (`.claude/rules/testing.md`).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test processamento-trava-e-posto --retries=0 --workers=1
 */

import { collabTest, expect, drawPointUI } from './helpers/collab.fixtures.js';

const camadas = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (store.getLayers() ?? []).map((l) => l.name);
});

const travado = (page) => page.evaluate(async () => (await import('/src/js/store/index.js')).isCurrentMapLockedSync());

async function abrirBuffer(page) {
    const aba = page.locator('.processing-algorithm-list');
    if (!(await aba.isVisible().catch(() => false))) await page.locator('.sidebar-nav-btn[data-tab="processamento"]').click();
    await expect(aba).toBeVisible({ timeout: 10000 });
    await page.locator('.processing-card[data-algorithm-id="buffer"]').evaluate((el) => el.click());
    const painel = page.locator('.processing-panel[data-testid="processing-panel"][data-algorithm-id="buffer"]');
    await expect(painel).toBeVisible({ timeout: 8000 });
    return painel;
}

async function alternarTravaUI(page, esperado, outro) {
    if (!(await page.locator('#current-map-lock-btn').isVisible().catch(() => false))) {
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    }
    await page.locator('#current-map-lock-btn').click();
    await expect.poll(() => travado(page), { timeout: 15000 }).toBe(esperado);
    await expect.poll(() => travado(outro), { timeout: 20000, message: 'a trava chega ao colega' }).toBe(esperado);
}

collabTest.describe('Executar do processamento com o mapa travado (Editor)', () => {
    collabTest('a trava e a destrava que chegam com o painel aberto mudam o botao, e o clique travado diz por que', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        await drawPointUI(A, [-43.2, -22.9]);
        await alternarTravaUI(A, true, B);

        const painel = await abrirBuffer(B);
        const botao = painel.locator('.processing-panel__execute-btn');
        await expect(botao, 'o ESTADO desenha o comando').toBeVisible();
        await expect(botao).toHaveAttribute('aria-disabled', 'true');
        expect(await botao.evaluate((el) => el.disabled), 'nunca a propriedade disabled no bloqueio por estado').toBe(false);
        const antes = await camadas(B);
        await botao.dispatchEvent('click');
        await expect(painel.locator('.processing-panel__result--error')).toContainText('Mapa bloqueado. Desbloqueie para editar.');
        expect(await camadas(B), 'nada nasceu com o mapa travado').toEqual(antes);

        // O dono destrava com o painel ABERTO: o botao volta sem reabrir nada.
        await alternarTravaUI(A, false, B);
        await expect(botao, 'a destrava chega ao botao').toBeEnabled({ timeout: 10000 });
        await expect(botao).toHaveAttribute('aria-disabled', 'false');
        await painel.locator('.processing-panel__output-name').fill('Zona & Norte');
        await botao.click();
        await expect(painel.locator('.processing-panel__result--success'))
            .toHaveText('1 feição criada na camada "Zona & Norte"', { timeout: 20000 });
        await expect.poll(() => camadas(B), { timeout: 10000 }).toContain('Zona & Norte');

        // E trava de novo com o painel aberto: o botao passa a recusar sem ser recriado.
        await alternarTravaUI(A, true, B);
        await expect(botao).toHaveAttribute('aria-disabled', 'true', { timeout: 10000 });
        const depois = await camadas(B);
        await botao.dispatchEvent('click');
        await expect(painel.locator('.processing-panel__result--error')).toContainText('Mapa bloqueado. Desbloqueie para editar.');
        expect(await camadas(B)).toEqual(depois);
    });
});

collabTest.describe('Executar do processamento para um Leitor', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'read', mapName: 'Mapa Tático' } });

    collabTest('o POSTO nao desenha o comando, e uma frase diz por que', async ({ collab }) => {
        collabTest.setTimeout(150000);
        const A = collab.author;
        const B = collab.peers[0];
        await drawPointUI(A, [-43.2, -22.9]);
        await expect.poll(() => B.evaluate(async () => Object.values(
            await (await import('/src/js/store/index.js')).getCurrentMapFeatures()).flat().length), { timeout: 20000 }).toBe(1);

        const painel = await abrirBuffer(B);
        await expect(painel.locator('.processing-panel__execute-btn'), 'o Leitor nao ve o Executar').toBeHidden();
        await expect(painel.locator('.processing-panel__posto')).toHaveText('Seu nível neste atlas não permite editar.');
        await expect(painel.locator('.processing-panel__result--error')).toHaveCount(0);
        expect(await camadas(B)).toEqual(['Padrão']);
    });
});

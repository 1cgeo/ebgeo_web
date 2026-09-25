// Path: e2e-ui/processamento-trava-e-posto.repro.spec.js

/**
 * @fileoverview O PAINEL DE PROCESSAMENTO: A MENSAGEM DE SUCESSO, E O EXECUTAR DIANTE DA TRAVA DO
 * MAPA E DO NÍVEL DE QUEM OLHA.
 *
 * Três defeitos medidos com dois navegadores reais (`processing/processing-panel.js`):
 *  1. A mensagem de sucesso escapava o nome da camada duas vezes: "Zona & Norte" aparecia como
 *     "Zona &amp; Norte", porque a frase era escapada ao ser montada e de novo ao ser desenhada.
 *  2. TRAVA: o painel lia a trava UMA vez, ao nascer, e desligava o botão pela propriedade
 *     `disabled`. Aberto com o mapa travado, o Executar seguia morto depois que o dono destravava
 *     (só reabrir o painel o trazia de volta); aberto destravado, a trava que chegava depois não
 *     mudava nada.
 *  3. POSTO: um Leitor via o Executar, clicava, e lia "Falha ao criar camada de saída", uma falha
 *     que não aconteceu: o que houve foi a recusa do nível dele.
 *
 * NOS DOIS EIXOS O EXECUTAR SOME (decisão do dono, 2026-09-25): o painel de processamento é da
 * família dos painéis laterais, que escondem a edição por papel e pela trava (`semEdicaoSync`,
 * `store/edicao-indisponivel.js`), como o painel de feição, a tabela de atributos, a lista de
 * camadas e as notas do mapa. Desenhar e recusar o clique fica para o menu por mapa. No lugar do
 * botão, uma frase curta diz por quê: a de `denialNotice` pela capacidade negada, ou a da trava.
 * O painel acompanha papel e trava AO VIVO (`assinarEdicaoIndisponivel`), e é isso que o caso de
 * destravar prova: sem a assinatura, o botão não volta.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test processamento-trava-e-posto --retries=0 --workers=1
 */

import { collabTest, expect, drawPointUI } from './helpers/collab.fixtures.js';
import { setSharePermission } from './helpers/collab-helpers.js';

const PONTO = [-43.2, -22.9];
const FRASE_DA_TRAVA = 'Mapa bloqueado. Desbloqueie para editar.';
const FRASE_DO_LEITOR = 'Seu nível neste atlas não permite editar.';

const camadas = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (store.getLayers() ?? []).map((l) => l.name);
});

const quantasFeicoes = (page) => page.evaluate(async () => Object.values(
    await (await import('/src/js/store/index.js')).getCurrentMapFeatures()).flat().length);

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

/** O dono clica no cadeado do mapa corrente (aba Mapas) e espera a trava chegar ao colega. */
async function alternarTravaUI(page, esperado, outro) {
    if (!(await page.locator('#current-map-lock-btn').isVisible().catch(() => false))) {
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    }
    await page.locator('#current-map-lock-btn').click();
    await expect.poll(() => travado(page), { timeout: 15000 }).toBe(esperado);
    await expect.poll(() => travado(outro), { timeout: 20000, message: 'a trava chega ao colega' }).toBe(esperado);
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

collabTest.describe('Executar do processamento e a trava do mapa (Editor)', () => {
    collabTest('aberto com o mapa travado, o Executar some e volta ao destravar; a trava que chega o tira de novo', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        await drawPointUI(A, PONTO);
        await expect.poll(() => quantasFeicoes(B), { timeout: 20000 }).toBe(1);
        await alternarTravaUI(A, true, B);

        const painel = await abrirBuffer(B);
        const botao = painel.locator('.processing-panel__execute-btn');
        const aviso = painel.locator('.processing-panel__edit-unavailable');
        await expect(botao, 'o mapa travado não esconde o Executar').toBeHidden();
        await expect(aviso).toHaveText(FRASE_DA_TRAVA);

        // O dono destrava com o painel ABERTO: o Executar volta, vivo, sem reabrir nada.
        await alternarTravaUI(A, false, B);
        await expect(botao, 'destravar não devolveu o Executar').toBeVisible({ timeout: 10000 });
        await expect(botao).toBeEnabled();
        await expect(aviso).toBeHidden();
        await painel.locator('.processing-panel__output-name').fill('Zona Norte');
        await botao.click();
        await expect(painel.locator('.processing-panel__result--success')).toBeVisible({ timeout: 20000 });
        await expect.poll(() => camadas(B), { timeout: 10000 }).toContain('Zona Norte');

        // E a trava que chega com o painel aberto tira o Executar de novo.
        await alternarTravaUI(A, true, B);
        await expect(botao, 'a trava chegou e o Executar continuou').toBeHidden({ timeout: 10000 });
        await expect(aviso).toHaveText(FRASE_DA_TRAVA);
    });
});

collabTest.describe('Executar do processamento para um Leitor', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'read', mapName: 'Mapa Tático' } });

    collabTest('o Executar não se desenha, o painel diz por quê, e a troca de nível com o painel aberto o acompanha', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        await drawPointUI(A, PONTO);
        await expect.poll(() => quantasFeicoes(B), { timeout: 20000 }).toBe(1);

        const painel = await abrirBuffer(B);
        const botao = painel.locator('.processing-panel__execute-btn');
        const aviso = painel.locator('.processing-panel__edit-unavailable');
        await expect(botao, 'o Leitor vê o Executar').toBeHidden();
        await expect(aviso).toHaveText(FRASE_DO_LEITOR);
        expect(await camadas(B)).toEqual(['Padrão']);

        // O dono promove o colega a Editor com o painel ABERTO: o Executar aparece.
        const mudarNivel = (nivel) => setSharePermission(A, collab.baseUrl, collab.userA, collab.atlasId, collab.userB.id, nivel);
        expect(await mudarNivel('write'), 'o PUT do compartilhamento').toBeLessThan(300);
        await expect(botao, 'a promoção não devolveu o Executar').toBeVisible({ timeout: 20000 });
        await expect(aviso).toBeHidden();

        // E o rebaixa de volta a Leitor: o Executar some de novo, com a frase do nível.
        expect(await mudarNivel('read'), 'o PUT do compartilhamento').toBeLessThan(300);
        await expect(botao, 'o rebaixamento deixou o Executar').toBeHidden({ timeout: 20000 });
        await expect(aviso).toHaveText(FRASE_DO_LEITOR);
    });
});

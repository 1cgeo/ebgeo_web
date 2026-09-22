// Path: e2e-ui/nome-de-feicao-grava-no-enter.spec.js

/**
 * @fileoverview O NOME DE FEIÇÃO CONFIRMADO NO PAINEL CHEGA AO STORE SOZINHO, e esta camada mede
 * isso SEM O CONTORNO que as outras usam.
 *
 * O CONTORNO: `renameViaPanelUI` (`helpers/collab-helpers.js`) confirma com Enter E clica
 * "Salvar", e `drawNamedPoint` (`helpers/main-round-trip.mjs`, que dirige o build da main)
 * clica "Salvar", passa por um valor intermediário e repete até o disco concordar. Os dois
 * existiam porque, até 2026-09-22, Enter só PREPARAVA o nome (fonte do MapLibre e memória), e
 * quem gravava era o "Salvar" do painel. Com o contorno, nenhum spec desta pasta via a edição
 * se perder; este arquivo existe para que a camada de UI meça o comportamento REAL.
 *
 * Os contornos antigos continuam onde estão, de propósito: o da main mede um build que este
 * ramo não conserta, e o `renameViaPanelUI` fecha o painel pelo "Salvar", que é o estado de que
 * os specs que o usam dependem.
 *
 * O QUE ESTE ARQUIVO NÃO FORÇA é a corrida da troca de conteúdo (edição no painel que sai
 * enquanto o novo é construído): a interleaving perdedora é determinística no teste de node
 * `tests/unit/nome-de-feicao-no-painel.repro.test.js`, e aqui o segundo caso só dirige o gesto
 * que a perdia no harness da main, sem repetir, e cobra o desfecho.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    drawPointUI,
    selectFeatureUI,
    readFeatures,
    clicarNoMapaUI,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const PONTO = [-43.2, -22.9];
/** Longe do ponto, dentro do mesmo enquadramento: o clique "no vazio" que desseleciona. */
const VAZIO = [-43.23, -22.93];

/** O nome daquela feição no STORE (IndexedDB, pela fachada do app), ou null. */
async function nomeNoStore(page, id) {
    const pontos = await readFeatures(page, 'points');
    return pontos.find((f) => f.id === id)?.nome ?? null;
}

/**
 * Abre o campo de nome do painel na tela, digita e confirma com Enter. O clique no nome é por
 * `dispatchEvent` pela razão que `main-round-trip.mjs` mediu: o painel pode se reconstruir
 * enquanto o `click()` espera o nó ficar estável, e ele esperaria até o teto.
 */
async function nomearNoPainel(page, nome) {
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await expect(painel.locator('.feature-identification-name')).toBeVisible({ timeout: 10000 });
    await painel.locator('.feature-identification-name').first().dispatchEvent('click');
    const campo = painel.locator(
        '.feature-identification-name-input:not(.feature-identification-name-input--hidden)');
    await expect(campo).toBeVisible({ timeout: 5000 });
    await campo.fill(nome);
    await campo.press('Enter');
    return painel;
}

describeOrSkip('o nome de feição confirmado no painel chega ao store (navegador real + backend real)', () => {
    // O segundo caso dirige um gesto cuja falha era de corrida: um retry transformaria a perda
    // num "flaky" verde, que é exatamente o que o contorno fazia.
    test.describe.configure({ retries: 0 });

    test('Enter grava, sem "Salvar" e sem desselecionar', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const NOME = 'Posto Alfa';

        try {
            const id = await drawPointUI(page, PONTO);
            await selectFeatureUI(page, id);
            // CONTROLE: o nome ainda não é o que vamos pedir.
            expect(await nomeNoStore(page, id)).not.toBe(NOME);

            const painel = await nomearNoPainel(page, NOME);

            await expect.poll(() => nomeNoStore(page, id), {
                timeout: 10000,
                message: 'o Enter não levou o nome ao store (sem "Salvar" e sem deselect)',
            }).toBe(NOME);
            // E nada desselecionou nem fechou o painel no caminho: quem gravou foi o Enter.
            await expect(painel).toBeVisible();
            await expect(painel.locator('.feature-identification-name').first()).toHaveText(NOME);
        } finally {
            await page.context().close();
        }
    });

    test('o gesto que perdia o nome no harness da main: desenhar, Escape, clicar, nomear, clicar no vazio', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const NOME = 'Posto Bravo';

        try {
            const id = await drawPointUI(page, PONTO);
            // O Escape que chega com o painel da criação ainda em construção: até 2026-09-22 a
            // construção terminava REABRINDO o painel para um ponto já desselecionado.
            await page.keyboard.press('Escape');
            await clicarNoMapaUI(page, PONTO);

            await nomearNoPainel(page, NOME);
            await clicarNoMapaUI(page, VAZIO);

            await expect.poll(() => nomeNoStore(page, id), {
                timeout: 10000,
                message: 'o nome digitado no painel não chegou ao store depois do deselect',
            }).toBe(NOME);
            // Uma feição com esse nome, e uma só.
            const comONome = (await readFeatures(page, 'points')).filter((f) => f.nome === NOME);
            expect(comONome.map((f) => f.id)).toEqual([id]);
        } finally {
            await page.context().close();
        }
    });
});

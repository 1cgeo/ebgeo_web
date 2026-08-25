// Path: e2e-ui/admin-botao-de-criar.spec.js

/**
 * O BOTÃO DE CRIAR DAS ABAS CATÁLOGO E PESSOAL, em Chromium real contra o backend real.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Até 2026-08-25 as duas abas punham a ação primária numa
 * `admin-users__toolbar` de UM item só, logo abaixo da sub-nav. Ali ela não se lia como "criar":
 * uma faixa cinza com um botão solto tem a forma de um filtro, e o chefe disse exatamente isso ao
 * ver a tela. A aba Usuários nunca teve o problema, porque desde sempre passa o botão em
 * `sectionHeader({ actions })` com o rótulo "+ Novo usuário". A correção foi trazer as duas
 * divergentes para esse padrão, e o `+` é a metade que responde "isto cria" antes da leitura.
 *
 * A ASSERÇÃO É DE LUGAR, e não de aparência. Nada aqui olha pixel, cor ou espaço: o que se prende
 * é que o botão está DENTRO do cabeçalho da seção, que o rótulo abre com `+`, e que ele continua
 * ACIONANDO o que acionava. Um botão bonito no lugar certo que não abre formulário nenhum seria a
 * pior das três saídas, então cada caso clica.
 *
 * O `testid` DO CATÁLOGO TROCA COM A CATEGORIA, e isso é desenho, não descuido: as quatro
 * categorias abrem formulário (`admin-catalog-new`) e o 360 abre o envio de bundle
 * (`admin-360-upload`), que é outra rota. São dois alvos que specs mais antigos já miram, e este
 * arquivo prende a troca para que ela não vire surpresa.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { closeDb } from './helpers/db.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Entra como administrador global e para no painel. Pessoal é aba só dele. */
async function entrarNoPainel(page) {
    const admin = await createVerifiedUser({ prefix: 'criar', nome: 'Criar Admin', role: 'admin' });
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await page.locator('[data-testid="login-username"]').fill(admin.username);
    await page.locator('[data-testid="login-password"]').fill(admin.password);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/atlas.html', { timeout: 20000 });
    await page.locator('[data-testid="projects-local-map"]').click();
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.locator('[data-testid="account-admin-btn"]').click();
    await page.waitForURL('**/admin.html', { timeout: 20000 });
    await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
}

/**
 * O botão está dentro do cabeçalho da seção, e o rótulo abre com `+`.
 *
 * O ANCESTRAL É A ASSERÇÃO INTEIRA. `toBeVisible` passaria verde com o botão de volta na faixa
 * solta, que é justamente o estado que se está corrigindo.
 */
async function conferirBotaoPrimario(page, testid, rotuloEsperado) {
    const botao = page.locator(`[data-testid="${testid}"]`);
    await expect(botao).toBeVisible({ timeout: 10000 });
    await expect(botao).toHaveText(rotuloEsperado);
    await expect(botao.locator('xpath=ancestor::*[contains(@class,"admin-section__header")]'))
        .toHaveCount(1);
}

describeOrSkip('Painel — o botão de criar mora no cabeçalho da seção', () => {
    test.afterAll(async () => { await closeDb(); });

    test('Catálogo: o rótulo e o alvo seguem a categoria, e o clique abre o formulário', async ({ page }) => {
        await entrarNoPainel(page);
        await page.locator('[data-testid="admin-tab-catalog"]').click();

        // A categoria que abre a aba. `CATEGORIES[0]` é 3D (modelos).
        await conferirBotaoPrimario(page, 'admin-catalog-new', '+ Novo — 3D (modelos)');

        // Trocar de categoria reescreve o rótulo, e o botão continua sendo UM.
        await page.locator('[data-testid="admin-cat-basemap"]').click();
        await conferirBotaoPrimario(page, 'admin-catalog-new', '+ Novo — Basemaps');
        await expect(page.locator('[data-testid="admin-catalog-new"]')).toHaveCount(1);

        // A CATEGORIA 360 TROCA A IDENTIDADE DO BOTÃO: outro rótulo, outro testid, outra rota.
        await page.locator('[data-testid="admin-cat-sv360"]').click();
        await conferirBotaoPrimario(page, 'admin-360-upload', '+ Enviar bundle 360°');
        await expect(page.locator('[data-testid="admin-catalog-new"]')).toHaveCount(0);

        // E VOLTA. Sem este trecho, um botão que trocasse de identidade só de ida passaria verde.
        await page.locator('[data-testid="admin-cat-data_layer"]').click();
        await conferirBotaoPrimario(page, 'admin-catalog-new', '+ Novo — Dados');
        await expect(page.locator('[data-testid="admin-360-upload"]')).toHaveCount(0);

        // FUNCIONA, e não só está bonito: o clique abre mesmo o formulário de criação.
        await page.locator('[data-testid="admin-catalog-new"]').click();
        await expect(page.locator('[data-testid="admin-catalog-id"]')).toBeVisible({ timeout: 10000 });
    });

    test('Pessoal: o rótulo segue a sub-lista, e o clique abre o formulário', async ({ page }) => {
        await entrarNoPainel(page);
        await page.locator('[data-testid="admin-tab-personnel"]').click();

        await conferirBotaoPrimario(page, 'admin-personnel-new', '+ Novo — Postos / Graduações');

        await page.locator('[data-testid="admin-personnel-om"]').click();
        await conferirBotaoPrimario(page, 'admin-personnel-new', '+ Novo — Organizações Militares');

        await page.locator('[data-testid="admin-personnel-new"]').click();
        await expect(page.locator('[data-testid="admin-personnel-save"]')).toBeVisible({ timeout: 10000 });
    });

    test('a faixa solta de um botão só não existe mais nas duas abas', async ({ page }) => {
        // O OUTRO LADO DA MUDANÇA. Mover o botão e esquecer a faixa deixaria uma tira cinza vazia
        // entre a sub-nav e a tabela, que é pior que o estado de partida.
        //
        // A CONTAGEM É DE FAIXAS COM UM FILHO SÓ, e não de faixas: a aba Usuários usa a MESMA
        // classe para a barra de busca dela, que é legítima e tem vários controles. Cobrar zero
        // `admin-users__toolbar` reprovaria a aba certa.
        await entrarNoPainel(page);

        for (const [aba, primeiraLista] of [
            ['admin-tab-catalog', 'admin-catalog-list'],
            ['admin-tab-personnel', 'admin-personnel-list'],
        ]) {
            await page.locator(`[data-testid="${aba}"]`).click();
            await expect(page.locator(`[data-testid="${primeiraLista}"]`)).toBeVisible({ timeout: 10000 });
            const solitarias = await page.locator('.admin-users__toolbar').evaluateAll(
                (nos) => nos.filter((n) => n.children.length === 1).length,
            );
            expect(solitarias, `faixa de um botao so ainda existe em ${aba}`).toBe(0);
        }
    });
});

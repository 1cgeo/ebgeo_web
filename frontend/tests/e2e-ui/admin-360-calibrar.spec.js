// Path: e2e-ui/admin-360-calibrar.spec.js

/**
 * O BOTÃO "CALIBRAR" DA LINHA DO CATÁLOGO 360, em Chromium real contra o backend real.
 *
 * POR QUE ELE EXISTE. Até 2026-08-25 a porta do estúdio de calibração era um botão GLOBAL, em dois
 * lugares: a barra do topo (`ui/app-bar.js`) e o menu do avatar no mapa (`account/account.control.js`).
 * Os dois levavam a `calibracao.html` sem parâmetro, e a página caía no seletor de projetos. O
 * defeito era de endereço, não de permissão: calibrar é sempre calibrar UM projeto, e o botão
 * global mandava escolher de novo o projeto que a pessoa já tinha na tela. O chefe mandou a porta
 * para o catálogo, na linha de cada projeto 360.
 *
 * O CONTRATO DA URL É UMA CHAVE SÓ. `calibration/app.js:105-111` lê `?photo=` e nada mais: não
 * existe `?projeto=` nem `?slug=`. O slug vem de graça, porque `startCalibration` busca os
 * metadados da foto e carrega o contexto do projeto sozinho.
 *
 * SÃO DOIS CAMINHOS, e este spec exerce os DOIS, porque `entry_photo_id` é anulável no DDL
 * (`007_sv360.sql:45`): com foto de entrada a URL leva `?photo=`; sem ela, leva ao estúdio pelado,
 * que ainda mostra o seletor. Um spec que só cobrisse o primeiro deixaria o desvio nulo sem prova,
 * e é justamente o desvio que um `undefined` na URL transformaria em tela quebrada.
 *
 * O QUE ESTE ARQUIVO NÃO PRENDE: a calibração em si. Ele para na navegação, porque o estúdio
 * precisa da pirâmide de tiles da foto, que o semeador não escreve. A prova de que o estúdio
 * desenha é outra camada.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { closeDb } from './helpers/db.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { seedSv360Photo } from './helpers/catalog-seed.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Entra e para no MAPA, com o controle de conta montado.
 *
 * OS TRÊS CASOS ENTRAM COMO ADMINISTRADOR, e não como produtor, porque o projeto que
 * `seedSv360Photo` escreve é da "Organização Padrão", e `fn_can_produce_resource` compara
 * IGUALDADE de OM. Um produtor de outra OM cairia no ramo "Mantido por outra OM" e não veria
 * botão nenhum, o que provaria outra coisa.
 */
async function entrarNoMapa(page, creds) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/atlas.html', { timeout: 20000 });
    await page.locator('[data-testid="projects-local-map"]').click();
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
}

/** Do mapa até a sub-lista 360 do catálogo, pelo menu do avatar. */
async function entrarNoCatalogo360(page, creds) {
    await entrarNoMapa(page, creds);
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.locator('[data-testid="account-admin-btn"]').click();
    await page.waitForURL('**/admin.html', { timeout: 20000 });
    await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid="admin-tab-catalog"]').click();
    await page.locator('[data-testid="admin-cat-sv360"]').click();
    await expect(page.locator('[data-testid="admin-360-list"]')).toBeVisible({ timeout: 10000 });
}

/** A linha da tabela 360 do projeto `slug`. `tr.dataset.slug` é o que a torna endereçável. */
function linhaDoProjeto(page, slug) {
    return page.locator(`[data-testid="admin-360-row"][data-slug="${slug}"]`);
}

describeOrSkip('Catálogo 360 — o botão Calibrar da linha', () => {
    test.afterAll(async () => { await closeDb(); });

    test('com foto de entrada, o botão leva ao estúdio JÁ NAQUELA foto', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'cal360a', nome: 'Cal Admin', role: 'admin' });
        const projeto = await seedSv360Photo(state.dbName, { entryPhotoId: true });
        await entrarNoCatalogo360(page, admin);

        const linha = linhaDoProjeto(page, projeto.slug);
        await expect(linha).toHaveCount(1, { timeout: 10000 });
        await linha.locator('[data-testid="admin-360-calibrar"]').click();

        // A URL é a asserção inteira: é ela o contrato entre a linha do catálogo e o estúdio.
        await page.waitForURL('**/calibracao.html?photo=*', { timeout: 20000 });
        const url = new URL(page.url());
        expect(url.searchParams.get('photo')).toBe(projeto.photoId);
    });

    test('sem foto de entrada, o botão leva ao estúdio sem parâmetro nenhum', async ({ page }) => {
        // CONTROLE DO DESVIO NULO. Sem este caso, um `?photo=undefined` passaria verde no caso de
        // cima e quebraria só aqui, que é o projeto recém-ingerido sem foto de entrada resolvida.
        const admin = await createVerifiedUser({ prefix: 'cal360b', nome: 'Cal Admin B', role: 'admin' });
        const projeto = await seedSv360Photo(state.dbName);
        await entrarNoCatalogo360(page, admin);

        const linha = linhaDoProjeto(page, projeto.slug);
        await expect(linha).toHaveCount(1, { timeout: 10000 });
        await linha.locator('[data-testid="admin-360-calibrar"]').click();

        await page.waitForURL('**/calibracao.html', { timeout: 20000 });
        expect(new URL(page.url()).search).toBe('');
    });

    test('a porta GLOBAL saiu das duas barras', async ({ page }) => {
        // O outro lado da mudança, e ele precisa de asserção própria: mover a porta e esquecer a
        // antiga deixaria duas, que é pior que uma no lugar errado.
        //
        // O MENU DO AVATAR SE MEDE ANTES DA IDA AO PAINEL, e não por um `goto('/atlas.html')`
        // depois: aquela página só monta o controle de conta depois que alguém escolhe um atlas,
        // então a navegação crua caía na tela de escolha e o seletor nunca aparecia.
        const admin = await createVerifiedUser({ prefix: 'cal360c', nome: 'Cal Admin C', role: 'admin' });
        await entrarNoMapa(page, admin);

        await page.locator('[data-testid="account-control"] .account-control__identity').click();
        // O CONTROLE POSITIVO PRIMEIRO: sem ele, um menu que não abriu passaria verde na ausência.
        await expect(page.locator('[data-testid="account-admin-btn"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="account-calibration-btn"]')).toHaveCount(0);

        // E a barra do topo do painel, que é a outra declaração: era `app-bar-calibration`.
        await page.locator('[data-testid="account-admin-btn"]').click();
        await page.waitForURL('**/admin.html', { timeout: 20000 });
        await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
        await expect(page.locator('[data-testid="app-bar-user"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="app-bar-calibration"]')).toHaveCount(0);
    });
});

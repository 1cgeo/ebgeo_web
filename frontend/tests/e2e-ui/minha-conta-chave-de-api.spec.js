// Path: e2e-ui/minha-conta-chave-de-api.spec.js

/**
 * A CHAVE DE API DE "MINHA CONTA", em Chromium real contra o backend real.
 *
 * POR QUE ESTE ARQUIVO EXISTE, e por que ele não podia ser um teste de unidade. A metade pura
 * desta tela (as frases, `apiKeySectionState`, `hasUncopiedKey`) já é testada em node. O que
 * nenhum teste de node alcança é o GUARDA DE FECHAMENTO: ele mora em `hide()`, e não no botão
 * de fechar, exatamente porque o Escape e o clique no fundo do modal chegam ali — e são esses
 * os gestos distraídos que jogariam a chave fora. Um teste que chamasse `hide()` na mão
 * exercitaria o método sem exercitar o gesto, que é a parte que o desenho existe para cobrir.
 *
 * O ENCADEAMENTO É O SUJEITO: a chave só é legível na resposta da rotação (nenhuma rota a lê de
 * volta), então "aparece uma única vez" não é uma frase de tela, é uma propriedade do produto —
 * e este arquivo a mede fechando e reabrindo a janela.
 *
 * O CONTROLE POSITIVO É O QUE FAZ O NEGATIVO SIGNIFICAR ALGO. Assere-se que fechar SEM copiar
 * pergunta, e também que fechar DEPOIS de copiar NÃO pergunta. Sem o segundo, uma confirmação
 * incondicional no fechamento (que é o desenho errado, porque transformaria toda saída da tela
 * num diálogo) passaria verde no primeiro.
 *
 * A ÁREA DE TRANSFERÊNCIA É PERMISSÃO DE NAVEGADOR, concedida aqui de propósito: só uma escrita
 * BEM-SUCEDIDA marca a chave como copiada (é o `await navigator.clipboard.writeText` que decide),
 * e sem a permissão o caso "copiou" mediria a falha de cópia em vez do fechamento silencioso.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** O título da confirmação que o fechamento dispara quando a chave está na tela e não foi copiada. */
const TITULO_DESCARTE = 'Fechar sem copiar a chave?';

/** Boota anônimo, entra pela interface e para no mapa. */
async function entrarNoMapa(page, creds) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto('/');
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

/** Abre "Minha conta" pelo menu da conta e espera a leitura dos dois documentos terminar. */
async function abrirMinhaConta(page) {
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.locator('[data-testid="account-settings-btn"]').click();
    await expect(page.locator('[data-testid="account-settings-modal"]')).toBeVisible({ timeout: 15000 });
    // O botão de gerar chave só existe depois do desenho do corpo, que espera `GET /users/me`
    // e `GET /auth/me`: clicar antes cairia no estado "Carregando os seus dados...".
    await expect(page.locator('[data-testid="account-settings-rotate-key"]')).toBeVisible({ timeout: 15000 });
}

/** Gera a chave passando pela confirmação destrutiva, e devolve o texto revelado. */
async function gerarChave(page) {
    await page.locator('[data-testid="account-settings-rotate-key"]').click();
    const confirmacao = page.locator('.confirm-modal-overlay');
    await expect(confirmacao).toBeVisible({ timeout: 10000 });
    await expect(confirmacao).toContainText('Gerar uma chave de API nova?');
    await confirmacao.locator('.confirm-modal-btn-confirm').click();

    const caixa = page.locator('[data-testid="account-settings-key-box"]');
    await expect(caixa).toBeVisible({ timeout: 20000 });
    const chave = (await page.locator('[data-testid="account-settings-key-value"]').innerText()).trim();
    expect(chave.length).toBeGreaterThan(10);
    return chave;
}

describeOrSkip('Minha conta — a seção de chave de API', () => {
    test('fechar com a chave na tela SEM ter copiado pergunta antes, e voltar preserva a chave', async ({ page }) => {
        const user = await createVerifiedUser({ prefix: 'chaveui', nome: 'Dono da Chave' });
        await entrarNoMapa(page, user);
        await abrirMinhaConta(page);
        const chave = await gerarChave(page);

        // O GESTO DISTRAÍDO, e é ele que o guarda existe para pegar: Escape não passa pelo botão
        // de fechar, então um guarda pendurado no botão deixaria esta porta aberta.
        await page.keyboard.press('Escape');
        const descarte = page.locator('.confirm-modal-overlay');
        await expect(descarte).toBeVisible({ timeout: 10000 });
        await expect(descarte).toContainText(TITULO_DESCARTE);
        await expect(descarte.locator('.confirm-modal-btn-cancel')).toHaveText('Voltar e copiar');

        // "Voltar e copiar" volta MESMO: a janela continua aberta e a chave continua legível,
        // com o mesmo texto. Fechar aqui seria perder o segredo depois de perguntar.
        await descarte.locator('.confirm-modal-btn-cancel').click();
        await expect(descarte).toHaveCount(0, { timeout: 10000 });
        await expect(page.locator('[data-testid="account-settings-modal"]')).toBeVisible();
        await expect(page.locator('[data-testid="account-settings-key-value"]')).toHaveText(chave);

        // O clique no FUNDO chega ao mesmo `hide()`, e é o outro gesto distraído. Ele pergunta
        // igual — e desta vez a resposta é sim.
        await page.locator('[data-testid="account-settings-modal"]').click({ position: { x: 5, y: 5 } });
        await expect(descarte).toBeVisible({ timeout: 10000 });
        await expect(descarte).toContainText(TITULO_DESCARTE);
        await descarte.locator('.confirm-modal-btn-confirm').click();
        await expect(page.locator('[data-testid="account-settings-modal"]')).toHaveCount(0, { timeout: 10000 });

        // A CHAVE APARECE UMA ÚNICA VEZ: reabrir a tela não a traz de volta, porque nenhuma rota
        // a lê e ela morre com a instância do modal.
        await abrirMinhaConta(page);
        await expect(page.locator('[data-testid="account-settings-key-box"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="account-settings-key-value"]')).toHaveCount(0);
    });

    test('depois de COPIAR, fechar não pergunta nada', async ({ page, context }) => {
        // Só uma escrita bem-sucedida na área de transferência marca a chave como copiada.
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        const user = await createVerifiedUser({ prefix: 'chaveui', nome: 'Dono da Chave' });
        await entrarNoMapa(page, user);
        await abrirMinhaConta(page);
        const chave = await gerarChave(page);

        await page.locator('[data-testid="account-settings-copy-key"]').click();
        // A prova de que a cópia FUNCIONOU (e não caiu no `catch` que mostra o toast de erro) é
        // a nota que só é desenhada com o sinalizador ligado.
        await expect(page.locator('[data-testid="account-settings-key-box"]'))
            .toContainText('Chave copiada para a área de transferência.', { timeout: 10000 });
        // E o conteúdo real da área de transferência, que é o fato que o usuário levou consigo.
        const naAreaDeTransferencia = await page.evaluate(() => navigator.clipboard.readText());
        expect(naAreaDeTransferencia.trim()).toBe(chave);

        await page.keyboard.press('Escape');
        await expect(page.locator('[data-testid="account-settings-modal"]')).toHaveCount(0, { timeout: 10000 });
        // O CONTROLE QUE FAZ O CASO ANTERIOR SIGNIFICAR ALGO: nenhuma confirmação apareceu.
        await expect(page.locator('.confirm-modal-overlay')).toHaveCount(0);
    });

    test('fechar SEM chave nenhuma na tela não pergunta nada', async ({ page }) => {
        // O outro controle: o guarda é sobre a CHAVE na tela, não sobre a tela. Sem ele, uma
        // confirmação incondicional no fechamento de "Minha conta" passaria no primeiro caso.
        const user = await createVerifiedUser({ prefix: 'chaveui', nome: 'Dono da Chave' });
        await entrarNoMapa(page, user);
        await abrirMinhaConta(page);
        await expect(page.locator('[data-testid="account-settings-key-box"]')).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(page.locator('[data-testid="account-settings-modal"]')).toHaveCount(0, { timeout: 10000 });
        await expect(page.locator('.confirm-modal-overlay')).toHaveCount(0);
    });
});

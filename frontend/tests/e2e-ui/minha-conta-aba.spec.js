// Path: e2e-ui/minha-conta-aba.spec.js

/**
 * "MINHA CONTA" COMO ABA DO PAINEL, em Chromium real contra o backend real.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Em 2026-08-25 a tela deixou de ser modal
 * (`modals/account-settings.modal.js`, apagado) e virou a aba `account`
 * (`admin/account-tab.js`), e no mesmo ato a seção de CHAVE DE API saiu da tela do usuário e o
 * botão "Revogar chave" saiu da aba Usuários. As duas metades precisam de prova de tela, e por
 * razões diferentes:
 *
 *   - a metade que ENTROU se prova por presença: a aba aparece no trilho das audiências, abre, e
 *     as três seções desenham;
 *   - a metade que SAIU só se prova por AUSÊNCIA, que é a asserção fácil de fazer errar. Por isso
 *     ela vem acompanhada de controle positivo: a mesma tela em que "chave" não aparece TEM de
 *     conter "Trocar a senha". Sem ele, uma aba que não desenhasse nada passaria verde.
 *
 * AS DUAS AUDIÊNCIAS SÃO O SUJEITO, e não decoração. `adminAudience` recorta as abas por papel, e
 * `account` entrou nas TRÊS listas: o usuário comum, que só vê Grupos e Concessões, e o
 * administrador, que vê as oito. Medir só uma deixaria o recorte pela metade.
 *
 * AS CONTAS SÃO SEMEADAS AQUI, e não são `pedro` e `admin` do banco de desenvolvimento: esta
 * camada sobe um backend DESCARTÁVEL, com banco próprio e vazio (ver `global-setup.js`), então
 * conta de máquina de ninguém existe nele. `createVerifiedUser` cria o equivalente pelo que
 * importa, que é o PAPEL GLOBAL: `role: 'user'` para o público que só vê Grupos e Concessões, e
 * `role: 'admin'` para quem vê tudo.
 *
 * OS TESTIDS DA CHAVE SÃO MONTADOS EM PEDAÇOS, e isso não é estilo. O guarda
 * `tests/unit/e2e-testids-existem.test.js` varre este arquivo procurando seletor de testid escrito
 * por extenso e reprova todo alvo que não exista em `src/`. Um spec que afirma AUSÊNCIA cita
 * justamente
 * testids que não existem mais, então escrevê-los inteiros deixaria aquele guarda vermelho para
 * sempre. A interpolação é a saída prevista por ele: a extração exclui `$` do que captura.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** O prefixo dos testids da tela de conta. Ver o `fileoverview`: ele é montado, nunca escrito. */
const PREFIXO_CONTA = 'account-settings-';

/**
 * Os quatro alvos que a seção de chave desenhava, hoje inexistentes.
 * @param {string} sufixo
 * @returns {string}
 */
function alvoDeChave(sufixo) {
    return `[data-testid="${PREFIXO_CONTA}${sufixo}"]`;
}

const ALVOS_DE_CHAVE = ['rotate-key', 'key-box', 'key-value', 'copy-key'].map(alvoDeChave);

/**
 * Boota anônimo, entra pela interface e para no seletor de atlas.
 *
 * A ENTRADA É POR `atlas.html`, e não pelo mapa, de propósito. O padrão da casa (`loginThroughUi`,
 * em `browser-admin-users.spec.js`) passa pelo mapa porque aqueles casos precisam do mapa depois;
 * estes não precisam dele em momento nenhum, e cada boot de MapLibre é a parte cara e a mais
 * sujeita a estouro de tempo desta camada. "Entrar" também mora aqui desde que "Seus atlas" virou
 * página (`projects-login`, em `projects/atlas-drive.js`).
 */
async function entrar(page, creds) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto('/atlas.html');
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/atlas.html');
    await page.locator('[data-testid="projects-login"]').click({ timeout: 20000 });
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    // O sucesso recarrega a página com sessão, e a prova de que ela chegou é o botão que só a
    // barra do topo AUTENTICADA desenha.
    await expect(page.locator('[data-testid="app-bar-account"]')).toBeVisible({ timeout: 20000 });
}

/** Abre `admin.html` (com a query que vier) e espera a casca do painel. */
async function abrirPainel(page, query = '') {
    await page.goto(`/admin.html${query}`);
    await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
}

/** Espera a aba de conta terminar as DUAS leituras de abertura (`/users/me` e `/auth/me`). */
async function esperarContaDesenhada(page) {
    await expect(page.locator('[data-testid="admin-account"]')).toBeVisible({ timeout: 15000 });
    // O botão de salvar só existe depois do desenho do perfil: enquanto as leituras estão em voo
    // a seção mostra "Carregando os seus dados...".
    await expect(page.locator('[data-testid="account-settings-save-profile"]')).toBeVisible({ timeout: 15000 });
}

/**
 * As três seções desenham, e a de e-mail depende de uma bandeira do servidor.
 *
 * O PISO É A BANDEIRA, e não a seção: `PUT /users/me/email` é montada sob `canDeliverAccountMail()`
 * (`isSmtpConfigured() || !config.isProd`), e a aba só oferece a seção onde o servidor consegue
 * entregar. Fora de produção o predicado é verdadeiro, então a seção TEM de estar lá; medir a
 * bandeira antes é o que faz um vermelho aqui nomear a causa em vez de acusar a aba.
 */
async function conferirAsTresSecoes(page) {
    const entrega = await (await fetch(`${state.baseUrl}/api/v1/config`)).json();
    expect(entrega?.data?.features?.password_reset_email,
        'o backend descartável não entrega e-mail: a seção de troca de e-mail não é desenhada')
        .toBe(true);

    const conta = page.locator('[data-testid="admin-account"]');
    await expect(conta.locator('[data-section="perfil"]')).toBeVisible();
    await expect(conta.locator('[data-section="email"]')).toBeVisible();
    await expect(conta.locator('[data-section="senha"]')).toBeVisible();
    // O CONTROLE POSITIVO das ausências logo abaixo: a tela desenhou conteúdo de verdade.
    await expect(conta).toContainText('Meus dados');
    await expect(conta).toContainText('Trocar o e-mail');
    await expect(conta).toContainText('Trocar a senha');
}

/** Nada de chave de API na tela: nem por texto, nem por testid. */
async function conferirSemChaveDeApi(page) {
    await expect(page.locator('[data-testid="admin-panel"]')).not.toContainText(/chave de api/i);
    await expect(page.locator('[data-testid="admin-account"]')).not.toContainText(/chave/i);
    for (const alvo of ALVOS_DE_CHAVE) {
        await expect(page.locator(alvo)).toHaveCount(0);
    }
}

describeOrSkip('Minha conta — a aba do painel (navegador real + backend real)', () => {
    test('o usuário comum recebe a aba, ela abre com as três seções e sem chave de API', async ({ page }) => {
        const user = await createVerifiedUser({ prefix: 'contauser', nome: 'Usuario Comum', role: 'user' });
        await entrar(page, user);
        await abrirPainel(page);

        // A AUDIÊNCIA DELE, medida antes: ele vê Grupos, Concessões e Minha conta, e NÃO vê
        // Usuários. Sem a segunda metade, um painel que mostrasse tudo a todo mundo passaria.
        await expect(page.locator('[data-testid="admin-tab-groups"]')).toBeVisible();
        await expect(page.locator('[data-testid="admin-tab-grants"]')).toBeVisible();
        await expect(page.locator('[data-testid="admin-tab-account"]')).toBeVisible();
        await expect(page.locator('[data-testid="admin-tab-users"]')).toHaveCount(0);
        // Sem query, a primeira aba é a que abre. É o controle do caso de deep-link abaixo.
        await expect(page.locator('[data-testid="admin-tab-groups"]'))
            .toHaveAttribute('aria-selected', 'true');

        await page.locator('[data-testid="admin-tab-account"]').click();
        await esperarContaDesenhada(page);
        await conferirAsTresSecoes(page);
        await conferirSemChaveDeApi(page);
    });

    test('o administrador recebe a mesma aba, e a aba Usuários não revoga chave nenhuma', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'contaadmin', nome: 'Admin da Conta', role: 'admin' });
        await entrar(page, admin);
        await abrirPainel(page);

        await expect(page.locator('[data-testid="admin-tab-users"]')).toBeVisible();
        await expect(page.locator('[data-testid="admin-tab-account"]')).toBeVisible();
        await expect(page.locator('[data-testid="admin-tab-users"]'))
            .toHaveAttribute('aria-selected', 'true');

        await page.locator('[data-testid="admin-tab-account"]').click();
        await esperarContaDesenhada(page);
        await conferirAsTresSecoes(page);
        await conferirSemChaveDeApi(page);

        // A ABA USUÁRIOS: a linha do próprio administrador basta, e ela existe sempre.
        await page.locator('[data-testid="admin-tab-users"]').click();
        await expect(page.locator('[data-testid="admin-users-row"]').first())
            .toBeVisible({ timeout: 15000 });
        // O CONTROLE POSITIVO, senão uma listagem vazia provaria a ausência de graça: os outros
        // botões da mesma célula continuam de pé.
        await expect(page.getByRole('button', { name: 'Editar' }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'Revogar chave' })).toHaveCount(0);
        await expect(page.locator('[data-testid="admin-body"]')).not.toContainText(/chave de api/i);
    });

    test('admin.html?aba=account abre direto na aba, e um id que a pessoa não tem cai na primeira', async ({ page }) => {
        const user = await createVerifiedUser({ prefix: 'contalink', nome: 'Link Direto', role: 'user' });
        await entrar(page, user);

        await abrirPainel(page, '?aba=account');
        await expect(page.locator('[data-testid="admin-tab-account"]'))
            .toHaveAttribute('aria-selected', 'true');
        await esperarContaDesenhada(page);

        // A OUTRA METADE DA REGRA: o casamento é com a aba MONTADA, nunca com a lista de ids que
        // existem. `users` existe como aba do sistema e NÃO é dele, então a query cai na primeira
        // aba dele, em silêncio. Sem este caso, um deep-link que aceitasse qualquer id passaria.
        await abrirPainel(page, '?aba=users');
        await expect(page.locator('[data-testid="admin-tab-groups"]'))
            .toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-testid="admin-account"]')).toHaveCount(0);
    });
});

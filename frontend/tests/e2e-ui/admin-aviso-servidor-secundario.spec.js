// Path: e2e-ui/admin-aviso-servidor-secundario.spec.js

/**
 * @fileoverview O ADMINISTRADOR LIGA E DESLIGA O AVISO DE SERVIDOR SECUNDÁRIO pela aba Sistema,
 * em Chromium real contra o backend real da bancada.
 *
 * POR QUE ESTE SPEC EXISTE. Desde 2026-09-04 o padrão do servidor é DESLIGADO e quem acende a
 * tela é o painel (decisão do chefe). Isso faz do caminho administrador -> `PUT /config/admin`
 * -> `GET /api/config` -> tela do mapa a única forma de o aviso aparecer numa instalação real,
 * e ele atravessa os dois pacotes: nenhuma metade sozinha prova que ele funciona. O irmão
 * `secondary-server-notice.spec.js` prova a TELA, ligando a chave por remendo da resposta a
 * caminho do navegador, e continua provando-a se este arquivo sumir; aqui se prova a FIAÇÃO, e
 * a tela entra só como a evidência de que a fiação chegou ao fim.
 *
 * O ESTADO VAZA, E A LIMPEZA É OBRIGATÓRIA. Ao contrário do remendo do irmão, que vive na
 * página, o override daqui é gravado no BANCO da bancada e sobrevive ao spec: um `true`
 * esquecido põe uma sobreposição que captura todo `keydown` em cima do primeiro clique de cada
 * spec que rodar depois (o Playwright deste pacote roda em série, `workers: 1`), e o sintoma
 * seria uma dúzia de arquivos falhando por um motivo que não é o deles. Por isso a restauração
 * mora num `finally` e é AFIRMADA, por um caminho HTTP independente do da página que escreveu.
 *
 * A restauração pode mascarar o erro do corpo do teste quando os dois falham juntos, e isso é
 * aceito de propósito: entre saber que o gesto quebrou e saber que a bancada ficou suja, a
 * segunda notícia é a que salva a rodada inteira.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { closeDb } from './helpers/db.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Endereço de teste, e de propósito NÃO o default do backend: um valor igual ao padrão não provaria que o campo chegou ao payload. */
const URL_PRINCIPAL = 'https://principal.exemplo.mil.br/';

/** A conta nasce no lado node; só a promoção a admin global é SQL (ver `helpers/accounts.js`). */
async function seedAdmin(page) {
    await page.goto('/');
    return createVerifiedUser({ prefix: 'avisoadmin', nome: 'Aviso Admin', role: 'admin' });
}

async function loginThroughUi(page, baseUrl, creds) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${baseUrl}/api/v1`);
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

/** Abre o painel na aba Sistema, com o formulário já carregado. */
async function abrirAbaSistema(page) {
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.locator('[data-testid="account-admin-btn"]').click();
    await page.waitForURL('**/admin.html', { timeout: 20000 });
    await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid="admin-tab-config"]').click();
    await expect(page.locator('[data-testid="admin-config-form"]')).toBeVisible({ timeout: 10000 });
}

/** O que a PÁGINA vê em GET /api/config, pelo cliente vivo do app. */
function lerConfigPelaPagina(page) {
    return page.evaluate(async () => {
        const { apiClient } = await import('/src/js/store/sync/api-client.js');
        return apiClient.getConfig();
    });
}

describeOrSkip('aba Sistema, o aviso de servidor secundário (Chromium real + backend real)', () => {
    test.afterAll(async () => { await closeDb(); });

    test('o administrador liga o aviso, o mapa passa a abri-lo, e desligar o remove', async ({ page, request }) => {
        const admin = await seedAdmin(page);
        await loginThroughUi(page, state.baseUrl, admin);

        try {
            // PISO: o padrão do servidor é desligado, e sem esta leitura o "ligou" adiante não
            // se distinguiria de "já estava ligado".
            const antes = await lerConfigPelaPagina(page);
            expect(antes.app.avisoServidorSecundario).toBe(false);

            // ===== LIGAR =====
            await abrirAbaSistema(page);
            await page.locator('[data-testid="admin-config-aviso-secundario"]').check();
            await page.locator('[data-testid="admin-config-url-principal"]').fill(URL_PRINCIPAL);
            await page.locator('[data-testid="admin-config-save"]').click();
            await expect(page.locator('[data-testid="admin-config-notice"]')).toBeVisible({ timeout: 10000 });
            await expect(page.locator('[data-testid="admin-config-error"]')).toBeHidden();

            // O payload que o cliente lê, buscado pela própria página: é o memo derrubado pela
            // escrita que faz este valor chegar sem reiniciar o servidor.
            const ligado = await lerConfigPelaPagina(page);
            expect(ligado.app.avisoServidorSecundario).toBe(true);
            expect(ligado.app.urlServidorPrincipal).toBe(URL_PRINCIPAL);

            // A caixa volta marcada na releitura do formulário, que é como o administrador
            // confere o que salvou.
            await expect(page.locator('[data-testid="admin-config-aviso-secundario"]')).toBeChecked();

            // ===== O MAPA ABRE COM A TELA =====
            await page.goto('/');
            const aviso = page.locator('.server-notice');
            await expect(aviso).toBeVisible({ timeout: 20000 });
            const principal = page.locator('.server-notice__button--primary');
            await expect(principal).toHaveAttribute('href', URL_PRINCIPAL);
            await expect(principal).toContainText('principal.exemplo.mil.br');
            // Fecha a sobreposição antes de voltar ao painel: enquanto ela está de pé, ela
            // captura todo keydown e senta sobre os cliques da barra superior.
            await page.locator('.server-notice__button--secondary').click();
            await expect(aviso).toHaveCount(0, { timeout: 5000 });

            // ===== DESLIGAR =====
            await abrirAbaSistema(page);
            await expect(page.locator('[data-testid="admin-config-aviso-secundario"]')).toBeChecked();
            await page.locator('[data-testid="admin-config-aviso-secundario"]').uncheck();
            await page.locator('[data-testid="admin-config-save"]').click();
            await expect(page.locator('[data-testid="admin-config-notice"]')).toBeVisible({ timeout: 10000 });

            const desligado = await lerConfigPelaPagina(page);
            expect(desligado.app.avisoServidorSecundario).toBe(false);
            // O ENDEREÇO SOBREVIVE ao desligamento, e é o que faz religar ser um clique só: as
            // duas chaves são independentes na fusão do servidor.
            expect(desligado.app.urlServidorPrincipal).toBe(URL_PRINCIPAL);

            // ===== O MAPA ABRE SEM A TELA =====
            await page.goto('/');
            // Espera o boot passar da fase em que a tela seria montada, senão a ausência seria
            // só a ausência de quem ainda não chegou lá.
            await expect(page.locator('.toolbar-tool-btn').first()).toBeAttached({ timeout: 20000 });
            await expect(page.locator('.server-notice')).toHaveCount(0);
        } finally {
            // A LIMPEZA. A escrita vai pela página (é quem tem a sessão de administrador) e a
            // conferência vem por HTTP cru, que não passa por nenhum código que este teste
            // acabou de exercitar.
            try {
                await page.evaluate(async () => {
                    const { apiClient } = await import('/src/js/store/sync/api-client.js');
                    await apiClient.updateConfigOverrides({ app: { avisoServidorSecundario: false } });
                });
            } catch {
                // A página pode ter morrido com o corpo do teste; a afirmação abaixo é que decide.
            }
            const resposta = await request.get(`${state.baseUrl}/api/v1/config`);
            expect(resposta.ok(), 'a conferência da limpeza precisa alcançar o servidor').toBe(true);
            const corpo = await resposta.json();
            expect(
                corpo.data.app.avisoServidorSecundario,
                'a bancada ficou com o aviso LIGADO: todo spec seguinte vai encontrar a sobreposição',
            ).toBe(false);
        }
    });
});

// Path: e2e-ui/aparencia-atravessa-trocas-de-atlas.spec.js

/**
 * @fileoverview A aparência é DO ATLAS, e este caso percorre todas as trocas para provar que ela
 * não vaza nem se perde: local→local, local→remoto, remoto→remoto, remoto→local, e o logout.
 *
 * A PERGUNTA QUE ELE RESPONDE não é "salva?" (isso `aparencia-do-atlas-persiste` já mede) e sim
 * "salva NO LUGAR CERTO?". O cache da projeção vive num módulo, então toda troca de atlas é uma
 * chance de o valor do anterior continuar valendo — e foi assim que um slot local marcado "plano"
 * deixou plano um projeto de servidor que nunca escolheu nada. Cada parada afirma as duas metades:
 * o que o disco tem e o que o app está usando.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const PROJETOS = '/atlas.html';

function lerAparencia(page) {
    return page.evaluate(async () => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const svc = await import('/src/js/store/atlas-appearance.service.js');
        const atlas = await getRepository().getAtlas();
        return {
            globoNoDisco: atlas?.settings?.globeProjection ?? null,
            exageroNoDisco: atlas?.settings?.terrainExaggeration ?? null,
            globoEfetivo: svc.currentGlobeProjection(),
        };
    });
}

async function esperarMapa(page) {
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
}

/** Marca "Plano" + um exagero e salva. */
async function configurarPlano(page, exagero) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await page.locator('.sidebar-settings-btn').click();
    await expect(page.locator('[data-testid="atlas-settings-modal"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="atlas-settings-projection-plano"]').click();
    const slider = page.locator('[data-testid="atlas-settings-exaggeration"]');
    await slider.fill(String(exagero));
    await slider.dispatchEvent('input');
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('[data-testid="atlas-settings-modal"]')).toHaveCount(0, { timeout: 10000 });
}

describeOrSkip('aparência atravessa as trocas de atlas', () => {
    test('não vaza entre projetos e volta inteira quando se volta', async ({ browser }) => {
        test.setTimeout(300000);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);

        // A CONTA nasce no lado Node (`helpers/accounts.js`): confirmar o e-mail exige ler
        // `email_verification_tokens` no Postgres, fora do alcance do contexto do browser.
        const creds = await createVerifiedUser({ prefix: 'trocas', nome: 'Trocas' });
        await page.goto('/');
        await page.evaluate(async ({ base, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${base}/api/v1` });
            await api.login(u.username, u.password);
            await api.createAtlas({ name: 'AAA Servidor um' });
            await api.createAtlas({ name: 'ZZZ Servidor dois' });
            // Sem tokens: a primeira metade é anônima, e um visitante COM sessão numa URL nua é
            // mandado para a tela de projetos antes de o mapa existir.
            api.clearTokens();
        }, { base: state.baseUrl, u: creds });

        // ---------- LOCAL #1: escolhe plano ----------
        await esperarMapa(page);
        expect((await lerAparencia(page)).globoEfetivo, 'o padrão do produto é globo').toBe(true);
        await configurarPlano(page, 2.4);
        expect(await lerAparencia(page)).toMatchObject({ globoNoDisco: false, exageroNoDisco: 2.4 });

        // ---------- LOCAL → LOCAL ----------
        await page.goto(PROJETOS);
        await page.locator('[data-testid="local-atlas-create"]').click();
        await page.locator('[data-testid="local-atlas-name-input"]').fill('Segundo local');
        await page.locator('[data-testid="local-atlas-name-confirm"]').click();
        // O CLIQUE NO CARTAO SAIU EM 2026-08-25, e nao por conveniencia: criar um atlas local
        // AGORA JA ABRE o atlas (pedido do dono). O cartao nunca chega a ser desenhado, entao o
        // clique que estava aqui esperava um elemento que a pagina nao ia mais mostrar.
        await esperarMapa(page);
        const segundoLocal = await lerAparencia(page);
        expect(segundoLocal.globoEfetivo, 'o "plano" do primeiro slot vazou para o segundo').toBe(true);
        expect(segundoLocal.globoNoDisco, 'um atlas novo não tem escolha gravada').toBe(null);

        // ---------- LOCAL → REMOTO ----------
        await page.goto(PROJETOS);
        await page.locator('[data-testid="projects-login"]').click();
        await page.locator('[data-testid="login-username"]').fill(creds.username);
        await page.locator('[data-testid="login-password"]').fill(creds.password);
        await page.locator('[data-testid="login-submit"]').click();
        await expect(page.locator('[data-testid="project-picker-item"]').first())
            .toBeVisible({ timeout: 30000 });

        const abrirServidor = async (nome) => {
            await page.locator('[data-testid="project-picker-item"]', { hasText: nome }).click();
            await expect(page.locator('[data-testid="sync-status-badge"]'))
                .toHaveAttribute('data-state', 'online', { timeout: 30000 });
            await esperarMapa(page);
        };

        await abrirServidor('AAA Servidor um');
        // POLL: o badge online NÃO significa aparência relida. Em `openRemoteAtlas` o
        // `syncEngine.connect()` (que acende o badge) vem ANTES de `reapplyAtlasAppearance()`, e
        // `globoEfetivo` lê um cache de módulo que até lá guarda a escolha do atlas anterior. O
        // irmão `aparencia-do-atlas-persiste.spec.js` reprovou exatamente assim numa máquina rápida.
        await expect
            .poll(async () => (await lerAparencia(page)).globoEfetivo, { timeout: 20000 })
            .toBe(true); // o local vazou para o servidor
        await configurarPlano(page, 1.9);
        await page.waitForTimeout(3000); // a op precisa subir antes de trocar de atlas

        // ---------- REMOTO → REMOTO ----------
        await page.goto(PROJETOS);
        await abrirServidor('ZZZ Servidor dois');
        // Mesma corrida da leitura acima, mesmo motivo: espere a releitura, não o badge.
        await expect
            .poll(async () => (await lerAparencia(page)).globoEfetivo, { timeout: 20000 })
            .toBe(true); // um projeto de servidor herdou a projeção do outro
        expect((await lerAparencia(page)).globoNoDisco).toBe(null);

        // ---------- REMOTO → REMOTO (de volta ao que escolheu plano) ----------
        await page.goto(PROJETOS);
        await abrirServidor('AAA Servidor um');
        await expect.poll(async () => (await lerAparencia(page)).globoNoDisco, { timeout: 20000 })
            .toBe(false);
        expect((await lerAparencia(page)).exageroNoDisco).toBeCloseTo(1.9, 5);

        // ---------- REMOTO → LOCAL ----------
        await page.goto(PROJETOS);
        await page.locator('[data-testid="local-atlas-item"]', { hasText: 'Meu Atlas' }).click();
        await esperarMapa(page);
        const voltaAoLocal = await lerAparencia(page);
        expect(voltaAoLocal.globoNoDisco, 'o atlas local perdeu a escolha ao voltar').toBe(false);
        expect(voltaAoLocal.exageroNoDisco).toBeCloseTo(2.4, 5);
        expect(voltaAoLocal.globoEfetivo).toBe(false);

        // ---------- DESLOGAR ----------
        await page.goto(PROJETOS);
        await page.locator('[data-testid="app-bar-logout"]').click();
        await esperarMapa(page);
        const deslogado = await lerAparencia(page);
        expect(deslogado.globoNoDisco, 'sair da conta apagou a preferência do atlas local').toBe(false);
        expect(deslogado.exageroNoDisco).toBeCloseTo(2.4, 5);
        expect(deslogado.globoEfetivo).toBe(false);

        await ctx.close();
    });
});

// Path: e2e-ui/browser-basemap-privado.spec.js

/**
 * A CAMADA BASE PRIVADA, DA ADMINISTRAÇÃO ATÉ O SELETOR (F9, item 2), em Chromium real contra o
 * backend real.
 *
 * O basemap virou o quinto tipo de recurso na migração 021, e a superfície dele não é o catálogo
 * (ele não tem cartão lá): é o SELETOR DE CAMADA BASE. Este spec percorre o caminho inteiro pela
 * interface — o administrador cria a camada, marca o eixo de acesso como Privado, volta ao mapa e
 * a encontra no seletor — porque cada perna dele já falhou por um motivo diferente:
 *
 *  - a lista do seletor é montada no boot e o recurso privado chega DEPOIS, pelo payload aditivo;
 *  - o clique só troca o mapa se o estilo publicado (`config.basemapStyles`) for resolvido — o
 *    controle conhecia apenas os cinco estilos embutidos, e a camada criada pelo painel caía
 *    silenciosamente noutra;
 *  - sem o botão "Compartilhar" aqui, um basemap privado não teria tela nenhuma que conceda
 *    acesso a ele, que é a metade que a 021 abriu do lado do servidor.
 *
 * O estilo de teste é um `background` de cor sólida: ele não depende de rede e a cor no pixel é a
 * prova de que o estilo PUBLICADO (e não um dos embutidos) foi aplicado.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** A cor do estilo publicado — a marca que distingue o estilo do basemap novo de qualquer embutido. */
const COR_ESTILO = '#c2185b';

async function seedAdmin(page, baseUrl, dbName) {
    await page.goto('/');
    const creds = await page.evaluate(async (url) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${url}/api/v1` });
        const username = `bmadmin_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
        await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'BM Admin' });
        return { username, password: 'Sup3r-Secret-Pw!' };
    }, baseUrl);
    await createDb(dbName).raw.none(
        "UPDATE users SET role = 'admin' WHERE LOWER(username) = LOWER($1)", [creds.username]);
    return creds;
}

async function loginAndOpenCatalog(page, baseUrl, creds) {
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
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.locator('[data-testid="account-admin-btn"]').click();
    await page.waitForURL('**/admin.html', { timeout: 20000 });
    await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid="admin-tab-catalog"]').click();
    await expect(page.locator('[data-testid="admin-cat-basemap"]')).toBeVisible({ timeout: 5000 });
}

/** Cria uma camada base pelo formulário do painel, com o eixo de acesso pedido. */
async function criarBasemap(page, { id, nome, acesso }) {
    await page.locator('[data-testid="admin-cat-basemap"]').click();
    await page.locator('[data-testid="admin-catalog-new"]').click();
    await expect(page.locator('[data-testid="admin-catalog-form"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="admin-catalog-id"]').fill(id);
    await page.locator('[data-testid="admin-catalog-name"]').fill(nome);
    await page.locator('[data-testid="admin-catalog-priority"]').fill('99');
    await page.locator('[data-testid="admin-catalog-config"]').fill(JSON.stringify({
        enabled: true,
        priority: 99,
        style: {
            version: 8,
            sources: {},
            layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#c2185b' } }],
        },
    }));
    await page.locator('[data-testid="admin-catalog-access"]').selectOption(acesso);
    await page.locator('[data-testid="admin-catalog-save"]').click();
    await expect(page.locator('[data-testid="admin-catalog-row"]', { hasText: id }))
        .toBeVisible({ timeout: 10000 });
}

describeOrSkip('Camada base privada (browser real + backend real)', () => {
    test.afterAll(async () => { await closeDb(); });

    test('o eixo de acesso do basemap aparece na Administração como o dos outros tipos', async ({ page }) => {
        const admin = await seedAdmin(page, state.baseUrl, state.dbName);
        await loginAndOpenCatalog(page, state.baseUrl, admin);

        const id = `bm_${Math.random().toString(36).slice(2, 8)}`;
        await criarBasemap(page, { id, nome: 'Base Restrita', acesso: 'private' });

        const linha = page.locator('[data-testid="admin-catalog-row"]', { hasText: id });
        await expect(linha.locator('[data-testid="admin-catalog-access-chip"]')).toHaveText('Privado');

        // Discriminação: a coluna existe e distingue. Um chip fixo passaria o caso acima.
        const publico = `bm_${Math.random().toString(36).slice(2, 8)}`;
        await criarBasemap(page, { id: publico, nome: 'Base Aberta', acesso: 'public' });
        await expect(page.locator('[data-testid="admin-catalog-row"]', { hasText: publico })
            .locator('[data-testid="admin-catalog-access-chip"]')).toHaveText('Público');
    });

    test('a camada base privada chega ao seletor, desenha, e oferece "Compartilhar"', async ({ page }) => {
        const admin = await seedAdmin(page, state.baseUrl, state.dbName);
        await loginAndOpenCatalog(page, state.baseUrl, admin);

        const id = `bm_${Math.random().toString(36).slice(2, 8)}`;
        await criarBasemap(page, { id, nome: 'Base Restrita', acesso: 'private' });

        // De volta ao mapa: a sessão é restaurada no boot e o payload aditivo soma o privado.
        // Ele NÃO está em `/api/config`, que é o documento público — se estivesse, o eixo de
        // acesso não estaria valendo.
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
        const noConfigPublico = await page.evaluate(async (bmId) => {
            const { apiClient } = await import('/src/js/store/sync/api-client.js');
            const cfg = await apiClient.getConfig();
            return Object.keys(cfg.basemaps ?? {}).includes(bmId);
        }, id);
        expect(noConfigPublico).toBe(false);

        await expect(page.locator('#base-layer-selector')).toBeVisible({ timeout: 20000 });
        await page.locator('#base-layer-selector .base-layer-collapsed').click();

        const opcao = page.locator(`.base-layer-option[data-layer-id="${id}"]`);
        await expect(opcao).toBeVisible({ timeout: 10000 });
        await expect(opcao.locator('[data-testid="base-layer-private"]')).toBeVisible();
        await expect(opcao.locator('[data-testid="base-layer-share"]')).toBeVisible();
        // Discriminação: a camada pública ao lado NÃO recebe selo nem botão. A contagem da
        // opção vem antes de propósito — sem ela, "zero selos" passaria também num seletor
        // onde aquela camada nem existisse, que é o verde vazio de sempre.
        await expect(page.locator('.base-layer-option[data-layer-id="osm"]')).toHaveCount(1);
        await expect(page.locator('.base-layer-option[data-layer-id="osm"] [data-testid="base-layer-private"]'))
            .toHaveCount(0);
        await expect(page.locator('.base-layer-option[data-layer-id="osm"] [data-testid="base-layer-share"]'))
            .toHaveCount(0);

        // O clique TROCA o mapa: o estilo PUBLICADO é resolvido e entregue ao MapLibre.
        // A asserção é sobre o estilo VIVO do mapa (`map.getStyle()`), e não sobre o id
        // persistido: era exatamente aí que o defeito morava — o id era gravado e o estilo
        // aplicado era o de outra camada, sem erro nenhum.
        await opcao.click();
        await expect.poll(async () => page.evaluate(() => {
            const camadas = globalThis.__ebgeoMap?.getStyle?.()?.layers ?? [];
            return camadas.map((l) => l.paint?.['background-color']).find(Boolean) ?? null;
        }), { timeout: 20000 }).toBe(COR_ESTILO);

        // E o botão abre o modal de concessão do recurso, que é a única tela por onde um
        // basemap privado pode ser repassado a alguém.
        await page.locator('#base-layer-selector .base-layer-collapsed').click();
        await opcao.locator('[data-testid="base-layer-share"]').click();
        await expect(page.locator('#resource-share-modal')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#resource-share-modal')).toContainText('Base Restrita');
    });
});

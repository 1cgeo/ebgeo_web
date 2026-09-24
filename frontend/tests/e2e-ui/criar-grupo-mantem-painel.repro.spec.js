// Path: e2e-ui/criar-grupo-mantem-painel.repro.spec.js

/**
 * REPRO: "Criar Grupo" pelo menu de contexto FECHAVA o painel lateral e deixava as feições
 * selecionadas atrás dele (relato do dono, 2026-09-24).
 *
 * CAUSA. O menu tinha uma cópia própria de "selecionar o grupo": limpava a seleção (o que fecha o
 * painel), disparava a seleção de cada membro SEM esperar (`toggleFeatureSelection` é assíncrono)
 * e atualizava o painel em seguida. O painel via uma seleção vazia e ficava fechado; os membros
 * eram selecionados um instante depois, já sem painel. `SelectionManager.selectGroup`, que a aba de
 * camadas usa, espera cada membro antes de atualizar o painel, e é ele que o menu passou a chamar.
 *
 * Medido antes do conserto com estes mesmos passos: painel fechado, duas feições selecionadas.
 * A seleção múltipla sai pela tabela de atributos (o "selecionar todas" do cabeçalho), porque a
 * seleção por clique no canvas é instável sem cabeça; o gesto sob teste, o menu, é o real.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawPointUI, openLayersTab } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Criar Grupo pelo menu de contexto', () => {
    test('mantém o painel aberto, com o grupo novo selecionado', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded(), null, { timeout: 30000 });
        await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
        // Camera setup, not the subject: a regional view where the two points land apart.
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 10 }));

        await drawPointUI(page, [-43.3, -22.9]);
        await page.keyboard.press('Escape');
        await drawPointUI(page, [-43.1, -22.9]);
        await page.keyboard.press('Escape');

        await openLayersTab(page);
        await page.locator('.layer-container').first().locator('button[title*="abela"], [data-action="table"], .layer-table-btn').first().click();
        const tabela = page.locator('.attribute-table-panel').first();
        await expect(tabela).toBeVisible();
        await tabela.locator('thead input[type="checkbox"]').first().check();
        const painel = page.locator('.feature-panel[data-expanded="true"]');
        await expect(painel.locator('.feature-identification')).toContainText('2 feições selecionadas');

        // The gesture under test: right-click on empty map, "Criar Grupo".
        await page.mouse.click(1100, 300, { button: 'right' });
        await page.locator('.context-menu-item', { hasText: 'Criar Grupo' }).click();

        // The group is read where the person sees it, the layers tree left open above.
        await expect(page.locator('.group-header'), 'o grupo foi criado').toHaveCount(1);
        await expect(painel, 'o painel continua aberto depois de criar o grupo').toBeVisible();
        await expect(painel.locator('.feature-identification')).toContainText('2 feições selecionadas');
    });
});

// Path: e2e-ui/painel-de-feicao-sobrevive-ao-f5.repro.spec.js

/**
 * @fileoverview UMA EDIÇÃO NO PAINEL DE FEIÇÃO NÃO SOME EM SILÊNCIO NUM F5.
 *
 * O painel edita as feições selecionadas em MEMÓRIA (o mapa já mostra a mudança) e grava no
 * "Salvar" ou ao DESSELECIONAR (`deselectAllFeatures` salva por padrão). Um F5 ou uma aba fechada
 * não é nenhum dos dois: medido em 2026-09-24, o tamanho de um ponto mudado para 37 no painel
 * voltava do F5 como 10, nos dois navegadores, com F5 imediato e também 1,5 s depois, sem aviso.
 * O conserto é o do editor de briefing: na saída, dispara a gravação e, havendo mudança pendente,
 * pede a confirmação do navegador (`instalarGuardaDeSaida`, `tool_manager/helpers/buttons.helpers.js`).
 *
 * A PROVA É PELO LADO DO PRODUTO nos dois navegadores (um `beforeunload` despachado é cancelado só
 * com mudança pendente) e, no Chromium, com F5 real, diálogo aceito e o valor no disco. O Playwright
 * não emite o diálogo de `beforeunload` numa navegação do Firefox.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

/** Desenha um ponto pela ferramenta real e devolve o painel que abre com ele. */
async function pontoComPainel(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
    await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
    await page.locator('[data-tool-id="point"]').click();
    await esperarFerramentaPronta(page, 'point');
    await page.waitForTimeout(300);
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await expect(painel).toBeVisible({ timeout: 15000 });
    return painel;
}

/** O campo "Tamanho" do painel do ponto. */
function campoTamanho(painel) {
    return painel.locator('.attr-modern-slider', { hasText: 'Tamanho' }).locator('.attr-modern-slider-input').first();
}

/** Despacha um `beforeunload` na página e diz se algum ouvinte o cancelou. */
function saidaCancelada(page) {
    return page.evaluate(() => {
        const evento = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(evento);
        return evento.defaultPrevented;
    });
}

test('com mudança pendente no painel a saída pede confirmação, e sem ela não', async ({ page }) => {
    const painel = await pontoComPainel(page);
    expect(await saidaCancelada(page), 'CONTROLE: painel aberto sem mudança não pede nada').toBe(false);
    // E O QUE O `beforeunload` DESPACHOU NÃO DESMONTOU A TELA: ele pode ser cancelado ("Ficar na
    // página"), e a desmontagem que morava nele (`setupCleanupHandlers`, `map_sig.js`) destruía a
    // barra lateral com o painel dentro.
    await expect(painel, 'o painel continua na tela depois de um beforeunload').toBeVisible();
    await expect(page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn')).toBeVisible();

    const campo = campoTamanho(painel);
    await campo.fill('37');
    await campo.press('Tab');
    await expect.poll(() => saidaCancelada(page), { timeout: 5000 }).toBe(true);
});

test('Chromium: F5 com o painel alterado, diálogo aceito, e o valor está gravado', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'o Playwright não emite o diálogo de beforeunload no Firefox');
    const dialogos = [];
    page.on('dialog', async (dialogo) => {
        dialogos.push(dialogo.type());
        await new Promise((resolve) => setTimeout(resolve, 500));
        await dialogo.accept();
    });
    const painel = await pontoComPainel(page);
    const campo = campoTamanho(painel);
    await campo.fill('37');
    await campo.press('Tab');
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
    const tamanhos = await page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return (f?.points ?? []).map((p) => p.properties?.size);
    });
    process.stdout.write(`[painel-f5] ${JSON.stringify({ dialogos, tamanhos })}\n`);
    expect(tamanhos, 'a mudança do painel foi perdida no F5').toContain(37);
    expect(dialogos, 'a saída com mudança pendente pediu confirmação').toEqual(['beforeunload']);
});

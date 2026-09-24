// Path: e2e-ui/briefing-texto-sobrevive-ao-f5.repro.spec.js

/**
 * @fileoverview O TEXTO DE BRIEFING DIGITADO LOGO ANTES DE UM F5 (OU DE FECHAR A ABA) NÃO SE PERDE
 * EM SILÊNCIO.
 *
 * O editor de briefing segura a edição em memória durante a janela do autosave
 * (`_scheduleAutosave`) e, na saída da página, dispara a gravação no `beforeunload`/`pagehide` sem
 * poder aguardá-la. Medido em 2026-09-23 com F5 200 ms depois de digitar: no Chromium a gravação
 * disparada ali chega ao disco (4 de 4); no FIREFOX, não (2 de 2 perdidas). O conserto pede a
 * confirmação de saída do navegador enquanto há edição pendente, o mesmo padrão de
 * `DebouncedPersist` (`warnBeforeUnload`): o diálogo é o tempo em que a gravação termina.
 *
 * A PROVA É PELO LADO DO PRODUTO nos dois navegadores: um `beforeunload` despachado na página é
 * CANCELADO enquanto há edição pendente, e só então. O diálogo em si só é visto no Chromium: o
 * Playwright não emite o evento `dialog` do `beforeunload` numa navegação do Firefox (e o Firefox
 * real só o mostra com ativação do usuário na página, que digitar dá). No Chromium o caso vai até o
 * F5 real, aceita o diálogo e confere o texto gravado.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

const EDITOR = '.briefing-editor-quill-container .ql-editor';

/** Abre o mapa, cria um briefing e espera o primeiro autosave dele assentar. */
async function briefingAberto(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
    await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
    await page.locator('.briefings-create-btn').click();
    await expect(page.locator('.briefing-editor-slide-list')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);
}

/** Despacha um `beforeunload` na página e diz se algum ouvinte o cancelou. */
function saidaCancelada(page) {
    return page.evaluate(() => {
        const evento = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(evento);
        return evento.defaultPrevented;
    });
}

test('com edição pendente a saída pede confirmação; gravada, não pede mais', async ({ page }) => {
    await briefingAberto(page);
    expect(await saidaCancelada(page), 'CONTROLE: sem edição, a saída não pede nada').toBe(false);

    await page.locator(EDITOR).click();
    await page.keyboard.type('TEXTO-PENDENTE');
    await expect(page.locator(EDITOR)).toContainText('TEXTO-PENDENTE');
    expect(await saidaCancelada(page), 'com edição pendente, a saída pede confirmação').toBe(true);

    // O despacho acima já disparou a gravação; assentada, a saída volta a não pedir nada.
    await page.waitForTimeout(2500);
    expect(await saidaCancelada(page), 'gravada, a saída não pede mais nada').toBe(false);
});

test('Chromium: F5 imediato, diálogo aceito, e o texto está gravado', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'o Playwright não emite o diálogo de beforeunload no Firefox');
    const dialogos = [];
    page.on('dialog', async (dialogo) => {
        dialogos.push(dialogo.type());
        await new Promise((resolve) => setTimeout(resolve, 500));
        await dialogo.accept();
    });
    await briefingAberto(page);
    await page.locator(EDITOR).click();
    await page.keyboard.type('TEXTO-ANTES-DO-F5');
    await expect(page.locator(EDITOR)).toContainText('TEXTO-ANTES-DO-F5');
    await page.waitForTimeout(200);
    await page.reload();
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
    const gravados = await page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return JSON.stringify(await store.getAllBriefings());
    });
    expect(gravados, 'o texto digitado antes do F5 foi perdido').toContain('TEXTO-ANTES-DO-F5');
    expect(dialogos, 'a saída com edição pendente pediu confirmação').toEqual(['beforeunload']);
});

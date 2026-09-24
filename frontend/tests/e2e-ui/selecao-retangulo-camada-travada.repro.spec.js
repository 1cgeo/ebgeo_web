// Path: e2e-ui/selecao-retangulo-camada-travada.repro.spec.js

/**
 * @fileoverview "Selecionar" (retângulo) respeita a trava da CAMADA como o clique simples respeita.
 *
 * HIPÓTESE da campanha de cobertura (2026-09-24), lida no código: a caixa de seleção
 * (`selection_tools/rectangle_selection_control.js`, `executeRectangleSelection`) só pulava
 * feição com `properties.bloqueado === true`, enquanto o clique simples pergunta por
 * `isFeatureEffectivelyLocked` (camada travada, feição bloqueada, grupo travado). Com a camada
 * travada, a caixa selecionaria as feições dela, e Delete as apagaria em lote.
 *
 * O roteiro é pela interface: dois pontos desenhados pela barra numa camada, a camada travada, os
 * dois cantos da caixa clicados no mapa, a tecla Delete. A trava da camada é posta pela op de
 * store (`setLayerLocked`), que é o mesmo caminho do botão do painel de camadas.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawPointUI, readFeatures, clicarNoMapaUI } from './helpers/collab-helpers.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const PONTOS = [[-43.21, -22.905], [-43.19, -22.895]];
const CANTOS = [[-43.23, -22.92], [-43.17, -22.88]];

/** Abre a ferramenta Selecionar e clica os dois cantos. */
async function selecionarPorRetangulo(page) {
    // O desenho dos pontos move a câmera; os cantos são pedidos com ela de volta no enquadramento.
    await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 12 }));
    await page.waitForFunction(() => !globalThis.__ebgeoMap.isMoving());
    await page.locator('.toolbar-group[data-group-id="utility"] .toolbar-group-btn').click();
    await page.locator('.toolbar-group[data-group-id="utility"] .toolbar-tool-btn[data-tool-id="rectangleSelection"]').click();
    await esperarFerramentaPronta(page, 'rectangleSelection');
    await clicarNoMapaUI(page, CANTOS[0]);
    await clicarNoMapaUI(page, CANTOS[1]);
}

/** Quantas feições estão selecionadas agora. */
const selecionadas = (page) => page.evaluate(async () => {
    const s = await import('/src/js/store/index.js');
    const sel = s.getStateManager().getSelectedFeatures?.() ?? s.getStateManager().selectedFeatures;
    if (sel instanceof Map) return [...sel.values()].reduce((n, v) => n + (v?.size ?? v?.length ?? 1), 0);
    return Array.isArray(sel) ? sel.length : Object.values(sel ?? {}).reduce((n, v) => n + (v?.size ?? v?.length ?? 0), 0);
});

describeOrSkip('Selecionar por retângulo e a trava da camada', () => {
    test.describe.configure({ retries: 0 });

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 12 }));
    });

    test('CONTROLE: com a camada destravada a caixa seleciona os dois pontos', async ({ page }) => {
        for (const p of PONTOS) { await drawPointUI(page, p); await page.keyboard.press('Escape'); }
        await page.keyboard.press('Escape');
        await selecionarPorRetangulo(page);
        await expect.poll(() => selecionadas(page), { timeout: 10000 }).toBe(2);
    });

    test('com a camada travada a caixa não seleciona nada, e Delete não apaga', async ({ page }) => {
        for (const p of PONTOS) { await drawPointUI(page, p); await page.keyboard.press('Escape'); }
        await page.keyboard.press('Escape');
        const layerId = (await readFeatures(page, 'points'))[0].props.layerId;
        await page.evaluate(async (id) => {
            const { getLayerManager } = await import('/src/js/store/services.js');
            await getLayerManager().setLayerLocked(id, true);
        }, layerId);

        await selecionarPorRetangulo(page);
        await page.waitForTimeout(500);
        const n = await selecionadas(page);
        await page.keyboard.press('Delete');
        const confirmar = page.locator('.confirm-modal-btn-confirm');
        if (await confirmar.isVisible({ timeout: 2000 }).catch(() => false)) await confirmar.click();
        await page.waitForTimeout(1000);
        const restantes = (await readFeatures(page, 'points')).length;
        expect({ selecionadas: n, restantes }).toEqual({ selecionadas: 0, restantes: 2 });
    });
});

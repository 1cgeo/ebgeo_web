// Path: e2e-ui/pdf-legenda-declinacao.repro.spec.js

/**
 * @fileoverview A declinação magnética entra na legenda do PDF, como toda outra ferramenta desenhada.
 *
 * Era um BURACO DECLARADO no censo do registro de tipos (`tests/unit/registro-tipos-cobertura.test.js`):
 * `_collectFeatureStats` (`import_export/pdf-export.tab.js`) lista as fontes que a legenda conta e
 * não lista `magnetic_declinations`, e a tabela de nomes da legenda
 * (`import_export/pdf-cartographic-elements.js`) não tinha o tipo. A folha desenhava a declinação
 * e a legenda não a citava, sem erro.
 *
 * A PROVA É O TEXTO DESENHADO. O PDF de folha única é um PNG convertido pelo GDAL, então o texto
 * da legenda não se extrai do arquivo; o que se lê é o `fillText` do canvas de composição,
 * registrado por um embrulho instalado ANTES do boot. Um controle confere que o mesmo registro
 * vê o rótulo de outro tipo desenhado no mesmo mapa (um ponto), senão a ausência mediria o
 * instrumento.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Clica no centro do canvas do mapa. */
async function clicarNoCentro(page, dx = 0) {
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2);
}

/** Ativa uma ferramenta pela barra e espera a carga tardia dela. */
async function ativar(page, grupo, toolId) {
    await page.locator(`.toolbar-group[data-group-id="${grupo}"] .toolbar-group-btn`).click();
    await page.locator(`.toolbar-group[data-group-id="${grupo}"] .toolbar-tool-btn[data-tool-id="${toolId}"]`).click();
    await esperarFerramentaPronta(page, toolId);
}

describeOrSkip('legenda do PDF', () => {
    test.describe.configure({ retries: 0 });

    test('a declinação magnética desenhada aparece na legenda, ao lado do ponto', async ({ page }) => {
        test.setTimeout(180000);
        await page.addInitScript(() => {
            window.__textosDoCanvas = [];
            const original = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function (texto, ...resto) {
                window.__textosDoCanvas.push(String(texto));
                return original.call(this, texto, ...resto);
            };
        });
        await page.goto('/');
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 13 }));

        await ativar(page, 'military', 'declination');
        await clicarNoCentro(page);
        await expect.poll(() => page.evaluate(() => globalThis.__ebgeoMap.getSource('magnetic_declinations')
            ?.getData?.().then((d) => d.features.length)), { timeout: 15000 }).toBe(1);
        await page.keyboard.press('Escape');

        await ativar(page, 'draw', 'point');
        await clicarNoCentro(page, 60);
        await expect.poll(() => page.evaluate(() => globalThis.__ebgeoMap.getSource('points')
            ?.getData?.().then((d) => d.features.length)), { timeout: 15000 }).toBe(1);
        await page.keyboard.press('Escape');

        await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
        await page.locator('#export-option-pdf').click();
        await expect(page.locator('.export-pdf-content')).toHaveAttribute('data-visible', 'true', { timeout: 10000 });
        await page.locator('#pdf-dpi-select').selectOption('150');
        await page.locator('#pdf-show-legend').check();
        await page.evaluate(() => { window.__textosDoCanvas = []; });

        const baixado = page.waitForEvent('download', { timeout: 120000 });
        await page.locator('#pdf-export-btn').click();
        await baixado;

        const textos = await page.evaluate(() => window.__textosDoCanvas);
        // CONTROLE: o registro vê a legenda (o ponto desenhado no mesmo mapa está lá).
        expect(textos.some((t) => t.startsWith('Pontos')), JSON.stringify(textos)).toBe(true);
        expect(textos.some((t) => t.startsWith('Declinações Magnéticas')), JSON.stringify(textos)).toBe(true);
    });
});

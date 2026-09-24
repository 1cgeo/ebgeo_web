// Path: e2e-ui/medicao-salva-e-rotulo-da-visada.repro.spec.js

/**
 * @fileoverview Uma área salva pela régua ("Salvar como feição") não apaga, no F5, o rótulo de
 * distância das visadas com "Mostrar Medição" ligado.
 *
 * HIPÓTESE da campanha de cobertura (2026-09-24), lida no código: `restoreMeasurements`
 * (`layers/layer_setup.js`) varre linhas, polígonos e visadas com `measure: true` e chama
 * `updateFeatureMeasurement` do controle de cada uma, num laço só dentro de um `try`. O
 * `AddPolygonControl` não tem esse método, e a área que a régua salva é um polígono com
 * `measure: true` (`measurement-area.control.js`, `_saveAsFeature`). No boot o primeiro polígono
 * assim lança `TypeError`, o `catch` engole, e as visadas que vêm depois no laço ficam sem rótulo.
 *
 * Terreno sintético pelo helper da casa (`helpers/analise-terreno.js`); tudo o mais pela interface.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { prepararTerreno, tracarVisada, desocupar } from './helpers/analise-terreno.js';
import { selectFeatureUI, readFeatures, clicarNoMapaUI } from './helpers/collab-helpers.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const rotuloDa = (page, id) => page.locator(`.measurement-label[data-feature-id="${id}"]`);

describeOrSkip('rótulo de medição da visada depois do F5', () => {
    test.describe.configure({ retries: 0 });

    /** Traça uma visada e liga "Mostrar Medição" pelo painel; devolve o id. */
    async function visadaComMedicao(page) {
        await page.goto('/');
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await prepararTerreno(page);
        const losId = await tracarVisada(page);
        await desocupar(page);
        await selectFeatureUI(page, losId);
        const painel = page.locator('.feature-panel[data-expanded="true"]');
        await painel.locator('.attr-modern-toggle', { hasText: 'Mostrar Medição' }).locator('.attr-modern-toggle-switch').click();
        await painel.locator('.attr-modern-btn-save').first().click();
        await expect.poll(async () => (await readFeatures(page, 'los')).find((f) => f.id === losId)?.props?.measure, { timeout: 10000 }).toBe(true);
        await expect(rotuloDa(page, losId)).toHaveCount(1, { timeout: 10000 });
        await desocupar(page);
        return losId;
    }

    test('CONTROLE: sem a área salva, a visada volta com o rótulo no F5', async ({ page }) => {
        test.setTimeout(240000);
        const losId = await visadaComMedicao(page);
        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await expect.poll(async () => (await readFeatures(page, 'los')).length, { timeout: 30000 }).toBe(1);
        await expect(rotuloDa(page, losId)).toHaveCount(1, { timeout: 20000 });
    });

    test('a área salva pela régua não apaga o rótulo da visada no F5', async ({ page }) => {
        test.setTimeout(240000);
        // 1) Uma visada com "Mostrar Medição".
        const losId = await visadaComMedicao(page);

        // 2) Uma área medida pela régua e salva como feição.
        await page.locator('.toolbar-group[data-group-id="utility"] .toolbar-group-btn').click();
        await page.locator('.toolbar-group[data-group-id="utility"] .toolbar-tool-btn[data-tool-id="measureArea"]').click();
        await esperarFerramentaPronta(page, 'measureArea');
        // Um triângulo pequeno, dentro do enquadramento que o traçado da visada deixou.
        await clicarNoMapaUI(page, [-43.26, -22.915]);
        await clicarNoMapaUI(page, [-43.24, -22.915]);
        await clicarNoMapaUI(page, [-43.25, -22.925], { button: 'right' });
        await page.locator('.measurement-results-panel__save-btn').click();
        await expect.poll(async () => (await readFeatures(page, 'polygons')).filter((f) => f.props.measure === true).length, { timeout: 15000 }).toBe(1);

        // 3) F5: a visada volta com o rótulo.
        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await expect.poll(async () => (await readFeatures(page, 'los')).length, { timeout: 30000 }).toBe(1);
        await expect(rotuloDa(page, losId), 'a visada com "Mostrar Medição" perdeu o rótulo no F5').toHaveCount(1, { timeout: 20000 });
    });
});

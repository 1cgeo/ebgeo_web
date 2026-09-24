// Path: e2e-ui/medicao-salva-mostra-rotulo.repro.spec.js

/**
 * @fileoverview A linha salva pela régua ("Salvar como feição") mostra o rótulo de comprimento
 * logo depois de salva, e não só depois de um F5.
 *
 * HIPÓTESE da campanha de cobertura (2026-09-24), lida no código: `_saveAsFeature`
 * (`measurement_tool/measurement-distance.control.js`) grava a linha com `measure: true` e a põe
 * na fonte do mapa, mas não chama `updateFeatureMeasurement` como a ferramenta de linha faz ao
 * criar (`add_line_control.js`). O rótulo só nasce no boot seguinte, por `restoreMeasurements`:
 * a pessoa salva a medida e vê a linha sem o número que acabou de medir, com "Mostrar Medição"
 * ligado no painel.
 *
 * O CONTROLE é o mesmo rótulo depois do F5: se ele não aparecesse nem ali, a ausência mediria o
 * seletor, não o defeito.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { readFeatures, clicarNoMapaUI } from './helpers/collab-helpers.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('rótulo da medida salva', () => {
    test.describe.configure({ retries: 0 });

    test('a linha salva pela régua nasce com o rótulo de comprimento', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 13 }));
        await page.waitForFunction(() => !globalThis.__ebgeoMap.isMoving());

        await page.locator('.toolbar-group[data-group-id="utility"] .toolbar-group-btn').click();
        await page.locator('.toolbar-group[data-group-id="utility"] .toolbar-tool-btn[data-tool-id="measureDistance"]').click();
        await esperarFerramentaPronta(page, 'measureDistance');
        await clicarNoMapaUI(page, [-43.21, -22.9]);
        await clicarNoMapaUI(page, [-43.19, -22.9], { button: 'right' });
        await page.locator('.measurement-results-panel__save-btn').click();

        let id = null;
        await expect.poll(async () => {
            id = (await readFeatures(page, 'lines')).find((f) => f.props.measure === true)?.id ?? null;
            return id;
        }, { timeout: 15000 }).toBeTruthy();
        const rotulo = page.locator(`.measurement-label[data-feature-id="${id}"]`);
        const logoDepois = await expect(rotulo).toHaveCount(1, { timeout: 5000 }).then(() => 1, () => 0);

        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        // CONTROLE: o rótulo existe para esta linha, ao menos depois do boot.
        await expect(rotulo).toHaveCount(1, { timeout: 20000 });
        expect(logoDepois, 'a linha salva só ganhou o rótulo depois do F5').toBe(1);
    });
});

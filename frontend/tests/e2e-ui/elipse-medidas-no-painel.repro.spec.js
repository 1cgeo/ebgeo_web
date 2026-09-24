// Path: e2e-ui/elipse-medidas-no-painel.repro.spec.js

/**
 * @fileoverview REPRO no navegador: as medidas de uma elipse desenhada com a ferramenta real saem na
 * unidade certa no painel da feição e no botão "Preencher com área" da etiqueta.
 *
 * A elipse guarda os raios em QUILÔMETROS e os dois consumidores os liam como METROS: uma elipse de
 * 3,39 km de semi-eixo aparecia como "Semi-eixo maior: 3,39 m", e a área de ~21,7 km² como
 * "21,68 m²" (medido em 2026-09-24 pelo spec de cobertura das abas, no instantâneo da página). A
 * medida esperada aqui sai do raio GUARDADO pela ferramenta (em km), e não de um número escrito à mão.
 * A regra pura e o censo dos dois consumidores estão em `tests/unit/elipse-medidas-em-metros.repro.test.js`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { selectFeatureUI, savePanelUI } from './helpers/collab-helpers.js';
import { FERRAMENTAS, desenhar, feicaoNoStore } from './helpers/cobertura-desenho.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

test('a elipse mostra semi-eixo e area em km, e a etiqueta se preenche com km2', async ({ page }) => {
    test.setTimeout(120000);
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });

    const ferramenta = FERRAMENTAS.find((f) => f.id === 'ellipse');
    const id = await desenhar(page, ferramenta);
    const { properties } = await feicaoNoStore(page, ferramenta.balde, id);
    // O semi-eixo guardado, em km, contra a distância do gesto medida pelo Turf da página.
    const esperadoKm = properties.majorRadius;
    expect(esperadoKm, 'o gesto desenhou uma elipse de quilômetros').toBeGreaterThan(1);

    await selectFeatureUI(page, id);
    const medidas = page.locator('.feature-panel[data-expanded="true"] .feature-identification-measurements');
    await expect(medidas).toBeVisible({ timeout: 10000 });
    const texto = (await medidas.innerText()).replace(/\s+/g, ' ');
    console.log(`[elipse] majorRadius=${esperadoKm} km; painel: ${texto}`);
    const semiEixo = esperadoKm.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    expect(texto, 'o semi-eixo maior sai em km').toContain(`${semiEixo} km`);
    expect(texto, 'a area sai em km²').toMatch(/Área\s*:?\s*[\d.,]+ km²/);

    // "Preencher com área" na aba Etiqueta: o texto da etiqueta é a área em km².
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="label"]').click();
    const etiqueta = painel.locator('.feature-tab-content[data-tab-id="label"]');
    const mostrar = etiqueta.locator('.attr-modern-toggle', { hasText: 'Mostrar Etiqueta' }).locator('.attr-modern-toggle-switch');
    await mostrar.click();
    await etiqueta.locator('button', { hasText: 'Preencher com área' }).click();
    const areaKm2 = Math.PI * properties.majorRadius * properties.minorRadius;
    const esperado = `${areaKm2.toFixed(3)} km²`;
    await expect(etiqueta.locator('.attr-modern-textarea-input').first(), 'o botao escreveu a area em km²').toHaveValue(esperado);
    // E o "Salvar" grava o texto como veio.
    await savePanelUI(page);
    await expect.poll(async () => (await feicaoNoStore(page, ferramenta.balde, id))?.properties?.labelText ?? '', { timeout: 10000 })
        .toBe(esperado);
});

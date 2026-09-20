// Path: e2e-ui/trajetoria-some-ao-desselecionar.spec.js

/**
 * A TRAJETÓRIA SAI DA TELA QUANDO A FEIÇÃO É DESSELECIONADA, no navegador real.
 *
 * O RELATO DO DONO (2026-09-20), passo a passo: (1) selecionar uma feição com trajetória, (2)
 * clicar numa aba do painel lateral, (3) clicar no mapa para tirar a seleção. O caminho e os
 * vértices da trajetória ficavam desenhados sobre um mapa sem nada selecionado.
 *
 * A causa e os casos de borda estão presos em
 * `tests/unit/trajetoria-fica-na-tela-apos-desselecionar.repro.test.js`, com o `StateManager`
 * real. Este arquivo existe para a metade que aquele não alcança: a sequência do relato feita com
 * os GESTOS de verdade, contra o MapLibre de verdade. O sinal medido é a camada da trajetória
 * existir ou não no mapa (`map.getLayer`), que é o que "está na tela" significa, e não o campo
 * interno do controle.
 *
 * Roda em atlas LOCAL, anônimo: o defeito não tem nada de sync.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawPointUI, selectFeatureUI, clicarNoMapaUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const CAMADA_DA_TRAJETORIA = 'trajectory-edit-path-layer';

const trajetoriaNaTela = (page) => page.evaluate(
    (camada) => !!globalThis.__ebgeoMap.getLayer(camada), CAMADA_DA_TRAJETORIA,
);

const selecionadas = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return store.getStateManager().getSelectedFeatures().length;
});

describeOrSkip('trajetória e seleção', () => {
    test.describe.configure({ retries: 0 });

    test('selecionar, abrir a aba Mapas e clicar no mapa tira a trajetória da tela', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 20000 });
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-47.9, -15.8], zoom: 10 }));

        const id = await drawPointUI(page, [-47.9, -15.8]);
        expect(id, 'o ponto foi criado').toBeTruthy();
        await page.evaluate(async (featureId) => {
            const store = await import('/src/js/store/index.js');
            await store.updateFeatureProperty('points', featureId, 'trajetoria', [
                { t: 1700000000000, lng: -47.9, lat: -15.8 },
                { t: 1700003600000, lng: -47.7, lat: -15.6 },
            ]);
        }, id);

        // PASSO 1: selecionar. O painel abre e a trajetória aparece.
        await selectFeatureUI(page, id);
        await expect.poll(() => trajetoriaNaTela(page), { timeout: 15000 }).toBe(true);

        // PASSO 2: abrir a aba Mapas. A feição CONTINUA selecionada, então a trajetória fica.
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await expect(page.locator('.maps-tab')).toBeVisible({ timeout: 10000 });
        expect(await selecionadas(page)).toBe(1);
        expect(await trajetoriaNaTela(page)).toBe(true);

        // PASSO 3: clicar num ponto vazio do mapa, longe da feição, para tirar a seleção.
        // A coordenada sai de um PIXEL visível, à direita da barra lateral aberta e longe da feição:
        // o desenho do ponto muda o zoom, então uma coordenada escrita à mão cai fora da tela (medido:
        // x=14621 num viewport de 1280), e um clique fora da tela não é clique nenhum.
        const alvo = await page.evaluate(() => {
            const p = globalThis.__ebgeoMap.unproject([1000, 150]);
            return [p.lng, p.lat];
        });
        const clique = await clicarNoMapaUI(page, alvo);
        expect(clique.coberto, `o clique caiu sob ${clique.porQuem}`).toBe(false);
        await expect.poll(() => selecionadas(page), { timeout: 10000 }).toBe(0);

        await expect.poll(() => trajetoriaNaTela(page), { timeout: 10000 }).toBe(false);
    });
});

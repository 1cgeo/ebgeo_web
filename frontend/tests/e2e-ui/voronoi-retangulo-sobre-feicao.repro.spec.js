// Path: e2e-ui/voronoi-retangulo-sobre-feicao.repro.spec.js

/**
 * @fileoverview DESENHAR A AREA DE RECORTE DO VORONOI SOBRE UMA FEICAO NAO TROCA O PAINEL.
 *
 * O DEFEITO, achado pela cobertura dos processamentos: o "Desenhar Retangulo" do painel de Zonas de
 * Proximidade escuta o clique do mapa, mas o gerente de selecao (`_handleMapClick`,
 * `tool_manager/selection_manager.js`) tambem escuta, e so' se cala para as ferramentas que ele
 * conhece. Um canto que cai SOBRE uma feicao registra o canto E seleciona a feicao, e o painel dela
 * toma o lugar do painel de processamento, levando o retangulo junto: o painel aberto some e a area
 * desenhada se perde. Medido pela pilha da remocao: `_showFeatureContent` -> `FeaturePanel.show`.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test voronoi-retangulo-sobre-feicao --retries=0 --workers=1
 */

import { collabTest, expect, drawPointUI, drawPolygonUI } from './helpers/collab.fixtures.js';
import { clicarNoMapaUI } from './helpers/collab-helpers.js';

collabTest('o canto do retangulo sobre um poligono registra o canto e o painel de processamento fica', async ({ collab }) => {
    collabTest.setTimeout(150000);
    const A = collab.author;
    for (const p of [[-43.22, -22.92], [-43.18, -22.92], [-43.20, -22.88]]) await drawPointUI(A, p);
    // Um poligono onde vai cair o primeiro canto.
    await drawPolygonUI(A, [[-43.27, -22.97], [-43.24, -22.97], [-43.24, -22.94], [-43.27, -22.94]]);
    await A.keyboard.press('Escape');

    if (!(await A.locator('.processing-algorithm-list').isVisible().catch(() => false))) {
        await A.locator('.sidebar-nav-btn[data-tab="processamento"]').click();
    }
    await A.locator('.processing-card[data-algorithm-id="voronoi"]').evaluate((el) => el.click());
    const painel = A.locator('.processing-panel[data-algorithm-id="voronoi"]');
    await expect(painel).toBeVisible({ timeout: 8000 });

    await A.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 11 }));
    await painel.locator('.processing-panel__draw-btn').click();
    // Primeiro canto DENTRO do poligono, segundo no vazio.
    const c1 = await clicarNoMapaUI(A, [-43.255, -22.955]);
    const c2 = await clicarNoMapaUI(A, [-43.14, -22.84]);
    expect(c1.coberto || c2.coberto, 'os dois cliques caem no mapa').toBe(false);

    await expect(A.locator('.processing-panel[data-algorithm-id="voronoi"]'), 'o painel de processamento continua aberto').toHaveCount(1, { timeout: 5000 });
    await expect(painel.locator('.processing-panel__bbox-display'), 'a area de recorte foi registrada').not.toHaveText('Área não definida');
    const selecionadas = await A.evaluate(async () => {
        const { getControl } = await import('/src/js/store/control.registry.js');
        return getControl('SelectionManager')?.hasSelectedFeatures?.() ?? null;
    });
    expect(selecionadas, 'nenhuma feicao foi selecionada pelo clique do canto').not.toBe(true);
});

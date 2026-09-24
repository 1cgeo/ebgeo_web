// Path: e2e-ui/cobertura-selecao-retangulo.spec.js

/**
 * @fileoverview COBERTURA de "Selecionar" (retângulo) com uma ação sobre a seleção, num atlas de
 * servidor com o colega. Campanha de cobertura de 2026-09-24 (`relatorios/cobertura-taticas.md`).
 *
 * Antes dela nenhum spec dava os dois cliques de canto; as ações sobre seleção múltipla eram
 * provadas com a seleção feita por `page.evaluate` ou pela árvore. Aqui: três tipos diferentes
 * (ponto, linha, símbolo militar) desenhados pela barra, selecionados pelos dois cantos, apagados
 * por Delete com a confirmação, o que chega ao Postgres e ao colega; e UM Ctrl+Z traz os três de
 * volta nos três lugares (a exclusão em lote é um desfazer só).
 */

import { collabTest, expect, readFeatures, drawPointUI, drawLineUI, drawMilitarySymbolUI } from './helpers/collab.fixtures.js';
import { clicarNoMapaUI } from './helpers/collab-helpers.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

collabTest.describe.configure({ retries: 0 });

const vivaNoServidor = async (collab, id) => {
    const row = await collab.db.queryFeatureRow(id);
    return row ? row.deleted_at === null : 'sem linha';
};

async function ids(page) {
    const out = {};
    for (const b of ['points', 'lines', 'military_symbols']) out[b] = (await readFeatures(page, b)).map((f) => f.id).sort();
    return out;
}

collabTest('retângulo seleciona três tipos, Delete apaga no colega, e um Ctrl+Z traz os três', async ({ collab }) => {
    collabTest.setTimeout(300000);
    const A = collab.author;
    const B = collab.peers[0];

    const ponto = await drawPointUI(A, [-43.21, -22.905]);
    await A.keyboard.press('Escape');
    const linha = await drawLineUI(A, [[-43.205, -22.895], [-43.195, -22.895]]);
    await A.keyboard.press('Escape');
    const simbolo = await drawMilitarySymbolUI(A, [-43.19, -22.905]);
    await A.keyboard.press('Escape');
    await A.keyboard.press('Escape');
    const todos = [ponto, linha, simbolo];
    const esperado = { points: [ponto], lines: [linha], military_symbols: [simbolo] };
    for (const id of todos) await expect.poll(() => vivaNoServidor(collab, id), { timeout: 30000 }).toBe(true);
    await expect.poll(() => ids(B), { timeout: 30000 }).toEqual(esperado);

    await A.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 12 }));
    await A.waitForFunction(() => !globalThis.__ebgeoMap.isMoving());
    await A.locator('.toolbar-group[data-group-id="utility"] .toolbar-group-btn').click();
    await A.locator('.toolbar-group[data-group-id="utility"] .toolbar-tool-btn[data-tool-id="rectangleSelection"]').click();
    await esperarFerramentaPronta(A, 'rectangleSelection');
    await clicarNoMapaUI(A, [-43.23, -22.92]);
    await clicarNoMapaUI(A, [-43.17, -22.88]);
    await expect.poll(() => A.evaluate(async () => (await import('/src/js/store/index.js')).getStateManager().getSelectedFeatures().length), { timeout: 10000 }).toBe(3);

    await A.keyboard.press('Delete');
    await A.locator('.confirm-modal-btn-confirm').click();
    await expect.poll(() => ids(A), { timeout: 15000 }).toEqual({ points: [], lines: [], military_symbols: [] });
    for (const id of todos) await expect.poll(() => vivaNoServidor(collab, id), { timeout: 30000 }).toBe(false);
    await expect.poll(() => ids(B), { timeout: 30000 }).toEqual({ points: [], lines: [], military_symbols: [] });

    await A.locator('#map-sig .maplibregl-canvas').hover();
    await A.keyboard.press('Control+z');
    await expect.poll(() => ids(A), { timeout: 15000, message: 'um Ctrl+Z nao trouxe os tres' }).toEqual(esperado);
    for (const id of todos) await expect.poll(() => vivaNoServidor(collab, id), { timeout: 30000 }).toBe(true);
    await expect.poll(() => ids(B), { timeout: 30000 }).toEqual(esperado);
});

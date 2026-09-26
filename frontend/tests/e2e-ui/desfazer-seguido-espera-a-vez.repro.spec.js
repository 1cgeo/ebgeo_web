// Path: e2e-ui/desfazer-seguido-espera-a-vez.repro.spec.js

/**
 * @fileoverview DOIS CTRL+Z SEGUIDOS DESFAZEM DOIS PASSOS (decisão do dono de 2026-09-26).
 *
 * O DEFEITO. `runUndoRedo` (`map/undo-redo.runner.js`) guardava a reentrância com uma bandeira e
 * descartava em silêncio o pedido que chegasse com outro em curso, redesenho do mapa base incluído.
 * Dois Ctrl+Z seguidos desfaziam um passo só. Medido em 2026-09-26 no Chromium do harness: com o
 * runner antigo, 0 de 3 rodadas (sobrava um ponto em todas); com a fila, 3 de 3.
 *
 * O caminho é o da pessoa: os pontos pela tela, os dois atalhos pelo teclado, sem espera entre eles,
 * num atlas local. A leitura é da store. A regra da fila (a vez, a tecla segurada, o gate na vez) é
 * de `tests/unit/desfazer-seguido-espera-a-vez.repro.test.js`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawPointUI } from './helpers/collab-helpers.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

function pontosNaStore(page) {
    return page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        return ((await s.getCurrentMapFeatures()).points ?? []).length;
    });
}

test('dois Ctrl+Z seguidos desfazem os dois pontos', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });

    await drawPointUI(page, [-43.2, -22.9]);
    await page.keyboard.press('Escape');
    await drawPointUI(page, [-43.1, -22.8]);
    await page.keyboard.press('Escape');
    await expect.poll(() => pontosNaStore(page)).toBe(2);

    // Sem espera entre os dois: o segundo chega com o primeiro ainda em curso.
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect.poll(() => pontosNaStore(page), {
        timeout: 15000, message: 'o segundo Ctrl+Z foi descartado',
    }).toBe(0);
});

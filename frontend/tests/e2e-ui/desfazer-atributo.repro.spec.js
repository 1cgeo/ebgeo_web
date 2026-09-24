// Path: e2e-ui/desfazer-atributo.repro.spec.js

/**
 * @fileoverview DESFAZER "ADICIONAR O PRIMEIRO ATRIBUTO" DESFAZ, pelo botão real da barra.
 *
 * O DEFEITO. O motor de desfazer chama `updateFeature` com `revertFrom` e sem `preserveUserData:
 * false` (`store-state-manager.js`, `_executeUndoAction`), e `preserveUserData`
 * (`frontend/src/js/store/feature.operations.js`) devolvia a bolsa de atributos guardada sempre que o
 * resultado ficava vazio. Desfazer o primeiro atributo de uma feição não fazia nada, sem aviso, e o
 * refazer seguinte também não. Pré-existente; achado na revisão da convergência por chave, porque é
 * justamente o caso em que o desfazer por chave (`keepLaterEdits`) produz uma bolsa vazia.
 *
 * O caminho é o da pessoa: o ponto e o atributo pela tela, o desfazer e o refazer pelos botões da
 * barra (a mesma porta do Ctrl+Z, `map/undo-redo.runner.js`), num atlas local. A leitura é da store.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawPointUI, selectFeatureUI } from './helpers/collab-helpers.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

function atributosNaStore(page, id) {
    return page.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).find((p) => p.properties.id === fid)?.properties?.attributes ?? {};
    }, id);
}

test('desfazer o primeiro atributo o tira, e refazer o devolve', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });

    const id = await drawPointUI(page, [-43.2, -22.9]);
    await page.keyboard.press('Escape');
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="atributos"]').click();
    const aba = painel.locator('.feature-tab-content[data-tab-id="atributos"]');
    await aba.locator('.feature-attributes-add-btn').click();
    const [campoChave, campoValor] = await aba.locator('.feature-attributes-inline-input').all();
    await campoChave.fill('cota');
    await campoValor.fill('10');
    await aba.locator('.feature-attributes-inline-confirm').click();
    await expect.poll(() => atributosNaStore(page, id)).toEqual({ cota: '10' });
    await page.keyboard.press('Escape');

    await page.locator('.toolbar-standalone-btn[data-tool-id="undo"]').click();
    await expect.poll(() => atributosNaStore(page, id), {
        timeout: 15000, message: 'o desfazer não tirou o primeiro atributo',
    }).toEqual({});

    await page.locator('.toolbar-standalone-btn[data-tool-id="redo"]').click();
    await expect.poll(() => atributosNaStore(page, id), { timeout: 15000 }).toEqual({ cota: '10' });
});

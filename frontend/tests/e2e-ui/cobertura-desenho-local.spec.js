// Path: e2e-ui/cobertura-desenho-local.spec.js

/**
 * @fileoverview COBERTURA: o ciclo de vida de cada ferramenta de desenho num atlas LOCAL, sem
 * sessão (campanha de 2026-09-24). O par de servidor é `cobertura-desenho-ciclo.spec.js`.
 *
 * Desenhar, nome, descrição, atributo, mover, copiar e colar, excluir a cópia, desfazer, refazer, e
 * F5: depois do F5 o balde tem exatamente a feição original, com o nome, a descrição, o atributo e a
 * geometria movida, campo a campo como estava antes do F5.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { selectFeatureUI, deleteFeatureUI } from './helpers/collab-helpers.js';
import { FERRAMENTAS, desenhar, feicaoNoStore, idsDoBalde, semEscrituracao } from './helpers/cobertura-desenho.js';
import {
    nomear, descrever, atribuir, moverPeloCorpo, copiarEColar, desfazer, refazer,
} from './helpers/cobertura-desenho-ciclo.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

async function abrirMapaLocal(page) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 30000 });
    await expect.poll(() => page.evaluate(async () =>
        (await import('/src/js/store/index.js')).getCurrentMapNameSync()), { timeout: 30000 }).toEqual(expect.any(String));
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
}

for (const ferramenta of FERRAMENTAS) {
    test(`ciclo local de ${ferramenta.id}: nome, descricao, atributo, mover, colar, excluir, desfazer, refazer e F5`, async ({ page }) => {
        test.setTimeout(300000);
        const { balde } = ferramenta;
        await abrirMapaLocal(page);

        const id = await desenhar(page, ferramenta);
        await selectFeatureUI(page, id);
        await nomear(page, balde, id, `Nome ${ferramenta.id}`);
        await descrever(page, balde, id, `Descricao de ${ferramenta.id}`);
        await atribuir(page, balde, id, 'cota', '42');

        await page.keyboard.press('Escape');
        await selectFeatureUI(page, id);
        await moverPeloCorpo(page, balde, id);

        await selectFeatureUI(page, id);
        const copia = await copiarEColar(page, balde, id);
        // Colar SELECIONA a cópia e abre o painel dela, que esconde a árvore de camadas: Escape antes.
        await page.keyboard.press('Escape');
        await deleteFeatureUI(page, copia);
        await expect.poll(async () => (await idsDoBalde(page, balde)).includes(copia), { timeout: 15000 }).toBe(false);

        await page.keyboard.press('Escape');
        await desfazer(page);
        await expect.poll(async () => (await idsDoBalde(page, balde)).includes(copia), { timeout: 15000, message: 'desfazer: a copia nao voltou' }).toBe(true);
        await refazer(page);
        await expect.poll(async () => (await idsDoBalde(page, balde)).includes(copia), { timeout: 15000, message: 'refazer: a copia nao saiu' }).toBe(false);

        const antes = await feicaoNoStore(page, balde, id);
        expect(antes.properties.nome).toBe(`Nome ${ferramenta.id}`);
        expect(antes.properties.descricao).toContain(`Descricao de ${ferramenta.id}`);
        expect(antes.properties.attributes?.cota).toBe('42');

        await page.reload();
        await expect.poll(async () => idsDoBalde(page, balde), { timeout: 30000, message: 'F5: o balde nao tem so a feicao original' }).toEqual([id]);
        const depois = await feicaoNoStore(page, balde, id);
        expect({ properties: semEscrituracao(depois.properties), geometry: depois.geometry }, 'F5: a feicao voltou igual')
            .toEqual({ properties: semEscrituracao(antes.properties), geometry: antes.geometry });
    });
}

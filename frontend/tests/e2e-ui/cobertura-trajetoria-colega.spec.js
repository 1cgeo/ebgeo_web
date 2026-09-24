// Path: e2e-ui/cobertura-trajetoria-colega.spec.js

/**
 * @fileoverview COBERTURA da trajetória criada pelo EDITOR de verdade num atlas de servidor, com o
 * colega e com F5 nos dois. Campanha de cobertura de 2026-09-24 (`relatorios/cobertura-taticas.md`).
 *
 * Antes dela a trajetória só nascia pela interface num atlas local (`browser-temporal-advanced`
 * §29.15), as provas com colega partiam de trajetória semeada por `page.evaluate`, e nenhum spec
 * temporal recarregava a página. Aqui a trajetória de um símbolo militar nasce pelo "Adicionar no
 * mapa" (dois cliques e Concluir), chega igual ao Postgres e ao colega, e sobrevive ao F5 nos dois.
 */

import { collabTest, expect, selectFeatureUI, drawMilitarySymbolUI } from './helpers/collab.fixtures.js';
import { clicarNoMapaUI } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });

const trajetoria = (page, id) => page.evaluate(async (fid) => {
    const s = await import('/src/js/store/index.js');
    const f = ((await s.getCurrentMapFeatures()).military_symbols ?? []).find((x) => x.properties?.id === fid);
    return f?.properties?.trajetoria ? JSON.parse(JSON.stringify(f.properties.trajetoria)) : null;
}, id);

collabTest('trajetória pelo editor: chega ao colega e sobrevive ao F5 nos dois', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    const id = await drawMilitarySymbolUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');
    expect(await trajetoria(A, id)).toBeNull();

    await selectFeatureUI(A, id);
    const painel = A.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.temporal-attr-btn--primary', { hasText: 'Adicionar no mapa' }).click();
    const barra = A.locator('.trajectory-edit-toolbar');
    await expect(barra).toBeVisible({ timeout: 10000 });
    const alvos = await A.evaluate(() => [[700, 260], [820, 380]].map(([x, y]) => {
        const p = globalThis.__ebgeoMap.unproject([x, y]);
        return [p.lng, p.lat];
    }));
    for (const alvo of alvos) {
        const clique = await clicarNoMapaUI(A, alvo);
        expect(clique.coberto, `o clique caiu sob ${clique.porQuem}`).toBe(false);
    }
    await barra.locator('.trajectory-edit-toolbar__done').click();
    await expect(barra).toHaveCount(0, { timeout: 10000 });

    await expect.poll(async () => (await trajetoria(A, id))?.length ?? 0, { timeout: 15000 }).toBe(3);
    const esperada = await trajetoria(A, id);
    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.properties?.trajetoria ?? null, { timeout: 30000 }).toEqual(esperada);
    await expect.poll(() => trajetoria(B, id), { timeout: 30000 }).toEqual(esperada);

    for (const page of [A, B]) {
        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await expect.poll(() => trajetoria(page, id), { timeout: 30000, message: 'a trajetoria nao voltou do disco' }).toEqual(esperada);
    }
});

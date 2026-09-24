// Path: e2e-ui/visibilidade-compartilhada-no-colega.spec.js

/**
 * COBERTURA: a visibilidade da FEIÇÃO e da CAMADA é estado compartilhado, e o colega a vê chegar
 * no desenho, e o F5 dele a mantém.
 *
 * O `visivel` da feição viaja na op de feição e o `visible` da camada na op de camada; o servidor
 * persiste os dois e o retrato os devolve. O desenho oculta pelo filtro de
 * `layers/visibility-filter.js`, que lê os dois. O grupo tem o repro próprio
 * (`grupo-oculto-no-colega-e-no-f5.repro.spec.js`), porque ali o desenho NÃO acompanhava.
 * "Desenhado" aqui é `queryRenderedFeatures` do mapa vivo, a mesma consulta do clique.
 */

import { collabTest, expect, drawPointUI, openLayersTab } from './helpers/collab.fixtures.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });

const CENTRO = [-43.2, -22.9];

function desenhadas(page, ids) {
    return page.evaluate((alvos) => {
        const set = new Set(alvos);
        const achadas = new Set();
        for (const f of globalThis.__ebgeoMap.queryRenderedFeatures()) {
            if (set.has(f.properties?.id)) achadas.add(f.properties.id);
        }
        return [...achadas].sort();
    }, ids);
}

async function enquadrar(page) {
    await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 12 }), CENTRO);
}

async function expandir(page) {
    await openLayersTab(page);
    for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) await icon.click().catch(() => {});
}

async function recarregar(page) {
    await page.reload();
    await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);
    await enquadrar(page);
}

collabTest('feicao oculta pelo Dono: o Editor deixa de desenha-la, o F5 dele mantem, e mostrar devolve', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    const alvo = await drawPointUI(A, CENTRO);
    const vizinho = await drawPointUI(A, [-43.21, -22.91]);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(vizinho)), { timeout: 20000 }).toBe(true);
    const ambos = [alvo, vizinho].sort();
    for (const p of [A, B]) await enquadrar(p);
    await expect.poll(() => desenhadas(B, ambos), { timeout: 20000, message: 'premissa: o Editor desenha os dois' }).toEqual(ambos);

    await expandir(A);
    await A.locator(`.feature-item[data-feature-id="${alvo}"] .visibility-toggle`).first().evaluate((el) => el.click());
    await expect.poll(async () => (await collab.db.queryFeatureRow(alvo))?.properties?.visivel, { timeout: 20000 }).toBe(false);
    await expect.poll(() => desenhadas(B, ambos), { timeout: 20000, message: 'o Editor deixa de desenhar a feicao oculta' }).toEqual([vizinho]);

    await recarregar(B);
    await expect.poll(() => desenhadas(B, ambos), { timeout: 20000, message: 'o F5 do Editor mantem a feicao oculta' }).toEqual([vizinho]);

    await expandir(A);
    await A.locator(`.feature-item[data-feature-id="${alvo}"] .visibility-toggle`).first().evaluate((el) => el.click());
    await expect.poll(() => desenhadas(B, ambos), { timeout: 20000, message: 'mostrar devolve a feicao ao Editor' }).toEqual(ambos);
});

collabTest('camada oculta pelo Dono: o Editor deixa de desenhar as feicoes dela, o F5 dele mantem, e mostrar devolve', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    const fora = await drawPointUI(A, CENTRO);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(fora)), { timeout: 20000 }).toBe(true);
    const camada = await A.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const l = await store.createLayer('Oculta pelo Dono');
        await store.setActiveLayer(l.id);
        return l.id;
    });
    const dentro = await drawPointUI(A, [-43.21, -22.91]);
    await expect.poll(async () => (await collab.db.queryFeatureRow(dentro))?.layer_id, { timeout: 20000 }).toBe(camada);
    const ambos = [fora, dentro].sort();
    for (const p of [A, B]) await enquadrar(p);
    await expect.poll(() => desenhadas(B, ambos), { timeout: 20000, message: 'premissa: o Editor desenha os dois' }).toEqual(ambos);

    await expandir(A);
    await A.locator(`.layer-container[data-layer-id="${camada}"] .layer-header .visibility-toggle`).first().evaluate((el) => el.click());
    await expect.poll(async () => (await collab.db.queryEntityRow('layers', camada))?.visible, { timeout: 20000 }).toBe(false);
    await expect.poll(() => desenhadas(B, ambos), { timeout: 20000, message: 'o Editor deixa de desenhar a camada oculta' }).toEqual([fora]);

    await recarregar(B);
    await expect.poll(() => desenhadas(B, ambos), { timeout: 20000, message: 'o F5 do Editor mantem a camada oculta' }).toEqual([fora]);

    await expandir(A);
    await A.locator(`.layer-container[data-layer-id="${camada}"] .layer-header .visibility-toggle`).first().evaluate((el) => el.click());
    await expect.poll(() => desenhadas(B, ambos), { timeout: 20000, message: 'mostrar devolve a camada ao Editor' }).toEqual(ambos);
});

// Path: e2e-ui/browser-collab-descartar-painel.repro.spec.js

/**
 * @fileoverview "Descartar" no painel de uma feição não pode desfazer o que o colega mudou enquanto
 * o painel estava aberto.
 *
 * A HIPÓTESE (2026-09-24). O botão "Descartar" (`tool_manager/helpers/buttons.helpers.js`) chama
 * `discardChangeFeatures` da ferramenta, que copia o RETRATO de abertura do painel por cima da
 * feição e a GRAVA inteira (`updateFeatures(..., save = true)`, que termina em `updateFeature`).
 * O retrato é de antes da edição do colega, e a op sai com a base já atualizada: o servidor aceita,
 * e o que o colega fez some em todo lugar. Descartar deveria desfazer só o que EU mexi.
 */

import { collabTest, expect, drawLineUI, selectFeatureUI, renameViaPanelUI, readFeatures } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

async function nomeNoServidor(collab, id) {
    return (await collab.db.queryFeatureRow(id))?.properties?.nome ?? null;
}

collabTest('Descartar com o painel aberto desfaz a espessura de A e nao o nome que o colega deu', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
    await A.keyboard.press('Escape');
    await expect.poll(() => nomeNoServidor(collab, id), { timeout: 30000 }).toMatch(/^Linha/);
    const nomeOriginal = await nomeNoServidor(collab, id);

    // A abre o painel da linha: o retrato de abertura nasce aqui.
    await selectFeatureUI(A, id);

    // B renomeia; o nome chega ao servidor e ao store de A.
    await expect.poll(async () => (await readFeatures(B, 'lines')).some((f) => f.id === id), { timeout: 30000 }).toBe(true);
    await selectFeatureUI(B, id);
    await renameViaPanelUI(B, 'Nome do B');
    await expect.poll(() => nomeNoServidor(collab, id), { timeout: 30000 }).toBe('Nome do B');
    await expect.poll(async () => (await readFeatures(A, 'lines')).find((f) => f.id === id)?.nome, { timeout: 30000 })
        .toBe('Nome do B');

    // A muda a ESPESSURA (prévia, não salva) e clica "Descartar": a espessura dele tem de voltar, e
    // o nome de B tem de ficar. É o controle da outra metade: descartar continua descartando.
    const espessuraOriginal = (await readFeatures(A, 'lines')).find((f) => f.id === id)?.props?.lineWidth;
    const espessura = A.locator('.feature-panel[data-expanded="true"] .attr-modern-slider')
        .filter({ hasText: 'Espessura' }).locator('.attr-modern-slider-input');
    await expect(espessura).toBeVisible({ timeout: 10000 });
    await espessura.fill('9');
    await espessura.press('Tab');
    await expect.poll(() => A.evaluate(async (fid) => {
        const src = globalThis.__ebgeoMap.getSource('lines');
        return ((await src.getData())?.features ?? []).find((f) => f.properties?.id === fid)?.properties?.lineWidth;
    }, id), { timeout: 10000, message: 'a previa da espessura nao chegou ao mapa' }).toBe(9);
    const descartar = A.locator('.feature-panel[data-expanded="true"] .attr-modern-btn-discard').first();
    await expect(descartar).toBeVisible({ timeout: 10000 });
    await descartar.click();

    // Dá tempo de uma op sair e voltar, se o descarte gravou algo; e então o nome de B tem de estar lá.
    await A.waitForTimeout(3000);
    await expect.poll(async () => A.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.countByState()).pendentes;
    }), { timeout: 15000 }).toBe(0);
    expect(await nomeNoServidor(collab, id), `o Descartar de A trouxe de volta "${nomeOriginal}"`).toBe('Nome do B');
    await expect.poll(async () => (await readFeatures(B, 'lines')).find((f) => f.id === id)?.nome, { timeout: 15000 })
        .toBe('Nome do B');
    // E a espessura que A mexeu voltou, no servidor, no store de A e na fonte de A.
    expect((await collab.db.queryFeatureRow(id))?.properties?.lineWidth ?? null).toBe(espessuraOriginal ?? null);
    expect((await readFeatures(A, 'lines')).find((f) => f.id === id)?.props?.lineWidth).toBe(espessuraOriginal);
    await expect.poll(() => A.evaluate(async (fid) => {
        const src = globalThis.__ebgeoMap.getSource('lines');
        return ((await src.getData())?.features ?? []).find((f) => f.properties?.id === fid)?.properties?.lineWidth ?? null;
    }, id), { timeout: 10000 }).toBe(espessuraOriginal ?? null);
});

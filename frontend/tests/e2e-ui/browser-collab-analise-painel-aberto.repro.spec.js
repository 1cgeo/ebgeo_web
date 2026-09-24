// Path: e2e-ui/browser-collab-analise-painel-aberto.repro.spec.js

/**
 * @fileoverview O "Salvar" do painel de uma VISADA aberta não pode desfazer o que o colega mudou
 * enquanto ele estava aberto.
 *
 * A HIPÓTESE (2026-09-23). O `saveFeatures` da visada e do viewshed monta a feição a gravar
 * espalhando TODAS as propriedades da cópia do painel (tirada quando ele abriu) sobre a da fonte,
 * enquanto as ferramentas de desenho aplicam só o que a pessoa mexeu (`mergePendingEdits`,
 * `tool_manager/helpers/pending-edit.helpers.js`). Desde que a edição da visada passou a viajar
 * (`346aa855`), a cópia velha do painel viaja junto: o colega renomeia, eu mudo a largura e salvo, e
 * o nome volta ao de antes em todo lugar, porque a minha op sai com a base já atualizada e o
 * servidor não tem o que chamar de disputa.
 */

import { collabTest, expect, selectFeatureUI, renameViaPanelUI, savePanelUI } from './helpers/collab.fixtures.js';
import { prepararTerreno, desocupar, tracarVisada, balde } from './helpers/analise-terreno.js';

collabTest.describe.configure({ retries: 0 });

async function noServidor(collab, id, chave) {
    return (await collab.db.queryFeatureRow(id))?.properties?.[chave] ?? null;
}

collabTest('mudar a largura da visada com o painel aberto nao desfaz o nome que o colega deu', async ({ collab }) => {
    collabTest.setTimeout(300000);
    const A = collab.author;
    const B = collab.peers[0];

    await prepararTerreno(A);
    const losId = await tracarVisada(A);
    await desocupar(A);
    await expect.poll(() => noServidor(collab, losId, 'nome'), { timeout: 30000 }).toMatch(/^Linha de Visada/);

    // A abre o painel da visada: a cópia do painel nasce aqui.
    await selectFeatureUI(A, losId);

    // B renomeia a visada, e o nome chega ao servidor e ao store de A.
    await expect.poll(async () => (await balde(B, 'los')).length, { timeout: 30000 }).toBe(1);
    await selectFeatureUI(B, losId);
    await renameViaPanelUI(B, 'Nome do B');
    await desocupar(B);
    await expect.poll(() => noServidor(collab, losId, 'nome'), { timeout: 30000 }).toBe('Nome do B');
    await expect.poll(async () => (await balde(A, 'los'))[0]?.props?.nome, { timeout: 30000 }).toBe('Nome do B');

    // A, com o painel ainda aberto, muda a LARGURA e salva.
    const painel = A.locator('.feature-panel[data-expanded="true"]');
    const largura = painel.locator('.attr-modern-slider').filter({ hasText: 'Largura' }).locator('.attr-modern-slider-input');
    await expect(largura).toBeVisible({ timeout: 10000 });
    await largura.fill('12');
    await largura.press('Tab');
    await savePanelUI(A);

    await expect.poll(() => noServidor(collab, losId, 'width'), { timeout: 30000, message: 'a largura de A nao chegou ao servidor' })
        .toBe(12);
    expect(await noServidor(collab, losId, 'nome'), 'o nome que B deu sobrevive ao Salvar de A').toBe('Nome do B');
    await expect.poll(async () => (await balde(B, 'los'))[0]?.props?.nome, { timeout: 15000 }).toBe('Nome do B');
    await expect.poll(async () => (await balde(A, 'los'))[0]?.props?.nome, { timeout: 15000 }).toBe('Nome do B');
});

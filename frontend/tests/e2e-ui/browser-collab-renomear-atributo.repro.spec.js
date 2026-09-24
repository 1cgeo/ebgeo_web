// Path: e2e-ui/browser-collab-renomear-atributo.repro.spec.js

/**
 * @fileoverview RENOMEAR um atributo customizado leva o VALOR ATUAL dele, e não o que a aba mostrava.
 *
 * A HIPÓTESE (2026-09-24). A aba Atributos do painel chama `renameAttribute` com o valor que ela
 * DESENHOU (`user_data/attributes_tab_renderer.js`), e `renameAttribute`
 * (`user_data/user_data_manager.js`) gravava esse valor na chave nova. Se o colega mudou o valor
 * enquanto a aba estava aberta, renomear a chave desfazia o valor dele, no servidor e nos dois
 * clientes.
 */

import { collabTest, expect, drawPointUI, selectFeatureUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

async function atributosNoServidor(collab, id) {
    return (await collab.db.queryFeatureRow(id))?.properties?.attributes ?? null;
}

async function abrirAbaAtributos(page, id) {
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="atributos"]').click();
    return painel.locator('.feature-tab-content[data-tab-id="atributos"]');
}

collabTest('renomear a chave com a aba aberta leva o valor que o colega deu, nao o velho', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawPointUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');

    // A cria o atributo "cota" = "1" pela aba.
    const abaA = await abrirAbaAtributos(A, id);
    await abaA.locator('.feature-attributes-add-btn').click();
    const [chave, valor] = await abaA.locator('.feature-attributes-inline-input').all();
    await chave.fill('cota');
    await valor.fill('1');
    await abaA.locator('.feature-attributes-inline-confirm').click();
    await expect.poll(() => atributosNoServidor(collab, id), { timeout: 30000 }).toEqual({ cota: '1' });
    await expect(abaA.locator('.feature-attribute-row', { hasText: 'cota' })).toBeVisible({ timeout: 10000 });

    // B muda o VALOR de "cota" para "7".
    await expect.poll(async () => B.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).find((p) => p.properties.id === fid)?.properties?.attributes?.cota ?? null;
    }, id), { timeout: 30000 }).toBe('1');
    const abaB = await abrirAbaAtributos(B, id);
    await abaB.locator('.feature-attribute-row', { hasText: 'cota' }).locator('.feature-attribute-value').click();
    const campoValor = abaB.locator('.feature-attribute-value-input');
    await campoValor.fill('7');
    await campoValor.press('Enter');
    await expect.poll(() => atributosNoServidor(collab, id), { timeout: 30000 }).toEqual({ cota: '7' });
    await expect.poll(async () => A.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).find((p) => p.properties.id === fid)?.properties?.attributes?.cota ?? null;
    }, id), { timeout: 30000, message: 'o valor de B nao chegou ao store de A' }).toBe('7');

    // A, com a aba aberta desde antes, renomeia a CHAVE "cota" para "altura".
    const linhaA = abaA.locator('.feature-attribute-row', { hasText: 'cota' });
    console.log('[renomear-atributo] valor que a aba de A mostra:', await linhaA.locator('.feature-attribute-value').innerText());
    await linhaA.locator('.feature-attribute-key-edit').click();
    const campoChave = abaA.locator('.feature-attribute-key-input');
    await campoChave.fill('altura');
    await campoChave.press('Enter');

    await expect.poll(() => atributosNoServidor(collab, id), {
        timeout: 30000, message: 'renomear a chave desfez o valor que o colega deu',
    }).toEqual({ altura: '7' });
});

// Path: e2e-ui/cobertura-atributos-aba-aberta-colega.spec.js

/**
 * @fileoverview A ABA ATRIBUTOS ABERTA ENQUANTO O COLEGA MUDA A MESMA FEIÇÃO.
 *
 * B está com a feição selecionada e a aba Atributos aberta; A renomeia uma chave, exclui outra e cria
 * uma terceira. A aba de B tem de mostrar o que existe, sem B selecionar de novo, porque o que ela
 * mostra é o que B vai editar: uma chave que já não existe, editada pela aba velha, voltaria a existir.
 */

import { collabTest, expect, drawPointUI, selectFeatureUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

async function abrirAba(page, id) {
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="atributos"]').click();
    return painel.locator('.feature-tab-content[data-tab-id="atributos"]');
}

async function criar(aba, chave, valor) {
    await aba.locator('.feature-attributes-add-btn').click();
    const [k, v] = await aba.locator('.feature-attributes-inline-input').all();
    await k.fill(chave);
    await v.fill(valor);
    await aba.locator('.feature-attributes-inline-confirm').click();
    await expect(aba.locator('.feature-attributes-inline-form')).toHaveCount(0, { timeout: 10000 });
}

function chavesNaAba(aba) {
    return aba.locator('.feature-attribute-key').allInnerTexts().then((t) => t.map((x) => x.trim()).sort());
}

function atributosNaStore(page, id) {
    return page.evaluate(async (fid) => {
        const f = await (await import('/src/js/store/index.js')).getCurrentMapFeatures();
        return (f.points ?? []).find((p) => p.properties.id === fid)?.properties?.attributes ?? null;
    }, id);
}

collabTest('renomear, excluir e criar do colega aparecem na aba aberta, e editar pela aba não ressuscita chave', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawPointUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');
    const abaA = await abrirAba(A, id);
    await criar(abaA, 'cota', '10');
    await criar(abaA, 'setor', '1');
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ cota: '10', setor: '1' });

    const abaB = await abrirAba(B, id);
    await expect.poll(() => chavesNaAba(abaB)).toEqual(['cota', 'setor']);

    // A renomeia "cota" para "altura", exclui "setor" e cria "zona".
    await abaA.locator('.feature-attribute-row', { hasText: 'cota' }).locator('.feature-attribute-key-edit').click();
    await abaA.locator('.feature-attribute-key-input').fill('altura');
    await abaA.locator('.feature-attribute-key-input').press('Enter');
    await expect.poll(() => atributosNaStore(A, id)).toEqual({ altura: '10', setor: '1' });
    await abaA.locator('.feature-attribute-row', { hasText: 'setor' }).locator('.feature-attribute-delete').click();
    await criar(abaA, 'zona', 'Norte');
    const final = { altura: '10', zona: 'Norte' };
    await expect.poll(() => collab.db.queryFeatureRow(id).then((r) => r?.properties?.attributes), { timeout: 30000 })
        .toEqual(final);
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual(final);

    // A aba de B, aberta o tempo todo, mostra o que existe.
    await expect.poll(() => chavesNaAba(abaB), { timeout: 15000, message: 'a aba aberta do colega ficou velha' })
        .toEqual(['altura', 'zona']);

    // B edita pela aba: o valor de "altura" muda, e nenhuma chave velha volta.
    await abaB.locator('.feature-attribute-row', { hasText: 'altura' }).locator('.feature-attribute-value').click();
    await abaB.locator('.feature-attribute-value-input').fill('11');
    await abaB.locator('.feature-attribute-value-input').press('Enter');
    await expect.poll(() => collab.db.queryFeatureRow(id).then((r) => r?.properties?.attributes), { timeout: 30000 })
        .toEqual({ altura: '11', zona: 'Norte' });
    await expect.poll(() => atributosNaStore(A, id), { timeout: 30000 }).toEqual({ altura: '11', zona: 'Norte' });
});

collabTest('com um campo da aba aberto, a mudança do colega espera: o que se digita fica, e a aba se atualiza ao fechar', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawPointUI(A, [-43.21, -22.91]);
    await A.keyboard.press('Escape');
    const abaA = await abrirAba(A, id);
    await criar(abaA, 'cota', '10');
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ cota: '10' });

    // B abre o valor de "cota" e digita, sem confirmar.
    const abaB = await abrirAba(B, id);
    await abaB.locator('.feature-attribute-row', { hasText: 'cota' }).locator('.feature-attribute-value').click();
    const campo = abaB.locator('.feature-attribute-value-input');
    await campo.fill('digitando');

    // A cria "zona"; chega a B com o campo aberto.
    await criar(abaA, 'zona', 'Norte');
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ cota: '10', zona: 'Norte' });
    await B.waitForTimeout(1000);
    await expect(campo, 'a mudança do colega fechou o campo que B digitava').toHaveCount(1);
    await expect(campo).toHaveValue('digitando');

    // B desiste (Escape): a aba mostra o que existe agora.
    await campo.press('Escape');
    await expect.poll(() => chavesNaAba(abaB), { timeout: 10000, message: 'a aba não se atualizou ao fechar o campo' })
        .toEqual(['cota', 'zona']);
    expect(await atributosNaStore(B, id)).toEqual({ cota: '10', zona: 'Norte' });
});


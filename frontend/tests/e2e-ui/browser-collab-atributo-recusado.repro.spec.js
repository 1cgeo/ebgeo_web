// Path: e2e-ui/browser-collab-atributo-recusado.repro.spec.js

/**
 * @fileoverview Um valor de atributo RECUSADO pela store não fica aberto na aba como se tivesse
 * sido salvo.
 *
 * A HIPÓTESE (revisão final, 2026-09-24). Desde que o gerente de atributos aplica a mudança sob a
 * trava do documento (`updateFeature({ transform })`), uma escrita recusada (mapa travado pelo
 * colega, posto) nunca roda a mudança, e o `FEATURE_UPDATED` que redesenhava a aba não sai mais: o
 * campo de valor ficava aberto mostrando o que não foi gravado.
 *
 * O CASO: B (Editor) abre a aba Atributos de um ponto; A (Dono) trava o mapa pelo controlador (a
 * mesma porta do cadeado da aba Mapas); B edita o valor e confirma. A aba de B tem de voltar a
 * mostrar o valor GUARDADO, sem campo aberto.
 */

import { collabTest, expect, drawPointUI, selectFeatureUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

async function abrirAbaAtributos(page, id) {
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="atributos"]').click();
    return painel.locator('.feature-tab-content[data-tab-id="atributos"]');
}

collabTest('valor recusado com o mapa travado pelo colega volta ao guardado, sem campo aberto', async ({ collab }) => {
    collabTest.setTimeout(150000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawPointUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');
    const abaA = await abrirAbaAtributos(A, id);
    await abaA.locator('.feature-attributes-add-btn').click();
    const [chave, valor] = await abaA.locator('.feature-attributes-inline-input').all();
    await chave.fill('cota');
    await valor.fill('1');
    await abaA.locator('.feature-attributes-inline-confirm').click();
    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.properties?.attributes ?? null, { timeout: 30000 })
        .toEqual({ cota: '1' });
    await A.keyboard.press('Escape');

    // B abre a aba do ponto.
    await expect.poll(async () => B.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).find((p) => p.properties.id === fid)?.properties?.attributes?.cota ?? null;
    }, id), { timeout: 30000 }).toBe('1');
    const abaB = await abrirAbaAtributos(B, id);
    const linhaB = abaB.locator('.feature-attribute-row', { hasText: 'cota' });
    await expect(linhaB).toBeVisible({ timeout: 10000 });

    // A trava o mapa; a trava chega a B.
    await A.evaluate(async () => {
        const { mapLockController } = await import('/src/js/locking/map-lock.controller.js');
        return mapLockController.toggleMapLock();
    });
    await expect.poll(() => B.evaluate(async () => (await import('/src/js/store/index.js')).isCurrentMapLockedSync()), {
        timeout: 30000, message: 'a trava de A nao chegou a B',
    }).toBe(true);

    // B edita o valor na aba que continua aberta, e confirma.
    const valorB = abaB.locator('.feature-attribute-row', { hasText: 'cota' }).locator('.feature-attribute-value');
    if ((await valorB.count()) === 0) {
        console.log('[atributo-recusado] a aba de B nao oferece mais o valor com o mapa travado: nada a medir');
        return;
    }
    await valorB.click();
    const campo = abaB.locator('.feature-attribute-value-input');
    await campo.fill('9');
    await campo.press('Enter');

    await expect(abaB.locator('.feature-attribute-value-input'), 'o campo recusado ficou aberto').toHaveCount(0, { timeout: 10000 });
    await expect(abaB.locator('.feature-attribute-row', { hasText: 'cota' }).locator('.feature-attribute-value')).toHaveText('1');
    expect((await collab.db.queryFeatureRow(id))?.properties?.attributes).toEqual({ cota: '1' });
});

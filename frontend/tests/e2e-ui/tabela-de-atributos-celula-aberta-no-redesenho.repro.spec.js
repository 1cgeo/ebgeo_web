// Path: e2e-ui/tabela-de-atributos-celula-aberta-no-redesenho.repro.spec.js

/**
 * @fileoverview A CÉLULA ABERTA DA TABELA DE ATRIBUTOS SOBREVIVE AO REDESENHO.
 *
 * A tabela redesenha INTEIRA a cada `LAYERS_CHANGED` e a cada `FEATURE_UPDATED` de uma feição dela
 * (`_handleLayersChanged` e `_handleFeatureUpdated`, `attribute_table/attribute-table.control.js`), e
 * as duas coisas acontecem enquanto alguém digita:
 *
 *   1. o Tab grava a célula e abre a seguinte; a gravação termina DEPOIS, emite o evento, e o
 *      redesenho destrói a célula que o Tab acabou de abrir;
 *   2. toda op REMOTA de feição emite `LAYERS_CHANGED` (`store/sync/remote-operation-handler.js`),
 *      então um colega editando QUALQUER feição destrói a célula de quem digita. A remoção do campo
 *      focado dispara `blur` no Chromium, que GRAVA o valor pela metade, e nada no Firefox, que o
 *      perde calado.
 *
 * O que vale: a célula aberta continua aberta e com o que foi digitado; o redesenho espera ela fechar.
 */

import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { collabTest, drawPointUI, selectFeatureUI } from './helpers/collab.fixtures.js';

const state = readState();
test.describe.configure({ retries: 0 });
collabTest.describe.configure({ retries: 0 });

const linhas = (page) => page.locator('.attribute-table-panel tr.attribute-table-row');
const campo = (page) => page.locator('.attribute-table-panel .attribute-table-cell-input');

/** Abre a tabela da camada dos pontos, sem fechar a barra lateral se ela já está aberta. */
async function abrirTabela(page, total) {
    const camada = await page.evaluate(async () => {
        const f = await (await import('/src/js/store/index.js')).getCurrentMapFeatures();
        return f.points?.[0]?.properties?.layerId ?? null;
    });
    const botao = page.locator(`.layer-container[data-layer-id="${camada}"] .table-toggle`);
    if (!(await botao.isVisible())) await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    await botao.click();
    await expect(linhas(page)).toHaveCount(total, { timeout: 15000 });
}

/** Os pontos da store: id, nome, descrição e atributos. */
function pontos(page) {
    return page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).map((p) => ({
            id: p.properties.id, nome: p.properties.nome, descricao: p.properties.descricao ?? '',
            attributes: p.properties.attributes ?? {},
        }));
    });
}

test.describe('local', () => {
    test.beforeEach(() => { test.skip(state.skip, state.reason); });

    test('Tab de Nome para Descrição e entre atributos: a célula seguinte continua aberta depois da gravação', async ({ page }) => {
        test.setTimeout(120000);
        await page.goto('/');
        await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
        await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });

        const arquivo = { type: 'FeatureCollection', features: [{
            type: 'Feature', geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
            properties: { nome: 'Alfa', altura: '10', setor: 'Norte' },
        }] };
        await page.evaluate(async (base64) => {
            const container = globalThis.__ebgeoMap.getContainer();
            const rect = container.getBoundingClientRect();
            const dt = new DataTransfer();
            dt.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'um.geojson',
                { type: 'application/geo+json' }));
            container.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true,
                clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2) }));
        }, Buffer.from(JSON.stringify(arquivo)).toString('base64'));
        await expect.poll(async () => (await pontos(page)).length, { timeout: 30000 }).toBe(1);
        await abrirTabela(page, 1);

        // Nome, Tab, Descrição.
        await linhas(page).first().locator('td.attribute-table-cell-name').dblclick();
        await campo(page).fill('Bravo');
        await campo(page).press('Tab');
        await expect.poll(async () => (await pontos(page))[0].nome, { timeout: 10000 }).toBe('Bravo');
        await page.waitForTimeout(1000);
        await expect(campo(page), 'o redesenho da gravação fechou a Descrição que o Tab abriu').toHaveCount(1);
        await campo(page).fill('Descrita');
        await campo(page).press('Enter');
        await expect.poll(async () => (await pontos(page))[0].descricao, { timeout: 10000 }).toBe('Descrita');

        // Entre atributos: altura, Tab, setor.
        await linhas(page).first().locator('td[data-attr-key="altura"]').dblclick();
        await campo(page).fill('11');
        await campo(page).press('Tab');
        await expect.poll(async () => (await pontos(page))[0].attributes.altura, { timeout: 10000 }).toBe('11');
        await page.waitForTimeout(1000);
        await expect(campo(page), 'o redesenho da gravação fechou o atributo que o Tab abriu').toHaveCount(1);
        await campo(page).fill('Sul');
        await campo(page).press('Enter');
        await expect.poll(async () => (await pontos(page))[0].attributes.setor, { timeout: 10000 }).toBe('Sul');
        await expect(linhas(page).first().locator('td[data-attr-key="setor"]')).toContainText('Sul');
    });
});

/** Cria um atributo pela aba da feição. */
async function criarAtributo(page, id, chave, valor) {
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="atributos"]').click();
    const aba = painel.locator('.feature-tab-content[data-tab-id="atributos"]');
    await aba.locator('.feature-attributes-add-btn').click();
    const [campoChave, campoValor] = await aba.locator('.feature-attributes-inline-input').all();
    await campoChave.fill(chave);
    await campoValor.fill(valor);
    await aba.locator('.feature-attributes-inline-confirm').click();
    await expect(aba.locator('.feature-attributes-inline-form')).toHaveCount(0, { timeout: 10000 });
    return aba;
}

collabTest('um colega editando OUTRA feição não fecha a célula de quem digita, nem grava o valor pela metade', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];

    const um = await drawPointUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');
    const dois = await drawPointUI(A, [-43.21, -22.91]);
    await A.keyboard.press('Escape');
    await criarAtributo(A, um, 'cota', '10');
    await A.keyboard.press('Escape');
    await criarAtributo(A, dois, 'cota', '20');
    await A.keyboard.press('Escape');
    await expect.poll(async () => (await pontos(B)).filter((p) => p.attributes.cota).length, { timeout: 30000 }).toBe(2);

    // B abre a tabela e começa a digitar na célula da feição DOIS.
    await abrirTabela(B, 2);
    await B.locator(`.attribute-table-panel tr[data-feature-id="${dois}"] td[data-attr-key="cota"]`).dblclick();
    await expect(campo(B)).toHaveCount(1);
    await campo(B).fill('parcial');

    // A edita a feição UM pela aba.
    await criarAtributo(A, um, 'setor', 'Norte');
    await expect.poll(async () => (await pontos(B)).find((p) => p.id === um)?.attributes?.setor, { timeout: 30000 })
        .toBe('Norte');
    await B.waitForTimeout(1500);
    process.stdout.write(`[redesenho] célula aberta: ${await campo(B).count()}; no servidor: ${
        (await collab.db.queryFeatureRow(dois))?.properties?.attributes?.cota}\n`);

    await expect(campo(B), 'a edição do colega fechou a célula de quem digita').toHaveCount(1);
    await expect(campo(B)).toHaveValue('parcial');
    expect((await collab.db.queryFeatureRow(dois))?.properties?.attributes?.cota,
        'o valor pela metade foi gravado').toBe('20');

    // B termina: grava, e a tabela mostra a edição do colega.
    await campo(B).fill('final');
    await campo(B).press('Enter');
    await expect.poll(() => collab.db.queryFeatureRow(dois).then((r) => r?.properties?.attributes?.cota), { timeout: 30000 })
        .toBe('final');
    await expect(B.locator(`.attribute-table-panel tr[data-feature-id="${um}"] td[data-attr-key="setor"]`))
        .toContainText('Norte', { timeout: 10000 });
});

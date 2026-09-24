// Path: e2e-ui/tabela-de-atributos-sobrevive-ao-f5.repro.spec.js

/**
 * @fileoverview UM VALOR DIGITADO NUMA CÉLULA DA TABELA DE ATRIBUTOS NÃO SOME EM SILÊNCIO NUM F5.
 *
 * A célula grava no Enter, no Tab e no blur (`startCellEditing`,
 * `attribute_table/components/table-renderer.js`). Um F5 ou uma aba fechada com a célula ainda
 * aberta não é nenhum dos três: medido em 2026-09-24, o valor digitado sumia nos dois navegadores
 * (com Enter antes do F5 ele ficava, nos dois). O conserto é o do editor de briefing e do painel de
 * feição: na saída, confirma a célula e pede a confirmação do navegador. Sem mudança, nada é pedido.
 *
 * A PROVA, nos dois navegadores, é pelo lado do produto: o `beforeunload` despachado é cancelado só
 * com valor mudado, e ele mesmo confirma a célula, de modo que o valor está no disco depois de um
 * recarregamento. No Chromium vai também o F5 real: o diálogo aparece e, com "Ficar na página", o
 * valor está gravado. ACEITAR o diálogo ("Sair") NÃO garante a gravação e não é afirmado aqui:
 * medido em 2026-09-24, 2 de 5 gravaram, porque a gravação write-ahead precisa de várias voltas do
 * laço de eventos e a troca de documento nem sempre as dá. O ganho do conserto é a saída deixar de
 * ser SILENCIOSA. O Playwright não emite o diálogo de `beforeunload` numa navegação do Firefox.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

const VALOR = 'NOME-NA-TABELA';

/** Desenha um ponto pela ferramenta real, abre a tabela e devolve a célula de nome. */
async function tabelaComPonto(page) {
    await page.goto('/');
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 20000 });
    const grupo = page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn');
    await grupo.click();
    await expect(page.locator('.toolbar-group[data-group-id="draw"] .toolbar-popup'))
        .toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    const ferramenta = page.locator('.toolbar-group[data-group-id="draw"] .toolbar-tool-btn[data-tool-id="point"]');
    await ferramenta.click();
    await expect(ferramenta).toHaveAttribute('data-active', 'true', { timeout: 10000 });
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(grupo).toHaveAttribute('data-active', 'false', { timeout: 10000 });
    // O painel de feição que o desenho abre tem guarda de saída própria: fechado aqui, o diálogo
    // que o caso observa só pode ser o da célula.
    const painelDeFeicao = page.locator('.feature-panel[data-expanded="true"]');
    if (await painelDeFeicao.count()) {
        await painelDeFeicao.locator('.attr-modern-btn-save').first().click();
        await expect(painelDeFeicao).toHaveCount(0, { timeout: 10000 });
    }
    await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    await page.locator('.table-toggle').first().click();
    const celula = page.locator('.attribute-table-panel tr.attribute-table-row td.attribute-table-cell-name').first();
    await expect(celula).toBeVisible({ timeout: 15000 });
    return celula;
}

/** Os nomes dos pontos gravados, lidos da store depois do recarregamento. */
async function nomesGravados(page) {
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 20000 });
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return (f?.points ?? []).map((p) => p.properties?.nome);
    });
}

/** Despacha um `beforeunload` na página e diz se algum ouvinte o cancelou. */
function saidaCancelada(page) {
    return page.evaluate(() => {
        const evento = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(evento);
        return evento.defaultPrevented;
    });
}

test('célula aberta com valor mudado: a saída pede confirmação e confirma a célula', async ({ page }) => {
    const celula = await tabelaComPonto(page);
    await celula.dblclick();
    const input = page.locator('.attribute-table-cell-input');
    await expect(input).toBeVisible();
    expect(await saidaCancelada(page), 'CONTROLE: célula aberta sem mudança não pede nada').toBe(false);

    await input.fill(VALOR);
    expect(await saidaCancelada(page), 'com valor mudado, a saída pede confirmação').toBe(true);
    // A saída confirmou a célula: o valor chegou ao disco, e sobrevive a um recarregamento.
    await page.waitForTimeout(1000);
    await page.reload();
    expect(await nomesGravados(page), 'o valor digitado na célula foi perdido').toContain(VALOR);
});

test('Chromium: F5 real com a célula aberta avisa, e quem fica tem o valor gravado', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'o Playwright não emite o diálogo de beforeunload no Firefox');
    // "FICAR NA PÁGINA", e não "Sair": a gravação que o `beforeunload` dispara precisa de voltas do
    // laço de eventos que a troca de documento nem sempre dá (aceitando o diálogo, medido em
    // 2026-09-24: 2 de 5 gravaram). O que o produto garante é que a saída não é mais SILENCIOSA: a
    // pessoa é avisada e, ficando, o valor está no disco.
    const dialogos = [];
    page.once('dialog', async (dialogo) => {
        dialogos.push(dialogo.type());
        await dialogo.dismiss();
    });
    const celula = await tabelaComPonto(page);
    await celula.dblclick();
    const input = page.locator('.attribute-table-cell-input');
    await expect(input).toBeVisible();
    await input.fill(VALOR);
    await page.reload({ timeout: 5000 }).catch(() => { /* navegação cancelada pelo "Ficar" */ });
    await page.waitForTimeout(1000);
    await page.reload();
    const nomes = await nomesGravados(page);
    process.stdout.write(`[tabela-f5] ${JSON.stringify({ dialogos, nomes })}
`);
    expect(dialogos, 'a saída com a célula mudada pediu confirmação').toEqual(['beforeunload']);
    expect(nomes, 'ficando na página, o valor da célula foi gravado').toContain(VALOR);
});

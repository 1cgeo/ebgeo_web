// Path: e2e-ui/cobertura-tabela-colunas.spec.js

/**
 * @fileoverview AS COLUNAS DA TABELA DE ATRIBUTOS PELA INTERFACE, numa camada de 300 feições, em
 * atlas LOCAL: adicionar coluna (e as recusas), preencher a coluna nova, remover coluna pelo menu do
 * cabeçalho com confirmação, "selecionar todas" e o zoom da linha.
 *
 * A remoção de coluna é um laço de uma escrita por feição (`_handleRemoveColumn`); o tempo dela em
 * 300 feições é registrado, não afirmado.
 */

import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readState } from './state.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

const TOTAL = 300;

async function abrirMapa(page) {
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
}

function pontos(page) {
    return page.evaluate(async () => {
        const f = await (await import('/src/js/store/index.js')).getCurrentMapFeatures();
        return (f.points ?? []).map((p) => ({
            id: p.properties.id, layerId: p.properties.layerId, coords: p.geometry.coordinates,
            attributes: p.properties.attributes ?? {},
        }));
    });
}

const linhas = (page) => page.locator('.attribute-table-panel tr.attribute-table-row');

/** Importa 300 pontos e abre a tabela da camada deles. */
async function tabelaDe300(page) {
    await page.goto('/');
    await abrirMapa(page);
    const features = [];
    for (let i = 1; i <= TOTAL; i++) {
        features.push({ type: 'Feature',
            geometry: { type: 'Point', coordinates: [-53.5 + (i % 20) * 0.01, -30.1 + Math.floor(i / 20) * 0.01] },
            properties: { nome: `P${String(i).padStart(3, '0')}`, setor: i % 2 ? 'Norte' : 'Sul' } });
    }
    const base64 = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features })).toString('base64');
    await page.evaluate(async (b64) => {
        const container = globalThis.__ebgeoMap.getContainer();
        const rect = container.getBoundingClientRect();
        const dt = new DataTransfer();
        dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'trezentos.geojson',
            { type: 'application/geo+json' }));
        container.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true,
            clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2) }));
    }, base64);
    await expect.poll(async () => (await pontos(page)).length, { timeout: 60000 }).toBe(TOTAL);
    const [{ layerId }] = await pontos(page);
    await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    await page.locator(`.layer-container[data-layer-id="${layerId}"] .table-toggle`).click();
    await expect(linhas(page)).toHaveCount(TOTAL, { timeout: 30000 });
}

/** Responde ao diálogo de nome de "Adicionar atributo". */
async function adicionarColuna(page, nome) {
    await page.locator('.attribute-table-add-column-btn').click();
    const campo = page.locator('.prompt-modal-input');
    await expect(campo).toBeVisible({ timeout: 5000 });
    await campo.fill(nome);
    await page.locator('.prompt-modal-btn-confirm').click();
    await expect(campo).toHaveCount(0, { timeout: 5000 });
}

test('adicionar coluna (e as recusas), preenchê-la, e ela sobrevive ao F5', async ({ page }) => {
    test.setTimeout(180000);
    await tabelaDe300(page);

    await adicionarColuna(page, 'altura');
    const cabecalho = page.locator('.attribute-table-panel th[data-column-key="altura"]');
    await expect(cabecalho).toHaveCount(1);
    await expect(linhas(page).first().locator('td[data-attr-key="altura"]')).toHaveCount(1);

    // As recusas: nome repetido e caractere proibido. A coluna não duplica e a proibida não nasce.
    await adicionarColuna(page, 'setor');
    await expect(page.locator('.toast', { hasText: 'já existe' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.attribute-table-panel th[data-column-key="setor"]')).toHaveCount(1);
    await adicionarColuna(page, 'a/b');
    await expect(page.locator('.attribute-table-panel th[data-column-key="a/b"]')).toHaveCount(0);

    // Preencher a coluna nova numa linha.
    const primeira = linhas(page).first();
    const id = await primeira.getAttribute('data-feature-id');
    await primeira.locator('td[data-attr-key="altura"]').dblclick();
    await page.locator('.attribute-table-cell-input').fill('12');
    await page.locator('.attribute-table-cell-input').press('Enter');
    await expect.poll(async () => (await pontos(page)).find((p) => p.id === id)?.attributes?.altura, { timeout: 10000 })
        .toBe('12');
    // A coluna continua na tabela depois dos redesenhos da gravação.
    await expect(cabecalho).toHaveCount(1);

    await page.reload();
    await abrirMapa(page);
    expect((await pontos(page)).find((p) => p.id === id)?.attributes).toEqual({ setor: expect.any(String), altura: '12' });
});

test('remover coluna pelo menu do cabeçalho pede confirmação e tira o atributo das 300 feições', async ({ page }) => {
    test.setTimeout(240000);
    await tabelaDe300(page);

    // Cancelar a confirmação não remove nada.
    await page.locator('.attribute-table-panel th[data-column-key="setor"]').click({ button: 'right' });
    await page.locator('.attribute-table-column-menu-item', { hasText: 'Remover atributo' }).click();
    await expect(page.locator('.confirm-modal-container')).toBeVisible({ timeout: 5000 });
    await page.locator('.confirm-modal-container .confirm-modal-btn-cancel').click();
    await page.waitForTimeout(500);
    expect((await pontos(page)).filter((p) => 'setor' in p.attributes)).toHaveLength(TOTAL);

    await page.locator('.attribute-table-panel th[data-column-key="setor"]').click({ button: 'right' });
    await page.locator('.attribute-table-column-menu-item', { hasText: 'Remover atributo' }).click();
    // Quantas vezes a tabela se redesenha durante a remoção, contado pelo DOM (o corpo da tabela
    // trocado), que não depende de identidade de módulo. Ela se redesenhava uma vez por feição
    // escrita, e isso era nove décimos do tempo (medido em 2026-09-24: 23 s, e 2,4 s sem os
    // redesenhos).
    await page.evaluate(() => {
        globalThis.__redesenhos = 0;
        const alvo = document.querySelector('.attribute-table-panel .attribute-table-container');
        globalThis.__observador = new MutationObserver((mudancas) => {
            for (const m of mudancas) {
                if ([...m.addedNodes].some((n) => n.classList?.contains('attribute-table'))) globalThis.__redesenhos++;
            }
        });
        globalThis.__observador.observe(alvo, { childList: true });
    });
    const t0 = Date.now();
    await page.locator('.confirm-modal-container .confirm-modal-btn-confirm').click();
    await expect.poll(async () => (await pontos(page)).filter((p) => 'setor' in p.attributes).length,
        { timeout: 120000 }).toBe(0);
    await expect(page.locator('.attribute-table-panel th[data-column-key="setor"]')).toHaveCount(0, { timeout: 10000 });
    const redesenhos = await page.evaluate(() => { globalThis.__observador.disconnect(); return globalThis.__redesenhos; });
    process.stdout.write(`[colunas] remover coluna de ${TOTAL} feições: ${Date.now() - t0} ms, ${redesenhos} redesenhos\n`);
    expect(redesenhos, 'a tabela se redesenhou uma vez por feição escrita').toBeLessThanOrEqual(3);

    await page.reload();
    await abrirMapa(page);
    expect((await pontos(page)).filter((p) => 'setor' in p.attributes)).toHaveLength(0);
});

test('"selecionar todas" seleciona as 300 no mapa, e o zoom da linha leva o mapa até a feição', async ({ page }) => {
    test.setTimeout(180000);
    await tabelaDe300(page);
    const selecionadas = () => page.evaluate(async () =>
        (await import('/src/js/store/index.js')).getStateManager().getSelectedFeatures().length);

    await page.locator('.attribute-table-select-all').check();
    await expect.poll(selecionadas, { timeout: 15000 }).toBe(TOTAL);
    await expect(page.locator('.attribute-table-panel tr.attribute-table-row[data-selected="true"]')).toHaveCount(TOTAL);
    await page.locator('.attribute-table-select-all').uncheck();
    await expect.poll(selecionadas, { timeout: 15000 }).toBe(0);

    const ultima = linhas(page).last();
    const id = await ultima.getAttribute('data-feature-id');
    const alvo = (await pontos(page)).find((p) => p.id === id).coords;
    await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [0, 0], zoom: 3 }));
    await ultima.locator('.attribute-table-zoom-btn').click();
    await expect.poll(() => page.evaluate(() => globalThis.__ebgeoMap.getCenter().toArray()), { timeout: 15000 })
        .toEqual([expect.closeTo(alvo[0], 2), expect.closeTo(alvo[1], 2)]);
});

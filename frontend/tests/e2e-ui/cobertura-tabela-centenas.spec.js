// Path: e2e-ui/cobertura-tabela-centenas.spec.js

/**
 * @fileoverview A TABELA DE ATRIBUTOS COM CENTENAS DE LINHAS, num atlas LOCAL, pela interface.
 *
 * O que já existia (`attribute-table.spec.js`) usa três pontos desenhados à mão e mede abrir,
 * ordenar pelo Nome, a busca pelo nome e um chip de tipo. Aqui a camada vem de um ARQUIVO (300
 * pontos em GeoJSON, soltos no mapa como a pessoa faz), com as colunas que um arquivo real traz:
 * número, texto com acento, código com zero à esquerda e uma coluna `id`, que é reservada e chega
 * como `id_importado`. Cobre:
 *
 *   - abrir: a contagem e as colunas importadas, o tempo de abrir (registrado, não afirmado);
 *   - ordenar por um atributo NUMÉRICO (ordem natural: 2 antes de 10) e o terceiro clique;
 *   - buscar por valor de atributo e por acento;
 *   - editar uma célula de ATRIBUTO e uma de DESCRIÇÃO, lidas de volta da store;
 *   - marcar a linha seleciona a feição no mapa, e "Apenas selecionadas" filtra;
 *   - exportar CSV: cabeçalho, uma linha por feição filtrada, BOM, e o "007" intacto;
 *   - F5: a ordenação guardada volta ao reabrir.
 */

import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readState } from './state.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

const TOTAL = 300;
const SETORES = ['Área Norte', 'Área Sul', 'Centro'];

/** O arquivo: 300 pontos com as colunas de um arquivo de verdade. */
function geojson() {
    const features = [];
    for (let i = 1; i <= TOTAL; i++) {
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-53.5 + (i % 20) * 0.01, -30.1 + Math.floor(i / 20) * 0.01] },
            properties: {
                nome: `Ponto ${String(i).padStart(3, '0')}`,
                Cota: (i * 7) % 1000,
                Setor: SETORES[i % 3],
                codigo: String(i % 10).padStart(3, '0'),
                id: `externo-${i}`,
            },
        });
    }
    return Buffer.from(JSON.stringify({ type: 'FeatureCollection', features }), 'utf8');
}

async function abrirMapaLocal(page) {
    await page.goto('/');
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
}

/** Solta o arquivo no mapa, como o navegador faz num arrasto. */
async function soltarNoMapa(page, nome, buffer) {
    const r = await page.evaluate(async (e) => {
        const map = globalThis.__ebgeoMap;
        const container = map.getContainer();
        const rect = container.getBoundingClientRect();
        const corpo = Uint8Array.from(atob(e.base64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([corpo], e.nome, { type: 'application/geo+json' }));
        const evento = new DragEvent('drop', {
            dataTransfer: dt, clientX: Math.round(rect.left + rect.width / 2),
            clientY: Math.round(rect.top + rect.height / 2), bubbles: true, cancelable: true,
        });
        container.dispatchEvent(evento);
        return evento.dataTransfer?.files?.length ?? 0;
    }, { nome, base64: buffer.toString('base64') });
    expect(r, 'o arrasto não levou arquivo').toBe(1);
}

/** Os pontos da store, com o que a tabela mostra. */
function pontos(page) {
    return page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).map((p) => ({
            id: p.properties.id, nome: p.properties.nome, descricao: p.properties.descricao ?? '',
            layerId: p.properties.layerId, attributes: p.properties.attributes ?? {},
        }));
    });
}

const linhas = (page) => page.locator('.attribute-table-panel tr.attribute-table-row');

/** Abre a tabela da camada que recebeu a importação. */
async function abrirTabelaDaImportacao(page) {
    await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    const camada = await page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return f.points?.[0]?.properties?.layerId ?? null;
    });
    const botao = page.locator(`.layer-container[data-layer-id="${camada}"] .table-toggle`);
    const alvo = (await botao.count()) ? botao : page.locator('.table-toggle').first();
    const t0 = Date.now();
    await alvo.click();
    await expect(linhas(page)).toHaveCount(TOTAL, { timeout: 30000 });
    return Date.now() - t0;
}

/** O texto da célula de um atributo, por linha, na ordem desenhada. */
function colunaDesenhada(page, chave) {
    return page.locator(`.attribute-table-panel tr.attribute-table-row td[data-attr-key="${chave}"] .attribute-table-cell-value`)
        .allInnerTexts();
}

test('300 linhas importadas: abrir, ordenar, buscar, editar, selecionar, exportar e F5', async ({ page }) => {
    test.setTimeout(240000);
    await abrirMapaLocal(page);
    await soltarNoMapa(page, 'trezentos-pontos.geojson', geojson());
    await expect.poll(async () => (await pontos(page)).length, { timeout: 60000 }).toBe(TOTAL);
    const antes = await pontos(page);
    const amostra = antes.find((p) => p.nome === 'Ponto 010');
    expect(amostra.attributes, 'o arquivo chega como atributos, "007" intacto e id em id_importado')
        .toMatchObject({ Cota: '70', Setor: 'Área Sul', codigo: '000', id_importado: 'externo-10' });

    // ABRIR.
    const msAbrir = await abrirTabelaDaImportacao(page);
    process.stdout.write(`[tabela-300] abrir: ${msAbrir} ms\n`);
    await expect(page.locator('.attribute-table-count')).toContainText(String(TOTAL));
    for (const chave of ['Cota', 'Setor', 'codigo', 'id_importado']) {
        await expect(page.locator(`.attribute-table-panel th[data-column-key="${chave}"]`)).toHaveCount(1);
    }

    // ORDENAR por Cota: ordem NATURAL (numérica), depois decrescente, depois nenhuma.
    const cabecalhoCota = page.locator('.attribute-table-panel th[data-column-key="Cota"]');
    await cabecalhoCota.click();
    const asc = (await colunaDesenhada(page, 'Cota')).map(Number);
    expect(asc.slice(0, 5), 'a ordenação de Cota não é numérica').toEqual([...asc].sort((a, b) => a - b).slice(0, 5));
    expect(asc[0]).toBeLessThanOrEqual(asc[asc.length - 1]);
    await cabecalhoCota.click();
    const desc = (await colunaDesenhada(page, 'Cota')).map(Number);
    expect(desc[0]).toBe(Math.max(...desc));
    await cabecalhoCota.click();
    await expect(cabecalhoCota).not.toHaveAttribute('data-sort', /asc|desc/);

    // BUSCAR por valor de atributo, com acento.
    const busca = page.locator('.attribute-table-search-input');
    await busca.fill('Área Sul');
    await expect(linhas(page)).toHaveCount(TOTAL / 3, { timeout: 10000 });
    await expect(page.locator('.attribute-table-count')).toContainText(`${TOTAL / 3}`);
    await busca.fill('');
    await expect(linhas(page)).toHaveCount(TOTAL, { timeout: 10000 });

    // EDITAR uma célula de atributo e uma de descrição, da linha "Ponto 010".
    await busca.fill('Ponto 010');
    await expect(linhas(page)).toHaveCount(1, { timeout: 10000 });
    const linha = linhas(page).first();
    await linha.locator('td[data-attr-key="Setor"]').dblclick();
    await page.locator('.attribute-table-cell-input').fill('Área Leste');
    await page.locator('.attribute-table-cell-input').press('Enter');
    await linha.locator('td.attribute-table-cell-desc').dblclick();
    await page.locator('.attribute-table-cell-input').fill('Descrição pela tabela');
    await page.locator('.attribute-table-cell-input').press('Enter');
    await expect.poll(async () => (await pontos(page)).find((p) => p.id === amostra.id)?.attributes?.Setor,
        { timeout: 10000 }).toBe('Área Leste');
    await expect.poll(async () => (await pontos(page)).find((p) => p.id === amostra.id)?.descricao,
        { timeout: 10000 }).toBe('Descrição pela tabela');

    // SELECIONAR pela caixa da linha: a feição fica selecionada no mapa.
    await linha.locator('.attribute-table-row-checkbox').check();
    await expect.poll(() => page.evaluate(async () => {
        const { getStateManager } = await import('/src/js/store/index.js');
        return getStateManager().getSelectedFeatures().map((f) => f.id);
    }), { timeout: 10000 }).toEqual([amostra.id]);
    await busca.fill('');
    await page.locator('.attribute-table-selected-toggle input').check();
    await expect(linhas(page)).toHaveCount(1, { timeout: 10000 });
    await page.locator('.attribute-table-selected-toggle input').uncheck();
    await expect(linhas(page)).toHaveCount(TOTAL, { timeout: 10000 });

    // EXPORTAR CSV das linhas filtradas.
    await busca.fill('Centro');
    await expect(linhas(page)).toHaveCount(TOTAL / 3, { timeout: 10000 });
    const download = page.waitForEvent('download', { timeout: 15000 });
    await page.locator('.attribute-table-csv-export-btn').click();
    const caminho = await (await download).path();
    const csv = (await import('node:fs')).readFileSync(caminho, 'utf8');
    const linhasCsv = csv.replace(new RegExp('^' + String.fromCharCode(0xFEFF)), '').split('\n');
    expect(csv.charCodeAt(0), 'o CSV sem BOM abre errado no Excel').toBe(0xFEFF);
    expect(linhasCsv.length, 'uma linha por feição filtrada, mais o cabeçalho').toBe(TOTAL / 3 + 1);
    expect(linhasCsv[0]).toContain('Setor');
    expect(linhasCsv.some((l) => l.includes(',000,') || l.endsWith(',000') || l.includes('"000"')),
        'o código "000" perdeu os zeros no CSV').toBe(true);
    await busca.fill('');

    // F5: a ordenação guardada volta ao reabrir a tabela.
    await cabecalhoCota.click();
    await expect(cabecalhoCota).toHaveAttribute('data-sort', 'asc');
    await page.reload();
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
    await abrirTabelaDaImportacao(page);
    await expect(page.locator('.attribute-table-panel th[data-column-key="Cota"]'),
        'a ordenação não voltou depois do F5').toHaveAttribute('data-sort', 'asc');
    const depois = await pontos(page);
    expect(depois.find((p) => p.id === amostra.id)?.attributes?.Setor).toBe('Área Leste');
});

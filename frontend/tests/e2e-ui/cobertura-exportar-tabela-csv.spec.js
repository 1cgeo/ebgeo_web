// Path: e2e-ui/cobertura-exportar-tabela-csv.spec.js

/**
 * COVERAGE: the attribute table's "Exportar CSV", read by CONTENT, in real Chromium. Part of the
 * 2026-09-24 coverage campaign (import/export).
 *
 * The file is the table the person sees, so every column on the screen must be in it: Tipo, Nome,
 * Descrição and every attribute, with accents, commas, quotes and line breaks intact (RFC 4180
 * quoting), and the UTF-8 BOM that makes Excel read the accents. The export is of the FILTERED
 * rows (`_filteredFeatures`), so a search narrows the file too.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;
const ALVO = [-53.4, -30.0];

async function esperarMapa(page) {
    await page.goto('/');
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 30000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

async function soltarNoMapa(page, nome, buffer) {
    await page.evaluate(async (e) => {
        const map = globalThis.__ebgeoMap;
        const container = map.getContainer();
        const rect = container.getBoundingClientRect();
        const pt = map.project(e.lngLat);
        const corpo = Uint8Array.from(atob(e.base64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([corpo], e.nome, { type: 'application/octet-stream' }));
        container.dispatchEvent(new DragEvent('drop', {
            dataTransfer: dt, clientX: Math.round(rect.left + pt.x), clientY: Math.round(rect.top + pt.y),
            bubbles: true, cancelable: true,
        }));
    }, { lngLat: ALVO, nome, base64: buffer.toString('base64') });
}

/** A minimal RFC 4180 reader: quoted fields, doubled quotes, commas and newlines inside quotes. */
function lerCsv(texto) {
    const linhas = [];
    let linha = [];
    let campo = '';
    let aspas = false;
    for (let i = 0; i < texto.length; i++) {
        const c = texto[i];
        if (aspas) {
            if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') {aspas = false;} else {campo += c;}
        } else if (c === '"') {aspas = true;} else if (c === ',') { linha.push(campo); campo = ''; } else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; } else if (c !== '\r') {campo += c;}
    }
    if (campo !== '' || linha.length > 0) { linha.push(campo); linhas.push(linha); }
    return linhas;
}

const PONTOS = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', properties: { nome: 'Posto São João', descricao: 'Água, luz e "rádio"\nsegunda linha', 'Município': 'Florianópolis' },
            geometry: { type: 'Point', coordinates: [-53.5, -30.1] } },
        { type: 'Feature', properties: { nome: 'Base Ação', descricao: 'Área de apoio', 'Município': 'Brasília' },
            geometry: { type: 'Point', coordinates: [-53.45, -30.05] } },
    ],
};

describeOrSkip('Cobertura: exportar a tabela de atributos em CSV', () => {
    test.describe.configure({ retries: 0 });

    test('o CSV tem todas as colunas da tabela, com acentos, aspas e quebras de linha', async ({ page }) => {
        await esperarMapa(page);
        await soltarNoMapa(page, 'postos.geojson', B.from(JSON.stringify(PONTOS), 'utf8'));
        await expect(page.locator('.toast', { hasText: 'importad' }).first()).toBeAttached({ timeout: 15000 });

        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
        const camada = page.locator('.layer-container', { hasText: 'postos' });
        await expect(camada).toBeVisible({ timeout: 10000 });
        await camada.locator('.table-toggle').click();
        const painel = page.locator('.attribute-table-panel');
        await expect(painel.locator('tr.attribute-table-row')).toHaveCount(2, { timeout: 10000 });
        const cabecalhoNaTela = (await painel.locator('th').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
        console.log('[cabeçalho na tela]', JSON.stringify(cabecalhoNaTela));

        const baixando = page.waitForEvent('download', { timeout: 15000 });
        await painel.locator('[title="Exportar CSV"]').click();
        const arquivo = await baixando;
        const bytes = readFileSync(await arquivo.path());
        const texto = bytes.toString('utf8');
        console.log('[csv]', JSON.stringify(texto));

        expect(bytes.subarray(0, 3).equals(B.from([0xef, 0xbb, 0xbf])), 'BOM UTF-8 para o Excel').toBe(true);
        const [cabecalho, ...linhas] = lerCsv(texto.slice(1));
        expect(cabecalho).toEqual(['Tipo', 'Nome', 'Descrição', 'Município']);
        const porNome = Object.fromEntries(linhas.map((l) => [l[1], l]));
        expect(porNome['Posto São João'][2]).toBe('Água, luz e "rádio"\nsegunda linha');
        expect(porNome['Posto São João'][3]).toBe('Florianópolis');
        expect(porNome['Base Ação'][2]).toBe('Área de apoio');
        expect(porNome['Base Ação'][3]).toBe('Brasília');
        for (const l of linhas) expect(l, 'toda linha tem as quatro colunas').toHaveLength(4);
    });
});

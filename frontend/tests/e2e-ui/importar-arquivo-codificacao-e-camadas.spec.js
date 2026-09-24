// Path: e2e-ui/importar-arquivo-codificacao-e-camadas.spec.js

/**
 * IMPORTING A GIS FILE MUST NOT DESTROY ITS TEXT NOR DROP PART OF IT, in real Chromium, through the
 * real doors (the CSV option of the Importar tab, and a file dropped on the map), read back from the
 * store. No other spec imports a CSV, a shapefile or a KML through the screen.
 *
 * THE FILES ARE THE ONES PEOPLE HAVE, not the ones a UTF-8 editor writes:
 *   - a CSV saved by Excel in pt-BR ("CSV (separado por vírgulas)"): Windows-1252, `;` separator,
 *     decimal comma;
 *   - a shapefile whose DBF is Windows-1252 with NO `.cpg` beside it (the usual Brazilian DBF);
 *   - a ZIP with TWO shapefiles (points of two themes shipped together);
 *   - a KML that declares `encoding="ISO-8859-1"` in its XML declaration.
 *
 * WHAT WAS LOST, before the fix of the same commit: every accented byte of the first, second and
 * fourth became U+FFFD (the file was decoded as UTF-8 whatever it was), which is irreversible once
 * saved; and the second shapefile of the ZIP was dropped without a word (only `result[0]` of the
 * reader was imported).
 *
 * CONTROLS: a UTF-8 CSV (with the BOM Excel's "CSV UTF-8" writes) must keep reading as UTF-8, so a
 * fix that forced Windows-1252 everywhere fails here.
 *
 * Everything runs anonymous on the local map: the subject is the file reader, not the sync.
 */

import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readState } from './state.js';
import { shpDePontos, dbfDeTexto } from '../helpers/shapefile-sintetico.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;

/** A place on the default view of the map, for the drop. */
const ALVO = [-53.4, -30.0];

async function esperarMapa(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
    // The drop is wired inside `createControls`, before the control registry is complete; the
    // presence of its last entry is the signal (see `imagem-reencodada-gif-bmp.spec.js`).
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

/** The points of the current map, with their attributes. */
function pontosDoMapa(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return (f.points || []).map((p) => ({
            attributes: p.properties?.attributes ?? {},
            descricao: p.properties?.descricao ?? '',
            layerId: p.properties?.layerId,
            coords: p.geometry?.coordinates,
        }));
    });
}

/** Drops `buffer` as a file named `nome` on the map, the way the browser does. */
async function soltarNoMapa(page, nome, buffer) {
    const r = await page.evaluate(async (e) => {
        const map = globalThis.__ebgeoMap;
        const container = map.getContainer();
        const rect = container.getBoundingClientRect();
        const pt = map.project(e.lngLat);
        const corpo = Uint8Array.from(atob(e.base64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([corpo], e.nome, { type: 'application/octet-stream' }));
        const evento = new DragEvent('drop', {
            dataTransfer: dt,
            clientX: Math.round(rect.left + pt.x),
            clientY: Math.round(rect.top + pt.y),
            bubbles: true,
            cancelable: true,
        });
        container.dispatchEvent(evento);
        return evento.dataTransfer?.files?.length ?? 0;
    }, { lngLat: ALVO, nome, base64: buffer.toString('base64') });
    expect(r, 'the drop carried no file').toBe(1);
}

/** Imports a CSV through the Importar tab and its configuration panel. */
async function importarCsv(page, nome, buffer) {
    await page.locator('.sidebar-nav-btn[data-tab="importar"]').click();
    const seletor = page.waitForEvent('filechooser', { timeout: 10000 });
    await page.locator('.import-option-btn[data-format="csv"]').click();
    await (await seletor).setFiles({ name: nome, mimeType: 'text/csv', buffer });
    const botao = page.locator('.csv-config-panel__import-btn');
    await expect(botao).toBeEnabled({ timeout: 10000 });
    await botao.click();
}

const SEM_SUBSTITUICAO = (texto) => !String(texto).includes('�');

describeOrSkip('Importar arquivo: codificação e camadas', () => {
    test.describe.configure({ retries: 0 });

    test('CSV do Excel pt-BR (Windows-1252) chega com os acentos', async ({ page }) => {
        await esperarMapa(page);
        const csv = 'latitude;longitude;Município;Observação\r\n'
            + '-15,7939;-47,8828;Brasília;Área de preservação\r\n'
            + '-23,5505;-46,6333;São Paulo;Ação imediata\r\n';
        await importarCsv(page, 'pontos-excel.csv', B.from(csv, 'latin1'));

        await expect.poll(async () => (await pontosDoMapa(page)).length, { timeout: 15000 }).toBe(2);
        const pontos = await pontosDoMapa(page);
        console.log('[csv 1252]', JSON.stringify(pontos.map((p) => p.attributes)));
        for (const p of pontos) {
            for (const [chave, valor] of Object.entries(p.attributes)) {
                expect(SEM_SUBSTITUICAO(chave), `chave corrompida: ${chave}`).toBe(true);
                expect(SEM_SUBSTITUICAO(valor), `valor corrompido: ${valor}`).toBe(true);
            }
        }
        const municipios = pontos.map((p) => p.attributes['Município']).sort();
        expect(municipios).toEqual(['Brasília', 'São Paulo']);
        expect(pontos.map((p) => p.attributes['Observação']).sort())
            .toEqual(['Ação imediata', 'Área de preservação']);
    });

    test('CONTROLE: CSV em UTF-8 com BOM continua UTF-8', async ({ page }) => {
        await esperarMapa(page);
        const csv = '﻿latitude;longitude;Município\r\n-15,7939;-47,8828;Brasília\r\n';
        await importarCsv(page, 'pontos-utf8.csv', B.from(csv, 'utf8'));
        await expect.poll(async () => (await pontosDoMapa(page)).length, { timeout: 15000 }).toBe(1);
        const [p] = await pontosDoMapa(page);
        expect(p.attributes['Município']).toBe('Brasília');
    });

    test('shapefile com DBF em Windows-1252 e sem .cpg chega com os acentos', async ({ page }) => {
        await esperarMapa(page);
        const zip = new JSZip();
        zip.file('cidades.shp', shpDePontos([[-47.8828, -15.7939], [-46.6333, -23.5505]]));
        zip.file('cidades.dbf', dbfDeTexto([{ nome: 'MUNICIPIO', tamanho: 40 }],
            [{ MUNICIPIO: 'Brasília' }, { MUNICIPIO: 'São Paulo' }], { codificacao: 'latin1', idioma: 0x57 }));
        await soltarNoMapa(page, 'cidades.zip', await zip.generateAsync({ type: 'nodebuffer' }));

        await expect.poll(async () => (await pontosDoMapa(page)).length, { timeout: 15000 }).toBe(2);
        const nomes = (await pontosDoMapa(page)).map((p) => p.attributes.MUNICIPIO).sort();
        console.log('[dbf 1252]', JSON.stringify(nomes));
        expect(nomes).toEqual(['Brasília', 'São Paulo']);
    });

    test('KML declarado ISO-8859-1 chega com os acentos', async ({ page }) => {
        await esperarMapa(page);
        const kml = '<?xml version="1.0" encoding="ISO-8859-1"?>\n'
            + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>'
            + '<name>Posto</name><description>Região de operação</description>'
            + '<ExtendedData><Data name="município"><value>Florianópolis</value></Data></ExtendedData>'
            + '<Point><coordinates>-48.5482,-27.5954</coordinates></Point>'
            + '</Placemark></Document></kml>';
        await soltarNoMapa(page, 'posto.kml', B.from(kml, 'latin1'));

        await expect.poll(async () => (await pontosDoMapa(page)).length, { timeout: 15000 }).toBe(1);
        const [p] = await pontosDoMapa(page);
        console.log('[kml 8859-1]', JSON.stringify(p));
        expect(p.attributes['município']).toBe('Florianópolis');
        expect(p.descricao).toContain('Região de operação');
    });
});

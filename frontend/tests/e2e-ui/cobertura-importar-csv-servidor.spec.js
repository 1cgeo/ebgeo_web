// Path: e2e-ui/cobertura-importar-csv-servidor.spec.js

/**
 * COVERAGE: a CSV imported through the Importar tab into a SERVER atlas reaches the colleague, and
 * both still have it after an F5. Part of the 2026-09-24 coverage campaign (import/export).
 *
 * The CSV path is its own pipeline (`import_export/csv/`: parser, config panel, `csv-to-geojson`),
 * separate from the drop path of GeoJSON/KML/SHP, and until now it was measured only in a local
 * atlas. Here the author imports an Excel pt-BR style file (decimal comma, `;`, accents in names,
 * keys and values) and the assertion is by id, field by field, three times: the colleague live, the
 * colleague after F5 (the server snapshot) and the author after F5 (the author's own store plus the
 * snapshot).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;

const CSV = 'nome;latitude;longitude;Município;Observação;Efetivo\n'
    + 'Posto Ação;-22,9068;-43,1729;Rio de Janeiro;Água potável;12\n'
    + 'Base São João;-22,95;-43,21;Niterói;"Ponto; com separador";7\n'
    + 'Área Três;-22,8;-43,3;Duque de Caxias;;0\n';

function pontos(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return ((await store.getCurrentMapFeatures()).points || [])
            .map((p) => ({ id: p.properties?.id, nome: p.properties?.nome, attributes: p.properties?.attributes ?? {}, coords: p.geometry?.coordinates }))
            .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    });
}

async function esperarPronto(page) {
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 30000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

async function importarCsv(page, nome, texto) {
    await page.locator('.sidebar-nav-btn[data-tab="importar"]').click();
    const seletor = page.waitForEvent('filechooser', { timeout: 10000 });
    await page.locator('.import-option-btn[data-format="csv"]').click();
    await (await seletor).setFiles({ name: nome, mimeType: 'text/csv', buffer: B.from(texto, 'utf8') });
    const botao = page.locator('.csv-config-panel__import-btn');
    await expect(botao).toBeEnabled({ timeout: 10000 });
    await botao.click();
}

describeOrSkip('Cobertura: CSV num atlas de servidor', () => {
    test.describe.configure({ retries: 0 });

    test('o colega recebe os pontos do CSV campo a campo, e os dois os mantêm depois do F5', async ({ browser }) => {
        test.setTimeout(240000);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const autor = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA, { expectMapName: seed.mapName });
        const par = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB, { expectMapName: seed.mapName });
        await esperarPronto(autor);
        await esperarPronto(par);

        await importarCsv(autor, 'postos.csv', CSV);
        await expect.poll(async () => (await pontos(autor)).length, { timeout: 20000 }).toBe(3);
        const doAutor = await pontos(autor);
        console.log('[autor]', JSON.stringify(doAutor));

        // ABSOLUTE on the author's side, so two equally broken readings cannot agree.
        const posto = doAutor.find((p) => p.nome === 'Posto Ação');
        expect(posto?.coords).toEqual([-43.1729, -22.9068]);
        expect(posto.attributes).toMatchObject({ 'Município': 'Rio de Janeiro', 'Observação': 'Água potável' });
        expect(doAutor.find((p) => p.nome === 'Base São João')?.attributes['Observação']).toBe('Ponto; com separador');

        const conferir = async (page, rotulo) => {
            await expect.poll(async () => (await pontos(page)).length, { timeout: 30000 }).toBe(3);
            const lidos = await pontos(page);
            for (const a of doAutor) {
                const b = lidos.find((x) => x.id === a.id);
                expect(b, `${rotulo}: ${a.nome} pelo mesmo id`).toBeTruthy();
                expect(b.nome, `${rotulo}: ${a.nome} nome`).toBe(a.nome);
                expect(b.coords, `${rotulo}: ${a.nome} posição`).toEqual(a.coords);
                expect(b.attributes, `${rotulo}: ${a.nome} atributos`).toEqual(a.attributes);
            }
        };
        await conferir(par, 'colega ao vivo');

        // F5 on both. The address bar carries the atlas, so the reload reopens it.
        for (const [page, rotulo] of [[par, 'colega depois do F5'], [autor, 'autor depois do F5']]) {
            await page.reload();
            await esperarPronto(page);
            await conferir(page, rotulo);
        }

        await autor.context().close();
        await par.context().close();
    });
});

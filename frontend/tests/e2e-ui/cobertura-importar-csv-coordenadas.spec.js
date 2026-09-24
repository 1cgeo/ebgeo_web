// Path: e2e-ui/cobertura-importar-csv-coordenadas.spec.js

/**
 * COVERAGE: the CSV import through the Importar tab in the three coordinate formats that are not
 * decimal degrees (GMS, UTM with a fixed zone, MGRS), with the POSITION checked in the store. Part of
 * the 2026-09-24 coverage campaign (import/export).
 *
 * `importar-arquivo-codificacao-e-camadas.spec.js` drives the panel with decimal degrees and checks
 * the accents; `csv-import.test.js` checks the converter in node. What neither does is the path in
 * between: choose the format in the panel, let it map the columns by their names, import, and read
 * where the points landed.
 *
 * The references are computed here, not by the product: GMS by hand, UTM with `proj4` and MGRS with
 * `mgrs`, the same libraries the converter uses, so this measures the plumbing (format select,
 * column mapping, zone, conversion call, store) and not the libraries themselves.
 */

import { test, expect } from '@playwright/test';
import proj4 from 'proj4';
import mgrsModulo from 'mgrs';
import { readState } from './state.js';

// `mgrs` is CommonJS: under node ESM its API is the default export.
const mgrs = mgrsModulo.default ?? mgrsModulo;

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;

/** Two places in zone 23 south, with their accented names. */
const LUGARES = [
    { nome: 'Cristo Redentor', lat: -22.951916, lon: -43.210487 },
    { nome: 'Praça dos Três Poderes', lat: -22.8, lon: -43.9 },
];

async function esperarMapa(page) {
    await page.goto('/');
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 30000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

function pontos(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return ((await store.getCurrentMapFeatures()).points || []).map((p) => ({ nome: p.properties?.nome, attributes: p.properties?.attributes ?? {}, coords: p.geometry?.coordinates }));
    });
}

/** Opens the CSV panel with the file, chooses the format, and lets `ajustar` finish the setup. */
async function importarCsv(page, nome, texto, formato, ajustar = async () => {}) {
    await page.locator('.sidebar-nav-btn[data-tab="importar"]').click();
    const seletor = page.waitForEvent('filechooser', { timeout: 10000 });
    await page.locator('.import-option-btn[data-format="csv"]').click();
    await (await seletor).setFiles({ name: nome, mimeType: 'text/csv', buffer: B.from(texto, 'utf8') });
    const painel = page.locator('.csv-config-panel');
    await expect(painel).toBeVisible({ timeout: 10000 });
    await painel.locator('.attr-modern-select', { hasText: 'Formato' }).locator('select').selectOption(formato);
    await ajustar(painel);
    const botao = painel.locator('.csv-config-panel__import-btn');
    await expect(botao).toBeEnabled({ timeout: 10000 });
    await botao.click();
}

/**
 * Degrees to GMS text. Split from the ROUNDED total of milliseconds of arc: splitting the float
 * first turns 43.9 into 43°53'60.000", which is not a coordinate (and the converter rightly
 * refuses it).
 */
function gms(valor, positivo, negativo) {
    const total = Math.round(Math.abs(valor) * 3600 * 1000);
    const g = Math.floor(total / 3600000);
    const m = Math.floor((total - g * 3600000) / 60000);
    const s = (total - g * 3600000 - m * 60000) / 1000;
    return { texto: `${g}°${m}'${s.toFixed(3)}"${valor < 0 ? negativo : positivo}`, valor: Math.sign(valor) * (g + m / 60 + s / 3600) };
}

async function conferir(page, esperados, tolerancia) {
    await expect.poll(async () => (await pontos(page)).length, { timeout: 15000 }).toBe(esperados.length);
    const lidos = await pontos(page);
    console.log('[pontos]', JSON.stringify(lidos.map((p) => [p.nome, p.coords])));
    for (const e of esperados) {
        const p = lidos.find((x) => x.nome === e.nome);
        expect(p, `${e.nome} importado com o nome`).toBeTruthy();
        expect(Math.abs(p.coords[0] - e.lon), `${e.nome}: longitude`).toBeLessThan(tolerancia);
        expect(Math.abs(p.coords[1] - e.lat), `${e.nome}: latitude`).toBeLessThan(tolerancia);
    }
    return lidos;
}

describeOrSkip('Cobertura: CSV pela aba Importar em GMS, UTM e MGRS', () => {
    test.describe.configure({ retries: 0 });

    test('GMS: graus, minutos e segundos com hemisfério', async ({ page }) => {
        await esperarMapa(page);
        const linhas = LUGARES.map((l) => ({ nome: l.nome, lat: gms(l.lat, 'N', 'S'), lon: gms(l.lon, 'E', 'W') }));
        const csv = 'nome;lat;lon;Observação\n' + linhas.map((l) => `${l.nome};${l.lat.texto};${l.lon.texto};ponto notável`).join('\n') + '\n';
        await importarCsv(page, 'gms.csv', csv, 'latlong_dms');
        const lidos = await conferir(page, linhas.map((l) => ({ nome: l.nome, lat: l.lat.valor, lon: l.lon.valor })), 1e-6);
        expect(lidos[0].attributes['Observação']).toBe('ponto notável');
    });

    test('UTM com zona fixa 23S', async ({ page }) => {
        await esperarMapa(page);
        const utm = '+proj=utm +zone=23 +south +datum=WGS84 +units=m +no_defs';
        const linhas = LUGARES.map((l) => { const [e, n] = proj4('WGS84', utm, [l.lon, l.lat]); return { ...l, e: e.toFixed(2), n: n.toFixed(2) }; });
        const csv = 'nome;leste;norte\n' + linhas.map((l) => `${l.nome};${l.e};${l.n}`).join('\n') + '\n';
        await importarCsv(page, 'utm.csv', csv, 'utm', async (painel) => {
            await painel.locator('.csv-config-panel__zone-input').fill('23S');
        });
        // 1e-6 degree is about 0.1 m; the easting/northing were written with centimetres.
        await conferir(page, linhas, 1e-6);
    });

    test('MGRS com precisão de 1 m', async ({ page }) => {
        await esperarMapa(page);
        const linhas = LUGARES.map((l) => ({ ...l, grade: mgrs.forward([l.lon, l.lat], 5) }));
        const csv = 'nome;mgrs\n' + linhas.map((l) => `${l.nome};${l.grade}`).join('\n') + '\n';
        await importarCsv(page, 'mgrs.csv', csv, 'mgrs');
        // An MGRS cell of 1 m: the point lands in it, within about 1.5 m of the original.
        const esperados = linhas.map((l) => { const [lon, lat] = mgrs.toPoint(l.grade); return { nome: l.nome, lat, lon }; });
        const lidos = await conferir(page, esperados, 2e-5);
        console.log('[mgrs]', JSON.stringify(linhas.map((l) => l.grade)), JSON.stringify(lidos.map((p) => p.coords)));
    });
});

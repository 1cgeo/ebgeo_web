// Path: e2e-ui/cobertura-exportar-kmz-tipos.spec.js

/**
 * COVERAGE: "Exportar KMZ" of EVERY map of a real archive, read by CONTENT, in real Chromium. Part
 * of the 2026-09-24 coverage campaign (import/export).
 *
 * `kmz-ida-e-volta-campo-a-campo.spec.js` opens the KMZ for a point, a line and a polygon; the
 * other types were only covered by unit tests of the mapper, which never see the store, the image
 * repository or the symbol generators of a real page. Here `03-completo-2.4.ebgeo` (14 maps, 805
 * features of 19 types) enters through the atlas screen and each of its maps is exported by the
 * button, one at a time, through the map picker of the panel. For each file:
 *
 * - `doc.kml` carries one `<Placemark>` or `<GroundOverlay>` per feature of the map, minus the two
 *   types the exporter declares it skips (`los`, `visibility`: `SKIPPED_TYPES` in
 *   `import_export/kmz/kmz-export.service.js`). The mapper swallows a feature that throws ("one bad
 *   feature must not abort the whole export") and the success toast counts only what came out, so
 *   a type that stopped exporting would pass every other check: the count against the STORE is the
 *   only thing that sees it.
 * - every `<href>` of the document names a file that exists in the archive;
 * - every Placemark with a polygon has a PolyStyle: without one, KML's default fill is opaque
 *   WHITE, which is how a viewshed came out until 2026-09-24 (`processed_visibility` fell through
 *   to plain linework in `kmz-feature-types.js`);
 * - the success toast states the same number the file carries.
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const FIXTURE = fileURLToPath(new URL('../fixtures/ebgeo-2.2/03-completo-2.4.ebgeo', import.meta.url));
const MAPAS = 14;
const PULADOS = new Set(['los', 'visibility']);

async function importarPelaTela(page, arquivo) {
    await page.goto('/atlas.html');
    await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(arquivo);
    await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await expect(page.locator('.toast', { hasText: `${MAPAS} mapas carregados.` })).toBeVisible({ timeout: 120000 });
}

/** Per map: how many features of each type the REPOSITORY holds. */
function tiposPorMapa(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const out = {};
        for (const nome of await store.getAllMapNamesStore()) {
            const doc = await store.getMapData(nome);
            const tipos = {};
            for (const [balde, lista] of Object.entries(doc?.features ?? {})) {
                if (!Array.isArray(lista)) continue;
                const tipo = store.getSourceTypeFromStorage(balde);
                for (const f of lista) {
                    if (f?.properties?.deleted) continue;
                    tipos[tipo] = (tipos[tipo] ?? 0) + 1;
                }
            }
            out[nome] = tipos;
        }
        return out;
    });
}

describeOrSkip('Cobertura: exportar KMZ de todo mapa, todo tipo', () => {
    test.describe.configure({ retries: 0 });

    test('cada mapa sai com uma entrada por feição exportável e todo href resolve', async ({ page }) => {
        test.setTimeout(600000);
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await importarPelaTela(page, FIXTURE);
        const porMapa = await tiposPorMapa(page);
        const total = Object.values(porMapa).reduce((s, t) => s + Object.values(t).reduce((a, b) => a + b, 0), 0);
        expect(total, 'o arquivo declara 805 feições').toBe(805);

        await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
        await page.locator('#export-option-kmz').click();
        const seletor = page.locator('#kmz-map-select');
        await expect(seletor).toBeVisible({ timeout: 10000 });

        const resultado = {};
        for (const [mapa, tipos] of Object.entries(porMapa)) {
            const esperado = Object.entries(tipos).filter(([t]) => !PULADOS.has(t)).reduce((s, [, n]) => s + n, 0);
            if (esperado === 0) { resultado[mapa] = { esperado, pulado: 'mapa sem feição exportável' }; continue; }
            await seletor.selectOption(mapa);
            const baixando = page.waitForEvent('download', { timeout: 120000 });
            await page.locator('.kmz-export-btn').click();
            const arquivo = await baixando;
            const zip = await JSZip.loadAsync(readFileSync(await arquivo.path()));
            const kml = await zip.file('doc.kml').async('string');
            const entradas = (kml.match(/<Placemark[\s>]/g) ?? []).length + (kml.match(/<GroundOverlay[\s>]/g) ?? []).length;
            const hrefs = [...kml.matchAll(/<href>([^<]+)<\/href>/g)].map((m) => m[1].trim());
            const quebrados = [...new Set(hrefs)].filter((h) => !/^https?:/.test(h) && !zip.file(h));
            // A polygon whose style has no PolyStyle takes KML's default one, opaque WHITE.
            const estilos = Object.fromEntries([...kml.matchAll(/<Style id="([^"]+)">([\s\S]*?)<\/Style>/g)].map((m) => [m[1], m[2]]));
            const semPreenchimento = [...kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)]
                .map((m) => m[1]).filter((p) => p.includes('<Polygon'))
                .filter((p) => !(estilos[(/<styleUrl>#([^<]+)</.exec(p) || [])[1]] ?? '').includes('<PolyStyle>'))
                .map((p) => (/<name>([^<]*)<\/name>/.exec(p) || [])[1]);
            const toast = page.locator('.toast', { hasText: /KMZ exportado com \d+ feições/ }).last();
            await expect(toast).toBeAttached({ timeout: 15000 });
            const noAviso = Number(/(\d+) feições/.exec(await toast.innerText())[1]);
            resultado[mapa] = { tipos, esperado, entradas, noAviso, quebrados, semPreenchimento };
            // The toasts pile up; the next map's toast must be a new one.
            await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
        }
        console.log('[kmz por mapa]', JSON.stringify(resultado, null, 1));

        const divergentes = Object.entries(resultado).filter(([, r]) => !r.pulado && (r.entradas !== r.esperado || r.noAviso !== r.entradas || r.quebrados.length > 0 || r.semPreenchimento.length > 0));
        expect(divergentes, 'todo mapa sai inteiro, com o aviso certo e sem href quebrado').toEqual([]);
        expect(Object.values(resultado).filter((r) => !r.pulado).length, 'pelo menos um mapa exportado').toBeGreaterThan(0);
    });
});

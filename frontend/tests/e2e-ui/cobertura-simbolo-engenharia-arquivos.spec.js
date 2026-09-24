// Path: e2e-ui/cobertura-simbolo-engenharia-arquivos.spec.js

/**
 * COVERAGE: the ENGINEERING SYMBOL through the two vector exports, `.ebgeo` and KMZ, read by
 * CONTENT, in real Chromium. Part of the 2026-09-24 coverage campaign (import/export).
 *
 * It is the one product type that neither real archive of `tests/fixtures/ebgeo-2.2/` carries (the
 * other line of the product did not have it), so `cobertura-ebgeo-campo-a-campo.spec.js` and
 * `cobertura-exportar-kmz-tipos.spec.js` could not reach it. Here it is DRAWN with the toolbar tool
 * and configured through its dialog (bridge class 95), then:
 *
 * - `.ebgeo`: the feature in the file has every property and the geometry of the stored one; after
 *   the file enters as a new local atlas it comes back identical, and its raster is REGENERATED
 *   on the map (the bitmap never travels: `layers/image-regen-registry.js`);
 * - KMZ: the map exports one Placemark for it, whose icon is a PNG present in the archive.
 */

import { test, expect } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import JSZip from 'jszip';
import { readState } from './state.js';
import { selectFeatureUI } from './helpers/collab-helpers.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;
let dirTemporario = null;

async function esperarMapa(page) {
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 30000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

/** The engineering symbols of the current map, from the repository. */
function simbolos(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const doc = await store.getMapData(await store.getCurrentMapName?.() ?? undefined);
        return (doc?.features?.engineering_symbols ?? []).map((f) => ({ properties: f.properties, geometry: f.geometry }));
    });
}

function raster(page, id) {
    return page.evaluate((fid) => {
        const image = globalThis.__ebgeoMap?.getImage(fid);
        const bitmap = image?.data ?? image;
        return bitmap?.width ? { w: bitmap.width, h: bitmap.height } : null;
    }, id);
}

/**
 * The exporter rounds GEOMETRY coordinates to 6 decimals, about 0.1 m, on purpose and declared
 * (`roundCoordinates`, `import_export/export-import.service.js`); a tool-drawn point has 14. The
 * comparison applies the same rule to both sides, so the rounding is not read as a loss and
 * anything beyond it still is.
 */
function arredondar(geometry) {
    const r = (c) => (Array.isArray(c) ? c.map(r) : (Number.isFinite(c) ? Math.round(c * 1e6) / 1e6 : c));
    return geometry ? { ...geometry, coordinates: r(geometry.coordinates) } : geometry;
}

function camposDiferentes(a, b) {
    const campos = new Set([...Object.keys(a.properties), ...Object.keys(b.properties)]);
    const out = [...campos].filter((c) => !isDeepStrictEqual(a.properties[c], b.properties[c]))
        .map((c) => `${c}: ${JSON.stringify(a.properties[c])?.slice(0, 60)} -> ${JSON.stringify(b.properties[c])?.slice(0, 60)}`);
    if (!isDeepStrictEqual(arredondar(a.geometry), arredondar(b.geometry))) out.push('(geometria)');
    return out;
}

describeOrSkip('Cobertura: símbolo de engenharia no .ebgeo e no KMZ', () => {
    test.describe.configure({ retries: 0 });

    test.afterAll(async () => {
        if (dirTemporario) await rm(dirTemporario, { recursive: true, force: true });
        dirTemporario = null;
    });

    test('desenhado e configurado, ele sai inteiro nos dois arquivos e volta regenerado', async ({ page }) => {
        test.setTimeout(300000);
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await esperarMapa(page);

        await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
        await page.locator('.toolbar-tool-btn[data-tool-id="engineeringSymbol"]').click();
        await esperarFerramentaPronta(page, 'engineeringSymbol');
        await page.locator('#map-sig .maplibregl-canvas').click({ position: { x: 630, y: 340 } });
        await expect.poll(async () => (await simbolos(page)).length, { timeout: 15000 }).toBe(1);
        const id = (await simbolos(page))[0].properties.id;
        await page.keyboard.press('Escape');

        await selectFeatureUI(page, id);
        await page.getByRole('button', { name: 'Configurar Símbolo', exact: true }).click();
        const dialogo = page.locator('.point-selector-modal-container');
        await dialogo.locator('.coord-text-field').filter({ hasText: 'Classe da ponte' }).locator('input').fill('95');
        await dialogo.locator('.point-selector-btn-apply').click();
        await expect(dialogo).not.toBeVisible();
        await expect.poll(async () => (await simbolos(page))[0].properties.engineering?.values?.class).toBe('95');
        await page.keyboard.press('Escape');
        const [antes] = await simbolos(page);
        console.log('[antes]', JSON.stringify(antes).slice(0, 600));

        // ---- KMZ ----
        await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
        await page.locator('#export-option-kmz').click();
        await expect(page.locator('#kmz-map-select')).toBeVisible({ timeout: 10000 });
        const baixandoKmz = page.waitForEvent('download', { timeout: 60000 });
        await page.locator('.kmz-export-btn').click();
        const kmz = await JSZip.loadAsync(await readFile(await (await baixandoKmz).path()));
        const kml = await kmz.file('doc.kml').async('string');
        const placemarks = kml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) ?? [];
        const hrefs = [...kml.matchAll(/<href>([^<]+)<\/href>/g)].map((m) => m[1].trim());
        console.log('[kmz]', JSON.stringify({ placemarks: placemarks.length, hrefs }));
        expect(placemarks, 'um Placemark para o símbolo').toHaveLength(1);
        expect(hrefs.length, 'o símbolo tem ícone').toBeGreaterThan(0);
        for (const h of hrefs) {
            const png = await kmz.file(h)?.async('nodebuffer');
            expect(png, `${h} está no KMZ`).toBeTruthy();
            expect(png.subarray(0, 4).equals(B.from([0x89, 0x50, 0x4e, 0x47])), `${h} é PNG`).toBe(true);
        }

        // ---- .ebgeo ----
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await expect(page.locator('.maps-tab .map-list-item[data-map-name]').first()).toBeVisible({ timeout: 15000 });
        await page.locator('#maps-action-save').click();
        const modal = page.locator('.export-modal-container');
        await expect(modal).toBeVisible({ timeout: 20000 });
        let download = null;
        page.once('download', (d) => { download = d; });
        await modal.locator('.export-modal-btn-confirm').click();
        await expect.poll(async () => {
            if (download) return true;
            const aviso = page.locator('.confirm-modal-container');
            if (await aviso.isVisible().catch(() => false)) await aviso.locator('.confirm-modal-btn-confirm').click().catch(() => {});
            return false;
        }, { timeout: 120000, intervals: [500] }).toBe(true);
        dirTemporario = await mkdtemp(join(tmpdir(), 'ebgeo-eng-'));
        const destino = join(dirTemporario, download.suggestedFilename());
        await download.saveAs(destino);

        const raw = new Uint8Array(await readFile(destino));
        expect(new TextDecoder().decode(raw.slice(0, 6))).toBe('EBGXOR');
        const zip = await JSZip.loadAsync(Uint8Array.from(raw.slice(6), (b) => b ^ 0xAA));
        const data = JSON.parse(await zip.file('data.json').async('string'));
        const noArquivo = Object.values(data.maps).flatMap((m) => m.features?.engineering_symbols ?? []).find((f) => f.properties.id === id);
        expect(noArquivo, 'o símbolo está no arquivo').toBeTruthy();
        expect(camposDiferentes(antes, noArquivo), 'o arquivo tem todos os campos').toEqual([]);

        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
        await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(destino);
        await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
        await esperarMapa(page);
        await expect(page.locator('.toast', { hasText: /mapas? carregados?\./ }).first()).toBeVisible({ timeout: 60000 });
        await expect.poll(async () => (await simbolos(page)).length, { timeout: 20000 }).toBe(1);
        const [depois] = await simbolos(page);
        expect(camposDiferentes(antes, depois), 'a reimportação devolve todos os campos').toEqual([]);
        await expect.poll(() => raster(page, id), { timeout: 30000 }).not.toBeNull();
        const r = await raster(page, id);
        console.log('[raster depois]', JSON.stringify(r));
        expect(r.w).toBeGreaterThan(64);
    });
});

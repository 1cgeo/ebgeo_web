// Path: e2e-ui/cobertura-exportar-pdf.spec.js

/**
 * COVERAGE: "Exportar PDF", single sheet (GDAL) and mosaic (jsPDF), read by CONTENT in real
 * Chromium. Part of the 2026-09-24 coverage campaign (import/export).
 *
 * The existing PDF specs assert that the export FINISHES (`exportacao-com-fonte-que-falha.spec.js`)
 * and that the panel's options exist (`export-config.spec.js`); none opens the file. Here the
 * bytes are parsed:
 *
 * - single sheet: the page is A4 in the chosen orientation, the raster fills it in A4 proportion,
 *   the sheet is GEOREFERENCED (the ISO 32000 `/GPTS` points bracket the map's centre), and the
 *   user's feature is in the raster (a polygon painted a colour no base map uses, found at the
 *   centre of the decoded image);
 * - mosaic 1x2: cover + overview + one (map, back) pair per tile, every page A4, and every map
 *   tile a JPEG in A4 proportion, since `doc.addImage` stretches whatever it gets to the full page.
 *
 * Both proportions were what an off-screen map squeezed by the body's flex column broke (see the
 * hidden-map rule in `pdf-export.css`): the canvas came out 475 px tall whatever was asked.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { readState } from './state.js';
import { selectFeatureUI, recolorViaPanelUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;
const MAGENTA = '#ff00ff';
const CENTRO = [-53.4, -30.0];
/** A4 landscape, width over height. */
const A4_PAISAGEM = 297 / 210;

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
        const corpo = Uint8Array.from(atob(e.base64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([corpo], e.nome, { type: 'application/octet-stream' }));
        container.dispatchEvent(new DragEvent('drop', {
            dataTransfer: dt, clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2),
            bubbles: true, cancelable: true,
        }));
    }, { nome, base64: buffer.toString('base64') });
}

/** A magenta square around the map's centre, through the person's path (drop, then the panel). */
async function poligonoMagenta(page) {
    const d = 0.02;
    const area = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { nome: 'Área magenta' },
            geometry: { type: 'Polygon', coordinates: [[
                [CENTRO[0] - d, CENTRO[1] - d], [CENTRO[0] + d, CENTRO[1] - d],
                [CENTRO[0] + d, CENTRO[1] + d], [CENTRO[0] - d, CENTRO[1] + d], [CENTRO[0] - d, CENTRO[1] - d]]] } }],
    };
    await soltarNoMapa(page, 'area.geojson', B.from(JSON.stringify(area), 'utf8'));
    await expect(page.locator('.toast', { hasText: 'importad' }).first()).toBeAttached({ timeout: 15000 });
    const id = await page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return (await store.getCurrentMapFeatures()).polygons[0].properties.id;
    });
    await selectFeatureUI(page, id);
    await recolorViaPanelUI(page, MAGENTA);
    await page.keyboard.press('Escape');
    await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 12 }), CENTRO);
    await page.waitForFunction(() => globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
}

async function abrirPdf(page, colunas) {
    await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
    await page.locator('#export-option-pdf').click();
    await expect(page.locator('.export-pdf-content')).toHaveAttribute('data-visible', 'true', { timeout: 10000 });
    await page.locator('#pdf-dpi-select').selectOption('150');
    await page.locator('#pdf-cols-select').selectOption(colunas);
}

async function baixarPdf(page) {
    const baixando = page.waitForEvent('download', { timeout: 150000 });
    await page.locator('#pdf-export-btn').click();
    const arquivo = await baixando;
    expect(arquivo.suggestedFilename()).toMatch(/\.pdf$/);
    return readFileSync(await arquivo.path());
}

/** Every stream object of the PDF: its dictionary text and its raw bytes. */
function streams(bytes) {
    const texto = bytes.toString('latin1');
    const out = [];
    const re = /obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
    let m;
    while ((m = re.exec(texto)) !== null) {
        const inicio = m.index + m[0].length;
        const fim = texto.indexOf('endstream', inicio);
        out.push({ dict: m[1], corpo: bytes.subarray(inicio, fim) });
    }
    return out;
}

function imagens(bytes) {
    return streams(bytes)
        .filter((s) => /\/Subtype\s*\/Image/.test(s.dict))
        .map((s) => ({
            ...s,
            largura: Number(/\/Width\s+(\d+)/.exec(s.dict)[1]),
            altura: Number(/\/Height\s+(\d+)/.exec(s.dict)[1]),
            filtro: (/\/Filter\s*\/(\w+)/.exec(s.dict) || [])[1] ?? null,
            cor: (/\/ColorSpace\s*\/(\w+)/.exec(s.dict) || [])[1] ?? null,
        }));
}

function paginas(bytes) {
    return [...bytes.toString('latin1').matchAll(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g)]
        .map((m) => ({ w: Number(m[3]) - Number(m[1]), h: Number(m[4]) - Number(m[2]) }));
}

describeOrSkip('Cobertura: exportar PDF', () => {
    test.describe.configure({ retries: 0 });

    test('folha única: A4, georreferenciada, com a feição dentro do raster', async ({ page }) => {
        test.setTimeout(180000);
        await esperarMapa(page);
        await poligonoMagenta(page);
        await abrirPdf(page, '1');
        const bytes = await baixarPdf(page);
        expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

        const folhas = paginas(bytes);
        const raster = imagens(bytes).filter((i) => i.cor === 'DeviceRGB').sort((a, b) => b.largura * b.altura - a.largura * a.altura)[0];
        const gpts = /\/GPTS\s*\[([^\]]+)\]/.exec(bytes.toString('latin1'));
        console.log('[pdf folha]', JSON.stringify({ tamanho: bytes.length, folhas, raster: raster && { l: raster.largura, a: raster.altura, f: raster.filtro }, gpts: gpts && gpts[1] }));

        expect(folhas, 'uma página').toHaveLength(1);
        // Landscape is the panel's default. GDAL adds the 5 mm margin around the raster, so the
        // page is A4 give or take a rounding of the raster's pixels.
        expect(folhas[0].w / folhas[0].h).toBeCloseTo(A4_PAISAGEM, 1);
        expect(folhas[0].w).toBeGreaterThan(835);
        expect(folhas[0].w).toBeLessThan(848);
        expect(raster, 'o raster do mapa').toBeTruthy();
        expect(Math.abs(raster.largura / raster.altura - (287 / 200)), 'o raster tem a proporção da área útil').toBeLessThan(0.03);

        // Georeferenced: GDAL's ISO 32000 measure carries lat/lon pairs around the map's centre.
        expect(gpts, 'a folha é georreferenciada (/GPTS)').toBeTruthy();
        const nums = gpts[1].trim().split(/\s+/).map(Number);
        const lats = nums.filter((_, i) => i % 2 === 0);
        const lngs = nums.filter((_, i) => i % 2 === 1);
        expect(Math.min(...lats)).toBeLessThan(CENTRO[1]);
        expect(Math.max(...lats)).toBeGreaterThan(CENTRO[1]);
        expect(Math.min(...lngs)).toBeLessThan(CENTRO[0]);
        expect(Math.max(...lngs)).toBeGreaterThan(CENTRO[0]);

        // The feature is in the raster, at the pixel the georeference puts it. The sheet is framed
        // on the part of the map the sidebar leaves visible, not on the map's centre, so the point
        // is read through the /GPTS box (no grid: the raster is exactly that box) at a spot well
        // inside the square.
        expect(raster.filtro).toBe('FlateDecode');
        const px = inflateSync(raster.corpo);
        expect(px.length, 'RGB de 8 bits sem preditor').toBe(raster.largura * raster.altura * 3);
        const ponto = [CENTRO[0] + 0.01, CENTRO[1]];
        const x = Math.floor(((ponto[0] - Math.min(...lngs)) / (Math.max(...lngs) - Math.min(...lngs))) * raster.largura);
        const y = Math.floor(((Math.max(...lats) - ponto[1]) / (Math.max(...lats) - Math.min(...lats))) * raster.altura);
        const [r, g, b] = px.subarray((y * raster.largura + x) * 3, (y * raster.largura + x) * 3 + 3);
        console.log('[pdf folha pixel]', JSON.stringify([r, g, b]));
        expect(r - g, 'a feição magenta está no raster').toBeGreaterThan(60);
        expect(b - g, 'a feição magenta está no raster').toBeGreaterThan(60);
    });

    test('mosaico 1x2: capa, visão geral e um par por folha, todo mapa em proporção A4', async ({ page }) => {
        test.setTimeout(180000);
        await esperarMapa(page);
        await abrirPdf(page, '2');
        const bytes = await baixarPdf(page);
        expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

        const folhas = paginas(bytes);
        const jpegs = imagens(bytes).filter((i) => i.filtro === 'DCTDecode');
        console.log('[pdf mosaico]', JSON.stringify({ tamanho: bytes.length, folhas: folhas.length, jpegs: jpegs.map((j) => [j.largura, j.altura]) }));

        // Cover, overview, then (map, back) for each of the two tiles.
        expect(folhas).toHaveLength(6);
        for (const f of folhas) expect(f.w / f.h, 'toda página é A4 paisagem').toBeCloseTo(A4_PAISAGEM, 2);
        // One JPEG per map page at least (the overview may carry its own).
        expect(jpegs.length).toBeGreaterThanOrEqual(2);
        for (const j of jpegs) {
            expect(j.corpo.subarray(0, 3).equals(B.from([0xff, 0xd8, 0xff])), 'o fluxo é JPEG').toBe(true);
            // `addImage` stretches the tile to the full page: a tile in any other proportion is a
            // distorted map on paper.
            expect(Math.abs(j.largura / j.altura - A4_PAISAGEM), `ladrilho ${j.largura}x${j.altura} em proporção A4`).toBeLessThan(0.03);
        }
    });

    // THE FEATURE IN THE RIGHT TILE, BY ITS PIXELS. The mosaic is not georeferenced (jsPDF), so the
    // reference is the PREVIEW: the panel draws one rectangle per sheet (`pdf-export-preview`, with
    // `row`/`col`), which is what the person frames before exporting. A magenta square is put at the
    // centre of the preview's (0,1) sheet; in the file, the second map tile must have it at its
    // centre and the first must not have it at all. That also pins the ORDER of the sheets.
    test('mosaico 1x2: a feição sai no ladrilho em que a pré-visualização a mostra', async ({ page }) => {
        test.setTimeout(180000);
        await esperarMapa(page);
        await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 12 }), CENTRO);
        await page.waitForFunction(() => globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
        await abrirPdf(page, '2');
        const lerPrevia = () => page.evaluate(() => {
            const dados = globalThis.__ebgeoMap.getSource('pdf-export-preview')?.serialize()?.data;
            const folhas = (dados?.features ?? []).filter((f) => f.properties?.type === 'paper');
            return {
                folhas: folhas.map((f) => {
                    const xs = f.geometry.coordinates[0].map((p) => p[0]);
                    const ys = f.geometry.coordinates[0].map((p) => p[1]);
                    return { row: f.properties.row, col: f.properties.col, oeste: Math.min(...xs), leste: Math.max(...xs), sul: Math.min(...ys), norte: Math.max(...ys) };
                }),
                centro: globalThis.__ebgeoMap.getCenter().toArray(),
                zoom: globalThis.__ebgeoMap.getZoom(),
            };
        });
        await expect.poll(async () => (await lerPrevia()).folhas.length, { timeout: 10000 }).toBe(2);
        const previa = await lerPrevia();
        const direita = previa.folhas.find((f) => f.row === 0 && f.col === 1);
        const esquerda = previa.folhas.find((f) => f.row === 0 && f.col === 0);
        expect(direita.oeste, 'a folha (0,1) fica à direita').toBeGreaterThan(esquerda.oeste);
        const alvo = [(direita.oeste + direita.leste) / 2, (direita.sul + direita.norte) / 2];
        const meio = { lng: (direita.leste - direita.oeste) / 10, lat: (direita.norte - direita.sul) / 10 };
        const area = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { nome: 'Área magenta' },
            geometry: { type: 'Polygon', coordinates: [[
                [alvo[0] - meio.lng, alvo[1] - meio.lat], [alvo[0] + meio.lng, alvo[1] - meio.lat],
                [alvo[0] + meio.lng, alvo[1] + meio.lat], [alvo[0] - meio.lng, alvo[1] + meio.lat],
                [alvo[0] - meio.lng, alvo[1] - meio.lat]]] } }] };
        await soltarNoMapa(page, 'area.geojson', B.from(JSON.stringify(area), 'utf8'));
        await expect(page.locator('.toast', { hasText: 'importad' }).first()).toBeAttached({ timeout: 15000 });
        const id = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            return (await store.getCurrentMapFeatures()).polygons[0].properties.id;
        });
        await selectFeatureUI(page, id);
        await recolorViaPanelUI(page, MAGENTA);
        await page.keyboard.press('Escape');

        // Back to the framing of the preview: the import zoomed to the square and the panel closed.
        await abrirPdf(page, '2');
        await page.evaluate((v) => globalThis.__ebgeoMap.jumpTo({ center: v.centro, zoom: v.zoom }), previa);
        await page.waitForFunction(() => globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
        await expect.poll(async () => {
            const agora = (await lerPrevia()).folhas.find((f) => f.row === 0 && f.col === 1);
            return agora ? Math.abs(agora.oeste - direita.oeste) + Math.abs(agora.norte - direita.norte) : 1;
        // Within 1e-4 degree (about 10 m, a thousandth of the sheet): the visible centre is recomputed
        // from the sidebar's pixel offset, and a pixel is about 2e-5 degree here.
        }, { timeout: 10000, message: 'a pré-visualização voltou ao mesmo enquadramento' }).toBeLessThan(1e-4);

        const bytes = await baixarPdf(page);
        const jpegs = imagens(bytes).filter((i) => i.filtro === 'DCTDecode');
        expect(jpegs, 'um ladrilho por folha').toHaveLength(2);
        const leituras = [];
        for (const j of jpegs) {
            leituras.push(await page.evaluate(async (b64) => {
                const img = new Image();
                img.src = `data:image/jpeg;base64,${b64}`;
                await img.decode();
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const d = ctx.getImageData(0, 0, c.width, c.height).data;
                let n = 0; let sx = 0; let sy = 0;
                for (let y = 0; y < c.height; y += 2) {
                    for (let x = 0; x < c.width; x += 2) {
                        const i = (y * c.width + x) * 4;
                        if (d[i] - d[i + 1] > 60 && d[i + 2] - d[i + 1] > 60) { n++; sx += x; sy += y; }
                    }
                }
                return { w: c.width, h: c.height, magenta: n, cx: n ? sx / n / c.width : null, cy: n ? sy / n / c.height : null };
            }, j.corpo.toString('base64')));
        }
        console.log('[pdf mosaico pixels]', JSON.stringify(leituras));
        expect(leituras[0].magenta, 'o ladrilho da esquerda não tem a feição').toBe(0);
        expect(leituras[1].magenta, 'o ladrilho da direita tem a feição').toBeGreaterThan(1000);
        expect(Math.abs(leituras[1].cx - 0.5), 'no centro, na horizontal').toBeLessThan(0.03);
        expect(Math.abs(leituras[1].cy - 0.5), 'no centro, na vertical').toBeLessThan(0.03);
    });
});

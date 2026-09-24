// Path: e2e-ui/imagem-nas-saidas-do-mapa.spec.js

/**
 * @fileoverview A FIGURA E A FOTO ANEXA APARECEM NAS SAÍDAS DO MAPA: KMZ, imagem e PDF.
 *
 * As três saídas tinham só teste unitário com dublê (a caixa do GroundOverlay, a cópia de imagens
 * para o mapa oculto do PDF, os ajudantes do balão do KMZ). Nenhum teste abria o arquivo PRODUZIDO
 * e procurava a figura dentro dele. Aqui, num atlas local, com a ferramenta de imagem real e a
 * galeria de fotos real:
 *
 *   1. KMZ: o arquivo leva os BYTES da figura (SHA-256 igual ao do blob guardado) e a foto anexa
 *      (decodificada, com a cor dela). A VOLTA do mesmo KMZ é MEDIDA e anotada, não afirmada: a
 *      importação não reconstrói GroundOverlay como feição de imagem nem devolve a foto (limitação
 *      registrada no relatório da campanha, à espera de decisão).
 *   2. "Exportar Imagem": a captura PNG do mapa tem os pixels da figura, e não os tinha antes dela.
 *   3. PDF de folha única (GDAL): a figura está no raster do PDF.
 *
 * A figura é MAGENTA puro, uma cor que nem o fundo nem os controles têm, então contar pixels
 * magenta separa "a figura apareceu" de "saiu um arquivo".
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test imagem-nas-saidas-do-mapa --retries=0 --workers=1
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { readState } from './state.js';
import { drawPointUI, selectFeatureUI, readFeatures } from './helpers/collab-helpers.js';
import { figuraSolida, porImagemPelaFerramenta, impressaoDoBlob, esperarDesenho } from './helpers/imagem-bytes.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const MAGENTA = [255, 0, 255];
const TEAL = [0, 150, 140];
const ALVO = [-53.4, -30.0];

async function esperarMapa(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

/** Quantos pixels de `bytes` (uma imagem que o navegador decodifica) estão perto de `cor`. */
function pixelsDaCor(page, bytes, tipo, cor, tolerancia = 40) {
    return page.evaluate(async ({ b64, t, c, tol }) => {
        const dados = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([dados], { type: t }));
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        let n = 0;
        for (let i = 0; i < px.length; i += 4) {
            if (Math.abs(px[i] - c[0]) <= tol && Math.abs(px[i + 1] - c[1]) <= tol && Math.abs(px[i + 2] - c[2]) <= tol) n++;
        }
        return { n, w: bmp.width, h: bmp.height };
    }, { b64: globalThis.Buffer.from(bytes).toString('base64'), t: tipo, c: cor, tol: tolerancia });
}

/**
 * As imagens de um PDF, sem biblioteca: cada objeto `/Subtype /Image` com o dicionário e o fluxo.
 * `FlateDecode` sem preditor é inflado aqui (é o que o GDAL escreve); `DCTDecode` volta como JPEG.
 */
function imagensDoPdf(pdf) {
    const texto = pdf.toString('latin1');
    const achadas = [];
    const re = /<<((?:(?!>>\s*stream)[\s\S])*?\/Subtype\s*\/Image[\s\S]*?)>>\s*stream\r?\n/g;
    let m;
    while ((m = re.exec(texto)) !== null) {
        const dict = m[1];
        const inicio = m.index + m[0].length;
        const fim = texto.indexOf('endstream', inicio);
        const fluxo = pdf.subarray(inicio, fim);
        const num = (k) => Number((dict.match(new RegExp(`/${k}\\s+(\\d+)`)) || [])[1]);
        const filtro = (dict.match(/\/Filter\s*\/(\w+)/) || [])[1] ?? null;
        achadas.push({
            w: num('Width'), h: num('Height'), bpc: num('BitsPerComponent'), filtro,
            cor: (dict.match(/\/ColorSpace\s*\/(\w+)/) || [])[1] ?? null,
            preditor: /\/Predictor/.test(dict), fluxo,
        });
    }
    return achadas;
}

/** Pixels perto de `cor` num raster RGB cru de 8 bits. */
function contarNoRgbCru(rgb, cor, tolerancia = 40) {
    let n = 0;
    for (let i = 0; i + 2 < rgb.length; i += 3) {
        if (Math.abs(rgb[i] - cor[0]) <= tolerancia && Math.abs(rgb[i + 1] - cor[1]) <= tolerancia && Math.abs(rgb[i + 2] - cor[2]) <= tolerancia) n++;
    }
    return n;
}

/** Abre a aba Exportar e a opção pedida. */
async function abrirOpcaoDeExportar(page, nome) {
    // O botão da barra ALTERNA a aba: clicar de novo com ela aberta a fecha.
    const opcao = page.locator('.export-option-btn', { hasText: nome });
    if (!(await opcao.isVisible().catch(() => false))) await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
    await opcao.click();
}

/** Cria a figura magenta pela ferramenta e espera o mapa desenhá-la. */
async function criarFiguraMagenta(page) {
    const png = await figuraSolida(page, MAGENTA);
    const id = await porImagemPelaFerramenta(page, { name: 'magenta.png', mimeType: 'image/png', buffer: png }, ALVO);
    await page.keyboard.press('Escape');
    await esperarDesenho(page, id, MAGENTA, { rotulo: 'no mapa local:' });
    return id;
}

describeOrSkip('A figura e a foto anexa aparecem nas saídas do mapa (atlas local)', () => {
    test.describe.configure({ retries: 0 });

    test('KMZ leva os bytes da figura e a foto anexa; a volta é medida', async ({ page }) => {
        test.setTimeout(180000);
        await esperarMapa(page);
        const idFigura = await criarFiguraMagenta(page);
        const blob = await impressaoDoBlob(page, idFigura);

        // A FOTO ANEXA, pela galeria real do painel da feição.
        const idPonto = await drawPointUI(page, [-53.3, -30.05]);
        await page.keyboard.press('Escape');
        await selectFeatureUI(page, idPonto);
        const foto = await figuraSolida(page, TEAL, { tipo: 'image/jpeg', lado: 64 });
        await page.locator('.feature-photo-gallery__file-input').setInputFiles({ name: 'foto-teal.jpg', mimeType: 'image/jpeg', buffer: foto });
        await expect(page.locator('.feature-photo-gallery-grid img').first()).toBeVisible({ timeout: 10000 });
        await expect.poll(async () => (await readFeatures(page, 'points')).find((f) => f.id === idPonto)?.props?.images?.length ?? 0,
            { timeout: 10000 }).toBe(1);
        await page.keyboard.press('Escape');

        await abrirOpcaoDeExportar(page, 'Exportar KMZ');
        const baixando = page.waitForEvent('download', { timeout: 60000 });
        await page.locator('.kmz-export-btn').click();
        const kmz = readFileSync(await (await baixando).path());
        const zip = await JSZip.loadAsync(kmz);
        const arquivos = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
        console.log(`[kmz] arquivos: ${JSON.stringify(arquivos)}`);

        // A FIGURA: algum arquivo do KMZ tem EXATAMENTE os bytes do blob guardado.
        const shas = {};
        for (const nome of arquivos) {
            shas[nome] = createHash('sha256').update(await zip.file(nome).async('nodebuffer')).digest('hex');
        }
        const daFigura = Object.entries(shas).find(([, sha]) => sha === blob.sha)?.[0] ?? null;
        expect(daFigura, `nenhum arquivo do KMZ tem os bytes da figura (sha ${blob.sha})`).not.toBeNull();
        const kml = await zip.file(arquivos.find((n) => n.endsWith('.kml'))).async('string');
        expect(kml, 'o KML aponta para o arquivo da figura num GroundOverlay').toMatch(new RegExp(`<GroundOverlay>[\\s\\S]*${daFigura.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

        // A FOTO: um arquivo em files/fotos que decodifica para o teal.
        const daFoto = arquivos.filter((n) => n.startsWith('files/fotos/'));
        expect(daFoto, 'o KMZ não levou a foto anexa').toHaveLength(1);
        const fotoNoKmz = await pixelsDaCor(page, await zip.file(daFoto[0]).async('nodebuffer'), 'image/jpeg', TEAL, 24);
        expect(fotoNoKmz.n, `a foto do KMZ não é a foto anexada (${JSON.stringify(fotoNoKmz)})`).toBe(fotoNoKmz.w * fotoNoKmz.h);

        // A VOLTA, medida: o que o mesmo KMZ devolve ao ser solto no mapa.
        const imagensAntes = (await readFeatures(page, 'images')).length;
        const antes = new Set();
        for (const t of ['points', 'polygons', 'images']) for (const f of await readFeatures(page, t)) antes.add(f.id);
        await page.evaluate(async (b64) => {
            const map = globalThis.__ebgeoMap;
            const rect = map.getContainer().getBoundingClientRect();
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const dt = new DataTransfer();
            dt.items.add(new File([bytes], 'volta.kmz', { type: 'application/vnd.google-earth.kmz' }));
            map.getContainer().dispatchEvent(new DragEvent('drop', {
                dataTransfer: dt, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true,
            }));
        }, kmz.toString('base64'));
        await expect.poll(async () => {
            let novos = 0;
            for (const t of ['points', 'polygons', 'images']) novos += (await readFeatures(page, t)).filter((f) => !antes.has(f.id)).length;
            return novos;
        }, { timeout: 15000 }).toBeGreaterThan(0);
        await page.waitForTimeout(1000);
        const volta = {};
        for (const t of ['points', 'polygons', 'images']) {
            volta[t] = (await readFeatures(page, t)).filter((f) => !antes.has(f.id))
                .map((f) => ({ nome: f.nome, fotos: f.props?.images?.length ?? 0 }));
        }
        console.log(`[kmz volta] ${JSON.stringify(volta)}`);
        test.info().annotations.push({ type: 'kmz-volta', description: JSON.stringify(volta) });
        test.info().annotations.push({
            type: 'kmz-volta-limitacao',
            description: `figura de volta como feição de imagem: ${(await readFeatures(page, 'images')).length - imagensAntes}; `
                + `fotos de volta no ponto: ${volta.points.reduce((s, p) => s + p.fotos, 0)}`,
        });
    });

    test('"Exportar Imagem": a captura tem a figura, e não a tinha antes dela', async ({ page }) => {
        test.setTimeout(120000);
        await esperarMapa(page);
        await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 10 }), ALVO);

        const capturar = async () => {
            await abrirOpcaoDeExportar(page, 'Exportar Imagem');
            const baixando = page.waitForEvent('download', { timeout: 60000 });
            const d = await baixando;
            return readFileSync(await d.path());
        };
        const antes = await pixelsDaCor(page, await capturar(), 'image/png', MAGENTA);
        expect(antes.n, 'a captura SEM figura já tinha magenta: a contagem não discrimina').toBe(0);

        await criarFiguraMagenta(page);
        const depois = await pixelsDaCor(page, await capturar(), 'image/png', MAGENTA);
        console.log(`[captura] antes ${antes.n}, depois ${depois.n} de ${depois.w}x${depois.h}`);
        expect(depois.n, 'a figura não aparece na captura do mapa').toBeGreaterThan(100);
    });

    test('PDF de folha única: a figura está no raster do PDF', async ({ page }) => {
        test.setTimeout(240000);
        await esperarMapa(page);
        // A folha é centrada na vista: a figura nasce no centro dela.
        await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 12 }), ALVO);
        await criarFiguraMagenta(page);

        await abrirOpcaoDeExportar(page, 'Exportar PDF');
        const botao = page.locator('#pdf-export-btn');
        await expect(botao).toBeVisible({ timeout: 15000 });
        const baixando = page.waitForEvent('download', { timeout: 180000 });
        await botao.click();
        const pdf = readFileSync(await (await baixando).path());
        expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

        const imagens = imagensDoPdf(pdf);
        console.log(`[pdf] ${pdf.length} bytes, imagens: ${JSON.stringify(imagens.map(({ fluxo, ...r }) => ({ ...r, bytes: fluxo.length })))}`);
        expect(imagens.length, 'o PDF não tem imagem nenhuma').toBeGreaterThan(0);
        let magenta = 0;
        for (const img of imagens) {
            if (img.filtro === 'DCTDecode') {
                magenta += (await pixelsDaCor(page, img.fluxo, 'image/jpeg', MAGENTA, 60)).n;
            } else if (img.filtro === 'FlateDecode' && !img.preditor && img.bpc === 8 && img.cor === 'DeviceRGB') {
                magenta += contarNoRgbCru(zlib.inflateSync(img.fluxo), MAGENTA);
            }
        }
        console.log(`[pdf] pixels magenta: ${magenta}`);
        expect(magenta, 'a figura não aparece no PDF').toBeGreaterThan(100);
    });
});

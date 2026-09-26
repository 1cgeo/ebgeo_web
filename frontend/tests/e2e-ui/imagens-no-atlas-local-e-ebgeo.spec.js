// Path: e2e-ui/imagens-no-atlas-local-e-ebgeo.spec.js

/**
 * @fileoverview AS TRÊS FORMAS DE IMAGEM NUM ATLAS LOCAL, SEM SERVIDOR: sobrevivem ao F5 e fazem a
 * volta completa do `.ebgeo` com os MESMOS bytes.
 *
 * A feição de imagem (blob no banco de imagens), a foto anexa (dentro da feição) e a figura colada
 * num slide de briefing moram em lugares diferentes, e o `.ebgeo` as leva por caminhos diferentes.
 * A figura do slide, desde 2026-09-26, é um blob no banco de imagens CITADO pelo HTML do slide
 * (`https://figura.ebgeo/<id>`, `briefing/figura-de-slide.js`), e o arquivo a leva em `images/`. O ciclo do `.ebgeo` pelo disco
 * (`ebgeo-round-trip-arquivo.spec.js`) conta imagens com `hasImage` e conta slides; nenhum teste
 * comparava os BYTES das três depois de exportar e reimportar pela tela.
 *
 * O gesto, anônimo, no atlas local: figura pela ferramenta, foto pela galeria, figura colada no
 * slide; F5; "Exportar" da aba Mapas; o arquivo reaberto pela tela de atlas ("Abrir arquivo
 * .ebgeo"), que cria um atlas local NOVO. O veredito é o SHA-256 de cada uma: antes, depois do F5,
 * dentro do arquivo e no atlas reimportado (onde a figura e a foto podem ganhar id novo, e por isso
 * elas são achadas pelo NOME da feição).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test imagens-no-atlas-local-e-ebgeo --retries=0 --workers=1
 */

import { test, expect } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { readState } from './state.js';
import { drawPointUI, selectFeatureUI } from './helpers/collab-helpers.js';
import { figuraSolida, porImagemPelaFerramenta } from './helpers/imagem-bytes.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function esperarMapa(page) {
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

/**
 * O SHA-256 das três formas no atlas aberto, achadas pelo NOME (o id pode mudar na reimportação):
 * a figura (blob por `getImage`), a foto do ponto (data URL ou referência) e a figura do slide.
 */
function impressoes(page, { nomeFigura, nomePonto }) {
    return page.evaluate(async ({ nf, np }) => {
        const store = await import('/src/js/store/index.js');
        const hex = async (blob) => {
            const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
            return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
        };
        const f = await store.getCurrentMapFeatures();
        const figura = (f.images ?? []).find((x) => x.properties?.nome === nf);
        const ponto = (f.points ?? []).find((x) => x.properties?.nome === np);
        const blobFigura = figura ? await store.getImage(figura.properties.id) : null;
        const foto = ponto?.properties?.images?.[0] ?? null;
        let blobFoto = null;
        if (typeof foto?.data === 'string' && foto.data.startsWith('data:')) blobFoto = await (await fetch(foto.data)).blob();
        else if (foto?.id) blobFoto = await store.getImage(foto.id);
        const briefings = await store.getAllBriefings();
        const lista = briefings instanceof Map ? [...briefings.values()] : (briefings ?? []);
        const html = lista[0]?.slides?.[0]?.content ?? '';
        const idDoSlide = (html.match(/https:\/\/figura\.ebgeo\/([A-Za-z0-9-]{8,64})/) || [])[1] ?? null;
        const blobDoSlide = idDoSlide ? await store.getImage(idDoSlide) : null;
        return {
            figura: blobFigura ? await hex(blobFigura) : null,
            foto: blobFoto ? await hex(blobFoto) : null,
            slide: blobDoSlide ? await hex(blobDoSlide) : null,
        };
    }, { nf: nomeFigura, np: nomePonto });
}

describeOrSkip('As três formas de imagem num atlas local: F5 e .ebgeo', () => {
    test.describe.configure({ retries: 0 });
    let dir = null;
    test.afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

    test('figura, foto anexa e figura de slide sobrevivem ao F5 e voltam do .ebgeo com os mesmos bytes', async ({ page }) => {
        test.setTimeout(240000);
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await esperarMapa(page);

        // A: a figura pela ferramenta.
        const idFigura = await porImagemPelaFerramenta(page, { name: 'figura.png', mimeType: 'image/png', buffer: await figuraSolida(page, [220, 30, 120]) });
        await page.keyboard.press('Escape');
        // B: a foto pela galeria.
        const idPonto = await drawPointUI(page, [-53.3, -30.05]);
        await page.keyboard.press('Escape');
        await selectFeatureUI(page, idPonto);
        await page.locator('.feature-photo-gallery__file-input').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await figuraSolida(page, [0, 150, 140], { tipo: 'image/jpeg', lado: 64 }) });
        await expect(page.locator('.feature-photo-gallery-grid img').first()).toBeVisible({ timeout: 10000 });
        await page.keyboard.press('Escape');
        const nomes = await page.evaluate(async ({ a, b }) => {
            const store = await import('/src/js/store/index.js');
            const f = await store.getCurrentMapFeatures();
            return {
                nomeFigura: (f.images ?? []).find((x) => x.properties?.id === a)?.properties?.nome,
                nomePonto: (f.points ?? []).find((x) => x.properties?.id === b)?.properties?.nome,
            };
        }, { a: idFigura, b: idPonto });

        // C: a figura colada num slide.
        if (!(await page.locator('.briefings-create-btn').isVisible())) await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await page.locator('.briefings-create-btn').click();
        await expect(page.locator('.briefing-editor-slide-editor .ql-editor')).toBeVisible({ timeout: 10000 });
        const png = await figuraSolida(page, [180, 90, 20], { lado: 120 });
        await page.evaluate((conteudo) => {
            const editor = document.querySelector('.briefing-editor-slide-editor .ql-editor');
            editor.focus();
            const dt = new DataTransfer();
            dt.setData('text/html', conteudo);
            dt.setData('text/plain', 'x');
            const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(paste, 'clipboardData', { value: dt });
            editor.dispatchEvent(paste);
        }, `<p>Figura do slide</p><img src="data:image/png;base64,${png.toString('base64')}">`);

        let antes = null;
        await expect.poll(async () => {
            antes = await impressoes(page, nomes);
            return Object.values(antes).every(Boolean);
        }, { timeout: 20000, message: 'as três formas não estão no atlas local' }).toBe(true);
        console.log(`[local] antes: ${JSON.stringify(antes)}`);

        // F5.
        await page.reload();
        await esperarMapa(page);
        await expect.poll(() => impressoes(page, nomes), { timeout: 20000, message: 'o F5 mudou os bytes' }).toEqual(antes);

        // EXPORTAR pela aba Mapas.
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await page.locator('#maps-action-save').click();
        const modal = page.locator('.export-modal-container');
        await expect(modal).toBeVisible({ timeout: 20000 });
        const baixado = page.waitForEvent('download', { timeout: 120000 });
        await modal.locator('.export-modal-btn-confirm').click();
        const download = await baixado;
        dir = await mkdtemp(join(tmpdir(), 'imagens-ebgeo-'));
        const destino = join(dir, download.suggestedFilename());
        await download.saveAs(destino);

        // DENTRO DO ARQUIVO (XOR 0xAA atrás de EBGXOR, como decodifica `ebgeo-round-trip-arquivo`).
        const raw = new Uint8Array(await readFile(destino));
        expect(new TextDecoder().decode(raw.slice(0, 6))).toBe('EBGXOR');
        const zip = await JSZip.loadAsync(Uint8Array.from(raw.slice(6), (b) => b ^ 0xaa));
        const data = JSON.parse(await zip.file('data.json').async('string'));
        const noArquivo = {};
        for (const entrada of zip.file(/^images\/.+/)) {
            noArquivo[entrada.name] = sha(await entrada.async('nodebuffer'));
        }
        const htmlNoArquivo = JSON.stringify(data.briefings ?? []);
        const idNoArquivo = (htmlNoArquivo.match(/https:\/\/figura\.ebgeo\/([A-Za-z0-9-]{8,64})/) || [])[1] ?? null;
        console.log(`[ebgeo] imagens: ${JSON.stringify(noArquivo)}`);
        expect(Object.values(noArquivo), 'o arquivo não leva os bytes da figura').toContain(antes.figura);
        expect(idNoArquivo, 'o slide do arquivo não cita a figura').not.toBeNull();
        expect(htmlNoArquivo, 'o slide do arquivo leva bytes de figura no HTML').not.toMatch(/data:image|blob:/);
        const entradaDoSlide = Object.keys(noArquivo).find((nome) => nome.startsWith(`images/${idNoArquivo}.`));
        expect(entradaDoSlide, 'o arquivo não leva os bytes da figura do slide').toBeTruthy();
        expect(noArquivo[entradaDoSlide], 'a figura do slide mudou dentro do arquivo').toBe(antes.slide);

        // REABRIR pela tela de atlas: um atlas local NOVO.
        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
        await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(destino);
        await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
        await esperarMapa(page);
        await expect.poll(() => impressoes(page, nomes), { timeout: 30000, message: 'o .ebgeo reimportado mudou os bytes' }).toEqual(antes);
    });
});

// Path: e2e-ui/cobertura-exportar-notas.spec.js

/**
 * COVERAGE + REPRO: the "Baixar" of the map notes panel, read by CONTENT and OPENED, in real
 * Chromium. Part of the 2026-09-24 coverage campaign (import/export).
 *
 * The notes are Quill HTML that reach this client from other people: a colleague on a server atlas
 * (the `mapNotes` op is stored and relayed as written; the server does not sanitize it) or any
 * `.ebgeo` someone hands over. The panel renders them through `sanitizeQuillHtml`, as the
 * constitution requires at every render point. The downloaded HTML file is a render point too: the
 * person opens it in the browser. Until 2026-09-24 it interpolated the description RAW and the title
 * UNESCAPED, so a note carrying `<img onerror>` or `</title><script>` ran its script when the file
 * was opened, and an honest title like `Plano <Alfa> & Bravo` broke the page.
 *
 * The notes are written by the store op, which is the shape a peer's payload lands in, and the
 * file is checked twice: by its text, and by loading it in a page and watching for the script.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const TITULO = 'Plano <Alfa> & "Bravo"</title><script>window.__titulo = 1</script>';
const DESCRICAO = '<p><strong>Missão</strong> de reconhecimento</p><ul><li>Fase 1</li></ul>'
    + '<img src="x" onerror="window.__imagem = 1"><script>window.__script = 1</script>';

async function esperarMapa(page) {
    await page.goto('/');
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 30000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

describeOrSkip('Cobertura: baixar as notas do mapa', () => {
    test.describe.configure({ retries: 0 });

    test('o arquivo leva o texto rico, escapa o título e não carrega script de ninguém', async ({ page, browser }) => {
        await esperarMapa(page);
        const gravou = await page.evaluate(async ({ titulo, descricao }) => {
            const store = await import('/src/js/store/index.js');
            return store.setMapNotes(store.getCurrentMapName(), { title: titulo, description: descricao });
        }, { titulo: TITULO, descricao: DESCRICAO });
        expect(gravou, 'as notas foram gravadas').not.toBe(false);

        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await page.locator('.maps-tab #current-map-notes-btn').click();
        const baixar = page.locator('.map-notes-sidebar-download-btn');
        await expect(baixar).toBeVisible({ timeout: 10000 });
        // The panel itself sanitizes (the control of the instrument: the payload is really there).
        await expect(page.locator('.map-notes-sidebar-content strong', { hasText: 'Missão' })).toBeVisible();

        const baixando = page.waitForEvent('download', { timeout: 15000 });
        await baixar.click();
        const arquivo = await baixando;
        const html = readFileSync(await arquivo.path(), 'utf8');
        console.log('[notas]', arquivo.suggestedFilename(), JSON.stringify(html.slice(html.indexOf('<title>'), html.indexOf('<title>') + 160)), JSON.stringify(html.slice(html.indexOf('<h1>'))));

        expect(arquivo.suggestedFilename()).toMatch(/_notas\.html$/);
        // The rich text survives.
        expect(html).toContain('<strong>Missão</strong>');
        expect(html).toContain('<li>Fase 1</li>');
        // Nothing executable, and the title is text.
        expect(html).not.toContain('onerror');
        expect(html).not.toMatch(/<script/i);
        expect(html).toContain('Plano &lt;Alfa&gt; &amp;');

        // Opened, as the person opens it: no script runs, and the title reads as written.
        const leitor = await browser.newPage();
        await leitor.setContent(html);
        await leitor.waitForTimeout(300);
        const efeito = await leitor.evaluate(() => ({
            titulo: globalThis.__titulo ?? null, imagem: globalThis.__imagem ?? null, script: globalThis.__script ?? null,
            h1: document.querySelector('h1')?.textContent, tab: document.title,
        }));
        console.log('[aberto]', JSON.stringify(efeito));
        expect(efeito.titulo).toBeNull();
        expect(efeito.imagem).toBeNull();
        expect(efeito.script).toBeNull();
        expect(efeito.h1).toBe(TITULO);
        await leitor.close();
    });
});

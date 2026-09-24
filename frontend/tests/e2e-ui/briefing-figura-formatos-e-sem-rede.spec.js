// Path: e2e-ui/briefing-figura-formatos-e-sem-rede.spec.js

/**
 * @fileoverview A FIGURA COLADA NO SLIDE, NO EDITOR DE BRIEFING DE VERDADE: os cinco formatos que a
 * colagem aceita, o teto de 5 MB, uma foto grande, e a figura colada SEM REDE, até os bytes no colega.
 *
 * A colagem de figura no Quill (`utilities/quill-helpers.js` e `quill-image-paste.model.js`) aceita
 * PNG, JPEG, WebP, GIF e BMP, re-encoda como JPEG até 800 x 600 e recusa acima de 5 MB. O navegador
 * só a media com PNG, e num editor avulso montado pelo teste (`quill-html-colado-com-imagem.spec.js`);
 * os outros quatro formatos e o teto eram só unitários, e ninguém colava com a conexão caída. Aqui,
 * no editor de briefing de verdade e com um colega:
 *
 *   1. PNG, JPEG, WebP, GIF e BMP entram, todos re-encodados como JPEG, e o colega lê as cinco
 *      figuras com os mesmos SHA-256;
 *   2. uma foto de 4032 x 3024 entra reduzida a no máximo 800 de largura, e um arquivo com um byte
 *      acima de 5 MB é recusado com a frase, sem entrar no slide;
 *   3. uma figura colada com a conexão caída chega ao colega quando a conexão volta.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-figura-formatos-e-sem-rede --retries=0 --workers=1
 */

import { createHash } from 'node:crypto';
import { collabTest, expect } from './helpers/collab.fixtures.js';
import { figuraSolida } from './helpers/imagem-bytes.js';

collabTest.describe.configure({ retries: 0 });

const B = globalThis.Buffer;
const EDITOR = '.briefing-editor-slide-editor .ql-editor';
const GIF_1PX = 'R0lGODlhAQABAIAAAP8AAP///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
const sha = (t) => createHash('sha256').update(t).digest('hex');

/** BMP de 24 bits, sólido, largura múltipla de 4. */
function bmpSolido(largura, altura, [r, g, b]) {
    const dados = largura * altura * 3;
    const buf = B.alloc(54 + dados);
    buf.write('BM', 0, 'ascii');
    buf.writeUInt32LE(54 + dados, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(largura, 18);
    buf.writeInt32LE(altura, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28);
    buf.writeUInt32LE(dados, 34);
    for (let i = 54; i < buf.length; i += 3) { buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; }
    return buf;
}

/** Uma foto de celular (gradiente com ruído), em JPEG, codificada pelo navegador. */
async function fotoComRuido(page, largura, altura) {
    const b64 = await page.evaluate(async ({ w, h }) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(w, h);
        // Gradiente com ruído PEQUENO: o peso de uma foto de celular (alguns MB), e não o de ruído
        // puro, que em JPEG passa de 9 MB e cai no teto (medido).
        let s = 7;
        const ruido = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 40; };
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                img.data[i] = (x / w) * 200 + ruido(); img.data[i + 1] = (y / h) * 180 + ruido(); img.data[i + 2] = 90 + ruido(); img.data[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let out = '';
        for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(out);
    }, { w: largura, h: altura });
    return B.from(b64, 'base64');
}

const figurasDe = (html) => [...String(html ?? '').matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

const conteudoNoDisco = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(id))?.slides ?? [])[0]?.content ?? '';
}, bid);

/** Cola `html` no editor do slide aberto. */
function colar(page, html) {
    return page.evaluate(({ seletor, conteudo }) => {
        const alvo = document.querySelector(seletor);
        alvo.focus();
        const sel = window.getSelection();
        sel.selectAllChildren(alvo);
        sel.collapseToEnd();
        const dt = new DataTransfer();
        dt.setData('text/html', conteudo);
        dt.setData('text/plain', 'x');
        const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(paste, 'clipboardData', { value: dt });
        alvo.dispatchEvent(paste);
    }, { seletor: EDITOR, conteudo: html });
}

/** Cola uma figura e espera o slide no disco do autor ter `n` figuras. Devolve as figuras. */
async function colarFigura(page, bid, mime, bytes, n) {
    await colar(page, `<p>f${n}</p><img src="data:${mime};base64,${bytes.toString('base64')}">`);
    let figuras = [];
    await expect.poll(async () => {
        figuras = figurasDe(await conteudoNoDisco(page, bid));
        return figuras.length;
    }, { timeout: 20000, message: `a figura ${mime} não entrou no slide` }).toBe(n);
    return figuras;
}

/** O que o colega tem no slide: a lista de SHA das figuras. */
async function esperarNoColega(page, bid, esperadas, rotulo) {
    await expect.poll(async () => figurasDe(await conteudoNoDisco(page, bid)).map(sha), { timeout: 30000,
        message: `${rotulo}: as figuras do colega não são as do autor` }).toEqual(esperadas.map(sha));
}

/** Largura decodificada de uma figura data URL, na página. */
const largura = (page, src) => page.evaluate(async (s) => (await createImageBitmap(await (await fetch(s)).blob())).width, src);

collabTest.describe('Figura colada no slide: formatos, teto, foto grande e sem rede', () => {
    collabTest('cinco formatos, teto de 5 MB, foto grande e figura sem rede chegam ao colega', async ({ collab }) => {
        collabTest.setTimeout(300000);
        const A = collab.author;
        const Bp = collab.peers[0];

        const antes = new Set(await lerTodosBriefings(A));
        if (!(await A.locator('.briefings-create-btn').isVisible())) await A.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await A.locator('.briefings-create-btn').click();
        await expect(A.locator(EDITOR)).toBeVisible({ timeout: 10000 });
        let bid = null;
        await expect.poll(async () => {
            bid = (await lerTodosBriefings(A)).find((b) => !antes.has(b)) ?? null;
            return bid;
        }, { timeout: 10000 }).toBeTruthy();

        // 1. CINCO FORMATOS, todos re-encodados como JPEG.
        await colarFigura(A, bid, 'image/png', await figuraSolida(A, [200, 40, 40], { lado: 40 }), 1);
        await colarFigura(A, bid, 'image/jpeg', await figuraSolida(A, [40, 200, 40], { tipo: 'image/jpeg', lado: 40 }), 2);
        await colarFigura(A, bid, 'image/webp', await figuraSolida(A, [40, 40, 200], { tipo: 'image/webp', lado: 40 }), 3);
        await colarFigura(A, bid, 'image/gif', B.from(GIF_1PX, 'base64'), 4);
        const cinco = await colarFigura(A, bid, 'image/bmp', bmpSolido(40, 40, [230, 180, 30]), 5);
        expect(cinco.map((s) => s.slice(0, 23)), 'toda figura colada é re-encodada como JPEG')
            .toEqual(Array(5).fill('data:image/jpeg;base64,'));
        await esperarNoColega(Bp, bid, cinco, 'cinco formatos');

        // 2. FOTO GRANDE entra reduzida; UM BYTE ACIMA DE 5 MB é recusado.
        const grande = await fotoComRuido(A, 4032, 3024);
        console.log(`[slide] foto grande: ${grande.length} bytes`);
        expect(grande.length, 'a foto de teste tem o peso de uma foto de celular, abaixo do teto').toBeGreaterThan(1.5 * 1024 * 1024);
        expect(grande.length).toBeLessThan(5 * 1024 * 1024);
        const seis = await colarFigura(A, bid, 'image/jpeg', grande, 6);
        expect(await largura(A, seis[5]), 'a foto grande não foi reduzida').toBeLessThanOrEqual(800);
        const pesada = B.concat([grande, B.alloc(5 * 1024 * 1024 + 1 - grande.length)]);
        await colar(A, `<p>pesada</p><img src="data:image/jpeg;base64,${pesada.toString('base64')}">`);
        const recusa = A.locator('.toast', { hasText: 'o máximo é 5 MB' }).first();
        await expect(recusa, 'a figura acima de 5 MB não foi recusada com a frase').toBeVisible({ timeout: 15000 });
        console.log(`[slide] recusa: ${await recusa.innerText()}`);
        await A.waitForTimeout(1500);
        expect(figurasDe(await conteudoNoDisco(A, bid)).length, 'a figura recusada entrou no slide').toBe(6);
        await esperarNoColega(Bp, bid, seis, 'foto grande');

        // 3. SEM REDE.
        await A.evaluate(async () => {
            const { connectionState } = await import('/src/js/store/sync/connection-state.js');
            globalThis.__transicoes = [];
            connectionState.onStateChanged((e) => globalThis.__transicoes.push(`${e.previousState}->${e.currentState}`));
        });
        await A.context().setOffline(true);
        await A.evaluate(async () => {
            const { wsClient } = await import('/src/js/store/sync/ws-client.js');
            wsClient._socket?.close(4000, 'network fault injection');
        });
        await expect.poll(() => A.evaluate(() => globalThis.__transicoes), { timeout: 30000 }).toContain('online->reconnecting');
        const sete = await colarFigura(A, bid, 'image/png', await figuraSolida(A, [120, 20, 160], { lado: 40 }), 7);
        await A.context().setOffline(false);
        await expect.poll(() => A.evaluate(() => globalThis.__transicoes), { timeout: 120000 }).toContain('reconnecting->online');
        await esperarNoColega(Bp, bid, sete, 'figura colada sem rede');
    });
});

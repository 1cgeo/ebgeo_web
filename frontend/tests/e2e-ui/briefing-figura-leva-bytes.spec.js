// Path: e2e-ui/briefing-figura-leva-bytes.spec.js

/**
 * @fileoverview A FIGURA DE UM SLIDE DE BRIEFING CHEGA INTEIRA: ao servidor, ao colega, ao F5 e ao
 * CLONE do atlas.
 *
 * A figura colada no texto rico do slide (Quill) não é blob: é um data URL DENTRO do HTML do slide,
 * re-encodado na colagem (`utilities/quill-helpers.js`), e viaja como texto na op do slide. Os
 * testes que existiam contavam `<img>` (`briefing-editor-figura-do-colega.repro.spec.js`) ou o
 * número de slides (`ebgeo-round-trip-arquivo.spec.js`); nenhum comparava os BYTES da figura. Uma
 * figura truncada, re-comprimida de novo por um segundo editor, ou com o `src` limpo por um
 * sanitizador conta como um `<img>` do mesmo jeito.
 *
 * O veredito aqui é o SHA-256 do data URL da figura, lido no disco do autor, no Postgres, no disco
 * do colega (antes e depois de F5) e no clone do atlas, mais a decodificação dela no colega (a
 * largura e a cor), que é o que prova que o `src` que chegou é uma imagem e não só um texto igual.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-figura-leva-bytes --retries=0 --workers=1
 */

import { createHash } from 'node:crypto';
import { collabTest, expect } from './helpers/collab.fixtures.js';
import { figuraSolida } from './helpers/imagem-bytes.js';

collabTest.describe.configure({ retries: 0 });

const COR = [180, 90, 20];

/** Os `src` de toda figura de um HTML, na ordem. */
const figurasDe = (html) => [...String(html ?? '').matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
const sha = (texto) => createHash('sha256').update(texto).digest('hex');

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

const conteudoNoDisco = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(id))?.slides ?? [])[0]?.content ?? '';
}, bid);

/** A primeira figura do slide decodificada NA PÁGINA: largura, altura e o pixel central. */
const decodificar = (page, src) => page.evaluate(async (s) => {
    const bmp = await createImageBitmap(await (await fetch(s)).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, pixel: [...ctx.getImageData(bmp.width >> 1, bmp.height >> 1, 1, 1).data].slice(0, 3) };
}, src);

/** Espera a primeira figura do slide em `page` ter o SHA `esperado`. */
async function esperarFigura(page, bid, esperado, rotulo) {
    let ultima = null;
    await expect.poll(async () => {
        const f = figurasDe(await conteudoNoDisco(page, bid));
        ultima = { quantas: f.length, sha: f[0] ? sha(f[0]) : null, tamanho: f[0]?.length ?? 0 };
        return ultima.sha;
    }, { timeout: 30000, message: `${rotulo}: a figura do slide não é a do autor` }).toBe(esperado)
        .catch((e) => { throw new Error(`${e.message}\n${JSON.stringify(ultima)}`); });
}

collabTest.describe('A figura do slide de briefing chega com os mesmos bytes', () => {
    collabTest('servidor, colega, F5 do colega e clone do atlas', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];

        const antes = new Set(await lerTodosBriefings(A));
        if (!(await A.locator('.briefings-create-btn').isVisible())) await A.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await A.locator('.briefings-create-btn').click();
        await expect(A.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
        let bid = null;
        await expect.poll(async () => {
            bid = (await lerTodosBriefings(A)).find((b) => !antes.has(b)) ?? null;
            return bid;
        }, { timeout: 10000 }).toBeTruthy();
        await A.locator('.briefing-editor-slide-title-input').fill('Com figura');
        await A.locator('.briefing-editor-slide-title-input').blur();

        // A cola HTML com uma figura embutida (a porta de colagem do Quill, que re-encoda).
        const png = await figuraSolida(A, COR, { lado: 120 });
        await expect(A.locator('.briefing-editor-slide-editor .ql-editor')).toBeVisible({ timeout: 10000 });
        await A.evaluate((conteudo) => {
            const editor = document.querySelector('.briefing-editor-slide-editor .ql-editor');
            editor.focus();
            const dt = new DataTransfer();
            dt.setData('text/html', conteudo);
            dt.setData('text/plain', 'x');
            const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(paste, 'clipboardData', { value: dt });
            editor.dispatchEvent(paste);
        }, `<p>Figura do reconhecimento</p><img src="data:image/png;base64,${png.toString('base64')}">`);

        // O AUTOR: a figura re-encodada está no disco dele, uma só.
        let figuraDoAutor = null;
        await expect.poll(async () => {
            const f = figurasDe(await conteudoNoDisco(A, bid));
            figuraDoAutor = f[0] ?? null;
            return f.length;
        }, { timeout: 20000 }).toBe(1);
        const esperado = sha(figuraDoAutor);
        const noAutor = await decodificar(A, figuraDoAutor);
        console.log(`[slide] figura do autor: ${figuraDoAutor.length} caracteres, ${JSON.stringify(noAutor)}`);
        expect(noAutor.w, 'a figura colada tem a largura de origem (abaixo do teto de 800)').toBe(120);

        // O SERVIDOR.
        await expect.poll(async () => {
            const linha = await collab.db.raw.oneOrNone(
                'SELECT content FROM slides WHERE briefing_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [bid]);
            const f = figurasDe(linha?.content);
            return f[0] ? sha(f[0]) : null;
        }, { timeout: 30000, message: 'a figura no Postgres não é a do autor' }).toBe(esperado);

        // O COLEGA, no disco e decodificada.
        await esperarFigura(B, bid, esperado, 'colega');
        const noColega = await decodificar(B, figurasDe(await conteudoNoDisco(B, bid))[0]);
        expect(noColega).toEqual(noAutor);

        // F5 no colega.
        await B.reload();
        await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await esperarFigura(B, bid, esperado, 'colega depois do F5');

        // O CLONE: o servidor copia o slide, e o autor o abre.
        const clone = await A.evaluate(async (atlasId) => {
            const { apiClient } = await import('/src/js/store/sync/api-client.js');
            const r = await apiClient.cloneAtlas(atlasId, { name: 'Clone com briefing' });
            return r?.atlas?.id ?? r?.id ?? null;
        }, collab.atlasId);
        expect(clone).toBeTruthy();
        await A.goto(`/?atlas=${clone}`);
        await expect(A.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        let bidClone = null;
        await expect.poll(async () => {
            bidClone = (await lerTodosBriefings(A))[0] ?? null;
            return bidClone;
        }, { timeout: 30000, message: 'o clone abriu sem briefing' }).toBeTruthy();
        expect(bidClone, 'o briefing do clone tem id próprio').not.toBe(bid);
        await esperarFigura(A, bidClone, esperado, 'clone');
    });
});

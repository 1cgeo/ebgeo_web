// Path: e2e-ui/briefing-figura-leva-bytes.spec.js

/**
 * @fileoverview A FIGURA DE UM SLIDE DE BRIEFING CHEGA INTEIRA: ao servidor, ao colega, ao F5 e ao
 * CLONE do atlas.
 *
 * A figura colada no texto rico do slide (Quill) é re-encodada na colagem
 * (`utilities/quill-helpers.js`) e, desde 2026-09-26, guardada POR REFERÊNCIA: os bytes vão para o
 * banco de imagens do atlas e sobem pela fila de blob, e o HTML do slide guarda o sentinela
 * `https://figura.ebgeo/<id>` (`briefing/figura-de-slide.js`). Os testes que existiam contavam
 * `<img>` (`briefing-editor-figura-do-colega.repro.spec.js`) ou o número de slides
 * (`ebgeo-round-trip-arquivo.spec.js`); nenhum comparava os BYTES da figura. Uma figura truncada,
 * re-comprimida de novo por um segundo editor, ou com a referência perdida conta como um `<img>` do
 * mesmo jeito.
 *
 * O veredito aqui é o SHA-256 dos BYTES da figura, lidos no banco de imagens do autor, no Postgres
 * (`images.content_hash`), no do colega (antes e depois de F5) e no clone do atlas, que reemite o id
 * da imagem e precisa reescrever o do slide, mais a decodificação no colega (a largura e a cor).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-figura-leva-bytes --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';
import { figuraSolida } from './helpers/imagem-bytes.js';
import { figurasDoSlide, idsDasFiguras, conteudoDoSlide } from './helpers/figura-de-slide.js';

collabTest.describe.configure({ retries: 0 });

const COR = [180, 90, 20];


const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

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

/** Espera a primeira figura do slide em `page` ter bytes com o SHA `esperado`. */
async function esperarFigura(page, bid, esperado, rotulo) {
    let ultima = null;
    await expect.poll(async () => {
        const f = await figurasDoSlide(page, bid);
        ultima = { quantas: f.length, id: f[0]?.id ?? null, sha: f[0]?.sha ?? null, bytes: f[0]?.bytes ?? 0 };
        return ultima.sha;
    }, { timeout: 30000, message: `${rotulo}: a figura do slide não é a do autor` }).toBe(esperado)
        .catch((e) => { throw new Error(`${e.message}\n${JSON.stringify(ultima)}`); });
    return ultima;
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

        // O AUTOR: a figura re-encodada está no banco de imagens dele, uma só, e o slide a cita.
        let figuraDoAutor = null;
        await expect.poll(async () => {
            const f = await figurasDoSlide(A, bid);
            figuraDoAutor = f[0] ?? null;
            return f.length === 1 && Boolean(figuraDoAutor?.sha);
        }, { timeout: 20000 }).toBe(true);
        expect(await conteudoDoSlide(A, bid), 'o slide ainda carrega bytes de figura').not.toMatch(/data:image|blob:/);
        const esperado = figuraDoAutor.sha;
        const noAutor = await decodificar(A, figuraDoAutor.dataUrl);
        console.log(`[slide] figura do autor: ${figuraDoAutor.bytes} bytes, ${JSON.stringify(noAutor)}`);
        expect(noAutor.w, 'a figura colada tem a largura de origem (abaixo do teto de 800)').toBe(120);

        // O SERVIDOR: o slide cita a figura, e a imagem com esse id tem os mesmos bytes.
        await expect.poll(async () => {
            const linha = await collab.db.raw.oneOrNone(
                'SELECT content FROM slides WHERE briefing_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [bid]);
            const id = idsDasFiguras(linha?.content)[0];
            if (!id) return null;
            const imagem = await collab.db.raw.oneOrNone('SELECT content_hash FROM images WHERE id = $1', [id]);
            return imagem?.content_hash ?? null;
        }, { timeout: 30000, message: 'a figura no Postgres não é a do autor' }).toBe(esperado);

        // O COLEGA, no banco de imagens e decodificada.
        const doColega = await esperarFigura(B, bid, esperado, 'colega');
        const noColega = await decodificar(B, (await figurasDoSlide(B, bid))[0].dataUrl);
        expect(noColega).toEqual(noAutor);
        expect(doColega.id, 'o colega cita a mesma imagem').toBe(figuraDoAutor.id);

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
        const noClone = await esperarFigura(A, bidClone, esperado, 'clone');
        // O clone reemite o id de toda imagem (a chave é global), e o slide segue o id novo.
        expect(noClone.id, 'o slide do clone cita a imagem da ORIGEM').not.toBe(figuraDoAutor.id);
    });
});

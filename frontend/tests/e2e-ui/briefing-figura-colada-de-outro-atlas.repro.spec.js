// Path: e2e-ui/briefing-figura-colada-de-outro-atlas.repro.spec.js

/**
 * @fileoverview A FIGURA DE SLIDE COPIADA DE UM ATLAS E COLADA EM OUTRO CHEGA COM OS PIXELS, como
 * figura nova do atlas que a recebe (decisão do dono de 2026-09-26).
 *
 * O DEFEITO. A figura é uma referência (`https://figura.ebgeo/<id>`) aos bytes guardados no atlas
 * onde ela nasceu. Copiada, ela levava para a área de transferência o `<img>` do editor, com o
 * `blob:` desta aba e o id; colada em OUTRO atlas, o colar lia o id e guardava a referência, e o
 * atlas que a recebia não tinha aqueles bytes (nem o servidor os dava, porque a imagem é de outro
 * atlas): a figura aparecia vazia, para sempre.
 *
 * O CONSERTO. O que o Quill chama ao COPIAR (`getSemanticHTML`, e só o copiar o chama: os editores
 * guardam `root.innerHTML`) leva os pixels da figura inline e sem o id, e o colar já sabia o que
 * fazer com uma imagem inline: comprime, guarda como figura nova do atlas corrente e sobe pela fila.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO:
 * - o HTML copiado é lido da área de transferência que o próprio Quill preenche, e reprova se ainda
 *   citar o id ou o `blob:`;
 * - o slide do outro atlas é conferido no DISCO: uma colagem que guardasse a referência de origem
 *   reprova por citar o id antigo;
 * - a imagem nova é conferida no Postgres, sob o atlas que a recebeu;
 * - o editor do outro atlas desenha a figura (largura natural real, não o marcador de 1 pixel).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-figura-colada-de-outro-atlas --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });

const EDITOR = '.briefing-editor-slide-editor .ql-editor';
const SENTINELA = /https:\/\/figura\.ebgeo\/([A-Za-z0-9-]{8,64})/;

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

const conteudoNoDisco = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(id))?.slides ?? [])[0]?.content ?? '';
}, bid);

const temBytes = (page, id) => page.evaluate(async (imageId) => {
    const store = await import('/src/js/store/index.js');
    const blob = await store.getImage(imageId).catch(() => null);
    return blob ? blob.size : 0;
}, id);

/** O `<img>` de figura do editor: de onde ele desenha e se já tem pixels. */
const figuraNaTela = (page) => page.evaluate((sel) => {
    const img = document.querySelector(`${sel} img[data-figura-id]`);
    return img ? { src: img.getAttribute('src').slice(0, 5), largura: img.naturalWidth, id: img.dataset.figuraId } : null;
}, EDITOR);

/** Uma foto de 800 x 600 com textura, em PNG. */
function foto(page) {
    return page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 800;
        c.height = 600;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(800, 600);
        let s = 11;
        for (let i = 0; i < img.data.length; i += 4) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const r = (s / 0x7fffffff) * 60;
            const p = i / 4;
            img.data[i] = (p % 800) / 4 + r; img.data[i + 1] = (p / 800) / 3 + r; img.data[i + 2] = 100 + r; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        return c.toDataURL('image/png');
    });
}

async function colarHtml(page, html) {
    // O editor pode ser recriado logo depois de o briefing nascer (visto uma vez, com o servidor
    // de desenvolvimento frio): a colagem espera o elemento vivo de novo, em vez de achar null.
    await expect(page.locator(EDITOR)).toBeVisible({ timeout: 10000 });
    await page.evaluate(({ seletor, conteudo }) => {
        const editor = document.querySelector(seletor);
        if (!editor) throw new Error(`editor ausente: ${document.querySelector('.briefing-editor-slide-editor') ? 'contêiner sem .ql-editor' : 'sem contêiner'}`);
        editor.focus();
        const dt = new DataTransfer();
        dt.setData('text/html', conteudo);
        dt.setData('text/plain', 'x');
        const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(paste, 'clipboardData', { value: dt });
        editor.dispatchEvent(paste);
    }, { seletor: EDITOR, conteudo: html });
}

/** Seleciona tudo no editor e dispara o COPIAR do Quill, devolvendo o HTML que ele escreveu. */
async function copiarDoEditor(page) {
    await page.locator(EDITOR).click();
    await page.keyboard.press('Control+a');
    return page.evaluate((seletor) => {
        const editor = document.querySelector(seletor);
        const dt = new DataTransfer();
        const copy = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
        Object.defineProperty(copy, 'clipboardData', { value: dt });
        editor.dispatchEvent(copy);
        return dt.getData('text/html');
    }, EDITOR);
}

/** Abre um briefing novo no editor e devolve o id dele. */
async function briefingNovo(page) {
    const antes = new Set(await lerTodosBriefings(page));
    if (!(await page.locator('.briefings-create-btn').isVisible())) await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
    await page.locator('.briefings-create-btn').click();
    await expect(page.locator(EDITOR)).toBeVisible({ timeout: 10000 });
    let bid = null;
    await expect.poll(async () => {
        bid = (await lerTodosBriefings(page)).find((b) => !antes.has(b)) ?? null;
        return bid;
    }, { timeout: 10000 }).toBeTruthy();
    return bid;
}

collabTest.describe('Figura de slide colada de outro atlas', () => {
    collabTest('chega com os pixels, como figura nova do atlas que a recebe', async ({ collab, browser }) => {
        collabTest.setTimeout(300000);
        const A = collab.author;

        // 1. No atlas de origem, uma figura por referência, já desenhada no editor.
        const bidOrigem = await briefingNovo(A);
        process.stdout.write('[figura colada] etapa 1: briefing aberto\n');
        await colarHtml(A, `<p>Origem</p><img src="${await foto(A)}">`);
        let origem = '';
        await expect.poll(async () => {
            origem = await conteudoNoDisco(A, bidOrigem);
            return SENTINELA.test(origem);
        }, { timeout: 20000, message: 'a origem não gravou a figura como referência' }).toBe(true);
        const idOrigem = origem.match(SENTINELA)[1];
        await expect.poll(() => figuraNaTela(A), { timeout: 15000 }).toEqual({ src: 'blob:', largura: 800, id: idOrigem });

        // 2. O COPIAR do Quill leva os pixels, e não a referência.
        const copiado = await copiarDoEditor(A);
        process.stdout.write(`[figura colada] HTML copiado: ${copiado.length} caracteres\n`);
        expect(copiado, 'o copiar não levou os pixels da figura').toMatch(/<img[^>]+src="data:image\/(jpeg|png|webp);base64,/);
        expect(copiado, 'o copiar ainda leva a referência de origem').not.toContain(idOrigem);
        expect(copiado, 'o copiar ainda leva o blob: desta aba').not.toContain('blob:');

        // 3. Outro atlas, de outra conta, em outro navegador: colar ali.
        const seed2 = await seedSharedAtlas(browser, collab.baseUrl, { mapName: 'Outro Atlas' });
        const C = await openClient(browser, collab.baseUrl, seed2.atlasId, seed2.userA, { expectMapName: 'Outro Atlas' });
        try {
            const bidDestino = await briefingNovo(C);
        process.stdout.write('[figura colada] etapa 3: briefing aberto\n');
            await colarHtml(C, copiado);
            let destino = '';
            await expect.poll(async () => {
                destino = await conteudoNoDisco(C, bidDestino);
                return SENTINELA.test(destino);
            }, { timeout: 20000, message: 'o slide do outro atlas não gravou figura nenhuma' }).toBe(true);
            const idDestino = destino.match(SENTINELA)[1];
            expect(idDestino, 'o outro atlas guardou a referência de origem').not.toBe(idOrigem);
            expect(destino, 'o slide do outro atlas guardou bytes inline').not.toMatch(/data:image|blob:/);

            // 4. Os bytes são do atlas que recebeu: no disco dele, no Postgres sob ele, e desenhados.
            expect(await temBytes(C, idDestino), 'o outro atlas não guardou os bytes').toBeGreaterThan(1000);
            await expect.poll(async () => (await collab.db.raw.oneOrNone(
                'SELECT atlas_id FROM images WHERE id = $1', [idDestino]))?.atlas_id ?? null, {
                timeout: 60000, message: 'a figura nova não subiu ao servidor sob o atlas que a recebeu',
            }).toBe(seed2.atlasId);
            await expect.poll(async () => {
                const f = await figuraNaTela(C);
                return f ? [f.src, f.largura > 1, f.id] : null;
            }, { timeout: 15000, message: 'o outro atlas não desenha a figura' }).toEqual(['blob:', true, idDestino]);
            await C.screenshot({ path: collabTest.info().outputPath('figura-colada-no-outro-atlas.png') });
        } finally {
            await C.context().close();
        }
    });
});

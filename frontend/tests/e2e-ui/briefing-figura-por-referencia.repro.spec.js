// Path: e2e-ui/briefing-figura-por-referencia.repro.spec.js

/**
 * @fileoverview A FIGURA DE SLIDE VIAJA UMA VEZ, e o texto escrito ao lado dela viaja sem ela
 * (decisão do dono de 2026-09-26: a figura por referência, com src sentinela `https`).
 *
 * O DEFEITO. A figura morava dentro do HTML do slide como data URL, e o slide viaja INTEIRO na op
 * (`content`): cada autosave de três palavras ao lado de uma figura reenviava a figura, e no link
 * de 40 kbps o colega esperava minutos pelo texto. Agora os bytes vão para o armazém de imagens do
 * atlas e sobem pela fila de blob, e o HTML guarda `https://figura.ebgeo/<id>`.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO:
 * - o conteúdo gravado é conferido no DISCO do autor e do colega, não na tela: um editor que
 *   guardasse o data URL (ou o `blob:` da aba) reprova na primeira asserção;
 * - o tamanho da op do texto digitado DEPOIS da figura é medido no POST `/sync`, que é o custo que
 *   o defeito tinha;
 * - os bytes do colega vêm do servidor e são comparados por SHA-256 com os do autor;
 * - nenhuma página pede o host sentinela: um ponto de desenho que deixasse o sentinela vivo no DOM
 *   faria um pedido por figura, e a lista de pedidos reprova.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-figura-por-referencia --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

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

/** SHA-256 dos bytes que o armazém de imagens da página tem para `id` (buscando no servidor se faltar). */
const shaDaImagem = (page, id) => page.evaluate(async (imageId) => {
    const store = await import('/src/js/store/index.js');
    const blob = await store.getImage(imageId);
    if (!blob) return null;
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}, id);

/** O `<img>` de figura de um contêiner: de onde ele desenha e se já tem pixels. */
const figuraNaTela = (page, seletor) => page.evaluate((sel) => {
    const img = document.querySelector(`${sel} img[data-figura-id]`);
    return img ? { src: img.getAttribute('src').slice(0, 5), largura: img.naturalWidth, id: img.dataset.figuraId } : null;
}, seletor);

/** Uma foto de 800 x 600 com textura, em PNG, codificada pelo navegador. */
function foto(page) {
    return page.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 800;
        c.height = 600;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(800, 600);
        let s = 7;
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
    await page.evaluate(({ seletor, conteudo }) => {
        const editor = document.querySelector(seletor);
        editor.focus();
        const dt = new DataTransfer();
        dt.setData('text/html', conteudo);
        dt.setData('text/plain', 'x');
        const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(paste, 'clipboardData', { value: dt });
        editor.dispatchEvent(paste);
    }, { seletor: EDITOR, conteudo: html });
}

collabTest.describe('Figura de slide por referência', () => {
    collabTest('sobe uma vez, o texto ao lado viaja sem ela, e o colega, o F5 e a apresentação a desenham', async ({ collab }) => {
        collabTest.setTimeout(300000);
        const A = collab.author;
        const B = collab.peers[0];
        const aoSentinela = [];
        for (const page of [A, B]) {
            page.on('request', (r) => { if (SENTINELA.test(r.url())) aoSentinela.push(r.url()); });
        }

        const antes = new Set(await lerTodosBriefings(A));
        if (!(await A.locator('.briefings-create-btn').isVisible())) await A.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await A.locator('.briefings-create-btn').click();
        await expect(A.locator(EDITOR)).toBeVisible({ timeout: 10000 });
        let bid = null;
        await expect.poll(async () => {
            bid = (await lerTodosBriefings(A)).find((b) => !antes.has(b)) ?? null;
            return bid;
        }, { timeout: 10000 }).toBeTruthy();
        // A apresentação recusa slide sem posição salva: o autor a captura antes de tudo.
        await A.locator('.briefing-editor-capture-btn').click();
        await expect.poll(() => A.evaluate(async (id) => {
            const store = await import('/src/js/store/index.js');
            const slide = ((await store.getBriefingById(id))?.slides ?? [])[0];
            return Number.isFinite(slide?.position?.longitude);
        }, bid), { timeout: 15000 }).toBe(true);
        await expect.poll(async () => (await lerTodosBriefings(B)).includes(bid), { timeout: 30000 }).toBe(true);

        // 1. A figura colada é GRAVADA como referência, e o editor do autor a desenha.
        await colarHtml(A, `<p>Figura</p><img src="${await foto(A)}">`);
        let conteudo = '';
        await expect.poll(async () => {
            conteudo = await conteudoNoDisco(A, bid);
            return SENTINELA.test(conteudo);
        }, { timeout: 20000, message: 'o slide não gravou a figura como referência' }).toBe(true);
        expect(conteudo, 'o slide ainda carrega bytes de figura').not.toMatch(/data:image|blob:/);
        const figuraId = conteudo.match(SENTINELA)[1];
        await expect.poll(() => figuraNaTela(A, EDITOR), { timeout: 15000 })
            .toEqual({ src: 'blob:', largura: 800, id: figuraId });

        // 2. O colega recebe a referência e os MESMOS bytes, pelo servidor.
        await expect.poll(async () => (await conteudoNoDisco(B, bid)).match(SENTINELA)?.[1] ?? null, { timeout: 60000,
            message: 'a referência não chegou ao colega' }).toBe(figuraId);
        const shaAutor = await shaDaImagem(A, figuraId);
        expect(shaAutor).toBeTruthy();
        await expect.poll(() => shaDaImagem(B, figuraId), { timeout: 30000,
            message: 'os bytes da figura não chegaram ao colega' }).toBe(shaAutor);

        // 3. O texto digitado DEPOIS da figura viaja sem ela.
        const corpos = [];
        const medir = (r) => {
            if (r.method() === 'POST' && /\/sync$/.test(new URL(r.url()).pathname)) corpos.push(r.postData()?.length ?? 0);
        };
        A.on('request', medir);
        await A.locator(EDITOR).click();
        await A.keyboard.press('Control+End');
        await A.keyboard.type(' TEXTO-DEPOIS-DA-FIGURA');
        await expect.poll(async () => (await conteudoNoDisco(B, bid)).includes('TEXTO-DEPOIS-DA-FIGURA'), { timeout: 30000,
            message: 'o texto digitado depois da figura não chegou ao colega' }).toBe(true);
        A.off('request', medir);
        process.stdout.write(`[figura por referência] ${shaAutor.slice(0, 12)}; corpos do /sync depois da figura: ${JSON.stringify(corpos)}\n`);
        expect(corpos.length, 'nenhum envio medido: o instrumento não viu a op do texto').toBeGreaterThan(0);
        expect(Math.max(...corpos), 'a op do texto ainda carrega a figura').toBeLessThan(20000);
        expect((await conteudoNoDisco(B, bid)).match(SENTINELA)?.[1], 'a edição do texto perdeu a referência').toBe(figuraId);

        // 4. Desfazer e refazer a FIGURA mantêm a referência: o Quill recria o elemento pelo VALOR
        // dele, e o valor de fábrica é o `src` (o `blob:` desta aba). O primeiro desfazer tira o
        // texto, o segundo tira a figura; refazer (Ctrl+Shift+Z, o atalho do Quill fora do Windows)
        // devolve os dois.
        await A.keyboard.press('Control+z');
        await A.keyboard.press('Control+z');
        await expect.poll(() => figuraNaTela(A, EDITOR), { timeout: 5000, message: 'o desfazer não tirou a figura' }).toBeNull();
        await A.keyboard.press('Control+Shift+z');
        await A.keyboard.press('Control+Shift+z');
        await expect.poll(() => figuraNaTela(A, EDITOR), { timeout: 15000, message: 'o refazer não desenhou a figura' })
            .toEqual({ src: 'blob:', largura: 800, id: figuraId });
        await expect.poll(async () => {
            const html = await conteudoNoDisco(A, bid);
            return [html.match(SENTINELA)?.[1] ?? null, html.includes('TEXTO-DEPOIS-DA-FIGURA'), /data:image|blob:/.test(html)];
        }, { timeout: 15000, message: 'desfazer/refazer perdeu a referência' }).toEqual([figuraId, true, false]);

        // 5. Depois do F5, o editor do autor desenha a figura do armazém local.
        await A.locator('.briefing-editor-back-btn').click();
        await A.reload();
        await expect(A.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await A.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
        if (!(await A.locator(`.briefing-card[data-briefing-id="${bid}"]`).isVisible().catch(() => false))) {
            await A.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        }
        await A.locator(`.briefing-card[data-briefing-id="${bid}"] .edit-btn`).click();
        await expect(A.locator(EDITOR)).toBeVisible({ timeout: 15000 });
        await expect.poll(() => figuraNaTela(A, EDITOR), { timeout: 15000 })
            .toEqual({ src: 'blob:', largura: 800, id: figuraId });

        // 6. O colega apresenta: o painel de texto desenha a figura.
        if (!(await B.locator(`.briefing-card[data-briefing-id="${bid}"]`).isVisible().catch(() => false))) {
            await B.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        }
        await B.locator(`.briefing-card[data-briefing-id="${bid}"] .briefing-card-info`).click();
        await expect(B.locator('body')).toHaveClass(/briefing-presenting/, { timeout: 15000 });
        await expect.poll(() => figuraNaTela(B, '.briefing-text-panel__content'), { timeout: 15000 })
            .toEqual({ src: 'blob:', largura: 800, id: figuraId });
        await B.screenshot({ path: collabTest.info().outputPath('apresentacao-com-figura.png') });

        expect(aoSentinela, 'uma página pediu o host sentinela').toEqual([]);
    });
});

// Path: e2e-ui/briefing-editor-figura-do-colega.repro.spec.js

/**
 * @fileoverview O TEXTO RICO DO SLIDE QUE O COLEGA MUDOU E' REDESENHADO SEM PASSAR PELA COLAGEM.
 *
 * O DEFEITO (revisao de `_refreshSlideForm`). A primeira versao montava o conteudo novo com
 * `quill.clipboard.convert({ html })`, que roda os matchers de COLAGEM; um deles
 * (`createPastedImageMatcher`, `utilities/quill-helpers.js`) tira toda figura `data:` do delta e a
 * enfileira como COLADA. Um tick depois a fila pede `quill.getSelection(true)` (ROUBA o foco de onde
 * a pessoa esta digitando), recomprime a figura e a reinsere com origem 'user' no ultimo cursor, e
 * apaga o trecho que estava selecionado. O text-change grava, o autosave envia, e o editor do colega
 * faz o mesmo ao receber: um ciclo entre os dois editores, com a figura mudando de lugar e o base64
 * inteiro viajando a cada volta.
 *
 * O GESTO: A cola um texto com FIGURA no slide e deixa uma palavra selecionada no texto rico; A vai
 * para o campo de titulo; B acrescenta texto ao conteudo. O veredito: o foco de A continua no
 * titulo, o texto de A nao perde a palavra selecionada, a figura continua uma so', e a versao do
 * slide no servidor para de andar (sem ciclo).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-editor-figura-do-colega --retries=0 --workers=1
 */

import zlib from 'node:zlib';
import { collabTest, expect } from './helpers/collab.fixtures.js';

const B64 = globalThis.Buffer;

function crc32(buf) {
    let c = ~0;
    for (const b of buf) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
}

function chunk(type, data) {
    const len = B64.alloc(4);
    len.writeUInt32BE(data.length);
    const td = B64.concat([B64.from(type, 'ascii'), data]);
    const crc = B64.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return B64.concat([len, td, crc]);
}

/** Um PNG cinza pequeno, valido. */
function pngCinza(width, height) {
    const ihdr = B64.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 0;
    const linha = width + 1;
    const raw = B64.alloc(linha * height, 0x80);
    for (let y = 0; y < height; y++) raw[y * linha] = 0;
    return B64.concat([
        B64.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', B64.alloc(0)),
    ]);
}

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

const conteudoNoDisco = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(id))?.slides ?? [])[0]?.content ?? '';
}, bid);

const slideNoServidor = (db, bid) =>
    db.raw.oneOrNone('SELECT id, content, version FROM slides WHERE briefing_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [bid]);

const figuras = (html) => (String(html).match(/<img\b/g) ?? []).length;

collabTest.describe('Texto rico com figura e a edicao do colega', () => {
    collabTest('B acrescenta texto: A nao perde o foco, a palavra selecionada nem a figura, e nao ha ciclo', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];

        // A cria o briefing; o slide nasce selecionado.
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

        // A cola texto com uma figura embutida (a porta de colagem de HTML).
        await expect(A.locator('.briefing-editor-slide-editor .ql-editor')).toBeVisible({ timeout: 10000 });
        const src = `data:image/png;base64,${pngCinza(40, 30).toString('base64')}`;
        await A.evaluate(({ conteudo }) => {
            const editor = document.querySelector('.briefing-editor-slide-editor .ql-editor');
            editor.focus();
            const dt = new DataTransfer();
            dt.setData('text/html', conteudo);
            dt.setData('text/plain', 'x');
            const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(paste, 'clipboardData', { value: dt });
            editor.dispatchEvent(paste);
        }, { conteudo: `<p>Palavra selecionada fica</p><img src="${src}">` });
        await expect.poll(async () => figuras((await slideNoServidor(collab.db, bid))?.content), { timeout: 20000 }).toBe(1);
        await expect.poll(async () => figuras(await conteudoNoDisco(B, bid)), { timeout: 20000 }).toBe(1);

        // B abre o mesmo slide.
        if (!(await B.locator('.briefings-create-btn').isVisible())) await B.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await B.locator(`.briefing-card[data-briefing-id="${bid}"] .edit-btn`).click();
        await expect(B.locator('#briefing-editor .ql-editor')).toContainText('Palavra selecionada fica', { timeout: 10000 });

        // A deixa a palavra "Palavra" SELECIONADA no texto rico e vai para o titulo.
        await A.locator('.briefing-editor-slide-editor .ql-editor p').first().click();
        await A.keyboard.press('Control+Home');
        await A.keyboard.press('Shift+Control+ArrowRight');
        await A.locator('.briefing-editor-slide-title-input').click();
        await A.keyboard.press('End');

        // B acrescenta texto ao conteudo.
        await B.locator('#briefing-editor .ql-editor p').first().click();
        await B.keyboard.press('End');
        await B.keyboard.type(' e o B');
        await expect.poll(async () => (await conteudoNoDisco(A, bid)), { timeout: 20000 }).toContain(' e o B');

        // Deixa passar tempo bastante para um ciclo aparecer (varias janelas de autosave e envio).
        const v1 = (await slideNoServidor(collab.db, bid))?.version;
        await A.waitForTimeout(8000);
        const v2 = (await slideNoServidor(collab.db, bid))?.version;
        const final = await conteudoNoDisco(A, bid);
        const foco = await A.evaluate(() => document.activeElement?.className ?? null);
        console.log(`\n===== RETRATO =====\n${JSON.stringify({ v1, v2, foco, figuras: figuras(final), final: final.replace(/base64,[^"]+/g, 'base64,...') }, null, 2)}\n`);

        expect.soft(foco, 'o foco de A continua no campo de titulo').toContain('briefing-editor-slide-title-input');
        expect.soft(final, 'a palavra que estava selecionada continua no texto de A').toContain('Palavra selecionada fica');
        expect.soft(final, 'o acrescimo de B continua no texto de A').toContain(' e o B');
        expect.soft(figuras(final), 'a figura continua uma so').toBe(1);
        expect.soft(v2, 'a versao do slide no servidor parou de andar (sem ciclo entre os editores)').toBe(v1);
        await expect.soft(A.locator('.briefing-editor-slide-title-input'), 'o titulo nao recebeu nada').toHaveValue('Com figura');
    });
});

// Path: e2e-ui/briefing-editor-campo-com-foco.repro.spec.js

/**
 * @fileoverview O CAMPO DO EDITOR DE BRIEFING QUE O COLEGA MUDOU MOSTRA O VALOR NOVO, e a proxima
 * tecla nao grava o texto velho por cima dele.
 *
 * O DEFEITO (achado na revisao do conserto da copia velha). O editor passou a adotar na MEMORIA o
 * que um colega grava (`rebaseBriefingEdits`), mas so' redesenhava o formulario do slide quando o
 * foco estava FORA dele. Com o cursor no texto rico do slide S, o titulo que o colega corrigiu
 * continuava VELHO no campo de titulo; clicar nele e digitar faz `slide.title = input.value`
 * (velho mais a tecla), e o autosave grava isso por cima da correcao do colega. O mesmo com os
 * papeis trocados: foco no titulo, colega muda o texto, e a primeira tecla no texto rico grava o
 * conteudo velho mais a tecla.
 *
 * O GESTO, todo pela tela, com o veredito no Postgres (a linha do slide).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-editor-campo-com-foco --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const lerBriefing = (page, id) => page.evaluate(async (bid) => {
    const store = await import('/src/js/store/index.js');
    const b = await store.getBriefingById(bid);
    return b ? { slides: (b.slides || []).map((s) => ({ id: s.id, titulo: s.title, conteudo: s.content })) } : null;
}, id);

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

const slideNoServidor = (db, slideId) =>
    db.raw.oneOrNone('SELECT title, content FROM slides WHERE id = $1 AND deleted_at IS NULL', [slideId]);

async function abrirAbaBriefings(page) {
    const botao = page.locator('.briefings-create-btn');
    if (!(await botao.isVisible())) await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
    await expect(botao).toBeVisible({ timeout: 10000 });
}

async function criarBriefingUI(page) {
    const antes = new Set(await lerTodosBriefings(page));
    await abrirAbaBriefings(page);
    await page.locator('.briefings-create-btn').click();
    await expect(page.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
    let id = null;
    await expect.poll(async () => {
        id = (await lerTodosBriefings(page)).find((b) => !antes.has(b)) ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    return id;
}

async function abrirEditorPeloCartaoUI(page, bid) {
    await abrirAbaBriefings(page);
    const cartao = page.locator(`.briefing-card[data-briefing-id="${bid}"]`);
    await expect(cartao).toBeVisible({ timeout: 15000 });
    await cartao.locator('.edit-btn').click();
    await expect(page.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
}

/** A e B com o MESMO slide aberto no editor, titulo "Um" e texto "Texto base". */
async function palco(collab) {
    const A = collab.author;
    const B = collab.peers[0];
    const bid = await criarBriefingUI(A);
    let s = null;
    await expect.poll(async () => {
        s = ((await lerBriefing(A, bid))?.slides ?? [])[0]?.id ?? null;
        return s;
    }, { timeout: 10000 }).toBeTruthy();
    await A.locator(`.briefing-editor-slide-card[data-slide-id="${s}"]`).click();
    await A.locator('.briefing-editor-slide-title-input').fill('Um');
    await A.locator('.briefing-editor-slide-title-input').blur();
    await A.locator('.ql-editor').click();
    await A.keyboard.type('Texto base');
    await expect.poll(async () => (await slideNoServidor(collab.db, s))?.content ?? '', { timeout: 20000 })
        .toContain('Texto base');
    await expect.poll(async () => (await slideNoServidor(collab.db, s))?.title, { timeout: 20000 }).toBe('Um');
    await expect.poll(async () => ((await lerBriefing(B, bid))?.slides ?? [])[0]?.conteudo ?? '', { timeout: 20000 })
        .toContain('Texto base');
    await abrirEditorPeloCartaoUI(B, bid);
    await B.locator(`.briefing-editor-slide-card[data-slide-id="${s}"]`).click();
    await expect(B.locator('.briefing-editor-slide-title-input')).toHaveValue('Um', { timeout: 10000 });
    return { A, B, bid, s };
}

collabTest.describe('Campo com foco no editor de briefing e a edicao do colega', () => {
    collabTest('cursor no texto rico, colega corrige o TITULO: a proxima tecla no titulo parte do valor do colega', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const { A, B, bid, s } = await palco(collab);

        // A fica com o cursor no texto rico do slide.
        await A.locator('.ql-editor').click();

        // B corrige o titulo.
        await B.locator('.briefing-editor-slide-title-input').fill('Um (corrigido pelo B)');
        await B.locator('.briefing-editor-slide-title-input').blur();
        await expect.poll(async () => (await slideNoServidor(collab.db, s))?.title, { timeout: 20000 })
            .toBe('Um (corrigido pelo B)');
        await expect.poll(async () => ((await lerBriefing(A, bid))?.slides ?? [])[0]?.titulo, { timeout: 20000 })
            .toBe('Um (corrigido pelo B)');

        // O campo de titulo de A mostra o valor do colega...
        const campoA = A.locator('.briefing-editor-slide-title-input');
        await expect.soft(campoA, 'o campo de titulo de A mostra o titulo de B').toHaveValue('Um (corrigido pelo B)', { timeout: 5000 });
        // ...e A acrescenta ao titulo, pela tela.
        await campoA.click();
        await A.keyboard.press('End');
        await A.keyboard.type(' e o A');
        await campoA.blur();
        await expect.poll(async () => (await slideNoServidor(collab.db, s))?.title, { timeout: 20000 })
            .not.toBe('Um (corrigido pelo B)');
        const final = (await slideNoServidor(collab.db, s))?.title;
        console.log(`\n===== TITULO FINAL NO SERVIDOR: ${final} =====\n`);
        expect(final, 'o titulo de B continua, com o acrescimo de A').toBe('Um (corrigido pelo B) e o A');
    });

    collabTest('cursor no titulo, colega muda o TEXTO: a proxima tecla no texto rico parte do texto do colega', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const { A, B, bid, s } = await palco(collab);

        // A fica com o cursor no titulo.
        await A.locator('.briefing-editor-slide-title-input').click();

        // B acrescenta ao texto.
        await B.locator('.ql-editor').click();
        await B.keyboard.press('Control+End');
        await B.keyboard.type(' do B');
        await expect.poll(async () => (await slideNoServidor(collab.db, s))?.content ?? '', { timeout: 20000 })
            .toContain('Texto base do B');
        await expect.poll(async () => ((await lerBriefing(A, bid))?.slides ?? [])[0]?.conteudo ?? '', { timeout: 20000 })
            .toContain('Texto base do B');

        // O texto rico de A mostra o texto do colega...
        await expect.soft(A.locator('.ql-editor'), 'o texto rico de A mostra o texto de B').toContainText('Texto base do B', { timeout: 5000 });
        // ...e A acrescenta ao texto, pela tela.
        await A.locator('.ql-editor').click();
        await A.keyboard.press('Control+End');
        await A.keyboard.type(' e do A');
        await expect.poll(async () => (await slideNoServidor(collab.db, s))?.content ?? '', { timeout: 20000 })
            .toContain('e do A');
        const final = (await slideNoServidor(collab.db, s))?.content;
        console.log(`\n===== TEXTO FINAL NO SERVIDOR: ${final} =====\n`);
        expect(final, 'o texto de B continua, com o acrescimo de A').toContain('Texto base do B e do A');
    });
});

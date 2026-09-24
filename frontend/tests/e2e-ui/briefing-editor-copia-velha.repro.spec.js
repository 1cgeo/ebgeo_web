// Path: e2e-ui/briefing-editor-copia-velha.repro.spec.js

/**
 * @fileoverview O EDITOR DE BRIEFING ABERTO GRAVA A COPIA QUE LEU NA ABERTURA, e apaga o
 * trabalho do colega.
 *
 * O DEFEITO. `BriefingEditorControl.open` le o briefing UMA vez para `this._briefing`, e o
 * autosave (`_save`) grava `updateBriefing(id, { name, slides: this._briefing.slides, settings })`,
 * isto e', a lista de slides INTEIRA daquela copia em memoria. O editor nao assina a chegada de
 * uma op remota, entao a copia dele nunca aprende o que um colega fez depois da abertura. A store
 * (`writeBriefing`, `store/briefing.operations.js`) compara essa lista com o que esta no DISCO,
 * que ja' recebeu a op do colega, e deriva as ops de slide pela diferenca: o slide que o colega
 * criou nao esta na lista velha e vira um DELETE; o slide que o colega editou volta ao texto velho
 * por um UPDATE. As duas ops sobem ao servidor, que as aplica. Nao e' corrida: basta os dois
 * estarem com o mesmo briefing aberto, e o dono da copia velha mexer em QUALQUER coisa (o nome do
 * briefing, o titulo de outro slide) depois da edicao do colega.
 *
 * COMO ESTE ARQUIVO MEDE. Duas browsers reais no mesmo atlas de servidor, todo gesto pela tela
 * (criar briefing, adicionar slide, titulo do slide, abrir o editor pelo cartao, nome do
 * briefing), e o veredito lido nos TRES lugares: o Postgres (a tabela `slides`, com a lapide
 * `deleted_at`), o disco do autor da edicao e o disco de quem estava com a copia velha.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-editor-copia-velha --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

// --- LEITURAS DE ASSERCAO (sem tela para "afirmar") ---------------------------

const lerBriefing = (page, id) => page.evaluate(async (bid) => {
    const store = await import('/src/js/store/index.js');
    const b = await store.getBriefingById(bid);
    return b ? { nome: b.name, slides: (b.slides || []).map((s) => ({ id: s.id, titulo: s.title })) } : null;
}, id);

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

/** Os slides VIVOS do briefing no servidor (sem lapide), com titulo. */
const slidesNoServidor = (db, briefingId) => db.raw.any(
    'SELECT id, title, deleted_at FROM slides WHERE briefing_id = $1 ORDER BY created_at',
    [briefingId],
);

// --- GESTOS REAIS -------------------------------------------------------------

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

async function adicionarSlideUI(page, bid) {
    const antes = new Set(((await lerBriefing(page, bid))?.slides ?? []).map((s) => s.id));
    await page.locator('.briefing-editor-add-slide-btn[title="Adicionar slide"]').click();
    let id = null;
    await expect.poll(async () => {
        id = ((await lerBriefing(page, bid))?.slides ?? []).find((s) => !antes.has(s.id))?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    // O slide novo vira o selecionado, e o campo de titulo e' o dele.
    await expect(page.locator(`.briefing-editor-slide-card[data-slide-id="${id}"]`)).toBeVisible({ timeout: 10000 });
    return id;
}

async function selecionarSlideUI(page, slideId) {
    await page.locator(`.briefing-editor-slide-card[data-slide-id="${slideId}"]`).click();
    await expect(page.locator('.briefing-editor-slide-title-input')).toBeVisible({ timeout: 5000 });
}

/** Digita o titulo do slide SELECIONADO e espera o autosave chegar ao disco. */
async function tituloDoSlideUI(page, bid, slideId, titulo) {
    const campo = page.locator('.briefing-editor-slide-title-input');
    await expect(campo).toBeVisible({ timeout: 5000 });
    await campo.fill(titulo);
    await campo.blur();
    await expect.poll(async () => ((await lerBriefing(page, bid))?.slides ?? []).find((s) => s.id === slideId)?.titulo,
        { timeout: 15000, message: 'o autosave do titulo nunca chegou ao disco do autor' }).toBe(titulo);
}

/** Digita o nome do briefing e espera o autosave chegar ao disco. */
async function nomeDoBriefingUI(page, bid, nome) {
    const campo = page.locator('.briefing-editor-name-input');
    await expect(campo).toBeVisible({ timeout: 5000 });
    await campo.fill(nome);
    await campo.blur();
    await expect.poll(async () => (await lerBriefing(page, bid))?.nome,
        { timeout: 15000, message: 'o autosave do nome nunca chegou ao disco' }).toBe(nome);
}

async function abrirEditorPeloCartaoUI(page, bid) {
    await abrirAbaBriefings(page);
    const cartao = page.locator(`.briefing-card[data-briefing-id="${bid}"]`);
    await expect(cartao).toBeVisible({ timeout: 15000 });
    await cartao.locator('.edit-btn').click();
    await expect(page.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
}

/**
 * Prepara o palco comum: A cria um briefing com um slide "Um", B o recebe e abre o editor dele.
 * Devolve os ids. A fica com o editor aberto no slide "Um".
 */
async function palco(collab) {
    const A = collab.author;
    const B = collab.peers[0];
    const bid = await criarBriefingUI(A);
    await nomeDoBriefingUI(A, bid, 'Plano Conjunto');
    // O briefing nasce com UM slide vazio, ja' selecionado no editor de A.
    let s1 = null;
    await expect.poll(async () => {
        s1 = ((await lerBriefing(A, bid))?.slides ?? [])[0]?.id ?? null;
        return s1;
    }, { timeout: 10000, message: 'o briefing novo nao nasceu com um slide' }).toBeTruthy();
    await selecionarSlideUI(A, s1);
    await tituloDoSlideUI(A, bid, s1, 'Um');
    await expect.poll(async () => ((await lerBriefing(B, bid))?.slides ?? []).map((s) => s.titulo),
        { timeout: 20000, message: 'B nunca recebeu o slide "Um"' }).toEqual(['Um']);
    await abrirEditorPeloCartaoUI(B, bid);
    await expect(B.locator(`.briefing-editor-slide-card[data-slide-id="${s1}"]`)).toBeVisible({ timeout: 10000 });
    return { A, B, bid, s1 };
}

collabTest.describe('Editor de briefing aberto nao apaga o trabalho do colega', () => {
    collabTest('slide que o colega CRIOU sobrevive a uma edicao do nome feita no editor aberto antes', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const { A, B, bid, s1 } = await palco(collab);

        // A cria o slide "Dois" DEPOIS de B ja' estar com o editor aberto.
        const s2 = await adicionarSlideUI(A, bid);
        await tituloDoSlideUI(A, bid, s2, 'Dois');
        await expect.poll(async () => ((await slidesNoServidor(collab.db, bid)).filter((r) => !r.deleted_at)).map((r) => r.title),
            { timeout: 20000, message: 'o servidor nunca recebeu o slide "Dois"' }).toEqual(['Um', 'Dois']);
        await expect.poll(async () => ((await lerBriefing(B, bid))?.slides ?? []).map((s) => s.titulo),
            { timeout: 20000, message: 'o disco de B nunca recebeu o slide "Dois"' }).toEqual(['Um', 'Dois']);

        // B, com o editor aberto desde antes, mexe SO no nome do briefing.
        await nomeDoBriefingUI(B, bid, 'Plano Conjunto (revisado)');
        await expect.poll(async () => (await collab.db.raw.oneOrNone('SELECT name FROM briefings WHERE id = $1', [bid]))?.name,
            { timeout: 20000, message: 'o nome novo nunca chegou ao servidor' }).toBe('Plano Conjunto (revisado)');
        // O nome chega a A pelo mesmo envelope, entao esperar por ele em A e' esperar o efeito inteiro.
        await expect.poll(async () => (await lerBriefing(A, bid))?.nome, { timeout: 20000 }).toBe('Plano Conjunto (revisado)');

        const servidor = await slidesNoServidor(collab.db, bid);
        const discoA = await lerBriefing(A, bid);
        const discoB = await lerBriefing(B, bid);
        console.log(`\n===== RETRATO (slide criado) =====\n${JSON.stringify({ s1, s2, servidor, discoA, discoB }, null, 2)}\n`);

        expect.soft(servidor.filter((r) => !r.deleted_at).map((r) => r.id), 'slides vivos no servidor').toEqual([s1, s2]);
        expect.soft(discoA.slides.map((s) => s.titulo), 'slides no disco de A, autor do slide "Dois"').toEqual(['Um', 'Dois']);
        expect.soft(discoB.slides.map((s) => s.titulo), 'slides no disco de B').toEqual(['Um', 'Dois']);
        // E a tela de B passa a mostrar o slide do colega, em vez de continuar sem ele.
        await expect.soft(B.locator(`.briefing-editor-slide-card[data-slide-id="${s2}"]`), 'o cartao do slide "Dois" no editor de B')
            .toBeVisible({ timeout: 10000 });
    });

    collabTest('titulo que o colega EDITOU sobrevive a uma edicao de outro slide feita no editor aberto antes', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const { A, B, bid, s1 } = await palco(collab);

        // B cria um segundo slide (B relê o disco nesse gesto) e o deixa selecionado.
        const s2 = await adicionarSlideUI(B, bid);
        await expect.poll(async () => ((await lerBriefing(A, bid))?.slides ?? []).length,
            { timeout: 20000, message: 'A nunca recebeu o slide de B' }).toBe(2);

        // A reescreve o titulo do slide "Um" enquanto o editor de B continua aberto.
        await selecionarSlideUI(A, s1);
        await tituloDoSlideUI(A, bid, s1, 'Um (versao do A)');
        await expect.poll(async () => (await slidesNoServidor(collab.db, bid)).find((r) => r.id === s1)?.title,
            { timeout: 20000, message: 'o titulo de A nunca chegou ao servidor' }).toBe('Um (versao do A)');
        await expect.poll(async () => ((await lerBriefing(B, bid))?.slides ?? []).find((s) => s.id === s1)?.titulo,
            { timeout: 20000, message: 'o disco de B nunca recebeu o titulo de A' }).toBe('Um (versao do A)');

        // B edita o titulo do SEU slide, que e' outro.
        await tituloDoSlideUI(B, bid, s2, 'Dois (do B)');
        await expect.poll(async () => (await slidesNoServidor(collab.db, bid)).find((r) => r.id === s2)?.title,
            { timeout: 20000, message: 'o titulo de B nunca chegou ao servidor' }).toBe('Dois (do B)');
        await expect.poll(async () => ((await lerBriefing(A, bid))?.slides ?? []).find((s) => s.id === s2)?.titulo,
            { timeout: 20000 }).toBe('Dois (do B)');

        const servidor = await slidesNoServidor(collab.db, bid);
        const discoA = await lerBriefing(A, bid);
        const discoB = await lerBriefing(B, bid);
        console.log(`\n===== RETRATO (titulo editado) =====\n${JSON.stringify({ s1, s2, servidor, discoA, discoB }, null, 2)}\n`);

        expect.soft(servidor.find((r) => r.id === s1)?.title, 'titulo do slide "Um" no servidor').toBe('Um (versao do A)');
        expect.soft(discoA.slides.find((s) => s.id === s1)?.titulo, 'titulo do slide "Um" no disco de A').toBe('Um (versao do A)');
        expect.soft(discoB.slides.find((s) => s.id === s1)?.titulo, 'titulo do slide "Um" no disco de B').toBe('Um (versao do A)');
    });
});

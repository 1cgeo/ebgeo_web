// Path: e2e-ui/briefing-slides-concorrentes.repro.spec.js

/**
 * @fileoverview DOIS USUARIOS EDITANDO SLIDES DIFERENTES DO MESMO BRIEFING AO MESMO TEMPO.
 *
 * A HIPOTESE. O servidor guarda cada slide numa linha propria (`slides`) e aplica as ops de slide
 * uma a uma, entao duas edicoes em slides DIFERENTES convivem la'. O par, porem, ignora a op de
 * slide ao vivo (`EntityType.SLIDE` e' no-op em `applyRemoteOperationInner`) e converge pelo
 * envelope do briefing, que carrega a lista de slides INTEIRA de quem o mandou e substitui a do par
 * em bloco (`applyRemoteBriefingOp`), sob LWW por versao do servidor. O envelope de B foi montado
 * antes de B saber da edicao de A, e traz o slide de A no texto VELHO: ao chegar, ele apaga a
 * edicao de A da tela e do disco de A, enquanto o Postgres a guarda. Os clientes e o servidor
 * divergem ate' o proximo F5, e quem editar a partir da tela nesse meio grava sobre o valor velho.
 *
 * A INTERLEAVING E' DETERMINISTICA: o envio de B fica RETIDO (`page.route` sobre o POST de sync)
 * enquanto A edita e o servidor confirma; so' entao o envio de B e' solto. E' a mesma ordem que duas
 * pessoas digitando dentro da mesma janela de 1,5 s de envio produzem por acaso.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-slides-concorrentes --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const lerBriefing = (page, id) => page.evaluate(async (bid) => {
    const store = await import('/src/js/store/index.js');
    const b = await store.getBriefingById(bid);
    return b ? { nome: b.name, slides: (b.slides || []).map((s) => ({ id: s.id, titulo: s.title })) } : null;
}, id);

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

const tituloNoServidor = async (db, slideId) =>
    (await db.raw.oneOrNone('SELECT title FROM slides WHERE id = $1 AND deleted_at IS NULL', [slideId]))?.title ?? null;

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
    await expect(page.locator(`.briefing-editor-slide-card[data-slide-id="${id}"]`)).toBeVisible({ timeout: 10000 });
    return id;
}

async function selecionarSlideUI(page, slideId) {
    await page.locator(`.briefing-editor-slide-card[data-slide-id="${slideId}"]`).click();
    await expect(page.locator('.briefing-editor-slide-title-input')).toBeVisible({ timeout: 5000 });
}

async function tituloDoSlideUI(page, bid, slideId, titulo) {
    const campo = page.locator('.briefing-editor-slide-title-input');
    await expect(campo).toBeVisible({ timeout: 5000 });
    await campo.fill(titulo);
    await campo.blur();
    await expect.poll(async () => ((await lerBriefing(page, bid))?.slides ?? []).find((s) => s.id === slideId)?.titulo,
        { timeout: 15000, message: 'o autosave do titulo nunca chegou ao disco do autor' }).toBe(titulo);
}

async function abrirEditorPeloCartaoUI(page, bid) {
    await abrirAbaBriefings(page);
    const cartao = page.locator(`.briefing-card[data-briefing-id="${bid}"]`);
    await expect(cartao).toBeVisible({ timeout: 15000 });
    await cartao.locator('.edit-btn').click();
    await expect(page.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
}

collabTest.describe('Slides diferentes editados ao mesmo tempo convergem nos clientes e no servidor', () => {
    collabTest('a edicao de A no slide "Um" sobrevive ao envelope de B, montado antes dela', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];

        // Palco: briefing com dois slides, "Um" e "Dois", nos dois clientes, B com o editor aberto.
        const bid = await criarBriefingUI(A);
        let s1 = null;
        await expect.poll(async () => {
            s1 = ((await lerBriefing(A, bid))?.slides ?? [])[0]?.id ?? null;
            return s1;
        }, { timeout: 10000 }).toBeTruthy();
        await selecionarSlideUI(A, s1);
        await tituloDoSlideUI(A, bid, s1, 'Um');
        const s2 = await adicionarSlideUI(A, bid);
        await tituloDoSlideUI(A, bid, s2, 'Dois');
        await expect.poll(async () => ((await lerBriefing(B, bid))?.slides ?? []).map((s) => s.titulo),
            { timeout: 20000, message: 'B nunca recebeu os dois slides' }).toEqual(['Um', 'Dois']);
        await expect.poll(() => tituloNoServidor(collab.db, s2), { timeout: 20000 }).toBe('Dois');
        await abrirEditorPeloCartaoUI(B, bid);
        await selecionarSlideUI(B, s2);
        await selecionarSlideUI(A, s1);

        // O envio de B fica RETIDO a partir daqui.
        let soltar;
        const portao = new Promise((resolve) => { soltar = resolve; });
        let retidos = 0;
        await B.route('**/atlas/*/sync', async (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            retidos += 1;
            await portao;
            return route.continue();
        });

        // B edita o SEU slide; a op fica presa no envio.
        await tituloDoSlideUI(B, bid, s2, 'Dois (do B)');
        await expect.poll(() => retidos, { timeout: 15000, message: 'o envio de B nunca saiu' }).toBeGreaterThan(0);

        // A edita o slide "Um" e o servidor confirma.
        await tituloDoSlideUI(A, bid, s1, 'Um (do A)');
        await expect.poll(() => tituloNoServidor(collab.db, s1), { timeout: 20000 }).toBe('Um (do A)');

        // Solta o envio de B.
        soltar();
        await expect.poll(() => tituloNoServidor(collab.db, s2), { timeout: 20000 }).toBe('Dois (do B)');
        await expect.poll(async () => ((await lerBriefing(A, bid))?.slides ?? []).find((s) => s.id === s2)?.titulo,
            { timeout: 20000, message: 'A nunca recebeu a edicao de B' }).toBe('Dois (do B)');

        // O envelope de B ja' chegou a A. O que cada um guarda agora:
        const servidor = { um: await tituloNoServidor(collab.db, s1), dois: await tituloNoServidor(collab.db, s2) };
        const discoA = await lerBriefing(A, bid);
        const discoB = await lerBriefing(B, bid);
        console.log(`\n===== RETRATO =====\n${JSON.stringify({ servidor, discoA, discoB }, null, 2)}\n`);

        expect(servidor, 'o servidor guarda as duas edicoes').toEqual({ um: 'Um (do A)', dois: 'Dois (do B)' });
        // A convergencia e' do cliente com o servidor, e ela tem de acontecer sem F5.
        await expect.poll(async () => ((await lerBriefing(A, bid))?.slides ?? []).map((s) => s.titulo),
            { timeout: 15000, message: 'o disco de A divergiu do servidor' }).toEqual(['Um (do A)', 'Dois (do B)']);
        await expect.poll(async () => ((await lerBriefing(B, bid))?.slides ?? []).map((s) => s.titulo),
            { timeout: 15000, message: 'o disco de B divergiu do servidor' }).toEqual(['Um (do A)', 'Dois (do B)']);
    });
});

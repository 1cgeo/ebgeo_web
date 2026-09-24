// Path: e2e-ui/briefing-editor-titulo-apos-excluir.repro.spec.js

/**
 * @fileoverview DEPOIS DE EXCLUIR OUTRO SLIDE, O TITULO DIGITADO NO SLIDE SELECIONADO E' SALVO.
 *
 * O DEFEITO (uma pessoa so'). `_handleDeleteSlide` trocava `this._briefing` por uma leitura nova do
 * disco e redesenhava so' a LISTA; o formulario do slide selecionado continuava ligado ao objeto de
 * slide ANTERIOR (o campo de titulo fecha sobre ele: `slide.title = input.value`). Digitar no titulo
 * mudava um objeto que nada mais salvava: o cartao da lista mostrava o titulo novo e o disco nunca
 * o recebia. O conserto da copia velha (`rebaseBriefingEdits`, que reconcilia a memoria no lugar e
 * mantem cada objeto de slide vivo) fechou isto junto; este arquivo prende a metade de um usuario.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-editor-titulo-apos-excluir --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const lerSlides = (page, id) => page.evaluate(async (bid) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(bid))?.slides ?? []).map((s) => ({ id: s.id, titulo: s.title }));
}, id);

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

collabTest.describe('Editor de briefing, uma pessoa', () => {
    collabTest('excluir OUTRO slide nao desliga o campo de titulo do slide selecionado', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author;

        const antes = new Set(await lerTodosBriefings(A));
        if (!(await A.locator('.briefings-create-btn').isVisible())) await A.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await A.locator('.briefings-create-btn').click();
        await expect(A.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
        let bid = null;
        await expect.poll(async () => {
            bid = (await lerTodosBriefings(A)).find((b) => !antes.has(b)) ?? null;
            return bid;
        }, { timeout: 10000 }).toBeTruthy();

        // Dois slides a mais; o ultimo adicionado fica selecionado.
        for (let i = 0; i < 2; i++) {
            const n = (await lerSlides(A, bid)).length;
            await A.locator('.briefing-editor-add-slide-btn[title="Adicionar slide"]').click();
            await expect.poll(async () => (await lerSlides(A, bid)).length, { timeout: 10000 }).toBe(n + 1);
        }
        const slides = await lerSlides(A, bid);
        const primeiro = slides[0].id;
        const selecionado = slides[slides.length - 1].id;
        await expect(A.locator(`.briefing-editor-slide-card[data-slide-id="${selecionado}"]`)).toHaveAttribute('data-selected', 'true');

        // Exclui o PRIMEIRO slide (nao o selecionado).
        await A.locator(`.briefing-editor-slide-card[data-slide-id="${primeiro}"] .briefing-editor-slide-delete-btn`).click();
        await A.locator('.confirm-modal-overlay .confirm-modal-btn-confirm').click();
        await expect.poll(async () => (await lerSlides(A, bid)).length, { timeout: 10000 }).toBe(slides.length - 1);

        // Digita o titulo do slide que continua selecionado.
        const campo = A.locator('.briefing-editor-slide-title-input');
        await campo.fill('Titulo depois de excluir');
        await campo.blur();
        await expect.poll(async () => (await lerSlides(A, bid)).find((s) => s.id === selecionado)?.titulo,
            { timeout: 15000, message: 'o titulo digitado depois da exclusao nunca chegou ao disco' }).toBe('Titulo depois de excluir');
    });
});

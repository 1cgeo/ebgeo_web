// Path: e2e-ui/briefing-lista-com-marcadores.repro.spec.js

/**
 * @fileoverview A LISTA COM MARCADORES DO SLIDE CONTINUA COM MARCADORES AO REABRIR.
 *
 * O DEFEITO. O Quill 2 escreve toda lista como `<ol>` e distingue o tipo por atributo:
 * `<li data-list="bullet">`. A configuracao do DOMPurify da casa (`QUILL_DOMPURIFY_CONFIG`,
 * `utilities/quill-helpers.js`) tem `ALLOW_DATA_ATTR: false` e nao listava `data-list`, entao todo
 * conteudo que passa por `sanitizeQuillHtml` perde o tipo da lista: o editor, ao reabrir o slide,
 * le `<ol><li>` sem tipo e o Quill descarta a lista do modelo (o Delta volta sem o atributo
 * `list`), e a apresentacao desenha um `<ol>` nativo, isto e', NUMERADO. Medido por sonda: o
 * sanitize devolvia `<ol><li>um</li>...` e o Delta vinha `{ insert: 'um\ndois\n' }`. Listar o
 * atributo NAO bastou (medido): com atributos de dado desligados o DOMPurify confere o VALOR do
 * atributo listado contra `ALLOWED_URI_REGEXP`, e "bullet" nao e' URI; ele entra tambem em
 * `ADD_URI_SAFE_ATTR`.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-lista-com-marcadores --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

const conteudoNoDisco = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(id))?.slides ?? [])[0]?.content ?? '';
}, bid);

collabTest.describe('Lista com marcadores no slide', () => {
    collabTest('reaberto o editor, a lista continua com marcadores', async ({ collab }) => {
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

        // Uma lista com marcadores, pela barra do editor.
        const editor = A.locator('.briefing-editor-slide-editor .ql-editor');
        await expect(editor).toBeVisible({ timeout: 10000 });
        await editor.click();
        await A.keyboard.type('primeiro item');
        await A.locator('.briefing-editor-slide-editor .ql-toolbar button.ql-list[value="bullet"]').click();
        await expect(editor.locator('li[data-list="bullet"]')).toHaveCount(1);
        await expect.poll(() => conteudoNoDisco(A, bid), { timeout: 15000 }).toContain('data-list="bullet"');

        // Fecha e reabre o editor.
        await A.locator('.briefing-editor-back-btn').click();
        await expect(A.locator('#briefing-editor')).toHaveCount(0, { timeout: 10000 });
        await A.locator(`.briefing-card[data-briefing-id="${bid}"] .edit-btn`).click();
        await expect(A.locator('.briefing-editor-slide-editor .ql-editor')).toContainText('primeiro item', { timeout: 10000 });

        await expect(A.locator('.briefing-editor-slide-editor .ql-editor li[data-list="bullet"]'),
            'o item continua marcado como lista com marcadores no editor reaberto').toHaveCount(1);
        const tipo = await A.evaluate(async () => {
            const { sanitizeQuillHtml } = await import('/src/js/utilities/quill-helpers.js');
            return sanitizeQuillHtml('<ol><li data-list="bullet">x</li></ol>');
        });
        expect(tipo, 'o sanitize guarda o tipo da lista (e o que a apresentacao desenha)').toContain('data-list="bullet"');

        // A APRESENTACAO: o painel de texto recebe o conteudo sanitizado num `<ol>`, e so' a regra
        // da folha de estilo da apresentacao troca o numero pelo marcador. Medido no painel real
        // (mesma classe, mesma folha carregada pelo mapa), com o conteudo que o slide guardou.
        const marcador = await A.evaluate(async (id) => {
            const { sanitizeQuillHtml } = await import('/src/js/utilities/quill-helpers.js');
            const store = await import('/src/js/store/index.js');
            const painel = document.createElement('div');
            painel.className = 'briefing-text-panel__content';
            painel.innerHTML = sanitizeQuillHtml(((await store.getBriefingById(id))?.slides ?? [])[0]?.content ?? '');
            document.body.appendChild(painel);
            const li = painel.querySelector('li');
            const estilo = li ? getComputedStyle(li).listStyleType : null;
            painel.remove();
            return estilo;
        }, bid);
        expect(marcador, 'a apresentacao desenha o item com marcador, e nao com numero').toBe('disc');
    });
});

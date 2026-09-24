// Path: e2e-ui/briefing-link-e-figura-no-sanitize.repro.spec.js

/**
 * @fileoverview O SANITIZE DO TEXTO RICO NAO TIRA O `target` DO LINK NEM O TAMANHO DA FIGURA.
 *
 * O DEFEITO, medido por sonda antes deste arquivo: `QUILL_DOMPURIFY_CONFIG`
 * (`utilities/quill-helpers.js`) lista `target`, `rel`, `width` e `height`, mas o DOMPurify, com
 * atributos de dado desligados, confere o VALOR de todo atributo que nao e' "seguro para URI" contra
 * `ALLOWED_URI_REGEXP` (https ou data), e "_blank", "noopener noreferrer", "300" nao sao URI. Os
 * quatro saiam. O link que o Quill escreve (`target="_blank" rel="noopener noreferrer"`) chegava a
 * apresentacao sem `target`, e o clique no link de um slide LEVAVA A ABA DO EBGEO EMBORA, no meio
 * da apresentacao; a figura com tamanho explicito voltava ao tamanho natural.
 *
 * O GESTO: o link e' criado pela barra do editor do slide (selecionar a palavra, botao de link,
 * endereco, Enter), e o clique e' no link do painel da apresentacao, aberta pelo cartao do briefing.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-link-e-figura-no-sanitize --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';
import { APP_ORIGIN } from './constants.js';

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

const conteudoNoDisco = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(id))?.slides ?? [])[0]?.content ?? '';
}, bid);

collabTest.describe('Link e figura no texto rico do slide', () => {
    collabTest('o link do slide abre em outra aba e o EBGeo fica onde esta', async ({ collab }) => {
        collabTest.setTimeout(150000);
        const A = collab.author;
        const destino = `${APP_ORIGIN}/tutorial.html`;

        const antes = new Set(await lerTodosBriefings(A));
        if (!(await A.locator('.briefings-create-btn').isVisible())) await A.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await A.locator('.briefings-create-btn').click();
        await expect(A.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
        let bid = null;
        await expect.poll(async () => {
            bid = (await lerTodosBriefings(A)).find((b) => !antes.has(b)) ?? null;
            return bid;
        }, { timeout: 10000 }).toBeTruthy();

        // O link, pela barra do editor.
        const editor = A.locator('.briefing-editor-slide-editor .ql-editor');
        await expect(editor).toBeVisible({ timeout: 10000 });
        await editor.click();
        await A.keyboard.type('manual');
        await A.keyboard.press('Shift+Home');
        await A.locator('.briefing-editor-slide-editor .ql-toolbar button.ql-link').click();
        const endereco = A.locator('.briefing-editor-slide-editor .ql-tooltip input[type="text"]');
        await expect(endereco).toBeVisible({ timeout: 5000 });
        await endereco.fill(destino);
        await endereco.press('Enter');
        await expect.poll(() => conteudoNoDisco(A, bid), { timeout: 15000 }).toContain('href=');
        // A apresentacao exige a posicao do slide: captura pela tela.
        await A.locator('.briefing-editor-capture-btn').click();
        await expect.poll(() => A.evaluate(async (id) => {
            const store = await import('/src/js/store/index.js');
            return ((await store.getBriefingById(id))?.slides ?? [])[0]?.position?.longitude ?? null;
        }, bid), { timeout: 15000 }).not.toBeNull();

        // Apresenta pelo cartao e clica no link do painel.
        await A.locator('.briefing-editor-back-btn').click();
        await expect(A.locator('#briefing-editor')).toHaveCount(0, { timeout: 10000 });
        await A.locator(`.briefing-card[data-briefing-id="${bid}"] .briefing-card-info`).click();
        const link = A.locator('.briefing-text-panel__content a');
        await expect(link).toBeVisible({ timeout: 15000 });
        const alvo = await link.getAttribute('target');
        const enderecoDoApp = A.url();
        const novaAba = A.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
        await link.click();
        const aba = await novaAba;
        const retrato = { alvo, enderecoAntes: enderecoDoApp, enderecoDepois: A.url(), abriuOutraAba: Boolean(aba) };
        console.log(`RETRATO ${JSON.stringify(retrato)}`);
        await aba?.close();

        expect.soft(retrato.alvo, 'o link apresentado abre em outra aba').toBe('_blank');
        expect.soft(retrato.abriuOutraAba, 'o clique abriu outra aba').toBe(true);
        expect(retrato.enderecoDepois, 'a aba do EBGeo nao saiu do mapa').toBe(enderecoDoApp);
    });

    collabTest('o link que um cliente modificado manda chega neutralizado: nova aba, sem opener', async ({ collab }) => {
        collabTest.setTimeout(150000);
        const A = collab.author;
        const B = collab.peers[0];
        const destino = `${APP_ORIGIN}/tutorial.html`;

        // O sanitize, direto: `rel="opener"` e `target="_top"` nao passam como vieram.
        const limpo = await A.evaluate(async (url) => {
            const { sanitizeQuillHtml } = await import('/src/js/utilities/quill-helpers.js');
            return {
                opener: sanitizeQuillHtml(`<a href="${url}" target="_blank" rel="opener">a</a>`),
                topo: sanitizeQuillHtml(`<a href="${url}" target="_top">b</a>`),
                nomeada: sanitizeQuillHtml(`<a href="${url}" target="janela" rel="opener noreferrer">c</a>`),
            };
        }, destino);
        console.log(`LIMPO ${JSON.stringify(limpo)}`);
        for (const html of Object.values(limpo)) {
            expect(html).toContain('target="_blank"');
            expect(html).toContain('rel="noopener noreferrer"');
            expect(html).not.toContain('rel="opener');
            expect(html).not.toContain('_top');
            expect(html).not.toContain('janela');
        }

        // Ponta a ponta: o conteudo do slide vem do COLEGA (B), como o de um cliente modificado:
        // o payload e' escrito pela store de B, que e' o que a sync entrega a A.
        const antes = new Set(await lerTodosBriefings(B));
        if (!(await B.locator('.briefings-create-btn').isVisible())) await B.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await B.locator('.briefings-create-btn').click();
        await expect(B.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
        let bid = null;
        await expect.poll(async () => {
            bid = (await lerTodosBriefings(B)).find((b) => !antes.has(b)) ?? null;
            return bid;
        }, { timeout: 10000 }).toBeTruthy();
        await B.locator('.briefing-editor-capture-btn').click();
        await expect.poll(() => B.evaluate(async (id) => {
            const store = await import('/src/js/store/index.js');
            return ((await store.getBriefingById(id))?.slides ?? [])[0]?.position?.longitude ?? null;
        }, bid), { timeout: 15000 }).not.toBeNull();
        await B.locator('.briefing-editor-back-btn').click();
        await B.evaluate(async ({ id, url }) => {
            const store = await import('/src/js/store/index.js');
            const slide = ((await store.getBriefingById(id))?.slides ?? [])[0];
            await store.updateSlide(id, slide.id, { content: `<p><a href="${url}" target="_top" rel="opener">manual</a></p>` });
        }, { id: bid, url: destino });
        await expect.poll(() => conteudoNoDisco(A, bid), { timeout: 20000 }).toContain('rel="opener"');

        // A apresenta e clica.
        if (!(await A.locator('.briefings-create-btn').isVisible())) await A.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await A.locator(`.briefing-card[data-briefing-id="${bid}"] .briefing-card-info`).click();
        const link = A.locator('.briefing-text-panel__content a');
        await expect(link).toBeVisible({ timeout: 15000 });
        const atributos = { target: await link.getAttribute('target'), rel: await link.getAttribute('rel') };
        const enderecoDoApp = A.url();
        const novaAba = A.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
        await link.click();
        const aba = await novaAba;
        const opener = aba ? await aba.evaluate(() => window.opener === null).catch(() => null) : null;
        console.log(`RETRATO ${JSON.stringify({ atributos, abriuOutraAba: Boolean(aba), openerNulo: opener, enderecoDepois: A.url() })}`);
        await aba?.close();
        expect(atributos).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
        expect(Boolean(aba), 'abriu outra aba').toBe(true);
        expect(opener, 'a aba aberta nao alcanca a do EBGeo').toBe(true);
        expect(A.url(), 'a aba do EBGeo nao saiu do mapa').toBe(enderecoDoApp);
    });

    collabTest('a figura com tamanho explicito guarda o tamanho no sanitize', async ({ collab }) => {
        const A = collab.author;
        const limpo = await A.evaluate(async () => {
            const { sanitizeQuillHtml } = await import('/src/js/utilities/quill-helpers.js');
            return sanitizeQuillHtml('<p><img src="data:image/png;base64,iVBORw0KGgo=" width="300" height="200"></p>');
        });
        expect(limpo).toContain('width="300"');
        expect(limpo).toContain('height="200"');
    });
});

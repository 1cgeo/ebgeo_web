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

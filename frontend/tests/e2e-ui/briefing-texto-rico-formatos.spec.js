// Path: e2e-ui/briefing-texto-rico-formatos.spec.js

/**
 * @fileoverview CADA FORMATO DA BARRA DO TEXTO RICO DO SLIDE, do editor do autor a apresentacao do
 * colega, e depois do F5.
 *
 * A barra e' a de `_initQuillEditor` (`briefing/editor/briefing-editor.control.js`): cabecalho,
 * negrito, italico, sublinhado, tachado, cor, fundo, lista numerada, lista com marcadores, recuo,
 * alinhamento, link, imagem e limpar. Link e imagem colada tem specs proprios
 * (`briefing-link-e-figura-no-sanitize`, `briefing-colagem-e-troca-de-slide`), e a lista com
 * marcadores tambem (`briefing-lista-com-marcadores`). Aqui, cada outro formato e' aplicado pela
 * barra a uma linha propria, e o veredito e' lido em tres lugares:
 *  - o HTML guardado no disco do autor;
 *  - o HTML que o colega recebeu, e o mesmo depois do F5 dele;
 *  - o ESTILO COMPUTADO de cada linha no painel da apresentacao do colega, que e' o que a plateia ve.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-texto-rico-formatos --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const LINHAS = ['Titulo grande', 'Negrito', 'Italico', 'Sublinhado', 'Tachado', 'Vermelho', 'Fundo amarelo',
    'Numerada', 'Recuada', 'Centralizada', 'Limpo'];

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

const conteudoNoDisco = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(id))?.slides ?? [])[0]?.content ?? '';
}, bid);

/** O que o HTML guardado tem de ter, formato a formato. */
function conferirHtml(html, rotulo) {
    expect.soft(html, `${rotulo}: cabecalho`).toMatch(/<h1[^>]*>Titulo grande<\/h1>/);
    expect.soft(html, `${rotulo}: negrito`).toContain('<strong>Negrito</strong>');
    expect.soft(html, `${rotulo}: italico`).toContain('<em>Italico</em>');
    expect.soft(html, `${rotulo}: sublinhado`).toContain('<u>Sublinhado</u>');
    expect.soft(html, `${rotulo}: tachado`).toContain('<s>Tachado</s>');
    expect.soft(html, `${rotulo}: cor`).toMatch(/color: rgb\(230, 0, 0\);?">Vermelho/);
    expect.soft(html, `${rotulo}: fundo`).toMatch(/background-color: rgb\(255, 255, 0\);?">Fundo amarelo/);
    expect.soft(html, `${rotulo}: lista numerada`).toMatch(/<li data-list="ordered">(<span[^>]*><\/span>)?Numerada/);
    expect.soft(html, `${rotulo}: recuo`).toMatch(/class="ql-indent-1"[^>]*>Recuada/);
    expect.soft(html, `${rotulo}: alinhamento`).toMatch(/class="ql-align-center"[^>]*>Centralizada/);
    expect.soft(html, `${rotulo}: limpar tira o negrito`).not.toContain('<strong>Limpo</strong>');
}

/** Seleciona a linha inteira que tem o texto (triplo clique no paragrafo). */
async function selecionarLinha(page, texto) {
    const linha = page.locator('.briefing-editor-slide-editor .ql-editor').locator('p, h1, li').filter({ hasText: new RegExp(`^${texto}$`) }).first();
    await linha.click({ clickCount: 3 });
}

const barra = (page) => page.locator('.briefing-editor-slide-editor .ql-toolbar');

async function escolherNoPicker(page, classe, valor) {
    await barra(page).locator(`.${classe} .ql-picker-label`).click();
    await barra(page).locator(`.${classe} .ql-picker-item[data-value="${valor}"]`).click();
}

collabTest.describe('Formatos do texto rico do slide', () => {
    collabTest('cada formato da barra chega ao disco, ao colega, a apresentacao dele e ao F5', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];

        const antes = new Set(await lerTodosBriefings(A));
        if (!(await A.locator('.briefings-create-btn').isVisible())) await A.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await A.locator('.briefings-create-btn').click();
        await expect(A.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
        let bid = null;
        await expect.poll(async () => {
            bid = (await lerTodosBriefings(A)).find((b) => !antes.has(b)) ?? null;
            return bid;
        }, { timeout: 10000 }).toBeTruthy();

        // As linhas, digitadas.
        const editor = A.locator('.briefing-editor-slide-editor .ql-editor');
        await expect(editor).toBeVisible({ timeout: 10000 });
        await editor.click();
        await A.keyboard.type(LINHAS.join('\n'));

        // Cada formato pela barra, na sua linha.
        await selecionarLinha(A, 'Titulo grande');
        await escolherNoPicker(A, 'ql-header', '1');
        for (const [texto, botao] of [['Negrito', 'ql-bold'], ['Italico', 'ql-italic'], ['Sublinhado', 'ql-underline'], ['Tachado', 'ql-strike']]) {
            await selecionarLinha(A, texto);
            await barra(A).locator(`button.${botao}`).click();
        }
        await selecionarLinha(A, 'Vermelho');
        await escolherNoPicker(A, 'ql-color', '#e60000');
        await selecionarLinha(A, 'Fundo amarelo');
        await escolherNoPicker(A, 'ql-background', '#ffff00');
        await selecionarLinha(A, 'Numerada');
        await barra(A).locator('button.ql-list[value="ordered"]').click();
        await selecionarLinha(A, 'Recuada');
        await barra(A).locator('button.ql-indent[value="+1"]').click();
        await selecionarLinha(A, 'Centralizada');
        await escolherNoPicker(A, 'ql-align', 'center');
        await selecionarLinha(A, 'Limpo');
        await barra(A).locator('button.ql-bold').click();
        await selecionarLinha(A, 'Limpo');
        await barra(A).locator('button.ql-clean').click();

        // A posicao, para poder apresentar.
        await A.locator('.briefing-editor-capture-btn').click();
        await expect.poll(() => conteudoNoDisco(A, bid), { timeout: 15000 }).toContain('ql-align-center');
        await expect.poll(async () => !(await conteudoNoDisco(A, bid)).includes('<strong>Limpo</strong>'), { timeout: 15000 }).toBe(true);
        const htmlA = await conteudoNoDisco(A, bid);
        console.log(`HTML DO AUTOR ${htmlA}`);
        conferirHtml(htmlA, 'disco do autor');

        // O colega recebe o mesmo.
        await expect.poll(() => conteudoNoDisco(B, bid), { timeout: 30000 }).toBe(htmlA);

        // F5 do colega e apresentacao.
        await B.reload();
        await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await B.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
        conferirHtml(await conteudoNoDisco(B, bid), 'disco do colega depois do F5');

        await B.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await B.locator(`.briefing-card[data-briefing-id="${bid}"] .briefing-card-info`).click();
        const painel = B.locator('.briefing-text-panel__content');
        await expect(painel).toContainText('Centralizada', { timeout: 15000 });
        const estilos = await painel.evaluate((raiz) => {
            const de = (texto) => [...raiz.querySelectorAll('*')].find((e) => e.textContent === texto && e.children.length === 0);
            const cs = (texto) => { const e = de(texto); return e ? getComputedStyle(e) : null; };
            const bloco = (texto) => { let e = de(texto); while (e && !['P', 'H1', 'LI'].includes(e.tagName)) e = e.parentElement; return e ? getComputedStyle(e) : null; };
            return {
                titulo: de('Titulo grande')?.tagName ?? null,
                negrito: Number(cs('Negrito')?.fontWeight),
                italico: cs('Italico')?.fontStyle,
                sublinhado: cs('Sublinhado')?.textDecorationLine,
                tachado: cs('Tachado')?.textDecorationLine,
                cor: cs('Vermelho')?.color,
                fundo: cs('Fundo amarelo')?.backgroundColor,
                numerada: (() => { const li = raiz.querySelector('li'); return li ? getComputedStyle(li).listStyleType : null; })(),
                recuo: parseFloat(bloco('Recuada')?.paddingLeft ?? '0'),
                recuoBase: parseFloat(bloco('Negrito')?.paddingLeft ?? '0'),
                alinhamento: bloco('Centralizada')?.textAlign,
            };
        });
        console.log(`ESTILOS NA APRESENTACAO ${JSON.stringify(estilos)}`);
        expect.soft(estilos.titulo, 'cabecalho').toBe('H1');
        expect.soft(estilos.negrito, 'negrito').toBeGreaterThanOrEqual(600);
        expect.soft(estilos.italico, 'italico').toBe('italic');
        expect.soft(estilos.sublinhado, 'sublinhado').toContain('underline');
        expect.soft(estilos.tachado, 'tachado').toContain('line-through');
        expect.soft(estilos.cor, 'cor').toBe('rgb(230, 0, 0)');
        expect.soft(estilos.fundo, 'fundo').toBe('rgb(255, 255, 0)');
        expect.soft(estilos.numerada, 'lista numerada').toBe('decimal');
        expect.soft(estilos.recuo, 'recuo maior que o de uma linha comum').toBeGreaterThan(estilos.recuoBase);
        expect.soft(estilos.alinhamento, 'centralizada').toBe('center');
    });
});

// Path: e2e-ui/briefing-editor-cobertura.spec.js

/**
 * @fileoverview COBERTURA DOS COMANDOS DO EDITOR DE BRIEFING que nenhum spec dirigia pela tela.
 *
 * Enumerados de `briefing/editor/briefing-editor.control.js` e `sidebar/tabs/briefings.tab.js`:
 *  - reordenar slides arrastando a alca (o spec antigo, `browser-briefing-slides`, so' mandava a op);
 *  - importar slides de outro briefing pelo modal (o antigo, `browser-briefing-advanced` §22.10,
 *    tambem so' pelo transporte);
 *  - o mapa do slide (o select), conferido na apresentacao, que troca para aquele mapa;
 *  - o aviso ao apresentar um slide sem posicao salva;
 *  - o ciclo inteiro num atlas LOCAL (visitante anonimo), com F5: criar, renomear, slides,
 *    reordenar, excluir slide, apresentar, excluir briefing.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-editor-cobertura --retries=0 --workers=1
 */

import { test } from '@playwright/test';
import { collabTest, expect } from './helpers/collab.fixtures.js';
import { readState } from './state.js';

const state = readState();

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => ({ id: b.id, nome: b.name }));
});

const slidesNoDisco = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(id))?.slides ?? []).map((s) => ({ id: s.id, titulo: s.title, mapa: s.mapId ?? null }));
}, bid);

async function abrirAbaBriefings(page) {
    if (!(await page.locator('.briefings-create-btn').isVisible().catch(() => false))) {
        await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
    }
    await expect(page.locator('.briefings-create-btn')).toBeVisible({ timeout: 10000 });
}

async function criarBriefingUI(page, nome) {
    const antes = new Set((await lerTodosBriefings(page)).map((b) => b.id));
    await abrirAbaBriefings(page);
    await page.locator('.briefings-create-btn').click();
    await expect(page.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
    let bid = null;
    await expect.poll(async () => {
        bid = (await lerTodosBriefings(page)).find((b) => !antes.has(b.id))?.id ?? null;
        return bid;
    }, { timeout: 10000 }).toBeTruthy();
    if (nome) {
        await page.locator('.briefing-editor-name-input').fill(nome);
        await page.locator('.briefing-editor-name-input').blur();
        await expect.poll(async () => (await lerTodosBriefings(page)).find((b) => b.id === bid)?.nome, { timeout: 10000 }).toBe(nome);
    }
    return bid;
}

/** Da titulos aos slides, criando os que faltam, e salva a posicao de cada um. */
async function slidesUI(page, bid, titulos, { salvarPosicao = true } = {}) {
    for (let i = 0; i < titulos.length; i++) {
        const atuais = await slidesNoDisco(page, bid);
        if (i >= atuais.length) {
            await page.locator('.briefing-editor-add-slide-btn[title="Adicionar slide"]').click();
            await expect.poll(async () => (await slidesNoDisco(page, bid)).length, { timeout: 10000 }).toBe(i + 1);
        } else {
            await page.locator(`.briefing-editor-slide-card[data-slide-id="${atuais[i].id}"]`).click();
        }
        const campo = page.locator('.briefing-editor-slide-title-input');
        await campo.fill(titulos[i]);
        await campo.blur();
        if (salvarPosicao) {
            await page.locator('.briefing-editor-capture-btn').click();
            await expect(page.locator('.briefing-editor-position-set')).toBeVisible({ timeout: 10000 });
        }
        await expect.poll(async () => (await slidesNoDisco(page, bid))[i]?.titulo, { timeout: 10000 }).toBe(titulos[i]);
    }
}

/** Arrasta o slide da posicao `de` para cima do cartao da posicao `para`, pela alca. */
async function arrastarSlideUI(page, de, para) {
    const cartoes = page.locator('.briefing-editor-slide-card');
    await cartoes.nth(de).locator('.briefing-editor-slide-handle').dragTo(cartoes.nth(para), { targetPosition: { x: 10, y: 5 } });
}

async function fecharEditorUI(page) {
    // Salvar antes: um autosave ainda pendente faz o Voltar pedir confirmacao de saida.
    await page.locator('.briefing-editor-save-btn').click();
    await page.locator('.briefing-editor-back-btn').click();
    await expect(page.locator('#briefing-editor')).toHaveCount(0, { timeout: 10000 });
}

async function apresentarUI(page, bid) {
    await abrirAbaBriefings(page);
    await page.locator(`.briefing-card[data-briefing-id="${bid}"] .briefing-card-info`).click();
}

collabTest.describe('Editor de briefing num atlas de servidor', () => {
    collabTest('reordenar pela alca chega ao colega, ao servidor e ao F5', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        const bid = await criarBriefingUI(A, 'Ordem');
        await slidesUI(A, bid, ['Um', 'Dois', 'Tres'], { salvarPosicao: false });
        await expect.poll(async () => (await slidesNoDisco(B, bid)).map((s) => s.titulo), { timeout: 30000 }).toEqual(['Um', 'Dois', 'Tres']);

        await arrastarSlideUI(A, 2, 0);
        await expect.poll(async () => (await slidesNoDisco(A, bid)).map((s) => s.titulo), { timeout: 10000 }).toEqual(['Tres', 'Um', 'Dois']);
        await expect.poll(async () => (await slidesNoDisco(B, bid)).map((s) => s.titulo), { timeout: 30000 }).toEqual(['Tres', 'Um', 'Dois']);
        await expect.poll(async () => (await collab.db.raw.one(
            'SELECT array(SELECT s.title FROM unnest(b.slide_order) WITH ORDINALITY AS o(id, n) JOIN slides s ON s.id = o.id ORDER BY o.n) AS titulos FROM briefings b WHERE b.id = $1', [bid])).titulos,
        { timeout: 30000 }).toEqual(['Tres', 'Um', 'Dois']);
        await B.reload();
        await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        expect((await slidesNoDisco(B, bid)).map((s) => s.titulo), 'a ordem sobrevive ao F5 do colega').toEqual(['Tres', 'Um', 'Dois']);
    });

    collabTest('importar slides de outro briefing pelo modal: copias no fim, com ids novos, no colega e no servidor', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        const fonte = await criarBriefingUI(A, 'Fonte');
        await slidesUI(A, fonte, ['F1', 'F2'], { salvarPosicao: false });
        await fecharEditorUI(A);
        const alvo = await criarBriefingUI(A, 'Alvo');
        await slidesUI(A, alvo, ['A1'], { salvarPosicao: false });
        const idsDaFonte = (await slidesNoDisco(A, fonte)).map((s) => s.id);

        await A.locator('.briefing-editor-slides-actions button[title="Importar slides de outros briefings"], button[title="Importar slides de outros briefings"]').first().click();
        const item = A.locator(`.import-slides-item[data-briefing-id="${fonte}"]`);
        await expect(item).toBeVisible({ timeout: 5000 });
        await item.click();
        await A.locator('.import-slides-modal-btn-confirm').click();
        await expect.poll(async () => (await slidesNoDisco(A, alvo)).map((s) => s.titulo), { timeout: 15000 }).toEqual(['A1', 'F1', 'F2']);
        const copias = (await slidesNoDisco(A, alvo)).slice(1);
        expect(copias.every((s) => !idsDaFonte.includes(s.id)), 'as copias tem ids novos').toBe(true);
        expect((await slidesNoDisco(A, fonte)).map((s) => s.titulo), 'a fonte fica como estava').toEqual(['F1', 'F2']);
        await expect.poll(async () => (await slidesNoDisco(B, alvo)).map((s) => s.titulo), { timeout: 30000 }).toEqual(['A1', 'F1', 'F2']);
        await expect.poll(async () => (await collab.db.raw.any('SELECT id FROM slides WHERE briefing_id = $1 AND deleted_at IS NULL', [alvo])).length,
            { timeout: 30000 }).toBe(3);
    });

    collabTest('o mapa do slide: apresentar leva ao mapa escolhido', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        // Um segundo mapa, pela aba Mapas.
        await A.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await A.locator('[data-testid="maps-new-map"]').click();
        await A.locator('.prompt-modal-input').fill('Segundo mapa');
        await A.locator('.prompt-modal-btn-confirm').click();
        await expect(A.locator('.maps-tab .map-list-item[data-map-name="Segundo mapa"]')).toBeVisible({ timeout: 10000 });
        const atual = () => A.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync());
        await expect.poll(atual, { timeout: 10000 }).toBe('Segundo mapa');

        const bid = await criarBriefingUI(A, 'Com mapa');
        await slidesUI(A, bid, ['No primeiro mapa'], { salvarPosicao: false });
        await A.locator('.briefing-editor-slide-editor select.briefing-editor-select').first().selectOption(collab.mapName);
        await A.locator('.briefing-editor-capture-btn').click();
        await expect.poll(async () => (await slidesNoDisco(A, bid))[0]?.mapa, { timeout: 10000 }).toBe(collab.mapName);
        await fecharEditorUI(A);

        // Volta ao segundo mapa e apresenta: o slide leva ao mapa dele. O clique no cartao e'
        // reenviado ate' tomar, porque a lista se redesenha a cada op que chega (o mesmo motivo de
        // `trocarParaMapaUI` em browser-collab-rename-remoto).
        if (!(await A.locator('.maps-tab').isVisible().catch(() => false))) await A.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await expect.poll(async () => {
            if (await atual() === 'Segundo mapa') return true;
            const cartao = A.locator('.maps-tab .map-list-item[data-map-name="Segundo mapa"]');
            if (await cartao.count()) await cartao.first().evaluate((el) => el.click()).catch(() => {});
            return (await atual()) === 'Segundo mapa';
        }, { timeout: 20000 }).toBe(true);
        await apresentarUI(A, bid);
        await expect(A.locator('.briefing-text-panel__title-text')).toHaveText('No primeiro mapa', { timeout: 15000 });
        await expect.poll(atual, { timeout: 15000, message: 'a apresentacao troca para o mapa do slide' }).toBe(collab.mapName);
    });
});

const describeLocal = state.skip ? test.describe.skip : test.describe;

describeLocal('Editor de briefing num atlas local', () => {
    test('o ciclo inteiro num atlas local sobrevive ao F5, e o aviso de slide sem posicao', async ({ page }) => {
        test.setTimeout(180000);
        await page.goto('/');
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });

        const bid = await criarBriefingUI(page, 'Plano local');
        await slidesUI(page, bid, ['L1', 'L2', 'L3']);
        await arrastarSlideUI(page, 2, 0);
        await expect.poll(async () => (await slidesNoDisco(page, bid)).map((s) => s.titulo), { timeout: 10000 }).toEqual(['L3', 'L1', 'L2']);
        const doMeio = (await slidesNoDisco(page, bid))[1].id;
        await page.locator(`.briefing-editor-slide-card[data-slide-id="${doMeio}"] .briefing-editor-slide-delete-btn`).click();
        await page.locator('.confirm-modal-overlay .confirm-modal-btn-confirm').click();
        await expect.poll(async () => (await slidesNoDisco(page, bid)).map((s) => s.titulo), { timeout: 10000 }).toEqual(['L3', 'L2']);
        await fecharEditorUI(page);

        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
        expect((await lerTodosBriefings(page)).find((b) => b.id === bid)?.nome, 'o nome sobrevive ao F5').toBe('Plano local');
        expect((await slidesNoDisco(page, bid)).map((s) => s.titulo), 'slides e ordem sobrevivem ao F5').toEqual(['L3', 'L2']);

        await apresentarUI(page, bid);
        await expect(page.locator('.briefing-text-panel__title-text')).toHaveText('L3', { timeout: 15000 });
        await page.locator('.briefing-text-panel__btn[title="Próximo Slide"]').click();
        await expect(page.locator('.briefing-text-panel__title-text')).toHaveText('L2', { timeout: 15000 });
        await page.keyboard.press('Escape');
        await expect(page.locator('body')).not.toHaveClass(/briefing-presenting/, { timeout: 10000 });

        // Um briefing com um slide SEM posicao: apresentar avisa, nao entra, e a lista VOLTA sozinha
        // (a recusa deixava a barra lateral recolhida, e a lista que a pessoa tem de corrigir sumia).
        const semPosicao = await criarBriefingUI(page, 'Sem posicao');
        await fecharEditorUI(page);
        await apresentarUI(page, semPosicao);
        await expect(page.locator('.toast', { hasText: 'sem posição definida' })).toBeVisible({ timeout: 10000 });
        await expect(page.locator('body')).not.toHaveClass(/briefing-presenting/);
        // O recolher comeca no clique e a recusa chega depois: le-se o painel so quando a transicao
        // assentar, senao a leitura pega o cartao ainda a meio caminho (medido: visivel no primeiro
        // instante e removido do DOM meio segundo depois, sem o conserto).
        await expect.poll(() => page.evaluate(() => document.querySelector('.sidebar-panel')?.getAnimations().length ?? -1),
            { timeout: 10000 }).toBe(0);
        await expect(page.locator(`.briefing-card[data-briefing-id="${semPosicao}"]`), 'a lista de briefings volta depois da recusa')
            .toBeInViewport({ timeout: 10000 });

        // Excluir o briefing, e o F5 confirma.
        await page.locator(`.briefing-card[data-briefing-id="${bid}"] .delete-btn`).click();
        await page.locator('.confirm-modal-overlay .confirm-modal-btn-confirm').click();
        await expect(page.locator('.toast', { hasText: 'excluído' })).toBeVisible({ timeout: 10000 });
        await expect(page.locator(`.briefing-card[data-briefing-id="${bid}"]`)).toHaveCount(0, { timeout: 10000 });
        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
        expect((await lerTodosBriefings(page)).some((b) => b.id === bid), 'o briefing excluido nao volta no F5').toBe(false);
    });
});

// Path: e2e-ui/briefing-vista-do-slide-cobertura.spec.js

/**
 * @fileoverview COBERTURA DO QUE UM SLIDE MOSTRA ALEM DA CAMERA, e da nota do mapa importada.
 *
 * Enumerados de `briefing/editor/briefing-editor.control.js` (`_createSlideViewGroup`,
 * `_handleCapturePosition`, `_handleImportNotes`) e aplicados por
 * `briefing/presentation/transition.service.js` (`_applySlideView`, `_restoreTemporalCursor`,
 * `_restorePersonView`). Nenhum spec de navegador dirigia estes comandos pela tela:
 *  - o mapa base do slide (o select "Mapa base do slide");
 *  - a linha do tempo do slide: o interruptor "Controle temporal ligado neste slide" e o INSTANTE
 *    que "Salvar Posicao" le da tela do autor;
 *  - "Importar nota do mapa" para o conteudo do slide.
 *
 * O que se confere e' o efeito NA TELA DO COLEGA que apresenta, ao vivo e depois do F5, mais a
 * linha do slide no Postgres, e que sair da apresentacao devolve ao colega a vista DELE (base,
 * interruptor e instante), que e' estado de vista de cada pessoa desde 2026-09-20.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-vista-do-slide-cobertura --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => ({ id: b.id, nome: b.name }));
});

const slidesNoDisco = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(id))?.slides ?? []).map((s) => ({
        id: s.id,
        titulo: s.title,
        mapa: s.mapId ?? null,
        base: s.baseLayer ?? null,
        temporal: typeof s.temporalEnabled === 'boolean' ? s.temporalEnabled : null,
        instante: Number.isFinite(s.temporalCursor) ? s.temporalCursor : null,
        conteudo: s.content ?? '',
    }));
}, bid);

/** A vista da pessoa agora: base desenhada, interruptor da linha do tempo e instante do controlador. */
const lerVista = (page) => page.evaluate(async () => {
    const { getControl } = await import('/src/js/store/control.registry.js');
    const store = await import('/src/js/store/index.js');
    const base = getControl('BaseLayerControl');
    const cursor = getControl('TemporalControl')?.getCursor?.();
    return {
        base: base && !base.isChanging ? base.currentLayer : null,
        temporal: store.isMapTemporalEnabledSync(),
        instante: Number.isFinite(cursor) ? cursor : null,
        bases: base?.availableBasemaps ?? [],
        mapa: store.getCurrentMapNameSync(),
    };
});

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
    await page.locator('.briefing-editor-name-input').fill(nome);
    await page.locator('.briefing-editor-name-input').blur();
    await expect.poll(async () => (await lerTodosBriefings(page)).find((b) => b.id === bid)?.nome, { timeout: 10000 }).toBe(nome);
    return bid;
}

/**
 * Seleciona o slide de indice `i` (criando-o se faltar), da o titulo e salva a posicao, que le a
 * vista da tela. Briefing novo ja nasce com um slide: o primeiro e' selecionado, nao criado.
 */
async function slideComPosicaoUI(page, bid, i, titulo) {
    const atuais = await slidesNoDisco(page, bid);
    if (i >= atuais.length) {
        await page.locator('.briefing-editor-add-slide-btn[title="Adicionar slide"]').click();
        await expect.poll(async () => (await slidesNoDisco(page, bid)).length, { timeout: 10000 }).toBe(i + 1);
    } else {
        await page.locator(`.briefing-editor-slide-card[data-slide-id="${atuais[i].id}"]`).click();
    }
    const campo = page.locator('.briefing-editor-slide-title-input');
    await campo.fill(titulo);
    await campo.blur();
    await page.locator('.briefing-editor-capture-btn').click();
    await expect(page.locator('.briefing-editor-position-set')).toBeVisible({ timeout: 10000 });
    await expect.poll(async () => (await slidesNoDisco(page, bid))[i]?.titulo, { timeout: 10000 }).toBe(titulo);
}

async function fecharEditorUI(page) {
    await page.locator('.briefing-editor-save-btn').click();
    await page.locator('.briefing-editor-back-btn').click();
    await expect(page.locator('#briefing-editor')).toHaveCount(0, { timeout: 10000 });
}

async function apresentarUI(page, bid) {
    await abrirAbaBriefings(page);
    await page.locator(`.briefing-card[data-briefing-id="${bid}"] .briefing-card-info`).click();
    await expect(page.locator('body')).toHaveClass(/briefing-presenting/, { timeout: 15000 });
}

/** Liga a linha do tempo pelo relogio da aba Mapas e leva o cursor a uma fracao da regua. */
async function ligarLinhaDoTempoUI(page, fracao) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const relogio = page.locator('#current-map-temporal-btn');
    await expect(relogio).toBeVisible({ timeout: 10000 });
    await expect(relogio).toHaveAttribute('data-temporal', 'false');
    await relogio.click();
    await expect(relogio).toHaveAttribute('data-temporal', 'true', { timeout: 5000 });
    const barra = page.locator('[data-testid="temporal-bar"]');
    await expect(barra).toHaveAttribute('data-hidden', 'false', { timeout: 5000 });
    const regua = barra.locator('.temporal-bar__track');
    await expect.poll(() => regua.getAttribute('aria-valuenow'), { timeout: 6000 }).not.toBeNull();
    const antes = Number(await regua.getAttribute('aria-valuenow'));
    const caixa = await regua.boundingBox();
    expect(caixa, 'a regua tem caixa na tela').not.toBeNull();
    await page.mouse.click(caixa.x + caixa.width * fracao, caixa.y + caixa.height / 2);
    await expect.poll(async () => Number(await regua.getAttribute('aria-valuenow')), { timeout: 6000 }).not.toBe(antes);
    const vista = await lerVista(page);
    expect(vista.temporal, 'a linha do tempo ligou').toBe(true);
    expect(vista.instante, 'o controlador publica o instante escolhido').not.toBeNull();
    return vista.instante;
}

collabTest.describe('A vista do slide (mapa base e linha do tempo) chega a quem apresenta', () => {
    collabTest('base por slide e instante por slide, no colega ao vivo e depois do F5, e a vista dele volta ao sair', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];

        const vistaA = await lerVista(A);
        expect(vistaA.bases.length, 'o harness oferece mais de um mapa base').toBeGreaterThan(1);
        const baseDoSlide = vistaA.bases.find((id) => id !== vistaA.base);
        expect(baseDoSlide).toBeTruthy();

        // Slide 1 ("Instante"): a linha do tempo LIGADA e o cursor num ponto escolhido; a captura
        // grava o interruptor e o instante que estao na tela do autor.
        const instante = await ligarLinhaDoTempoUI(A, 0.3);
        const bid = await criarBriefingUI(A, 'Vista');
        await slideComPosicaoUI(A, bid, 0, 'Instante');
        await expect.poll(async () => (await slidesNoDisco(A, bid))[0], { timeout: 10000 })
            .toMatchObject({ temporal: true, instante, base: vistaA.base });

        // Slide 2 ("Base"): outra base pelo select e a linha do tempo DESLIGADA pela caixa.
        await slideComPosicaoUI(A, bid, 1, 'Base');
        await A.locator('.briefing-editor-view-base').selectOption(baseDoSlide);
        const caixaTemporal = A.locator('.briefing-editor-view-temporal');
        await expect(caixaTemporal).toBeChecked();
        await caixaTemporal.uncheck();
        await expect.poll(async () => (await slidesNoDisco(A, bid))[1], { timeout: 10000 })
            .toMatchObject({ temporal: false, base: baseDoSlide });
        // O editor mostra ao autor o que o slide pede (o que se ve e' o que se apresenta).
        await expect.poll(async () => (await lerVista(A)).base, { timeout: 15000 }).toBe(baseDoSlide);
        await fecharEditorUI(A);

        // O servidor guarda as tres colunas de cada slide.
        await expect.poll(async () => (await collab.db.raw.any(
            `SELECT s.title, s.base_layer, s.temporal_enabled, s.temporal_cursor
               FROM briefings b, unnest(b.slide_order) WITH ORDINALITY AS o(id, n)
               JOIN slides s ON s.id = o.id
              WHERE b.id = $1 ORDER BY o.n`, [bid])).map((r) => [r.title, r.base_layer, r.temporal_enabled, r.temporal_cursor === null ? null : Number(r.temporal_cursor)]),
        { timeout: 30000 }).toEqual([
            ['Instante', vistaA.base, true, instante],
            // Desligar a caixa nao apaga o instante capturado: so' deixa de usa-lo.
            ['Base', baseDoSlide, false, instante],
        ]);

        await expect.poll(async () => (await slidesNoDisco(B, bid)).map((s) => s.titulo), { timeout: 30000 }).toEqual(['Instante', 'Base']);

        for (const rodada of ['ao vivo', 'depois do F5']) {
            if (rodada === 'depois do F5') {
                await B.reload();
                await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
                await B.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
            }
            const vistaB = await lerVista(B);
            expect(vistaB.temporal, `${rodada}: o colega comeca com a linha do tempo desligada`).toBe(false);
            expect(vistaB.base, `${rodada}: o colega comeca na base dele`).not.toBe(baseDoSlide);

            await apresentarUI(B, bid);
            await expect(B.locator('.briefing-text-panel__title-text')).toHaveText('Instante', { timeout: 15000 });
            await expect.poll(async () => { const v = await lerVista(B); return [v.temporal, v.instante]; },
                { timeout: 15000, message: `${rodada}: o slide 1 liga a linha do tempo no instante do autor` })
                .toEqual([true, instante]);

            await B.locator('.briefing-text-panel__btn[title="Próximo Slide"]').click();
            await expect(B.locator('.briefing-text-panel__title-text')).toHaveText('Base', { timeout: 15000 });
            await expect.poll(async () => { const v = await lerVista(B); return [v.temporal, v.base]; },
                { timeout: 20000, message: `${rodada}: o slide 2 troca a base e desliga a linha do tempo` })
                .toEqual([false, baseDoSlide]);

            await B.keyboard.press('Escape');
            await expect(B.locator('body')).not.toHaveClass(/briefing-presenting/, { timeout: 10000 });
            await expect.poll(async () => { const v = await lerVista(B); return [v.temporal, v.base]; },
                { timeout: 20000, message: `${rodada}: sair devolve ao colega a vista dele` })
                .toEqual([vistaB.temporal, vistaB.base]);
        }

        // A vista escolhida no slide nao reescreve a vista SALVA do mapa (estado de cada pessoa).
        const salvaNoServidor = await collab.db.raw.one('SELECT base_layer FROM maps WHERE id = $1', [collab.mapId]);
        expect(salvaNoServidor.base_layer, 'a base salva do mapa continua a de antes').not.toBe(baseDoSlide);
    });

    collabTest('importar a nota do mapa para o conteudo do slide chega ao colega e ao F5', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];

        // A nota do mapa, escrita pela tela.
        await A.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await expect(A.locator('.maps-tab #current-map-name-input')).not.toHaveValue('', { timeout: 15000 });
        await A.locator('.maps-tab #current-map-notes-btn').click();
        await expect(A.locator('.map-notes-sidebar-edit-btn')).toBeVisible({ timeout: 10000 });
        await A.locator('.map-notes-sidebar-edit-btn').click();
        await A.locator('.map-notes-sidebar-title-input').fill('Nota do mapa');
        await A.locator('.map-notes-quill-editor .ql-editor').click();
        await A.keyboard.press('Control+A');
        await A.keyboard.type('Eixo de progressao pela rodovia');
        await A.locator('.map-notes-sidebar-save-btn').click();
        await expect(A.locator('.map-notes-sidebar-edit-btn')).toBeVisible({ timeout: 10000 });

        const bid = await criarBriefingUI(A, 'Com nota');
        await slideComPosicaoUI(A, bid, 0, 'Resumo');
        await A.locator('.briefing-editor-import-notes-btn').click();
        await expect(A.locator('.toast', { hasText: 'Nota importada' })).toBeVisible({ timeout: 10000 });
        await expect(A.locator('.briefing-editor-quill-container .ql-editor')).toContainText('Eixo de progressao pela rodovia');
        await expect.poll(async () => (await slidesNoDisco(A, bid))[0]?.conteudo, { timeout: 10000 })
            .toContain('Eixo de progressao pela rodovia');
        await fecharEditorUI(A);

        await expect.poll(async () => (await collab.db.raw.one(
            'SELECT content FROM slides WHERE briefing_id = $1 AND deleted_at IS NULL', [bid])).content ?? '',
        { timeout: 30000 }).toContain('Eixo de progressao pela rodovia');
        await expect.poll(async () => (await slidesNoDisco(B, bid))[0]?.conteudo ?? '', { timeout: 30000 })
            .toContain('Eixo de progressao pela rodovia');
        await B.reload();
        await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        expect((await slidesNoDisco(B, bid))[0]?.conteudo, 'o conteudo importado sobrevive ao F5 do colega')
            .toContain('Eixo de progressao pela rodovia');
        await apresentarUI(B, bid);
        await expect(B.locator('.briefing-text-panel__content')).toContainText('Eixo de progressao pela rodovia', { timeout: 15000 });
    });
});

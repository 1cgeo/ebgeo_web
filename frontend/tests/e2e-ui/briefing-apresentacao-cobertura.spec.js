// Path: e2e-ui/briefing-apresentacao-cobertura.spec.js

/**
 * @fileoverview COBERTURA DA APRESENTACAO DE BRIEFING: cada comando de navegacao, pela tela.
 *
 * Enumerados de `briefing/components/presentation-text-panel.js` (botoes Primeiro, Anterior,
 * Proximo, Ultimo, "Voltar a Posicao Salva", "Sair da Apresentacao", o contador que abre a lista de
 * slides) e de `briefing/services/keyboard-service-briefing.js` (seta direita e D, seta esquerda e
 * A, Home, End, Escape). O briefing nasce no editor, com tres slides de titulos e posicoes
 * diferentes (o mapa e' levado a cada lugar e "Salvar Posicao" grava a vista); quem apresenta e' o
 * COLEGA, que recebeu tudo pela sync, e depois de um F5. Cada navegacao espera o fim da transicao
 * (o botao Proximo volta a se chamar "Proximo Slide") antes da seguinte, e confere o titulo, o
 * contador e o centro do mapa.
 *
 * Tela cheia fica de fora, declarado: o navegador sem cabeca do harness recusa `requestFullscreen`.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test briefing-apresentacao-cobertura --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const LUGARES = [
    { titulo: 'Abertura', centro: [-43.20, -22.90], zoom: 12 },
    { titulo: 'Meio', centro: [-43.10, -22.80], zoom: 13 },
    { titulo: 'Fecho', centro: [-43.30, -22.95], zoom: 11 },
];

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

const slidesNoDisco = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(id))?.slides ?? []).map((s) => ({ id: s.id, titulo: s.title, lng: s.position?.longitude ?? null }));
}, bid);

const centroDoMapa = (page) => page.evaluate(() => {
    const c = globalThis.__ebgeoMap.getCenter();
    return [c.lng, c.lat];
});

/** Monta o briefing pelo editor: um slide por lugar, com titulo e posicao salva. */
async function montarBriefingUI(page) {
    const antes = new Set(await lerTodosBriefings(page));
    if (!(await page.locator('.briefings-create-btn').isVisible())) await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
    await page.locator('.briefings-create-btn').click();
    await expect(page.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
    let bid = null;
    await expect.poll(async () => {
        bid = (await lerTodosBriefings(page)).find((b) => !antes.has(b)) ?? null;
        return bid;
    }, { timeout: 10000 }).toBeTruthy();
    for (let i = 0; i < LUGARES.length; i++) {
        if (i > 0) {
            const n = (await slidesNoDisco(page, bid)).length;
            await page.locator('.briefing-editor-add-slide-btn[title="Adicionar slide"]').click();
            await expect.poll(async () => (await slidesNoDisco(page, bid)).length, { timeout: 10000 }).toBe(n + 1);
        }
        const lugar = LUGARES[i];
        const campo = page.locator('.briefing-editor-slide-title-input');
        await campo.fill(lugar.titulo);
        await campo.blur();
        await page.evaluate(({ c, z }) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: z }), { c: lugar.centro, z: lugar.zoom });
        await page.locator('.briefing-editor-capture-btn').click();
        await expect.poll(async () => (await slidesNoDisco(page, bid))[i], { timeout: 15000 })
            .toMatchObject({ titulo: lugar.titulo });
        await expect.poll(async () => (await slidesNoDisco(page, bid))[i]?.lng, { timeout: 15000 })
            .toBeCloseTo(lugar.centro[0], 3);
    }
    await page.locator('.briefing-editor-back-btn').click();
    await expect(page.locator('#briefing-editor')).toHaveCount(0, { timeout: 10000 });
    return bid;
}

async function apresentarUI(page, bid) {
    if (!(await page.locator(`.briefing-card[data-briefing-id="${bid}"]`).isVisible().catch(() => false))) {
        await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
    }
    await page.locator(`.briefing-card[data-briefing-id="${bid}"] .briefing-card-info`).click();
    await expect(page.locator('body')).toHaveClass(/briefing-presenting/, { timeout: 15000 });
    await expect(page.locator('.briefing-text-panel__title-text')).toBeVisible({ timeout: 15000 });
}

/** Espera o slide `i` estar na tela, com a transicao terminada e o mapa no lugar dele. */
async function noSlide(page, i) {
    const lugar = LUGARES[i];
    await expect(page.locator('.briefing-text-panel__title-text')).toHaveText(lugar.titulo, { timeout: 15000 });
    await expect(page.locator('.briefing-text-panel__counter')).toHaveText(`${i + 1} de ${LUGARES.length}`);
    await expect(page.locator('.briefing-text-panel__btn[title="Próximo Slide"], .briefing-text-panel__btn[title="Pular Animação"]').first())
        .toHaveAttribute('title', 'Próximo Slide', { timeout: 20000 });
    await expect.poll(async () => {
        const [lng, lat] = await centroDoMapa(page);
        return Math.abs(lng - lugar.centro[0]) < 0.002 && Math.abs(lat - lugar.centro[1]) < 0.002;
    }, { timeout: 20000, message: `o mapa nao chegou ao lugar do slide ${i + 1}` }).toBe(true);
}

const botao = (page, titulo) => page.locator(`.briefing-text-panel__btn[title="${titulo}"]`);

collabTest.describe('Apresentacao de briefing: navegacao completa', () => {
    collabTest('o colega apresenta o briefing do autor: botoes, teclado, lista de slides, restaurar e sair; e de novo depois do F5', async ({ collab }) => {
        collabTest.setTimeout(300000);
        const A = collab.author;
        const B = collab.peers[0];
        const bid = await montarBriefingUI(A);
        await expect.poll(async () => (await slidesNoDisco(B, bid)).map((s) => s.titulo), { timeout: 30000 })
            .toEqual(LUGARES.map((l) => l.titulo));
        await expect.poll(async () => (await slidesNoDisco(B, bid)).every((s) => s.lng !== null), { timeout: 30000 }).toBe(true);

        for (const rodada of ['ao vivo', 'depois do F5']) {
            if (rodada === 'depois do F5') {
                await B.reload();
                await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
                await B.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
            }
            await apresentarUI(B, bid);
            await noSlide(B, 0);

            // Botoes.
            await botao(B, 'Próximo Slide').click();
            await noSlide(B, 1);
            await botao(B, 'Último Slide').click();
            await noSlide(B, 2);
            await botao(B, 'Slide Anterior').click();
            await noSlide(B, 1);
            await botao(B, 'Primeiro Slide').click();
            await noSlide(B, 0);

            // Teclado.
            await B.keyboard.press('ArrowRight');
            await noSlide(B, 1);
            await B.keyboard.press('d');
            await noSlide(B, 2);
            await B.keyboard.press('ArrowLeft');
            await noSlide(B, 1);
            await B.keyboard.press('a');
            await noSlide(B, 0);
            await B.keyboard.press('End');
            await noSlide(B, 2);
            await B.keyboard.press('Home');
            await noSlide(B, 0);

            // A lista de slides pelo contador.
            await B.locator('.briefing-text-panel__counter').click();
            const itens = B.locator('.briefing-text-panel__slide-dropdown-item');
            await expect(itens).toHaveCount(3, { timeout: 5000 });
            await itens.nth(2).click();
            await noSlide(B, 2);

            // Restaurar a posicao salva depois de mexer no mapa.
            await B.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-42.5, -22.0], zoom: 8 }));
            await botao(B, 'Voltar à Posição Salva').click();
            await noSlide(B, 2);

            // Sair: Escape na primeira rodada, o botao na segunda.
            if (rodada === 'ao vivo') await B.keyboard.press('Escape');
            else await botao(B, 'Sair da Apresentação').click();
            await expect(B.locator('body'), `saiu da apresentacao (${rodada})`).not.toHaveClass(/briefing-presenting/, { timeout: 10000 });
        }
    });
});

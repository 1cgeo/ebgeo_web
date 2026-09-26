// Path: e2e-ui/enquadramento-da-selecao.repro.spec.js

/**
 * @fileoverview O CLIQUE NA ÁRVORE ENQUADRA TUDO O QUE A SELEÇÃO DESENHA, fora do painel aberto
 * (decisão do dono de 2026-09-26).
 *
 * O DEFEITO. `frameFeatures` enquadrava só a pegada (caixa ou geometria) com 80 px iguais nos quatro
 * lados, num canvas que é a janela inteira com a trilha e o painel POR CIMA dele à esquerda. Medido
 * em 2026-09-26 no Chromium do harness, com o painel terminando em x = 456: a alça de rotação de um
 * texto caía em x = 348 (e em x = -9 quando só a margem foi corrigida, porque a alça fica presa ao
 * chão fora da caixa e o quadro aproxima), e os pontos-chave 2 e 3 de uma rota passavam da borda
 * direita do canvas. Com o conserto: alça em 536, pontos-chave entre 606 e 1200.
 *
 * O caminho é o da pessoa: o texto desenhado pela barra, a rota gravada e o símbolo selecionado pela
 * árvore, que é o gesto que enquadra. A leitura é da tela (a posição projetada da alça e dos pontos,
 * contra a caixa do painel e a do canvas). A regra pura está em
 * `tests/unit/enquadramento-inclui-rota-e-desconta-painel.repro.test.js`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawMilitarySymbolUI, selectFeatureUI } from './helpers/collab-helpers.js';
import { FERRAMENTAS, desenhar } from './helpers/cobertura-desenho.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** O fim do quadro é estado: a câmera parada, duas vezes seguidas. */
async function cameraParada(page) {
    await expect.poll(() => page.evaluate(() => !globalThis.__ebgeoMap.isMoving()), { timeout: 10000 }).toBe(true);
    await page.waitForTimeout(400);
    await expect.poll(() => page.evaluate(() => !globalThis.__ebgeoMap.isMoving()), { timeout: 10000 }).toBe(true);
}

/** A borda direita do painel aberto e a caixa do canvas, na tela. */
function bordas(page) {
    return page.evaluate(() => {
        const painel = document.querySelector('.feature-panel[data-expanded="true"]')?.getBoundingClientRect();
        const canvas = globalThis.__ebgeoMap.getCanvas().getBoundingClientRect();
        return { painelDireita: painel ? painel.right : 0, direita: canvas.right, topo: canvas.top, base: canvas.bottom };
    });
}

const naTela = (page, lngLat) => page.evaluate((c) => {
    const map = globalThis.__ebgeoMap;
    const r = map.getCanvas().getBoundingClientRect();
    const p = map.project(c);
    return { x: r.left + p.x, y: r.top + p.y };
}, lngLat);

async function abrirMapa(page) {
    await page.goto('/');
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
}

describeOrSkip('enquadramento da seleção', () => {
    test.describe.configure({ retries: 0 });

    test('texto: a alça de rotação fica à direita do painel aberto', async ({ page }) => {
        test.setTimeout(120000);
        await abrirMapa(page);
        const id = await desenhar(page, FERRAMENTAS.find((f) => f.id === 'text'));
        await selectFeatureUI(page, id);
        await cameraParada(page);
        const alca = await page.evaluate(async (fid) => {
            const dados = await globalThis.__ebgeoMap.getSource('text-edit-handles')?.getData?.();
            return (dados?.features ?? []).find((f) => f.properties?.handleId === 'rotation' && f.properties?.featureId === fid)
                ?.geometry?.coordinates ?? null;
        }, id);
        expect(alca, 'a seleção desenhou a alça de rotação').toBeTruthy();
        const p = await naTela(page, alca);
        const b = await bordas(page);
        expect(b.painelDireita, 'o painel está aberto').toBeGreaterThan(0);
        expect(p.x, 'a alça fica à direita do painel').toBeGreaterThan(b.painelDireita);
        expect(p.x).toBeLessThan(b.direita);
    });

    test('rota: os três pontos-chave ficam dentro do canvas e fora do painel', async ({ page }) => {
        test.setTimeout(120000);
        await abrirMapa(page);
        const id = await drawMilitarySymbolUI(page, [-43.2, -22.9]);
        await page.keyboard.press('Escape');
        const casa = await page.evaluate(async (fid) => {
            const s = await import('/src/js/store/index.js');
            return ((await s.getCurrentMapFeatures()).military_symbols ?? []).find((x) => x.properties?.id === fid).geometry.coordinates;
        }, id);
        const t0 = Date.UTC(2026, 0, 1, 12);
        const rota = [
            { t: t0, lng: casa[0], lat: casa[1] },
            { t: t0 + 3600000, lng: casa[0] + 0.01, lat: casa[1] + 0.008 },
            { t: t0 + 7200000, lng: casa[0] + 0.02, lat: casa[1] + 0.002 },
        ];
        await page.evaluate(async ({ fid, t }) => {
            const s = await import('/src/js/store/index.js');
            await s.updateFeatureProperty('military_symbols', fid, 'trajetoria', t);
        }, { fid: id, t: rota });
        // A escrita pela store não repinta a fonte num atlas local; o F5 a traz do disco.
        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
        await selectFeatureUI(page, id);
        await cameraParada(page);
        const b = await bordas(page);
        for (const [i, k] of rota.entries()) {
            const p = await naTela(page, [k.lng, k.lat]);
            expect(p.x, `ponto-chave ${i + 1} à direita do painel`).toBeGreaterThan(b.painelDireita);
            expect(p.x, `ponto-chave ${i + 1} dentro do canvas`).toBeLessThan(b.direita);
            expect(p.y).toBeGreaterThan(b.topo);
            expect(p.y).toBeLessThan(b.base);
        }
    });
});

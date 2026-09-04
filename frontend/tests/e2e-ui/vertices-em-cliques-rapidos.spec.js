// Path: e2e-ui/vertices-em-cliques-rapidos.spec.js

/**
 * @fileoverview Dois cliques rápidos em pontos diferentes são DOIS vértices.
 *
 * As ferramentas de Linha de Limite e de Linha de Coordenação seguram cada clique num
 * temporizador de 250 ms (o que separa o clique do duplo clique). Até 2026-09-03 um segundo
 * clique dentro dessa janela CANCELAVA o temporizador e re-armava com as coordenadas novas: o
 * vértice pendente sumia sem erro, e a feição nascia sem ele. Medido aqui, neste mesmo spec,
 * antes do conserto: 100 ms entre cliques, um vértice; 400 ms, dois. O clique direito que
 * finaliza tinha o mesmo defeito, descartando o vértice pendente e fechando com o ponto sob o
 * cursor.
 *
 * O que se prova, no navegador real e sem dublê: com 100 ms entre os cliques os dois vértices
 * entram, e um clique direito 100 ms depois do último clique esquerdo conserva o vértice
 * esquerdo (a feição fecha com três vértices, e não com dois). A suíte em `node` não alcança
 * isto, porque o temporizador e o clique moram no controle acoplado ao MapLibre.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';
import { clicarNoMapaUI, readFeatures } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const INTERVALO_MS = 100;

const FERRAMENTAS = [
    { toolId: 'coordinationLine', key: 'AddCoordinationLineControl', balde: 'coordination_lines' },
    { toolId: 'boundary', key: 'AddBoundaryControl', balde: 'boundarys' },
];

async function abrirMapaComFerramenta(page, toolId) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
    await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-51.20, -30.02], zoom: 13 }));
    await page.waitForTimeout(400);
    const grupo = page.locator('.toolbar-group[data-group-id="military"]');
    await grupo.locator('.toolbar-group-btn').click();
    await expect(grupo.locator('.toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await grupo.locator(`.toolbar-tool-btn[data-tool-id="${toolId}"]`).click();
    await esperarFerramentaPronta(page, toolId);
}

function vertices(page, key) {
    return page.evaluate(async (k) => {
        const s = await import('/src/js/store/index.js');
        const c = s.getControl?.(k);
        return Array.isArray(c?.drawPoints) ? c.drawPoints.length : null;
    }, key);
}

describeOrSkip('vértices em cliques rápidos (Chromium real)', () => {
    for (const { toolId, key, balde } of FERRAMENTAS) {
        test(`${toolId}: dois cliques a ${INTERVALO_MS} ms são dois vértices`, async ({ page }) => {
            await abrirMapaComFerramenta(page, toolId);

            await clicarNoMapaUI(page, [-51.24, -30.03]);
            await page.waitForTimeout(INTERVALO_MS);
            await clicarNoMapaUI(page, [-51.20, -30.02]);

            // O segundo vértice só entra quando o temporizador dele vence, e é isso que se espera.
            await expect.poll(() => vertices(page, key), { timeout: 5000 }).toBe(2);
        });

        test(`${toolId}: o clique direito ${INTERVALO_MS} ms depois do último clique conserva o vértice pendente`, async ({ page }) => {
            await abrirMapaComFerramenta(page, toolId);

            await clicarNoMapaUI(page, [-51.24, -30.03]);
            await expect.poll(() => vertices(page, key), { timeout: 5000 }).toBe(1);
            await clicarNoMapaUI(page, [-51.20, -30.02]);
            await page.waitForTimeout(INTERVALO_MS);
            await clicarNoMapaUI(page, [-51.16, -30.01], { button: 'right' });

            let feicao = null;
            await expect.poll(async () => {
                const lista = await readFeatures(page, balde);
                feicao = lista[0] ?? null;
                return lista.length;
            }, { timeout: 15000 }).toBe(1);
            expect(feicao.props.baseCoordinates).toHaveLength(3);
        });
    }
});

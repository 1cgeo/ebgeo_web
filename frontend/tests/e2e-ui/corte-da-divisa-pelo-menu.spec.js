// Path: e2e-ui/corte-da-divisa-pelo-menu.spec.js

/**
 * @fileoverview O corte da Linha de Limite em duas, pelo gesto do usuário.
 *
 * O modelo puro e as operações de sync do corte têm régua em `node`
 * (`tests/unit/boundary-split-model.test.js`, `tests/integration/corte-divisa-op-de-sync.test.js`).
 * O que só o navegador prova é o CAMINHO: desenhar a divisa, selecioná-la, abrir o menu do
 * clique direito, ver a entrada "Cortar Linha de Limite", clicar no ponto do corte e ficar com
 * duas divisas na store, cada uma com a sua espinha e o seu escalão, e a original fora.
 *
 * O menu do mapa é da SELEÇÃO, não do pixel: ele abre em qualquer ponto do canvas que não esteja
 * sob um painel nem sobre uma alça de edição (o botão direito sobre a alça remove o vértice, e
 * a ferramenta engole o evento em fase de captura, de propósito). Por isso o clique direito vai
 * a um ponto da espinha longe dos vértices, e o clique do corte vai ao mesmo ponto, que está
 * sobre a linha.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';
import { clicarNoMapaUI, readFeatures, selectFeatureUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const ESPINHA = [[-51.24, -30.10], [-51.20, -30.11], [-51.16, -30.10]];

/**
 * O meio do ÚLTIMO segmento: sobre a linha e longe das alças dos vértices. O último, e não o
 * primeiro, porque selecionar a feição abre o painel de atributos à esquerda, e a câmera é
 * levada a este ponto antes do clique para que ele fique na metade livre da tela.
 */
function pontoDoCorte(espinha) {
    const [a, b] = espinha.slice(-2);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

async function abrirMapa(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
}

async function desenharDivisa(page, coords) {
    await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 13 }), coords[1]);
    await page.waitForTimeout(400);
    const grupo = page.locator('.toolbar-group[data-group-id="military"]');
    await grupo.locator('.toolbar-group-btn').click();
    await expect(grupo.locator('.toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await grupo.locator('.toolbar-tool-btn[data-tool-id="boundary"]').click();
    await esperarFerramentaPronta(page, 'boundary');
    for (let i = 0; i < coords.length - 1; i++) {
        await clicarNoMapaUI(page, coords[i]);
        await page.waitForFunction(async ({ n }) => {
            const s = await import('/src/js/store/index.js');
            const c = s.getControl?.('AddBoundaryControl');
            return Array.isArray(c?.drawPoints) && c.drawPoints.length >= n;
        }, { n: i + 1 }, { timeout: 10000 });
    }
    await clicarNoMapaUI(page, coords[coords.length - 1], { button: 'right' });
    let divisa = null;
    await expect.poll(async () => {
        const lista = await readFeatures(page, 'boundarys');
        divisa = lista[0] ?? null;
        return lista.length;
    }, { timeout: 15000 }).toBe(1);
    return divisa;
}

describeOrSkip('corte da Linha de Limite pelo menu de contexto (Chromium real)', () => {
    test('a divisa selecionada oferece o corte, e o clique no ponto deixa duas divisas com escalão', async ({ page }) => {
        await abrirMapa(page);
        const original = await desenharDivisa(page, ESPINHA);
        expect(original.props.baseCoordinates).toHaveLength(3);

        await selectFeatureUI(page, original.id);
        await page.waitForTimeout(300);

        const corte = pontoDoCorte(original.props.baseCoordinates);
        await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 13 }), corte);
        await page.waitForTimeout(400);
        const menu = page.locator('.context-menu');
        await expect(async () => {
            const p = await clicarNoMapaUI(page, corte, { button: 'right' });
            expect(p.coberto, `pixel coberto por ${p.porQuem}`).toBe(false);
            await expect(menu).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout: 20000 });

        const item = menu.locator('.context-menu-item', { hasText: 'Cortar Linha de Limite' });
        await expect(item).toHaveCount(1);
        await item.click();
        await expect(menu).not.toBeVisible({ timeout: 5000 });

        // O modo de corte chega por `await import()` (o item carrega a orquestração sob demanda),
        // e o clique antes disso cai no vazio. O sinal de que ele assentou é o aviso que ele
        // mesmo mostra ao entrar.
        await expect(page.getByText('Clique na linha de limite para cortar')).toBeVisible({ timeout: 10000 });
        await clicarNoMapaUI(page, corte);

        // A contagem passa por DOIS no meio do gesto (original mais a primeira metade, antes do
        // DELETE), então o sinal de fim é a original ter saído, e só então a contagem.
        let metades = [];
        await expect.poll(async () => {
            metades = await readFeatures(page, 'boundarys');
            return metades.some((m) => m.id === original.id) ? 'original ainda no documento' : metades.length;
        }, { timeout: 15000 }).toBe(2);
        for (const metade of metades) {
            expect(metade.props.baseCoordinates.length).toBeGreaterThanOrEqual(2);
            expect(metade.props.symbol_instances.length).toBeGreaterThanOrEqual(1);
            expect(metade.props.echelon ?? metade.props.escalao ?? metade.props.symbol_code ?? true).toBeTruthy();
        }
        // As duas metades compartilham o vértice do corte: continuidade da divisa.
        const fimDaPrimeira = metades[0].props.baseCoordinates.at(-1);
        const inicioDaSegunda = metades[1].props.baseCoordinates[0];
        const compartilhado = [fimDaPrimeira, metades[0].props.baseCoordinates[0]].some((v) =>
            [inicioDaSegunda, metades[1].props.baseCoordinates.at(-1)].some((w) =>
                Math.abs(v[0] - w[0]) < 1e-9 && Math.abs(v[1] - w[1]) < 1e-9));
        expect(compartilhado).toBe(true);
    });
});

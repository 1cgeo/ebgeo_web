// Path: e2e-ui/cobertura-medicao.spec.js

/**
 * @fileoverview COBERTURA das réguas (Medir Distância, Área e Ângulo) e do "Salvar como feição".
 * Campanha de cobertura de 2026-09-24 (matriz em `relatorios/cobertura-taticas.md`).
 *
 * Antes dela os specs só conferiam que o painel APARECE com algum número (`utilities-measure`) e
 * que o Salvar grava UMA feição num atlas local (`measurement-duplicate-save`,
 * `measurement-delayed-save`). Nada lia o VALOR, trocava a unidade, usava "Limpar", nem levava a
 * feição salva a um atlas de servidor com um colega.
 *
 * OS VALORES SÃO CONFERIDOS CONTRA A GEODÉSIA, não contra o próprio app: os pontos são clicados em
 * coordenadas escolhidas e o esperado é calculado aqui, pela fórmula de haversine (a mesma esfera
 * de raio 6371008,8 m que o Turf usa), com folga de 1% para o arredondamento do clique em pixel.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { collabTest, readFeatures, deleteFeatureUI } from './helpers/collab.fixtures.js';
import { clicarNoMapaUI } from './helpers/collab-helpers.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const R = 6371008.8;
const rad = (g) => (g * Math.PI) / 180;
function haversine([lo1, la1], [lo2, la2]) {
    const a = Math.sin(rad(la2 - la1) / 2) ** 2
        + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

const A = [-43.21, -22.9];
const B = [-43.19, -22.9];

/** O número (formato pt-BR ou en) do texto de um valor do painel. */
function numero(texto) {
    const m = String(texto).replace(/\s/g, '').match(/-?[\d.,]+/);
    if (!m) return NaN;
    let s = m[0];
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (s.includes(',')) s = s.replace(',', '.');
    return Number(s);
}

async function ativarRegua(page, toolId) {
    await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 13 }));
    await page.waitForFunction(() => !globalThis.__ebgeoMap.isMoving());
    await page.locator('.toolbar-group[data-group-id="utility"] .toolbar-group-btn').click();
    await page.locator(`.toolbar-group[data-group-id="utility"] .toolbar-tool-btn[data-tool-id="${toolId}"]`).click();
    await esperarFerramentaPronta(page, toolId);
}

const painel = (page) => page.locator('.measurement-results-panel');
const total = (page) => painel(page).locator('.measurement-results-panel__total');

describeOrSkip('réguas: valor, unidade e limpar (atlas local)', () => {
    test.describe.configure({ retries: 0 });

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
    });

    test('Medir Distância: o total bate com a geodésia nas quatro unidades, e Limpar desliga', async ({ page }) => {
        await ativarRegua(page, 'measureDistance');
        await clicarNoMapaUI(page, A);
        await clicarNoMapaUI(page, B, { button: 'right' });
        await expect(total(page)).toBeVisible({ timeout: 10000 });
        const metros = haversine(A, B);
        const seletor = painel(page).locator('.measurement-results-panel__unit-selector');
        for (const [id, fator, sufixo] of [['meters', 1, 'm'], ['kilometers', 0.001, 'km'], ['nautical_miles', 1 / 1852, 'NM'], ['feet', 1 / 0.3048, 'ft']]) {
            await seletor.selectOption(id);
            await expect(total(page)).toContainText(sufixo);
            const lido = numero(await total(page).innerText());
            expect(Math.abs(lido - metros * fator) / (metros * fator), `${id}: ${await total(page).innerText()}`).toBeLessThan(0.01);
        }
        await painel(page).locator('.measurement-results-panel__clear-btn').click();
        await expect(painel(page)).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('.toolbar-tool-btn[data-tool-id="measureDistance"]')).toHaveAttribute('data-active', 'false');
    });

    test('Medir Área: área e perímetro batem com a geodésia, e a troca para hectares converte', async ({ page }) => {
        await ativarRegua(page, 'measureArea');
        const C = [-43.19, -22.89];
        await clicarNoMapaUI(page, A);
        await clicarNoMapaUI(page, B);
        await clicarNoMapaUI(page, C, { button: 'right' });
        await expect(total(page)).toBeVisible({ timeout: 10000 });
        // Triângulo retângulo pequeno: área ≈ catetos / 2 (erro de esfera plana << 1% nesta escala).
        const area = (haversine(A, B) * haversine(B, C)) / 2;
        const perimetro = haversine(A, B) + haversine(B, C) + haversine(C, A);
        expect(Math.abs(numero(await total(page).innerText()) - area) / area).toBeLessThan(0.01);
        const perim = numero(await painel(page).locator('.measurement-results-panel__value').first().innerText());
        expect(Math.abs(perim - perimetro) / perimetro).toBeLessThan(0.01);
        await painel(page).locator('.measurement-results-panel__unit-selector').selectOption('hectares');
        await expect(total(page)).toContainText('ha');
        expect(Math.abs(numero(await total(page).innerText()) - area / 10000) / (area / 10000)).toBeLessThan(0.01);
    });

    test('Medir Ângulo: um ângulo reto sai 90°, 1600 mil e 100 gon', async ({ page }) => {
        await ativarRegua(page, 'measureAngle');
        await clicarNoMapaUI(page, A);
        await clicarNoMapaUI(page, [-43.2, -22.9]);
        await clicarNoMapaUI(page, [-43.2, -22.89]);
        const valores = painel(page).locator('.measurement-results-panel__angle-value');
        await expect(valores).toHaveCount(3, { timeout: 10000 });
        const [graus, mil, gon] = await Promise.all([0, 1, 2].map(async (i) => numero(await valores.nth(i).innerText())));
        expect(Math.abs(graus - 90)).toBeLessThan(1.5);
        expect(Math.abs(mil - 1600)).toBeLessThan(1.5 * 6400 / 360);
        expect(Math.abs(gon - 100)).toBeLessThan(1.5 * 400 / 360);
    });
});

collabTest.describe.configure({ retries: 0 });

/** A feição no store da página, ou null. */
const noStore = (page, bucket, id) => page.evaluate(async ({ b, fid }) => {
    const s = await import('/src/js/store/index.js');
    const x = ((await s.getCurrentMapFeatures())[b] ?? []).find((y) => y.properties?.id === fid);
    return x ? JSON.parse(JSON.stringify(x.properties)) : null;
}, { b: bucket, fid: id });

collabTest('Salvar como feição num atlas de servidor: o colega recebe, F5 nos dois, e o colega exclui', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const autor = collab.author;
    const colega = collab.peers[0];
    const antes = new Set((await readFeatures(autor, 'lines')).map((f) => f.id));

    await ativarRegua(autor, 'measureDistance');
    await clicarNoMapaUI(autor, A);
    await clicarNoMapaUI(autor, B, { button: 'right' });
    await painel(autor).locator('.measurement-results-panel__save-btn').click();
    let id = null;
    await expect.poll(async () => {
        id = (await readFeatures(autor, 'lines')).map((f) => f.id).find((x) => !antes.has(x)) ?? null;
        return id;
    }, { timeout: 15000 }).toBeTruthy();

    const props = await noStore(autor, 'lines', id);
    expect(props.nome).toMatch(/^Medição \d/);
    expect({ cor: props.lineColor, measure: props.measure, source: props.source }).toEqual({ cor: '#ff6600', measure: true, source: 'line' });

    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.properties?.nome ?? null, { timeout: 30000 }).toBe(props.nome);
    await expect.poll(() => noStore(colega, 'lines', id).then((p) => p?.nome ?? null), { timeout: 30000 }).toBe(props.nome);

    for (const page of [autor, colega]) {
        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await expect.poll(() => noStore(page, 'lines', id).then((p) => p && { nome: p.nome, measure: p.measure }), { timeout: 30000 })
            .toEqual({ nome: props.nome, measure: true });
    }

    await deleteFeatureUI(colega, id);
    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.deleted_at ?? null, { timeout: 30000 }).not.toBeNull();
    await expect.poll(() => noStore(autor, 'lines', id), { timeout: 30000 }).toBeNull();
});

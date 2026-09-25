// Path: e2e-ui/alca-da-partida-anel.repro.spec.js

/**
 * @fileoverview PEGAR O CORPO DO SÍMBOLO MOVE O SÍMBOLO COM A ROTA INTEIRA, e a partida continua
 * editável pelo ANEL da alça 1. Pedido do dono de 2026-09-24, a partir da campanha de cobertura
 * (`relatorios/cobertura-taticas.md`).
 *
 * ANTES: com a feição selecionada, o editor da rota (`temporal/trajectory-tool/
 * trajectory-edit-control.js`) desenha uma alça por ponto-chave, e a alça da partida (kp 0) fica
 * EXATAMENTE no centro do símbolo, por cima dele. Pegar o símbolo pelo centro, que é onde a pessoa
 * pega, movia só a partida: a feição ia junto e o resto da rota ficava, deformado.
 *
 * DEPOIS: a alça da partida é um ANEL em volta do centro. O miolo do anel é do corpo da feição
 * (arrasto do símbolo, rota inteira), e o anel é a alça (só a partida, sem salto no primeiro
 * movimento). Os dois gestos continuam à vista: o anel se desenha como alça, com o número.
 *
 * MEDIDO antes do anel: o caso 1 reprovava no ponto-chave 2, parado (diferença 0 contra o
 * deslocamento do símbolo), e o caso 2 levava a rota inteira, porque a 18px a caixa de acerto não
 * alcançava a alça de 9px. Controles: sem o filtro do miolo em `_queryHandle` o caso 1 volta a
 * reprovar; sem a compensação da pegada o caso 2 reprova com a partida 18px fora do lugar.
 *
 * SEMEADURA sem interface: a rota de três pontos é gravada pela store (o sujeito é o arrasto, e a
 * rota criada pelo editor já tem caso próprio em `cobertura-trajetoria-colega.spec.js`).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawMilitarySymbolUI, selectFeatureUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Raio, em px, em que o arrasto pega o ANEL (a faixa desenhada vai de 16 a 20 px do centro). */
const NO_ANEL = 18;

const rotaDe = (page, id) => page.evaluate(async (fid) => {
    const s = await import('/src/js/store/index.js');
    const f = ((await s.getCurrentMapFeatures()).military_symbols ?? []).find((x) => x.properties?.id === fid);
    return f ? JSON.parse(JSON.stringify({ geometry: f.geometry.coordinates, trajetoria: f.properties.trajetoria ?? null })) : null;
}, id);

const naTela = (page, lngLat) => page.evaluate((c) => {
    const map = globalThis.__ebgeoMap;
    const r = map.getCanvas().getBoundingClientRect();
    const p = map.project(c);
    return { x: r.left + p.x, y: r.top + p.y };
}, lngLat);

async function simboloComRota(page) {
    await page.goto('/');
    await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
    const id = await drawMilitarySymbolUI(page, [-43.2, -22.9]);
    await page.keyboard.press('Escape');
    const casa = (await rotaDe(page, id)).geometry;
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
    await expect.poll(async () => (await rotaDe(page, id))?.trajetoria?.length ?? 0, { timeout: 15000 }).toBe(3);
    // A escrita pela store não repinta a fonte do mapa num atlas local; o F5 a traz do disco.
    await page.reload();
    await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
    await selectFeatureUI(page, id);
    // O CLIQUE NA ÁRVORE ENQUADRA A FEIÇÃO (`frameFeatures`, desde 2026-09-24): um símbolo é
    // enquadrado pela caixa dele, perto do zoom 17, e ali os pontos-chave 2 e 3 caem fora da tela
    // (medido: x = 1784 e 2929 num canvas de 1280). A fonte do editor tinha as três alças e só a
    // da partida estava DESENHADA, que era o "1 em vez de 3" desta espera. A câmera volta ao zoom
    // 14 depois do enquadramento: a cada volta da espera, câmera em movimento espera, câmera fora
    // do zoom 14 volta a ele, e só a câmera parada no 14 conta as alças desenhadas.
    await expect.poll(() => page.evaluate((c) => {
        const map = globalThis.__ebgeoMap;
        if (map.isMoving()) return 'camera em movimento';
        if (Math.abs(map.getZoom() - 14) > 1e-9) {
            map.jumpTo({ center: c, zoom: 14 });
            return 'camera voltou ao zoom 14';
        }
        return map.getLayer('trajectory-edit-vertex-layer')
            ? map.queryRenderedFeatures({ layers: ['trajectory-edit-vertex-layer'] }).length
            : 0;
    }, casa), { timeout: 15000, message: 'o editor nao desenhou as alcas da rota' }).toBe(3);
    return { id, rota };
}

async function arrastar(page, de, [dx, dy]) {
    await page.mouse.move(de.x, de.y);
    await page.mouse.down();
    await page.mouse.move(de.x + dx / 2, de.y + dy / 2, { steps: 6 });
    await page.mouse.move(de.x + dx, de.y + dy, { steps: 6 });
    await page.mouse.up();
}

describeOrSkip('alça da partida em anel', () => {
    test.describe.configure({ retries: 0 });

    test('pegar o símbolo PELO CENTRO move a rota inteira', async ({ page }) => {
        test.setTimeout(180000);
        const { id, rota } = await simboloComRota(page);
        const centro = await naTela(page, [rota[0].lng, rota[0].lat]);
        await arrastar(page, centro, [-60, 60]);
        await expect.poll(async () => (await rotaDe(page, id))?.trajetoria?.[0]?.lng, { timeout: 15000, message: 'o arrasto nao moveu' })
            .not.toBe(rota[0].lng);

        const { trajetoria, geometry } = await rotaDe(page, id);
        expect(trajetoria.map((k) => k.t)).toEqual(rota.map((k) => k.t));
        const dLng = trajetoria[0].lng - rota[0].lng;
        const dLat = trajetoria[0].lat - rota[0].lat;
        for (let i = 1; i < rota.length; i++) {
            expect(trajetoria[i].lng - rota[i].lng, `o ponto-chave ${i + 1} nao acompanhou o simbolo`).toBeCloseTo(dLng, 9);
            expect(trajetoria[i].lat - rota[i].lat, `o ponto-chave ${i + 1} nao acompanhou o simbolo`).toBeCloseTo(dLat, 9);
        }
        expect(geometry).toEqual([trajetoria[0].lng, trajetoria[0].lat]);
    });

    test('pegar o ANEL move só a partida, sem salto, e a feição acompanha', async ({ page }) => {
        test.setTimeout(180000);
        const { id, rota } = await simboloComRota(page);
        const centro = await naTela(page, [rota[0].lng, rota[0].lat]);
        await arrastar(page, { x: centro.x - NO_ANEL, y: centro.y }, [-60, 60]);
        await expect.poll(async () => (await rotaDe(page, id))?.trajetoria?.[0]?.lng, { timeout: 15000, message: 'o arrasto do anel nao moveu a partida' })
            .not.toBe(rota[0].lng);

        const { trajetoria, geometry } = await rotaDe(page, id);
        // Só a partida andou.
        expect(trajetoria.slice(1)).toEqual(rota.slice(1));
        expect(geometry).toEqual([trajetoria[0].lng, trajetoria[0].lat]);
        // E andou o que o ponteiro andou: pegar o anel a 18 px do centro não faz a partida saltar
        // para baixo do ponteiro no primeiro movimento.
        const chegou = await naTela(page, [trajetoria[0].lng, trajetoria[0].lat]);
        expect(Math.hypot(chegou.x - (centro.x - 60), chegou.y - (centro.y + 60)), 'a partida saltou para o ponteiro')
            .toBeLessThan(2);
    });
});

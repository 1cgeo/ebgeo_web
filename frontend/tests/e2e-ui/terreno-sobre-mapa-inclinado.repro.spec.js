// Path: e2e-ui/terreno-sobre-mapa-inclinado.repro.spec.js

/**
 * @fileoverview REPRO: ligar o terreno com o mapa JÁ inclinado deixava a câmera DENTRO do relevo.
 *
 * O RELATO (dono, 2026-09-24): "só dá problema se eu já tiver inclinado antes de carregar o
 * terreno, se for depois não dá problema". A tela ficava só com o fundo estrelado.
 *
 * A CAUSA ERA DO MAPLIBRE 6.9.1, e a atualização para a 6.11.2 a removeu. O botão chama
 * `setTerrain` e em seguida `easeTo({ pitch: 60 })` (`terrain/terrain.control.js`). Na 6.9.1 todo
 * `easeTo` com terreno ligava `elevationFreeze` e só o soltava quando a animação pedia
 * `freezeElevation`, o que o botão não pede: a trava ficava presa até o próximo GESTO, e enquanto
 * ela durava nem o quadro nem a chegada de tile de DEM subiam o centro até o chão. A câmera ficava
 * na altitude calculada sobre o nível do mar. A correção própria do MapLibre contra câmera enterrada
 * (`_elevateCameraIfInsideTerrain`) só roda enquanto a câmera se move, então ela só salva a câmera
 * quando o DEM chega DURANTE a animação. Com o mapa plano antes, a animação de 0 a 60 graus dá tempo
 * para isso; com o mapa já inclinado, não há o que corrigir no caminho. Na 6.11.2 o fim do `easeTo`
 * solta a trava e a chegada do tile move a câmera junto com o centro (`applyTerrainChange`).
 *
 * O DEM É SINTÉTICO E CHEGA QUANDO O TESTE MANDA: um platô de 1500 m (2250 m com o exagero padrão
 * de 1,5) servido por `route`, com atraso opcional. É isso que torna determinística a ordem entre o
 * fim da animação e a chegada do tile, que no navegador do usuário é corrida de rede.
 *
 * CONTROLE NEGATIVO, medido com a 6.9.1 reinstalada em 2026-09-24: nos três casos a câmera
 * terminava a 593 m sobre um chão de 2250 m, com o centro preso em 0 m. Na 6.11.2, 12 de 12
 * rodadas terminaram 593 m ACIMA do chão, com a inclinação de 60 graus preservada.
 */

import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const DEM_HOST = 'https://dem-sintetico.invalid';
const CENTRO = [-43.2, -22.9];
const ZOOM = 16;
/** A inclinação que o botão de terreno aplica (`TerrainControl._terrainPitch`). */
const INCLINACAO_DO_TERRENO = 60;

/**
 * Troca a fonte de terreno da config por uma de tiles sintéticos e sobe o mapa.
 * @param {import('@playwright/test').Page} page
 * @param {number} atrasoMs - Quanto cada tile de DEM espera antes de ser servido.
 */
async function subirComDemSintetico(page, atrasoMs) {
    await page.context().route((url) => url.pathname.endsWith('/config') && url.pathname.includes('/api/'), async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        const cfg = body?.data?.map2d ? body.data : body;
        cfg.map2d.terrainSource = { type: 'raster-dem', tiles: [`${DEM_HOST}/{z}/{x}/{y}.png`], tileSize: 256, maxzoom: 14 };
        // Sem troca de mapa base junto com o terreno: ela recarrega as fontes e embaralha a ordem medida.
        cfg.map2d.terrainPreferredBasemap = null;
        await route.fulfill({ response, json: body });
    });

    await page.goto('/');
    await page.waitForFunction(() => globalThis.__ebgeoMap?.isStyleLoaded?.() === true, null, { timeout: 30000 });

    // 1500 m na codificação mapbox: (1500 + 10000) / 0,1 = 115000 = 1*65536 + 193*256 + 56.
    const png = await page.evaluate(async () => {
        const canvas = new OffscreenCanvas(256, 256);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgb(1,193,56)';
        ctx.fillRect(0, 0, 256, 256);
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        return btoa(s);
    });
    const corpo = Buffer.from(png, 'base64');
    await page.context().route(`${DEM_HOST}/**`, async (route) => {
        if (atrasoMs > 0) await new Promise((r) => setTimeout(r, atrasoMs));
        await route.fulfill({ body: corpo, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } });
    });
}

/**
 * Quanto a câmera está ACIMA do relevo sob ela, em metros, pela mesma consulta que a correção do
 * MapLibre usa. Um número muito negativo enquanto o DEM sob a câmera ainda não chegou, para que a
 * espera continue em vez de aprovar um chão desconhecido lido como zero.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
function folgaDaCamera(page) {
    return page.evaluate(() => {
        const map = globalThis.__ebgeoMap;
        const tr = map._camera.transform;
        const chao = map.terrain?.getElevationForLngLatZoom(tr.getCameraLngLat(), map.getZoom()) ?? 0;
        if (!(chao > 0) || map.isMoving()) return -1e9;
        return Math.round(tr.getCameraAltitude() - chao);
    });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} inclinacaoAntes - A inclinação do mapa ANTES de ligar o terreno.
 * @param {number} atrasoMs - O atraso de cada tile de DEM.
 */
async function ligarTerrenoEMedir(page, inclinacaoAntes, atrasoMs) {
    await subirComDemSintetico(page, atrasoMs);
    await page.evaluate(({ c, z, p }) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: z, pitch: p, bearing: 0 }),
        { c: CENTRO, z: ZOOM, p: inclinacaoAntes });

    await page.locator('#feature-toggle-terrain').click();

    await expect.poll(() => folgaDaCamera(page), {
        message: 'a câmera tem de ficar ACIMA do relevo sob ela depois de o DEM chegar',
        timeout: 15000,
    }).toBeGreaterThan(100);
    expect(
        await page.evaluate(() => Math.round(globalThis.__ebgeoMap.getPitch())),
        'a câmera sai do relevo sem perder a inclinação que o botão aplicou',
    ).toBe(INCLINACAO_DO_TERRENO);
}

describeOrSkip('terreno ligado sobre mapa inclinado', () => {
    test('REPRO: inclinado antes, DEM chega depois da animação', async ({ page }) => {
        await ligarTerrenoEMedir(page, INCLINACAO_DO_TERRENO, 1500);
    });

    test('REPRO: inclinado antes, DEM sem atraso (o relato do dono)', async ({ page }) => {
        await ligarTerrenoEMedir(page, INCLINACAO_DO_TERRENO, 0);
    });

    test('plano antes, DEM chega depois da animação', async ({ page }) => {
        await ligarTerrenoEMedir(page, 0, 1500);
    });
});

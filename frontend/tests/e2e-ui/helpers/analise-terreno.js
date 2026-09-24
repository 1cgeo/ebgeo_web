// Path: e2e-ui/helpers/analise-terreno.js

/**
 * @fileoverview Drivers das duas ferramentas de análise de terreno (Linha de Visada e Viewshed)
 * sobre um relevo SINTÉTICO, para specs de navegador.
 *
 * O que é sintético é só a FONTE de elevação: os dois métodos do MapLibre que
 * `getTerrainElevation` consulta (`getTerrain` e `queryTerrainElevation`) são substituídos no
 * objeto do mapa, e o `fire('terrain')` é o evento que reabilita os botões. A razão por extenso,
 * e a aritmética do raio da colina, estão em `analise-processada-round-trip.spec.js`.
 *
 * O relevo é um platô de 1200 m, 0,05 grau de meia-largura em torno de `COLINA_LNG`, e as
 * coordenadas exportadas foram escolhidas para dar uma visada OBSTRUÍDA (duas metades) e um
 * viewshed inteiramente visível (uma metade).
 */

import { expect } from '@playwright/test';

export const COLINA_LNG = -43.2;
export const LAT = -22.9;
/** As duas pontas da visada, fora do platô, com a colina entre elas. */
export const LOS_A = [-43.26, LAT];
export const LOS_B = [-43.14, LAT];
/** Centro e borda do viewshed, os dois sobre o platô. */
export const VIS_CENTRO = [COLINA_LNG, LAT];
export const VIS_BORDA = [-43.17, LAT];

/** Instala o relevo sintético no mapa da página e centraliza a câmera sobre ele. */
export async function prepararTerreno(page) {
    await abrirGrupoAnalise(page);
    await page.evaluate(({ lng, raio, cota }) => {
        const map = globalThis.__ebgeoMap;
        map.getTerrain = () => ({ source: 'terreno-sintetico', exaggeration: 1 });
        map.queryTerrainElevation = (coords) => {
            const lon = Array.isArray(coords) ? coords[0] : coords?.lng;
            if (!Number.isFinite(lon)) return 0;
            return Math.abs(lon - lng) < raio ? cota : 0;
        };
        map.fire('terrain');
    }, { lng: COLINA_LNG, raio: 0.05, cota: 1200 });
    await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 11 }), VIS_CENTRO);
    await page.waitForFunction(() => globalThis.__ebgeoMap.isStyleLoaded?.() === true
        && globalThis.__ebgeoMap.isMoving?.() === false, null, { timeout: 20000 });
}

/** Clica num lng/lat do mapa, projetando no instante do clique e esperando o pixel ser do canvas. */
export async function clicarNoMapa(page, lngLat) {
    await page.waitForFunction((ll) => {
        const map = globalThis.__ebgeoMap;
        const canvas = map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const pt = map.project(ll);
        const topo = document.elementFromPoint(Math.round(rect.left + pt.x), Math.round(rect.top + pt.y));
        return !!topo && (topo === canvas || canvas.contains(topo));
    }, lngLat, { timeout: 15000 });
    const alvo = await page.evaluate((ll) => {
        const map = globalThis.__ebgeoMap;
        const rect = map.getCanvas().getBoundingClientRect();
        const p = map.project(ll);
        return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y) };
    }, lngLat);
    await page.mouse.click(alvo.x, alvo.y);
}

/** Abre a gaveta do grupo Análise, idempotente (o botão do grupo alterna). */
export async function abrirGrupoAnalise(page) {
    const popup = page.locator('.toolbar-group[data-group-id="analysis"] .toolbar-popup');
    if ((await popup.getAttribute('data-visible')) !== 'true') {
        await page.locator('.toolbar-group[data-group-id="analysis"] .toolbar-group-btn').click();
    }
    await expect(popup).toHaveAttribute('data-visible', 'true', { timeout: 10000 });
}

/** Ativa uma ferramenta de análise e espera o GERENTE reportá-la ativa. */
export async function ativarFerramenta(page, toolId) {
    await abrirGrupoAnalise(page);
    const botao = page.locator(`.toolbar-group[data-group-id="analysis"] .toolbar-tool-btn[data-tool-id="${toolId}"]`);
    await expect(botao).toBeEnabled({ timeout: 10000 });
    await botao.click();
    await expect.poll(async () => page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        return String(s.getStateManager?.()?.getActiveTool?.() ?? '');
    }), { timeout: 20000, message: `a ferramenta ${toolId} nao ficou ativa` }).toMatch(new RegExp(`^${toolId}$`, 'i'));
}

/** Tira do caminho o que a feição recém-criada abriu (ferramenta, painel, barra lateral). */
export async function desocupar(page) {
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        const sm = s.getStateManager?.();
        sm?.closeFeaturePanel?.();
        sm?.collapseSidebar?.();
    });
}

/** Lê um balde do mapa corrente como `{ id, props, geometry }`. */
export async function balde(page, nome) {
    return page.evaluate(async (b) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return JSON.parse(JSON.stringify((f[b] ?? []).map((x) => ({ id: x.properties?.id, props: x.properties, geometry: x.geometry }))));
    }, nome);
}

/** Traça uma visada pela ferramenta real e devolve o id da entrada. */
export async function tracarVisada(page) {
    const antes = new Set((await balde(page, 'los')).map((f) => f.id));
    await ativarFerramenta(page, 'los');
    await clicarNoMapa(page, LOS_A);
    await clicarNoMapa(page, LOS_B);
    let id = null;
    await expect.poll(async () => {
        id = (await balde(page, 'los')).find((f) => !antes.has(f.id))?.id ?? null;
        return id;
    }, { timeout: 60000, message: 'a visada nao nasceu' }).toBeTruthy();
    return id;
}

/** Traça um viewshed pela ferramenta real, espera a varredura terminar, e devolve o id da entrada. */
export async function tracarViewshed(page) {
    const antes = new Set((await balde(page, 'visibility')).map((f) => f.id));
    await ativarFerramenta(page, 'visibility');
    await clicarNoMapa(page, VIS_CENTRO);
    await clicarNoMapa(page, VIS_BORDA);
    let id = null;
    await expect.poll(async () => {
        id = (await balde(page, 'visibility')).find((f) => !antes.has(f.id))?.id ?? null;
        return id;
    }, { timeout: 300000, intervals: [500, 1000], message: 'o viewshed nao nasceu' }).toBeTruthy();
    await expect(page.locator('.visibility-progress-modal--visible')).toHaveCount(0, { timeout: 60000 });
    return id;
}

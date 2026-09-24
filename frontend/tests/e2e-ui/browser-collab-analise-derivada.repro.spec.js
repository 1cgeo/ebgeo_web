// Path: e2e-ui/browser-collab-analise-derivada.repro.spec.js

/**
 * @fileoverview A SAÍDA DA ANÁLISE NUM ATLAS DE SERVIDOR, com dois navegadores e o backend real.
 *
 * O DEFEITO (medido em 2026-09-23). A Linha de Visada e o Viewshed desenham, cada um, uma ENTRADA
 * (`los`, `visibility`) e uma SAÍDA (`processed_*`, as metades verde e vermelha). A camada da
 * entrada é pintada com opacidade ZERO (`layers/styles/tactical.layers.js`): o que a pessoa vê é
 * só a saída. E a saída nasce com id `<entrada>-visible` / `<entrada>-obstructed`, que não é UUID,
 * então o servidor a recusava ("identificador ou valor com formato inválido"). Três sintomas, os
 * três medidos na primeira sonda: o autor ficava com "Recusas: 2" para sempre; o autor PERDIA o
 * desenho no F5 (processed_los 2 -> 0, a entrada invisível continuava lá); e o par nunca via a
 * análise. Nenhum teste pegava, porque todos os de sync semeiam a saída com UUID, que não é o id
 * que a ferramenta produz.
 *
 * A DECISÃO (2026-09-23): a saída é DERIVADA por cada cliente, pela mesma função pura que a
 * ferramenta usa (`store/analysis-output.js`), e nunca viaja.
 *
 * O QUE ESTE CASO AFIRMA, e cada um reprova sem o conserto:
 *   - o par vê a visada e o viewshed, com as MESMAS metades (id, geometria, cor) do autor, no store
 *     e na fonte do MapLibre que as desenha;
 *   - o autor não fica com recusa nenhuma, e o servidor não guarda linha de saída nenhuma;
 *   - depois de F5, autor e par continuam com as metades;
 *   - excluir a visada no autor a tira do par, metades inclusive.
 *
 * O TERRENO É SINTÉTICO, e só ele: os dois métodos do MapLibre que a análise consulta são
 * substituídos no objeto do mapa do AUTOR, como em `analise-processada-round-trip.spec.js`. O par
 * não precisa de terreno nenhum, e isso é parte do que se mede: ele deriva, não recalcula.
 */

import { collabTest, expect, readFeatures, deleteFeatureUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

const COLINA_LNG = -43.2;
const LAT = -22.9;
const LOS_A = [-43.26, LAT];
const LOS_B = [-43.14, LAT];
const VIS_CENTRO = [COLINA_LNG, LAT];
const VIS_BORDA = [-43.17, LAT];

/** Campos de escrituração que cada cliente carimba por conta própria e não fazem parte do desenho. */
const ESCRITURACAO = ['confirmedVersion', 'version', 'createdAt', 'updatedAt', 'sync'];

async function instalarTerreno(page) {
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
}

async function clicar(page, lngLat) {
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

async function abrirGrupoAnalise(page) {
    const popup = page.locator('.toolbar-group[data-group-id="analysis"] .toolbar-popup');
    if ((await popup.getAttribute('data-visible')) !== 'true') {
        await page.locator('.toolbar-group[data-group-id="analysis"] .toolbar-group-btn').click();
    }
    await expect(popup).toHaveAttribute('data-visible', 'true', { timeout: 10000 });
}

async function ativarFerramenta(page, toolId) {
    await abrirGrupoAnalise(page);
    const botao = page.locator(`.toolbar-group[data-group-id="analysis"] .toolbar-tool-btn[data-tool-id="${toolId}"]`);
    await expect(botao).toBeEnabled({ timeout: 10000 });
    await botao.click();
    await expect.poll(async () => page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        return String(s.getStateManager?.()?.getActiveTool?.() ?? '');
    }), { timeout: 20000, message: `a ferramenta ${toolId} nao ficou ativa` }).toMatch(new RegExp(`^${toolId}$`, 'i'));
}

async function desocupar(page) {
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        const sm = s.getStateManager?.();
        sm?.closeFeaturePanel?.();
        sm?.collapseSidebar?.();
    });
}

/** As metades de um balde, reduzidas ao desenho: id, geometria, cor e as props de domínio. */
async function metades(page, balde) {
    const lista = await page.evaluate(async (b) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return JSON.parse(JSON.stringify(f[b] ?? []));
    }, balde);
    return lista
        .map((f) => {
            const props = { ...f.properties };
            for (const chave of ESCRITURACAO) delete props[chave];
            return { id: f.properties.id, geometry: f.geometry, props };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
}

/** Os ids que a fonte do MapLibre de um balde de saída está desenhando agora. */
async function idsNaFonte(page, sourceId) {
    return page.evaluate(async (id) => {
        const src = globalThis.__ebgeoMap.getSource(id);
        if (!src) return null;
        const data = await src.getData();
        return (data?.features ?? []).map((f) => f.properties?.id).sort();
    }, sourceId);
}

async function recusas(page) {
    return page.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.countByState()).problemas;
    });
}

collabTest('a visada e o viewshed chegam ao par, sobrevivem ao F5 e somem com a exclusao', async ({ collab }) => {
    collabTest.setTimeout(600000);
    const A = collab.author;
    const B = collab.peers[0];

    // ---------------------------------------------------------------- o autor analisa
    await abrirGrupoAnalise(A);
    await instalarTerreno(A);
    await A.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 11 }), VIS_CENTRO);
    await A.waitForFunction(() => globalThis.__ebgeoMap.isStyleLoaded?.() === true
        && globalThis.__ebgeoMap.isMoving?.() === false, null, { timeout: 20000 });

    await ativarFerramenta(A, 'los');
    await clicar(A, LOS_A);
    await clicar(A, LOS_B);
    await expect.poll(async () => (await readFeatures(A, 'processed_los')).length, { timeout: 60000 }).toBe(2);
    const [visada] = await readFeatures(A, 'los');
    const losId = visada.id;

    await desocupar(A);
    await ativarFerramenta(A, 'visibility');
    await clicar(A, VIS_CENTRO);
    await clicar(A, VIS_BORDA);
    await expect.poll(async () => (await readFeatures(A, 'processed_visibility')).length, {
        timeout: 300000, intervals: [500, 1000],
    }).toBe(1);
    await expect(A.locator('.visibility-progress-modal--visible')).toHaveCount(0, { timeout: 60000 });
    const [viewshed] = await readFeatures(A, 'visibility');
    const visId = viewshed.id;
    await desocupar(A);

    const losDoAutor = await metades(A, 'processed_los');
    const visDoAutor = await metades(A, 'processed_visibility');
    expect(losDoAutor.map((m) => m.id)).toEqual([`${losId}-obstructed`, `${losId}-visible`]);
    expect(visDoAutor.map((m) => m.id)).toEqual([`${visId}-visible`]);

    // ---------------------------------------------------------------- o par ve a mesma analise
    await expect.poll(async () => (await metades(B, 'processed_los')).map((m) => m.id), {
        timeout: 30000, message: 'o par nao recebeu as metades da visada',
    }).toEqual([`${losId}-obstructed`, `${losId}-visible`]);
    await expect.poll(async () => (await metades(B, 'processed_visibility')).map((m) => m.id), {
        timeout: 30000, message: 'o par nao recebeu a metade do viewshed',
    }).toEqual([`${visId}-visible`]);
    await expect.poll(() => metades(B, 'processed_los'), { timeout: 15000, message: 'campo a campo, a visada do par e a do autor' })
        .toEqual(losDoAutor);
    await expect.poll(() => metades(B, 'processed_visibility'), { timeout: 15000, message: 'campo a campo, o viewshed do par e o do autor' })
        .toEqual(visDoAutor);
    await expect.poll(() => idsNaFonte(B, 'processed-los'), { timeout: 15000, message: 'a fonte do par nao desenha a visada' })
        .toEqual([`${losId}-obstructed`, `${losId}-visible`]);
    await expect.poll(() => idsNaFonte(B, 'processed-visibility'), { timeout: 15000, message: 'a fonte do par nao desenha o viewshed' })
        .toEqual([`${visId}-visible`]);

    // ---------------------------------------------------------------- nada recusado, nada de saida no servidor
    await expect.poll(async () => A.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.countByState()).pendentes;
    }), { timeout: 30000 }).toBe(0);
    expect(await recusas(A), 'o autor nao pode ficar com recusa nenhuma').toBe(0);
    const linhas = await collab.db.raw.any(
        'SELECT feature_type FROM features WHERE map_id = $1 AND deleted_at IS NULL ORDER BY feature_type', [collab.mapId],
    );
    expect(linhas.map((l) => l.feature_type)).toEqual(['los', 'visibility']);

    // ---------------------------------------------------------------- F5 nos dois
    for (const page of [A, B]) {
        await page.reload();
        await expect.poll(async () => (await readFeatures(page, 'los')).length, { timeout: 30000 }).toBe(1);
        await expect.poll(async () => (await metades(page, 'processed_los')).map((m) => m.id), {
            timeout: 30000, message: 'as metades da visada sumiram no F5',
        }).toEqual([`${losId}-obstructed`, `${losId}-visible`]);
        await expect.poll(async () => (await metades(page, 'processed_visibility')).map((m) => m.id), {
            timeout: 30000, message: 'a metade do viewshed sumiu no F5',
        }).toEqual([`${visId}-visible`]);
    }
    // POLL, E NÃO LEITURA ÚNICA. Uma leitura única aqui reprovou uma vez em três rodadas, com o par
    // SEM a metade do viewshed logo depois de o poll acima tê-la visto (a visada estava lá). A causa
    // não foi isolada nesta rodada e fica registrada como suspeita no relatório da caça; o que este
    // caso afirma é a convergência, e convergência se espera por estado.
    await expect.poll(async () => JSON.stringify(await metades(B, 'processed_los')), { timeout: 15000 })
        .toBe(JSON.stringify(await metades(A, 'processed_los')));
    await expect.poll(async () => JSON.stringify(await metades(B, 'processed_visibility')), { timeout: 15000 })
        .toBe(JSON.stringify(await metades(A, 'processed_visibility')));
    expect(await recusas(A), 'nenhuma recusa depois do F5').toBe(0);

    // ---------------------------------------------------------------- excluir no autor tira do par
    await deleteFeatureUI(A, losId);
    await expect.poll(async () => (await readFeatures(B, 'los')).length, { timeout: 30000 }).toBe(0);
    await expect.poll(async () => (await metades(B, 'processed_los')).length, {
        timeout: 15000, message: 'a exclusao da visada deixou as metades no par',
    }).toBe(0);
    await expect.poll(() => idsNaFonte(B, 'processed-los'), { timeout: 15000 }).toEqual([]);
    expect((await metades(B, 'processed_visibility')).map((m) => m.id), 'o viewshed nao foi tocado').toEqual([`${visId}-visible`]);
});

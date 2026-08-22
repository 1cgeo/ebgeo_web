// Path: e2e-ui/browser-collab-all-types.spec.js

/**
 * EVERY FEATURE TYPE syncs cross-client — TWO real browsers + real backend, on the
 * full-chain harness. Client A creates ONE feature of EACH backend-valid type
 * (ALL_FEATURE_SOURCES) and EACH is verified through the ENTIRE sync chain to B via
 * `collab.expectFullSync` (skipRender: many types render via non-GeoJSON layers, so link 6
 * relies on remote.applied + the peer IDB read). Any type that fails is collected with the
 * link it broke at, so a failure lists EXACTLY which type (and where) did not sync.
 *
 * UI-first: point/polygon/military_symbol are drawn with the REAL toolbar tools; the rest
 * go through the store op with a documented no-UI reason (see UI_DRAWERS).
 *
 * Run headed:  npx playwright test browser-collab-all-types --headed
 */

import { collabTest, expect, drawPointUI, drawPolygonUI, readFeatures } from './helpers/collab.fixtures.js';
import { realFeature, ALL_FEATURE_SOURCES } from '../helpers/real-fixtures.js';

/**
 * Source → storage-bucket map, taken from the store itself.
 *
 * It used to be eighteen pairs written out here, next to a header announcing "the 18
 * backend-valid types", while the store, the Joi schema and the database CHECK all agreed on
 * TWENTY: `sector` and `magnetic_declination` were missing. A sweep that names itself "every
 * feature type" and covers a subset is the most dangerous copy in the repository, because it
 * wears the clothes of a verification. `FEATURE_TYPE_MAPPINGS` is itself derived from
 * `store/feature-type.registry.js`, so a type born there arrives here with no edit.
 */
import { FEATURE_TYPE_MAPPINGS } from '../../src/js/store/store.constants.js';

function sourceToStorage(source) {
    const storage = FEATURE_TYPE_MAPPINGS[source];
    if (!storage) throw new Error(`No storage bucket mapped for source "${source}"`);
    return storage;
}

const C = [-43.2, -22.9];

/**
 * Closes any feature panel a prior draw's auto-select left over the canvas.
 *
 * ESTE LAÇO DESISTIA EM SILÊNCIO, e o custo aparecia longe daqui. A versão anterior tentava
 * seis vezes com `Escape` e seguia em frente sem conferir nada. Quando o `Escape` não fecha (o
 * foco está num campo do painel, ou um tool ativo consome a tecla), o painel continua sobre o
 * terço esquerdo do mapa, os três vértices do polígono caem TODOS nele, o canvas nunca os vê e
 * o desenho fica pendurado: tool ativo, `drawPoints: 0`, nenhuma feição e nenhum erro. O que
 * reprovava era o `expect.poll` do desenho, 20 s depois, dizendo só que a feição não apareceu.
 * Medido em 2026-08-22, em dez rodadas em série: uma reprodução, com o diagnóstico do harness
 * nomeando o obstáculo (`div.feature-tab-content active`).
 *
 * O BOTÃO DE FECHAR do próprio painel entra como caminho preferido, porque o `Escape` depende
 * de foco e o clique no botão não. O que NÃO se faz aqui é reprovar quando o painel resiste:
 * o desenho deixou de depender dele. `drawViaToolUI` passou a reservar no enquadramento a
 * faixa que o painel ocupa (`collab-helpers.js`), então um painel teimoso não intercepta mais
 * vértice nenhum. Reprovar aqui viraria falso positivo sobre um estado que não atrapalha mais,
 * e regra que reprova comportamento correto é pior que regra nenhuma.
 */
async function dismissPanels(page) {
    const aberto = page.locator('.feature-panel[data-expanded="true"]');
    for (let i = 0; i < 6; i++) {
        if ((await aberto.count()) === 0) break;
        const fechar = aberto.locator('.sidebar-panel-close');
        if (await fechar.count()) {
            await fechar.first().click({ force: true }).catch(() => { /* Escape abaixo */ });
        }
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
    }
    // A saída do painel é uma transição de `transform`; esperar o atributo não espera o pixel.
    await page.waitForTimeout(250);
}

/** Places a military symbol via the real military toolbar tool (single canvas click). */
async function drawMilitarySymbolUI(page) {
    const before = new Set((await readFeatures(page, 'military_symbols')).map((f) => f.id));
    await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 13 }), C);
    await page.waitForTimeout(300);
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="militarySymbol"]').click();
    await page.waitForTimeout(300);
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    let id = null;
    await expect.poll(async () => {
        const fresh = (await readFeatures(page, 'military_symbols')).find((f) => !before.has(f.id));
        id = fresh?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    return id;
}

/** Sources with a reliable single-gesture REAL UI create; every other source uses the store op. */
const UI_DRAWERS = Object.freeze({
    point: (page) => drawPointUI(page, C),
    polygon: (page) => drawPolygonUI(page, [[-43.22, -22.92], [-43.18, -22.92], [-43.18, -22.88]]),
    military_symbol: (page) => drawMilitarySymbolUI(page),
});

collabTest.describe('Every feature type syncs cross-client (UI draws + store op, full chain)', () => {
    collabTest('A creates one feature of every type → each traverses the whole chain to B', async ({ collab }) => {
        collabTest.setTimeout(300000);
        const A = collab.author;

        // Guard against silent drift from the app: our table must match getStorageTypeFromSource()
        // for every non-processed source (the processed_* pair is intentionally hard-mapped).
        const storeMap = await A.evaluate(async (sources) => {
            const store = await import('/src/js/store/index.js');
            return Object.fromEntries(sources.map((s) => [s, store.getStorageTypeFromSource(s)]));
        }, [...ALL_FEATURE_SOURCES]);
        for (const source of ALL_FEATURE_SOURCES) {
            if (source === 'processed_los' || source === 'processed_visibility') continue;
            expect(storeMap[source], `store getStorageTypeFromSource('${source}')`).toBe(sourceToStorage(source));
        }

        // BATCH: A creates one feature of each type, recording (source, storage, id).
        const created = [];
        for (const source of ALL_FEATURE_SOURCES) {
            const storage = sourceToStorage(source);
            const drawUI = UI_DRAWERS[source];
            if (drawUI) {
                await dismissPanels(A);
                const uiId = await drawUI(A);
                await A.keyboard.press('Escape');
                created.push({ source, storage, id: uiId, landedOnA: !!uiId });
                continue;
            }
            const id = crypto.randomUUID();
            const f = realFeature(source, { id });
            let landedOnA = false;
            for (let attempt = 0; attempt < 5 && !landedOnA; attempt++) {
                if (attempt > 0) await A.waitForTimeout(500);
                landedOnA = await A.evaluate(async ({ s, feat }) => {
                    const store = await import('/src/js/store/index.js');
                    const out = await store.addFeature(s, feat);
                    const all = await store.getCurrentMapFeatures();
                    return !!out && (all[s] || []).some((x) => x.properties?.id === feat.properties.id);
                }, { s: storage, feat: f });
            }
            created.push({ source, storage, id, landedOnA });
        }
        expect(created).toHaveLength(ALL_FEATURE_SOURCES.length);

        // VERIFY: each type traverses the WHOLE chain to B. Collect every failure (with the link
        // it broke at) so the assertion lists exactly which types did not fully sync.
        const failures = [];
        for (const item of created) {
            if (!item.landedOnA) {
                failures.push(`${item.source} (refused by addFeature on A)`);
                continue;
            }
            try {
                // 25s per type, not 12s, and the number is measured rather than picked: at 12s
                // `military_symbol` broke at LINK 5 (peer IndexedDB) in roughly 2 of 9 serial
                // runs, always that type and always that link. It is the heaviest op of the
                // sweep and the last of the three drawn through the real toolbar, so its op
                // enqueues latest while the verification budget stays the same for everyone.
                // Nothing is blocked — the remote apply never awaits an image — so the 12s was
                // simply the arbitrary part.
                await collab.expectFullSync({ entityId: item.id, type: item.storage, operationType: 'create', skipRender: true, timeout: 25000 });
            } catch (e) {
                failures.push(`${item.source} → ${item.storage}: ${String(e.message).split('\n')[0]}`);
            }
        }
        expect(failures, `types that did NOT fully sync:\n${failures.join('\n') || 'none'}`).toEqual([]);
    });
});

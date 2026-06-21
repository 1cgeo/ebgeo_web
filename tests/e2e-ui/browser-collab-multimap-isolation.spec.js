// Path: e2e-ui/browser-collab-multimap-isolation.spec.js

/**
 * MULTI-MAP ISOLATION — TWO real browsers + real backend. Each feature op is scoped to a
 * map; a real bug class is leakage across maps. This pins:
 *
 *   - A on map 1 and B on map 2: A's edit on map 1 does NOT appear in B's CURRENT view
 *     (map 2), yet it IS stored against map 1 (so it's there when B switches);
 *   - when B switches to map 1 it sees A's feature; switching back to map 2 it sees map 2's;
 *   - symmetric: B's edit on map 2 lands on map 2, not map 1.
 *
 * Run headed:  npx playwright test browser-collab-multimap-isolation --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    currentMapName,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const MAP1 = 'Mapa Tático';
const MAP2 = 'Mapa Secundário';

function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const setMap = (page, name) => applyStoreOp(page, 'setCurrentMap', [name]);
const hasLineCurrent = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);

/** Reads a specific map's stored line ids directly from the repo (independent of current view). */
const repoMapHasLine = (page, mapName, id) => page.evaluate(async ({ mn, i }) => {
    const { getRepository } = await import('/src/js/store/repositories/index.js');
    const m = await getRepository().getMap(mn);
    return ((m && m.features && m.features.lines) || []).some((l) => l.properties?.id === i);
}, { mn: mapName, i: id });

const newLine = (id) => ({
    type: 'Feature',
    properties: { id, source: 'line', layerId: 'default', lineColor: '#3f4fb5', lineWidth: 4 },
    geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
});

describeOrSkip('Multi-map isolation cross-client', () => {
    test('edits are scoped to their map; switching maps shows the right state', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { mapName: MAP1 });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // A creates the second map; wait until B's repo knows it, then B switches to it.
            await applyStoreOp(A, 'addMap', [MAP2]);
            await expect
                .poll(async () => B.evaluate(async () => {
                    const { getRepository } = await import('/src/js/store/repositories/index.js');
                    const all = await getRepository().getAllMaps();
                    return Array.from(all instanceof Map ? all.values() : Object.values(all || {})).map((m) => m && m.name);
                }), { timeout: 20000 })
                .toContain(MAP2);
            await setMap(B, MAP2);
            expect(await currentMapName(B)).toBe(MAP2);
            expect(await currentMapName(A)).toBe(MAP1);

            // A (on MAP1) draws a line. B is viewing MAP2.
            const onMap1 = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['lines', newLine(onMap1)]);

            // It must be stored against MAP1 on B's repo (synced), but NOT in B's CURRENT view (MAP2).
            await expect.poll(async () => repoMapHasLine(B, MAP1, onMap1), { timeout: 20000 }).toBe(true);
            expect(await hasLineCurrent(B, onMap1), 'MAP1 edit does not leak into B\'s MAP2 view').toBe(false);
            await expect.poll(async () => repoMapHasLine(B, MAP2, onMap1), { timeout: 5000 }).toBe(false);

            // B switches to MAP1 → now it sees A's feature.
            await setMap(B, MAP1);
            await expect.poll(async () => hasLineCurrent(B, onMap1), { timeout: 10000 }).toBe(true);

            // Symmetric: B (now on MAP1) draws; A sees it on MAP1; it is NOT on MAP2.
            const onMap1ByB = crypto.randomUUID();
            await applyStoreOp(B, 'addFeature', ['lines', newLine(onMap1ByB)]);
            await expect.poll(async () => hasLineCurrent(A, onMap1ByB), { timeout: 20000 }).toBe(true);
            expect(await repoMapHasLine(A, MAP2, onMap1ByB), 'B\'s MAP1 edit is not on MAP2').toBe(false);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

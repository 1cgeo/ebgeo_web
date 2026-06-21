// Path: e2e-ui/browser-collab-feature-mutations.spec.js

/**
 * FEATURE MUTATIONS synced cross-client — TWO real browsers + real backend. Client A
 * drives the app's OWN store ops (addFeature / updateFeature / updateFeatureProperty /
 * removeFeature via the store facade) and client B asserts NATIVE sync carried each
 * mutation through, with no workarounds.
 *
 * Covered, in order, on a LINE then a MILITARY SYMBOL:
 *   1. create a line                          → B sees the feature
 *   2. rename it                              → B sees the new name
 *   3. set a description                      → B sees the description
 *   4. recolor it (lineColor)                 → B sees the new color
 *   5. move its geometry                      → B sees the new coordinates
 *   6. create a military symbol + change SIDC → B sees the symbol, then the new SIDC
 *   7. delete the line                        → B no longer has it
 *
 * The seed/login/open plumbing and the poll helpers come from ./helpers/collab-helpers.js;
 * structure mirrors browser-collab-shared-atlas.spec.js.
 *
 * Run headed:  npx playwright test browser-collab-feature-mutations --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    pollPeerFeature,
    pollPeerFeatureWhere,
    pollPeerFeatureGone,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Drives a store op on `page` through the app's REAL store facade. */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/** Reads the peer's stored geometry for a feature of `type`/`id` (or null). */
function readPeerGeometry(page, type, id) {
    return page.evaluate(async ({ t, i }) => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const hit = (f[t] || []).find((x) => x.properties?.id === i);
        return hit ? hit.geometry : null;
    }, { t: type, i: id });
}

/** Polls until the peer's stored geometry for `type`/`id` satisfies `pred(geometry)`. */
async function pollPeerGeometryWhere(page, type, id, pred, timeout = 20000) {
    await expect
        .poll(async () => {
            const geom = await readPeerGeometry(page, type, id);
            return geom ? !!pred(geom) : false;
        }, { timeout })
        .toBe(true);
}

describeOrSkip('Feature mutations sync cross-client (two real browsers, real store ops)', () => {
    test('create → rename → describe → recolor → move → military symbol + SIDC → delete', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

        try {
            // 1. A creates a LINE via the real store op → B receives it (native sync).
            const lineId = crypto.randomUUID();
            const line = {
                type: 'Feature',
                properties: {
                    id: lineId,
                    source: 'line',
                    layerId: 'default',
                    nome: 'Eixo',
                    lineColor: '#3f4fb5',
                    lineWidth: 5,
                },
                geometry: {
                    type: 'LineString',
                    coordinates: [[-43.2, -22.9], [-43.1, -22.8]],
                },
            };
            await applyStoreOp(A, 'addFeature', ['lines', line]);
            await pollPeerFeature(B, 'lines', lineId);

            // 2. A renames the line → B sees the new name.
            await applyStoreOp(A, 'updateFeatureProperty', ['lines', lineId, 'nome', 'Eixo Azul']);
            await pollPeerFeatureWhere(B, 'lines', lineId, (p) => p.nome === 'Eixo Azul');

            // 3. A sets a description → B sees it.
            await applyStoreOp(A, 'updateFeatureProperty', ['lines', lineId, 'descricao', '<p>nota</p>']);
            await pollPeerFeatureWhere(B, 'lines', lineId, (p) => p.descricao === '<p>nota</p>');

            // 4. A recolors the line (lineColor is the line's color prop) → B sees the new color.
            await applyStoreOp(A, 'updateFeatureProperty', ['lines', lineId, 'lineColor', '#ee1111']);
            await pollPeerFeatureWhere(B, 'lines', lineId, (p) => p.lineColor === '#ee1111');

            // 5. A moves the geometry (read current feature, update with new coordinates) → B sees the move.
            const lineOnA = (await readFeatures(A, 'lines')).find((x) => x.id === lineId);
            expect(lineOnA, "A's line is in its own store before the move").toBeTruthy();
            const movedLine = {
                type: 'Feature',
                properties: lineOnA.props,
                geometry: {
                    type: 'LineString',
                    coordinates: [[-43.0, -22.7], [-42.9, -22.6]],
                },
            };
            await applyStoreOp(A, 'updateFeature', ['lines', movedLine]);
            await pollPeerGeometryWhere(
                B,
                'lines',
                lineId,
                (geom) => geom.type === 'LineString' && geom.coordinates?.[0]?.[0] === -43.0,
            );

            // 6. A creates a MILITARY SYMBOL → B receives it; then A changes the SIDC → B sees it.
            const symbolId = crypto.randomUUID();
            const symbol = {
                type: 'Feature',
                properties: {
                    id: symbolId,
                    source: 'military_symbol',
                    sidc: 'SFGPUCI-----',
                    layerId: 'default',
                },
                geometry: {
                    type: 'Point',
                    coordinates: [-43.2, -22.9],
                },
            };
            await applyStoreOp(A, 'addFeature', ['military_symbols', symbol]);
            await pollPeerFeature(B, 'military_symbols', symbolId);

            await applyStoreOp(A, 'updateFeatureProperty', ['military_symbols', symbolId, 'sidc', 'SHGPUCI-----']);
            await pollPeerFeatureWhere(B, 'military_symbols', symbolId, (p) => p.sidc === 'SHGPUCI-----');

            // 7a. ISOLATED delete (bisect a rapid-sequence race vs a real delete bug):
            //     a fresh point, confirmed on B, then deleted → B must lose it.
            const delId = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['points', { type: 'Feature', properties: { id: delId, source: 'point', layerId: 'default' }, geometry: { type: 'Point', coordinates: [-43.1, -22.8] } }]);
            await pollPeerFeature(B, 'points', delId);
            await applyStoreOp(A, 'removeFeature', ['points', delId]);
            await pollPeerFeatureGone(B, 'points', delId);

            // 7b. Delete the line edited earlier → B no longer has it.
            await applyStoreOp(A, 'removeFeature', ['lines', lineId]);
            await pollPeerFeatureGone(B, 'lines', lineId);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

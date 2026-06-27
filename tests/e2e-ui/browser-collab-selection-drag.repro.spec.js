// Path: e2e-ui/browser-collab-selection-drag.repro.spec.js

/**
 * Regression (two real browsers + real backend): a peer's remote SELECTION box must FOLLOW the
 * feature when the owner moves it. Bug: B rendered A's selection box correctly, but when A dragged
 * the feature the box stayed at the old position. Two causes, both fixed:
 *   1) the box only re-rendered on selection changes, never when the SELECTED feature's geometry
 *      changed — now it re-renders on LAYERS_CHANGED (emitted once the moved geometry lands in B's
 *      source via the remote-feature-render refresh);
 *   2) createSelectionBox reused the feature's STORED (pre-drag) `selectionBox` — the box overlay now
 *      recomputes from the live geometry, so a moved point gets a fresh box.
 *
 * A draws a point (the tool auto-selects it → A's selection broadcasts), then MOVES it via the store
 * (the drag-commit path: new geometry, stale stored box). B's remote-selection-boxes source centroid
 * must travel from the old position to the new one.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, drawPointUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Average longitude of all coords in B's remote-selection-boxes source (≈ the box centroid lng). */
function boxCentroidLng(page) {
    return page.evaluate(async () => {
        const map = globalThis.__ebgeoMap;
        const s = map && map.getSource('remote-selection-boxes');
        if (!s || typeof s.getData !== 'function') return null;
        const d = await s.getData();
        const feats = (d && d.features) || [];
        if (!feats.length) return null;
        let sum = 0;
        let n = 0;
        const walk = (c) => {
            if (typeof c[0] === 'number') { sum += c[0]; n += 1; } else { c.forEach(walk); }
        };
        for (const f of feats) if (f.geometry) walk(f.geometry.coordinates);
        return n ? sum / n : null;
    });
}

describeOrSkip('Remote selection box follows the feature when a peer drags it', () => {
    test("B's remote box tracks A's selected point after A moves it", async ({ browser }) => {
        const P1 = [-43.20, -22.90];
        const P2 = [-43.05, -22.90]; // +0.15° lng — a clear, unambiguous move

        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // A draws a point — the point tool auto-selects it, so A's selection broadcasts to B.
            const pointId = await drawPointUI(A, P1);
            expect(pointId, 'the point tool created a feature').toBeTruthy();

            // B renders A's remote selection box at the ORIGINAL position (~P1).
            await expect.poll(() => boxCentroidLng(B), { timeout: 20000 }).not.toBeNull();
            expect(await boxCentroidLng(B), 'box starts near P1').toBeLessThan(-43.15);

            // A MOVES the point (geometry changes, selection set unchanged) — the drag-commit path.
            await A.evaluate(async ({ id, to }) => {
                const store = await import('/src/js/store/index.js');
                const f = await store.getFeatureById('points', id);
                f.geometry = { type: 'Point', coordinates: to };
                await store.updateFeature('points', f);
            }, { id: pointId, to: P2 });

            // B's remote box must FOLLOW to the new position (~P2). Before the fix it stayed at ~P1.
            await expect.poll(() => boxCentroidLng(B), { timeout: 20000 }).toBeGreaterThan(-43.12);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

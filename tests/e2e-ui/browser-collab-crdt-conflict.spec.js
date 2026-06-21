// Path: e2e-ui/browser-collab-crdt-conflict.spec.js

/**
 * CRDT CONFLICT / CONVERGENCE — TWO real browsers + real backend. The core CRDT
 * guarantee the suite never exercised end-to-end: when two clients edit the SAME entity
 * "at the same time", conflict resolves by LWW-by-ARRIVAL (NOT timestamp; per
 * CLAUDE.md), and BOTH clients must CONVERGE to one agreed value — no permanent
 * divergence. We assert convergence (the clients AGREE), not which side wins (that's
 * arrival-order dependent and non-deterministic).
 *
 * Covered:
 *   1. concurrent recolor of the same line        → A and B converge to ONE color.
 *   2. concurrent move (geometry) of the same line → A and B converge to ONE geometry.
 *   3. concurrent UPDATE on A vs DELETE on B       → A and B converge (same presence).
 *
 * Run headed:  npx playwright test browser-collab-crdt-conflict --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, readFeatures, pollPeerFeature } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Drives a store op on `page` through the app's REAL store facade. */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const lineProp = async (page, id, prop) => {
    const f = (await readFeatures(page, 'lines')).find((x) => x.id === id);
    return f?.props?.[prop];
};

const lineGeomKey = (page, id) => page.evaluate(async (i) => {
    const store = await import('/src/js/store/index.js');
    const f = (await store.getCurrentMapFeatures()).lines.find((x) => x.properties?.id === i);
    return f ? JSON.stringify(f.geometry?.coordinates) : null;
}, id);

const hasLine = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);

const newLine = (id) => ({
    type: 'Feature',
    properties: { id, source: 'line', layerId: 'default', lineColor: '#000000', lineWidth: 4 },
    geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
});

describeOrSkip('CRDT conflict — concurrent edits converge (LWW by arrival)', () => {
    test('concurrent recolor of the SAME line → both clients converge to one color', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            const id = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['lines', newLine(id)]);
            await pollPeerFeature(B, 'lines', id);

            // Both recolor the same line "simultaneously" — fire without awaiting cross-sync.
            await Promise.all([
                applyStoreOp(A, 'updateFeatureProperty', ['lines', id, 'lineColor', '#ff0000']),
                applyStoreOp(B, 'updateFeatureProperty', ['lines', id, 'lineColor', '#0000ff']),
            ]);

            // Convergence: A and B must end on the SAME color, and it must be one of the two.
            await expect
                .poll(async () => {
                    const ca = await lineProp(A, id, 'lineColor');
                    const cb = await lineProp(B, id, 'lineColor');
                    return ca && cb && ca === cb ? ca : null;
                }, { timeout: 25000 })
                .toMatch(/^#(ff0000|0000ff)$/);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('concurrent geometry move of the SAME line → both clients converge to one geometry', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            const id = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['lines', newLine(id)]);
            await pollPeerFeature(B, 'lines', id);

            const geomA = { type: 'LineString', coordinates: [[-43.0, -22.7], [-42.9, -22.6]] };
            const geomB = { type: 'LineString', coordinates: [[-44.0, -23.7], [-43.9, -23.6]] };
            await Promise.all([
                applyStoreOp(A, 'updateFeature', ['lines', { ...newLine(id), geometry: geomA }]),
                applyStoreOp(B, 'updateFeature', ['lines', { ...newLine(id), geometry: geomB }]),
            ]);

            const ka = JSON.stringify(geomA.coordinates);
            const kb = JSON.stringify(geomB.coordinates);
            await expect
                .poll(async () => {
                    const a = await lineGeomKey(A, id);
                    const b = await lineGeomKey(B, id);
                    return a && b && a === b ? a : null;
                }, { timeout: 25000 })
                .toMatch(new RegExp(`^(${ka.replace(/[[\]]/g, '\\$&')}|${kb.replace(/[[\]]/g, '\\$&')})$`));
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('concurrent UPDATE (A) vs DELETE (B) of the SAME line → both clients converge', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            const id = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['lines', newLine(id)]);
            await pollPeerFeature(B, 'lines', id);

            await Promise.all([
                applyStoreOp(A, 'updateFeatureProperty', ['lines', id, 'lineColor', '#ff0000']),
                applyStoreOp(B, 'removeFeature', ['lines', id]),
            ]);

            // Convergence: A and B must agree on the feature's PRESENCE (both gone, or both
            // present) — never one client showing it and the other not.
            await expect
                .poll(async () => {
                    const a = await hasLine(A, id);
                    const b = await hasLine(B, id);
                    return a === b ? `agree:${a}` : null;
                }, { timeout: 25000 })
                .toMatch(/^agree:(true|false)$/);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

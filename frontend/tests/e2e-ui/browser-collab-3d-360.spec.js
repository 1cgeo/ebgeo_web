// Path: e2e-ui/browser-collab-3d-360.spec.js

/**
 * 3D / 360 CONVERGENCE across TWO real browsers + real backend. The existing 3D/360 e2e specs are
 * single-client transport round-trips (push → pullSync); none proves that a SECOND connected peer
 * ends up with the entity in its OWN local side-store after a live op. That is the whole point of
 * "do they actually sync" — so here A creates a 3D / 360 entity through the app's REAL store op
 * (the path that logs the sync op + auto-flushes), and B (a separate browser, real WebSocket) must
 * converge: the entity lands in B's local cesium3d / streetview360 side-store (the ground truth the
 * remote-operation-handler persists into).
 *
 * 3D entity creation has no single-gesture 2D-map UI (it is viewer-only inside Cesium, which
 * self-skips headless), so the create runs the real store op via page.evaluate — setup, per the
 * suite's UI-first carve-out. The assertion reads the real persisted side-store.
 *
 * Run headed:  npx playwright test browser-collab-3d-360 --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Reads the current map's cesium3d markers from a peer's LOCAL side-store (the inbound-persist target). */
function peerHasCesium3dMarker(page, markerId) {
    return page.evaluate(async (id) => {
        const repo = await import('/src/js/store/repositories/index.js');
        const maps = await import('/src/js/store/map.operations.js');
        const data = await repo.getCesium3dCompat(maps.getCurrentMapNameSync());
        return (data?.markers || []).some((m) => m.id === id);
    }, markerId);
}

/** Reads the current map's streetview360 markers from a peer's LOCAL side-store. */
function peerHasStreetview360Marker(page, markerId) {
    return page.evaluate(async (id) => {
        const repo = await import('/src/js/store/repositories/index.js');
        const maps = await import('/src/js/store/map.operations.js');
        const data = await repo.getStreetview360Compat(maps.getCurrentMapNameSync());
        return (data?.markers || []).some((m) => m.id === id);
    }, markerId);
}

describeOrSkip('3D / 360 collaboration — a peer converges on remote entities', () => {
    test('a 3D marker created by A appears in peer B', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            const markerId = await A.evaluate(async () => {
                const c3d = await import('/src/js/store/cesium3d.operations.js');
                const m = await c3d.addMarker('tileset-peer-3d', {
                    position: { longitude: -43.2, latitude: -22.9, height: 50 },
                    properties: { nome: 'Marcador 3D colaborativo' },
                });
                return m.id;
            });
            expect(markerId).toBeTruthy();

            // B (a real second browser) must end up with the marker in its local cesium3d store.
            await expect.poll(() => peerHasCesium3dMarker(B, markerId), { timeout: 20000 }).toBe(true);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('a 360 marker created by A appears in peer B', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            const markerId = await A.evaluate(async () => {
                const sv = await import('/src/js/store/streetview360.operations.js');
                const m = await sv.addMarker360('foto-peer.jpg', {
                    position: { heading: 45, pitch: 0, distance: 5 },
                    properties: { nome: 'Marcador 360 colaborativo' },
                });
                return m.id;
            });
            expect(markerId).toBeTruthy();

            await expect.poll(() => peerHasStreetview360Marker(B, markerId), { timeout: 20000 }).toBe(true);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

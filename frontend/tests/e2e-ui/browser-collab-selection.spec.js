// Path: e2e-ui/browser-collab-selection.spec.js

/**
 * FEATURE-SELECTION convergence across TWO real browsers + real backend, on all three
 * surfaces (2D map, 3D, 360). Selection is EPHEMERAL presence (like cursors): it travels
 * over the WS `selection` frame, is never persisted, and lands in each peer's presenceStore.
 * The unit tests pin the store shape + getSelections; the backend ws tests pin the relay +
 * the editor-gate. Neither proves the actual point — "sync the selection BETWEEN users" — so
 * here a SECOND connected peer's presenceStore must converge after A selects, live over a
 * real WebSocket, on each surface.
 *
 * A drives selection through the REAL outbound bridge path:
 *   - 2D  : getStateManager().selectFeature(...) → the 'selection.features' subscription.
 *   - 3D  : emit MARKER_3D_CLICKED  → the bridge's 3D subscription (no Cesium needed; the
 *           viewer self-skips headless, but the bridge only needs the event).
 *   - 360 : emit MARKER_360_CLICKED → the bridge's 360 subscription.
 * B (a separate browser) must converge: presenceStore.getSelections(surface, scope) carries
 * A's selection — scoped by mapId (2D) / tilesetId (3D) / photoName (360).
 *
 * Run headed:  npx playwright test browser-collab-selection --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Reads a peer's synced selections for a surface (+ optional scope key) from its presenceStore. */
function peerSelections(page, surface, scopeKey) {
    return page.evaluate(async ({ s, k }) => {
        const { presenceStore } = await import('/src/js/presence/presence-store.js');
        return presenceStore.getSelections(s, k ?? undefined);
    }, { s: surface, k: scopeKey ?? null });
}

/** True once any peer in `page`'s store has `featureId` selected on `surface` (+ scope). */
async function peerHasSelection(page, surface, featureId, scopeKey) {
    const sels = await peerSelections(page, surface, scopeKey);
    return sels.some((sel) => sel.featureIds.includes(featureId));
}

describeOrSkip('Feature selection — a peer converges on a remote selection (2D / 3D / 360)', () => {
    test('A selecting on each surface propagates to peer B', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // ── 2D: select a feature through the real StateManager (the exact path the
            // selection tools drive). The bridge mirrors it to peers as a '2d' frame.
            await A.evaluate(async () => {
                const { getStateManager } = await import('/src/js/store/services.js');
                getStateManager().selectFeature('point', 'sel-2d-1', {
                    type: 'Feature',
                    properties: { id: 'sel-2d-1' },
                    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                });
            });
            await expect
                .poll(() => peerHasSelection(B, '2d', 'sel-2d-1'), { timeout: 20000 })
                .toBe(true);

            // ── 3D: a marker click inside the Cesium viewer emits MARKER_3D_CLICKED; the
            // bridge forwards it scoped by tilesetId. B converges on the same tileset scope.
            await A.evaluate(async () => {
                const { getEventBus } = await import('/src/js/store/services.js');
                const { EventTypes } = await import('/src/js/events/event_types.js');
                getEventBus().emit(EventTypes.MARKER_3D_CLICKED, {
                    marker: { id: 'sel-3d-1' },
                    tilesetId: 'tileset-colab',
                });
            });
            await expect
                .poll(() => peerHasSelection(B, '3d', 'sel-3d-1', 'tileset-colab'), { timeout: 20000 })
                .toBe(true);
            // Wrong scope must NOT match (the highlight is panorama/tileset-scoped).
            expect(await peerHasSelection(B, '3d', 'sel-3d-1', 'tileset-OUTRO')).toBe(false);

            // ── 360: a POI click emits MARKER_360_CLICKED; the bridge forwards it scoped by
            // photoName.
            await A.evaluate(async () => {
                const { getEventBus } = await import('/src/js/store/services.js');
                const { EventTypes } = await import('/src/js/events/event_types.js');
                getEventBus().emit(EventTypes.MARKER_360_CLICKED, {
                    marker: { id: 'sel-360-1' },
                    photoName: 'foto-colab.jpg',
                });
            });
            await expect
                .poll(() => peerHasSelection(B, '360', 'sel-360-1', 'foto-colab.jpg'), { timeout: 20000 })
                .toBe(true);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

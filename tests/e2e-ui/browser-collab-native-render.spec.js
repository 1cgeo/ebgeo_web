// Path: e2e-ui/browser-collab-native-render.spec.js

/**
 * NATIVE remote-render assertion — TWO real browsers, real backend, on the full-chain
 * harness. Proves the app actually RENDERS the peer's feature (not just that the op
 * reached the store): the feature lands in B's map SOURCE and layers TREE exactly ONCE
 * (no author-echo duplicate), on top of the full sync-chain proof (expectFullSync).
 *
 * Run headed:  npx playwright test browser-collab-native-render --headed
 */

import { collabTest, expect, drawLineUI } from './helpers/collab.fixtures.js';

const CENTER = { lng: -43.2, lat: -22.9 };

/** Opens the layers tab (idempotent — never toggles it closed). */
async function openLayersTab(page) {
    if ((await page.locator('.layer-container').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    }
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

/** Counts copies of `id` in the live map SOURCE and in the store's current-map bucket. */
function countFeature(page, { sourceName, storeType, id }) {
    return page.evaluate(async ({ sn, st, fid }) => {
        const s = await import('/src/js/store/index.js');
        const map = globalThis.__ebgeoMap;
        const src = map && map.getSource(sn);
        let inSource = 0;
        if (src && typeof src.getData === 'function') {
            const data = await src.getData();
            inSource = ((data && data.features) || []).filter((f) => f && f.properties && f.properties.id === fid).length;
        }
        const f = await s.getCurrentMapFeatures();
        const inStore = ((f && f[st]) || []).filter((x) => x && x.properties && x.properties.id === fid).length;
        return { inSource, inStore };
    }, { sn: sourceName, st: storeType, fid: id });
}

collabTest.describe('Peer feature renders NATIVELY on the receiver — map source + layers tree, no duplicate', () => {
    collabTest('A draws a line; B renders it in its source + tree exactly once (full chain + dedup)', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // A draws a line through the REAL line tool; assert the WHOLE chain carried it to B
        // (this already verifies B's render.source via link 6).
        const lineId = await drawLineUI(A, [
            [CENTER.lng - 0.02, CENTER.lat - 0.01],
            [CENTER.lng + 0.01, CENTER.lat + 0.005],
            [CENTER.lng + 0.03, CENTER.lat - 0.008],
        ]);
        expect(lineId, 'the line tool created a feature').toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });

        // Author A holds exactly one copy in its own source + store.
        expect(await countFeature(A, { sourceName: 'lines', storeType: 'lines', id: lineId })).toEqual({ inSource: 1, inStore: 1 });

        // B's layers TREE shows the peer's feature, exactly once.
        await openLayersTab(B);
        await expect(B.locator(`.feature-item[data-feature-id="${lineId}"]`)).toBeVisible({ timeout: 15000 });
        await expect(B.locator(`.feature-item[data-feature-id="${lineId}"]`)).toHaveCount(1);

        // NO duplicate — exactly ONE in B's source AND store, and it stays deduped after the
        // broadcast/author-echo has had time to (not) produce a second copy.
        expect(await countFeature(B, { sourceName: 'lines', storeType: 'lines', id: lineId })).toEqual({ inSource: 1, inStore: 1 });
        await B.waitForTimeout(3000);
        expect(await countFeature(B, { sourceName: 'lines', storeType: 'lines', id: lineId })).toEqual({ inSource: 1, inStore: 1 });
        await expect(B.locator(`.feature-item[data-feature-id="${lineId}"]`)).toHaveCount(1);
    });
});

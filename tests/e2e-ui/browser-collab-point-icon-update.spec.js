// Path: e2e-ui/browser-collab-point-icon-update.spec.js

/**
 * REGRESSION — a peer's point ICON must update when the author changes the marker
 * symbol (or a baked-in color) of an EXISTING non-circle point. Two real browsers,
 * real backend.
 *
 * Bug: per-feature point-marker images are keyed by feature id, but their pixels
 * depend on markerSymbol + fill/line color + border. The remote-render path re-runs
 * setupMapFeatures()→setImages(), which used a bare `map.hasImage(id)` skip — so once
 * a peer had ANY image for that id, a later symbol/color change kept rendering the
 * STALE icon. Fixed by a content-signature guard (regenerate when the signature
 * changes). This proves the peer's registered image BYTES actually change.
 *
 * Run headed:  npx playwright test browser-collab-point-icon-update --headed
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';
import { pollPeerFeature, pollPeerFeatureWhere } from './helpers/collab-helpers.js';

const CENTER = { lng: -43.2, lat: -22.9 };

/**
 * Content fingerprint of the per-feature marker image registered on `page`'s map
 * for `id` (sampled bytes of the RGBA data). null when no image is registered.
 */
function peerImageSig(page, id) {
    return page.evaluate((fid) => {
        const map = globalThis.__ebgeoMap;
        if (!map || !map.hasImage(fid)) return null;
        const img = map.getImage(fid);
        const px = img && img.data && img.data.data;
        if (!px || !px.length) return null;
        let sum = 0;
        for (let i = 0; i < px.length; i += 257) sum = (sum + px[i]) >>> 0;
        return `${px.length}:${sum}`;
    }, id);
}

/** Authors a non-circle point via the real point control (registers image + enqueues create). */
function createMarkerPoint(page, lngLat, overrides) {
    return page.evaluate(async ({ c, ov }) => {
        const store = await import('/src/js/store/index.js');
        const ctrl = store.getControl('AddPointControl');
        globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 14 });
        const f = await ctrl.createPointAtCoordinates(c.lng, c.lat, ov);
        return f && f.properties && f.properties.id;
    }, { c: lngLat, ov: overrides });
}

/** Changes one marker property exactly as the panel does (updateFeaturesProperty → persist+enqueue). */
function changeMarkerProp(page, id, property, value) {
    return page.evaluate(async ({ fid, prop, val }) => {
        const store = await import('/src/js/store/index.js');
        const ctrl = store.getControl('AddPointControl');
        const f = await store.getFeatureById('points', fid);
        await ctrl.updateFeaturesProperty([f], prop, val); // updates source + author image (panel onChange)
        await store.updateFeature('points', f);            // persist + enqueue the sync op (panel save)
    }, { fid: id, prop: property, val: value });
}

collabTest.describe("Peer point icon updates when the author changes an existing point's marker", () => {
    collabTest('symbol change (triangle → star) re-renders the peer image, not the stale one', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // A creates a non-circle point (triangle, red). It syncs to B, which registers a
        // per-feature image keyed by the feature id.
        const id = await createMarkerPoint(A, CENTER, { markerSymbol: 'triangle', fillColor: '#ff0000', size: 40 });
        expect(id, 'the point control created a feature').toBeTruthy();
        await pollPeerFeature(B, 'points', id);

        let sigTriangle = null;
        await expect.poll(async () => (sigTriangle = await peerImageSig(B, id)), { timeout: 15000 }).toBeTruthy();

        // A changes the marker to a different non-circle symbol + color. The op reaches B,
        // whose store now reports the new symbol...
        await changeMarkerProp(A, id, 'markerSymbol', 'star');
        await changeMarkerProp(A, id, 'fillColor', '#00ff00');
        await pollPeerFeatureWhere(B, 'points', id, (p) => p.markerSymbol === 'star' && p.fillColor === '#00ff00');

        // ...and — the regression — B's REGISTERED IMAGE BYTES must change too. Pre-fix the
        // `hasImage(id)` skip kept the stale triangle image and this never changed.
        await expect
            .poll(() => peerImageSig(B, id), { timeout: 15000 })
            .not.toBe(sigTriangle);

        // Sanity: an image is still registered (the point didn't fall back to nothing).
        expect(await peerImageSig(B, id)).toBeTruthy();
    });
});

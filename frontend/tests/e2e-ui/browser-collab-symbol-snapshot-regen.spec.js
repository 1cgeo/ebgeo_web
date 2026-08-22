// Path: e2e-ui/browser-collab-symbol-snapshot-regen.spec.js

/**
 * REGRESSION — a client-generated symbol raster (military symbol) must survive being
 * loaded via a SNAPSHOT (opening / reconnecting to a remote atlas), not just via a
 * live incremental op. Two real browsers, real backend.
 *
 * Bug: military symbols / coordination measures / magnetic declinations render a PNG
 * generated on the client (milsymbol / canvas) and stored ONLY in the local image
 * cache — it is never uploaded (it's deterministically rebuildable from props). The
 * peer-side regeneration was wired to REMOTE_OPERATION_APPLIED (live ops) only, so the
 * SNAPSHOT path (connect / reconnect / map switch) left the blob missing → the loader
 * fetched it from the backend → 404 → error icon. Fixed by regenerating from props in
 * the load path (setImages) when no local blob exists.
 *
 * Decisive signal: regeneration STORES a local blob; the 404→error-icon path does NOT.
 * So after a fresh snapshot open, the reopened peer must hold a LOCAL blob for the
 * symbol id (and a real map image), which pre-fix it never did.
 *
 * Run headed:  npx playwright test browser-collab-symbol-snapshot-regen --headed
 */

import { collabTest, expect, drawMilitarySymbolUI } from './helpers/collab.fixtures.js';
import { pollPeerFeature } from './helpers/collab-helpers.js';

const CENTER = { lng: -43.2, lat: -22.9 };

/** Local-blob + map-image state for a symbol id on `page` (the regen-vs-404 signal). */
function symbolImageState(page, id) {
    return page.evaluate(async (fid) => {
        const store = await import('/src/js/store/index.js');
        const map = globalThis.__ebgeoMap;
        return {
            hasLocalBlob: await store.hasImage(fid), // local image cache ONLY (regen stores here; the 404 path does not)
            hasMapImage: !!(map && map.hasImage(fid)),
        };
    }, id);
}

collabTest.describe('Client-generated symbol raster survives a snapshot (open/reconnect)', () => {
    collabTest('reopened peer rebuilds the military symbol from props instead of 404→error icon', async ({ collab }) => {
        const A = collab.author;

        // A places a military symbol (real tool, default SIDC). It syncs to the peer.
        const id = await drawMilitarySymbolUI(A, [CENTER.lng, CENTER.lat]);
        expect(id, 'the military symbol tool created a feature').toBeTruthy();
        // Full chain (skipRender: military symbols render through an icon/image layer, not a
        // GeoJSON source, so link 6 leans on remote.applied + IndexedDB). This matters here
        // beyond the usual rigour: the snapshot the reopened peer loads below is built from
        // what the BACKEND stored, so proving the op actually reached Postgres is the premise
        // of the whole test — a peer that only got the live op would still snapshot nothing.
        await collab.expectFullSync({
            entityId: id, type: 'military_symbols', operationType: 'create', skipRender: true,
        });

        // Reopen the peer FRESH: a disconnect + rejoin loads the whole atlas via a SNAPSHOT —
        // exactly the path that skipped symbol-raster regeneration.
        const B2 = await collab.reopenPeer(0);
        // Deliberately NOT expectFullSync: the fresh peer receives this feature through the
        // snapshot on connect, not as an operation, so it emits no per-op ws.inbound /
        // apply.persist / remote.applied spans for it — the full chain has no op to walk.
        // Arrival via snapshot is exactly what this test needs to wait for, so the store poll
        // stays.
        //
        // `viaSnapshot` diz isso ao helper, que por padrão espera o span `remote.applied`
        // ANTES de olhar a store. Sem a marca ele esperava 20 s por um sinal que este caminho
        // não emite, e o teste passava sozinho e estourava o orçamento sob carga da suíte.
        await pollPeerFeature(B2, 'military_symbols', id, { viaSnapshot: true });

        // The regression: the snapshot peer must REBUILD the raster from props — a local blob
        // is (re)stored and a real image installed. Pre-fix the blob fetch 404'd, so no local
        // blob was ever stored (hasLocalBlob stayed false) and the map showed the error icon.
        await expect
            .poll(() => symbolImageState(B2, id), { timeout: 15000 })
            .toMatchObject({ hasLocalBlob: true, hasMapImage: true });
    });
});

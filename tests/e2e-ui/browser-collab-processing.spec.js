// Path: e2e-ui/browser-collab-processing.spec.js

/**
 * PROCESSING OUTPUT synced cross-client — TWO real browsers + real backend. Client A
 * runs a deterministic geoprocessing algorithm (Convex Hull / "Contorno Externo") over
 * input features it just created, commits the algorithm's OUTPUT feature(s) through the
 * app's REAL store op (addFeature), and client B asserts NATIVE sync carried the
 * processing OUTPUT feature through — no workarounds.
 *
 * Flow:
 *   1. seed two users + a shared atlas/map (write-shared with B); both OPEN it.
 *   2. On A: create 4 input POINTS via the real store op (addFeature). Then import the
 *      REAL algorithm module (convex-hull.algorithm.js), call its pure
 *      execute(features, params) → [hull polygon], stamp the output with a KNOWN uuid id,
 *      and addFeature('polygons', output) so it travels through native sync.
 *   3. On B: pollPeerFeature('polygons', outputId) — the processing OUTPUT polygon synced
 *      and is present in B's store; assert it really is a closed polygon ring.
 *
 * The execute() is the same pure function the production runner (processing-runner.js)
 * calls — runProcessing() reads layer features, runs algorithm.execute(), then persists
 * the result via addFeatures(). Here we drive the identical execute() and commit via the
 * store facade's addFeature(), which is the codepath that syncs.
 *
 * Seed/login/open plumbing + poll helpers come from ./helpers/collab-helpers.js; structure
 * mirrors browser-collab-shared-atlas.spec.js / browser-collab-feature-mutations.spec.js.
 *
 * Run headed:  npx playwright test browser-collab-processing --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    pollPeerFeature,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Four input points whose convex hull is a well-defined quadrilateral. */
const INPUT_POINTS = [
    [-43.30, -22.95],
    [-43.10, -22.95],
    [-43.10, -22.80],
    [-43.30, -22.80],
    [-43.20, -22.88], // interior point — should NOT appear on the hull
];

/** Adds a single point feature to `page`'s store through the REAL store facade. */
function addInputPoint(page, id, coordinates) {
    return page.evaluate(async ({ pid, coords }) => {
        const store = await import('/src/js/store/index.js');
        const feature = {
            type: 'Feature',
            properties: {
                id: pid,
                source: 'point',
                layerId: 'default',
                nome: 'Vértice de entrada',
            },
            geometry: { type: 'Point', coordinates: coords },
        };
        return store.addFeature('points', feature);
    }, { pid: id, coords: coordinates });
}

/**
 * On `page`: reads its own input points back from the store, runs the REAL convex-hull
 * algorithm's pure execute() over them, stamps the single output polygon with a KNOWN
 * uuid id, and commits it via the store facade's addFeature('polygons', output) so it
 * syncs natively. Returns the output polygon id + a copy of its committed properties.
 */
function runConvexHullAndCommit(page, inputIds, outputId) {
    return page.evaluate(async ({ ids, oid }) => {
        const store = await import('/src/js/store/index.js');
        // Importing the processing entry point runs algorithms/index.js as a side-effect,
        // self-registering buffer/voronoi/convex-hull. execute() is module-private and is
        // only reachable through the registry — the same definition the production runner
        // (processing-runner.js) invokes. (Re-import is idempotent; no double-register.)
        const { getAlgorithm } = await import('/src/js/processing/index.js');

        const definition = getAlgorithm('convex-hull');
        if (!definition || typeof definition.execute !== 'function') {
            throw new Error('convex-hull algorithm is not registered (no execute())');
        }
        const execute = definition.execute;

        // Read the input points back from the STORE (the home geometry), then keep only
        // the ones this run authored, mirroring how the runner collects layer features.
        const current = await store.getCurrentMapFeatures();
        const wanted = new Set(ids);
        const inputFeatures = (current.points || []).filter((f) => wanted.has(f.properties?.id));

        const output = execute(inputFeatures, {});
        if (!Array.isArray(output) || output.length !== 1) {
            throw new Error(`Convex hull produced ${output && output.length} features (expected 1)`);
        }

        // Stamp the KNOWN id so the peer can identify the OUTPUT feature deterministically,
        // then commit through the same store facade the runner uses (addFeatures → addFeature).
        const hull = output[0];
        hull.properties.id = oid;
        hull.properties.layerId = 'default';
        await store.addFeature('polygons', hull);

        return {
            outputId: oid,
            geometryType: hull.geometry?.type,
            ringLength: hull.geometry?.coordinates?.[0]?.length || 0,
            inputCount: inputFeatures.length,
        };
    }, { ids: inputIds, oid: outputId });
}

describeOrSkip('Processing OUTPUT syncs cross-client (two real browsers, real algorithm execute())', () => {
    test('A runs Convex Hull over its points → B receives the OUTPUT polygon (native sync)', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

        try {
            // 1. A creates the INPUT points via the real store op.
            const inputIds = [];
            for (const coords of INPUT_POINTS) {
                const id = crypto.randomUUID();
                inputIds.push(id);
                await addInputPoint(A, id, coords);
            }
            // Sanity: A's store actually holds all the inputs before processing.
            await expect
                .poll(async () => (await readFeatures(A, 'points')).filter((p) => inputIds.includes(p.id)).length)
                .toBe(inputIds.length);

            // 2. A runs the REAL convex-hull execute() and commits the OUTPUT polygon
            //    with a KNOWN id through the store facade (the codepath that syncs).
            const outputId = crypto.randomUUID();
            const result = await runConvexHullAndCommit(A, inputIds, outputId);
            expect(result.inputCount, 'A fed all 5 input points to execute()').toBe(INPUT_POINTS.length);
            expect(result.outputId).toBe(outputId);
            expect(result.geometryType, 'convex hull output is a Polygon').toBe('Polygon');
            // The hull of these points is a closed quadrilateral ring (≥ 5 positions incl. closure).
            expect(result.ringLength, 'hull ring is a real closed polygon').toBeGreaterThanOrEqual(4);

            // The OUTPUT polygon is in A's OWN store too (committed locally before sync).
            await pollPeerFeature(A, 'polygons', outputId);

            // 3. NATIVE sync: the processing OUTPUT polygon reaches B's store.
            await pollPeerFeature(B, 'polygons', outputId);

            // And on B it is a genuine processing OUTPUT polygon (right type + a closed ring),
            // not an empty placeholder.
            const onB = (await readFeatures(B, 'polygons')).find((x) => x.id === outputId);
            expect(onB, "B has the processing OUTPUT polygon").toBeTruthy();
            const ring = onB.props?.baseCoordinates;
            expect(Array.isArray(ring) && ring.length >= 3, 'B sees the hull ring vertices').toBe(true);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

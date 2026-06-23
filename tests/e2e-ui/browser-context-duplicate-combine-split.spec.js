// Path: e2e-ui/browser-context-duplicate-combine-split.spec.js

/**
 * Selection context-menu actions (duplicate / combine / split / cut), modelled as
 * fan-outs of feature create / modify / delete operations.
 *
 * §14.9 DUPLICATE is driven UI-FIRST: two lines are drawn with the REAL line tool,
 * selected, and duplicated through the app's REAL ClipboardManager copy()/paste() — the
 * exact path the "Duplicar Seleção" menu item invokes (paste mints a fresh UUID per copy
 * and offsets the geometry). Assertions read the live app store (getCurrentMapFeatures).
 *
 * §14.10 COMBINE / §14.11 SPLIT / §14.12 CUT stay backend transport probes. They assert
 * the precise CRDT op fan-out + persisted geometry (a hand-crafted composite
 * MultiLineString; two halves sharing the cut vertex) and the `valid_feature_type` CHECK
 * rejection — server contracts the real interactive tools (arrow merge/split produce
 * app-managed isMerged/branches geometry; line-cut is an interactive canvas mode) neither
 * reproduce verbatim nor expose with a single deterministic UI gesture. See the no-UI
 * notes on those tests. The atlas/map for them is self-provisioned via the API.
 *
 * The atlas/map/share SETUP is API-only (sharing has no UI); for §14.9 login + open +
 * the draw/duplicate gestures are real UI.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, drawLineUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Selection context actions: duplicate / combine / split / cut (real Chromium + real backend)', () => {
    test('§14.9 duplicate selection clones every feature under a fresh UUID, originals untouched', async ({
        browser,
    }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);

        try {
            // ---- draw two real lines (the "selection") through the line tool ----------
            const origA = await drawLineUI(page, [[-43.2, -22.9], [-43.1, -22.8]]);
            const origB = await drawLineUI(page, [[-42.7, -22.9], [-42.6, -22.8]]);
            expect(origA).toBeTruthy();
            expect(origB).toBeTruthy();

            // ---- §14.9 DUPLICATE: select both + run the real clipboard copy/paste ------
            // This is exactly what "Duplicar Seleção" does (ClipboardManager.copy →
            // paste); paste assigns each copy a fresh id, leaving the originals untouched.
            await page.evaluate(async ({ a, b }) => {
                const store = await import('/src/js/store/index.js');
                const { getControl } = store;
                const f = await store.getCurrentMapFeatures();
                const fa = (f.lines || []).find((x) => x.properties?.id === a);
                const fb = (f.lines || []).find((x) => x.properties?.id === b);
                // Build the multi-feature selection the canvas multi-select produces, then
                // invoke the SAME ClipboardManager the duplicate menu item calls.
                const sm = store.getStateManager();
                sm.batchUpdate(() => {
                    sm.clearSelection();
                    sm.addToSelection('lines', String(a), fa);
                    sm.addToSelection('lines', String(b), fb);
                });
                const clipboard = getControl('ClipboardManager');
                clipboard.copy();
                await clipboard.paste();
            }, { a: origA, b: origB });

            // Read the resulting line set from the live store: 2 originals + 2 fresh copies.
            // paste() persists via async store transactions, so poll until both copies land.
            const readLineIds = () => page.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                const f = await store.getCurrentMapFeatures();
                return (f.lines || []).map((x) => x.properties?.id);
            });
            await expect.poll(async () => (await readLineIds()).length, { timeout: 10000 }).toBe(4);

            const lineIds = await readLineIds();
            const copies = lineIds.filter((id) => id !== origA && id !== origB);
            const result = {
                origAPresent: lineIds.includes(origA),
                origBPresent: lineIds.includes(origB),
                copyCount: copies.length,
                // copies carry brand-new ids, disjoint from the originals.
                idsDisjoint: copies.every((id) => id !== origA && id !== origB),
                // membership doubled: 2 originals + 2 copies, all distinct.
                distinctCount: new Set(lineIds).size,
            };

            expect(result.origAPresent).toBe(true);
            expect(result.origBPresent).toBe(true);
            // two copies were created (paste duplicated both selected lines).
            expect(result.copyCount).toBe(2);
            expect(result.idsDisjoint).toBe(true);
            expect(result.distinctCount).toBe(4);
        } finally {
            await page.context().close();
        }
    });

    test('§14.10 combine arrows modifies one survivor + deletes the rest; §14.11 split reverses it', async ({
        page,
    }) => {
        // no-UI: this asserts the exact CRDT op fan-out + the persisted composite
        // MultiLineString geometry of a combine/split. The real arrow merge/split tool
        // produces app-managed isMerged/branches geometry (not a hand-crafted
        // MultiLineString) and split is an interactive selection flow, so the precise
        // backend op-shape contract is exercised as a transport probe via page.evaluate.
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `cmb_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Combine User' });
            await api.login(username, 'Sup3r-Secret-Pw!');

            const atlas = await api.createAtlas({ name: 'Combine Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            const arrow = (id, coords, extraProps = {}) => ({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: { id, source: 'arrow', ...extraProps },
            });
            const pullMap = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                return pulled.snapshot?.maps?.find((m) => m.id === mapId);
            };
            const arrowsById = (map) => {
                const out = new Map();
                for (const f of map?.features?.arrows || []) out.set(f.properties.id, f);
                return out;
            };

            // ---- seed three individual arrows (the selection) ------------
            const a1 = crypto.randomUUID();
            const a2 = crypto.randomUUID();
            const a3 = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', a1, mapId, arrow(a1, [[-43.2, -22.9], [-43.1, -22.9]], { nome: 'A1' })),
                createOperation('feature', 'create', a2, mapId, arrow(a2, [[-43.1, -22.9], [-43.0, -22.9]], { nome: 'A2' })),
                createOperation('feature', 'create', a3, mapId, arrow(a3, [[-43.0, -22.9], [-42.9, -22.9]], { nome: 'A3' })),
            ]);
            const seeded = arrowsById(await pullMap());

            // ---- §14.10 combine: MODIFY a1 into a composite multi-geometry,
            // DELETE a2 + a3. The composite keeps a1's id but spans every leg.
            const compositeGeom = {
                type: 'MultiLineString',
                coordinates: [
                    [[-43.2, -22.9], [-43.1, -22.9]],
                    [[-43.1, -22.9], [-43.0, -22.9]],
                    [[-43.0, -22.9], [-42.9, -22.9]],
                ],
            };
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', a1, mapId, arrow(a1, compositeGeom.coordinates, { nome: 'Composite', composite: true })),
                createOperation('feature', 'delete', a2, mapId, null),
                createOperation('feature', 'delete', a3, mapId, null),
            ]);

            // NOTE: arrow geometry persisted as JSONB; rewrite a1 with the real
            // MultiLineString geometry so the snapshot reflects the merged legs.
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', a1, mapId, {
                    type: 'Feature',
                    geometry: compositeGeom,
                    properties: { id: a1, source: 'arrow', nome: 'Composite', composite: true },
                }),
            ]);

            const combinedMap = arrowsById(await pullMap());
            const composite = combinedMap.get(a1);

            const combined = {
                survivorPresent: combinedMap.has(a1),
                a2Gone: !combinedMap.has(a2),
                a3Gone: !combinedMap.has(a3),
                onlySurvivor: combinedMap.size === 1,
                isComposite: composite?.properties?.composite === true,
                multiGeometry: composite?.geometry?.type === 'MultiLineString',
                legCount: composite?.geometry?.coordinates?.length,
            };

            // ---- §14.11 split: CREATE individuals s1/s2/s3 + DELETE composite
            const s1 = crypto.randomUUID();
            const s2 = crypto.randomUUID();
            const s3 = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', s1, mapId, arrow(s1, [[-43.2, -22.9], [-43.1, -22.9]], { nome: 'S1' })),
                createOperation('feature', 'create', s2, mapId, arrow(s2, [[-43.1, -22.9], [-43.0, -22.9]], { nome: 'S2' })),
                createOperation('feature', 'create', s3, mapId, arrow(s3, [[-43.0, -22.9], [-42.9, -22.9]], { nome: 'S3' })),
                createOperation('feature', 'delete', a1, mapId, null),
            ]);

            const splitMap = arrowsById(await pullMap());
            const split = {
                compositeGone: !splitMap.has(a1),
                s1Present: splitMap.has(s1),
                s2Present: splitMap.has(s2),
                s3Present: splitMap.has(s3),
                count: splitMap.size,
                allLineStrings: [s1, s2, s3].every(
                    (id) => splitMap.get(id)?.geometry?.type === 'LineString',
                ),
            };

            return { seededCount: seeded.size, combined, split };
        }, state.baseUrl);

        // seed sanity
        expect(result.seededCount).toBe(3);

        // §14.10 combine assertions
        expect(result.combined.survivorPresent).toBe(true);
        expect(result.combined.a2Gone).toBe(true);
        expect(result.combined.a3Gone).toBe(true);
        expect(result.combined.onlySurvivor).toBe(true);
        expect(result.combined.isComposite).toBe(true);
        expect(result.combined.multiGeometry).toBe(true);
        expect(result.combined.legCount).toBe(3);

        // §14.11 split assertions
        expect(result.split.compositeGone).toBe(true);
        expect(result.split.s1Present).toBe(true);
        expect(result.split.s2Present).toBe(true);
        expect(result.split.s3Present).toBe(true);
        expect(result.split.count).toBe(3);
        expect(result.split.allLineStrings).toBe(true);
    });

    test('§14.12 cut line creates two halves + deletes the original; edge: bad source rejected at write', async ({
        page,
    }) => {
        // no-UI: line-cut is an interactive canvas mode (activateSplitMode → click the cut
        // point) whose hit-testing is unreliable headless, and the edge asserts the
        // backend-only `valid_feature_type` CHECK rejecting a bogus source AT WRITE (no UI
        // can even produce an invalid source). Both are server contracts, so the op
        // fan-out + the rejection are exercised as a transport probe via page.evaluate.
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `cut_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Cut User' });
            await api.login(username, 'Sup3r-Secret-Pw!');

            const atlas = await api.createAtlas({ name: 'Cut Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            const line = (id, coords, extraProps = {}) => ({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: { id, source: 'line', ...extraProps },
            });
            const pullMap = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                return pulled.snapshot?.maps?.find((m) => m.id === mapId);
            };
            const lineIds = (map) => (map?.features?.lines || []).map((f) => f.properties.id);

            // ---- seed the original line to be cut at the midpoint --------
            const original = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation(
                    'feature',
                    'create',
                    original,
                    mapId,
                    line(original, [[-43.2, -22.9], [-43.0, -22.9]], { nome: 'Original' }),
                ),
            ]);

            // ---- §14.12 cut: CREATE two halves split at the midpoint,
            // DELETE the original. Result: exactly the two halves, no original.
            const halfA = crypto.randomUUID();
            const halfB = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', halfA, mapId, line(halfA, [[-43.2, -22.9], [-43.1, -22.9]], { nome: 'Half A' })),
                createOperation('feature', 'create', halfB, mapId, line(halfB, [[-43.1, -22.9], [-43.0, -22.9]], { nome: 'Half B' })),
                createOperation('feature', 'delete', original, mapId, null),
            ]);

            const after = await pullMap();
            const ids = lineIds(after);
            const cut = {
                originalGone: !ids.includes(original),
                halfAPresent: ids.includes(halfA),
                halfBPresent: ids.includes(halfB),
                // the two halves share the cut vertex (continuity of the split).
                cutVertexShared:
                    (after.features.lines.find((f) => f.properties.id === halfA)?.geometry
                        ?.coordinates?.[1]?.[0]) ===
                    (after.features.lines.find((f) => f.properties.id === halfB)?.geometry
                        ?.coordinates?.[0]?.[0]),
            };

            // ---- EDGE: a copy with a bogus source is rejected by the
            // valid_feature_type CHECK; the atomic batch aborts and nothing lands.
            const badId = crypto.randomUUID();
            let badRejected = false;
            try {
                await api.pushOperations(atlas.id, [
                    createOperation('feature', 'create', badId, mapId, {
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.0, -22.9]] },
                        properties: { id: badId, source: 'not_a_real_type' },
                    }),
                ]);
            } catch {
                badRejected = true;
            }
            const afterBad = await pullMap();
            const badLanded = Object.values(afterBad.features || {})
                .filter(Array.isArray)
                .flat()
                .some((f) => f.properties?.id === badId);

            return { cut, edge: { badRejected, badLanded } };
        }, state.baseUrl);

        // §14.12 cut assertions
        expect(result.cut.originalGone).toBe(true);
        expect(result.cut.halfAPresent).toBe(true);
        expect(result.cut.halfBPresent).toBe(true);
        expect(result.cut.cutVertexShared).toBe(true);

        // edge assertions: hard reject, nothing persisted
        expect(result.edge.badRejected).toBe(true);
        expect(result.edge.badLanded).toBe(false);
    });
});

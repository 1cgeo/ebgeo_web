// Path: e2e-ui/browser-idempotency-lww.spec.js

/**
 * Browser-level idempotency + LWW (last-arrival-wins) test. Drives the REAL frontend
 * transport (api-client / operation-factory) imported live from the Vite dev server
 * inside real Chromium, against the REAL spawned backend. Single client; each test
 * mints its own user + atlas + map for full isolation.
 *
 * Proves two frozen sync contracts end to end, with REAL HTTP round-trips in the browser:
 *   1. Idempotency by op id — pushing the SAME operation object (same `op.id`) twice
 *      produces a SINGLE effect: the feature exists exactly once in the snapshot, and
 *      the second push is ack'd without re-applying (the recorded server version does
 *      not advance for the duplicate). A `create` for an existing entity is NOT a
 *      second feature.
 *   2. LWW by arrival order — two `update` ops (DIFFERENT op ids) targeting ONE feature
 *      merge into `properties`; the LATER-ARRIVING update wins in the persisted snapshot
 *      (ordering by arrival, NOT by wall-clock timestamp). The negative/edge assertion
 *      forces the SECOND push to carry an EARLIER wall-clock `timestamp` than the first,
 *      and asserts arrival order — not timestamp — decides the winner.
 *
 * No UI clicks: the transport is exercised purely via `page.evaluate`, so there are no
 * data-testid selectors. Backend feature shape is GeoJSON with the type in
 * `properties.source`; feature updates carry a partial payload in `op.data`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Idempotency + LWW (real Chromium + real backend)', () => {
    test('pushing the same op id twice yields a single feature (no duplicate effect)', async ({ page }) => {
        const user = await createVerifiedUser({ prefix: 'idem', nome: 'Idempotency User' });
        await page.goto('/');

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'Idempotency Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            const featureId = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: featureId, source: 'point', nome: 'Dup Point' },
            };
            // Build the op ONCE so both pushes share the SAME op.id (the idempotency key).
            const op = createOperation('feature', 'create', featureId, mapId, feature);

            const res1 = await api.pushOperations(atlas.id, [op]);
            // Re-push the IDENTICAL op object (same op.id) — must be a no-op effect-wise.
            const res2 = await api.pushOperations(atlas.id, [op]);

            const pulled = await api.pullSync(atlas.id, 0);
            const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
            const points = (map?.features?.points || []).filter((p) => p.properties.id === featureId);

            return {
                opId: op.id,
                isSnapshot: pulled.isSnapshot,
                matchCount: points.length,
                version1: res1.serverVersion,
                version2: res2.serverVersion,
            };
        }, { baseUrl: state.baseUrl, u: user });

        // The duplicate push must NOT create a second feature row.
        expect(result.isSnapshot).toBe(true);
        expect(result.matchCount).toBe(1);
        // Negative/edge: the second push (same op id) is ack'd against the recorded
        // version — it does NOT advance the server version, proving DO-NOTHING semantics.
        expect(result.version2).toBe(result.version1);
    });

    test('two updates to one feature: last ARRIVAL wins in the snapshot (not last timestamp)', async ({ page }) => {
        const user = await createVerifiedUser({ prefix: 'lww', nome: 'LWW User' });
        await page.goto('/');

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'LWW Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            const featureId = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { id: featureId, source: 'point', label: 'origin' },
            };
            await api.pushOperations(atlas.id, [createOperation('feature', 'create', featureId, mapId, feature)]);

            // First update ARRIVES first but carries a LATER wall-clock timestamp.
            const opFirst = createOperation('feature', 'update', featureId, mapId, {
                properties: { id: featureId, source: 'point', label: 'first-arrival' },
            });
            opFirst.timestamp = Date.now() + 1_000_000; // future: would win if LWW were by timestamp

            // Second update ARRIVES last but carries an EARLIER wall-clock timestamp.
            const opSecond = createOperation('feature', 'update', featureId, mapId, {
                properties: { id: featureId, source: 'point', label: 'second-arrival' },
            });
            opSecond.timestamp = Date.now() - 1_000_000; // past: would lose if LWW were by timestamp

            // Push as two SEPARATE transactions to guarantee a deterministic arrival order.
            await api.pushOperations(atlas.id, [opFirst]);
            await api.pushOperations(atlas.id, [opSecond]);

            const pulled = await api.pullSync(atlas.id, 0);
            const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
            const point = (map?.features?.points || []).find((p) => p.properties.id === featureId);

            return {
                isSnapshot: pulled.isSnapshot,
                label: point?.properties?.label ?? null,
                matchCount: (map?.features?.points || []).filter((p) => p.properties.id === featureId).length,
                firstTimestamp: opFirst.timestamp,
                secondTimestamp: opSecond.timestamp,
            };
        }, { baseUrl: state.baseUrl, u: user });

        // Sanity: still exactly one feature (updates merge, they don't duplicate).
        expect(result.isSnapshot).toBe(true);
        expect(result.matchCount).toBe(1);
        // The LATER-ARRIVING op wins, even though its wall-clock timestamp is EARLIER.
        expect(result.secondTimestamp).toBeLessThan(result.firstTimestamp);
        expect(result.label).toBe('second-arrival');
    });
});

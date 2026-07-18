// Path: tests/e2e/offline-then-flush.e2e.test.js

/**
 * @fileoverview E2E: offline-then-flush against the live backend.
 *
 * Simulates the offline-first path of `syncEngine`: with operation logging enabled
 * but NO live connection, feature operations pile up in the local operationQueue.
 * Once the engine connects and `flush()` drains the queue over HTTP, the operations
 * must land on the server and become visible in a fresh atlas snapshot.
 *
 * This file owns the `syncEngine` / `operationQueue` singletons for its duration, so
 * the e2e config runs every spec in a single non-parallel fork. It builds its OWN
 * user / atlas / map for isolation across the shared backend and drives the backend
 * exclusively through the public ApiClient + syncEngine + createOperation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBaseUrl, E2E_SKIP } from './helpers/harness.js';
import { syncEngine } from '../../src/js/store/sync/sync-engine.js';
import { apiClient } from '../../src/js/store/sync/api-client.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Collects every feature (any geometry collection) out of a snapshot's maps into a
 * flat array of GeoJSON features. Mirrors the backend's per-type snapshot layout.
 * @param {Object} snapshot
 * @param {string} mapId
 * @returns {Object[]}
 */
function snapshotFeatures(snapshot, mapId) {
    const map = (snapshot?.maps || []).find((m) => m.id === mapId);
    if (!map || !map.features) return [];
    return Object.values(map.features)
        .filter(Array.isArray)
        .flat();
}

/**
 * Builds a feature CREATE operation in the exact envelope the backend accepts:
 * raw GeoJSON in `data` whose type lives in `properties.source`.
 * @param {string} mapId
 * @param {[number, number]} coords
 * @returns {{ op: Object, featureId: string }}
 */
function makePointCreateOp(mapId, coords) {
    const featureId = generateUUID();
    const op = createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: { id: featureId, source: 'point', nome: 'offline-point' },
        feature_type: 'point',
    });
    return { op, featureId };
}

describe.skipIf(E2E_SKIP)('e2e offline-then-flush', () => {
    /** @type {string} */
    let atlasId;
    /** @type {string} */
    let mapId;
    /** @type {string[]} */
    let queuedFeatureIds;

    beforeAll(async () => {
        // Point the engine's singleton ApiClient at the live backend and authenticate.
        syncEngine.configure({ baseUrl: `${getBaseUrl()}/api/v1` });

        const username = `e2e_${generateUUID().replace(/-/g, '').slice(0, 16)}`;
        const password = 'Sup3r-Secret-Pw!';
        await syncEngine.register({ username, password, nome: 'Offline Flush User' });
        const user = await syncEngine.login({ username, password });
        expect(user).toBeTruthy();
        expect(user.id).toBeTruthy();

        // Own atlas + map (maps have no REST write route — push a CRDT create op).
        const atlas = await apiClient.createAtlas({ name: 'E2E Offline Flush Atlas' });
        atlasId = atlas.id;
        expect(atlasId).toBeTruthy();

        mapId = generateUUID();
        await apiClient.pushOperations(atlasId, [
            createOperation('map', 'create', mapId, null, { name: 'Mapa Offline' }),
        ]);
    });

    afterAll(async () => {
        syncEngine.disconnect();
        await operationQueue.clear();
    });

    it('queues feature ops offline, then flushes them onto the server', async () => {
        // Isolate the singleton queue so only this scenario's ops are present.
        await operationQueue.clear();
        expect(await operationQueue.count()).toBe(0);

        // ----- OFFLINE PHASE: enqueue WITHOUT any connection -----
        // Not connected yet: the engine documents `atlasId === null` when offline.
        expect(syncEngine.atlasId).toBeFalsy();

        const built = [
            makePointCreateOp(mapId, [-43.18, -22.91]),
            makePointCreateOp(mapId, [-43.19, -22.92]),
            makePointCreateOp(mapId, [-43.2, -22.93]),
        ];
        queuedFeatureIds = built.map((b) => b.featureId);
        await operationQueue.enqueueAll(built.map((b) => b.op));

        expect(await operationQueue.count()).toBe(3);

        // NEGATIVE/EDGE assertion: with nothing flushed yet, the server snapshot
        // must NOT contain any of the locally-queued features.
        const before = await apiClient.pullSync(atlasId, 0);
        expect(before.isSnapshot).toBe(true);
        const beforeIds = snapshotFeatures(before.snapshot, mapId).map((f) => f.properties.id);
        for (const id of queuedFeatureIds) {
            expect(beforeIds).not.toContain(id);
        }

        // ----- CONNECT + FLUSH -----
        // initialPull:false so connecting does not re-apply a snapshot locally; we
        // only need the engine bound to atlasId so flush() targets the right atlas.
        const connected = await syncEngine.connect(atlasId, { initialPull: false });
        expect(connected).toBeTruthy();
        expect(syncEngine.atlasId).toBe(atlasId);

        const result = await syncEngine.flush();
        expect(result.pushed).toBe(3);

        // Queue fully drained after a successful flush.
        expect(await operationQueue.count()).toBe(0);

        // ----- VERIFY: features observable in a fresh server snapshot -----
        const after = await apiClient.pullSync(atlasId, 0);
        expect(after.isSnapshot).toBe(true);
        const afterFeatures = snapshotFeatures(after.snapshot, mapId);
        const afterIds = afterFeatures.map((f) => f.properties.id);
        for (const id of queuedFeatureIds) {
            expect(afterIds).toContain(id);
        }

        // The server bumped its version past the snapshot taken before the flush.
        expect(after.currentVersion).toBeGreaterThan(before.currentVersion);

        // Round-trip integrity: a flushed feature keeps its geometry + properties.
        const sample = afterFeatures.find((f) => f.properties.id === queuedFeatureIds[0]);
        expect(sample).toBeTruthy();
        expect(sample.geometry.type).toBe('Point');
        expect(sample.geometry.coordinates).toEqual([-43.18, -22.91]);
        expect(sample.properties.nome).toBe('offline-point');
        expect(sample.properties.source).toBe('point');
    });

    it('is idempotent: a second flush with an empty queue pushes nothing', async () => {
        expect(await operationQueue.count()).toBe(0);
        const result = await syncEngine.flush();
        expect(result.pushed).toBe(0);
    });
});

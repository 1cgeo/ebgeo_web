// Path: tests/e2e/lamport-echo.e2e.test.js

/**
 * @fileoverview E2E: the backend echoes each operation's `lamportTimestamp` back on
 * an INCREMENTAL pull. We push two feature ops (each carrying an explicit Lamport
 * timestamp), then pull from `currentVersion - 1` and assert the response is
 * incremental (NOT a snapshot) and that the single returned op carries the exact
 * Lamport timestamp we sent — proving the logical clock survives the round-trip.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';

describe.skipIf(E2E_SKIP)('e2e: lamport-echo', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Lamport Echo' });
        const atlas = await createAtlas(api, { name: 'Lamport Echo Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Lamport' });
    });

    it('echoes the lamportTimestamp of an incrementally-pulled op', async () => {
        // Build two feature CREATE ops with EXPLICIT, distinct Lamport timestamps so
        // we assert against a known value rather than whatever the factory produced.
        const opA = createOperation('feature', 'create', crypto.randomUUID(), mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { source: 'point', name: 'A' },
        });
        const opB = createOperation('feature', 'create', crypto.randomUUID(), mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [1, 1] },
            properties: { source: 'point', name: 'B' },
        });
        // Pin deterministic logical clocks (factory uses a shared monotonic counter).
        opA.lamportTimestamp = 41;
        opB.lamportTimestamp = 99;

        const pushed = await api.pushOperations(atlasId, [opA, opB]);
        // Two fresh ops must both apply (non-idempotent) and bump the version.
        expect(pushed.acks).toHaveLength(2);
        expect(pushed.acks.every((a) => a.idempotent === false)).toBe(true);
        const currentVersion = pushed.serverVersion;
        // map create + two feature creates => server is at least at version 3.
        expect(currentVersion).toBeGreaterThanOrEqual(3);

        // Incremental pull: since (currentVersion - 1) returns exactly the LAST op.
        const res = await api.pullSync(atlasId, currentVersion - 1);
        expect(res.isSnapshot).toBe(false);
        expect(res.snapshot).toBeUndefined();
        expect(res.currentVersion).toBe(currentVersion);
        expect(Array.isArray(res.operations)).toBe(true);
        expect(res.operations).toHaveLength(1);

        const echoed = res.operations[0];
        // The op that landed at the highest server_version is opB (pushed last).
        expect(echoed.entityType).toBe('feature');
        expect(echoed.entityId).toBe(opB.entityId);
        // Core assertion: the logical clock survived the HTTP round-trip verbatim.
        expect(echoed.lamportTimestamp).toBe(99);
        expect(typeof echoed.lamportTimestamp).toBe('number');
        expect(echoed.serverVersion).toBe(currentVersion);

        // Edge: pulling from the tip yields ZERO incremental ops (nothing newer).
        const tip = await api.pullSync(atlasId, currentVersion);
        expect(tip.isSnapshot).toBe(false);
        expect(tip.operations).toHaveLength(0);
        expect(tip.currentVersion).toBe(currentVersion);
    });
});

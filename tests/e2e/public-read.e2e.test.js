// Path: tests/e2e/public-read.e2e.test.js

/**
 * @fileoverview Real-backend E2E for the public-link read-only flow.
 *
 * Exercises the frozen public-sharing contract against the live `ebgeo_backend`:
 *  1. The owner seeds an atlas/map/feature, then enables public sharing
 *     (`POST /atlas/:id/sharing/public`) which mints a `publicLink`.
 *  2. An UNAUTHENTICATED client resolves that link via `GET /atlas/public/:link`
 *     and receives a short-lived read-only `publicToken` (JWT, permission=read).
 *  3. Carrying ONLY that public token, the visitor can PULL the snapshot and see
 *     the owner-seeded feature (read works) ...
 *  4. ... but PUSHING any operation is rejected with 403 (write denied), and the
 *     owner's snapshot is unchanged afterwards (the rejected op never landed).
 *
 * Every round-trip is real HTTP; assertions read observable backend state via
 * `pullSync` snapshots. The suite creates its own user/atlas for isolation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generateUUID } from '../../src/js/utilities/uuid.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import {
    E2E_SKIP,
    getBaseUrl,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';

/**
 * Flattens every feature collection of a snapshot map into a single array.
 * @param {Object} map - A snapshot map ({ features: { points: [], ... } }).
 * @returns {Object[]} All GeoJSON features across collections.
 */
function allFeatures(map) {
    const collections = map?.features ?? {};
    return Object.values(collections).flat();
}

describe.skipIf(E2E_SKIP)('E2E: public link is read-only', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} owner client */
    let owner;
    let atlas;
    let mapId;
    /** UUID of the point feature the owner seeds before publishing. */
    let seededFeatureId;
    /** The opaque public link minted by enabling public sharing. */
    let publicLink;

    beforeAll(async () => {
        owner = makeApi();
        await registerAndLogin(owner, { nome: 'Public Owner' });
        atlas = await createAtlas(owner, { name: 'Public Read Atlas' });
        mapId = await createMap(owner, atlas.id, { name: 'Public Map' });

        // Seed one point feature so the public read has something to observe.
        seededFeatureId = generateUUID();
        const seedOp = createOperation('feature', 'create', seededFeatureId, mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.18, -22.9] },
            properties: { source: 'point', name: 'Visible to public' },
        });
        await owner.pushOperations(atlas.id, [seedOp]);

        // Publish: owner-only route that flips is_public and mints a public link.
        const res = await fetch(
            `${getBaseUrl()}/api/v1/atlas/${atlas.id}/sharing/public`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${owner.getAccessToken()}` },
            }
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        publicLink = body.data.publicLink;
        expect(typeof publicLink).toBe('string');
        expect(publicLink.length).toBeGreaterThan(0);
    });

    it('resolves the public link and pulls the snapshot read-only, but cannot push', async () => {
        // ----- Resolve the public link as a fully anonymous client (no auth). -----
        const anon = makeApi();
        expect(anon.isAuthenticated()).toBe(false);
        const publicAtlas = await anon._request('GET', `/atlas/public/${publicLink}`, {
            auth: false,
        });
        expect(publicAtlas.id).toBe(atlas.id);
        expect(typeof publicAtlas.publicToken).toBe('string');
        expect(publicAtlas.publicToken.length).toBeGreaterThan(0);

        // ----- Visitor carries ONLY the read-only public token. -----
        const visitor = makeApi();
        visitor.setTokens({ accessToken: publicAtlas.publicToken });

        // READ works: the snapshot exposes the owner-seeded point feature.
        const pull = await visitor.pullSync(atlas.id, 0);
        expect(pull.isSnapshot).toBe(true);
        const map = pull.snapshot.maps.find((m) => m.id === mapId);
        expect(map).toBeDefined();
        const seeded = allFeatures(map).find((f) => f.properties.id === seededFeatureId);
        expect(seeded).toBeDefined();
        expect(seeded.properties.source).toBe('point');
        expect(seeded.geometry.coordinates).toEqual([-43.18, -22.9]);

        // ----- WRITE is denied: pushing any op with the public token -> 403. -----
        const intruderFeatureId = generateUUID();
        const writeOp = createOperation('feature', 'create', intruderFeatureId, mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { source: 'point', name: 'Should never land' },
        });
        const pushErr = await visitor.pushOperations(atlas.id, [writeOp]).then(
            () => null,
            (err) => err
        );
        expect(pushErr, 'public push must reject').not.toBeNull();
        expect(pushErr.status).toBe(403);

        // Negative/edge: the rejected write must NOT have mutated backend state.
        // Re-pull as the OWNER and confirm the intruder feature is absent while the
        // legitimately-seeded one remains.
        const ownerPull = await owner.pullSync(atlas.id, 0);
        const ownerMap = ownerPull.snapshot.maps.find((m) => m.id === mapId);
        const ownerFeatureIds = allFeatures(ownerMap).map((f) => f.properties.id);
        expect(ownerFeatureIds).toContain(seededFeatureId);
        expect(ownerFeatureIds).not.toContain(intruderFeatureId);
    });
});

// Path: e2e-ui/browser-collab-scale.spec.js

/**
 * SCALE — THREE real browsers + real backend, on the full-chain harness. Proves the
 * broadcast FANS OUT to every peer in the room, in all directions: each of three
 * collaborators creates a feature and it traverses the WHOLE chain to BOTH of the others
 * (expectFullSync verifies every peer). Catches room-membership / self-echo /
 * broadcast-target regressions two clients can hide.
 *
 * Run headed:  npx playwright test browser-collab-scale --headed
 */

import { collabTest, drawLineUI } from './helpers/collab.fixtures.js';

collabTest.describe('Scale — three-client broadcast fan-out (full chain)', () => {
    collabTest.use({ collabOptions: { peers: 2, permission: 'write', mapName: 'Mapa Tático' } });

    collabTest('each of three collaborators creates a feature → it reaches BOTH others through the whole chain', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author;
        const B = collab.peers[0];
        const C = collab.peers[1];

        // A draws → the line traverses the chain to BOTH B and C (peers = [B, C]).
        const fa = await drawLineUI(A, [[-43.20, -22.90], [-43.10, -22.80]]);
        await collab.expectFullSync({ entityId: fa, type: 'lines', operationType: 'create' });

        // B draws → to A and C (author = B).
        const fb = await drawLineUI(B, [[-43.25, -22.95], [-43.15, -22.85]]);
        await collab.expectFullSyncFrom(B, { entityId: fb, type: 'lines', operationType: 'create' });

        // C draws → to A and B (author = C).
        const fc = await drawLineUI(C, [[-43.30, -23.00], [-43.20, -22.90]]);
        await collab.expectFullSyncFrom(C, { entityId: fc, type: 'lines', operationType: 'create' });
    });
});

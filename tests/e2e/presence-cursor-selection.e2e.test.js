// Path: tests/e2e/presence-cursor-selection.e2e.test.js

/**
 * @fileoverview Real-backend E2E for §Awareness: two WS clients (TWO distinct
 * users sharing one atlas) exchange presence plus live cursor and selection frames.
 *
 * Drives the real frontend WS transport (`makeWs`) against the spawned ebgeo_backend
 * over actual WebSockets. The owner (user A) creates the atlas/map and shares it
 * read-only with user B (POST /atlas/:id/sharing/users), so B can open a collab
 * socket with its OWN userId. Each client uses a distinct clientId.
 *
 * Asserts (all from observable backend WS output — no DB access):
 *   - the late joiner (B) sees A in its `connected` frame's usersOnline, and A
 *     receives a `user_joined` presence frame carrying B's userId;
 *   - a cursor A sends is delivered to B with A's userId, position and mapId echoed;
 *   - a selection A sends is delivered to B with the feature ids;
 *   - (negative/edge) broadcastToRoom excludes the sender — A never receives its own
 *     cursor/selection echo (asserted by userId, which differs between A and B).
 *
 * The atlas/map/users are created fresh in beforeAll for isolation.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { generateUUID } from '../../src/js/utilities/uuid.js';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    makeWs,
    newClientId,
    waitFor,
} from './helpers/harness.js';

describe.skipIf(E2E_SKIP)('§Awareness — presence, cursor & selection over real WS', () => {
    /** Owner / user A. @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let apiA;
    /** Shared user B. @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let apiB;
    let atlasId;
    let mapId;
    let userIdA;
    let userIdB;

    /** @type {import('../../src/js/store/sync/ws-client.js').WsClient} */
    let wsA;
    /** @type {import('../../src/js/store/sync/ws-client.js').WsClient} */
    let wsB;

    // Inbound frames captured per client for polling/assertions.
    const aCursors = [];
    const aSelections = [];
    const aPresence = [];
    const bCursors = [];
    const bSelections = [];
    const bPresence = [];
    let aConnected = null;
    let bConnected = null;

    /** Reads a user id off the various login/register payload shapes. */
    const idOf = (u) => u.id ?? u.userId ?? u.sub;

    beforeAll(async () => {
        apiA = makeApi();
        apiB = makeApi();

        const authA = await registerAndLogin(apiA, { nome: 'Awareness Owner' });
        const authB = await registerAndLogin(apiB, { nome: 'Awareness Peer' });
        userIdA = idOf(authA.user);
        userIdB = idOf(authB.user);
        expect(userIdA).toBeTruthy();
        expect(userIdB).toBeTruthy();
        expect(userIdA).not.toBe(userIdB);

        const atlas = await createAtlas(apiA, { name: 'Awareness Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(apiA, atlasId, { name: 'Awareness Map' });

        // Owner shares the atlas read-only with B so B can open a collab socket.
        await apiA._request('POST', `/atlas/${atlasId}/sharing/users`, {
            body: { userId: userIdB, permission: 'read' },
        });

        wsA = makeWs(apiA, { clientId: newClientId() });
        wsB = makeWs(apiB, { clientId: newClientId() });

        wsA.on('cursor', (m) => aCursors.push(m));
        wsA.on('selection', (m) => aSelections.push(m));
        wsA.on('presence', (m) => aPresence.push(m));
        wsA.on('connected', (m) => { aConnected = m; });

        wsB.on('cursor', (m) => bCursors.push(m));
        wsB.on('selection', (m) => bSelections.push(m));
        wsB.on('presence', (m) => bPresence.push(m));
        wsB.on('connected', (m) => { bConnected = m; });

        // A joins first, then B — so A observes B's user_joined and B sees A already
        // present in usersOnline.
        await wsA.connect(atlasId);
        await wsB.connect(atlasId);
    });

    afterAll(() => {
        wsA?.disconnect();
        wsB?.disconnect();
    });

    it('exposes peers via connected.usersOnline and a user_joined presence frame', async () => {
        expect(aConnected).toBeTruthy();
        expect(bConnected).toBeTruthy();

        // B is the late joiner: its connected frame must already list A.
        const usersOnline = bConnected.usersOnline ?? [];
        expect(Array.isArray(usersOnline)).toBe(true);
        expect(usersOnline.some((u) => u.id === userIdA)).toBe(true);

        // A (early member) must receive a user_joined presence frame for B.
        await waitFor(() => aPresence.some(
            (p) => p.type === 'user_joined' && p.user?.id === userIdB,
        ));
    });

    it('delivers A cursor to B with userId, position and mapId echoed', async () => {
        const position = { lng: -43.123456, lat: -22.987654 };
        const sent = wsA.sendCursor({ position, mapId });
        expect(sent).toBe(true);

        const frame = await waitFor(
            () => bCursors.find((c) => c.mapId === mapId) || false,
        );
        expect(frame.type).toBe('cursor');
        expect(frame.userId).toBe(userIdA);
        expect(frame.mapId).toBe(mapId);
        expect(frame.position).toEqual(position);
    });

    it('delivers A selection to B with the feature ids', async () => {
        const featureIds = [generateUUID(), generateUUID()];
        const sent = wsA.sendSelection({ featureIds, mapId });
        expect(sent).toBe(true);

        const frame = await waitFor(
            () => bSelections.find((s) => s.mapId === mapId) || false,
        );
        expect(frame.type).toBe('selection');
        expect(frame.userId).toBe(userIdA);
        expect(frame.featureIds).toEqual(featureIds);
    });

    it('does not echo the sender its own cursor or selection (broadcast excludes sender)', async () => {
        // Use B's reception as a happens-after barrier: once B has both of A's
        // frames, any echo back to A would already have arrived too.
        await waitFor(() => bCursors.length > 0 && bSelections.length > 0);

        expect(aCursors.some((c) => c.userId === userIdA)).toBe(false);
        expect(aSelections.some((s) => s.userId === userIdA)).toBe(false);
        // And A genuinely received nothing of its own making.
        expect(aCursors).toHaveLength(0);
        expect(aSelections).toHaveLength(0);
    });
});

// Path: e2e-ui/presence.spec.js

/**
 * Two-client browser presence/awareness test (Slice 2). Drives the REAL frontend
 * transport (api-client / ws-client / connection-state) imported live from the Vite
 * dev server inside TWO separate Chromium contexts, both connected to the SAME atlas
 * over the REAL backend collab gateway with DIFFERENT clientIds.
 *
 * Proves the presence wire-up end to end:
 *   - each side sees the other in the `connected.usersOnline` roster OR via a
 *     `presence` `user_joined` frame;
 *   - a cursor sent by client A (`ws.sendCursor`) is received by client B's
 *     `cursor` handler with the expected position.
 *
 * Seeds ONE shared user + atlas + map via the backend API (like login-flow), then
 * both pages log in with those shared credentials and open the same atlas.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Boots a WsClient inside a page, connected to `atlasId` with `clientId`, and starts
 * collecting inbound `cursor` and `presence` frames into page-global arrays so the
 * Node side can poll them. Returns the `connected` payload (incl. `usersOnline`).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ baseUrl: string, username: string, password: string, atlasId: string, clientId: string }} cfg
 * @returns {Promise<{ sessionUserId: string, usersOnline: Array<Object> }>}
 */
function connectClient(page, cfg) {
    return page.evaluate(async ({ baseUrl, username, password, atlasId, clientId }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { WsClient } = await import('/src/js/store/sync/ws-client.js');
        const { ConnectionState } = await import('/src/js/store/sync/connection-state.js');

        const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
        await api.login(username, password);

        const cursors = [];
        const presence = [];
        const temporal = [];
        const briefingEdit = [];
        const ws = new WsClient({
            apiClient: api,
            connectionState: new ConnectionState(),
            socketFactory: (url) => new WebSocket(url),
            clientId,
            heartbeatMs: 1e7,
        });
        ws.on('cursor', (msg) => cursors.push(msg));
        ws.on('presence', (msg) => presence.push(msg));
        ws.on('temporal', (msg) => temporal.push(msg));
        ws.on('briefingEdit', (msg) => briefingEdit.push(msg));

        const connected = await ws.connect(atlasId);

        // Stash on window so subsequent page.evaluate calls can reach this client.
        window.__presence = {
            api, ws, cursors, presence, temporal, briefingEdit,
            sessionUserId: connected.userId,
        };

        return {
            sessionUserId: connected.userId,
            usersOnline: Array.isArray(connected.usersOnline) ? connected.usersOnline : [],
        };
    }, cfg);
}

/**
 * Renders an OnlineUsersControl roster inside the page, fed by the pure presence
 * store, so DOM assertions (case C/D/E/G) run against the REAL roster component.
 * The store is driven from inbound awareness frames the peer received over the
 * wire — the same path presence-bridge wires in the live app. Self is excluded
 * via a sessionContext clientId that matches no peer, so every received peer
 * shows in the roster. The control is appended to <body> with a known testid.
 *
 * @param {import('@playwright/test').Page} page
 */
function mountRoster(page) {
    return page.evaluate(async () => {
        const { presenceStore } = await import('/src/js/presence/presence-store.js');
        const { OnlineUsersControl } = await import('/src/js/presence/online-users.control.js');
        const { sessionContext } = await import('/src/js/store/sync/session-context.js');
        // Ensure self-exclusion never hides a peer in this harness.
        sessionContext.clientId = '__roster_self__';

        const control = new OnlineUsersControl();
        const el = control.onAdd({});
        el.id = 'roster-under-test';
        document.body.appendChild(el);
        // Expand the list so rows are visible for assertions.
        el.querySelector('[data-testid="online-users-toggle"]')?.click();

        // Feed every inbound awareness frame the peer collected into the store,
        // mirroring presence-bridge's inbound routing.
        const p = window.__presence;
        for (const c of p.cursors) presenceStore.setCursor(c);
        for (const t of p.temporal) presenceStore.setTemporal(t);
        for (const b of p.briefingEdit) {
            // `clientId` travels through, like the bridge does. Dropping it here would key
            // the entry by userId and mint a second roster row for the same peer, which is
            // the very defect the row COUNT below now guards.
            presenceStore.setBriefingEdit({
                userId: b.userId,
                clientId: b.clientId,
                briefingId: b.briefingId,
                userName: b.userName,
                editing: b.type === 'briefing_edit_started',
            });
        }
        for (const m of p.presence) {
            if (m.type === 'user_away') presenceStore.userAway(m);
            if (m.type === 'user_back') presenceStore.userBack(m);
        }
        window.__roster = { presenceStore, control, el };
    });
}

describeOrSkip('Presence/awareness (two real browser clients + real backend)', () => {
    test('cursor from A reaches B; both see each other in the roster or via user_joined', async ({ browser }) => {
        // 1. Seed ONE shared user + atlas + map via the backend API.
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const seed = await seedPage.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `presence_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Presence User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Presence Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            return { username, password, atlasId: atlas.id, mapId };
        }, state.baseUrl);
        await seedPage.close();

        // 2. Two independent browser contexts → two pages, each pointed at the backend.
        const ctxA = await browser.newContext();
        const pageA = await ctxA.newPage();
        const ctxB = await browser.newContext();
        const pageB = await ctxB.newPage();

        for (const page of [pageA, pageB]) {
            await page.addInitScript((url) => {
                window.__EBGEO_BACKEND_URL__ = url;
            }, `${state.baseUrl}/api/v1`);
            await page.goto('/');
        }

        const clientIdA = `presence-A-${crypto.randomUUID().slice(0, 8)}`;
        const clientIdB = `presence-B-${crypto.randomUUID().slice(0, 8)}`;
        const cfg = {
            baseUrl: state.baseUrl,
            username: seed.username,
            password: seed.password,
            atlasId: seed.atlasId,
        };

        // 3. Connect A first, then B (so A's roster may be empty but B's includes A,
        //    and A receives a user_joined for B).
        const connA = await connectClient(pageA, { ...cfg, clientId: clientIdA });
        const connB = await connectClient(pageB, { ...cfg, clientId: clientIdB });

        // 4. Each side must learn about the other: B's initial roster should include A,
        //    OR A must observe a `presence` user_joined for B (poll, since it's async).
        const bSeesAInRoster = connB.usersOnline.some((u) => u.userId === connA.sessionUserId);
        const aSawJoin = await pageA.evaluate(async () => {
            const deadline = Date.now() + 4000;
            while (Date.now() < deadline) {
                if (window.__presence.presence.some((m) => m.type === 'user_joined')) return true;
                await new Promise((r) => setTimeout(r, 25));
            }
            return window.__presence.presence.some((m) => m.type === 'user_joined');
        });
        expect(bSeesAInRoster || aSawJoin).toBe(true);

        // 5. A sends a cursor; B's `cursor` handler must receive it with the position.
        const lng = -43.2;
        const lat = -22.9;
        const sent = await pageA.evaluate(
            ({ lng: x, lat: y, mapId }) =>
                window.__presence.ws.sendCursor({ position: { lng: x, lat: y }, mapId }),
            { lng, lat, mapId: seed.mapId },
        );
        expect(sent).toBe(true);

        const cursorOnB = await pageB.evaluate(
            async ({ senderUserId, lng: x, lat: y }) => {
                const deadline = Date.now() + 4000;
                const match = () =>
                    window.__presence.cursors.find(
                        (c) =>
                            c.userId === senderUserId &&
                            c.position &&
                            c.position.lng === x &&
                            c.position.lat === y,
                    );
                while (Date.now() < deadline && !match()) {
                    await new Promise((r) => setTimeout(r, 25));
                }
                const hit = match();
                return {
                    received: Boolean(hit),
                    total: window.__presence.cursors.length,
                    position: hit ? hit.position : null,
                };
            },
            { senderUserId: connA.sessionUserId, lng, lat },
        );

        expect(cursorOnB.received).toBe(true);
        expect(cursorOnB.position).toEqual({ lng, lat });

        // 6. Clean up both WS clients and contexts.
        await pageA.evaluate(() => window.__presence.ws.disconnect());
        await pageB.evaluate(() => window.__presence.ws.disconnect());
        await ctxA.close();
        await ctxB.close();
    });

    test('awareness frames (current-map, temporal, briefing-edit, away) reach B and render in the roster DOM', async ({ browser }) => {
        // 1. Seed ONE shared user + atlas + map.
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const seed = await seedPage.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `presence_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Presence User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Presence Atlas 2' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'Mapa Tático' })]);
            return { username, password, atlasId: atlas.id, mapId, mapName: 'Mapa Tático' };
        }, state.baseUrl);
        await seedPage.close();

        const ctxA = await browser.newContext();
        const pageA = await ctxA.newPage();
        const ctxB = await browser.newContext();
        const pageB = await ctxB.newPage();
        for (const page of [pageA, pageB]) {
            await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
            await page.goto('/');
        }

        const cfg = { baseUrl: state.baseUrl, username: seed.username, password: seed.password, atlasId: seed.atlasId };
        const clientIdA = `awz-A-${crypto.randomUUID().slice(0, 8)}`;
        const connA = await connectClient(pageA, { ...cfg, clientId: clientIdA });
        await connectClient(pageB, { ...cfg, clientId: `awz-B-${crypto.randomUUID().slice(0, 8)}` });

        // 2. A broadcasts the full awareness set: active map (via cursor mapId),
        //    a temporal instant, a briefing-edit start. The mapId carries the
        //    active-map indicator (case C); the temporal frame carries case E.
        await pageA.evaluate(({ mapName }) => {
            // The real bridge broadcasts the active map BY NAME (getCurrentMapNameSync) — the
            // app is name-keyed — so peers render a human label. Simulate that faithfully
            // (the backend UUID is never what the cursor/temporal frames carry).
            window.__presence.ws.sendCursor({ position: { lng: -43.2, lat: -22.9 }, mapId: mapName });
            window.__presence.ws.sendTemporal({ cursor: 1700000000000, label: 'D+3', playing: false }, mapName);
            window.__presence.ws.sendBriefingEditStart('briefing-xyz');
        }, { mapName: seed.mapName });

        // 3. B must receive the temporal + briefing-edit frames from A (poll async).
        const received = await pageB.evaluate(async (senderUserId) => {
            const deadline = Date.now() + 4000;
            const ok = () =>
                window.__presence.temporal.some((t) => t.userId === senderUserId && t.state && t.state.label === 'D+3') &&
                window.__presence.briefingEdit.some((b) => b.type === 'briefing_edit_started' && b.briefingId === 'briefing-xyz') &&
                window.__presence.cursors.some((c) => c.userId === senderUserId && c.mapId);
            while (Date.now() < deadline && !ok()) await new Promise((r) => setTimeout(r, 25));
            return ok();
        }, connA.sessionUserId);
        expect(received).toBe(true);

        // 4. Render the real roster from B's received frames and assert the DOM.
        await mountRoster(pageB);
        const roster = pageB.locator('#roster-under-test');
        // Case C — active-map indicator shows the seeded map name.
        await expect(roster.getByTestId('online-user-map')).toContainText('Mapa Tático');
        // Case E — temporal instant ("em D+3").
        await expect(roster.getByTestId('online-user-temporal')).toContainText('D+3');
        // Case D — briefing-edit indicator.
        await expect(roster.getByTestId('online-user-briefing')).toContainText('editando briefing');

        // 5. Case G — away rendering: drive a user_away into B's store and re-render.
        //
        // THE FRAME CARRIES BOTH IDENTITIES, and passing only `userId` (what this block did
        // until 2026-08-16) is a shape the server never sends: `broadcastUserAway`
        // (`backend/src/modules/collab/collab.service.js`) always sends `{ userId, clientId }`,
        // and the store's `resolveKey` PREFERS `clientId`. With only the userId the call did
        // not mark A away — it minted a SECOND, phantom roster entry under a different key.
        // The badge assertion above still found "ausente" (on the phantom) while the item
        // assertion below read the real A, which was never touched. The same mismatch is
        // recorded on the server side, in `collab.rooms.js`: a join snapshot without
        // `clientId` was keyed by userId and never matched the `user_away` that followed.
        await pageB.evaluate(({ awayUserId, awayClientId }) => {
            window.__roster.presenceStore.userAway({ userId: awayUserId, clientId: awayClientId });
        }, { awayUserId: connA.sessionUserId, awayClientId: clientIdA });
        await expect(roster.getByTestId('online-user-away')).toContainText('ausente');
        // Exactly ONE row: a second row here means the away frame minted a phantom entry
        // instead of marking the peer, which is precisely how this case used to pass its
        // badge assertion while failing its attribute assertion.
        await expect(roster.getByTestId('online-user-item')).toHaveCount(1);
        await expect(roster.getByTestId('online-user-item').first()).toHaveAttribute('data-away', 'true');

        // 6. Clean up.
        await pageA.evaluate(() => window.__presence.ws.disconnect());
        await pageB.evaluate(() => window.__presence.ws.disconnect());
        await ctxA.close();
        await ctxB.close();
    });
});

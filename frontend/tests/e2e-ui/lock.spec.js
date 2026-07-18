// Path: e2e-ui/lock.spec.js

/**
 * Two-client browser map-lock test (Slice 3). Drives the REAL frontend transport
 * (api-client / ws-client / connection-state / operation-factory) imported live from
 * the Vite dev server inside TWO separate Chromium contexts, both connected to the
 * SAME atlas over the REAL backend collab gateway with DIFFERENT clientIds.
 *
 * Proves the map-lock op round-trips end to end:
 *   - the OWNER pushes a `map` `update` op `{ locked: true }` via HTTP
 *     (`api.pushOperations`);
 *   - the OTHER context's WsClient `operation` handler receives that locked map
 *     update broadcast over the collab WS (poll, since it's async);
 *   - the persisted snapshot (`api.pullSync`) reports `map.locked === true`.
 *
 * Seeds ONE shared OWNER user + atlas + map via the backend API (like presence),
 * then both pages connect a WsClient to the same atlas with the real owner token.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Boots a WsClient inside a page, connected to `atlasId` with `clientId`, and starts
 * collecting inbound `operation` frames into a page-global array so the Node side can
 * poll them. Returns the `connected` payload (incl. the resolved session userId).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ baseUrl: string, username: string, password: string, atlasId: string, clientId: string }} cfg
 * @returns {Promise<{ sessionUserId: string }>}
 */
function connectClient(page, cfg) {
    return page.evaluate(async ({ baseUrl, username, password, atlasId, clientId }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { WsClient } = await import('/src/js/store/sync/ws-client.js');
        const { ConnectionState } = await import('/src/js/store/sync/connection-state.js');

        const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
        await api.login(username, password);

        const operations = [];
        const ws = new WsClient({
            apiClient: api,
            connectionState: new ConnectionState(),
            socketFactory: (url) => new WebSocket(url),
            clientId,
            heartbeatMs: 1e7,
        });
        ws.on('operation', (op) => operations.push(op));

        const connected = await ws.connect(atlasId);

        // Stash on window so subsequent page.evaluate calls can reach this client.
        window.__lock = { api, ws, operations, sessionUserId: connected.userId };

        return { sessionUserId: connected.userId };
    }, cfg);
}

describeOrSkip('Map lock (two real browser clients + real backend)', () => {
    test('owner locks the map; the other client receives the broadcast and the snapshot reflects it', async ({
        browser,
    }) => {
        // 1. Seed ONE shared OWNER user + atlas + map via the backend API.
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const seed = await seedPage.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `lock_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Lock Owner' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Lock Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

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

        const clientIdA = `lock-A-${crypto.randomUUID().slice(0, 8)}`;
        const clientIdB = `lock-B-${crypto.randomUUID().slice(0, 8)}`;
        const cfg = {
            baseUrl: state.baseUrl,
            username: seed.username,
            password: seed.password,
            atlasId: seed.atlasId,
        };

        // 3. Connect both clients as the SAME owner user but with DIFFERENT clientIds.
        //    A is the "owner driver" that pushes the lock; B is the remote observer.
        await connectClient(pageA, { ...cfg, clientId: clientIdA });
        await connectClient(pageB, { ...cfg, clientId: clientIdB });

        // 4. Owner (A) pushes a `map` `update` op `{ locked: true }` over HTTP. The
        //    op carries A's clientId, so the WS broadcast is delivered to B (and the
        //    self-echo is filtered out on A).
        const pushed = await pageA.evaluate(
            async ({ atlasId, mapId, clientId }) => {
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
                // Author the op as client A: the HTTP-push broadcast re-emits the op
                // verbatim (incl. clientId), so A's own WsClient filters this self-echo
                // (clientId === A) while B keeps it (clientId !== B).
                const op = { ...createOperation('map', 'update', mapId, null, { locked: true }), clientId };
                const res = await window.__lock.api.pushOperations(atlasId, [op]);
                return { opClientId: op.clientId, serverVersion: res.serverVersion };
            },
            { atlasId: seed.atlasId, mapId: seed.mapId, clientId: clientIdA },
        );
        expect(pushed.opClientId).toBe(clientIdA);

        // 5. B's `operation` handler must receive the locked map update (poll, async).
        const lockOnB = await pageB.evaluate(
            async (mapId) => {
                const deadline = Date.now() + 5000;
                const match = () =>
                    window.__lock.operations.find(
                        (op) =>
                            op.entityType === 'map' &&
                            op.operationType === 'update' &&
                            op.entityId === mapId &&
                            op.data &&
                            op.data.locked === true,
                    );
                while (Date.now() < deadline && !match()) {
                    await new Promise((r) => setTimeout(r, 25));
                }
                const hit = match();
                return {
                    received: Boolean(hit),
                    total: window.__lock.operations.length,
                    locked: hit ? hit.data.locked : null,
                };
            },
            seed.mapId,
        );
        expect(lockOnB.received).toBe(true);
        expect(lockOnB.locked).toBe(true);

        // 6. The persisted snapshot must report the map as locked.
        const snapshotLocked = await pageB.evaluate(
            async ({ atlasId, mapId }) => {
                const deadline = Date.now() + 5000;
                const readLocked = (pull) => {
                    const maps = pull && pull.snapshot ? pull.snapshot.maps : null;
                    if (!maps) return undefined;
                    const list = Array.isArray(maps) ? maps : Object.values(maps);
                    const map = list.find((m) => m && (m.id === mapId || m.mapId === mapId));
                    return map ? map.locked : undefined;
                };
                let locked;
                while (Date.now() < deadline) {
                    const pull = await window.__lock.api.pullSync(atlasId, 0);
                    locked = readLocked(pull);
                    if (locked === true) break;
                    await new Promise((r) => setTimeout(r, 50));
                }
                return locked;
            },
            { atlasId: seed.atlasId, mapId: seed.mapId },
        );
        expect(snapshotLocked).toBe(true);

        // 7. Clean up both WS clients and contexts.
        await pageA.evaluate(() => window.__lock.ws.disconnect());
        await pageB.evaluate(() => window.__lock.ws.disconnect());
        await ctxA.close();
        await ctxB.close();
    });
});

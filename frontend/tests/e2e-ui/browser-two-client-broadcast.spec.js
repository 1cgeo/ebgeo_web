// Path: e2e-ui/browser-two-client-broadcast.spec.js

/**
 * Two-client browser broadcast test. Drives the REAL frontend transport
 * (api-client / ws-client / connection-state / operation-factory) imported live
 * from the Vite dev server inside TWO separate Chromium contexts, both connected
 * to the SAME atlas over the REAL backend collab gateway with DIFFERENT clientIds.
 *
 * Proves the HTTP-push -> WS-broadcast fan-out round-trips end to end:
 *   - client A creates a feature via HTTP (`api.pushOperations`) carrying A's
 *     clientId;
 *   - client B's WsClient `operation` handler receives that broadcast over the
 *     collab WS (poll, since it is async), with the GeoJSON payload intact;
 *   - NEGATIVE: client A's own WsClient does NOT see its self-echo, because the
 *     WsClient filters frames whose `op.clientId` equals its own `clientId`
 *     (ws-client.js: `if (op.clientId && this._clientId && op.clientId === this._clientId) continue;`).
 *
 * Seeds ONE shared OWNER user + atlas + map via the backend API (like lock/presence),
 * then both pages connect a WsClient to the same atlas with the real owner token.
 *
 * A CONTA, porém, não nasce aqui dentro: ela vem pronta de `helpers/accounts.js`, no lado
 * Node, porque confirmar o e-mail exige ler `email_verification_tokens` no Postgres, que o
 * contexto do browser não alcança. O `page.evaluate` faz só o `login()`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Boots a WsClient inside a page, connected to `atlasId` with `clientId`, and starts
 * collecting inbound `operation` frames into a page-global array (keyed by `globalKey`)
 * so the Node side can poll them. Returns the resolved session userId.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ baseUrl: string, username: string, password: string, atlasId: string, clientId: string, globalKey: string }} cfg
 * @returns {Promise<{ sessionUserId: string }>}
 */
function connectClient(page, cfg) {
    return page.evaluate(async ({ baseUrl, username, password, atlasId, clientId, globalKey }) => {
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
        window[globalKey] = { api, ws, operations, clientId, sessionUserId: connected.userId };

        return { sessionUserId: connected.userId };
    }, cfg);
}

describeOrSkip('HTTP-push broadcast fan-out (two real browser clients + real backend)', () => {
    test('A pushes a feature over HTTP; B receives the broadcast and A filters its own self-echo', async ({
        browser,
    }) => {
        // 1. Seed ONE shared OWNER user + atlas + map via the backend API.
        const user = await createVerifiedUser({ prefix: 'bcast', nome: 'Broadcast Owner' });
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const seed = await seedPage.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'Broadcast Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            return { username: u.username, password: u.password, atlasId: atlas.id, mapId };
        }, { baseUrl: state.baseUrl, u: user });
        await seedPage.close();

        // 2. Two independent browser contexts -> two pages, each pointed at the backend.
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

        const clientIdA = `bcast-A-${crypto.randomUUID().slice(0, 8)}`;
        const clientIdB = `bcast-B-${crypto.randomUUID().slice(0, 8)}`;
        const cfg = {
            baseUrl: state.baseUrl,
            username: seed.username,
            password: seed.password,
            atlasId: seed.atlasId,
        };

        // 3. Connect both clients as the SAME owner user but with DIFFERENT clientIds.
        //    A is the "pusher" (HTTP write); B is the remote observer.
        await connectClient(pageA, { ...cfg, clientId: clientIdA, globalKey: '__bcastA' });
        await connectClient(pageB, { ...cfg, clientId: clientIdB, globalKey: '__bcastB' });

        // 4. A pushes a GeoJSON feature `create` op over HTTP. The op carries A's
        //    clientId, so the WS broadcast is delivered to B and the self-echo is
        //    filtered out on A.
        const featureId = crypto.randomUUID();
        const pushed = await pageA.evaluate(
            async ({ atlasId, mapId, featureId: fid, clientId }) => {
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
                const feature = {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                    properties: { id: fid, source: 'point', nome: 'Broadcast Point' },
                };
                // Author the op as client A: the HTTP-push broadcast re-emits the op
                // verbatim (incl. clientId), so A's own WsClient filters this self-echo
                // (clientId === A) while B keeps it (clientId !== B).
                const op = { ...createOperation('feature', 'create', fid, mapId, feature), clientId };
                const res = await window.__bcastA.api.pushOperations(atlasId, [op]);
                return { opClientId: op.clientId, serverVersion: res.serverVersion };
            },
            { atlasId: seed.atlasId, mapId: seed.mapId, featureId, clientId: clientIdA },
        );
        expect(pushed.opClientId).toBe(clientIdA);

        // 5. POSITIVE: B's `operation` handler must receive the feature create with the
        //    GeoJSON coordinates intact (poll, since the broadcast is async).
        const featureOnB = await pageB.evaluate(
            async ({ mapId, featureId: fid }) => {
                const deadline = Date.now() + 5000;
                const match = () =>
                    window.__bcastB.operations.find(
                        (op) =>
                            op.entityType === 'feature' &&
                            op.operationType === 'create' &&
                            op.entityId === fid &&
                            op.mapId === mapId,
                    );
                while (Date.now() < deadline && !match()) {
                    await new Promise((r) => setTimeout(r, 25));
                }
                const hit = match();
                return {
                    received: Boolean(hit),
                    total: window.__bcastB.operations.length,
                    coordinates: hit && hit.data ? hit.data.geometry.coordinates : null,
                    senderClientId: hit ? hit.clientId : null,
                };
            },
            { mapId: seed.mapId, featureId },
        );
        expect(featureOnB.received).toBe(true);
        expect(featureOnB.coordinates).toEqual([-43.2, -22.9]);
        // The broadcast frame still carries A's clientId — that is exactly why B keeps it.
        expect(featureOnB.senderClientId).toBe(clientIdA);

        // 6. NEGATIVE/EDGE: A pushed the op, so its own WsClient must FILTER the
        //    self-echo (op.clientId === A's clientId). Give the broadcast ample time
        //    to (not) arrive, then assert A never recorded this feature.
        const selfEchoOnA = await pageA.evaluate(
            async (fid) => {
                const deadline = Date.now() + 1500;
                while (Date.now() < deadline) {
                    await new Promise((r) => setTimeout(r, 50));
                }
                return {
                    sawOwnFeature: window.__bcastA.operations.some((op) => op.entityId === fid),
                    total: window.__bcastA.operations.length,
                };
            },
            featureId,
        );
        expect(selfEchoOnA.sawOwnFeature).toBe(false);

        // 7. The persisted snapshot must contain the feature B observed (backend state).
        const persisted = await pageB.evaluate(
            async ({ atlasId, mapId, featureId: fid }) => {
                const pull = await window.__bcastB.api.pullSync(atlasId, 0);
                const maps = pull && pull.snapshot ? pull.snapshot.maps : null;
                const list = Array.isArray(maps) ? maps : maps ? Object.values(maps) : [];
                const map = list.find((m) => m && (m.id === mapId || m.mapId === mapId));
                const points = map && map.features ? map.features.points || [] : [];
                return points.some((p) => p.properties && p.properties.id === fid);
            },
            { atlasId: seed.atlasId, mapId: seed.mapId, featureId },
        );
        expect(persisted).toBe(true);

        // 8. Clean up both WS clients and contexts.
        await pageA.evaluate(() => window.__bcastA.ws.disconnect());
        await pageB.evaluate(() => window.__bcastB.ws.disconnect());
        await ctxA.close();
        await ctxB.close();
    });
});

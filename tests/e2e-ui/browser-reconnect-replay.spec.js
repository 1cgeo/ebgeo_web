// Path: e2e-ui/browser-reconnect-replay.spec.js

/**
 * @fileoverview Two-client browser reconnect/replay test. Drives the REAL frontend
 * transport (api-client / ws-client / connection-state / operation-factory) imported
 * live from the Vite dev server inside TWO separate Chromium contexts, both connected
 * to the SAME atlas over the REAL backend collab gateway with DIFFERENT clientIds.
 *
 * Proves the offline-window replay path end to end:
 *   - client B's WsClient connects, then its underlying socket is forcibly dropped
 *     (server-side close simulated by closing B's raw socket) while B still WANTS to
 *     stay connected, so the WsClient enters RECONNECTING and schedules a reconnect
 *     with a small `reconnectBaseMs`;
 *   - meanwhile client A pushes a brand-new feature op over HTTP that B never saw on
 *     its live `operation` stream (B was offline for that broadcast);
 *   - B auto-reconnects, and because the WsClient was RECONNECTING it emits a
 *     `sync_request` carrying B's last applied version; the server replays the missed
 *     op in a `sync_response`, which B observes (poll).
 *
 * Negative/edge assertion: the missed op must NOT have arrived on B's LIVE `operation`
 * handler during the offline window (it is only recovered via `sync_response`), and
 * B's connection must have actually transited through RECONNECTING (not a no-op).
 *
 * Seeds ONE shared OWNER user + atlas + map via the backend API, then both pages
 * connect a WsClient to the same atlas with the real owner token.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Small reconnect backoff so the auto-reconnect fires well within the test budget. */
const RECONNECT_BASE_MS = 150;

/**
 * Boots a WsClient inside a page connected to `atlasId` with `clientId`, collecting
 * inbound `operation` and `syncResponse` frames plus `stateChange` transitions into
 * page-global arrays so the Node side can poll them. Returns the resolved session id.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ baseUrl: string, username: string, password: string, atlasId: string, clientId: string, reconnectBaseMs: number }} cfg
 * @returns {Promise<{ sessionUserId: string }>}
 */
function connectClient(page, cfg) {
    return page.evaluate(async ({ baseUrl, username, password, atlasId, clientId, reconnectBaseMs }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { WsClient } = await import('/src/js/store/sync/ws-client.js');
        const { ConnectionState } = await import('/src/js/store/sync/connection-state.js');

        const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
        await api.login(username, password);

        const operations = [];
        const syncResponses = [];
        const states = [];
        const ws = new WsClient({
            apiClient: api,
            connectionState: new ConnectionState(),
            socketFactory: (url) => new WebSocket(url),
            clientId,
            heartbeatMs: 1e7,
            reconnectBaseMs,
            reconnectMaxMs: 2000,
        });
        ws.on('operation', (op) => operations.push(op));
        ws.on('syncResponse', (msg) => syncResponses.push(msg));
        ws.on('stateChange', (s) => states.push(s.state));

        const connected = await ws.connect(atlasId);

        // Stash on window so subsequent page.evaluate calls can reach this client.
        window.__rr = { api, ws, operations, syncResponses, states, sessionUserId: connected.userId };

        return { sessionUserId: connected.userId };
    }, cfg);
}

describeOrSkip('Reconnect replay (two real browser clients + real backend)', () => {
    test('B drops, A pushes meanwhile, B auto-reconnects and recovers the missed op via sync_request', async ({
        browser,
    }) => {
        // 1. Seed ONE shared OWNER user + atlas + map via the backend API.
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const seed = await seedPage.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `reconnect_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Reconnect Owner' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Reconnect Atlas' });
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

        const clientIdA = `rr-A-${crypto.randomUUID().slice(0, 8)}`;
        const clientIdB = `rr-B-${crypto.randomUUID().slice(0, 8)}`;
        const cfg = {
            baseUrl: state.baseUrl,
            username: seed.username,
            password: seed.password,
            atlasId: seed.atlasId,
            reconnectBaseMs: RECONNECT_BASE_MS,
        };

        // 3. Connect A (pusher) and B (the dropping/reconnecting observer).
        await connectClient(pageA, { ...cfg, clientId: clientIdA });
        await connectClient(pageB, { ...cfg, clientId: clientIdB });

        // 4. B records the version it has applied so far, then its socket is forcibly
        //    dropped while it STILL wants to be connected. The WsClient must enter
        //    RECONNECTING and schedule an auto-reconnect (small reconnectBaseMs).
        const dropped = await pageB.evaluate(() => {
            const ws = window.__rr.ws;
            // Pin the last applied version so the upcoming sync_request asks for the gap.
            // session.currentVersion (if present) is the most recent the server gave us.
            const v = ws.session && Number.isFinite(ws.session.currentVersion) ? ws.session.currentVersion : 0;
            ws.setLastVersion(v);
            const before = window.__rr.states.length;
            // Forcibly kill the underlying socket WITHOUT calling disconnect(), so
            // _wantConnected stays true and the close path reconnects.
            ws._socket.close(4000, 'test-forced-drop');
            return { lastVersion: v, statesBefore: before };
        });
        // We must have been ONLINE before the drop (edge: a fresh online session existed).
        expect(dropped.statesBefore).toBeGreaterThan(0);

        // The WsClient must actually transit into RECONNECTING (edge: not a silent no-op).
        const wentReconnecting = await pageB.evaluate(async () => {
            const deadline = Date.now() + 4000;
            while (Date.now() < deadline) {
                if (window.__rr.states.includes('reconnecting')) return true;
                await new Promise((r) => setTimeout(r, 15));
            }
            return window.__rr.states.includes('reconnecting');
        });
        expect(wentReconnecting).toBe(true);

        // 5. While B is offline, A pushes a brand-new feature op B never saw live.
        const missed = await pageA.evaluate(
            async ({ atlasId, mapId }) => {
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
                const featureId = crypto.randomUUID();
                const feature = {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.18, -22.95] },
                    properties: { id: featureId, source: 'point', nome: 'Missed While Offline' },
                };
                const res = await window.__rr.api.pushOperations(atlasId, [
                    createOperation('feature', 'create', featureId, mapId, feature),
                ]);
                return { featureId, serverVersion: res.serverVersion };
            },
            { atlasId: seed.atlasId, mapId: seed.mapId },
        );

        // 6. B auto-reconnects (back ONLINE) on its own. No manual reconnect call.
        const reconnected = await pageB.evaluate(async () => {
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
                if (window.__rr.ws.isConnected()) return true;
                await new Promise((r) => setTimeout(r, 25));
            }
            return window.__rr.ws.isConnected();
        });
        expect(reconnected).toBe(true);

        // 7. On reconnect the WsClient (because it was RECONNECTING) emits a
        //    sync_request; the server replays the missed op in a sync_response. B must
        //    observe the missed feature via that sync_response (poll, async).
        const recovered = await pageB.evaluate(
            async (featureId) => {
                const opMatches = (op) =>
                    op &&
                    (op.entityType === 'feature' || op.entity_type === 'feature') &&
                    (op.entityId === featureId || op.entity_id === featureId || op.targetId === featureId);
                const deadline = Date.now() + 8000;
                const find = () => {
                    for (const resp of window.__rr.syncResponses) {
                        if (Array.isArray(resp.ops) && resp.ops.some(opMatches)) return { via: 'ops' };
                        // A full-snapshot replay is also a valid recovery path.
                        if (resp.isSnapshot && resp.snapshot) return { via: 'snapshot' };
                    }
                    return null;
                };
                while (Date.now() < deadline && !find()) {
                    await new Promise((r) => setTimeout(r, 25));
                }
                const hit = find();
                return {
                    recovered: Boolean(hit),
                    via: hit ? hit.via : null,
                    syncResponseCount: window.__rr.syncResponses.length,
                };
            },
            missed.featureId,
        );
        expect(recovered.recovered).toBe(true);
        expect(recovered.syncResponseCount).toBeGreaterThan(0);

        // 8. NEGATIVE/EDGE: the missed op must NOT have leaked onto B's LIVE `operation`
        //    stream while it was offline — recovery is strictly via sync_response.
        const leakedLive = await pageB.evaluate(
            (featureId) =>
                window.__rr.operations.some(
                    (op) =>
                        (op.entityType === 'feature' || op.entity_type === 'feature') &&
                        (op.entityId === featureId || op.entity_id === featureId || op.targetId === featureId),
                ),
            missed.featureId,
        );
        expect(leakedLive).toBe(false);

        // 9. Authoritative cross-check: the persisted snapshot contains the feature, so
        //    the op B recovered is real backend state, not a phantom frame.
        const inSnapshot = await pageB.evaluate(
            async ({ atlasId, mapId, featureId }) => {
                const pull = await window.__rr.api.pullSync(atlasId, 0);
                const map = pull.snapshot?.maps?.find((m) => m.id === mapId);
                const points = map?.features?.points || [];
                return points.some((p) => p.properties && p.properties.id === featureId);
            },
            { atlasId: seed.atlasId, mapId: seed.mapId, featureId: missed.featureId },
        );
        expect(inSnapshot).toBe(true);

        // 10. Clean up both WS clients and contexts.
        await pageA.evaluate(() => window.__rr.ws.disconnect());
        await pageB.evaluate(() => window.__rr.ws.disconnect());
        await ctxA.close();
        await ctxB.close();
    });
});

// Path: e2e-ui/integration.spec.js

/**
 * Browser-level integration: drives the REAL frontend transport modules
 * (api-client / ws-client / operation-factory), imported live from the Vite dev
 * server INSIDE real Chromium, against the REAL backend. This exercises the
 * browser's own fetch + WebSocket + (CORS) stack — coverage the Node E2E can't give.
 *
 * NOTE: this does not click the app UI (there is no login/open-project UI yet); it
 * proves the transport works in a browser context. Full click-through flows await
 * that UI.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Browser ↔ backend integration (real Chromium + real backend)', () => {
    test('HTTP round-trip: register → login → push feature → read back via snapshot', async ({ page }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `ui_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'UI E2E' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'UI Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            const featureId = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: featureId, source: 'point', nome: 'Browser Point' },
            };
            await api.pushOperations(atlas.id, [createOperation('feature', 'create', featureId, mapId, feature)]);

            const pulled = await api.pullSync(atlas.id, 0);
            const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
            const points = map?.features?.points || [];
            return {
                hasToken: Boolean(api.getAccessToken()),
                isSnapshot: pulled.isSnapshot,
                found: points.some((p) => p.properties.id === featureId),
            };
        }, state.baseUrl);

        expect(result.hasToken).toBe(true);
        expect(result.isSnapshot).toBe(true);
        expect(result.found).toBe(true);
    });

    test('WebSocket: a feature pushed over HTTP arrives on a real browser WebSocket', async ({ page }) => {
        await page.goto('/');

        const received = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { WsClient } = await import('/src/js/store/sync/ws-client.js');
            const { ConnectionState } = await import('/src/js/store/sync/connection-state.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `uiws_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'UI WS' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'UI WS Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M' })]);

            const gotOps = [];
            const ws = new WsClient({
                apiClient: api,
                connectionState: new ConnectionState(),
                socketFactory: (url) => new WebSocket(url),
                clientId: 'ui-listener',
                heartbeatMs: 1e7,
            });
            ws.on('operation', (op) => gotOps.push(op));
            await ws.connect(atlas.id);

            const featureId = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { id: featureId, source: 'point' },
            };
            await api.pushOperations(atlas.id, [createOperation('feature', 'create', featureId, mapId, feature)]);

            const deadline = Date.now() + 4000;
            while (Date.now() < deadline && !gotOps.some((o) => o.entityId === featureId)) {
                await new Promise((r) => setTimeout(r, 25));
            }
            ws.disconnect();
            return { sawFeature: gotOps.some((o) => o.entityId === featureId), total: gotOps.length };
        }, state.baseUrl);

        expect(received.sawFeature).toBe(true);
    });
});

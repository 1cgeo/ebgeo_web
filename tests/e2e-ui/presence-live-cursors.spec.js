// Path: e2e-ui/presence-live-cursors.spec.js

/**
 * SHOWCASE: live two-way collaboration on the REAL map across TWO real browsers.
 *
 * Two independent Chromium contexts open the app, JUMP TO THE SAME PLACE, and
 * connect to the SAME atlas over the REAL backend collab gateway (different
 * clientIds). Then, in real time and watchable headed:
 *
 *   - BOTH animate their cursor (opposite orbits); each window renders the OTHER's
 *     labelled cursor on its live 2D map via the REAL `RemoteCursorsLayer`.
 *   - Window A draws a LINE feature; window B plants a MILITARY SYMBOL feature.
 *     Each is authored over the REAL backend (`api.pushOperations`), fans out over
 *     the collab WebSocket, and is drawn on the PEER's map — so both windows end up
 *     showing the line, the NATO symbol, and the other player's cursor.
 *   - Each peer also appears as an online avatar in the real roster.
 *
 * Run it headed to watch both windows mirror each other:
 *   npx playwright test presence-live-cursors --headed
 *   npx playwright test presence-live-cursors --ui
 *
 * This exercises, end to end and in BOTH directions: the cursor awareness pipeline
 * (wire → presenceStore → RemoteCursorsLayer marker) AND the feature op fan-out
 * (author → backend push → WS broadcast → peer renders it on the real map).
 *
 * Seeds ONE shared user + atlas + map via the backend API (like presence.spec).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Shared map view both windows frame, so each sees the other's activity. */
const CENTER = { lng: -43.2, lat: -22.9 };
const ZOOM = 12;
const ORBIT_RADIUS_DEG = 0.018; // ~2 km — clearly visible at this zoom
const FRAMES = 36;
const FRAME_DELAY_MS = 70; // ~2.5 s per orbit — slow enough to watch headed

/**
 * Boots a WsClient inside a page connected to `atlasId` with `clientId`, stashing
 * it (plus the atlasId) on `window.__live` for later page.evaluate calls.
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

        const ws = new WsClient({
            apiClient: api,
            connectionState: new ConnectionState(),
            socketFactory: (url) => new WebSocket(url),
            clientId,
            heartbeatMs: 1e7,
        });
        const connected = await ws.connect(atlasId);
        window.__live = { api, ws, clientId, atlasId, sessionUserId: connected.userId };
        return { sessionUserId: connected.userId };
    }, cfg);
}

/**
 * Wires a connected page into the live UI: mounts the REAL RemoteCursorsLayer +
 * roster on the live map, feeds inbound cursor frames into the shared presenceStore
 * (like presence-bridge), and installs an `operation` feeder that DRAWS features the
 * peer creates onto the real map (a line layer for LineStrings, a milsymbol marker
 * for military symbols). Exposes `window.__demo.pushFeature(feature)` which authors
 * a feature over the real backend AND draws it locally (optimistic author render).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ mapId: string, selfClientId: string, peerClientId: string, peerName: string }} cfg
 */
function setupClient(page, cfg) {
    return page.evaluate(async ({ mapId, selfClientId, peerClientId, peerName }) => {
        const { presenceStore } = await import('/src/js/presence/presence-store.js');
        const { RemoteCursorsLayer } = await import('/src/js/presence/remote-cursors.layer.js');
        const { OnlineUsersControl } = await import('/src/js/presence/online-users.control.js');
        const { sessionContext } = await import('/src/js/store/sync/session-context.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

        // Self is this window; the peer must NOT be excluded from the overlay.
        sessionContext.clientId = selfClientId;
        const map = globalThis.__ebgeoMap;

        const layer = new RemoteCursorsLayer(map, { mapIdProvider: () => mapId });
        layer.start();

        const roster = new OnlineUsersControl();
        const rosterEl = roster.onAdd({});
        rosterEl.id = 'roster-under-test';
        document.body.appendChild(rosterEl);
        rosterEl.querySelector('[data-testid="online-users-toggle"]')?.click();
        // Seed the peer the way presence-bridge does on a `user_joined` frame (a plain
        // cursor frame can't surface a brand-new peer in the roster — see git history).
        presenceStore.userJoined({ clientId: peerClientId, userName: peerName });

        // Inbound cursor → store → PRESENCE_CURSORS_CHANGED → marker on the map.
        window.__live.ws.on('cursor', (msg) => {
            presenceStore.setCursor({
                clientId: peerClientId, userId: msg.userId, userName: peerName,
                position: msg.position, mapId,
            });
        });

        // Draw a received/authored feature onto the live map. Idempotent per id.
        const drawn = new Set();
        function drawFeature(feature) {
            const id = feature && feature.properties ? feature.properties.id : null;
            if (!id || drawn.has(id) || !feature.geometry) return;
            drawn.add(id);

            if (feature.geometry.type === 'LineString') {
                const srcId = `demo-src-${id}`;
                const layerId = `demo-line-${id}`;
                if (!map.getSource(srcId)) map.addSource(srcId, { type: 'geojson', data: feature });
                if (!map.getLayer(layerId)) {
                    map.addLayer({
                        id: layerId, type: 'line', source: srcId,
                        layout: { 'line-cap': 'round', 'line-join': 'round' },
                        paint: { 'line-color': '#ff2d2d', 'line-width': 4 },
                    });
                }
                return;
            }

            // Point / military symbol → a DOM marker (real NATO symbol when SIDC is set).
            const el = document.createElement('div');
            el.setAttribute('data-testid', 'remote-feature-symbol');
            el.setAttribute('data-feature-id', id);
            const sidc = feature.properties.sidc;
            try {
                if (sidc && typeof globalThis.ms !== 'undefined') {
                    el.innerHTML = new globalThis.ms.Symbol(sidc, { size: 34 }).asSVG();
                } else {
                    throw new Error('no milsymbol');
                }
            } catch {
                el.textContent = '✚';
                el.style.cssText = 'font-size:26px;color:#0a7a3f;font-weight:700;text-shadow:0 0 3px #fff';
            }
            new globalThis.maplibregl.Marker({ element: el, anchor: 'center' })
                .setLngLat(feature.geometry.coordinates)
                .addTo(map);
        }

        // Peer's feature creates fan in over the WS broadcast → draw them.
        window.__live.ws.on('operation', (op) => {
            if (op && op.entityType === 'feature' && op.operationType === 'create' && op.data) {
                drawFeature(op.data);
            }
        });

        async function pushFeature(feature) {
            const op = {
                ...createOperation('feature', 'create', feature.properties.id, mapId, feature),
                clientId: selfClientId,
            };
            await window.__live.api.pushOperations(window.__live.atlasId, [op]);
            drawFeature(feature); // author sees its own feature immediately
        }

        window.__demo = { pushFeature };
    }, cfg);
}

/**
 * Animates this page's cursor once around a circle, sending each frame over the
 * real WS so the peer renders the motion live. `dir` flips the orbit direction.
 * @param {import('@playwright/test').Page} page
 * @param {{ center: {lng:number,lat:number}, radius:number, frames:number, delay:number, mapId:string, dir:number }} cfg
 */
function animateCursor(page, cfg) {
    return page.evaluate(async ({ center, radius, frames, delay, mapId, dir }) => {
        for (let i = 0; i < frames; i++) {
            const t = dir * (i / frames) * Math.PI * 2;
            const position = { lng: center.lng + radius * Math.cos(t), lat: center.lat + radius * Math.sin(t) };
            window.__live.ws.sendCursor({ position, mapId });
            await new Promise((r) => setTimeout(r, delay));
        }
    }, cfg);
}

describeOrSkip('Live two-way collaboration on the real map (two real browsers + real backend)', () => {
    test('cursors, a line from A and a military symbol from B all appear on BOTH live maps', async ({ browser }) => {
        // 1. Seed ONE shared user + atlas + map via the backend API.
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const seed = await seedPage.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `live_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Collab Owner' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Live Collab Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'Mapa Tático' })]);
            return { username, password, atlasId: atlas.id, mapId };
        }, state.baseUrl);
        await seedPage.close();

        // 2. Two independent browser contexts → two real app windows.
        const ctxA = await browser.newContext();
        const pageA = await ctxA.newPage();
        const ctxB = await browser.newContext();
        const pageB = await ctxB.newPage();
        for (const page of [pageA, pageB]) {
            await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
            await page.goto('/');
        }

        // 3. Both windows wait for the live 2D map and JUMP TO THE SAME PLACE.
        for (const page of [pageA, pageB]) {
            await expect(page.locator('.maplibregl-canvas')).toBeAttached({ timeout: 20000 });
            await page.waitForFunction(
                () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.jumpTo === 'function' && globalThis.__ebgeoMap.loaded(),
                { timeout: 20000 },
            );
            await page.evaluate(({ c, z }) => globalThis.__ebgeoMap.jumpTo({ center: [c.lng, c.lat], zoom: z }), { c: CENTER, z: ZOOM });
        }

        // 4. Connect both WS clients (same owner, different clientIds).
        const clientIdA = `live-A-${crypto.randomUUID().slice(0, 8)}`;
        const clientIdB = `live-B-${crypto.randomUUID().slice(0, 8)}`;
        const cfg = { baseUrl: state.baseUrl, username: seed.username, password: seed.password, atlasId: seed.atlasId };
        await connectClient(pageA, { ...cfg, clientId: clientIdA });
        await connectClient(pageB, { ...cfg, clientId: clientIdB });

        // 5. Wire both windows: cursor overlay + roster + feature-render feeders.
        await setupClient(pageA, { mapId: seed.mapId, selfClientId: clientIdA, peerClientId: clientIdB, peerName: 'Cliente B (janela 2)' });
        await setupClient(pageB, { mapId: seed.mapId, selfClientId: clientIdB, peerClientId: clientIdA, peerName: 'Cliente A (janela 1)' });

        // 6. BOTH cursors orbit at once (opposite directions). Headed: each window
        //    shows the OTHER's labelled cursor gliding across the same view.
        await Promise.all([
            animateCursor(pageA, { center: CENTER, radius: ORBIT_RADIUS_DEG, frames: FRAMES, delay: FRAME_DELAY_MS, mapId: seed.mapId, dir: 1 }),
            animateCursor(pageB, { center: CENTER, radius: ORBIT_RADIUS_DEG * 0.6, frames: FRAMES, delay: FRAME_DELAY_MS, mapId: seed.mapId, dir: -1 }),
        ]);

        // 7. A draws a LINE; B plants a MILITARY SYMBOL. Each is authored over the
        //    real backend, fans out over the WS, and is drawn on the peer's map.
        const lineId = crypto.randomUUID();
        const symbolId = crypto.randomUUID();
        const lineFeature = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [
                [CENTER.lng - 0.012, CENTER.lat - 0.006],
                [CENTER.lng + 0.004, CENTER.lat + 0.009],
                [CENTER.lng + 0.013, CENTER.lat - 0.002],
            ] },
            properties: { id: lineId, source: 'line', nome: 'Eixo de Progressão', cor: '#ff2d2d' },
        };
        const symbolFeature = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [CENTER.lng + 0.006, CENTER.lat + 0.004] },
            // SFGPUCI = Friend / Ground / Unit / Combat / Infantry (milsymbol 2525C).
            properties: { id: symbolId, source: 'military_symbol', sidc: 'SFGPUCI----', nome: 'Pel Inf' },
        };

        await Promise.all([
            pageA.evaluate((f) => window.__demo.pushFeature(f), lineFeature),
            pageB.evaluate((f) => window.__demo.pushFeature(f), symbolFeature),
        ]);

        // 8. Assert BOTH windows end up showing: the other player's cursor, the line,
        //    the military symbol, and the peer in the roster.
        for (const [page, label] of [[pageA, 'Cliente B'], [pageB, 'Cliente A']]) {
            const cursor = page.locator('[data-testid="remote-cursor"]');
            await expect(cursor).toHaveCount(1, { timeout: 8000 });
            await expect(cursor.locator('.remote-cursor__label')).toContainText(label);

            await expect(page.locator('[data-testid="remote-feature-symbol"]')).toHaveCount(1, { timeout: 8000 });
            await expect(page.locator('#roster-under-test').getByTestId('online-user-item')).toHaveCount(1);

            const hasLine = await page.evaluate((id) => !!globalThis.__ebgeoMap.getLayer(`demo-line-${id}`), lineId);
            expect(hasLine).toBe(true);
        }

        // 9. Clean up.
        await pageA.evaluate(() => window.__live.ws.disconnect());
        await pageB.evaluate(() => window.__live.ws.disconnect());
        await ctxA.close();
        await ctxB.close();
    });
});

// Path: e2e-ui/ws-quadro-grande-em-link-lento.repro.spec.js

/**
 * REPRO: a peer on a slow DOWNLINK never receives a frame that takes longer than the client
 * heartbeat to arrive, and it reconnects in a loop instead.
 *
 * The browser WebSocket API delivers a message only when the whole frame has arrived, and the
 * application `pong` the client waits for travels BEHIND that frame on the same TCP stream. So on
 * a 40 kbps link a 324 KB frame (one detailed feature a colleague imported, or the replay of what
 * the peer missed while offline) keeps `_pongPending` true for about 65 s, and the heartbeat of
 * `store/sync/ws-client.js` closes the socket at its second tick (25 to 50 s). The reconnect asks
 * `sync_request` from the SAME cursor, the server answers with the SAME frame, and the heartbeat
 * cuts it again: forever. Nothing is lost on the server, but that peer never converges.
 *
 * The downlink is simulated at the WebSocket layer (`routeWebSocket`): client-to-server frames
 * pass untouched, and server-to-client frames are delivered IN ORDER at 5000 bytes per second,
 * which is exactly how a saturated TCP stream behaves for the frames queued on it. CDP throttling
 * is not used because it does not reach an established loopback WebSocket in every Chromium.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { collabTest, expect, readFeatures } from './helpers/collab.fixtures.js';
import { realFeature } from '../helpers/real-fixtures.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(360000);

/** 40 kbps, in bytes per second. */
const DOWNLINK_BYTES_PER_S = 5000;

function longTrack(vertices) {
    const coords = [];
    for (let i = 0; i < vertices; i++) {
        coords.push([-43.2 + i * 0.0000123456789, -22.9 + Math.sin(i / 50) * 0.0123456789]);
    }
    return coords;
}

/**
 * Routes every NEW collab socket of `page` through a downlink of `bytesPerS`.
 * @returns {Promise<{ sockets: number, frames: Array<{ at: number, bytes: number, type: string }> }>}
 */
async function slowDownlink(page, bytesPerS, t0) {
    const log = { sockets: 0, frames: [], closes: [] };
    await page.routeWebSocket(/\/api\/v1\/collab/, (ws) => {
        log.sockets++;
        const server = ws.connectToServer();
        let chain = Promise.resolve();
        let busyUntil = 0;
        let open = true;
        ws.onMessage((m) => server.send(m));
        // With a handler installed, Playwright forwards NEITHER side of a close: the page's own
        // close completes only when the route closes it back, which is what fires the page's
        // `onclose` and lets the app reconnect.
        ws.onClose((code, reason) => {
            open = false;
            log.closes.push({ at: Date.now() - t0, by: 'page', code, reason });
            ws.close({ code, reason });
            server.close({ code, reason });
        });
        server.onMessage((m) => {
            const bytes = typeof m === 'string' ? new TextEncoder().encode(m).byteLength : m.length;
            busyUntil = Math.max(busyUntil, Date.now()) + (bytes / bytesPerS) * 1000;
            const due = busyUntil;
            let type = '?';
            try { type = JSON.parse(m).type; } catch { /* binary */ }
            chain = chain.then(async () => {
                await delay(Math.max(0, due - Date.now()));
                if (!open) return;
                log.frames.push({ at: Date.now() - t0, bytes, type });
                try { ws.send(m); } catch { /* page side closed */ }
            });
        });
        server.onClose((code, reason) => {
            chain = chain.then(() => {
                if (!open) return;
                open = false;
                log.closes.push({ at: Date.now() - t0, by: 'server', code, reason });
                ws.close({ code, reason });
            });
        });
    });
    return log;
}

collabTest('um quadro de 324 KB chega ao par em link de 40 kbps sem laço de reconexão', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const t0 = Date.now();
    const log = await slowDownlink(B, DOWNLINK_BYTES_PER_S, t0);

    // The route patches the page's WebSocket at document start, so it takes effect on the next
    // document: B reloads (an F5 on the atlas) and its socket is born behind the slow downlink.
    await B.reload();
    await expect.poll(() => log.sockets, { timeout: 30000 }).toBe(1);
    await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 60000 });
    await expect.poll(() => currentMapKeyIsUuid(B), { timeout: 60000 }).toBe(true);

    const bigId = crypto.randomUUID();
    const big = realFeature('line', { id: bigId, nome: 'Trilha longa' });
    big.geometry.coordinates = longTrack(8000);
    await A.evaluate(async (feature) => {
        const store = await import('/src/js/store/index.js');
        await store.addFeature('lines', feature);
    }, big);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(bigId)), { timeout: 30000 }).toBe(true);

    const onB = async () => (await readFeatures(B, 'lines')).some((f) => f.id === bigId);
    try {
        await expect.poll(onB, { timeout: 240000, intervals: [3000] }).toBe(true);
    } finally {
        const big = log.frames.filter((f) => f.bytes > 100000);
        console.log(`WS_QUADRO_GRANDE sockets=${log.sockets} bigFramesDelivered=${JSON.stringify(big)} closes=${JSON.stringify(log.closes)}`);
    }
    // One reconnection is the price of a frame caught mid-flight; a loop is the defect.
    expect(log.sockets, 'the peer converged without a reconnection loop').toBeLessThanOrEqual(3);
});

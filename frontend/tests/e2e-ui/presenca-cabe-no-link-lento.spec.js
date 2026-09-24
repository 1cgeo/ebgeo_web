// Path: e2e-ui/presenca-cabe-no-link-lento.spec.js

/**
 * The downlink of a peer while 2 and then 3 colleagues move the mouse at 60 Hz, measured on the
 * wire (every server-to-client frame of that peer's collab socket, through `routeWebSocket`).
 *
 * WHY IT IS A GUARD (2026-09-23). Every cursor item reaches every colleague in the room, about
 * 260 bytes each. With the client throttle at 80 ms and the server batch at 100 ms, the measured
 * rate was 6.5 to 7.3 items per second per colleague moving: 3408 B/s with 2 (68% of the 40 kbps
 * military link the product targets) and 5639 B/s with 3 (113%, the link saturated by cursors
 * alone, with operations and the heartbeat pong queued behind them). The origin throttle is now
 * 200 ms (`CURSOR_THROTTLE_MS`, `presence/presence-bridge.js`): 4.8 items per second per mover,
 * 2518 B/s with 2 and 3710 B/s with 3.
 *
 * The bound is on ITEMS per second per mover, not on bytes, because it is the rate that the
 * throttle decides; the lower bound keeps the guard from passing on a cursor that stopped moving.
 * The mouse is driven by `map.fire('mousemove')` at 60 Hz inside each page, so the input rate
 * does not depend on how fast the test process can call Playwright.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { collabTest, expect } from './helpers/collab.fixtures.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';

collabTest.use({ collabOptions: { peers: 3, permission: 'write' } });
collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(240000);

/** Fires map mousemove at 60 Hz inside the page for `ms`, like a hand on a mouse. */
function wiggle(page, ms, phase) {
    return page.evaluate(({ ms, phase }) => new Promise((resolve) => {
        const map = globalThis.__ebgeoMap;
        const c = map.getCenter();
        let i = 0;
        const timer = setInterval(() => {
            i += 1;
            map.fire('mousemove', { lngLat: { lng: c.lng + Math.cos((i + phase) / 20) * 0.01, lat: c.lat + Math.sin((i + phase) / 20) * 0.01 } });
        }, 1000 / 60);
        setTimeout(() => { clearInterval(timer); resolve(i); }, ms);
    }), { ms, phase });
}

collabTest('presença: no máximo 5 itens de cursor por segundo por colega, com 2 e 3 colegas', async ({ collab }) => {
    const [A, B, C, D] = [collab.author, ...collab.peers];
    const t0 = Date.now();
    const frames = [];
    await B.routeWebSocket(/\/api\/v1\/collab/, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((m) => server.send(m));
        server.onMessage((m) => {
            let type = '?';
            let items = 0;
            try { const o = JSON.parse(m); type = o.type; items = o.lote?.length ?? 0; } catch { /* binary */ }
            frames.push({ at: Date.now() - t0, bytes: new TextEncoder().encode(m).byteLength, type, items });
            ws.send(m);
        });
        ws.onClose((code, reason) => { ws.close({ code, reason }); server.close({ code, reason }); });
        server.onClose((code, reason) => ws.close({ code, reason }));
    });
    // The route takes effect on the next document: B reloads onto it.
    await B.reload();
    await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 60000 });
    await expect.poll(() => currentMapKeyIsUuid(B), { timeout: 60000 }).toBe(true);
    await delay(3000);

    const measure = async (movers) => {
        const start = Date.now() - t0;
        await Promise.all(movers.map((p, k) => wiggle(p, 10000, k * 7)));
        const end = Date.now() - t0;
        await delay(500);
        const win = frames.filter((f) => f.at >= start && f.at <= end && f.type === 'cursors');
        const seconds = (end - start) / 1000;
        const bytes = win.reduce((s, f) => s + f.bytes, 0);
        const items = win.reduce((s, f) => s + f.items, 0);
        const result = {
            movers: movers.length, seconds: Number(seconds.toFixed(1)), frames: win.length, items,
            bytesPerS: Math.round(bytes / seconds),
            itemsPerSPerMover: Number((items / seconds / movers.length).toFixed(2)),
        };
        console.log(`PRESENCA_NO_LINK ${JSON.stringify(result)}`);
        await delay(1500);
        return result;
    };
    const two = await measure([A, C]);
    const three = await measure([A, C, D]);
    for (const r of [two, three]) {
        expect(r.itemsPerSPerMover, `${r.movers} colegas: taxa por colega`).toBeLessThanOrEqual(5.5);
        expect(r.itemsPerSPerMover, `${r.movers} colegas: o cursor continua andando`).toBeGreaterThanOrEqual(3);
    }
});

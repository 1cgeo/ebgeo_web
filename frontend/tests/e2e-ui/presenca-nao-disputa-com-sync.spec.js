// Path: e2e-ui/presenca-nao-disputa-com-sync.spec.js

/**
 * On a 40 kbps link, the presence of three colleagues moving the mouse must not compete with the
 * edits: measured on the wire of the slow peer, with the throttle IN THE BROWSER (CDP), which is
 * the only instrument that also delays the protocol pong the server's flow control reads.
 *
 * WHY NOT `routeWebSocket`. Playwright's WebSocket route proxies the socket from the test process,
 * so the server talks to the proxy and the proxy answers every protocol ping at once: the server
 * would see a fast link no matter how slowly the frames reach the page. CDP throttles the socket
 * inside the browser, so the ping reaches the browser behind every byte queued before it, exactly
 * like on a real slow link behind nginx.
 *
 * WHAT IS MEASURED, on the slow peer B while A, C and D move the mouse at 60 Hz:
 *   - the presence bytes per second B receives (`cursors`, `cursor`, `selection` frames);
 *   - the latency of an edit of A reaching B, from A's push answer to the frame on B's socket;
 *   - the same latency at C, a fast peer, which a slow B must not delay.
 *
 * MEASURED ON 2026-09-24 (CDP at 5000 B/s and 150 ms, which delivers about 3.2 KB/s in practice:
 * the throttle is shared by every connection of the page). BEFORE the per-recipient flow control
 * (`backend/src/modules/collab/collab.fluxo.js`, or today with `WS_PRESENCE_FLOW=0`): presence
 * 3090 B/s, 62% of the nominal link and all of the effective one, and the four edits reached B
 * 1.3, 2.2, 3.4 and 4.9 s late, growing, because the queue behind the cursors never drained. AFTER:
 * presence 1856 B/s, and the edits reached B in 0.03 to 0.6 s. C, fast, got every edit at once in
 * both runs.
 */

import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { collabTest, expect } from './helpers/collab.fixtures.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';
import { realFeature } from '../helpers/real-fixtures.js';

collabTest.use({ collabOptions: { peers: 3, permission: 'write' } });
collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(300000);

/** 40 kbps, the link named in the mission, in bytes per second. */
const LINK_BYTES_PER_S = 5000;
/** Presence frame types, the ones the server may coalesce. */
const PRESENCE_TYPES = new Set(['cursors', 'cursor', 'selection']);

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

/**
 * Records every server-to-client frame of the page's sockets through CDP.
 * @returns {Promise<Array<{at: number, bytes: number, type: string, text: string}>>}
 */
async function recordFrames(page, t0) {
    const frames = [];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.webSocketFrameReceived', ({ response }) => {
        const text = String(response?.payloadData ?? '');
        let type = '?';
        try { type = JSON.parse(text).type; } catch { /* binary or partial */ }
        frames.push({ at: Date.now() - t0, bytes: Buffer.byteLength(text, 'utf8'), type, text });
    });
    return { frames, cdp };
}

/** Median of a numeric array. */
function median(values) {
    const s = [...values].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

collabTest('presença de 3 colegas não atrasa a edição que chega ao par em link de 40 kbps', async ({ collab, browserName }) => {
    collabTest.skip(browserName !== 'chromium', 'the throttle is CDP (Chromium only)');
    const [A, B, C, D] = [collab.author, ...collab.peers];
    const t0 = Date.now();
    const backend = new URL(collab.baseUrl);

    const onB = await recordFrames(B, t0);
    const onC = await recordFrames(C, t0);
    await onB.cdp.send('Network.emulateNetworkConditionsByRule', {
        matchedNetworkConditions: [{
            // `*://` covers the HTTP routes AND the collab socket of the backend, and nothing else:
            // the app itself (Vite) and the basemap load at full speed.
            urlPattern: `*://${backend.host}/*`,
            latency: 150, downloadThroughput: LINK_BYTES_PER_S, uploadThroughput: LINK_BYTES_PER_S,
        }],
    });
    // The throttle binds to connections opened after it: B reloads onto it.
    await B.reload();
    await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 120000 });
    await expect.poll(() => currentMapKeyIsUuid(B), { timeout: 120000 }).toBe(true);
    await delay(3000);

    /** One edit of A: creates a point and times its arrival on B and on C. */
    const edit = async (label) => {
        const id = crypto.randomUUID();
        const pushed = A.waitForResponse((r) => r.request().method() === 'POST'
            && /\/sync$/.test(new URL(r.url()).pathname)
            && (r.request().postData() ?? '').includes(id), { timeout: 60000 });
        await A.evaluate(async (feature) => {
            const store = await import('/src/js/store/index.js');
            await store.addFeature('points', feature);
        }, realFeature('point', { id, nome: label }));
        await pushed;
        const pushedAt = Date.now() - t0;
        const arrival = async (rec) => {
            await expect.poll(() => rec.frames.some((f) => f.at >= pushedAt - 50 && f.text.includes(id)), { timeout: 120000, intervals: [50] }).toBe(true);
            return rec.frames.find((f) => f.text.includes(id)).at - pushedAt;
        };
        const [b, c] = await Promise.all([arrival(onB), arrival(onC)]);
        return { b, c };
    };

    // Baseline: nobody moves.
    const idle = [];
    for (let i = 0; i < 3; i++) {
        idle.push(await edit(`parado ${i}`));
        await delay(1000);
    }

    // Three colleagues move the mouse for 30 s; A edits every ~5 s meanwhile.
    const start = Date.now() - t0;
    const moving = Promise.all([A, C, D].map((p, k) => wiggle(p, 30000, k * 7)));
    await delay(4000);
    const busy = [];
    for (let i = 0; i < 4; i++) {
        busy.push(await edit(`movendo ${i}`));
        await delay(3000);
    }
    await moving;
    const end = Date.now() - t0;

    const win = onB.frames.filter((f) => f.at >= start && f.at <= end && PRESENCE_TYPES.has(f.type));
    const seconds = (end - start) / 1000;
    const presenceBytes = win.reduce((s, f) => s + f.bytes, 0);
    const result = {
        seconds: Number(seconds.toFixed(1)),
        presenceFrames: win.length,
        presenceBytesPerS: Math.round(presenceBytes / seconds),
        linkShare: Number((presenceBytes / seconds / LINK_BYTES_PER_S).toFixed(2)),
        idleLatencyB: idle.map((e) => e.b),
        busyLatencyB: busy.map((e) => e.b),
        busyLatencyC: busy.map((e) => e.c),
        medianBusyB: median(busy.map((e) => e.b)),
        maxBusyB: Math.max(...busy.map((e) => e.b)),
    };
    console.log(`PRESENCA_X_SYNC ${JSON.stringify(result)}`);

    // Presence keeps flowing (the cursor still moves on B), but it no longer fills the link, and
    // an edit waits behind at most one presence flush instead of behind a growing queue.
    expect(result.presenceFrames, 'o cursor dos colegas continua chegando a B').toBeGreaterThan(20);
    expect(result.linkShare, 'a presença não ocupa mais da metade do link').toBeLessThanOrEqual(0.5);
    expect(result.maxBusyB, 'a edição chega ao par lento em até 1,5 s com três colegas movendo o mouse').toBeLessThanOrEqual(1500);
    expect(Math.max(...result.busyLatencyC), 'o par rápido não é atrasado pelo lento').toBeLessThanOrEqual(1000);
});

// Path: e2e-ui/push-em-link-lento.repro.spec.js

/**
 * REPRO: on a slow link, a push whose BODY takes longer than the fixed deadline to go up never
 * reaches the server, and it holds the whole outbound queue behind it.
 *
 * The link is the one the product is going to run on: a military network at 40 kbps. The push
 * (`pushOperations`, `store/sync/api-client.js`) carried a FIXED 30 s deadline, so any batch
 * above roughly 150 KB at that rate was aborted mid-upload on every attempt, the server never saw
 * it, and the next attempt re-sent the SAME batch (the queue re-peeks the head). A single large
 * gesture (an imported file, a long track, a detailed polygon) therefore froze every later edit
 * of that person in that atlas, forever, while the only word on screen was "your changes are not
 * reaching the server".
 *
 * The throttle is real (CDP, Chromium only), restricted to the backend origin so the basemap
 * still loads, and measured: the spec records every POST /sync of the peer with its body size and
 * its outcome, and prints them, so a red run says how many attempts were cut and at what second.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { collabTest, expect, readFeatures } from './helpers/collab.fixtures.js';
import { realFeature } from '../helpers/real-fixtures.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(300000);

/** 40 kbps, the link named in the mission, in bytes per second. */
const LINK_BYTES_PER_S = 5000;

/** A track long enough that its create envelope needs well over 30 s at {@link LINK_BYTES_PER_S}. */
function longTrack(vertices) {
    const coords = [];
    for (let i = 0; i < vertices; i++) {
        coords.push([-43.2 + i * 0.0000123456789, -22.9 + Math.sin(i / 50) * 0.0123456789]);
    }
    return coords;
}

collabTest('um lote grande em link de 40 kbps chega ao servidor, e a edição seguinte também', async ({ collab, browserName }) => {
    collabTest.skip(browserName !== 'chromium', 'the throttle is CDP (Chromium only)');
    const B = collab.peers[0];
    const syncUrl = `${collab.baseUrl}/api/v1/atlas/${collab.atlasId}/sync`;

    const attempts = [];
    const t0 = Date.now();
    B.on('request', (req) => {
        if (req.method() !== 'POST' || req.url() !== syncUrl) return;
        const entry = { at: Date.now() - t0, bytes: req.postDataBuffer()?.byteLength ?? 0, outcome: 'pending' };
        attempts.push(entry);
        req.response().then(async (res) => {
            entry.outcome = res ? `status ${res.status()} at ${Date.now() - t0}` : 'no response';
            const results = res ? (await res.json().catch(() => null))?.data?.results ?? [] : [];
            entry.results = results.map((r) => ({ status: r.status, rejected: r.rejected, reason: r.reason }));
        }).catch(() => { /* reported by requestfailed */ });
    });
    B.on('requestfailed', (req) => {
        if (req.method() !== 'POST' || req.url() !== syncUrl) return;
        const entry = [...attempts].reverse().find((a) => a.outcome === 'pending');
        if (entry) entry.outcome = `failed (${req.failure()?.errorText}) at ${Date.now() - t0}`;
    });

    const cdp = await B.context().newCDPSession(B);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditionsByRule', {
        matchedNetworkConditions: [{
            urlPattern: `${collab.baseUrl}/*`,
            latency: 300, downloadThroughput: LINK_BYTES_PER_S, uploadThroughput: LINK_BYTES_PER_S,
        }],
    });

    const bigId = crypto.randomUUID();
    const smallId = crypto.randomUUID();
    try {
        const big = realFeature('line', { id: bigId, nome: 'Trilha longa' });
        big.geometry.coordinates = longTrack(8000);
        await B.evaluate(async (feature) => {
            const store = await import('/src/js/store/index.js');
            await store.addFeature('lines', feature);
        }, big);

        // The first attempt must actually be the big one, or the measurement below is about
        // something else.
        await expect.poll(() => attempts.length, { timeout: 20000 }).toBeGreaterThan(0);
        expect(attempts[0].bytes, 'the pushed body is large enough to need more than 30 s').toBeGreaterThan(LINK_BYTES_PER_S * 40);

        // A small edit made AFTER the big one: it queues behind it.
        await B.evaluate(async (feature) => {
            const store = await import('/src/js/store/index.js');
            await store.addFeature('lines', feature);
        }, realFeature('line', { id: smallId, nome: 'Depois' }));

        const neededS = Math.ceil(attempts[0].bytes / LINK_BYTES_PER_S);
        const onServer = async (id) => Boolean(await collab.db.queryFeatureRow(id).catch(() => null));
        try {
            await expect.poll(() => onServer(bigId), { timeout: (neededS + 60) * 1000, intervals: [2000] }).toBe(true);
            await expect.poll(() => onServer(smallId), { timeout: 60000, intervals: [2000] }).toBe(true);
        } finally {
            console.log(`PUSH_EM_LINK_LENTO needed~${neededS}s attempts=${JSON.stringify(attempts)}`);
        }

        // And the peer on a normal link sees both.
        await expect.poll(async () => {
            const ids = new Set((await readFeatures(collab.author, 'lines')).map((f) => f.id));
            return [ids.has(bigId), ids.has(smallId)];
        }, { timeout: 30000 }).toEqual([true, true]);
    } finally {
        await cdp.send('Network.emulateNetworkConditionsByRule', { matchedNetworkConditions: [] }).catch(() => {});
        await cdp.detach().catch(() => {});
        await delay(0);
    }
});

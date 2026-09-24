// Path: e2e-ui/retrato-em-link-lento.repro.spec.js

/**
 * REPRO: on a slow downlink, an atlas whose snapshot takes longer than the fixed pull deadline
 * to arrive can never be opened.
 *
 * `pullSync` (`store/sync/api-client.js`) carries a 180 s deadline over the WHOLE request, body
 * included. The snapshot is compressed by the server, but at 40 kbps 180 s is about 900 KB of
 * compressed body: a person joining an atlas whose content is larger than that on the military
 * link gets a timeout on every attempt, and the open never completes. The data keeps flowing the
 * whole time, which is what separates this from a server that stopped answering.
 *
 * The throttle is real (CDP, Chromium only), restricted to the backend origin, and set BEFORE the
 * slow client boots, so the snapshot of its first open is what crosses it.
 */

import { collabTest, expect, readFeatures } from './helpers/collab.fixtures.js';
import { loginUI, openAtlasUI } from './helpers/collab-helpers.js';
import { realFeature } from '../helpers/real-fixtures.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(600000);

/** 40 kbps, in bytes per second. */
const LINK_BYTES_PER_S = 5000;

/** Pseudo-random but reproducible coordinates, which compress about as badly as real surveys. */
function randomTrack(seed, vertices) {
    let x = seed;
    const next = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
    const coords = [];
    for (let i = 0; i < vertices; i++) coords.push([-44 + next(), -23 + next()]);
    return coords;
}

collabTest('um atlas cujo retrato leva mais de 180 s em 40 kbps abre mesmo assim', async ({ collab, browser, browserName }) => {
    collabTest.skip(browserName !== 'chromium', 'the throttle is CDP (Chromium only)');
    const A = collab.author;

    // 1) A fills the atlas: ~5.4 MB of feature geometry (measured: about 195 s to cross 40 kbps once
    // compressed, past the old 180 s deadline), pushed in batches through the app's own
    // transport so it is ordinary sync content.
    const ids = await A.evaluate(async ({ features, mapId, atlasId }) => {
        const { apiClient } = await import('/src/js/store/sync/api-client.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
        const out = [];
        for (let i = 0; i < features.length; i += 10) {
            const ops = features.slice(i, i + 10).map((f) => createOperation('feature', 'create', f.properties.id, mapId, f));
            const res = await apiClient.pushOperations(atlasId, ops);
            const bad = (res.results ?? []).filter((r) => r.rejected === true || r.success === false);
            if (bad.length) throw new Error(`seed refused: ${JSON.stringify(bad[0])}`);
            out.push(...ops.map((op) => op.entityId));
        }
        return { out, mapId, atlasId };
    }, {
        mapId: collab.mapId, atlasId: collab.atlasId,
        features: Array.from({ length: 130 }, (_, i) => {
            const f = realFeature('line', { id: crypto.randomUUID(), nome: `Levantamento ${i}` });
            f.geometry.coordinates = randomTrack(i + 1, 1000);
            return f;
        }),
    });
    expect(ids.mapId, 'the author is on the atlas map').toBeTruthy();
    expect(ids.out).toHaveLength(130);

    // 2) A new client joins over the slow link.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${collab.baseUrl}/api/v1`);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await page.goto('/');
    await loginUI(page, collab.userB.username, collab.userB.password);

    const t0 = Date.now();
    const pulls = [];
    page.on('request', (req) => {
        if (!/\/api\/v1\/atlas\/[^/]+\/sync\/\d+$/.test(req.url())) return;
        const entry = { url: req.url().replace(/.*\/sync\//, 'sync/'), at: Date.now() - t0, outcome: 'pending' };
        pulls.push(entry);
        req.response().then(async (res) => {
            const body = res ? await res.body().catch(() => null) : null;
            entry.outcome = res ? `status ${res.status()} at ${Date.now() - t0}` : 'no response';
            entry.wireBytes = Number(res?.headers()['content-length'] ?? 0) || null;
            entry.bodyBytes = body?.byteLength ?? null;
        }).catch(() => {});
    });
    page.on('requestfailed', (req) => {
        const entry = [...pulls].reverse().find((p) => p.outcome === 'pending' && req.url().endsWith(p.url));
        if (entry) entry.outcome = `failed (${req.failure()?.errorText}) at ${Date.now() - t0}`;
    });
    await cdp.send('Network.emulateNetworkConditionsByRule', {
        matchedNetworkConditions: [{
            urlPattern: `${collab.baseUrl}/api/v1/atlas/*`,
            latency: 300, downloadThroughput: LINK_BYTES_PER_S, uploadThroughput: LINK_BYTES_PER_S,
        }],
    });
    try {
        await openAtlasUI(page, collab.atlasId).catch((e) => { pulls.push({ openAtlasUI: String(e).slice(0, 200) }); });
        await expect.poll(async () => (await readFeatures(page, 'lines')).filter((f) => ids.out.includes(f.id)).length,
            { timeout: 420000, intervals: [5000] }).toBe(130);
    } finally {
        console.log(`RETRATO_EM_LINK_LENTO pulls=${JSON.stringify(pulls)}`);
        await cdp.send('Network.emulateNetworkConditionsByRule', { matchedNetworkConditions: [] }).catch(() => {});
        await ctx.close().catch(() => {});
    }
});

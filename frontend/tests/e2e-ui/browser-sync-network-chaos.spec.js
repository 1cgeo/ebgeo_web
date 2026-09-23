// Path: e2e-ui/browser-sync-network-chaos.spec.js
import { setTimeout as delay } from 'node:timers/promises';
import { collabTest, expect, drawLineUI } from './helpers/collab.fixtures.js';

collabTest.setTimeout(180000);
const coordinates = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];
async function draw(page) {
    const locallyCreated = () => page.evaluate(() => window.__ebgeoSyncTrace.get(span =>
        span.stage === 'enqueue' && span.entityType === 'feature' && span.operationType === 'create')
        .map(span => span.entityId));
    const before = new Set(await locallyCreated());
    // Under latency a peer's creation can land during our gesture. The generic UI driver
    // returns the first new visible feature, which need not be the one THIS client drew.
    await drawLineUI(page, coordinates);
    let created;
    await expect.poll(async () => {
        created = [...new Set((await locallyCreated()).filter(id => !before.has(id)))];
        return created.length;
    }).toBe(1);
    return created[0];
}

async function pending(page) {
    return page.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return { ops: await operationQueue.getAll(), issues: await operationQueue.getIssues() };
    });
}

async function durable(page, mapId) {
    return page.evaluate(async id => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const map = await getRepository().getMap(id);
        return (map?.features?.lines ?? []).map(f => ({
            id: f.properties.id, color: f.properties.lineColor ?? null, geometry: f.geometry,
        })).sort((a, b) => a.id.localeCompare(b.id));
    }, mapId);
}

async function disconnectLink(page) {
    await page.context().setOffline(true);
    // Chromium's HTTP offline emulation can leave an existing loopback WebSocket alive.
    // Explicitly break that stream as well; retain the application's normal reconnect logic.
    await page.evaluate(async () => {
        const { wsClient } = await import('/src/js/store/sync/ws-client.js');
        wsClient._socket?.close(4000, 'network fault injection');
    });
}

async function observe(page) {
    await page.evaluate(async () => {
        const { connectionState } = await import('/src/js/store/sync/connection-state.js');
        window.__networkTransitions = [];
        connectionState.onStateChanged(event => window.__networkTransitions.push({
            from: event.previousState, to: event.currentState, at: Date.now(),
        }));
    });
}

async function verify(collab, ids, info, metrics = {}) {
    const started = Date.now();
    for (const page of collab.pages) {
        await expect.poll(async () => (await pending(page)).ops.length, { timeout: 60000 }).toBe(0);
        expect((await pending(page)).issues).toEqual([]);
    }
    const rows = await collab.db.raw.any(
        'SELECT id, properties, geometry FROM features WHERE map_id = $1 AND deleted_at IS NULL', [collab.mapId]);
    const expected = rows.map(row => ({ id: row.id, color: row.properties.lineColor ?? null, geometry: row.geometry }))
        .sort((a, b) => a.id.localeCompare(b.id));
    expect(expected.map(row => row.id).sort()).toEqual([...ids].sort());
    for (const page of collab.pages) {
        await expect.poll(() => durable(page, collab.mapId), { timeout: 60000 }).toEqual(expected);
    }
    const duplicates = await collab.db.raw.any(`SELECT op_id FROM operations WHERE atlas_id = $1
        GROUP BY op_id HAVING COUNT(*) > 1`, [collab.atlasId]);
    expect(duplicates).toEqual([]);
    const transitions = await collab.peers[0].evaluate(() => window.__networkTransitions ?? []);
    const result = { ...metrics, convergenceMs: Date.now() - started, features: expected.length,
        queuesEmpty: true, durableClientsEqualServer: true, duplicateOperations: duplicates.length, transitions };
    await info.attach('network-simulation.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    console.log(`NETWORK_SIMULATION ${JSON.stringify(result)}`);
    return expected;
}

collabTest('30 seconds offline preserves creates, an edit and a deletion in both directions', async ({ collab }, info) => {
    const A = collab.author;
    const B = collab.peers[0];
    const warm = await draw(A);
    const deleted = await draw(A);
    await collab.expectFullSync({ entityId: deleted, type: 'lines', operationType: 'create' });
    await observe(B);
    const offlineAt = Date.now();
    await disconnectLink(B);
    try {
        const mine = [await draw(B), await draw(B), await draw(B)];
        await B.evaluate(async ({ warm, deleted }) => {
            const store = await import('/src/js/store/index.js');
            await store.updateFeatureProperty('lines', warm, 'lineColor', '#123456');
            await store.removeFeature('lines', deleted);
        }, { warm, deleted });
        const theirs = [await draw(A), await draw(A)];
        expect((await pending(B)).ops.length).toBeGreaterThanOrEqual(5);
        expect((await durable(B, collab.mapId)).map(f => f.id)).not.toContain(theirs[0]);
        await delay(Math.max(0, 30000 - (Date.now() - offlineAt)));
        await B.context().setOffline(false);
        const expected = await verify(collab, [warm, ...mine, ...theirs], info, { profile: 'offline', offlineMs: 30000 });
        expect(expected.find(f => f.id === warm).color).toBe('#123456');
        expect((await collab.db.queryFeatureRow(deleted)).deleted_at).not.toBeNull();
        await B.reload();
        await expect.poll(() => durable(B, collab.mapId), { timeout: 30000 }).toEqual(expected);
    } finally {
        await B.context().setOffline(false);
    }
});

collabTest('five short disconnect/reconnect cycles preserve all edits', async ({ collab }, info) => {
    const A = collab.author;
    const B = collab.peers[0];
    const ids = [await draw(A)];
    await collab.expectFullSync({ entityId: ids[0], type: 'lines', operationType: 'create' });
    await observe(B);
    try {
        for (let cycle = 0; cycle < 5; cycle++) {
            await disconnectLink(B);
            ids.push(await draw(B));
            ids.push(await draw(A));
            await delay(2000);
            await B.context().setOffline(false);
            await delay(1200);
        }
        await verify(collab, ids, info, { profile: 'intermittent', cycles: 5, offlineHoldMs: 2000, onlineHoldMs: 1200 });
    } finally {
        await B.context().setOffline(false);
    }
});

collabTest('slow network and delayed receipts preserve edits made while a push is in flight', async ({ collab, browserName }, info) => {
    const A = collab.author;
    const B = collab.peers[0];
    const ids = [await draw(A)];
    await collab.expectFullSync({ entityId: ids[0], type: 'lines', operationType: 'create' });
    ids.push(await draw(B));
    await collab.expectFullSyncFrom(B, { entityId: ids[1], type: 'lines', operationType: 'create' });
    const cdp = browserName === 'chromium' ? await B.context().newCDPSession(B) : null;
    const url = `**/api/v1/atlas/${collab.atlasId}/sync`;
    let delayed = 0;
    await B.route(url, async route => {
        if (!cdp) {
            const bytes = route.request().postDataBuffer()?.byteLength ?? 0;
            await delay(1000 + Math.ceil(bytes / 16384 * 1000));
        }
        const response = await route.fetch();
        const body = !cdp ? await response.body() : undefined;
        delayed++;
        await delay(4000 + (body ? Math.ceil(body.byteLength / 32768 * 1000) : 0));
        await route.fulfill({ response, ...(body ? { body } : {}) });
    });
    try {
        await cdp?.send('Network.enable');
        // Restrict the measured link to the backend. Slowing unrelated basemap tiles
        // prevents the UI driver's isStyleLoaded readiness condition from completing.
        await cdp?.send('Network.emulateNetworkConditionsByRule', {
            matchedNetworkConditions: [{ urlPattern: `${collab.baseUrl}/*`,
                latency: 1000, downloadThroughput: 32768, uploadThroughput: 16384 }],
        });
        for (let i = 0; i < 4; i++) {
            ids.push(await draw(B));
            ids.push(await draw(A));
        }
        await verify(collab, ids, info, { profile: 'slow',
            link: cdp ? 'backend HTTP via CDP' : 'sync HTTP request/response delays', latencyMs: 1000,
            downloadBytesPerSecond: 32768, uploadBytesPerSecond: 16384, receiptDelayMs: 4000 });
        expect(delayed).toBeGreaterThan(0);
    } finally {
        await cdp?.send('Network.emulateNetworkConditionsByRule', { matchedNetworkConditions: [] });
        await B.unroute(url);
        await cdp?.detach();
    }
});

collabTest('a receipt held beyond the 30 second timeout is retried without duplicating data', async ({ collab }, info) => {
    const A = collab.author;
    const B = collab.peers[0];
    const warm = await draw(A);
    await collab.expectFullSync({ entityId: warm, type: 'lines', operationType: 'create' });
    const url = `**/api/v1/atlas/${collab.atlasId}/sync`;
    const attempts = [];
    let firstCommitted;
    const committed = new Promise(resolve => { firstCommitted = resolve; });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await B.route(url, async route => {
        attempts.push({ at: Date.now(), ids: route.request().postDataJSON().operations.map(op => op.id) });
        if (attempts.length !== 1) return route.continue();
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        firstCommitted();
        await held;
        await route.fulfill({ response });
    });
    try {
        const mine = await draw(B);
        await committed;
        expect((await pending(B)).ops.length).toBeGreaterThan(0);
        const later = await draw(B);
        await expect.poll(() => attempts.length, { timeout: 50000 }).toBeGreaterThanOrEqual(2);
        expect(attempts[1].at - attempts[0].at).toBeGreaterThanOrEqual(29000);
        release();
        await verify(collab, [warm, mine, later], info, { profile: 'timeout', attempts });
        expect(await collab.db.queryOperationsByEntity(mine)).toHaveLength(1);
    } finally {
        release();
        await B.unroute(url);
    }
});

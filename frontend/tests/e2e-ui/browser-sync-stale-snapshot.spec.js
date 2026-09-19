// Path: e2e-ui/browser-sync-stale-snapshot.spec.js
import { collabTest, expect, drawLineUI, readFeatures } from './helpers/collab.fixtures.js';
import { readIdbEntity } from './helpers/idb.js';

collabTest('a committed edit whose HTTP receipt is lost is retried with the same identity', async ({ collab }) => {
    const A = collab.author;
    let committed;
    const serverCommitted = new Promise(resolve => { committed = resolve; });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const attempts = [];
    const url = `**/api/v1/atlas/${collab.atlasId}/sync`;
    await A.route(url, async route => {
        const operations = route.request().postDataJSON().operations;
        attempts.push(operations.map(op => op.id));
        if (attempts.length === 1) {
            const response = await route.fetch();
            expect(response.ok()).toBe(true);
            await route.abort('timedout');
            committed(operations[0].id);
        } else {
            await held;
            await route.continue();
        }
    });
    const pendingIds = () => A.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.getAll()).map(op => op.id);
    });
    try {
        const feature = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
        const operationId = await serverCommitted;
        expect(await pendingIds()).toContain(operationId);
        expect((await collab.db.queryOperation(operationId)).entity_id).toBe(feature);
        release();
        await expect.poll(pendingIds, { timeout: 20000 }).not.toContain(operationId);
        expect(attempts.length).toBeGreaterThanOrEqual(2);
        expect(attempts.every(ids => ids.includes(operationId))).toBe(true);
        expect(await collab.db.queryOperationsByEntity(feature)).toHaveLength(1);
        await expect.poll(async () => (await readFeatures(collab.peers[0], 'lines'))
            .some(item => item.id === feature)).toBe(true);
    } finally {
        release();
        await A.unroute(url);
    }
});

collabTest('a delayed HTTP snapshot cannot erase a newer WebSocket edit', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const coordinates = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];
    const warm = await drawLineUI(A, coordinates);
    await collab.expectFullSync({ entityId: warm, type: 'lines', operationType: 'create' });

    let captured;
    const snapshotCaptured = new Promise(resolve => { captured = resolve; });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let requests = 0;
    const url = `**/api/v1/atlas/${collab.atlasId}/sync/0*`;
    await B.route(url, async route => {
        requests++;
        if (requests !== 1) return route.continue();
        const response = await route.fetch();
        captured();
        await held;
        await route.fulfill({ response });
    });
    try {
        await B.evaluate(async () => {
            const { syncEngine } = await import('/src/js/store/sync/sync-engine.js');
            window.__syncEdgeRecovery = { done: false, error: null };
            syncEngine.resync().then(() => { window.__syncEdgeRecovery.done = true; }, error => {
                window.__syncEdgeRecovery = { done: true, error: error.message };
            });
        });
        await snapshotCaptured;
        const fresh = await drawLineUI(A, coordinates);
        await collab.expectFullSync({ entityId: fresh, type: 'lines', operationType: 'create' });
        release();
        await B.waitForFunction(() => window.__syncEdgeRecovery.done);
        expect(await B.evaluate(() => window.__syncEdgeRecovery.error)).toBeNull();
        expect(requests).toBe(2);
        expect((await readFeatures(B, 'lines')).some(feature => feature.id === fresh)).toBe(true);
        expect((await readIdbEntity(B, {
            entityId: fresh, entityType: 'feature', mapId: collab.mapId, storage: 'lines',
        })).found).toBe(true);
    } finally {
        release();
        await B.unroute(url);
    }
});

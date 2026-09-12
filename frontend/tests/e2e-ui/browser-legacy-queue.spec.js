import { collabTest, expect, drawPointUI, readFeatures } from './helpers/collab.fixtures.js';
import { expectFullSync } from './helpers/full-chain.js';

collabTest.use({ collabOptions: { peers: 1, permission: 'write' } });

collabTest('old intentions survive F5 without replaying over the server', async ({ collab }, testInfo) => {
    const A = collab.author;
    const pointId = await drawPointUI(A, [-43.2, -22.9]);
    await expectFullSync(collab, { entityId: pointId, type: 'points', operationType: 'create' });
    const original = await collab.db.raw.one('SELECT properties, version FROM features WHERE id=$1', [pointId]);
    await A.context().setOffline(true);
    const old = await A.evaluate(async ({ pointId, mapId }) => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        const { getActiveScope } = await import('/src/js/store/atlas-namespace.js');
        const op = { id: crypto.randomUUID(), entityType: 'feature', operationType: 'update',
            entityId: pointId, mapId, timestamp: 1, clientId: 'ancient-browser',
            scopeSuffix: getActiveScope().dbSuffix, data: { properties: { name: 'NÃO REAPLICAR' } } };
        await operationQueue.enqueue(op);
        return op;
    }, { pointId, mapId: collab.mapId });
    await A.context().setOffline(false);
    const lookup = A.waitForResponse(response => response.url().endsWith('/sync/receipts') && response.status() === 200);
    await A.reload();
    await lookup;
    await expect(A.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 25000 });
    const pending = await A.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return { all: await operationQueue.getAll(), ready: await operationQueue.peek(), issues: await operationQueue.getIssues() };
    });
    expect(pending.all.find(op => op.id === old.id)).toEqual(old);
    expect(pending.ready.some(op => op.id === old.id)).toBe(false);
    expect(pending.issues.find(issue => issue.operation.id === old.id)?.result.code).toBe('SYNC_PROTOCOL_REVIEW');
    const current = await collab.db.raw.one('SELECT properties, version FROM features WHERE id=$1', [pointId]);
    expect(current).toEqual(original);
    expect(await collab.db.raw.any('SELECT op_id FROM operations WHERE atlas_id=$1 AND op_id=$2', [collab.atlasId, old.id])).toEqual([]);
    await expect.poll(async () => (await readFeatures(A, 'points')).some(point => point.id === pointId)).toBe(true);
    const visible = (await readFeatures(A, 'points')).find(point => point.id === pointId);
    expect(visible.props.name).toBe(original.properties.name);
    await A.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 14 }));
    await A.screenshot({ path: testInfo.outputPath('fila-antiga-preservada.png') });
});

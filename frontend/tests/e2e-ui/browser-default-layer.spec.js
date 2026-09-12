import { collabTest, expect, drawPointUI } from './helpers/collab.fixtures.js';
import { expectFullSync } from './helpers/full-chain.js';

const storeOp = (page, name, ...args) => page.evaluate(async ({ name, args }) => {
    const store = await import('/src/js/store/index.js');
    return store[name](...args);
}, { name, args });

collabTest.use({ collabOptions: { peers: 1, permission: 'write' } });

collabTest('server layers survive map creation, offline reconnect and last-layer replacement', async ({ collab }, testInfo) => {
    const A = collab.author;
    const B = collab.peers[0];
    const [initial] = await storeOp(A, 'getLayersRepo', collab.mapName);
    expect(initial.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await storeOp(B, 'getLayersRepo', collab.mapName))[0].id).toBe(initial.id);

    const created = await storeOp(A, 'addMap', 'Camada do servidor');
    await expect.poll(async () => (await storeOp(A, 'getLayersRepo', created.id)).length).toBe(1);
    const [layer] = await storeOp(A, 'getLayersRepo', created.id);
    expect(layer.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect.poll(async () => (await storeOp(B, 'getLayersRepo', created.id))[0]?.id).toBe(layer.id);
    const rows = await collab.db.raw.any('SELECT id FROM layers WHERE map_id=$1 AND deleted_at IS NULL', [created.id]);
    expect(rows.map(row => row.id)).toEqual([layer.id]);

    await storeOp(A, 'setCurrentMap', created.name);
    await storeOp(B, 'setCurrentMap', created.name);
    const pointId = await drawPointUI(A, [-43.2, -22.9]);
    await expectFullSync({ ...collab, mapId: created.id }, { entityId: pointId, type: 'points', operationType: 'create' });
    await A.context().setOffline(true);
    await storeOp(A, 'renameLayer', layer.id, 'Configuração preservada');
    await storeOp(A, 'setLayerOpacity', layer.id, 0.55);
    await A.context().setOffline(false);
    await expect.poll(async () => (await storeOp(B, 'getLayersRepo', created.id))[0]?.name,
        { timeout: 20000 }).toBe('Configuração preservada');
    await expect.poll(async () => (await storeOp(B, 'getLayersRepo', created.id))[0]?.opacity).toBe(0.55);

    await storeOp(A, 'deleteLayer', layer.id);
    await expect.poll(async () => {
        const layers = await storeOp(A, 'getLayersRepo', created.id);
        return layers.length === 1 && layers[0].id !== layer.id && layers[0].id !== 'default';
    }).toBe(true);
    const [replacement] = await storeOp(A, 'getLayersRepo', created.id);
    await expect.poll(async () => (await storeOp(B, 'getLayersRepo', created.id)).map(l => l.id)).toEqual([replacement.id]);
    const stored = await collab.db.raw.any('SELECT id FROM layers WHERE map_id=$1 AND deleted_at IS NULL', [created.id]);
    expect(stored.map(row => row.id)).toEqual([replacement.id]);
    const feature = await collab.db.raw.one('SELECT deleted_at FROM features WHERE id=$1', [pointId]);
    expect(feature.deleted_at).toBeTruthy();

    const fresh = await collab.reopenPeer(0);
    expect((await storeOp(fresh, 'getLayersRepo', created.id)).map(l => l.id)).toEqual([replacement.id]);
    await storeOp(fresh, 'setCurrentMap', created.name);
    const newPoint = await drawPointUI(fresh, [-43.19, -22.89]);
    await expect.poll(async () => (await collab.db.raw.oneOrNone('SELECT layer_id FROM features WHERE id=$1', [newPoint]))?.layer_id)
        .toBe(replacement.id);
    await fresh.screenshot({ path: testInfo.outputPath('camada-remota-apos-reentrada.png') });
});

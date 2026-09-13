import { collabTest, expect } from './helpers/collab.fixtures.js';

collabTest.use({ collabOptions: { peers: 1, permission: 'write' } });

collabTest('catalog edits survive F5 on their target map while another map is active', async ({ collab }, testInfo) => {
    const A = collab.author;
    const destination = await A.evaluate(async () => {
        const { addMap } = await import('/src/js/store/map.operations.js');
        return addMap('Destino do catálogo');
    });
    await expect.poll(async () => (await collab.db.raw.any('SELECT id FROM maps WHERE id=$1', [destination.id])).length).toBe(1);
    expect(await A.evaluate(async () => (await import('/src/js/store/map.operations.js')).getCurrentMapNameSync())).not.toBe(destination.name);
    await A.context().setOffline(true);
    const queued = await A.evaluate(async target => {
        const { addCatalogLayer, updateCatalogLayer } = await import('/src/js/store/catalog.operations.js');
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        await addCatalogLayer({ id: 'hillshade', type: 'hillshade', visible: true, opacity: 0.8 }, target);
        await updateCatalogLayer('hillshade', { opacity: 0.3 }, target);
        return (await operationQueue.getAll()).filter(op => op.entityType === 'catalogLayer');
    }, destination.name);
    expect(queued).toHaveLength(2);
    expect(queued.map(op => op.mapId)).toEqual([destination.id, destination.id]);
    await A.context().setOffline(false);
    await A.reload();
    await expect.poll(async () => (await collab.db.raw.any('SELECT data FROM catalog_layers WHERE map_id=$1 AND id=$2 AND deleted_at IS NULL',
        [destination.id, 'hillshade']))[0]?.data.opacity, { timeout: 30000 }).toBe(0.3);
    expect(await collab.db.raw.any('SELECT id FROM catalog_layers WHERE map_id=$1 AND id=$2 AND deleted_at IS NULL',
        [collab.mapId, 'hillshade'])).toEqual([]);
    for (const page of [A, collab.peers[0]]) {
        await expect.poll(() => page.evaluate(async target => {
            const { getCatalogLayers } = await import('/src/js/store/catalog.operations.js');
            return (await getCatalogLayers(target)).find(layer => layer.id === 'hillshade')?.opacity;
        }, destination.name), { timeout: 20000 }).toBe(0.3);
    }
    await A.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await A.locator('.map-list-item').filter({ hasText: destination.name }).locator('.map-list-name').click();
    await expect(A.locator('#current-map-name-input')).toHaveValue(destination.name);
    await A.screenshot({ path: testInfo.outputPath('catalogo-mapa-destino.png'), animations: 'disabled' });
});

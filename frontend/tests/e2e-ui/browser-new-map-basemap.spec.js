// Path: e2e-ui/browser-new-map-basemap.spec.js
import { collabTest, expect, currentMapName } from './helpers/collab.fixtures.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { ApiClient } from '../../src/js/store/sync/api-client.js';

collabTest('new map uses an accessible base when the historical default becomes private', async ({ collab }, testInfo) => {
    collabTest.setTimeout(120000);
    const adminUser = await createVerifiedUser({ prefix: 'bmdefault', nome: 'Basemap Admin', role: 'admin' });
    const admin = new ApiClient({ baseUrl: `${collab.baseUrl}/api/v1` });
    await admin.login(adminUser.username, adminUser.password);
    const safeId = `safe-${Date.now()}`;
    await admin.createResource('basemap', {
        id: safeId, name: 'Base permitida de teste', sort_order: 0,
        config: { enabled: true, priority: -10, style: {
            version: 8, sources: {},
            layers: [{ id: 'safe-background', type: 'background', paint: { 'background-color': '#d6e7f4' } }],
        } },
    });
    try {
        await admin.setResourceVisibility('basemap', 'carta-topografica', 'private');
        const page = collab.peers[0];
        await page.reload();
        await expect.poll(() => currentMapName(page), { timeout: 30000 }).toBe(collab.mapName);
        await expect.poll(() => page.evaluate(async () => {
            const { default: config } = await import('/src/js/config.js');
            return config.getEnabledBasemaps().map(([id]) => id);
        })).toContain(safeId);
        const available = await page.evaluate(async () => {
            const { default: config } = await import('/src/js/config.js');
            return config.getEnabledBasemaps().map(([id]) => id);
        });
        expect(available).not.toContain('carta-topografica');
        expect(available[0]).toBe(safeId);

        const name = 'Mapa com base permitida';
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await page.locator('[data-testid="maps-new-map"]').click();
        await page.locator('.prompt-modal-input').fill(name);
        await page.locator('.prompt-modal-btn-confirm').click();
        await expect.poll(() => currentMapName(page)).toBe(name);
        const id = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            return store.getCurrentMapIdSync();
        });
        await expect.poll(async () => (await collab.db.queryEntityRow('maps', id))?.base_layer,
            { timeout: 30000 }).toBe(safeId);
        await collab.expectFullSyncFrom(page, { entityId: id, entityType: 'map', operationType: 'create' });

        const records = await collab.db.queryOperationsByEntity(id);
        const create = records.find(row => row.op_type === 'create');
        expect(create.data.baseLayer).toBe(safeId);
        const receipt = await collab.db.queryReceipt(create.op_id);
        expect(receipt.result.rejected).not.toBe(true);
        await expect(page.locator('.base-layer-label')).toHaveText('Base permitida de teste');
        await page.screenshot({ path: testInfo.outputPath('map-created-with-accessible-base.png') });

        await page.reload();
        await expect.poll(() => currentMapName(page), { timeout: 30000 }).toBe(name);
        await expect.poll(() => page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            return store.getCurrentBaseLayer();
        })).toBe(safeId);
    } finally {
        await admin.setResourceVisibility('basemap', 'carta-topografica', 'public');
        await admin.deleteResource('basemap', safeId);
    }
});

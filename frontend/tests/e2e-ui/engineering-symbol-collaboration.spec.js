import { collabTest, expect, readFeatures, selectFeatureUI } from './helpers/collab.fixtures.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

collabTest.describe.configure({ retries: 0 });

// Read the actual raster, not hasImage: a missing image also installs a placeholder.
const raster = (page, id) => page.evaluate(async fid => {
    const image = globalThis.__ebgeoMap?.getImage(fid);
    const bitmap = image?.data ?? image;
    if (!bitmap?.data || !bitmap.width) return null;
    const digest = await crypto.subtle.digest('SHA-256', bitmap.data);
    return { width: bitmap.width, height: bitmap.height,
        hash: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
}, id);

const bridgeClass = async (page, id) => (await readFeatures(page, 'engineering_symbols'))
    .find(feature => feature.id === id)?.props.engineering?.values.class;

async function editBridge(page, id, value) {
    await selectFeatureUI(page, id);
    await page.getByRole('button', { name: 'Configurar Símbolo', exact: true }).click();
    const dialog = page.locator('.point-selector-modal-container');
    await dialog.locator('.coord-text-field').filter({ hasText: 'Classe da ponte' }).locator('input').fill(value);
    await dialog.locator('.point-selector-btn-apply').click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => bridgeClass(page, id)).toBe(value);
}

collabTest('engineering symbols regenerate on an unused peer, after both users edit and after reload', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    await A.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await A.locator('.toolbar-tool-btn[data-tool-id="engineeringSymbol"]').click();
    await esperarFerramentaPronta(A, 'engineeringSymbol');
    await A.locator('#map-sig .maplibregl-canvas').click({ position: { x: 630, y: 340 } });
    await expect.poll(async () => (await readFeatures(A, 'engineering_symbols')).length).toBe(1);
    const id = (await readFeatures(A, 'engineering_symbols'))[0].id;
    await collab.expectFullSync({ entityId: id, type: 'engineering_symbols', operationType: 'create', skipRender: true });
    const initial = await raster(A, id);
    expect(initial?.width).toBeGreaterThan(64);
    await expect.poll(() => raster(B, id), { timeout: 30000 }).toEqual(initial);

    let previous = initial;
    for (const [author, peer, value] of [[A, B, '95'], [B, A, '125']]) {
        await collab.clearTraces();
        await editBridge(author, id, value);
        await collab.expectFullSyncFrom(author, {
            entityId: id, type: 'engineering_symbols', operationType: 'update', skipRender: true,
        });
        await expect.poll(() => bridgeClass(peer, id)).toBe(value);
        await expect.poll(() => raster(author, id)).not.toEqual(previous);
        const updated = await raster(author, id);
        expect(updated?.width).toBeGreaterThan(64);
        await expect.poll(() => raster(peer, id), { timeout: 30000 }).toEqual(updated);
        previous = updated;
    }

    for (const page of [A, B]) {
        await page.reload();
        await expect.poll(() => bridgeClass(page, id), { timeout: 30000 }).toBe('125');
        await expect.poll(() => raster(page, id), { timeout: 30000 }).toEqual(previous);
    }
});

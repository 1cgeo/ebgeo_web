import { collabTest, expect, currentMapName } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(120000);

async function openMaps(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const input = page.locator('#current-map-name-input');
    await expect(input).toBeVisible();
    await expect(input).not.toHaveValue('');
    await expect(page.locator('.map-list-item')).toHaveCount(1);
    return input;
}

collabTest('a peer creating a map cannot erase the name being typed; one Enter persists it', async ({ collab }, info) => {
    const A = collab.author, B = collab.peers[0];
    await openMaps(A);
    const input = await openMaps(B);
    await input.fill('Nome que estou escrevendo');
    await A.getByTestId('maps-new-map').click();
    await A.locator('.prompt-modal-input').fill('Mapa criado pelo colega');
    await A.locator('.prompt-modal-btn-confirm').click();
    // The new row proves the peer operation has refreshed this exact sidebar.
    await expect(B.locator('.map-list-item[data-map-name="Mapa criado pelo colega"]')).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Nome que estou escrevendo');
    await B.screenshot({ path: info.outputPath('map-name-draft-after-peer-map.png') });
    await input.press('Enter');
    await expect.poll(() => currentMapName(B)).toBe('Nome que estou escrevendo');
    await expect.poll(async () => (await collab.db.raw.one('SELECT name FROM maps WHERE id=$1', [collab.mapId])).name)
        .toBe('Nome que estou escrevendo');
    await B.reload();
    await expect(B.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
    await expect.poll(() => currentMapName(B)).toBe('Nome que estou escrevendo');
});

// Path: e2e-ui/browser-collab-maps-layers.spec.js

/**
 * MAPS + LAYERS + cross-map MOVE synced cross-client — TWO real browsers + real backend,
 * on the full-chain harness. Client A drives the REAL UI (create a map via the Maps tab,
 * a layer via the Camadas tab, draw a line, move it via the "Mover para mapa" context
 * menu) and each entity is verified end-to-end:
 *
 *   1. create a SECOND map        → full chain to B (entityType 'map', SQL `maps` row)
 *   2. create a LAYER             → full chain to B (entityType 'layer', SQL `layers` row)
 *   3. draw a LINE                → full chain to B
 *   4. MOVE the line to map 2     → on B it leaves the shared map and joins the second
 *      (a compound op — verified via the peer repo per map, not a single expectFullSync)
 *
 * Run headed:  npx playwright test browser-collab-maps-layers --headed
 */

import { collabTest, expect, readFeatures, currentMapName, drawLineUI } from './helpers/collab.fixtures.js';

const SHARED_MAP = 'Mapa Tático';
const SECOND_MAP = 'Mapa Secundário';
const LAYER_NAME = 'Camada Tática';

/**
 * Resolves the sync UUID of the most recent `entityType`/`operationType` op authored on
 * this page, read from its trace (the op's entityId is the canonical sync id — the local
 * map/layer record may be name-keyed, so reading repo `.id` is NOT reliable). Polls until
 * the op's apply.persist span exists.
 */
async function syncIdFromTrace(page, entityType, operationType) {
    let id = null;
    await expect
        .poll(async () => {
            id = await page.evaluate((q) => {
                const t = window.__ebgeoSyncTrace;
                if (!t) return null;
                const spans = t.get((s) => s.stage === 'apply.persist' && s.entityType === q.et && s.operationType === q.ot);
                return spans.length ? spans[spans.length - 1].entityId : null;
            }, { et: entityType, ot: operationType });
            return id;
        }, { timeout: 10000 })
        .toBeTruthy();
    return id;
}

/** Creates a new map through the real Maps-tab UI (createMap makes it the active map). */
async function createMapUI(page, name) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await expect(page.locator('.maps-tab #current-map-name-input')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="maps-new-map"]').click();
    const input = page.locator('.prompt-modal-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(name);
    await page.locator('.prompt-modal-btn-confirm').click();
    await expect(input).toBeHidden({ timeout: 5000 });
    await expect(page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`)).toBeVisible({ timeout: 5000 });
}

/** Switches the active map by clicking its card in the Maps-tab list (polls the active map). */
async function switchToMapUI(page, name) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const card = page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.evaluate((el) => el.click());
    // Poll the actual active map (more robust than data-selected, which flips only after the
    // async map switch completes — and the card can re-render under sync load).
    await expect.poll(async () => currentMapName(page), { timeout: 10000 }).toBe(name);
}

/** Creates a layer on the ACTIVE map through the real Camadas-tab UI. */
async function createLayerUI(page, name) {
    await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    const addBtn = page.locator('.layers-tab .sidebar-section-header-btn[title="Nova camada"]');
    await expect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click();
    const input = page.locator('.prompt-modal-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(name);
    await page.locator('.prompt-modal-btn-confirm').click();
    await expect(input).toBeHidden({ timeout: 5000 });
}

/** Drops the active draw tool (Escape) so the map context menu can open. */
async function deactivateToolUI(page) {
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Escape');
    await expect(page.locator('.toolbar-tool-btn[data-active="true"]')).toHaveCount(0, { timeout: 5000 });
}

/** Selects a feature by id in the layers tree (expanding any collapsed layers first). */
async function selectFeatureInTreeUI(page, featureId) {
    await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
    for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) {
        await icon.click().catch(() => {});
    }
    const row = page.locator(`.feature-item[data-feature-id="${featureId}"] .feature-main`).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect
        .poll(async () => {
            if ((await page.locator('.feature-panel[data-expanded="true"]').count()) > 0) return 1;
            await row.evaluate((el) => el.click()).catch(() => {});
            await page.waitForTimeout(500);
            return page.locator('.feature-panel[data-expanded="true"]').count();
        }, { timeout: 15000, intervals: [700] })
        .toBeGreaterThan(0);
}

/** Moves the selected feature(s) to `targetMapName` via the real "Mover para mapa" submenu. */
async function moveSelectedToMapUI(page, targetMapName) {
    const box = await page.locator('.maplibregl-canvas').boundingBox();
    expect(box).not.toBeNull();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.click(cx, cy, { button: 'right' });
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    const trigger = menu.locator('.context-menu-submenu-trigger', { hasText: 'Mover para mapa' });
    await expect(trigger).toBeVisible({ timeout: 5000 });
    await trigger.dispatchEvent('mouseenter');
    const mapItem = menu.locator('.context-submenu .context-menu-item', { hasText: targetMapName });
    await expect(mapItem).toBeVisible({ timeout: 5000 });
    await mapItem.click();
    await expect(menu).toBeHidden({ timeout: 5000 });
}

/** Reads a specific map's stored feature ids (by storage type) from the peer repo. */
function readPeerMapFeatures(page, mapName, type) {
    return page.evaluate(async ({ mn, t }) => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const mapData = await getRepository().getMap(mn);
        const arr = (mapData && mapData.features && mapData.features[t]) || [];
        return arr.map((x) => x.properties?.id);
    }, { mn: mapName, t: type });
}

collabTest.describe('Maps + layers + cross-map move sync cross-client (real UI gestures + full chain)', () => {
    collabTest('create map → full chain; create layer → full chain; move feature between maps → B reflects it', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author;
        const B = collab.peers[0];

        expect(await currentMapName(A)).toBe(SHARED_MAP);
        expect(await currentMapName(B)).toBe(SHARED_MAP);

        // 1. A creates a SECOND map via the real Maps-tab UI → full chain to B. The map's sync
        //    UUID is the op's entityId (read from the trace; the local record is name-keyed).
        await createMapUI(A, SECOND_MAP);
        expect(await currentMapName(A), 'creating a map makes it the active map').toBe(SECOND_MAP);
        const secondMapId = await syncIdFromTrace(A, 'map', 'create');
        await collab.expectFullSync({ entityId: secondMapId, entityType: 'map', operationType: 'create' });
        await switchToMapUI(A, SHARED_MAP);
        expect(await currentMapName(A), 'A is back on the shared map').toBe(SHARED_MAP);

        // 2. A creates a LAYER on the shared map via the real Camadas-tab UI → full chain to B.
        await collab.clearTraces(); // so the only layer-create span is this one
        await createLayerUI(A, LAYER_NAME);
        const layerId = await syncIdFromTrace(A, 'layer', 'create');
        await collab.expectFullSync({ entityId: layerId, entityType: 'layer', operationType: 'create' });

        // 3. A draws a LINE on the shared map → full chain to B.
        const lineId = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
        expect(lineId, 'the line tool created a line').toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });

        // 4. A moves its line to the second map via the real "Mover para mapa" submenu. The move
        //    is a compound op (leave map1, join map2), so verify it via the peer repo per map.
        await deactivateToolUI(A);
        await selectFeatureInTreeUI(A, lineId);
        await moveSelectedToMapUI(A, SECOND_MAP);

        // Sanity on A: the line left the shared map.
        await expect
            .poll(async () => (await readFeatures(A, 'lines')).some((x) => x.id === lineId), { timeout: 10000 })
            .toBe(false);

        // On B: the line is GONE from the shared map and PRESENT on the second map.
        await expect
            .poll(async () => (await readPeerMapFeatures(B, SECOND_MAP, 'lines')).includes(lineId), { timeout: 20000 })
            .toBe(true);
        await expect
            .poll(async () => (await readFeatures(B, 'lines')).some((x) => x.id === lineId), { timeout: 20000 })
            .toBe(false);
    });
});

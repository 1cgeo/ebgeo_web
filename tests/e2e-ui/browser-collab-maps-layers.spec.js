// Path: e2e-ui/browser-collab-maps-layers.spec.js

/**
 * MAPS + LAYERS + cross-map MOVE synced cross-client — TWO real browsers + real
 * backend. Client A drives the app's REAL UI (create a map via the Maps tab, create a
 * layer via the Camadas tab, draw a line with the line tool, move it via the
 * "Mover para mapa" context-menu) and client B asserts the change propagated, with no
 * workarounds. Structure mirrors browser-collab-feature-mutations.spec.js.
 *
 * Covered, in order:
 *   1. A creates a SECOND map "Mapa Secundário" (Maps-tab "Novo mapa" → prompt)
 *                                                              → B's repo lists it.
 *   2. A creates a LAYER on the shared map (Camadas-tab "Nova camada" → prompt)
 *                                                              → the layer reaches the
 *      backend (snapshot pulled from B's own authenticated session — see NOTE below).
 *   3. A adds a LINE to the shared map (line tool), then MOVES it to the second map
 *      (right-click → "Mover para mapa" submenu)              → on B the line is gone
 *      from the shared map and present on "Mapa Secundário".
 *
 * UI gestures (discovered by reading the clean sibling specs + src):
 *   - Create map: maps.tab.js "Novo mapa" header button (data-testid="maps-new-map") →
 *     .prompt-modal-input → .prompt-modal-btn-confirm (createMap emits a map `create`
 *     op). Mirrors maps-tab-navigation.spec.js seedSecondMap. createMap makes the new
 *     map current, so A switches BACK to the shared map (click its map-list card) before
 *     drawing — so the line lands on the shared map. Remote map-create persists to the
 *     peer repo (applyRemoteMapOp → repo.saveMap), so B's getAllMaps() lists it.
 *   - Create layer: features_tab.js "Nova camada" header button
 *     (.layers-tab .sidebar-section-header-btn[title="Nova camada"]) → prompt → confirm.
 *     Mirrors layers-tab-local.spec.js. createLayer emits a layer `create` op. NOTE: the
 *     REMOTE layer-create handler (applyRemoteLayerOp) only EMITS LAYER_CREATED/
 *     LAYERS_CHANGED — it does NOT call repo.saveLayers — and no app listener persists
 *     it, so a remotely-created layer does NOT land in the peer's LOCAL store. We
 *     therefore assert the layer reached the BACKEND snapshot (the authoritative source,
 *     exactly as browser-layer-ops.spec.js does), pulling it from B's own live ApiClient
 *     session. See REPORT note.
 *   - Draw line: drawLineUI (collab-helpers.js) — activate the line tool, click vertices,
 *     right-click to finish; returns the tool-generated feature id.
 *   - Move feature between maps: select the line in the layers tree, right-click the
 *     canvas, hover the "Mover para mapa" submenu, click the target map item
 *     (context-menu.control.js _addMapMoveOptions → mapManager.moveFeaturesToMap).
 *
 * The seed/login/open plumbing + draw/poll helpers come from ./helpers/collab-helpers.js.
 *
 * Run headed:  npx playwright test browser-collab-maps-layers --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    pollPeerFeature,
    currentMapName,
    drawLineUI,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const SHARED_MAP = 'Mapa Tático';
const SECOND_MAP = 'Mapa Secundário';
const LAYER_NAME = 'Camada Tática';

/**
 * Creates a new local map through the REAL Maps-tab UI (header "Novo mapa" button →
 * prompt → confirm), exactly like maps-tab-navigation.spec.js seedSecondMap. createMap
 * sets the new map current, so the caller must switch back if it needs the prior map.
 */
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

/** Switches the active map by clicking its card in the Maps-tab list. */
async function switchToMapUI(page, name) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const card = page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    // Raw DOM click — the open Feature panel overlays the sidebar and can intercept
    // pointer events, hanging locator.click()'s actionability wait (same workaround the
    // tree-row selection below already uses). The card's own click listener still fires.
    await card.evaluate((el) => el.click());
    await expect(card).toHaveAttribute('data-selected', 'true', { timeout: 5000 });
}

/**
 * Creates a layer on the ACTIVE map through the REAL Camadas-tab UI (header "Nova camada"
 * button → prompt → confirm), exactly like layers-tab-local.spec.js.
 */
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

/**
 * Deactivates whatever draw tool is currently active by pressing Escape — the real
 * keyboard gesture (keyboard-shortcuts.js → toolManager.deactivateCurrentTool()). A draw
 * tool (e.g. the line tool) stays ACTIVE after finishing a shape so the user can draw
 * again; while a tool is active the map context menu's right-click handler early-returns
 * (context-menu.control.js _onRightClick → `if (toolManager.hasActiveTool()) return`), so
 * the menu never opens. We must drop the tool before the move gesture. Escape also clears
 * the canvas selection, so the tree-select for the move MUST run AFTER this.
 */
async function deactivateToolUI(page) {
    // Move keyboard focus off any input (the keydown handler ignores Escape while typing —
    // keyboard-shortcuts.js isTypingInInput) by blurring the active element, then press
    // Escape. We do NOT left-click the canvas (that would arm a new vertex on the active
    // line tool); the keydown handler is on `document`, so blurring is enough.
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Escape');
    // Confirm no draw tool button is left active (the line tool was the one used).
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
    // Raw DOM click — overlapped rows can hang locator.click. Only click when the panel is NOT
    // already open: clicking an already-selected row TOGGLES the selection and would CLOSE the
    // panel, so re-clicking every poll iteration oscillated and flaked under load. The tree can
    // re-render, so retry the click until the panel (handleFeatureClick → zoomAndSelectFeature,
    // which populates the canvas selectionManager the "Mover para mapa" menu reads) opens.
    await expect
        .poll(async () => {
            if ((await page.locator('.feature-panel[data-expanded="true"]').count()) > 0) return 1;
            await row.evaluate((el) => el.click()).catch(() => {});
            await page.waitForTimeout(500);
            return page.locator('.feature-panel[data-expanded="true"]').count();
        }, { timeout: 15000, intervals: [700] })
        .toBeGreaterThan(0);
}

/**
 * Moves the currently-selected feature(s) to `targetMapName` through the REAL map
 * context menu: right-click the canvas, hover the "Mover para mapa" submenu trigger,
 * then click the target-map item (context-menu.control.js _addMapMoveOptions). The
 * submenu is opened via the real mouseenter listener.
 */
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
    await trigger.dispatchEvent('mouseenter'); // reveal the submenu (display:block)

    const mapItem = menu.locator('.context-submenu .context-menu-item', { hasText: targetMapName });
    await expect(mapItem).toBeVisible({ timeout: 5000 });
    await mapItem.click();
    await expect(menu).toBeHidden({ timeout: 5000 });
}

/** Reads the peer's repo-backed map names (repo.getAllMaps → mapData.name). */
function readPeerMapNames(page) {
    return page.evaluate(async () => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const all = await getRepository().getAllMaps();
        const maps = Array.from(all instanceof Map ? all.values() : Object.values(all || {}));
        return maps.map((m) => m && m.name).filter(Boolean);
    });
}

/** Polls until the peer's repo lists a map named `name`. */
async function pollPeerHasMap(page, name, timeout = 20000) {
    await expect
        .poll(async () => (await readPeerMapNames(page)).includes(name), { timeout })
        .toBe(true);
}

/** Reads a specific map's features (by storage type) directly from the peer repo. */
function readPeerMapFeatures(page, mapName, type) {
    return page.evaluate(async ({ mn, t }) => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const mapData = await getRepository().getMap(mn);
        const arr = (mapData && mapData.features && mapData.features[t]) || [];
        return arr.map((x) => x.properties?.id);
    }, { mn: mapName, t: type });
}

/** Polls until the peer repo's `mapName`/`type` features contain `id`. */
async function pollPeerMapHasFeature(page, mapName, type, id, timeout = 20000) {
    await expect
        .poll(async () => (await readPeerMapFeatures(page, mapName, type)).includes(id), { timeout })
        .toBe(true);
}

/**
 * Pulls the backend snapshot from the peer's OWN authenticated session and returns the
 * layers array for the shared map. A fresh ApiClient logged in as B (which holds WRITE
 * on the atlas) proves the layer-create op reached the backend — the authoritative
 * source, since remote layer-create does not land in the peer's local store.
 */
function readBackendMapLayers(page, baseUrl, creds, atlasId, mapName) {
    return page.evaluate(async ({ base, c, id, mn }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        await api.login(c.username, c.password);
        const pulled = await api.pullSync(id, 0);
        const maps = pulled.snapshot?.maps || [];
        const map = maps.find((m) => m.name === mn);
        return (map?.layers || []).map((l) => ({ id: l.id, name: l.name }));
    }, { base: baseUrl, c: creds, id: atlasId, mn: mapName });
}

/** Polls the backend snapshot (from B's session) until the shared map has a layer named `name`. */
async function pollBackendMapHasLayer(page, baseUrl, creds, atlasId, mapName, layerName, timeout = 20000) {
    await expect
        .poll(
            async () => (await readBackendMapLayers(page, baseUrl, creds, atlasId, mapName)).some((l) => l.name === layerName),
            { timeout },
        )
        .toBe(true);
}

describeOrSkip('Maps + layers + cross-map move sync cross-client (two real browsers, real UI gestures)', () => {
    test('create second map → B lists it; create layer → backend has it; move feature between maps → B reflects it', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { mapName: SHARED_MAP });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

        try {
            // Both open onto the shared atlas map (the app auto-activates it).
            expect(await currentMapName(A)).toBe(SHARED_MAP);
            expect(await currentMapName(B)).toBe(SHARED_MAP);

            // 1. A creates a SECOND map via the Maps-tab "Novo mapa" UI → B's repo
            //    eventually lists "Mapa Secundário". createMap emits a map `create` op;
            //    remote map-create persists via repo.saveMap. createMap makes the NEW map
            //    current, so A switches BACK to the shared map for the layer + line below.
            await createMapUI(A, SECOND_MAP);
            expect(await currentMapName(A), 'creating a map makes it the active map').toBe(SECOND_MAP);
            await pollPeerHasMap(B, SECOND_MAP);
            await switchToMapUI(A, SHARED_MAP);
            expect(await currentMapName(A), 'A is back on the shared map').toBe(SHARED_MAP);

            // 2. A creates a LAYER on the SHARED map via the Camadas-tab "Nova camada" UI →
            //    it reaches the backend snapshot. (Remote layer-create does not land in B's
            //    local store — see file header.)
            await createLayerUI(A, LAYER_NAME);
            await pollBackendMapHasLayer(B, state.baseUrl, seed.userB, seed.atlasId, SHARED_MAP, LAYER_NAME);

            // 3. A draws a LINE on the shared map with the real line tool → B receives it
            //    (native feature sync). The line tool generates the id; drawLineUI returns it.
            const lineId = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
            expect(lineId, 'the line tool created a line and returned its id').toBeTruthy();
            await pollPeerFeature(B, 'lines', lineId);

            // A selects its line in the layers tree and MOVES it to the second map through
            // the real "Mover para mapa" context-menu submenu. The line tool is still ACTIVE
            // after the draw (draw tools stay armed to draw again); while a tool is active the
            // map's right-click handler early-returns and the context menu never opens, so we
            // drop the tool first (Escape). Escape also clears the selection, hence the
            // tree-select must come AFTER deactivation.
            const lineOnA = (await readFeatures(A, 'lines')).find((x) => x.id === lineId);
            expect(lineOnA, "A's line is in its own store before the move").toBeTruthy();
            await deactivateToolUI(A);
            await selectFeatureInTreeUI(A, lineId);
            await moveSelectedToMapUI(A, SECOND_MAP);

            // Sanity on A: after the move the line left the shared map and joined the second.
            await expect
                .poll(async () => (await readFeatures(A, 'lines')).some((x) => x.id === lineId), { timeout: 10000 })
                .toBe(false);
            await pollPeerMapHasFeature(A, SECOND_MAP, 'lines', lineId);

            // 3 (assert on B): the line is GONE from the shared map and PRESENT on the second.
            // Read the second map's features directly from B's repo (no current-map switch).
            await pollPeerMapHasFeature(B, SECOND_MAP, 'lines', lineId);
            await expect
                .poll(async () => (await readFeatures(B, 'lines')).some((x) => x.id === lineId), { timeout: 20000 })
                .toBe(false);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

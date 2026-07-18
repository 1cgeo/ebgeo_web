// Path: e2e-ui/browser-collab-feature-mutations.spec.js

/**
 * FEATURE MUTATIONS synced cross-client — migrated to the full-chain harness. Client A
 * drives the app's REAL UI (draw a line / military symbol, rename + recolor through the
 * attribute panel, delete with the Delete key) and EACH mutation is verified through the
 * ENTIRE sync chain to B via `collab.expectFullSync`, then the new value is confirmed in
 * B's actual IndexedDB (ground-truth, not memoryStore).
 *
 * Covered, in order, on a LINE then a MILITARY SYMBOL:
 *   1. create a line                  → full chain to B
 *   2. rename (panel name field)      → full chain + B IDB nome
 *   3. set a description (no-UI)       → full chain + B IDB descricao
 *   4. recolor (panel color picker)   → full chain + B IDB lineColor
 *   5. move geometry (no-UI)          → full chain + B IDB coordinates
 *   6. military symbol + SIDC (no-UI) → full chain (skipRender: icon layer) + B IDB sidc
 *   7. delete a point, then the line  → full delete chain to B
 *
 * Repeated UPDATEs to the SAME line need `collab.clearTraces()` first, so each
 * expectFullSync resolves the current op's id (entity+opType alone is not unique).
 *
 * Run headed:  npx playwright test browser-collab-feature-mutations --headed
 */

import {
    collabTest, expect,
    drawLineUI, drawPointUI, readFeatures,
    selectFeatureUI, renameViaPanelUI, recolorViaPanelUI, deleteFeatureUI, drawMilitarySymbolUI,
} from './helpers/collab.fixtures.js';
import { readIdbEntity } from './helpers/idb.js';

/** Drives a store op on `page` through the app's REAL store facade (no-UI escapes only). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/** Reads a peer feature's durable props from IndexedDB (ground-truth), or null. */
async function peerProps(page, id, storage, mapId) {
    const r = await readIdbEntity(page, { entityId: id, entityType: 'feature', mapId, storage });
    return r.found ? r : null;
}

collabTest.describe('Feature mutations sync cross-client (real UI gestures + full chain)', () => {
    collabTest('create → rename → describe → recolor → move → military symbol + SIDC → delete', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];
        const mapId = collab.mapId;

        // 1. CREATE a line with the real tool → full chain to B.
        const lineId = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
        expect(lineId, 'the line tool created a feature on A').toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });

        // 2. RENAME through the panel name field → full chain + value in B's IndexedDB.
        await collab.clearTraces();
        await selectFeatureUI(A, lineId);
        await renameViaPanelUI(A, 'Eixo Azul');
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'update' });
        expect((await peerProps(B, lineId, 'lines', mapId))?.props?.nome).toBe('Eixo Azul');

        // 3. DESCRIBE (no-UI: the line panel has no free-text descricao field) → full chain + value.
        await collab.clearTraces();
        await applyStoreOp(A, 'updateFeatureProperty', ['lines', lineId, 'descricao', '<p>nota</p>']);
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'update' });
        expect((await peerProps(B, lineId, 'lines', mapId))?.props?.descricao).toBe('<p>nota</p>');

        // 4. RECOLOR through the panel color picker (uppercase-normalized) → full chain + value.
        await collab.clearTraces();
        await selectFeatureUI(A, lineId);
        await recolorViaPanelUI(A, '#ee1111');
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'update' });
        expect(String((await peerProps(B, lineId, 'lines', mapId))?.props?.lineColor).toLowerCase()).toBe('#ee1111');

        // 5. MOVE geometry (no-UI: no single-gesture sets EXACT coordinates) → full chain + geometry.
        await collab.clearTraces();
        const lineOnA = (await readFeatures(A, 'lines')).find((x) => x.id === lineId);
        await applyStoreOp(A, 'updateFeature', ['lines', {
            type: 'Feature', properties: lineOnA.props,
            geometry: { type: 'LineString', coordinates: [[-43.0, -22.7], [-42.9, -22.6]] },
        }]);
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'update' });
        const movedOnB = await peerProps(B, lineId, 'lines', mapId);
        expect(movedOnB?.geometry?.coordinates?.[0]?.[0]).toBe(-43.0);

        // 6. MILITARY SYMBOL with the real tool → full chain (skipRender: icon layer, not a
        //    GeoJSON source). Then change the SIDC (no-UI) → full chain + value.
        const symbolId = await drawMilitarySymbolUI(A, [-43.2, -22.9]);
        expect(symbolId, 'the military tool created a symbol on A').toBeTruthy();
        await collab.expectFullSync({ entityId: symbolId, type: 'military_symbols', operationType: 'create', skipRender: true });

        await collab.clearTraces();
        const symOnA = (await readFeatures(A, 'military_symbols')).find((x) => x.id === symbolId);
        const newSidc = symOnA?.props?.sidc === 'SHGPUCI-----' ? 'SFGPUCI-----' : 'SHGPUCI-----';
        await applyStoreOp(A, 'updateFeatureProperty', ['military_symbols', symbolId, 'sidc', newSidc]);
        await collab.expectFullSync({ entityId: symbolId, type: 'military_symbols', operationType: 'update', skipRender: true });
        expect((await peerProps(B, symbolId, 'military_symbols', mapId))?.props?.sidc).toBe(newSidc);

        // 7a. CREATE then DELETE a point through the real UI → full delete chain to B.
        const delId = await drawPointUI(A, [-43.1, -22.8]);
        expect(delId, 'the point tool created a point on A').toBeTruthy();
        await collab.expectFullSync({ entityId: delId, type: 'points', operationType: 'create' });
        await deleteFeatureUI(A, delId);
        await collab.expectFullSyncDelete({ entityId: delId, type: 'points', operationType: 'delete' });

        // 7b. DELETE the line edited earlier through the real UI → full delete chain to B.
        await collab.clearTraces();
        await deleteFeatureUI(A, lineId);
        await collab.expectFullSyncDelete({ entityId: lineId, type: 'lines', operationType: 'delete' });
    });
});

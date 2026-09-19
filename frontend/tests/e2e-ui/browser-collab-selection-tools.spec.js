// Path: tests/e2e-ui/browser-collab-selection-tools.spec.js

import { collabTest, expect, selectFeatureUI } from './helpers/collab.fixtures.js';
import { realFeature } from '../helpers/real-fixtures.js';
import { FEATURE_TYPE_REGISTRY } from '../../src/js/store/feature-type.registry.js';

const selectable = FEATURE_TYPE_REGISTRY.filter((row) => row.selectable);
const axis = [[-43.20, -22.90], [-43.18, -22.88], [-43.16, -22.90]];

// Creation is setup; the behavior under test starts at selection in the layers tree.
// Supply real geometry/dimensions for tools whose shared sync fixture is only a Point.
function fixture(type) {
    const feature = realFeature(type, {
        width: 100, height: 80, size: 1, rotation: 0, createdAtZoom: 12,
        zoomCorrectionEnabled: false, anchor: 'center', baseCoordinates: axis,
        center: axis[0], majorRadius: 500, minorRadius: 250, bearing: 0,
        fillColor: '#3f4fb5', fillOpacity: 0.3, lineColor: '#3f4fb5', lineWidth: 2,
    });
    if (['circle', 'ellipse', 'sector', 'visibility'].includes(type)) {
        feature.geometry = { type: 'Polygon', coordinates: [[...axis, axis[0]]] };
    }
    if (['brush', 'coordination_line', 'occupied_front', 'los'].includes(type)) {
        feature.geometry = { type: 'LineString', coordinates: axis };
    }
    return feature;
}

async function remoteBoxes(page) {
    return page.evaluate(async () => {
        const source = globalThis.__ebgeoMap.getSource('remote-selection-boxes');
        return (await source?.getData())?.features ?? [];
    });
}

collabTest('selection of every selectable tool renders on a peer who never used it', async ({ collab }, testInfo) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    // Start with the reported tool, before anything can warm its lazy control.
    const rows = [...selectable].sort((a, b) => (b.type === 'arrow') - (a.type === 'arrow'));
    await B.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.18, -22.895], zoom: 12 }));
    const failures = [];
    const browserErrors = [];
    A.on('pageerror', (error) => browserErrors.push(error.message));
    A.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
    for (const row of rows) {
        const feature = fixture(row.type);
        await A.evaluate(async ({ storage, feature }) => {
            const store = await import('/src/js/store/index.js');
            await store.addFeature(storage, feature);
        }, { storage: row.storage, feature });
        const id = feature.properties.id;
        await collabTest.step(row.type, async () => {
            try {
                await collab.expectFullSync({ entityId: id, type: row.storage, operationType: 'create', skipRender: true });
                if (row.type === 'arrow') {
                    expect(await B.evaluate(async () => {
                        const registry = await import('/src/js/tool_manager/tool-registry.js');
                        return !!registry.peekControl(registry.controlKeyForFeatureType('arrow'));
                    }), 'receiver has not loaded the arrow tool').toBe(false);
                }
                await selectFeatureUI(A, id);
                await expect.poll(async () => (await remoteBoxes(B)).map((f) => f.properties.featureId), {
                    message: `${row.type}: actual remote outline, not only the presence frame`, timeout: 12000,
                }).toEqual([id]);
                const [box] = await remoteBoxes(B);
                expect(box.geometry.type).toBe('Polygon');
                expect(box.geometry.coordinates.flat(2).every(Number.isFinite)).toBe(true);
                await expect.poll(() => B.evaluate(() => globalThis.__ebgeoMap.queryRenderedFeatures({
                    layers: ['remote-selection-boxes-layer'],
                }).length)).toBeGreaterThan(0);
                if (row.type === 'arrow') await B.screenshot({ path: testInfo.outputPath('remote-arrow-selection.png') });
                await A.keyboard.press('Escape');
                await expect.poll(async () => (await remoteBoxes(B)).length).toBe(0);
            } catch (error) {
                failures.push(`${row.type}: ${error.message}; browser errors: ${browserErrors.join('\n')}`);
                await testInfo.attach(`${row.type}-diagnostics`, { contentType: 'application/json', body: JSON.stringify(await A.evaluate(async (storage) => {
                    const store = await import('/src/js/store/index.js');
                    return { stored: (await store.getCurrentMapFeatures())[storage], source: await globalThis.__ebgeoMap.getSource(storage)?.getData(), rows: [...document.querySelectorAll('.feature-item')].map((el) => el.dataset.featureId) };
                }, row.storage)) });
            }
        });
    }
    expect(failures).toEqual([]);
    expect(await B.evaluate(async () => {
        const { getStateManager } = await import('/src/js/store/services.js');
        return getStateManager().getSelectedFeatures().length;
    }), 'remote selection does not select features for the receiving user').toBe(0);
    await A.keyboard.press('Escape');
    await expect.poll(async () => (await remoteBoxes(B)).length).toBe(0);
});

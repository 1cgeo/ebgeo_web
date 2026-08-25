// Path: tests/integration/combinar-setas-coordenadas-persistidas.repro.test.js

/**
 * @fileoverview Regression test for the three ways `arrow-merge.js` used to lose or
 * corrupt branch data on the combine/split round trip.
 *
 * ROOT CAUSE, one per symptom.
 *
 * 1. `extractBranches` copied `baseCoordinates` with a bare spread. Persistence hands
 *    that property back as a JSON STRING (`AddArrowGeometry.normalizeBaseCoordinates`
 *    has an explicit branch for it, which is the codebase admitting the shape exists),
 *    and spreading a string yields its CHARACTERS. An arrow reloaded from IndexedDB
 *    and then combined came out carrying "[", "0", "," as its vertex list.
 *
 * 2. The same spread was ONE level deep, so every `[lng, lat]` in the merged arrow was
 *    the SAME object as in the source arrow. Editing a vertex of the combined arrow
 *    reached back into the feature the merge had just deleted, which matters because
 *    the source features are still alive in the undo batch.
 *
 * 3. `splitArrows` rebuilt each branch with `branch.headLengthRatio || 1.5` and
 *    `branch.airmobilePosition || 0.7`, while `mergeArrows` preserved every DEFINED
 *    key (`!== undefined`). A branch that legitimately stored 0 therefore came back
 *    changed, so combine and split were not inverses.
 *
 * FIX: `copyBranchCoordinates` normalizes through `AddArrowGeometry` and copies each
 * position; the split defaults use `??`.
 *
 * This drives the PRODUCTION `mergeArrows` / `splitArrows` and observes the feature
 * handed to the store, which is the only surface the branch list ever reaches. The
 * store, the dispatcher and the toasts are doubles: nothing here says persistence
 * works, only what shape reaches it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tools', () => ({
    BaseGeometry: class { constructor(properties = {}) { this.properties = { ...properties }; } },
}));

const added = [];

vi.mock('@store', () => ({
    addFeature: (source, feature) => { added.push(feature); return Promise.resolve(); },
    removeFeature: () => Promise.resolve(),
    getActiveLayerIdSync: () => 'camada-ativa',
    startBatchUndo: () => {},
    commitBatchUndo: () => {},
}));

let nextId = 0;
vi.mock('@utils', () => ({
    IDUtils: {
        generateFeatureIds: () => { nextId += 1; return { id: `id-${nextId}`, geoJsonId: `gj-${nextId}` }; },
        generateFeatureName: () => Promise.resolve('Seta'),
    },
    showSuccess: () => {},
    showWarning: () => {},
}));

vi.mock('@layers/geojson-dispatcher.js', () => ({
    getGeoJsonDispatcher: () => ({ remove: () => {}, add: () => {}, flush: () => Promise.resolve() }),
}));

// Planar turf stub: this file is about which VALUES survive the round trip, never
// about where a vertex lands on the globe.
globalThis.turf = {
    lineString: (coords) => {
        if (!Array.isArray(coords)) throw new Error('coordinates must be an array');
        return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
    },
    point: (c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } }),
    lineOffset: (line) => line,
    bearing: () => 90,
    destination: (p, d, b) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [d, b] } }),
    feature: (g) => ({ type: 'Feature', geometry: g }),
    featureCollection: (features) => ({ type: 'FeatureCollection', features }),
    union: (fc) => fc.features[0],
};

const { mergeArrows, splitArrows } = await import('@js/military_tools/arrow_tool/arrow-merge.js');

const selectionManager = {
    deselectAllFeatures() {},
    toggleFeatureSelection() { return Promise.resolve(); },
    updateUI() {},
};

/**
 * @param {Object} props - Extra feature properties
 * @returns {Object} Minimal arrow feature
 */
const arrow = (props = {}) => ({
    type: 'Feature',
    properties: { id: 'a', source: 'arrow', baseCoordinates: [[0, 0], [1, 1]], ...props },
});

beforeEach(() => { added.length = 0; });

describe('repro: combinar setas não pode corromper as coordenadas guardadas', () => {
    it('a seta relida do disco (string JSON) chega ao ramo como coordenadas', async () => {
        // Exactly what `normalizeBaseCoordinates` says persistence produces.
        const doDisco = arrow({ id: '1', baseCoordinates: '[[10,20],[30,40]]' });

        await mergeArrows([doDisco, arrow({ id: '2' })], {}, selectionManager);

        expect(added).toHaveLength(1);
        const branches = added[0].properties.branches;
        expect(branches).toHaveLength(2);
        expect(branches[0].baseCoordinates).toEqual([[10, 20], [30, 40]]);
        // The bug produced a 17-character list; assert the LENGTH too, because
        // `toEqual` against the right answer is the only thing a character list
        // could never satisfy, and the count says which failure mode came back.
        expect(branches[0].baseCoordinates).toHaveLength(2);
    });

    it('editar o vértice da combinada NÃO alcança a seta consumida', async () => {
        const origem = [[0, 0], [1, 1]];
        const consumida = arrow({ id: '1', baseCoordinates: origem });

        await mergeArrows([consumida, arrow({ id: '2' })], {}, selectionManager);

        const combinada = added[0].properties;
        combinada.branches[0].baseCoordinates[0][0] = 99;

        expect(origem[0][0]).toBe(0);
        expect(consumida.properties.baseCoordinates[0][0]).toBe(0);
    });

    it('combinar e separar é um round trip: o ramo que guardava 0 volta com 0', async () => {
        const comZero = arrow({
            id: '1',
            baseCoordinates: [[0, 0], [1, 1]],
            headLengthRatio: 0,
            airmobilePosition: 0,
        });

        await mergeArrows([comZero, arrow({ id: '2', headLengthRatio: 3 })], {}, selectionManager);
        const combinada = added[0];
        expect(combinada.properties.branches[0].headLengthRatio).toBe(0);

        added.length = 0;
        const separadas = await splitArrows(combinada, {}, selectionManager);

        expect(separadas).toHaveLength(2);
        expect(separadas[0].properties.headLengthRatio).toBe(0);
        expect(separadas[0].properties.airmobilePosition).toBe(0);
        // Control: the branch that carries a REAL value keeps it, and the branch that
        // carries nothing still gets the default, so the two assertions above are not
        // passing because the defaults stopped being applied at all.
        expect(separadas[1].properties.headLengthRatio).toBe(3);
        expect(separadas[1].properties.airmobilePosition).toBe(0.7);
    });
});

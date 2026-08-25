// Path: tests/integration/limite-rotulo-sem-tamanho.repro.test.js

/**
 * @fileoverview Regression test for the boundary label that came out at a NaN
 * coordinate, and for the label distance of 0 that came back as the default.
 *
 * ROOT CAUSE: `generateBoundaryTexts` computed the label offset as
 * `symbol_size * (text_distance_ratio || 0.9)`, and neither factor was guarded.
 *
 * - A MISSING `symbol_size` makes the product NaN. NaN flowed into `turf.destination`
 *   and straight out into the emitted text feature's `geometry.coordinates`, with no
 *   throw and no warning anywhere. The label simply never appeared on the map, and
 *   the only trace was a feature the renderer could not place. `symbol_size` is
 *   absent on any boundary written before the property existed and on anything
 *   imported from a `.ebgeo` that predates it, which is how a real boundary reaches
 *   this path; `createHandles` and `updateFromHandle` already assumed a default of 2
 *   for exactly the same reason, so the value was known and only this call site
 *   failed to apply it.
 * - `text_distance_ratio === 0` means "label glued to the symbol". It is a value the
 *   drag handle cannot produce (it clamps at TEXT_DISTANCE_MIN 0.1) but a persisted
 *   or imported boundary can carry, and `||` turned it into 0.9, almost the default.
 *
 * FIX: both factors go through `Number.isFinite`, falling back to the shared
 * `DEFAULT_SYMBOL_SIZE` / `DEFAULT_TEXT_DISTANCE_RATIO`.
 *
 * The turf stub below ENCODES its arguments, so every coordinate asserted here is a
 * readout of what the module ASKED for. That is the right instrument for this bug
 * (the question is which offset was requested) and it is evidence about nothing else.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('@tools', () => ({
    BaseGeometry: class { constructor(properties = {}) { this.properties = { ...properties }; } },
}));

const coordOf = (p) => (p && p.geometry ? p.geometry.coordinates : p);
const pointFeature = (coords) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords } });

// Line length 10, default instance ratio 0.5, so the symbol centre sits at x = 5 and
// `destination` adds the requested offset to it.
const SYMBOL_CENTER_X = 5;

beforeAll(() => {
    globalThis.turf = {
        lineString: (coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }),
        point: (c) => pointFeature(c),
        length: () => 10,
        along: (_line, dist) => pointFeature([dist, 0]),
        bearing: () => 90,
        destination: (p, dist, brg) => pointFeature([coordOf(p)[0] + dist, coordOf(p)[1] + brg]),
    };
});

afterAll(() => { delete globalThis.turf; });

const { default: AddBoundaryGeometry } = await import(
    '@js/military_tools/boundary_tool/add_boundary_geometry.js'
);

const geom = new AddBoundaryGeometry();

/**
 * @param {Object} props - Extra boundary properties
 * @returns {Object} Minimal boundary feature carrying a top label
 */
const boundary = (props = {}) => ({
    type: 'Feature',
    properties: {
        id: 'b1',
        baseCoordinates: [[0, 0], [1, 0]],
        text_top: 'CIMA',
        ...props,
    },
});

/**
 * @param {Object} props - Extra boundary properties
 * @returns {number} Label offset the module requested, in symbol-size units
 */
const offsetOf = (props) => {
    const texts = geom.generateBoundaryTexts(boundary(props));
    expect(texts).toHaveLength(1);
    return texts[0].geometry.coordinates[0] - SYMBOL_CENTER_X;
};

describe('repro: o rótulo do limite precisa de coordenada finita e de distância zero honesta', () => {
    it('boundary SEM symbol_size emite rótulo em coordenada finita', () => {
        const texts = geom.generateBoundaryTexts(boundary());

        expect(texts).toHaveLength(1);
        const [lng, lat] = texts[0].geometry.coordinates;
        expect(Number.isFinite(lng)).toBe(true);
        expect(Number.isFinite(lat)).toBe(true);
        // Absolute anchor: DEFAULT_SYMBOL_SIZE (2) times DEFAULT_TEXT_DISTANCE_RATIO
        // (0.9). Without it, any finite garbage would satisfy the assertion above.
        expect(lng).toBeCloseTo(SYMBOL_CENTER_X + 1.8, 10);
    });

    it('CONTROLE: com symbol_size definido a conta continua sendo tamanho vezes razão', () => {
        expect(offsetOf({ symbol_size: 2, text_distance_ratio: 1 })).toBe(2);
        expect(offsetOf({ symbol_size: 4, text_distance_ratio: 0.5 })).toBe(2);
        expect(offsetOf({ symbol_size: 3 })).toBeCloseTo(2.7, 10);
    });

    it('text_distance_ratio 0 gruda o rótulo no símbolo, em vez de virar 0.9', () => {
        expect(offsetOf({ symbol_size: 2, text_distance_ratio: 0 })).toBe(0);
        // ...and it is no longer indistinguishable from the missing ratio.
        expect(offsetOf({ symbol_size: 2, text_distance_ratio: 0 }))
            .not.toBe(offsetOf({ symbol_size: 2 }));
    });

    it('todo símbolo/razão não-finito cai no padrão em vez de emitir NaN', () => {
        const naoFinitos = [undefined, null, NaN, Infinity, -Infinity, '2'];
        expect(naoFinitos).toHaveLength(6);

        for (const bad of naoFinitos) {
            expect(Number.isFinite(offsetOf({ symbol_size: bad, text_distance_ratio: 1 }))).toBe(true);
            expect(Number.isFinite(offsetOf({ symbol_size: 2, text_distance_ratio: bad }))).toBe(true);
        }
    });
});

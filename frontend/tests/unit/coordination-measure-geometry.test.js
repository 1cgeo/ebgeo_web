// Path: tests/unit/coordination-measure-geometry.test.js

/**
 * @fileoverview Pins `military_tools/coordination_measure_tool/add_coordination_measure_geometry.js`.
 *
 * WHAT THIS SUITE HOLDS
 *  - `calculateZoomAdjustedSize`: the 2^(delta zoom) law, the UPPER clamp of 10
 *    (the sibling in the text tool clamps at 255, and the image tool also at 10),
 *    the absence of any lower clamp, and that neither NaN nor a negative base is
 *    guarded;
 *  - `getBoundingBox`: the flat 111320 m/degree conversion with NO cosine
 *    correction, so the box is too wide away from the equator;
 *  - the three property classifiers (`affectsSIDC`, `affectsTextModifiers`,
 *    `affectsVisuals`) and the invariant that they are pairwise disjoint;
 *  - `moveSymbol` and `generatePointGeometry` (z is dropped, a fresh array is returned);
 *  - the anchor arithmetic and the `effectiveZoom !== null` branch of
 *    `calculateSelectionBoxGeometry`, driven by a stub uiManager, where 0 is a
 *    LEGITIMATE zoom and must not be swallowed as falsy.
 *
 * WHAT IT DOES NOT REACH
 *  - `add_coordination_measure_control.js` (IControl, store I/O, PNG pipeline);
 *  - the real `uiManager`: `calculateExpandedDimensions` and `pixelsToDegrees` are
 *    stubbed, so the numbers below fix the WIRING (which argument goes where,
 *    which zoom is used, how the anchor shifts the centre), never the projection
 *    maths of the real helpers.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// The module reaches BaseGeometry through the `@tools` barrel, which drags DOM and
// MapLibre. Only `createSelectionBoxFromDegrees` is inherited and used here, so the
// mock reproduces it verbatim (see tool_manager/base_geometry.js).
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }

        createSelectionBoxFromDegrees(coordinates, widthDegrees, heightDegrees) {
            const [lng, lat] = coordinates;
            const halfWidth = widthDegrees / 2;
            const halfHeight = heightDegrees / 2;

            return {
                type: 'Polygon',
                coordinates: [[
                    [lng - halfWidth, lat - halfHeight],
                    [lng + halfWidth, lat - halfHeight],
                    [lng + halfWidth, lat + halfHeight],
                    [lng - halfWidth, lat + halfHeight],
                    [lng - halfWidth, lat - halfHeight],
                ]],
            };
        }
    },
}));

const { default: AddCoordinationMeasureGeometry } = await import(
    '../../src/js/military_tools/coordination_measure_tool/add_coordination_measure_geometry.js'
);

const geom = new AddCoordinationMeasureGeometry();

/** Metres per degree the module hardcodes (equator, no cosine correction). */
const METRES_PER_DEGREE = 111320;

/**
 * Stub uiManager that records how it was called.
 * `pixelsToDegrees` is deliberately linear and zoom-free so the assertions read the
 * WIRING rather than a projection.
 * @returns {Object} Stub with spies attached
 */
function stubUiManager() {
    return {
        calculateExpandedDimensions: vi.fn((width, height) => ({ width, height })),
        pixelsToDegrees: vi.fn((pixels) => pixels / 1000),
    };
}

// ============================================================================
// generatePointGeometry
// ============================================================================

describe('AddCoordinationMeasureGeometry.generatePointGeometry', () => {
    it('emits a GeoJSON Point from the first two components', () => {
        expect(geom.generatePointGeometry([-43.2, -22.9]))
            .toEqual({ type: 'Point', coordinates: [-43.2, -22.9] });
    });

    it('DROPS the altitude component', () => {
        expect(geom.generatePointGeometry([1, 2, 300]).coordinates).toEqual([1, 2]);
    });

    it('returns a NEW array, not the caller input', () => {
        const input = [1, 2];

        expect(geom.generatePointGeometry(input).coordinates).not.toBe(input);
    });

    it('does not validate: a missing second component becomes undefined', () => {
        expect(geom.generatePointGeometry([1]).coordinates).toEqual([1, undefined]);
    });

    it('generate() is a pass-through', () => {
        expect(geom.generate([5, 6])).toEqual(geom.generatePointGeometry([5, 6]));
    });
});

// ============================================================================
// createHandles / updateFromHandle — deliberate no-ops
// ============================================================================

describe('AddCoordinationMeasureGeometry handles', () => {
    it('never offers handles and never accepts a handle update', () => {
        expect(geom.createHandles({ properties: {} })).toEqual([]);
        expect(geom.updateFromHandle('anything', [0, 0], { properties: {} })).toBeNull();
    });
});

// ============================================================================
// calculateZoomAdjustedSize
// ============================================================================

describe('AddCoordinationMeasureGeometry.calculateZoomAdjustedSize', () => {
    it('returns the base size when the zoom has not moved', () => {
        expect(geom.calculateZoomAdjustedSize(3, 10, 10)).toBe(3);
        expect(geom.calculateZoomAdjustedSize(0, 10, 10)).toBe(0);
    });

    it('doubles per zoom level up and halves per level down', () => {
        expect(geom.calculateZoomAdjustedSize(2, 10, 11)).toBe(4);
        expect(geom.calculateZoomAdjustedSize(2, 10, 12)).toBe(8);
        expect(geom.calculateZoomAdjustedSize(2, 10, 9)).toBe(1);
        expect(geom.calculateZoomAdjustedSize(2, 10, 8)).toBe(0.5);
    });

    it('clamps at 10, NOT at the 255 used by the text tool', () => {
        expect(geom.calculateZoomAdjustedSize(5, 0, 20)).toBe(10);
        expect(geom.calculateZoomAdjustedSize(1, 0, 4)).toBe(10);
        // 1 * 2^3 = 8 is still under the clamp.
        expect(geom.calculateZoomAdjustedSize(1, 0, 3)).toBe(8);
    });

    it('has NO lower clamp, so a negative base stays negative', () => {
        expect(geom.calculateZoomAdjustedSize(-2, 10, 11)).toBe(-4);
    });

    it('does not guard NaN: Math.min(NaN, 10) is NaN', () => {
        expect(Number.isNaN(geom.calculateZoomAdjustedSize(NaN, 10, 11))).toBe(true);
        expect(Number.isNaN(geom.calculateZoomAdjustedSize(2, NaN, 11))).toBe(true);
        expect(Number.isNaN(geom.calculateZoomAdjustedSize(2, 10, NaN))).toBe(true);
    });

    it('collapses to 0 for an infinitely deep zoom-out and clamps for zoom-in', () => {
        expect(geom.calculateZoomAdjustedSize(2, Infinity, 10)).toBe(0);
        expect(geom.calculateZoomAdjustedSize(2, 10, Infinity)).toBe(10);
    });

    it('is monotonic in currentZoom and never exceeds 10 for a non-negative base', () => {
        fc.assert(fc.property(
            fc.double({ min: 0, max: 20, noNaN: true }),
            fc.double({ min: -5, max: 25, noNaN: true }),
            fc.double({ min: -5, max: 25, noNaN: true }),
            (base, zoomA, zoomB) => {
                const low = Math.min(zoomA, zoomB);
                const high = Math.max(zoomA, zoomB);
                const atLow = geom.calculateZoomAdjustedSize(base, 10, low);
                const atHigh = geom.calculateZoomAdjustedSize(base, 10, high);

                expect(atHigh).toBeGreaterThanOrEqual(atLow);
                expect(atHigh).toBeLessThanOrEqual(10);
            }
        ), { numRuns: 300 });
    });
});

// ============================================================================
// getBoundingBox
// ============================================================================

describe('AddCoordinationMeasureGeometry.getBoundingBox', () => {
    it('centres a box of (width * size * 0.5 / 111320) degrees on the point', () => {
        const box = geom.getBoundingBox([10, 20], 80, 40, 2);
        const halfW = (80 * 2 * 0.5) / METRES_PER_DEGREE / 2;
        const halfH = (40 * 2 * 0.5) / METRES_PER_DEGREE / 2;

        expect(box).toEqual([10 - halfW, 20 - halfH, 10 + halfW, 20 + halfH]);
    });

    it('degenerates to the point itself when size is 0', () => {
        expect(geom.getBoundingBox([10, 20], 80, 40, 0)).toEqual([10, 20, 10, 20]);
    });

    it('LIMITATION: no cosine correction, so a polar box is as wide as an equatorial one', () => {
        const atEquator = geom.getBoundingBox([0, 0], 80, 40, 1);
        const atSixty = geom.getBoundingBox([0, 60], 80, 40, 1);

        expect(atSixty[2] - atSixty[0]).toBeCloseTo(atEquator[2] - atEquator[0], 12);
    });

    it('is symmetric around the point and always ordered min <= max', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -85, max: 85, noNaN: true }),
            fc.double({ min: 0, max: 500, noNaN: true }),
            fc.double({ min: 0, max: 500, noNaN: true }),
            fc.double({ min: 0, max: 10, noNaN: true }),
            (lng, lat, width, height, size) => {
                const [minLng, minLat, maxLng, maxLat] = geom.getBoundingBox(
                    [lng, lat], width, height, size
                );

                expect(minLng).toBeLessThanOrEqual(maxLng);
                expect(minLat).toBeLessThanOrEqual(maxLat);
                expect((minLng + maxLng) / 2).toBeCloseTo(lng, 9);
                expect((minLat + maxLat) / 2).toBeCloseTo(lat, 9);
            }
        ), { numRuns: 300 });
    });
});

// ============================================================================
// moveSymbol
// ============================================================================

describe('AddCoordinationMeasureGeometry.moveSymbol', () => {
    it('adds the deltas componentwise and returns a fresh array', () => {
        const input = [10, 20];
        const moved = geom.moveSymbol(input, 1, -2);

        expect(moved).toEqual([11, 18]);
        expect(moved).not.toBe(input);
        expect(input).toEqual([10, 20]);
    });

    it('DROPS the altitude component', () => {
        expect(geom.moveSymbol([1, 2, 300], 0, 0)).toEqual([1, 2]);
    });

    it('round-trips: move by (+dx, +dy) then by (-dx, -dy)', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -90, max: 90, noNaN: true }),
            fc.double({ min: -10, max: 10, noNaN: true }),
            fc.double({ min: -10, max: 10, noNaN: true }),
            (lng, lat, dx, dy) => {
                const back = geom.moveSymbol(geom.moveSymbol([lng, lat], dx, dy), -dx, -dy);

                expect(back[0]).toBeCloseTo(lng, 9);
                expect(back[1]).toBeCloseTo(lat, 9);
            }
        ), { numRuns: 300 });
    });
});

// ============================================================================
// Property classifiers
// ============================================================================

describe('AddCoordinationMeasureGeometry property classifiers', () => {
    const SIDC = ['pointCode', 'echelonCode'];
    const TEXT_MODIFIERS = [
        'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
        'classeSuprimento', 'status', 'numeroConcentracao', 'altitude', 'fillColor',
    ];
    const VISUALS = ['size', 'rotation', 'width', 'height'];

    it('recognises exactly the two SIDC properties', () => {
        expect(SIDC).toHaveLength(2);
        SIDC.forEach((property) => expect(geom.affectsSIDC(property)).toBe(true));
        expect(geom.affectsSIDC('size')).toBe(false);
        expect(geom.affectsSIDC('nome')).toBe(false);
    });

    it('recognises the ten text modifiers, fillColor included', () => {
        expect(TEXT_MODIFIERS).toHaveLength(10);
        TEXT_MODIFIERS.forEach((p) => expect(geom.affectsTextModifiers(p)).toBe(true));
        expect(geom.affectsTextModifiers('pointCode')).toBe(false);
    });

    it('recognises the four visual properties', () => {
        expect(VISUALS).toHaveLength(4);
        VISUALS.forEach((p) => expect(geom.affectsVisuals(p)).toBe(true));
        expect(geom.affectsVisuals('opacity')).toBe(false);
    });

    it('keeps the three sets pairwise DISJOINT', () => {
        const all = [...SIDC, ...TEXT_MODIFIERS, ...VISUALS];

        expect(all).toHaveLength(16);
        expect(new Set(all).size).toBe(16);

        all.forEach((property) => {
            const hits = [
                geom.affectsSIDC(property),
                geom.affectsTextModifiers(property),
                geom.affectsVisuals(property),
            ].filter(Boolean);

            expect(hits).toHaveLength(1);
        });
    });

    it('answers false for undefined, null and the empty string', () => {
        [undefined, null, ''].forEach((property) => {
            expect(geom.affectsSIDC(property)).toBe(false);
            expect(geom.affectsTextModifiers(property)).toBe(false);
            expect(geom.affectsVisuals(property)).toBe(false);
        });
    });

    it('classifies no property outside the sixteen listed', () => {
        fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 20 }), (property) => {
            const known = [...SIDC, ...TEXT_MODIFIERS, ...VISUALS].includes(property);
            const anyHit = geom.affectsSIDC(property)
                || geom.affectsTextModifiers(property)
                || geom.affectsVisuals(property);

            expect(anyHit).toBe(known);
        }), { numRuns: 300 });
    });
});

// ============================================================================
// calculateSelectionBoxGeometry / recalculateSelectionBox
// ============================================================================

describe('AddCoordinationMeasureGeometry.calculateSelectionBoxGeometry', () => {
    it('scales by size * 0.5, adds 5 px of padding on each side, and closes the ring', () => {
        const ui = stubUiManager();
        const polygon = geom.calculateSelectionBoxGeometry([10, 20], 80, 40, 2, 0, 12, ui);

        expect(ui.calculateExpandedDimensions).toHaveBeenCalledWith(80, 40, 0);
        // (80 + 10) / 1000 and (40 + 10) / 1000 by the stub.
        const halfW = 0.09 / 2;
        const halfH = 0.05 / 2;

        expect(polygon.type).toBe('Polygon');
        expect(polygon.coordinates[0]).toHaveLength(5);
        expect(polygon.coordinates[0][0]).toEqual([10 - halfW, 20 - halfH]);
        expect(polygon.coordinates[0][4]).toEqual(polygon.coordinates[0][0]);
    });

    it('uses createdAtZoom when effectiveZoom is omitted', () => {
        const ui = stubUiManager();

        geom.calculateSelectionBoxGeometry([0, 0], 80, 40, 1, 0, 12, ui);

        ui.pixelsToDegrees.mock.calls.forEach((call) => expect(call[2]).toBe(12));
    });

    it('uses effectiveZoom 0 rather than falling back: 0 is a real zoom level', () => {
        const ui = stubUiManager();

        geom.calculateSelectionBoxGeometry([0, 0], 80, 40, 1, 0, 12, ui, 'center', 0);

        expect(ui.pixelsToDegrees.mock.calls.length).toBeGreaterThan(0);
        ui.pixelsToDegrees.mock.calls.forEach((call) => expect(call[2]).toBe(0));
    });

    it('does not shift the centre for the default anchor', () => {
        const ui = stubUiManager();
        const polygon = geom.calculateSelectionBoxGeometry([10, 20], 80, 40, 1, 0, 12, ui);
        const ring = polygon.coordinates[0];

        expect((ring[0][1] + ring[2][1]) / 2).toBeCloseTo(20, 12);
        expect(ui.pixelsToDegrees).toHaveBeenCalledTimes(2);
    });

    it("raises the centre for a 'bottom' anchor and lowers it for a 'top' one", () => {
        const ui = stubUiManager();
        const scaledHalfHeight = (40 * 1 * 0.5) / 2;
        const offset = scaledHalfHeight / 1000;

        const bottom = geom.calculateSelectionBoxGeometry([10, 20], 80, 40, 1, 0, 12, ui, 'bottom');
        const top = geom.calculateSelectionBoxGeometry([10, 20], 80, 40, 1, 0, 12, ui, 'top');

        /** @param {Object} poly - Selection box @returns {number} Ring centre latitude */
        const centreLat = (poly) => (poly.coordinates[0][0][1] + poly.coordinates[0][2][1]) / 2;

        expect(centreLat(bottom)).toBeCloseTo(20 + offset, 12);
        expect(centreLat(top)).toBeCloseTo(20 - offset, 12);
        // Three calls per anchored run: width, height, and the anchor offset.
        expect(ui.pixelsToDegrees).toHaveBeenCalledTimes(6);
    });

    it('does not mutate the coordinates it was handed', () => {
        const ui = stubUiManager();
        const coordinates = [10, 20];

        geom.calculateSelectionBoxGeometry(coordinates, 80, 40, 1, 0, 12, ui, 'bottom');

        expect(coordinates).toEqual([10, 20]);
    });

    it('recalculateSelectionBox passes currentZoom ONLY when correction is off', () => {
        const ui = stubUiManager();
        const feature = {
            geometry: { coordinates: [0, 0] },
            properties: {
                width: 80, height: 40, size: 1, rotation: 0,
                createdAtZoom: 12, anchor: 'center', zoomCorrectionEnabled: false,
            },
        };

        geom.recalculateSelectionBox(feature, ui, 7);
        ui.pixelsToDegrees.mock.calls.forEach((call) => expect(call[2]).toBe(7));

        const ui2 = stubUiManager();
        feature.properties.zoomCorrectionEnabled = true;
        geom.recalculateSelectionBox(feature, ui2, 7);
        ui2.pixelsToDegrees.mock.calls.forEach((call) => expect(call[2]).toBe(12));
    });

    it('recalculateSelectionBox defaults a missing anchor to center', () => {
        const ui = stubUiManager();
        const feature = {
            geometry: { coordinates: [0, 0] },
            properties: { width: 80, height: 40, size: 1, rotation: 0, createdAtZoom: 12 },
        };

        geom.recalculateSelectionBox(feature, ui);

        // Two calls only: no anchor offset was computed.
        expect(ui.pixelsToDegrees).toHaveBeenCalledTimes(2);
    });
});

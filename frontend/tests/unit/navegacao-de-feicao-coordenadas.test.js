// Path: tests/unit/navegacao-de-feicao-coordenadas.test.js

/**
 * @fileoverview Pins `utilities/feature_navigation_utils.js` by driving
 * `zoomToFeature` against a fake `maplibregl.LngLatBounds` and a stub map.
 *
 * The subject is the private `extractAllCoordinates`, which is not exported:
 * the fake bounds object records every `extend` call, so the flat list it
 * produces IS the assertion surface.
 *
 * What this suite HOLDS:
 * - the recursive flatten across Point / LineString / Polygon / MultiLineString
 *   / MultiPolygon, at any nesting depth;
 * - the `typeof coordArray[0] === 'number' && length >= 2` leaf test, which
 *   keeps a 3-component `[lng, lat, z]` intact, silently drops a 1-component
 *   array, and drops string coordinates without throwing;
 * - the selectionBox override: only for the four declared sources, and only
 *   when the box is a Polygon;
 * - the padding formula and its clamp to [50, 200];
 * - the two early exits (no geometry, no coordinates) that leave the map alone.
 *
 * What it does NOT reach: the real MapLibre camera, `zoomAndSelectFeature`'s
 * selection manager beyond the call order, and the visual result of the flight.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

const getSourceTypeFromStorage = vi.fn((t) => t);

vi.mock('@store', () => ({
    getSourceTypeFromStorage: (...a) => getSourceTypeFromStorage(...a),
}));

/**
 * O duble do MapLibre, que desde 2026-09-05 entra pelo PONTO UNICO e nao mais por
 * `globalThis.maplibregl`. O objeto e ESTAVEL de proposito: o modulo sob teste guarda a
 * ligacao `maplibregl` no import, e cada `beforeEach` troca so a propriedade
 * `LngLatBounds` dentro dele. Um objeto novo por caso nao alcancaria a ligacao ja
 * resolvida, e a classe de baixo (`FakeBounds`) ainda esta em TDZ quando esta fabrica
 * roda, o que e por que ela nao aparece aqui dentro.
 */
const dubleDoMapLibre = {};
vi.mock('@js/map/maplibre.js', () => ({ maplibregl: dubleDoMapLibre }));

const { zoomToFeature, zoomAndSelectFeature } =
    await import('../../src/js/utilities/feature_navigation_utils.js');

/** Records every coordinate handed to `extend`, and answers like LngLatBounds. */
class FakeBounds {
    constructor() {
        this.extended = [];
    }

    extend(coord) {
        this.extended.push(coord);
    }

    isEmpty() {
        return this.extended.length === 0;
    }

    getNorthEast() {
        return {
            lng: Math.max(...this.extended.map(c => c[0])),
            lat: Math.max(...this.extended.map(c => c[1])),
        };
    }

    getSouthWest() {
        return {
            lng: Math.min(...this.extended.map(c => c[0])),
            lat: Math.min(...this.extended.map(c => c[1])),
        };
    }
}

let lastBounds;

const stubMap = (zoom = 8) => ({
    getZoom: () => zoom,
    flyTo: vi.fn(),
    fitBounds: vi.fn(),
});

const featureWith = (geometry, properties = {}) => ({
    type: 'Feature', geometry, properties,
});

beforeEach(() => {
    vi.clearAllMocks();
    lastBounds = null;
    dubleDoMapLibre.LngLatBounds = class extends FakeBounds {
        constructor() {
            super();
            lastBounds = this;
        }
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    delete dubleDoMapLibre.LngLatBounds;
    vi.restoreAllMocks();
});

/** Runs zoomToFeature with a zero duration and returns the map stub. */
async function fly(geometry, properties = {}, options = {}) {
    const map = stubMap(options.zoom ?? 8);
    await zoomToFeature(featureWith(geometry, properties), map, {
        duration: 0, ...options,
    });
    return map;
}

const extendedOf = () => (lastBounds ? lastBounds.extended : null);

// ============================================================================
// extractAllCoordinates, observed through bounds.extend
// ============================================================================

describe('extractAllCoordinates — flattening by geometry kind', () => {
    it('a LineString contributes each vertex once, in order', async () => {
        await fly({ type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]] });
        expect(extendedOf()).toEqual([[0, 0], [1, 1], [2, 2]]);
    });

    it('a Polygon flattens its ring (depth 3)', async () => {
        await fly({
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        });
        expect(extendedOf()).toHaveLength(4);
        expect(extendedOf()[3]).toEqual([0, 0]);
    });

    it('a Polygon with a hole contributes the hole vertices too', async () => {
        await fly({
            type: 'Polygon',
            coordinates: [
                [[0, 0], [10, 0], [10, 10], [0, 0]],
                [[1, 1], [2, 1], [2, 2], [1, 1]],
            ],
        });
        expect(extendedOf()).toHaveLength(8);
    });

    it('a MultiLineString flattens depth 3', async () => {
        await fly({
            type: 'MultiLineString',
            coordinates: [[[0, 0], [1, 1]], [[5, 5], [6, 6]]],
        });
        expect(extendedOf()).toEqual([[0, 0], [1, 1], [5, 5], [6, 6]]);
    });

    it('a MultiPolygon flattens depth 4', async () => {
        await fly({
            type: 'MultiPolygon',
            coordinates: [
                [[[0, 0], [1, 0], [1, 1], [0, 0]]],
                [[[5, 5], [6, 5], [6, 6], [5, 5]]],
            ],
        });
        expect(extendedOf()).toHaveLength(8);
        expect(extendedOf()[0]).toEqual([0, 0]);
        expect(extendedOf()[7]).toEqual([5, 5]);
    });

    it('an arbitrarily deep nesting is still flattened', async () => {
        await fly({
            type: 'MultiPolygon',
            coordinates: [[[[[0, 0], [1, 1], [2, 2]]]]],
        });
        expect(extendedOf()).toEqual([[0, 0], [1, 1], [2, 2]]);
    });

    it('KEEPS a third component: [lng, lat, z] reaches the bounds intact', async () => {
        await fly({ type: 'LineString', coordinates: [[0, 0, 300], [1, 1, 400]] });
        expect(extendedOf()).toEqual([[0, 0, 300], [1, 1, 400]]);
    });

    it('the pairs are passed BY REFERENCE, not copied', async () => {
        const coords = [[0, 0], [1, 1]];
        await fly({ type: 'LineString', coordinates: coords });
        expect(extendedOf()[0]).toBe(coords[0]);
    });

    it('OBSERVADO: a 1-component array is not a leaf and contributes nothing', async () => {
        // The leaf test requires `length >= 2`, so `[5]` falls into the recursion
        // arm, where the number 5 is not an array and is dropped in silence.
        const map = await fly({ type: 'LineString', coordinates: [[5], [6]] });
        expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('OBSERVADO: string coordinates are dropped rather than pushed or thrown on', async () => {
        const map = await fly({
            type: 'LineString', coordinates: [['0', '0'], ['1', '1']],
        });
        expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('a MIXED list keeps only the numeric pairs', async () => {
        await fly({
            type: 'LineString', coordinates: [['a', 'b'], [1, 2], [3, 4]],
        });
        expect(extendedOf()).toEqual([[1, 2], [3, 4]]);
    });

    it('coordinates that are not an array at all leave the map alone', async () => {
        const map = await fly({ type: 'Polygon', coordinates: null });
        expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('an empty coordinates array leaves the map alone', async () => {
        const map = await fly({ type: 'Polygon', coordinates: [] });
        expect(map.fitBounds).not.toHaveBeenCalled();
        expect(map.flyTo).not.toHaveBeenCalled();
    });

    it('every extended pair came from the input, and none was invented', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.tuple(
                        fc.integer({ min: -180, max: 180 }),
                        fc.integer({ min: -85, max: 85 })
                    ),
                    { minLength: 1, maxLength: 8 }
                ),
                async (pairs) => {
                    lastBounds = null;
                    await fly({ type: 'LineString', coordinates: pairs.map(p => [...p]) });
                    expect(extendedOf()).toHaveLength(pairs.length);
                    extendedOf().forEach((coord, i) => {
                        expect(coord).toEqual(pairs[i]);
                    });
                }
            ),
            { numRuns: 30 }
        );
    });
});

// ============================================================================
// The selectionBox override
// ============================================================================

describe('zoomToFeature — the selectionBox override', () => {
    const box = {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    };

    it('uses the selectionBox for the four declared sources', async () => {
        for (const source of ['text', 'image', 'military_symbol', 'magnetic_declination']) {
            lastBounds = null;
            const map = await fly(
                { type: 'Point', coordinates: [50, 50] },
                { source, selectionBox: box }
            );
            expect(map.fitBounds).toHaveBeenCalledTimes(1);
            expect(map.flyTo).not.toHaveBeenCalled();
            expect(extendedOf()).toHaveLength(5);
        }
    });

    it('ignores the selectionBox for any other source', async () => {
        const map = await fly(
            { type: 'Point', coordinates: [50, 50] },
            { source: 'point', selectionBox: box }
        );
        expect(map.flyTo).toHaveBeenCalledTimes(1);
        expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('ignores a selectionBox that is not a Polygon', async () => {
        const map = await fly(
            { type: 'Point', coordinates: [50, 50] },
            { source: 'text', selectionBox: { type: 'LineString', coordinates: [[0, 0]] } }
        );
        expect(map.flyTo).toHaveBeenCalledTimes(1);
    });

    it('ignores a declared source with no selectionBox at all', async () => {
        const map = await fly({ type: 'Point', coordinates: [50, 50] }, { source: 'text' });
        expect(map.flyTo).toHaveBeenCalledTimes(1);
    });

    it('survives a feature with no properties', async () => {
        const map = await fly({ type: 'Point', coordinates: [50, 50] }, undefined);
        expect(map.flyTo).toHaveBeenCalledTimes(1);
    });
});

// ============================================================================
// Point flight and padding
// ============================================================================

describe('zoomToFeature — Point', () => {
    it('flies to the coordinates with a floor of zoom 15', async () => {
        const map = await fly({ type: 'Point', coordinates: [10, 20] }, {}, { zoom: 8 });
        expect(map.flyTo).toHaveBeenCalledWith({
            center: [10, 20], zoom: 15, duration: 0,
        });
    });

    it('keeps the current zoom when it is already deeper than 15', async () => {
        const map = await fly({ type: 'Point', coordinates: [10, 20] }, {}, { zoom: 18 });
        expect(map.flyTo.mock.calls[0][0].zoom).toBe(18);
    });

    it('ignores minZoom from the options for a Point (the floor is hard-coded)', async () => {
        const map = await fly(
            { type: 'Point', coordinates: [10, 20] }, {}, { zoom: 8, minZoom: 3 }
        );
        expect(map.flyTo.mock.calls[0][0].zoom).toBe(15);
    });
});

describe('zoomToFeature — the padding formula and its clamp', () => {
    /** A square bbox of the given side, in degrees. */
    const square = (side) => ({
        type: 'LineString', coordinates: [[0, 0], [side, side]],
    });

    it('clamps a tiny bbox up to the 50 px floor', async () => {
        const map = await fly(square(0.0001), {}, {});
        expect(map.fitBounds.mock.calls[0][1].padding).toBe(50);
    });

    it('clamps a large bbox down to the 200 px ceiling', async () => {
        const map = await fly(square(10), {}, {});
        expect(map.fitBounds.mock.calls[0][1].padding).toBe(200);
    });

    it('uses the computed value inside the band, rounded', async () => {
        // 0.005 deg * 100000 * 0.2 = 100 px.
        const map = await fly(square(0.005), {}, {});
        expect(map.fitBounds.mock.calls[0][1].padding).toBe(100);
    });

    it('scales with paddingPercent', async () => {
        const map = await fly(square(0.005), {}, { paddingPercent: 0.1 });
        expect(map.fitBounds.mock.calls[0][1].padding).toBe(50);
    });

    it('a paddingPercent of 0 falls to the floor rather than to zero padding', async () => {
        const map = await fly(square(1), {}, { paddingPercent: 0 });
        expect(map.fitBounds.mock.calls[0][1].padding).toBe(50);
    });

    it('takes the LARGER of the two bbox dimensions', async () => {
        // 0.0001 wide, 0.005 tall: the tall side decides.
        const map = await fly(
            { type: 'LineString', coordinates: [[0, 0], [0.0001, 0.005]] }, {}, {}
        );
        expect(map.fitBounds.mock.calls[0][1].padding).toBe(100);
    });

    it('forwards maxZoom and duration to fitBounds, and the bounds object itself', async () => {
        const map = await fly(square(0.005), {}, { maxZoom: 14 });
        const [bounds, options] = map.fitBounds.mock.calls[0];
        expect(bounds).toBe(lastBounds);
        expect(options.maxZoom).toBe(14);
        expect(options.duration).toBe(0);
    });

    it('the padding is always an integer inside [50, 200]', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.double({ min: 1e-6, max: 50, noNaN: true }),
                fc.double({ min: 0, max: 1, noNaN: true }),
                async (side, percent) => {
                    const map = await fly(square(side), {}, { paddingPercent: percent });
                    const padding = map.fitBounds.mock.calls[0][1].padding;
                    expect(Number.isInteger(padding)).toBe(true);
                    expect(padding).toBeGreaterThanOrEqual(50);
                    expect(padding).toBeLessThanOrEqual(200);
                }
            ),
            { numRuns: 30 }
        );
    });
});

// ============================================================================
// Early exits
// ============================================================================

describe('zoomToFeature — early exits', () => {
    it('does nothing for a null feature or one without geometry', async () => {
        const map = stubMap();
        await zoomToFeature(null, map);
        await zoomToFeature({}, map);
        await zoomToFeature({ geometry: null }, map);
        expect(map.flyTo).not.toHaveBeenCalled();
        expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('does nothing for an unsupported geometry type', async () => {
        const map = await fly({ type: 'GeometryCollection', geometries: [] });
        expect(map.flyTo).not.toHaveBeenCalled();
        expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('does nothing for MultiPoint, which is NOT in the supported list', async () => {
        const map = await fly({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] });
        expect(map.fitBounds).not.toHaveBeenCalled();
    });
});

// ============================================================================
// zoomAndSelectFeature
// ============================================================================

describe('zoomAndSelectFeature', () => {
    it('clears the selection, selects through the translated source type, then zooms', async () => {
        const order = [];
        const selectionManager = {
            deselectAllFeatures: vi.fn(() => order.push('deselect')),
            selectFeature: vi.fn(async () => order.push('select')),
        };
        getSourceTypeFromStorage.mockReturnValue('point');
        const map = stubMap();
        map.flyTo = vi.fn(() => order.push('fly'));

        const feature = featureWith({ type: 'Point', coordinates: [1, 2] });
        await zoomAndSelectFeature(feature, map, selectionManager, 'points', 'f1');

        expect(getSourceTypeFromStorage).toHaveBeenCalledWith('points');
        expect(selectionManager.selectFeature).toHaveBeenCalledWith('point', 'f1', feature);
        expect(order).toEqual(['deselect', 'select', 'fly']);
    });

    it('still deselects and selects when the geometry cannot be flown to', async () => {
        const selectionManager = {
            deselectAllFeatures: vi.fn(),
            selectFeature: vi.fn(async () => {}),
        };
        const map = stubMap();
        await zoomAndSelectFeature(
            featureWith({ type: 'MultiPoint', coordinates: [] }),
            map, selectionManager, 'points', 'f1'
        );
        expect(selectionManager.deselectAllFeatures).toHaveBeenCalledTimes(1);
        expect(selectionManager.selectFeature).toHaveBeenCalledTimes(1);
        expect(map.fitBounds).not.toHaveBeenCalled();
    });
});

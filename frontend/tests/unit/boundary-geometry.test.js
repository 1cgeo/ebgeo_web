import { describe, it, expect, beforeAll, vi } from 'vitest';

// add_boundary_geometry imports BaseGeometry from the `@tools` barrel, which pulls
// in DOM/MapLibre-coupled modules. Mock the barrel with a trivial BaseGeometry so
// the pure geometry logic can be tested in the `node` environment.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
    },
}));

// Minimal turf stub. Distances are linear along a line of length 10 km; `along`
// encodes the requested distance into the point so it is observable if needed.
// nearestPointOnLine reports a configurable `location` (set per test).
let nearestLocation = 8;
// Local line bearing reported by the stub; tests that exercise label rotation
// set it explicitly (the default 90 is the "line running east" case).
let stubBearing = 90;
// Ground distance the stub reports for a size-handle drag (km from centre).
let stubDistance = 3;
// The two calls that carry a size in KILOMETRES are recorded, because that is the
// only observable an effective-vs-authored symbol size leaves in this stub world:
// `along` receives the gap boundaries (a function of the symbol width) and
// `destination` receives the label offset.
const alongCalls = [];
const destinationCalls = [];
beforeAll(() => {
    globalThis.turf = {
        lineString: (coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }),
        length: () => 10,
        along: (_line, dist) => {
            alongCalls.push(dist);
            return { type: 'Feature', geometry: { type: 'Point', coordinates: [dist, 0] } };
        },
        point: (c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } }),
        lineSlice: () => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } }),
        midpoint: (a) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: a.geometry.coordinates } }),
        nearestPointOnLine: () => ({ properties: { location: nearestLocation } }),
        bearing: () => stubBearing,
        distance: () => stubDistance,
        destination: (_from, dist) => {
            destinationCalls.push(dist);
            return { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } };
        },
        circle: () => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 0], [0, 0]]] } }),
    };
});

const { default: AddBoundaryGeometry } = await import('../../src/js/military_tools/boundary_tool/add_boundary_geometry.js');

const geom = new AddBoundaryGeometry();

// ============================================================================
// getSymbolInstances — migration-on-read + normalization
// ============================================================================

describe('AddBoundaryGeometry.getSymbolInstances', () => {
    it('uses a valid symbol_instances array as-is', () => {
        const out = geom.getSymbolInstances({
            symbol_instances: [{ ratio: 0.2, showLabels: true }, { ratio: 0.8, showLabels: false }],
        });
        expect(out).toEqual([{ ratio: 0.2, showLabels: true }, { ratio: 0.8, showLabels: false }]);
    });

    it('falls back to the legacy single symbol_position_ratio', () => {
        const out = geom.getSymbolInstances({ symbol_position_ratio: 0.3 });
        expect(out).toEqual([{ ratio: 0.3, showLabels: true }]);
    });

    it('defaults to a single centred instance when nothing is set', () => {
        expect(geom.getSymbolInstances({})).toEqual([{ ratio: 0.5, showLabels: true }]);
        expect(geom.getSymbolInstances(undefined)).toEqual([{ ratio: 0.5, showLabels: true }]);
    });

    it('clamps ratios into the placement range and treats showLabels as opt-out', () => {
        const out = geom.getSymbolInstances({
            symbol_instances: [{ ratio: 5 }, { ratio: -1, showLabels: false }],
        });
        expect(out[0]).toEqual({ ratio: 0.99, showLabels: true });
        expect(out[1]).toEqual({ ratio: 0.01, showLabels: false });
    });

    it('coerces non-finite/missing ratios to centered (preserving entry count and index)', () => {
        const out = geom.getSymbolInstances({
            symbol_instances: [{ ratio: NaN }, { ratio: Infinity }, { showLabels: true }],
        });
        // All three are objects → kept (clampRatio coerces bad ratios) so handle
        // indices stay aligned with the persisted array.
        expect(out).toEqual([
            { ratio: 0.5, showLabels: true },
            { ratio: 0.5, showLabels: true },
            { ratio: 0.5, showLabels: true },
        ]);
    });

    it('falls back when the array has no usable object entries', () => {
        expect(geom.getSymbolInstances({ symbol_instances: [null, 5, 'x'] }))
            .toEqual([{ ratio: 0.5, showLabels: true }]);
    });

    it('returns fresh objects (not aliased to the source array)', () => {
        const src = { symbol_instances: [{ ratio: 0.5, showLabels: true }] };
        const out = geom.getSymbolInstances(src);
        expect(out[0]).not.toBe(src.symbol_instances[0]);
    });
});

// ============================================================================
// getAnchorInstance — shared handles anchor to the leftmost symbol
// ============================================================================

describe('AddBoundaryGeometry.getAnchorInstance', () => {
    it('returns the lowest-ratio instance regardless of array order', () => {
        expect(geom.getAnchorInstance([
            { ratio: 0.7, showLabels: true },
            { ratio: 0.3, showLabels: false },
            { ratio: 0.9, showLabels: true },
        ])).toEqual({ ratio: 0.3, showLabels: false });
    });

    it('returns the sole instance when there is only one', () => {
        expect(geom.getAnchorInstance([{ ratio: 0.5, showLabels: true }]))
            .toEqual({ ratio: 0.5, showLabels: true });
    });
});

// ============================================================================
// createLineWithGaps — one gap per instance, merged, complement segments
// ============================================================================

describe('AddBoundaryGeometry.createLineWithGaps', () => {
    const coords = [[0, 0], [1, 0], [2, 0]];
    // echelon 'X' (1 char) at size 0.1 → gapWidth = 1 * 0.1 * 1.5 * 1.2 = 0.18 km.
    const size = 0.1;

    it('one instance leaves a single gap → 2 segments', () => {
        const segs = geom.createLineWithGaps(coords, [{ ratio: 0.5 }], size, 'X');
        expect(segs).toHaveLength(2);
    });

    it('three separated instances → 4 segments', () => {
        const segs = geom.createLineWithGaps(
            coords,
            [{ ratio: 0.2 }, { ratio: 0.5 }, { ratio: 0.8 }],
            size,
            'X',
        );
        expect(segs).toHaveLength(4);
    });

    it('merges overlapping gaps from close instances → 2 segments', () => {
        // centres 5.0 and 5.05 km → gaps [4.91,5.09] and [4.96,5.14] overlap → one gap.
        const segs = geom.createLineWithGaps(
            coords,
            [{ ratio: 0.5 }, { ratio: 0.505 }],
            size,
            'X',
        );
        expect(segs).toHaveLength(2);
    });

    it('returns an empty list when there are fewer than 2 coordinates', () => {
        expect(geom.createLineWithGaps([[0, 0]], [{ ratio: 0.5 }], size, 'X')).toEqual([]);
    });

    it('falls back to the raw coordinates when fewer than 2 are valid', () => {
        const raw = [[0, 0], [NaN, 0]];
        expect(geom.createLineWithGaps(raw, [{ ratio: 0.5 }], size, 'X')).toEqual([raw]);
    });
});

// ============================================================================
// updateFromHandle — symbol_handle moves only the indexed instance
// ============================================================================

describe('AddBoundaryGeometry.updateFromHandle (symbol_handle)', () => {
    const baseFeature = () => ({
        properties: {
            baseCoordinates: [[0, 0], [1, 0], [2, 0]],
            echelon: 'XX',
            symbol_size: 0.1,
            symbol_instances: [
                { ratio: 0.3, showLabels: true },
                { ratio: 0.6, showLabels: false },
            ],
        },
    });

    it('updates only the dragged instance ratio (location 8 / length 10 = 0.8)', () => {
        nearestLocation = 8;
        const result = geom.updateFromHandle('symbol_handle', [9, 0], baseFeature(), 1);
        expect(result.properties.symbol_instances[1].ratio).toBeCloseTo(0.8, 6);
        // showLabels preserved on the moved instance, and the other instance untouched.
        expect(result.properties.symbol_instances[1].showLabels).toBe(false);
        expect(result.properties.symbol_instances[0]).toEqual({ ratio: 0.3, showLabels: true });
    });

    it('clamps the resulting ratio to the placement range', () => {
        nearestLocation = 10; // 10 / 10 = 1.0 → clamps to 0.99
        const result = geom.updateFromHandle('symbol_handle', [99, 0], baseFeature(), 0);
        expect(result.properties.symbol_instances[0].ratio).toBeCloseTo(0.99, 6);
    });

    it('falls back to index 0 when handleIndex is out of range', () => {
        nearestLocation = 5; // → 0.5
        const result = geom.updateFromHandle('symbol_handle', [5, 0], baseFeature(), 9);
        expect(result.properties.symbol_instances[0].ratio).toBeCloseTo(0.5, 6);
        expect(result.properties.symbol_instances[1].ratio).toBeCloseTo(0.6, 6);
    });

    it('does not mutate the original feature instances', () => {
        nearestLocation = 8;
        const feature = baseFeature();
        geom.updateFromHandle('symbol_handle', [9, 0], feature, 1);
        expect(feature.properties.symbol_instances[1].ratio).toBe(0.6);
    });
});

// ============================================================================
// createHandles — per-instance symbol handles + shared text-distance handle gate
// ============================================================================

describe('AddBoundaryGeometry.createHandles', () => {
    const featureWith = (symbol_instances, extra = {}) => ({
        properties: {
            id: 'b1',
            baseCoordinates: [[0, 0], [1, 0], [2, 0]],
            symbol_size: 0.1,
            ...extra,
            symbol_instances,
        },
    });

    it('emits one symbol handle per instance with matching index', () => {
        const symbolHandles = geom
            .createHandles(featureWith([{ ratio: 0.3, showLabels: true }, { ratio: 0.7, showLabels: true }]))
            .filter(h => h.properties.type === 'symbol_handle');
        expect(symbolHandles).toHaveLength(2);
        expect(symbolHandles.map(h => h.properties.index)).toEqual([0, 1]);
    });

    it('shows the text-distance handle when ANY instance shows labels, not just instances[0]', () => {
        const handles = geom.createHandles(featureWith(
            [{ ratio: 0.3, showLabels: false }, { ratio: 0.7, showLabels: true }],
            { text_top: 'A' },
        ));
        expect(handles.some(h => h.properties.type === 'text_distance_handle')).toBe(true);
    });

    it('omits the text-distance handle when no instance shows labels', () => {
        const handles = geom.createHandles(featureWith(
            [{ ratio: 0.3, showLabels: false }, { ratio: 0.7, showLabels: false }],
            { text_top: 'A' },
        ));
        expect(handles.some(h => h.properties.type === 'text_distance_handle')).toBe(false);
    });
});

// ============================================================================
// generateBoundaryTexts — labels only at instances with showLabels
// ============================================================================

describe('AddBoundaryGeometry.generateBoundaryTexts', () => {
    it('emits text only for instances that opt in (showLabels)', () => {
        const feature = {
            properties: {
                id: 'b1',
                baseCoordinates: [[0, 0], [1, 0], [2, 0]],
                text_top: 'A',
                text_bottom: '',
                text_size: 14,
                symbol_size: 0.1,
                text_distance_ratio: 0.9,
                color: '#000',
                symbol_instances: [
                    { ratio: 0.3, showLabels: true },
                    { ratio: 0.6, showLabels: false },
                ],
            },
        };
        const texts = geom.generateBoundaryTexts(feature);
        // Only text_top is set, only instance 0 shows labels → exactly one feature.
        expect(texts).toHaveLength(1);
        expect(texts[0].id).toBe('b1-text-top-0');
    });

    it('returns nothing when no label text is set', () => {
        const feature = {
            properties: {
                id: 'b1',
                baseCoordinates: [[0, 0], [1, 0]],
                text_top: '',
                text_bottom: '',
                symbol_instances: [{ ratio: 0.5, showLabels: true }],
            },
        };
        expect(geom.generateBoundaryTexts(feature)).toEqual([]);
    });
});

// ============================================================================
// generateBoundaryTexts — zoom-derived size, anchor propagation and rotation
// ============================================================================

describe('AddBoundaryGeometry.generateBoundaryTexts (zoom + orientation)', () => {
    const featureWith = (extra = {}) => ({
        properties: {
            id: 'b1',
            baseCoordinates: [[0, 0], [1, 0], [2, 0]],
            text_top: 'A',
            text_bottom: 'B',
            text_size: 35,
            symbol_size: 0.1,
            text_distance_ratio: 0.9,
            color: '#000',
            symbol_instances: [{ ratio: 0.5, showLabels: true }],
            ...extra,
        },
    });

    it('writes the parent calculatedTextSize onto both labels', () => {
        const texts = geom.generateBoundaryTexts(featureWith({ calculatedTextSize: 70 }));
        expect(texts).toHaveLength(2);
        expect(texts.map(t => t.properties.calculatedTextSize)).toEqual([70, 70]);
        // The authored base travels along so the PDF export can rescale it.
        expect(texts.map(t => t.properties.text_size)).toEqual([35, 35]);
    });

    it('falls back to text_size when the parent has no derived size (legacy)', () => {
        const texts = geom.generateBoundaryTexts(featureWith());
        expect(texts[0].properties.calculatedTextSize).toBe(35);
    });

    it('propagates the zoom anchor to the text features', () => {
        const texts = geom.generateBoundaryTexts(featureWith({
            createdAtZoom: 12.5,
            zoomCorrectionEnabled: false,
        }));
        expect(texts[0].properties.createdAtZoom).toBe(12.5);
        expect(texts[0].properties.zoomCorrectionEnabled).toBe(false);
    });

    it('leaves the anchor undefined for a legacy boundary (export skips it)', () => {
        const texts = geom.generateBoundaryTexts(featureWith());
        expect(texts[0].properties.createdAtZoom).toBeUndefined();
    });

    it('rotates the labels to map north when text_north_facing is on', () => {
        stubBearing = 137;
        try {
            const texts = geom.generateBoundaryTexts(featureWith({ text_north_facing: true }));
            expect(texts.map(t => t.properties.rotation)).toEqual([0, 0]);
        } finally {
            stubBearing = 90;
        }
    });

    it('hangs each north-facing label from the edge that faces the line', () => {
        // Line bearing 137 (running SE): the top label sits at bearing 47 (NE)
        // and hangs from its bottom-left corner; the bottom one sits at 227 (SW)
        // and hangs from its top-right corner. Opposite edges: no overlap.
        stubBearing = 137;
        try {
            const texts = geom.generateBoundaryTexts(featureWith({ text_north_facing: true }));
            expect(texts.map(t => t.properties.anchor)).toEqual(['bottom-left', 'top-right']);
        } finally {
            stubBearing = 90;
        }
    });

    it('keeps both labels centred when the glyphs follow the line', () => {
        stubBearing = 137;
        try {
            const texts = geom.generateBoundaryTexts(featureWith({ text_north_facing: false }));
            expect(texts.map(t => t.properties.anchor)).toEqual(['center', 'center']);
            const legacy = geom.generateBoundaryTexts(featureWith());
            expect(legacy.map(t => t.properties.anchor)).toEqual(['center', 'center']);
        } finally {
            stubBearing = 90;
        }
    });

    it('keeps the legacy perpendicular rotation when the toggle is off', () => {
        stubBearing = 270;
        try {
            const texts = geom.generateBoundaryTexts(featureWith({ text_north_facing: false }));
            expect(texts[0].properties.rotation).toBe(360);
        } finally {
            stubBearing = 90;
        }
    });

    it('rotation stays 0 for a legacy east-running line (bearing 90, no new props)', () => {
        const texts = geom.generateBoundaryTexts(featureWith());
        expect(texts[0].properties.rotation).toBe(0);
    });
});

// ============================================================================
// generateBoundaryCircles — stroke width anchor propagation
// ============================================================================

describe('AddBoundaryGeometry.generateBoundaryCircles (zoom)', () => {
    const circleFeature = (extra = {}) => ({
        properties: {
            id: 'b1',
            baseCoordinates: [[0, 0], [1, 0], [2, 0]],
            echelon: 'oo',
            symbol_size: 0.1,
            color: '#000',
            symbol_instances: [{ ratio: 0.5, showLabels: true }],
            ...extra,
        },
    });

    it('propagates the derived stroke width and the anchor to each circle', () => {
        const circles = geom.generateBoundaryCircles(circleFeature({
            calculatedStrokeWidth: 8,
            createdAtZoom: 11,
            zoomCorrectionEnabled: true,
        }));
        expect(circles.length).toBeGreaterThan(0);
        for (const circle of circles) {
            expect(circle.properties.calculatedStrokeWidth).toBe(8);
            expect(circle.properties.createdAtZoom).toBe(11);
            expect(circle.properties.zoomCorrectionEnabled).toBe(true);
            // The authored base is carried so the circle can be rescaled alone.
            expect(circle.properties.strokeWidth).toBe(2);
        }
    });

    it('leaves the derived width undefined for a legacy boundary (layer coalesces to 2)', () => {
        const circles = geom.generateBoundaryCircles(circleFeature());
        expect(circles.length).toBeGreaterThan(0);
        expect(circles[0].properties.calculatedStrokeWidth).toBeUndefined();
        expect(circles[0].properties.createdAtZoom).toBeUndefined();
    });
});

// ============================================================================
// effectiveSymbolSize — the km axis of the zoom switch
// ============================================================================

describe('AddBoundaryGeometry.effectiveSymbolSize', () => {
    it('reads the derived size only for a boundary pinned to the SCREEN', () => {
        expect(geom.effectiveSymbolSize({
            symbol_size: 2, calculatedSymbolSize: 0.5, createdAtZoom: 12, zoomCorrectionEnabled: false,
        })).toBe(0.5);
    });

    it('ignores a derived size that cannot be trusted, and draws the authored one', () => {
        // Correction ON, no anchor at all, the zero sentinel, and a NaN derived
        // value: four ways a stale `calculatedSymbolSize` reaches the geometry
        // (spreading DEFAULT_PROPERTIES and overriding only the base is the real
        // path), all of which must draw the size the user actually authored.
        expect(geom.effectiveSymbolSize({
            symbol_size: 2, calculatedSymbolSize: 1, createdAtZoom: 12, zoomCorrectionEnabled: true,
        })).toBe(2);
        expect(geom.effectiveSymbolSize({ symbol_size: 2, calculatedSymbolSize: 1 })).toBe(2);
        expect(geom.effectiveSymbolSize({
            symbol_size: 2, calculatedSymbolSize: 1, createdAtZoom: 0, zoomCorrectionEnabled: false,
        })).toBe(2);
        expect(geom.effectiveSymbolSize({
            symbol_size: 2, calculatedSymbolSize: NaN, createdAtZoom: 12, zoomCorrectionEnabled: false,
        })).toBe(2);
    });

    it('falls back to the model default instead of propagating undefined', () => {
        // `undefined` used to travel all the way into `turf.destination`, which
        // answers with NaN coordinates and draws nothing at all; 1 km is the same
        // fallback `computeBoundaryZoomSizes` already used for a missing base.
        expect(geom.effectiveSymbolSize({})).toBe(1);
        expect(geom.effectiveSymbolSize(undefined)).toBe(1);
        expect(geom.effectiveSymbolSize({ symbol_size: -4 })).toBe(1);
    });
});

// ============================================================================
// resolveSymbolSize — the zoom wins over the stored cache
// ============================================================================

describe('AddBoundaryGeometry.resolveSymbolSize', () => {
    const pinned = (extra = {}) => ({
        symbol_size: 2,
        createdAtZoom: 12,
        zoomCorrectionEnabled: false,
        echelon: 'X',
        symbol_instances: [{ ratio: 0.5, showLabels: true }],
        ...extra,
    });

    it('derives the factor from the CURRENT zoom, ignoring a stale cache', () => {
        // Anchored at 12 and drawn at 14: the echelon is pinned to the screen, so
        // it shrinks by 2 ** (12 - 14). The cache says something else entirely,
        // and that is exactly the value the old code drew.
        const out = geom.resolveSymbolSize(pinned({ calculatedSymbolSize: 40 }), 14);
        expect(out.groundFactor).toBeCloseTo(0.25, 10);
        expect(out.effective).toBeCloseTo(0.5, 10);
    });

    it('falls back to the cache only when there is no zoom to read', () => {
        expect(geom.resolveSymbolSize(pinned({ calculatedSymbolSize: 0.5 })).effective).toBeCloseTo(0.5, 10);
        expect(geom.resolveSymbolSize(pinned({ calculatedSymbolSize: 0.5 }), NaN).effective).toBeCloseTo(0.5, 10);
    });

    it('ignores the cache entirely while the correction is ON', () => {
        const props = pinned({ zoomCorrectionEnabled: true, calculatedSymbolSize: 0.5 });
        expect(geom.resolveSymbolSize(props, 17).effective).toBe(2);
    });

    it('caps the effective size by the length of the line', () => {
        // 10 km line, one instance, three symbols: the gaps may take 5 km, and one
        // symbol costs 3 * 1.8 = 5.4 km per km of size.
        const out = geom.resolveSymbolSize(pinned({ echelon: 'XXX', symbol_size: 5 }), 12, 10);
        expect(out.base).toBe(5);
        expect(out.effective).toBeCloseTo(10 * 0.5 / (1 * 3 * 1.8), 10);
    });

    it('does not cap when the line length is unknown', () => {
        expect(geom.resolveSymbolSize(pinned({ echelon: 'XXX', symbol_size: 5 }), 12).effective).toBe(5);
        expect(geom.resolveSymbolSize(pinned({ echelon: 'XXX', symbol_size: 5 }), 12, 0).effective).toBe(5);
    });
});

// ============================================================================
// generate / generateBoundaryTexts — drawing at the effective size
// ============================================================================

describe('AddBoundaryGeometry.generate (effective symbol size)', () => {
    // Length is 10 km and the single instance sits at 0.5, so the gap around the
    // 'XX' echelon is `2 * size * 1.5 * 1.2` wide and the first segment ends at
    // `5 - 1.8 * size`. That end is the first distance `turf.along` is asked for.
    const props = (extra = {}) => ({
        baseCoordinates: [[0, 0], [1, 0], [2, 0]],
        echelon: 'XX',
        symbol_size: 1,
        symbol_instances: [{ ratio: 0.5, showLabels: true }],
        ...extra,
    });

    const firstGapStart = (properties) => {
        alongCalls.length = 0;
        geom.generate(properties);
        return alongCalls[0];
    };

    it('draws a screen-pinned boundary at the derived size', () => {
        expect(firstGapStart(props({
            calculatedSymbolSize: 0.5, createdAtZoom: 12, zoomCorrectionEnabled: false,
        }))).toBeCloseTo(4.1, 10);
    });

    it('draws a legacy boundary at the authored size, derived value or not', () => {
        expect(firstGapStart(props())).toBeCloseTo(3.2, 10);
        expect(firstGapStart(props({ calculatedSymbolSize: 0.5 }))).toBeCloseTo(3.2, 10);
        expect(firstGapStart(props({
            calculatedSymbolSize: 0.5, createdAtZoom: 12, zoomCorrectionEnabled: true,
        }))).toBeCloseTo(3.2, 10);
    });
});

describe('AddBoundaryGeometry.generateBoundaryTexts (effective symbol size)', () => {
    // The stub line is 10 km and the echelon is a single 'X', so the cap by line
    // length is 10 * 0.5 / 1.8 = 2.78 km and does not bind below that.
    const props = (extra = {}) => ({
        properties: {
            id: 'b1',
            baseCoordinates: [[0, 0], [1, 0], [2, 0]],
            echelon: 'X',
            text_top: 'A',
            text_size: 35,
            symbol_size: 2,
            text_distance_ratio: 0.9,
            symbol_instances: [{ ratio: 0.5, showLabels: true }],
            ...extra,
        },
    });

    const labelOffset = (feature, zoom) => {
        destinationCalls.length = 0;
        geom.generateBoundaryTexts(feature, zoom);
        return destinationCalls[0];
    };

    it('places the label off the derived size when the boundary is pinned to the screen', () => {
        // 0.5 km * 0.9: the label rides the shrinking echelon instead of staying
        // 1.8 km away from a symbol that is now a quarter of that.
        expect(labelOffset(props({
            calculatedSymbolSize: 0.5, createdAtZoom: 12, zoomCorrectionEnabled: false,
        }))).toBeCloseTo(0.45, 10);
    });

    it('places it off the authored size otherwise', () => {
        expect(labelOffset(props())).toBeCloseTo(1.8, 10);
    });

    it('rides the CURRENT zoom, not the cache, when one is given', () => {
        // Anchored at 12, drawn at 14, cache deliberately absurd: 2 km * 0.25 * 0.9.
        expect(labelOffset(props({
            calculatedSymbolSize: 40, createdAtZoom: 12, zoomCorrectionEnabled: false,
        }), 14)).toBeCloseTo(0.45, 10);
    });

    it('follows the echelon down to the cap by line length', () => {
        // 'XXX' on a 10 km line caps the symbol at 0.926 km, so the label sits at
        // 0.833 km instead of the 4.5 km the authored 5 km symbol would ask for.
        expect(labelOffset(props({ echelon: 'XXX', symbol_size: 5 }))).toBeCloseTo(
            (10 * 0.5 / (1 * 3 * 1.8)) * 0.9, 10,
        );
    });
});

// ============================================================================
// updateFromHandle (size_handle) — the drag writes the BASE
// ============================================================================

describe('AddBoundaryGeometry.updateFromHandle (size_handle)', () => {
    // Stub line: 10 km, one instance, one 'X' symbol, so the cap by line length
    // is 10 * 0.5 / 1.8 = 2.78 km of EFFECTIVE size.
    const feature = (extra = {}) => ({
        properties: {
            baseCoordinates: [[0, 0], [1, 0], [2, 0]],
            echelon: 'X',
            symbol_size: 2,
            symbol_instances: [{ ratio: 0.5, showLabels: true }],
            ...extra,
        },
    });

    const withDragDistance = (km, run) => {
        stubDistance = km;
        try {
            return run();
        } finally {
            stubDistance = 3;
        }
    };

    it('stores the authored base, not the size the drag measured', () => {
        // The drag reports 0.5 km from the centre, i.e. an EFFECTIVE 1 km. Drawn
        // at a quarter scale, the base that produces it is 4 km.
        const out = withDragDistance(0.5, () => geom.updateFromHandle('size_handle', [1, 1], feature({
            calculatedSymbolSize: 0.5, createdAtZoom: 12, zoomCorrectionEnabled: false,
        })));
        expect(out.properties.symbol_size).toBeCloseTo(4, 10);
        // The derived value is a cache owned by the zoom pass, and the drag no
        // longer writes it: what came in is what goes out. (The old code wrote
        // 1 here, which is how a stale size travelled on a feature copy.)
        expect(out.properties.calculatedSymbolSize).toBe(0.5);
    });

    it('takes the factor from the zoom it is given, not from the cache', () => {
        // Same anchor, drawn at 14, with a cache that says something absurd: the
        // factor must come out of 2 ** (12 - 14), so the base is again 4 km.
        const out = withDragDistance(0.5, () => geom.updateFromHandle('size_handle', [1, 1], feature({
            calculatedSymbolSize: 0.02, createdAtZoom: 12, zoomCorrectionEnabled: false,
        }), null, 14));
        expect(out.properties.symbol_size).toBeCloseTo(4, 10);
    });

    it('writes the measured size straight through when nothing is scaling it', () => {
        const out = withDragDistance(0.5, () => geom.updateFromHandle('size_handle', [1, 1], feature()));
        expect(out.properties.symbol_size).toBeCloseTo(1, 10);
        expect(out.properties.calculatedSymbolSize).toBeUndefined();
    });

    it('stops growing at what the line can carry', () => {
        // The drag reports an EFFECTIVE 6 km on a 10 km line: the symbol saturates
        // at the cap instead of eating the whole boundary.
        const out = geom.updateFromHandle('size_handle', [1, 1], feature());
        expect(out.properties.symbol_size).toBeCloseTo(10 * 0.5 / 1.8, 10);
    });

    it('never stores less than the minimum symbol size', () => {
        withDragDistance(0, () => {
            const out = geom.updateFromHandle('size_handle', [1, 1], feature());
            expect(out.properties.symbol_size).toBe(0.05);
        });
    });

    it('does not mutate the feature it was given', () => {
        const original = feature();
        geom.updateFromHandle('size_handle', [1, 1], original);
        expect(original.properties.symbol_size).toBe(2);
        expect(original.properties.calculatedSymbolSize).toBeUndefined();
    });
});

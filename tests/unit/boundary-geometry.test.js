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
beforeAll(() => {
    globalThis.turf = {
        lineString: (coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }),
        length: () => 10,
        along: (_line, dist) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [dist, 0] } }),
        point: (c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } }),
        lineSlice: () => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } }),
        midpoint: (a) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: a.geometry.coordinates } }),
        nearestPointOnLine: () => ({ properties: { location: nearestLocation } }),
        bearing: () => 90,
        destination: () => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }),
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

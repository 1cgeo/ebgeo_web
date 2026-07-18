import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// ============================================================================
// add_line_geometry.js
//
// AddLineGeometry imports BaseGeometry from the `../../tool_manager` barrel
// (same module id as the `@tools` alias), which pulls in DOM/MapLibre-coupled
// modules. Mock the barrel with a trivial BaseGeometry that also provides a
// real haversine `calculateDistance`, so the geometry math used by
// validateMinimumDistances/updateFromHandle works in the `node` environment.
// ============================================================================

const EARTH_RADIUS_METERS = 6371000;
const DEG_TO_RAD = Math.PI / 180;

function haversine([lng1, lat1], [lng2, lat2]) {
    const dLat = (lat2 - lat1) * DEG_TO_RAD;
    const dLng = (lng2 - lng1) * DEG_TO_RAD;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
        calculateDistance(p1, p2) { return haversine(p1, p2); }
    },
}));

const { default: AddLineGeometry } = await import('../../src/js/draw_tools/line_tool/add_line_geometry.js');

const geom = new AddLineGeometry();

// Two coordinates ~111 km apart (1° of latitude) — comfortably past MIN_DISTANCE.
const A = [0, 0];
const B = [0, 1];
const C = [1, 1];

// ============================================================================
// validate
// ============================================================================

describe('AddLineGeometry.validate', () => {
    it('accepts a 2-point line', () => {
        expect(geom.validate([A, B])).toBe(true);
    });
    it('accepts a multi-point line', () => {
        expect(geom.validate([A, B, C])).toBe(true);
    });
    it('accepts points with extra dimensions (length > 2)', () => {
        expect(geom.validate([[0, 0, 100], [1, 1, 200]])).toBe(true);
    });

    it('rejects null / undefined', () => {
        expect(geom.validate(null)).toBe(false);
        expect(geom.validate(undefined)).toBe(false);
    });
    it('rejects a non-array', () => {
        expect(geom.validate('nope')).toBe(false);
        expect(geom.validate(123)).toBe(false);
    });
    it('rejects fewer than 2 points', () => {
        expect(geom.validate([])).toBe(false);
        expect(geom.validate([A])).toBe(false);
    });
    it('rejects a point that is not an array', () => {
        expect(geom.validate([A, { 0: 1, 1: 2 }])).toBe(false);
    });
    it('rejects a point with fewer than 2 components', () => {
        expect(geom.validate([A, [1]])).toBe(false);
    });
    it('rejects NaN components', () => {
        expect(geom.validate([A, [NaN, 1]])).toBe(false);
        expect(geom.validate([A, [1, NaN]])).toBe(false);
    });
    it('rejects non-number components (string)', () => {
        expect(geom.validate([A, ['1', '2']])).toBe(false);
    });

    // BUG FIX: validate previously accepted Infinity (typeof Infinity === 'number'
    // and !isNaN(Infinity) === true). Number.isFinite now rejects it.
    it('rejects Infinity components', () => {
        expect(geom.validate([A, [Infinity, 1]])).toBe(false);
        expect(geom.validate([A, [1, Infinity]])).toBe(false);
        expect(geom.validate([A, [-Infinity, 1]])).toBe(false);
    });

    it('property: any array of >=2 finite pairs validates', () => {
        fc.assert(fc.property(
            fc.array(
                fc.tuple(
                    fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
                    fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true })
                ),
                { minLength: 2, maxLength: 20 }
            ),
            (coords) => {
                expect(geom.validate(coords)).toBe(true);
            }
        ));
    });
});

// ============================================================================
// createLineStringGeometry
// ============================================================================

describe('AddLineGeometry.createLineStringGeometry', () => {
    it('builds a GeoJSON LineString from valid coords', () => {
        const g = geom.createLineStringGeometry([A, B, C]);
        expect(g.type).toBe('LineString');
        expect(g.coordinates).toEqual([A, B, C]);
    });
    it('returns a copy (not the same array reference)', () => {
        const input = [A, B];
        const g = geom.createLineStringGeometry(input);
        expect(g.coordinates).not.toBe(input);
        expect(g.coordinates).toEqual(input);
    });
    it('throws on invalid coordinates', () => {
        expect(() => geom.createLineStringGeometry([A])).toThrow('Invalid coordinates');
        expect(() => geom.createLineStringGeometry([A, [Infinity, 0]])).toThrow('Invalid coordinates');
        expect(() => geom.createLineStringGeometry(null)).toThrow('Invalid coordinates');
    });
    it('generate() delegates to createLineStringGeometry', () => {
        expect(geom.generate([A, B])).toEqual({ type: 'LineString', coordinates: [A, B] });
    });
});

// ============================================================================
// normalizeBaseCoordinates (JSON string / array handling)
// ============================================================================

describe('AddLineGeometry.normalizeBaseCoordinates', () => {
    it('passes through an array unchanged', () => {
        expect(geom.normalizeBaseCoordinates([A, B])).toEqual([A, B]);
    });
    it('parses a JSON string into an array', () => {
        expect(geom.normalizeBaseCoordinates(JSON.stringify([A, B]))).toEqual([A, B]);
    });
    it('returns null for invalid JSON string', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(geom.normalizeBaseCoordinates('{not json')).toBeNull();
        spy.mockRestore();
    });
    it('returns null for a non-array, non-string value', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(geom.normalizeBaseCoordinates(42)).toBeNull();
        expect(geom.normalizeBaseCoordinates(null)).toBeNull();
        expect(geom.normalizeBaseCoordinates(undefined)).toBeNull();
        spy.mockRestore();
    });
    it('returns null when JSON parses to a non-array (e.g. object)', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(geom.normalizeBaseCoordinates('{"a":1}')).toBeNull();
        spy.mockRestore();
    });

    it('property: JSON.stringify round-trips through normalizeBaseCoordinates', () => {
        fc.assert(fc.property(
            fc.array(
                fc.tuple(
                    fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
                    fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true })
                ),
                { minLength: 1, maxLength: 10 }
            ),
            (coords) => {
                // JSON.stringify(-0) === "0", so normalize -0 → 0 before comparing
                // (the round-trip is otherwise exact for finite numbers).
                const norm = coords.map(([x, y]) => [x === 0 ? 0 : x, y === 0 ? 0 : y]);
                expect(geom.normalizeBaseCoordinates(JSON.stringify(coords))).toEqual(norm);
            }
        ));
    });
});

// ============================================================================
// updateFromHandle
// ============================================================================

function lineFeature(coords) {
    return { properties: { id: 'L1', baseCoordinates: coords } };
}

describe('AddLineGeometry.updateFromHandle', () => {
    it('moves a vertex (new index format)', () => {
        const f = lineFeature([A, B, C]);
        const moved = [0.5, 0.5];
        const res = geom.updateFromHandle('vertex', moved, f, 1);
        expect(res).not.toBeNull();
        expect(res.baseCoordinates[1]).toEqual(moved);
        expect(res.geometry.type).toBe('LineString');
    });

    it('moves a vertex (legacy "vertex-N" format)', () => {
        const f = lineFeature([A, B, C]);
        const moved = [0.5, 0.5];
        const res = geom.updateFromHandle('vertex-1', moved, f);
        expect(res.baseCoordinates[1]).toEqual(moved);
    });

    it('inserts a new point for a midpoint handle (new format)', () => {
        const f = lineFeature([A, C]); // single long segment
        const mid = [0.5, 0.5];
        const res = geom.updateFromHandle('midpoint', mid, f, 0);
        expect(res.baseCoordinates).toHaveLength(3);
        expect(res.baseCoordinates[1]).toEqual(mid);
    });

    it('inserts a new point for a midpoint handle (legacy format)', () => {
        const f = lineFeature([A, C]);
        const mid = [0.5, 0.5];
        const res = geom.updateFromHandle('midpoint-0', mid, f);
        expect(res.baseCoordinates).toHaveLength(3);
        expect(res.baseCoordinates[1]).toEqual(mid);
    });

    it('accepts the JSON-string baseCoordinates form', () => {
        const f = lineFeature(JSON.stringify([A, B, C]));
        const res = geom.updateFromHandle('vertex', [0.5, 0.5], f, 1);
        expect(res.baseCoordinates[1]).toEqual([0.5, 0.5]);
    });

    it('returns null for invalid base coordinates', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const res = geom.updateFromHandle('vertex', [0, 0], lineFeature('garbage'), 0);
        expect(res).toBeNull();
        spy.mockRestore();
    });

    it('returns null for a missing/invalid handleType', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(geom.updateFromHandle(null, [0, 0], lineFeature([A, B]), 0)).toBeNull();
        expect(geom.updateFromHandle(123, [0, 0], lineFeature([A, B]), 0)).toBeNull();
        spy.mockRestore();
    });

    it('rejects a move that makes a segment shorter than MIN_DISTANCE_METERS', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const f = lineFeature([A, B]);
        // Move vertex 1 right on top of vertex 0 → zero-length segment.
        const res = geom.updateFromHandle('vertex', A, f, 1);
        expect(res).toBeNull();
        spy.mockRestore();
    });

    it('out-of-range vertex index leaves coordinates unchanged (still valid)', () => {
        const f = lineFeature([A, B]);
        const res = geom.updateFromHandle('vertex', [5, 5], f, 99);
        expect(res).not.toBeNull();
        expect(res.baseCoordinates).toEqual([A, B]);
    });
});

// ============================================================================
// removeVertexAtIndex
// ============================================================================

describe('AddLineGeometry.removeVertexAtIndex', () => {
    it('removes a middle vertex', () => {
        expect(geom.removeVertexAtIndex([A, B, C], 1)).toEqual([A, C]);
    });
    it('removes the first vertex', () => {
        expect(geom.removeVertexAtIndex([A, B, C], 0)).toEqual([B, C]);
    });
    it('removes the last vertex', () => {
        expect(geom.removeVertexAtIndex([A, B, C], 2)).toEqual([A, B]);
    });
    it('returns null when removal would leave fewer than 2 points', () => {
        expect(geom.removeVertexAtIndex([A, B], 0)).toBeNull();
    });
    it('returns null for an out-of-range index', () => {
        expect(geom.removeVertexAtIndex([A, B, C], 3)).toBeNull();
        expect(geom.removeVertexAtIndex([A, B, C], -1)).toBeNull();
    });
    it('returns null for null coordinates', () => {
        expect(geom.removeVertexAtIndex(null, 0)).toBeNull();
    });
    it('does not mutate the input array', () => {
        const input = [A, B, C];
        geom.removeVertexAtIndex(input, 1);
        expect(input).toEqual([A, B, C]);
    });

    it('property: result length is input length - 1 when valid', () => {
        fc.assert(fc.property(
            fc.array(fc.tuple(fc.integer(), fc.integer()), { minLength: 3, maxLength: 12 }),
            fc.nat(),
            (coords, rawIdx) => {
                const idx = rawIdx % coords.length;
                const res = geom.removeVertexAtIndex(coords, idx);
                // length stays >= 2 here, so removal always succeeds.
                expect(res).toHaveLength(coords.length - 1);
            }
        ));
    });
});

// ============================================================================
// line-split.js → canSplitLine (pure). Heavy deps mocked so the module loads.
// ============================================================================

vi.mock('@store', () => ({
    addFeature: vi.fn(),
    removeFeature: vi.fn(),
    isCurrentMapLockedSync: vi.fn(),
    getCurrentMapNameSync: vi.fn(),
    getEventBus: vi.fn(() => ({ emit: vi.fn() })),
}));
vi.mock('@utils', () => ({
    IDUtils: { generateFeatureIds: vi.fn() },
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
    showToast: vi.fn(),
}));
vi.mock('@events', () => ({ EventTypes: { LAYERS_CHANGED: 'LAYERS_CHANGED' } }));
vi.mock('../../src/js/draw_tools/line_tool/line_measurement.js', () => ({
    removeMeasurement: vi.fn(),
    updateFeatureMeasurement: vi.fn(),
}));

const { canSplitLine } = await import('../../src/js/draw_tools/line_tool/line-split.js');

function splittableLine(overrides = {}) {
    return {
        properties: { source: 'line', bloqueado: false, ...overrides.properties },
        geometry: { coordinates: overrides.coordinates ?? [A, B, C] },
    };
}

describe('canSplitLine', () => {
    it('accepts a single unlocked line with enough coordinates', () => {
        expect(canSplitLine([splittableLine()])).toEqual({ canSplit: true });
    });

    it('rejects when selection is not exactly 1', () => {
        expect(canSplitLine([]).canSplit).toBe(false);
        expect(canSplitLine(null).canSplit).toBe(false);
        expect(canSplitLine([splittableLine(), splittableLine()]).canSplit).toBe(false);
    });

    it('rejects a non-line feature', () => {
        const r = canSplitLine([splittableLine({ properties: { source: 'polygon' } })]);
        expect(r.canSplit).toBe(false);
        expect(r.reason).toMatch(/não é uma linha/);
    });

    it('rejects a line with fewer than 2 coordinates', () => {
        expect(canSplitLine([splittableLine({ coordinates: [A] })]).canSplit).toBe(false);
        expect(canSplitLine([splittableLine({ coordinates: [] })]).canSplit).toBe(false);
    });

    it('rejects a line missing geometry coordinates', () => {
        expect(canSplitLine([{ properties: { source: 'line' }, geometry: {} }]).canSplit).toBe(false);
    });

    it('rejects a boolean-locked line', () => {
        const r = canSplitLine([splittableLine({ properties: { source: 'line', bloqueado: true } })]);
        expect(r.canSplit).toBe(false);
        expect(r.reason).toMatch(/bloqueada/);
    });

    // BUG FIX: previously `bloqueado === true` let a truthy non-boolean lock
    // (e.g. the string "true") slip through, diverging from the rest of the
    // codebase's truthy `!feature.properties?.bloqueado` convention.
    it('rejects a line locked with a truthy string "true"', () => {
        const r = canSplitLine([splittableLine({ properties: { source: 'line', bloqueado: 'true' } })]);
        expect(r.canSplit).toBe(false);
        expect(r.reason).toMatch(/bloqueada/);
    });

    it('still allows when bloqueado is a falsy value (undefined / false / "")', () => {
        expect(canSplitLine([splittableLine({ properties: { source: 'line' } })]).canSplit).toBe(true);
        expect(canSplitLine([splittableLine({ properties: { source: 'line', bloqueado: false } })]).canSplit).toBe(true);
        expect(canSplitLine([splittableLine({ properties: { source: 'line', bloqueado: '' } })]).canSplit).toBe(true);
    });
});

// ============================================================================
// line_profile.js utilities. Mock terrain barrel (DOM/MapLibre coupled).
// The tested functions are pure and never call getTerrainElevation.
// ============================================================================

vi.mock('../../src/js/terrain/index.js', () => ({
    getTerrainElevation: vi.fn(),
}));

const {
    getTotalElevationGain,
    getTotalElevationLoss,
    getElevationRange,
    getMaxSlope,
    getAverageSlope,
} = await import('../../src/js/draw_tools/line_tool/line_profile.js');

const profile = (elevations, slopes) =>
    elevations.map((e, i) => ({
        distance: i * 100,
        elevation: e,
        slope: slopes ? slopes[i] : 0,
    }));

describe('line_profile.getTotalElevationGain', () => {
    it('sums only the positive deltas', () => {
        // 100 -> 150 (+50) -> 120 (-30) -> 200 (+80) = 130
        expect(getTotalElevationGain(profile([100, 150, 120, 200]))).toBe(130);
    });
    it('is 0 for a monotonically descending profile', () => {
        expect(getTotalElevationGain(profile([300, 200, 100]))).toBe(0);
    });
    it('is 0 for empty / single-point profiles', () => {
        expect(getTotalElevationGain([])).toBe(0);
        expect(getTotalElevationGain(profile([100]))).toBe(0);
    });
});

describe('line_profile.getTotalElevationLoss', () => {
    it('sums absolute values of the negative deltas', () => {
        // 100 -> 150 (+50) -> 120 (-30) -> 200 (+80) -> 50 (-150) = 180
        expect(getTotalElevationLoss(profile([100, 150, 120, 200, 50]))).toBe(180);
    });
    it('is 0 for a monotonically ascending profile', () => {
        expect(getTotalElevationLoss(profile([100, 200, 300]))).toBe(0);
    });
    it('is 0 for empty profile', () => {
        expect(getTotalElevationLoss([])).toBe(0);
    });

    it('property: gain - loss === lastElevation - firstElevation', () => {
        fc.assert(fc.property(
            fc.array(fc.double({ min: -1000, max: 9000, noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 30 }),
            (elevs) => {
                const p = profile(elevs);
                const net = getTotalElevationGain(p) - getTotalElevationLoss(p);
                expect(net).toBeCloseTo(elevs[elevs.length - 1] - elevs[0], 6);
            }
        ));
    });
});

describe('line_profile.getElevationRange', () => {
    it('returns the min/max elevation', () => {
        expect(getElevationRange(profile([100, 250, 80, 300, 120]))).toEqual({ min: 80, max: 300 });
    });
    it('handles a single point (min === max)', () => {
        expect(getElevationRange(profile([175]))).toEqual({ min: 175, max: 175 });
    });
    it('handles negative elevations', () => {
        expect(getElevationRange(profile([-10, -50, -5]))).toEqual({ min: -50, max: -5 });
    });

    // DOCUMENTED CURRENT BEHAVIOR: an empty profile returns the hard-coded
    // { min: 0, max: 0 } sentinel rather than something like {min: Infinity, ...}.
    // Left unchanged (cosmetic, low risk, callers rely on the sentinel).
    it('returns the hard-coded {min:0,max:0} sentinel for an empty profile', () => {
        expect(getElevationRange([])).toEqual({ min: 0, max: 0 });
    });

    it('property: min <= every elevation <= max', () => {
        fc.assert(fc.property(
            fc.array(fc.double({ min: -500, max: 9000, noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 30 }),
            (elevs) => {
                const { min, max } = getElevationRange(profile(elevs));
                for (const e of elevs) {
                    expect(e).toBeGreaterThanOrEqual(min);
                    expect(e).toBeLessThanOrEqual(max);
                }
            }
        ));
    });
});

describe('line_profile.getMaxSlope', () => {
    it('returns the maximum absolute slope', () => {
        expect(getMaxSlope(profile([0, 0, 0], [3, -12, 5]))).toBe(12);
    });
    it('returns 0 for an empty profile', () => {
        expect(getMaxSlope([])).toBe(0);
    });
    it('treats a single-point profile (slope 0) as 0', () => {
        expect(getMaxSlope(profile([100], [0]))).toBe(0);
    });

    it('property: result equals max(|slope|) and is >= 0', () => {
        fc.assert(fc.property(
            fc.array(fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 20 }),
            (slopes) => {
                const p = profile(slopes.map(() => 0), slopes);
                const res = getMaxSlope(p);
                const expected = Math.max(...slopes.map(Math.abs));
                expect(res).toBeCloseTo(expected, 6);
                expect(res).toBeGreaterThanOrEqual(0);
            }
        ));
    });
});

describe('line_profile.getAverageSlope', () => {
    it('averages absolute slopes over all points', () => {
        // |3| + |-12| + |5| = 20, over 3 points → 6.666...
        expect(getAverageSlope(profile([0, 0, 0], [3, -12, 5]))).toBeCloseTo(20 / 3, 6);
    });
    it('returns 0 for empty / single-point profiles', () => {
        expect(getAverageSlope([])).toBe(0);
        expect(getAverageSlope(profile([100], [9]))).toBe(0);
    });
});

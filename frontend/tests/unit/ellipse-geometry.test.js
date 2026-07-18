import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fc from 'fast-check';

// add_ellipse_geometry imports BaseGeometry from the `../../tool_manager`
// barrel (same module the `@tools` alias points at), which pulls in
// DOM/MapLibre-coupled modules. Mock the barrel with a trivial BaseGeometry so
// the pure geometry math can be tested in the `node` environment.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
    },
}));

const { default: AddEllipseGeometry } =
    await import('../../src/js/draw_tools/ellipse_tool/add_ellipse_geometry.js');

const geom = new AddEllipseGeometry();

// ----------------------------------------------------------------------------
// turf is a GLOBAL (<script> tag) in production, NOT an npm dep. We stub a
// deterministic flat-earth implementation: enough to validate orchestration
// (which args the geometry passes to turf), not real geodesy.
// ----------------------------------------------------------------------------
function coordsOf(p) {
    // Accept either a [lng, lat] array or a turf-ish { geometry: { coordinates } }.
    return Array.isArray(p) ? p : p.geometry.coordinates;
}

beforeAll(() => {
    globalThis.turf = {
        // Record the call so tests can assert angle/steps/units wiring.
        ellipse: (center, xSemi, ySemi, options) => {
            globalThis.turf.ellipse._lastCall = { center, xSemi, ySemi, options };
            return {
                geometry: {
                    type: 'Polygon',
                    // A trivial, deterministic ring; tests only need identity + tags.
                    coordinates: [[
                        [center[0] + xSemi, center[1]],
                        [center[0], center[1] + ySemi],
                        [center[0] - xSemi, center[1]],
                        [center[0] + xSemi, center[1]],
                    ]],
                    _xSemi: xSemi,
                    _ySemi: ySemi,
                    _angle: options.angle,
                    _units: options.units,
                    _steps: options.steps,
                },
            };
        },
        // Flat-earth destination: move distKm * 0.01 deg along a cardinal-ish bearing.
        destination: (from, distKm, bearing, _opts) => {
            const c = coordsOf(from);
            const rad = (bearing * Math.PI) / 180;
            return {
                geometry: {
                    coordinates: [
                        c[0] + distKm * 0.01 * Math.sin(rad),
                        c[1] + distKm * 0.01 * Math.cos(rad),
                    ],
                },
            };
        },
        // Flat-earth distance (in "km" using the same 0.01 scale).
        distance: (a, b, _opts) => {
            const ca = coordsOf(a);
            const cb = coordsOf(b);
            const dx = (cb[0] - ca[0]) / 0.01;
            const dy = (cb[1] - ca[1]) / 0.01;
            return Math.sqrt(dx * dx + dy * dy);
        },
        // Flat-earth bearing (degrees, 0 = north, clockwise).
        bearing: (a, b) => {
            const ca = coordsOf(a);
            const cb = coordsOf(b);
            const dx = cb[0] - ca[0];
            const dy = cb[1] - ca[1];
            const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
            return deg;
        },
    };
});

afterAll(() => { delete globalThis.turf; });

// ============================================================================
// validate
// ============================================================================

describe('AddEllipseGeometry.validate', () => {
    it('accepts valid parameters (bearing default 90)', () => {
        expect(geom.validate([0, 0], 1, 0.6, 90)).toBe(true);
    });

    it('accepts the minimum radius boundary 0.01', () => {
        expect(geom.validate([0, 0], 0.01, 0.01, 0)).toBe(true);
    });

    it('rejects a null / short / non-array center', () => {
        expect(geom.validate(null, 1, 0.6, 90)).toBe(false);
        expect(geom.validate(undefined, 1, 0.6, 90)).toBe(false);
        expect(geom.validate([0], 1, 0.6, 90)).toBe(false);
        expect(geom.validate('0,0', 1, 0.6, 90)).toBe(false);
    });

    it('accepts a center with extra elements (length >= 2)', () => {
        expect(geom.validate([0, 0, 100], 1, 0.6, 90)).toBe(true);
    });

    it('rejects radii below the 0.01 km minimum', () => {
        expect(geom.validate([0, 0], 0.009, 0.6, 90)).toBe(false);
        expect(geom.validate([0, 0], 1, 0.009, 90)).toBe(false);
        expect(geom.validate([0, 0], 0, 0.6, 90)).toBe(false);
    });

    it('rejects negative radii', () => {
        expect(geom.validate([0, 0], -1, 0.6, 90)).toBe(false);
        expect(geom.validate([0, 0], 1, -0.6, 90)).toBe(false);
    });

    it('rejects non-number radii', () => {
        expect(geom.validate([0, 0], '1', 0.6, 90)).toBe(false);
        expect(geom.validate([0, 0], 1, '0.6', 90)).toBe(false);
        expect(geom.validate([0, 0], null, 0.6, 90)).toBe(false);
    });

    // --- BUG FIX: NaN / Infinity radii must be rejected (Number.isFinite) -----
    it('rejects NaN majorRadius', () => {
        expect(geom.validate([0, 0], NaN, 0.6, 90)).toBe(false);
    });
    it('rejects NaN minorRadius', () => {
        expect(geom.validate([0, 0], 1, NaN, 90)).toBe(false);
    });
    it('rejects Infinity majorRadius', () => {
        expect(geom.validate([0, 0], Infinity, 0.6, 90)).toBe(false);
    });
    it('rejects Infinity minorRadius', () => {
        expect(geom.validate([0, 0], 1, Infinity, 90)).toBe(false);
    });
    it('rejects -Infinity radii', () => {
        expect(geom.validate([0, 0], -Infinity, 0.6, 90)).toBe(false);
        expect(geom.validate([0, 0], 1, -Infinity, 90)).toBe(false);
    });

    it('rejects NaN bearing', () => {
        expect(geom.validate([0, 0], 1, 0.6, NaN)).toBe(false);
    });
    it('rejects non-number bearing', () => {
        expect(geom.validate([0, 0], 1, 0.6, '90')).toBe(false);
    });
    // Infinity bearing is now rejected too (Number.isFinite), consistent with radii.
    it('rejects Infinity bearing', () => {
        expect(geom.validate([0, 0], 1, 0.6, Infinity)).toBe(false);
    });

    it('accepts a negative bearing (no range constraint)', () => {
        expect(geom.validate([0, 0], 1, 0.6, -45)).toBe(true);
    });
    it('accepts bearing 0', () => {
        expect(geom.validate([0, 0], 1, 0.6, 0)).toBe(true);
    });

    it('property: never throws and only returns booleans on arbitrary input', () => {
        fc.assert(fc.property(
            fc.anything(),
            fc.anything(),
            fc.anything(),
            fc.anything(),
            (a, b, c, d) => {
                expect(typeof geom.validate(a, b, c, d)).toBe('boolean');
            }
        ));
    });
});

// ============================================================================
// generateEllipseGeometry / generate
// ============================================================================

describe('AddEllipseGeometry.generateEllipseGeometry', () => {
    it('returns the geometry of the turf.ellipse polygon', () => {
        const g = geom.generateEllipseGeometry([0, 0], 1, 0.6, 90);
        expect(g.type).toBe('Polygon');
        expect(Array.isArray(g.coordinates)).toBe(true);
    });

    it('passes angle = bearing - 90, steps 64, units kilometers', () => {
        geom.generateEllipseGeometry([10, 20], 2, 1, 130);
        const call = globalThis.turf.ellipse._lastCall;
        expect(call.center).toEqual([10, 20]);
        expect(call.xSemi).toBe(2);
        expect(call.ySemi).toBe(1);
        expect(call.options.angle).toBe(40); // 130 - 90
        expect(call.options.steps).toBe(64);
        expect(call.options.units).toBe('kilometers');
    });

    it('default bearing 90 => turf angle 0', () => {
        geom.generateEllipseGeometry([0, 0], 1, 0.6, 90);
        expect(globalThis.turf.ellipse._lastCall.options.angle).toBe(0);
    });

    it('generate() delegates to generateEllipseGeometry', () => {
        const a = geom.generate([1, 2], 3, 2, 45);
        const b = geom.generateEllipseGeometry([1, 2], 3, 2, 45);
        expect(a).toEqual(b);
    });
});

// ============================================================================
// calculateInitialDimensions — minor = 60% of major, bearing default 90
// ============================================================================

describe('AddEllipseGeometry.calculateInitialDimensions', () => {
    it('minorRadius is exactly 60% of majorRadius and bearing is 90', () => {
        const center = [0, 0];
        const end = [0.05, 0]; // distance() => 5 km in the stub
        const r = geom.calculateInitialDimensions(center, end);
        expect(r.majorRadius).toBeCloseTo(5, 9);
        expect(r.minorRadius).toBeCloseTo(3, 9); // 5 * 0.6
        expect(r.bearing).toBe(90);
    });

    it('zero-length input yields zero radii (degenerate)', () => {
        const r = geom.calculateInitialDimensions([0, 0], [0, 0]);
        expect(r.majorRadius).toBe(0);
        expect(r.minorRadius).toBe(0);
        expect(r.bearing).toBe(90);
    });

    it('property: minorRadius === majorRadius * 0.6 and bearing always 90', () => {
        fc.assert(fc.property(
            fc.double({ min: -0.5, max: 0.5, noNaN: true }),
            fc.double({ min: -0.5, max: 0.5, noNaN: true }),
            (dx, dy) => {
                const r = geom.calculateInitialDimensions([0, 0], [dx, dy]);
                expect(r.minorRadius).toBeCloseTo(r.majorRadius * 0.6, 9);
                expect(r.bearing).toBe(90);
                expect(r.majorRadius).toBeGreaterThanOrEqual(0);
            }
        ));
    });
});

// ============================================================================
// calculateHorizontalRadius / calculateVerticalRadius
// ============================================================================

describe('AddEllipseGeometry.calculateHorizontalRadius / VerticalRadius', () => {
    it('both return turf.distance from center to the new position (km)', () => {
        const center = [0, 0];
        const pos = [0.03, 0.04]; // 3-4-5 -> 5 km in the stub
        expect(geom.calculateHorizontalRadius(center, pos, 90)).toBeCloseTo(5, 9);
        expect(geom.calculateVerticalRadius(center, pos, 90)).toBeCloseTo(5, 9);
    });

    it('radius is independent of the (ignored) bearing argument', () => {
        const center = [0, 0];
        const pos = [0.03, 0.04];
        expect(geom.calculateHorizontalRadius(center, pos, 0))
            .toBe(geom.calculateHorizontalRadius(center, pos, 200));
    });

    it('property: horizontal and vertical radii are equal for the same inputs', () => {
        fc.assert(fc.property(
            fc.double({ min: -0.5, max: 0.5, noNaN: true }),
            fc.double({ min: -0.5, max: 0.5, noNaN: true }),
            (x, y) => {
                const h = geom.calculateHorizontalRadius([0, 0], [x, y], 90);
                const v = geom.calculateVerticalRadius([0, 0], [x, y], 90);
                expect(h).toBeCloseTo(v, 9);
                expect(h).toBeGreaterThanOrEqual(0);
            }
        ));
    });
});

// ============================================================================
// calculateRotationBearing — turf.bearing + 90
// ============================================================================

describe('AddEllipseGeometry.calculateRotationBearing', () => {
    it('adds 90 to the geographic bearing from center to the handle', () => {
        const center = [0, 0];
        // Due north => turf.bearing 0 => 90
        expect(geom.calculateRotationBearing(center, [0, 1])).toBeCloseTo(90, 6);
        // Due east => turf.bearing 90 => 180
        expect(geom.calculateRotationBearing(center, [1, 0])).toBeCloseTo(180, 6);
        // Due south => turf.bearing 180 => 270
        expect(geom.calculateRotationBearing(center, [0, -1])).toBeCloseTo(270, 6);
    });

    it('property: result equals turf.bearing(center,pos) + 90', () => {
        fc.assert(fc.property(
            fc.double({ min: -1, max: 1, noNaN: true }),
            fc.double({ min: -1, max: 1, noNaN: true }),
            (x, y) => {
                fc.pre(x !== 0 || y !== 0);
                const center = [0, 0];
                const expected = globalThis.turf.bearing(center, [x, y]) + 90;
                expect(geom.calculateRotationBearing(center, [x, y])).toBeCloseTo(expected, 9);
            }
        ));
    });
});

// ============================================================================
// getBoundingBox — pure math, polar singularity
// ============================================================================

describe('AddEllipseGeometry.getBoundingBox', () => {
    it('returns [minLng, minLat, maxLng, maxLat] symmetric about the center', () => {
        const center = [-44.5, -22.5];
        const bbox = geom.getBoundingBox(center, 2, 1, 90);
        expect(bbox).toHaveLength(4);
        // symmetric in lat about center
        expect(bbox[1] + bbox[3]).toBeCloseTo(2 * center[1], 9);
        // symmetric in lng about center
        expect(bbox[0] + bbox[2]).toBeCloseTo(2 * center[0], 9);
        // proper ordering
        expect(bbox[0]).toBeLessThan(bbox[2]);
        expect(bbox[1]).toBeLessThan(bbox[3]);
    });

    it('uses the larger of the two radii for the half-extent', () => {
        const center = [0, 0];
        const a = geom.getBoundingBox(center, 5, 1, 0);
        const b = geom.getBoundingBox(center, 1, 5, 0);
        // Same maxRadius (5) => identical boxes regardless of which axis is larger.
        expect(a).toEqual(b);
    });

    it('larger radius => taller box (more latitude span)', () => {
        const center = [0, 0];
        const small = geom.getBoundingBox(center, 1, 0.6, 0);
        const large = geom.getBoundingBox(center, 10, 6, 0);
        expect(large[3] - large[1]).toBeGreaterThan(small[3] - small[1]);
    });

    it('lat half-extent: 1 km ≈ 1/111.32 deg', () => {
        const bbox = geom.getBoundingBox([0, 0], 1, 0.6, 0);
        expect(bbox[3]).toBeCloseTo(1000 / 111320, 9);
        expect(bbox[1]).toBeCloseTo(-1000 / 111320, 9);
    });

    it('polar singularity: cos(lat) ~ 0 at the pole blows up the lng extent', () => {
        // At lat = 90, cos(90 deg) ≈ 6.12e-17, so radiusInDegrees / cosLat is enormous.
        const bbox = geom.getBoundingBox([0, 90], 1, 0.6, 0);
        const lngSpan = bbox[2] - bbox[0];
        expect(Number.isFinite(lngSpan)).toBe(true);
        expect(lngSpan).toBeGreaterThan(1e10); // documented: extreme, not clamped to [-180,180]
    });

    it('bearing argument is ignored (does not affect the box)', () => {
        const center = [0, 0];
        expect(geom.getBoundingBox(center, 2, 1, 0))
            .toEqual(geom.getBoundingBox(center, 2, 1, 137));
    });
});

// ============================================================================
// Round-trip / orchestration: handle calc -> generate
// ============================================================================

describe('AddEllipseGeometry resize round-trip (handle -> radius -> turf)', () => {
    it('generateEllipseGeometry receives the radius computed from a handle drag', () => {
        const center = [0, 0];
        const handle = [0.03, 0.04]; // 5 km
        const newMajor = geom.calculateHorizontalRadius(center, handle, 90);
        geom.generateEllipseGeometry(center, newMajor, newMajor * 0.6, 90);
        expect(globalThis.turf.ellipse._lastCall.xSemi).toBeCloseTo(5, 9);
        expect(globalThis.turf.ellipse._lastCall.ySemi).toBeCloseTo(3, 9);
    });
});

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// add_sector_geometry imports BaseGeometry from the `@tools` barrel, which pulls
// in DOM/MapLibre-coupled modules. Mock the barrel with a trivial BaseGeometry so
// the pure geometry math can be tested in the `node` environment.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
    },
}));

const { default: AddSectorGeometry } = await import('../../src/js/draw_tools/sector_tool/add_sector_geometry.js');

const geom = new AddSectorGeometry();

// ============================================================================
// validate
// ============================================================================

describe('AddSectorGeometry.validate', () => {
    it('accepts valid parameters', () => {
        expect(geom.validate([0, 0], 1000, 60)).toBe(true);
    });
    it('rejects a missing/short center', () => {
        expect(geom.validate(null, 1000, 60)).toBe(false);
        expect(geom.validate([0], 1000, 60)).toBe(false);
    });
    it('rejects radius below the 10 m minimum', () => {
        expect(geom.validate([0, 0], 9, 60)).toBe(false);
    });
    it('accepts aperture boundaries 1 and 359', () => {
        expect(geom.validate([0, 0], 1000, 1)).toBe(true);
        expect(geom.validate([0, 0], 1000, 359)).toBe(true);
    });
    it('rejects aperture outside [1, 359]', () => {
        expect(geom.validate([0, 0], 1000, 0)).toBe(false);
        expect(geom.validate([0, 0], 1000, 360)).toBe(false);
    });
});

// ============================================================================
// calculateBearing — geographic convention (0=N, clockwise)
// ============================================================================

describe('AddSectorGeometry.calculateBearing', () => {
    const c = [0, 0];
    it('north → 0°', () => expect(geom.calculateBearing(c, [0, 1])).toBeCloseTo(0, 6));
    it('east → 90°', () => expect(geom.calculateBearing(c, [1, 0])).toBeCloseTo(90, 6));
    it('south → 180°', () => expect(geom.calculateBearing(c, [0, -1])).toBeCloseTo(180, 6));
    it('west → 270°', () => expect(geom.calculateBearing(c, [-1, 0])).toBeCloseTo(270, 6));
});

// ============================================================================
// pointAtBearing + round-trip invariant
// ============================================================================

describe('AddSectorGeometry.pointAtBearing', () => {
    const c = [0, 0];
    it('bearing 0 moves north (lat up)', () => {
        const p = geom.pointAtBearing(c, 1000, 0);
        expect(p[1]).toBeGreaterThan(0);
        expect(p[0]).toBeCloseTo(0, 6);
    });
    it('bearing 90 moves east (lng up)', () => {
        const p = geom.pointAtBearing(c, 1000, 90);
        expect(p[0]).toBeGreaterThan(0);
        expect(p[1]).toBeCloseTo(0, 6);
    });

    it('property: calculateBearing(pointAtBearing(b)) ≈ b', () => {
        const center = [-44.5, -22.5];
        fc.assert(fc.property(
            fc.double({ min: 0, max: 359.999, noNaN: true }),
            fc.double({ min: 100, max: 5000, noNaN: true }),
            (b, r) => {
                const p = geom.pointAtBearing(center, r, b);
                const back = geom.calculateBearing(center, p);
                let diff = Math.abs(back - b);
                if (diff > 180) diff = 360 - diff;
                expect(diff).toBeLessThan(0.01);
            }
        ));
    });
});

// ============================================================================
// generateSectorGeometry
// ============================================================================

describe('AddSectorGeometry.generateSectorGeometry', () => {
    it('returns a closed Polygon ring anchored at the centre', () => {
        const center = [0, 0];
        const g = geom.generateSectorGeometry(center, 1000, 90, 60);
        expect(g.type).toBe('Polygon');
        const ring = g.coordinates[0];
        expect(ring[0]).toEqual(center);
        expect(ring[ring.length - 1]).toEqual(center);
        expect(ring.length).toBeGreaterThanOrEqual(18);
    });

    it('arc spans [bearing - aperture/2, bearing + aperture/2]', () => {
        const center = [0, 0];
        const g = geom.generateSectorGeometry(center, 1000, 90, 60);
        const ring = g.coordinates[0];
        const firstArc = ring[1];
        const lastArc = ring[ring.length - 2];
        expect(geom.calculateBearing(center, firstArc)).toBeCloseTo(60, 4);
        expect(geom.calculateBearing(center, lastArc)).toBeCloseTo(120, 4);
    });

    it('property: every arc vertex sits at ~radius from the centre', () => {
        const center = [0, 0];
        fc.assert(fc.property(
            fc.double({ min: 0, max: 359.999, noNaN: true }),
            fc.integer({ min: 1, max: 359 }),
            fc.double({ min: 50, max: 5000, noNaN: true }),
            (bearing, aperture, radius) => {
                const ring = geom.generateSectorGeometry(center, radius, bearing, aperture).coordinates[0];
                // Skip the two centre anchors (first and last vertex).
                for (let i = 1; i < ring.length - 1; i++) {
                    const [lng, lat] = ring[i];
                    // Equirectangular metres back from degrees (cosLat = 1 at the equator).
                    const dx = lng * 111320;
                    const dy = lat * 111320;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    expect(Math.abs(dist - radius)).toBeLessThan(radius * 0.01 + 1);
                }
            }
        ));
    });
});

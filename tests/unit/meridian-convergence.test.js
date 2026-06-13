import { describe, it, expect } from 'vitest';
import {
    calculateMeridianConvergence,
    utmCentralMeridian,
} from '../../src/js/utilities/geomagnetic/meridian_convergence.js';

// ============================================================================
// utmCentralMeridian
// ============================================================================

describe('utmCentralMeridian', () => {
    it('returns -51 for longitudes in UTM zone 22 (e.g. -50)', () => {
        expect(utmCentralMeridian(-50)).toBe(-51);
    });

    it('returns -45 for UTM zone 23 (e.g. -44)', () => {
        expect(utmCentralMeridian(-44)).toBe(-45);
    });

    it('returns 3 for UTM zone 31 (e.g. 2)', () => {
        expect(utmCentralMeridian(2)).toBe(3);
    });
});

// ============================================================================
// calculateMeridianConvergence
// ============================================================================

describe('calculateMeridianConvergence', () => {
    it('is ~0 on the equator (sin φ = 0) regardless of longitude', () => {
        expect(calculateMeridianConvergence(0, -50)).toBe(0);
        expect(calculateMeridianConvergence(0, 10)).toBe(0);
    });

    it('is ~0 when the point lies on the central meridian', () => {
        // lng -51 is the central meridian of zone 22 → Δλ = 0
        expect(calculateMeridianConvergence(-15, -51)).toBe(0);
    });

    it('is negative (West) east of the CM in the southern hemisphere', () => {
        // lat -15, lng -50, CM = -51 → Δλ = +1°, sin(φ) < 0 → γ < 0
        const gamma = calculateMeridianConvergence(-15, -50);
        expect(gamma).toBeLessThan(0);
        expect(gamma).toBeCloseTo(-0.26, 1);
    });

    it('is positive (East) west of the CM in the southern hemisphere', () => {
        // lat -15, lng -52, CM = -51 → Δλ = -1°, sin(φ) < 0 → γ > 0
        const gamma = calculateMeridianConvergence(-15, -52);
        expect(gamma).toBeGreaterThan(0);
        expect(gamma).toBeCloseTo(0.26, 1);
    });

    it('flips sign across hemispheres for the same Δλ', () => {
        const south = calculateMeridianConvergence(-15, -50);
        const north = calculateMeridianConvergence(15, -50);
        expect(Math.sign(south)).toBe(-Math.sign(north));
        expect(Math.abs(south)).toBeCloseTo(Math.abs(north), 2);
    });

    it('accepts an explicit central meridian override', () => {
        // Δλ = +1°, φ = -15° → γ = (1°)·sin(-15°) ≈ -0.2588°
        const gamma = calculateMeridianConvergence(-15, -50, -51);
        expect(gamma).toBeCloseTo(-0.26, 1);
    });

    it('returns null for out-of-range coordinates', () => {
        expect(calculateMeridianConvergence(95, -50)).toBeNull();
        expect(calculateMeridianConvergence(-15, 200)).toBeNull();
    });

    it('returns null for non-finite coordinates (undefined/NaN/Infinity)', () => {
        expect(calculateMeridianConvergence(undefined, undefined)).toBeNull();
        expect(calculateMeridianConvergence(NaN, -50)).toBeNull();
        expect(calculateMeridianConvergence(-15, NaN)).toBeNull();
        expect(calculateMeridianConvergence(Infinity, -50)).toBeNull();
    });
});

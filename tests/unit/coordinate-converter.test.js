import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    parseCoordinates,
    formatCoordinates,
    tryParseCoordinates,
} from '../../src/js/utilities/coordinate_converter.js';

// ============================================================================
// Example-based: parsing
// ============================================================================

describe('parseCoordinates — decimal lat/long', () => {
    it('parses comma-separated decimals', () => {
        expect(parseCoordinates('-22.455921, -44.449655', 'latlong'))
            .toEqual({ lat: -22.455921, lng: -44.449655 });
    });

    it('parses space-separated decimals', () => {
        const r = parseCoordinates('-22.45 -44.44', 'latlong');
        expect(r.lat).toBeCloseTo(-22.45, 5);
        expect(r.lng).toBeCloseTo(-44.44, 5);
    });

    it('returns null for garbage', () => {
        expect(parseCoordinates('not a coordinate', 'latlong')).toBeNull();
    });

    it('returns null for out-of-range latitude', () => {
        expect(parseCoordinates('95, 0', 'latlong')).toBeNull();
    });
});

describe('parseCoordinates — DMS with Brazilian directions (L/O)', () => {
    it('parses DMS with symbols and S/O', () => {
        const r = parseCoordinates('22º27\'21.3" S 44º26\'58.8" O', 'latlong_dms');
        expect(r.lat).toBeCloseTo(-22.4559, 3);
        expect(r.lng).toBeCloseTo(-44.4497, 3);
    });

    it('parses space-separated DMS', () => {
        const r = parseCoordinates('22 27 21 S 44 26 58 O', 'latlong_dms');
        expect(r.lat).toBeLessThan(0);
        expect(r.lng).toBeLessThan(0);
    });
});

describe('parseCoordinates — UTM and MGRS', () => {
    it('parses UTM WGS84 (hemisphere letter N/S)', () => {
        const utm = formatCoordinates(-22.455921, -44.449655, 'utm_wgs84');
        expect(utm).toMatch(/^23S /); // zone 23, southern hemisphere
        const r = parseCoordinates(utm, 'utm_wgs84');
        expect(r.lat).toBeCloseTo(-22.455921, 3);
        expect(r.lng).toBeCloseTo(-44.449655, 3);
    });

    it('does NOT accept the MGRS band letter as UTM hemisphere (current behavior)', () => {
        // Note: getPlaceholderForFormat advertises "23K 680834 7516602", but
        // parseUTMWGS84 only accepts N/S (or none) — a band letter yields null.
        expect(parseCoordinates('23K 680834 7516602', 'utm_wgs84')).toBeNull();
    });

    it('rejects easting out of band', () => {
        expect(parseCoordinates('23S 50 7516602', 'utm_wgs84')).toBeNull();
    });

    it('parses MGRS round-trip from a formatted value', () => {
        const mgrsStr = formatCoordinates(-22.45, -44.45, 'mgrs');
        const r = parseCoordinates(mgrsStr, 'mgrs');
        expect(r.lat).toBeCloseTo(-22.45, 3);
        expect(r.lng).toBeCloseTo(-44.45, 3);
    });
});

// ============================================================================
// Example-based: auto-detection
// ============================================================================

describe('tryParseCoordinates — format auto-detection', () => {
    it('detects decimal', () => {
        expect(tryParseCoordinates('-22.45, -44.45')?.format).toBe('latlong');
    });

    it('detects UTM', () => {
        expect(tryParseCoordinates('23S 680834 7516602')?.format).toBe('utm_wgs84');
    });

    it('detects MGRS', () => {
        expect(tryParseCoordinates('23K TP 80834 16602')?.format).toBe('mgrs');
    });

    it('detects DMS', () => {
        expect(tryParseCoordinates('22º27\'21" S 44º26\'58" O')?.format).toBe('latlong_dms');
    });

    it('returns null for too-short / junk input', () => {
        expect(tryParseCoordinates('x')).toBeNull();
        expect(tryParseCoordinates('hello world')).toBeNull();
    });
});

// ============================================================================
// Property-based: round-trips (the high-value coverage)
// ============================================================================

// Keep away from poles/antimeridian where UTM/MGRS are undefined or wrap.
const lat = () => fc.double({ min: -78, max: 78, noNaN: true });
const lng = () => fc.double({ min: -178, max: 178, noNaN: true });

describe('round-trip properties', () => {
    it('decimal: parse(format(p)) ≈ p', () => {
        fc.assert(fc.property(lat(), lng(), (la, lo) => {
            const p = parseCoordinates(formatCoordinates(la, lo, 'latlong'), 'latlong');
            expect(p).not.toBeNull();
            expect(p.lat).toBeCloseTo(la, 4);
            expect(p.lng).toBeCloseTo(lo, 4);
        }));
    });

    it('UTM WGS84: parse(format(p)) ≈ p (within ~1 m)', () => {
        fc.assert(fc.property(lat(), lng(), (la, lo) => {
            const p = parseCoordinates(formatCoordinates(la, lo, 'utm_wgs84'), 'utm_wgs84');
            expect(p).not.toBeNull();
            // 1e-3 deg ≈ 110 m — generous; rounding to the metre is far tighter.
            expect(p.lat).toBeCloseTo(la, 3);
            expect(p.lng).toBeCloseTo(lo, 3);
        }));
    });

    it('MGRS: parse(format(p)) ≈ p (precision 5 ≈ 1 m)', () => {
        fc.assert(fc.property(lat(), lng(), (la, lo) => {
            const p = parseCoordinates(formatCoordinates(la, lo, 'mgrs'), 'mgrs');
            expect(p).not.toBeNull();
            expect(p.lat).toBeCloseTo(la, 3);
            expect(p.lng).toBeCloseTo(lo, 3);
        }));
    });
});

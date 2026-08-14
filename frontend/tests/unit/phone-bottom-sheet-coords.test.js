// Path: tests/unit/phone-bottom-sheet-coords.test.js

/**
 * Regression tests for the phone bottom-sheet coordinate readout.
 *
 * Root cause: the sheet had a local `ddToUtm` that printed the raw longitude and
 * latitude as easting/northing (`23S -43E -23N`) under a label that said UTM. The
 * sheet now delegates to the shared converter, so the phone shows the same projected
 * values as the desktop.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { coordFormatToConverterId } from '../../src/js/phone/phone-bottom-sheet.js';
import { formatCoordinates, parseCoordinates } from '../../src/js/utilities/coordinate_converter.js';

describe('coordFormatToConverterId', () => {
    it('routes UTM to the projected converter, never to a raw lat/lng print', () => {
        expect(coordFormatToConverterId('utm')).toBe('utm_wgs84');
    });

    it('routes DD and DMS to their converter ids', () => {
        expect(coordFormatToConverterId('dd')).toBe('latlong');
        expect(coordFormatToConverterId('dms')).toBe('latlong_dms');
    });

    it.each([
        ['unknown format', 'sexagesimal'],
        ['empty string', ''],
        ['undefined', undefined],
        ['null', null],
    ])('falls back to latlong for %s', (_label, value) => {
        expect(coordFormatToConverterId(value)).toBe('latlong');
    });
});

describe('UTM readout is a real projection', () => {
    it('projects Rio de Janeiro into zone 23S with plausible easting/northing', () => {
        const out = formatCoordinates(-22.9, -43.2, coordFormatToConverterId('utm'));
        const [zone, easting, northing] = out.split(' ');

        expect(zone).toBe('23S');
        // The old helper printed `-43` and `-23` here.
        expect(Number(easting)).toBeGreaterThan(160000);
        expect(Number(easting)).toBeLessThan(840000);
        expect(Number(northing)).toBeGreaterThan(7000000);
    });

    it('keeps easting inside the valid UTM band at a zone edge (boundary case)', () => {
        // Longitude -42 is the eastern edge of zone 23 (central meridian -45).
        const out = formatCoordinates(0, -42.0000001, coordFormatToConverterId('utm'));
        const easting = Number(out.split(' ')[1]);
        expect(easting).toBeGreaterThan(160000);
        expect(easting).toBeLessThan(840000);
    });

    it('switches hemisphere letter at the equator', () => {
        expect(formatCoordinates(0, -45, 'utm_wgs84').split(' ')[0]).toMatch(/^23N$/);
        expect(formatCoordinates(-0.0001, -45, 'utm_wgs84').split(' ')[0]).toMatch(/^23S$/);
    });

    it('round-trips lat/lng through the UTM string', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -70, max: 70, noNaN: true }),
                fc.double({ min: -179, max: 179, noNaN: true }),
                (lat, lng) => {
                    const utm = formatCoordinates(lat, lng, 'utm_wgs84');
                    const back = parseCoordinates(utm, 'utm_wgs84');
                    expect(back).not.toBeNull();
                    expect(back.lat).toBeCloseTo(lat, 3);
                    expect(back.lng).toBeCloseTo(lng, 3);
                },
            ),
            { numRuns: 200 },
        );
    });
});

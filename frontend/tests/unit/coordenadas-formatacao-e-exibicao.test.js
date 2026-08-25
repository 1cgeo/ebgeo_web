// Path: tests/unit/coordenadas-formatacao-e-exibicao.test.js

/**
 * @fileoverview Pins the OUTPUT half of `utilities/coordinate_converter.js`:
 * `formatCoordinates`, `getDisplayFormat` and `getPlaceholderForFormat`.
 *
 * What this suite HOLDS:
 * - the DMS spelling (Brazilian `L`/`O`, the `º` degree sign, zero padding of
 *   minutes and seconds) and the seconds CARRY defect (`59.96s` prints as
 *   `60.0`, a minute that never rolls over);
 * - the UTM zone arithmetic at both ends of the antimeridian, including the
 *   NON-EXISTENT zone 61 produced at `lng === 180`, which the module's own
 *   parser then refuses (a round-trip that loses the point);
 * - the decimal places each surface commits to (`formatCoordinates` 6,
 *   `getDisplayFormat` 5, UTM display 2);
 * - the MGRS spacing rule, which only fires for a 15-character string, so a
 *   single-digit UTM zone comes back unspaced;
 * - every failure path falling back to the decimal string / decimal parts;
 * - the self-consistency of the four placeholders against the parser that is
 *   supposed to read them.
 *
 * What it does NOT reach: parsing (already held by
 * `tests/unit/coordinate-converter.test.js`, which covers `parseCoordinates`,
 * `tryParseCoordinates` and the decimal/UTM/MGRS round-trips), and the
 * numerical accuracy of `proj4`/`mgrs` themselves, which are real npm deps here
 * and are treated as the oracle, not as the subject.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import {
    formatCoordinates,
    getDisplayFormat,
    getPlaceholderForFormat,
    parseCoordinates,
    COORDINATE_FORMATS,
} from '../../src/js/utilities/coordinate_converter.js';

// The module reports every fallback through console.error; the fallback itself
// is what several cases below assert, so silence the channel instead of the code.
beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// formatCoordinates — decimal
// ============================================================================

describe('formatCoordinates — latlong (decimal)', () => {
    it('emits exactly six decimal places, comma separated', () => {
        expect(formatCoordinates(-22.455921, -44.449655, 'latlong'))
            .toBe('-22.455921, -44.449655');
    });

    it('pads a whole number out to six decimals', () => {
        expect(formatCoordinates(0, 0, 'latlong')).toBe('0.000000, 0.000000');
    });

    it('collapses -0 into an unsigned zero', () => {
        // toFixed on -0 drops the sign; the string carries no trace of it.
        expect(formatCoordinates(-0, -0, 'latlong')).toBe('0.000000, 0.000000');
    });

    it('rounds rather than truncates the seventh decimal', () => {
        expect(formatCoordinates(1.00000049, 1.00000051, 'latlong'))
            .toBe('1.000000, 1.000001');
    });

    it('falls back to the decimal string for an unknown format id', () => {
        expect(formatCoordinates(1, 2, 'no-such-format')).toBe('1.000000, 2.000000');
    });
});

// ============================================================================
// formatCoordinates — DMS
// ============================================================================

describe('formatCoordinates — latlong_dms (Brazilian directions)', () => {
    it('uses S and O in the southwest quadrant', () => {
        expect(formatCoordinates(-22.455921, -44.449655, 'latlong_dms'))
            .toBe('22º27\'21.3" S 44º26\'58.8" O');
    });

    it('uses L (Leste) and not E for a positive longitude', () => {
        const out = formatCoordinates(-10, 20, 'latlong_dms');
        expect(out.endsWith(' L')).toBe(true);
        expect(out).not.toContain('E');
        expect(out).not.toContain('W');
    });

    it('treats the equator and Greenwich as N and L (the >= 0 boundary)', () => {
        expect(formatCoordinates(0, 0, 'latlong_dms'))
            .toBe('0º00\'00.0" N 0º00\'00.0" L');
    });

    it('reads -0 as N and L, because -0 >= 0 is true', () => {
        // The sign of a signed zero does NOT reach the direction letter.
        expect(formatCoordinates(-0, -0, 'latlong_dms'))
            .toBe('0º00\'00.0" N 0º00\'00.0" L');
    });

    it('flips to S and O for the smallest negative magnitude', () => {
        const out = formatCoordinates(-0.0001, -0.0001, 'latlong_dms');
        expect(out).toBe('0º00\'00.4" S 0º00\'00.4" O');
    });

    it('zero-pads minutes to two digits and seconds to four characters', () => {
        // 1 deg 2 min 3.4 sec -> "1º02'03.4""; the seconds pad is on the WHOLE
        // token (including the decimal point), which is why 3.4 becomes 03.4.
        const out = formatCoordinates(1 + 2 / 60 + 3.4 / 3600, 0, 'latlong_dms');
        expect(out.startsWith('1º02\'03.4" N')).toBe(true);
    });

    it('does not pad the degrees field (three-digit longitude keeps its width)', () => {
        const out = formatCoordinates(0, -100, 'latlong_dms');
        expect(out).toContain('100º00\'00.0" O');
    });

    it('reaches the poles and the antimeridian without throwing', () => {
        expect(formatCoordinates(90, 180, 'latlong_dms'))
            .toBe('90º00\'00.0" N 180º00\'00.0" L');
        expect(formatCoordinates(-90, -180, 'latlong_dms'))
            .toBe('90º00\'00.0" S 180º00\'00.0" O');
    });
});

describe('formatCoordinates — DMS seconds carry (DEFEITO)', () => {
    // 1 deg 1 min 59.99 sec. Seconds are printed with toFixed(1) AFTER the
    // minute has already been floored, so the rounding has nowhere to carry to.
    const CARRY_LAT = 1 + 1 / 60 + 59.99 / 3600;

    it('CONTROLE: a value just below the carry prints a normal second', () => {
        const out = formatCoordinates(1 + 1 / 60 + 59.9 / 3600, 0, 'latlong_dms');
        expect(out.startsWith('1º01\'59.9" N')).toBe(true);
    });

    it('CONSERTADO: seconds that round to 60.0 roll the minute over', () => {
        const out = formatCoordinates(CARRY_LAT, 0, 'latlong_dms');
        expect(out.startsWith('1º02\'00.0" N')).toBe(true);
        expect(out).not.toMatch(/'60\.0"/);
    });

    it('CONSERTADO: the carry chains to the DEGREE when the minute also overflows', () => {
        // 1º59\'59.99" is the case one carry does not cover: without the second
        // step the label would read 1º60\'00.0".
        const out = formatCoordinates(1 + 59 / 60 + 59.99 / 3600, 0, 'latlong_dms');
        expect(out.startsWith('2º00\'00.0" N')).toBe(true);
        expect(out).not.toMatch(/º60'/);
    });

    it('CONTROLE: the carried minute is zero-padded like any other', () => {
        const out = formatCoordinates(1 + 8 / 60 + 59.99 / 3600, 0, 'latlong_dms');
        expect(out.startsWith('1º09\'00.0" N')).toBe(true);
    });

    it('OBSERVADO: the carried string still parses back to the right value', () => {
        // The parser accepts 60 seconds, so the defect is display-only: the
        // number survives the round-trip even though the spelling is wrong.
        const out = formatCoordinates(CARRY_LAT, 0, 'latlong_dms');
        const back = parseCoordinates(out, 'latlong_dms');
        expect(back).not.toBeNull();
        // Tenth-of-a-second resolution is ~2.8e-5 degree, and that is the whole
        // budget: the carry costs no accuracy on top of it.
        expect(Math.abs(back.lat - CARRY_LAT)).toBeLessThan(3e-5);
    });
});

describe('formatCoordinates — DMS round-trip (fast-check)', () => {
    it('parse(format(p)) recovers the point to better than 0.001 degree', () => {
        fc.assert(
            fc.property(
                // Kept off the exact poles/antimeridian: seconds rounding at
                // |lat| = 89.99999... would land the parse exactly on 90, which
                // is a separate boundary already covered above.
                fc.double({ min: -89.9, max: 89.9, noNaN: true }),
                fc.double({ min: -179.9, max: 179.9, noNaN: true }),
                (lat, lng) => {
                    const back = parseCoordinates(
                        formatCoordinates(lat, lng, 'latlong_dms'),
                        'latlong_dms'
                    );
                    expect(back).not.toBeNull();
                    expect(Math.abs(back.lat - lat)).toBeLessThan(1e-3);
                    expect(Math.abs(back.lng - lng)).toBeLessThan(1e-3);
                }
            ),
            { numRuns: 300 }
        );
    });

    it('the direction letter always agrees with the sign of the input', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -89.9, max: 89.9, noNaN: true }),
                fc.double({ min: -179.9, max: 179.9, noNaN: true }),
                (lat, lng) => {
                    const out = formatCoordinates(lat, lng, 'latlong_dms');
                    const [latHalf, lngHalf] = out.split(' ').reduce(
                        (acc, tok, i) => (i < 2 ? [acc[0] + tok, acc[1]] : [acc[0], acc[1] + tok]),
                        ['', '']
                    );
                    expect(latHalf.endsWith(lat >= 0 ? 'N' : 'S')).toBe(true);
                    expect(lngHalf.endsWith(lng >= 0 ? 'L' : 'O')).toBe(true);
                }
            ),
            { numRuns: 200 }
        );
    });
});

// ============================================================================
// formatCoordinates — UTM
// ============================================================================

describe('formatCoordinates — utm_wgs84 zone arithmetic', () => {
    it('formats a southern-hemisphere point with zone, hemisphere and rounded metres', () => {
        expect(formatCoordinates(-22.45, -44.44, 'utm_wgs84')).toBe('23S 557620 7517255');
    });

    it('calls the equator N, because the hemisphere test is lat >= 0', () => {
        expect(formatCoordinates(0, -44.44, 'utm_wgs84').startsWith('23N')).toBe(true);
    });

    it('maps lng -180 to zone 1', () => {
        expect(formatCoordinates(0, -180, 'utm_wgs84').startsWith('1N ')).toBe(true);
    });

    it('maps the last longitude before the antimeridian to zone 60', () => {
        expect(formatCoordinates(0, 179.999, 'utm_wgs84').startsWith('60N ')).toBe(true);
    });

    it('crosses zone boundaries exactly every 6 degrees from -180', () => {
        expect(formatCoordinates(0, -174, 'utm_wgs84').startsWith('2N ')).toBe(true);
        expect(formatCoordinates(0, -174.000001, 'utm_wgs84').startsWith('1N ')).toBe(true);
        expect(formatCoordinates(0, 0, 'utm_wgs84').startsWith('31N ')).toBe(true);
        expect(formatCoordinates(0, -0.000001, 'utm_wgs84').startsWith('30N ')).toBe(true);
    });

    it('falls back to the decimal string when proj4 refuses a non-finite input', () => {
        expect(formatCoordinates(NaN, 0, 'utm_wgs84')).toBe('NaN, 0.000000');
        expect(formatCoordinates(Infinity, 0, 'utm_wgs84')).toBe('Infinity, 0.000000');
    });
});

describe('formatCoordinates — UTM zone at the antimeridian (CONSERTADO)', () => {
    it('CONTROLE: one ulp west of the antimeridian still yields the legal zone 60', () => {
        expect(formatCoordinates(0, 179.9999999, 'utm_wgs84').startsWith('60N ')).toBe(true);
    });

    it('CONSERTADO: lng exactly 180 clamps to zone 60, not the non-existent 61', () => {
        const zone = Number(formatCoordinates(0, 180, 'utm_wgs84').match(/^(\d+)/)[1]);
        expect(zone).toBe(60);
    });

    it('CONSERTADO: the module can now read back what it just wrote', () => {
        // parseUTMWGS84 rejects zone > 60, so the emitted string used to be
        // unparseable by this very module: a user copying it back got nothing.
        const written = formatCoordinates(0, 180, 'utm_wgs84');
        const back = parseCoordinates(written, 'utm_wgs84');
        expect(back).not.toBeNull();
        expect(back.lat).toBeCloseTo(0, 4);
        // It comes back as -179.999996, not +180: zone 60 has its own wrap and
        // the two spellings are the same physical point. The property that
        // matters is that the point survived at all, and on the antimeridian.
        expect(Math.abs(back.lng)).toBeGreaterThan(179.999);
    });

    it('CONTROLE: the clamp does not flatten a legal zone into 60', () => {
        // A clamp written as "always 60" would pass the case above and destroy
        // every other zone, so this is asserted absolutely.
        expect(formatCoordinates(0, -45, 'utm_wgs84').startsWith('23N ')).toBe(true);
        expect(formatCoordinates(0, 0, 'utm_wgs84').startsWith('31N ')).toBe(true);
    });

    it('CONSERTADO: the lower end clamps too, so lng below -180 cannot yield zone 0', () => {
        const zone = Number(formatCoordinates(0, -180.5, 'utm_wgs84').match(/^(\d+)/)[1]);
        expect(zone).toBe(1);
    });
});

// ============================================================================
// formatCoordinates — MGRS
// ============================================================================

describe('formatCoordinates — mgrs', () => {
    it('spaces a two-digit zone into zone / square / easting / northing', () => {
        const out = formatCoordinates(-22.455921, -44.449655, 'mgrs');
        expect(out).toMatch(/^\d{2}[A-Z] [A-Z]{2} \d{5} \d{5}$/);
    });

    it('OBSERVADO: a single-digit zone comes back UNSPACED (the rule keys on length 15)', () => {
        // formatMGRSWithSpaces only splits a 15-character string; zones 1-9
        // produce 14 characters, so the readability pass silently does nothing.
        const out = formatCoordinates(0, -177, 'mgrs');
        expect(out).toMatch(/^\d[A-Z][A-Z]{2}\d{10}$/);
        expect(out).not.toContain(' ');
    });

    it('falls back to the decimal string north of the MGRS limit (lat 85)', () => {
        expect(formatCoordinates(85, 0, 'mgrs')).toBe('85.000000, 0.000000');
    });

    it('falls back to the decimal string south of the MGRS limit (lat -85)', () => {
        expect(formatCoordinates(-85, 0, 'mgrs')).toBe('-85.000000, 0.000000');
    });
});

// ============================================================================
// getDisplayFormat
// ============================================================================

describe('getDisplayFormat', () => {
    it('latlong: two labelled parts with FIVE decimals and a degree sign', () => {
        expect(getDisplayFormat(-22.455921, -44.449655, 'latlong')).toEqual({
            parts: [
                { label: 'Lat', value: '-22.45592°' },
                { label: 'Lon', value: '-44.44965°' },
            ],
        });
    });

    it('latlong: the display surface is one decimal SHORTER than formatCoordinates', () => {
        const decimals = (s) => s.split('.')[1].replace('°', '').length;
        expect(decimals(getDisplayFormat(1, 2, 'latlong').parts[0].value)).toBe(5);
        expect(formatCoordinates(1, 2, 'latlong').split(', ')[0].split('.')[1].length).toBe(6);
    });

    it('latlong_dms: same spelling as formatCoordinates, split into two parts', () => {
        const parts = getDisplayFormat(-22.455921, -44.449655, 'latlong_dms').parts;
        expect(parts).toHaveLength(2);
        expect(`${parts[0].value} ${parts[1].value}`)
            .toBe(formatCoordinates(-22.455921, -44.449655, 'latlong_dms'));
    });

    it('utm_wgs84: three parts, with metres to two decimals and NOT rounded like the string form', () => {
        const parts = getDisplayFormat(-22.455921, -44.449655, 'utm_wgs84').parts;
        expect(parts).toHaveLength(3);
        expect(parts[0]).toEqual({ label: 'Zona', value: '23S' });
        expect(parts[1].label).toBe('E');
        expect(parts[1].value).toMatch(/^\d+\.\d{2}m$/);
        expect(parts[2].value).toMatch(/^\d+\.\d{2}m$/);
    });

    it('mgrs: a single part, spaced when the raw string is 15 characters', () => {
        const parts = getDisplayFormat(-22.455921, -44.449655, 'mgrs').parts;
        expect(parts).toHaveLength(1);
        expect(parts[0].label).toBe('MGRS');
        expect(parts[0].value).toMatch(/^\d{2}[A-Z] [A-Z]{2} \d{5} \d{5}$/);
    });

    it('mgrs: degrades to the decimal PARTS (not to a single MGRS part) when mgrs throws', () => {
        expect(getDisplayFormat(0, -177, 'mgrs').parts[0].label).toBe('MGRS');
        expect(getDisplayFormat(85, 0, 'mgrs')).toEqual({
            parts: [
                { label: 'Lat', value: '85.00000°' },
                { label: 'Lon', value: '0.00000°' },
            ],
        });
    });

    it('unknown format id degrades to the decimal parts instead of throwing', () => {
        expect(getDisplayFormat(1, 2, 'zzz')).toEqual({
            parts: [
                { label: 'Lat', value: '1.00000°' },
                { label: 'Lon', value: '2.00000°' },
            ],
        });
    });

    it('OBSERVADO: NaN is NOT guarded and leaks into the UI as the string "NaN°"', () => {
        // `toFixed` on NaN yields "NaN"; there is no Number.isFinite gate here.
        expect(getDisplayFormat(NaN, NaN, 'latlong')).toEqual({
            parts: [
                { label: 'Lat', value: 'NaN°' },
                { label: 'Lon', value: 'NaN°' },
            ],
        });
    });

    it('every declared format id produces a non-empty parts array', () => {
        expect(COORDINATE_FORMATS).toHaveLength(4);
        for (const { id } of COORDINATE_FORMATS) {
            const out = getDisplayFormat(-22.455921, -44.449655, id);
            expect(Array.isArray(out.parts)).toBe(true);
            expect(out.parts.length).toBeGreaterThan(0);
            for (const part of out.parts) {
                expect(typeof part.label).toBe('string');
                expect(typeof part.value).toBe('string');
                expect(part.value.length).toBeGreaterThan(0);
            }
        }
    });
});

// ============================================================================
// getPlaceholderForFormat — self-consistency against the parser
// ============================================================================

describe('getPlaceholderForFormat', () => {
    it('answers every declared format and a default for anything else', () => {
        expect(COORDINATE_FORMATS.map(f => getPlaceholderForFormat(f.id))).toEqual([
            '-22.455921, -44.449655',
            '22º27\'21.3" S 44º26\'58.8" O',
            '23S 556624 7516604',
            '23K NR 56624 16603',
        ]);
        expect(getPlaceholderForFormat('zzz')).toBe('Entrar coordenadas');
        expect(getPlaceholderForFormat(undefined)).toBe('Entrar coordenadas');
    });

    it('the latlong and DMS placeholders parse in their own format', () => {
        expect(parseCoordinates(getPlaceholderForFormat('latlong'), 'latlong'))
            .toEqual({ lat: -22.455921, lng: -44.449655 });
        const dms = parseCoordinates(getPlaceholderForFormat('latlong_dms'), 'latlong_dms');
        expect(dms.lat).toBeCloseTo(-22.4559, 3);
        expect(dms.lng).toBeCloseTo(-44.4497, 3);
    });

    it('CONSERTADO: the UTM placeholder parses in its own format', () => {
        // The example advertised the MGRS band letter (`23K`), but parseUTMWGS84
        // accepts only N/S. A user who copied the hint verbatim got nothing.
        const point = parseCoordinates(getPlaceholderForFormat('utm_wgs84'), 'utm_wgs84');
        expect(point).not.toBeNull();
        expect(point.lat).toBeCloseTo(-22.4559, 3);
        expect(point.lng).toBeCloseTo(-44.4497, 3);
    });

    it('the MGRS placeholder parses once the spaces are stripped, as the parser does', () => {
        const point = parseCoordinates(getPlaceholderForFormat('mgrs'), 'mgrs');
        expect(point).not.toBeNull();
        expect(Number.isFinite(point.lat)).toBe(true);
        expect(Number.isFinite(point.lng)).toBe(true);
    });

    it('CONSERTADO: the four placeholders are ONE place, Resende, in four spellings', () => {
        // They used to be THREE different places: the decimal hint was Resende
        // (-22.4559, -44.4497), the MGRS hint fell ~1.7 south and ~5 east of it,
        // and the UTM hint did not parse at all. A user switching format expects
        // the hint to keep pointing at the same spot.
        const decimal = parseCoordinates(getPlaceholderForFormat('latlong'), 'latlong');
        expect(decimal).toEqual({ lat: -22.455921, lng: -44.449655 });

        for (const id of ['latlong_dms', 'utm_wgs84', 'mgrs']) {
            const point = parseCoordinates(getPlaceholderForFormat(id), id);
            expect(point, id).not.toBeNull();
            // Absolute tolerance, not a comparison between two hints: two hints
            // could agree on the wrong place.
            expect(Math.abs(point.lat - decimal.lat), id).toBeLessThan(1e-3);
            expect(Math.abs(point.lng - decimal.lng), id).toBeLessThan(1e-3);
        }
    });

    it('CONTROLE: each hint is exactly what the formatter writes for that point', () => {
        // The stronger property: the hints are not merely nearby, they are the
        // module's own output, so a formatter change that orphans them is visible.
        const { lat, lng } = { lat: -22.455921, lng: -44.449655 };
        for (const id of ['latlong', 'latlong_dms', 'utm_wgs84', 'mgrs']) {
            expect(formatCoordinates(lat, lng, id), id).toBe(getPlaceholderForFormat(id));
        }
    });
});

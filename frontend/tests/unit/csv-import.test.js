import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    parseCSV,
    parseCSVPreview,
    detectSeparator,
    CSV_SEPARATORS,
} from '../../src/js/import_export/csv/csv-parser.js';
import {
    convertRowToLatLng,
    autoDetectColumnMapping,
    CSV_COORDINATE_FORMATS,
    COLUMN_HINTS,
} from '../../src/js/import_export/csv/csv-coordinate-converter.js';
import { csvToGeoJSON } from '../../src/js/import_export/csv/csv-to-geojson.js';

// csv-parser and csv-coordinate-converter have no DOM coupling:
// - csv-parser is dependency-free
// - csv-coordinate-converter imports mgrs + proj4 (real npm deps)
// - csv-to-geojson only composes the two above
// So they can be exercised directly in the `node` environment.

// ============================================================================
// csv-parser: parseCSV — RFC 4180 quoting + line endings
// ============================================================================

describe('parseCSV — basic shape', () => {
    it('uses the first row as headers and builds row objects', () => {
        const text = 'nome,lat,lng\nA,1,2\nB,3,4';
        const { headers, rows, totalRows } = parseCSV(text, ',');
        expect(headers).toEqual(['nome', 'lat', 'lng']);
        expect(totalRows).toBe(2);
        expect(rows[0]).toEqual({ nome: 'A', lat: '1', lng: '2' });
        expect(rows[1]).toEqual({ nome: 'B', lat: '3', lng: '4' });
    });

    it('trims whitespace around headers and values', () => {
        const text = ' a , b \n  x  ,  y  ';
        const { headers, rows } = parseCSV(text, ',');
        expect(headers).toEqual(['a', 'b']);
        expect(rows[0]).toEqual({ a: 'x', b: 'y' });
    });

    it('handles CRLF line endings', () => {
        const text = 'a,b\r\n1,2\r\n3,4';
        const { rows, totalRows } = parseCSV(text, ',');
        expect(totalRows).toBe(2);
        expect(rows[1]).toEqual({ a: '3', b: '4' });
    });

    it('handles bare CR and mixed line endings', () => {
        const text = 'a,b\r1,2\n3,4\r\n5,6';
        const { totalRows } = parseCSV(text, ',');
        expect(totalRows).toBe(3);
    });

    it('pads missing trailing columns with empty strings', () => {
        const text = 'a,b,c\n1,2';
        const { rows } = parseCSV(text, ',');
        expect(rows[0]).toEqual({ a: '1', b: '2', c: '' });
    });

    it('ignores extra values beyond the header count', () => {
        const text = 'a,b\n1,2,3,4';
        const { rows } = parseCSV(text, ',');
        expect(rows[0]).toEqual({ a: '1', b: '2' });
    });

    it('skips fully blank data lines', () => {
        const text = 'a,b\n1,2\n\n , \n3,4';
        const { totalRows, rows } = parseCSV(text, ',');
        expect(totalRows).toBe(2);
        expect(rows.map(r => r.a)).toEqual(['1', '3']);
    });
});

describe('parseCSV — RFC 4180 quoting', () => {
    it('keeps the separator inside quoted fields', () => {
        const text = 'a,b\n"hello, world",2';
        const { rows } = parseCSV(text, ',');
        expect(rows[0].a).toBe('hello, world');
        expect(rows[0].b).toBe('2');
    });

    it('unescapes doubled quotes inside a quoted field', () => {
        const text = 'a,b\n"she said ""hi""",2';
        const { rows } = parseCSV(text, ',');
        expect(rows[0].a).toBe('she said "hi"');
    });

    it('keeps newlines embedded in quoted fields (single logical row)', () => {
        const text = 'a,b\n"line1\nline2",2';
        const { rows, totalRows } = parseCSV(text, ',');
        expect(totalRows).toBe(1);
        expect(rows[0].a).toBe('line1\nline2');
    });

    it('supports a quoted field containing the embedded line ending CRLF', () => {
        const text = 'a,b\r\n"x\r\ny",2\r\n5,6';
        const { rows, totalRows } = parseCSV(text, ',');
        expect(totalRows).toBe(2);
        expect(rows[0].a).toBe('x\r\ny');
        expect(rows[1]).toEqual({ a: '5', b: '6' });
    });
});

describe('parseCSV — empty / degenerate input', () => {
    it('returns empty result for empty text', () => {
        expect(parseCSV('', ',')).toEqual({ headers: [], rows: [], totalRows: 0 });
    });

    it('returns empty result for whitespace-only text', () => {
        expect(parseCSV('   \n  ', ',')).toEqual({ headers: [], rows: [], totalRows: 0 });
    });

    it('returns empty result when all headers are blank', () => {
        const r = parseCSV(' , , \n1,2,3', ',');
        expect(r).toEqual({ headers: [], rows: [], totalRows: 0 });
    });

    it('parses headers but no rows when only a header line exists', () => {
        const r = parseCSV('a,b,c', ',');
        expect(r.headers).toEqual(['a', 'b', 'c']);
        expect(r.totalRows).toBe(0);
    });
});

describe('parseCSV — alternate separators', () => {
    it('parses semicolon-separated data', () => {
        const { headers, rows } = parseCSV('a;b\n1;2', ';');
        expect(headers).toEqual(['a', 'b']);
        expect(rows[0]).toEqual({ a: '1', b: '2' });
    });

    it('parses tab-separated data', () => {
        const { headers, rows } = parseCSV('a\tb\n1\t2', '\t');
        expect(headers).toEqual(['a', 'b']);
        expect(rows[0]).toEqual({ a: '1', b: '2' });
    });
});

// ============================================================================
// csv-parser: parseCSVPreview
// ============================================================================

describe('parseCSVPreview', () => {
    it('returns headers, capped preview rows, and the full totalRows', () => {
        const dataLines = Array.from({ length: 12 }, (_, i) => `${i},${i * 2}`).join('\n');
        const text = `a,b\n${dataLines}`;
        const r = parseCSVPreview(text, ',');
        expect(r.headers).toEqual(['a', 'b']);
        expect(r.totalRows).toBe(12);
        // MAX_PREVIEW_ROWS is 5
        expect(r.previewRows).toHaveLength(5);
        expect(r.previewRows[0]).toEqual(['0', '0']);
    });

    it('preview rows are arrays (not objects) and trimmed', () => {
        const r = parseCSVPreview('a,b\n  x  ,  y  ', ',');
        expect(r.previewRows[0]).toEqual(['x', 'y']);
    });

    it('skips blank lines in count and preview', () => {
        const r = parseCSVPreview('a,b\n1,2\n\n3,4', ',');
        expect(r.totalRows).toBe(2);
        expect(r.previewRows).toHaveLength(2);
    });

    it('returns empty preview for empty input', () => {
        expect(parseCSVPreview('', ',')).toEqual({ headers: [], previewRows: [], totalRows: 0 });
    });
});

// ============================================================================
// csv-parser: detectSeparator
// ============================================================================

describe('detectSeparator', () => {
    it('detects comma', () => {
        expect(detectSeparator('a,b,c\n1,2,3')).toBe(',');
    });

    it('detects semicolon', () => {
        expect(detectSeparator('a;b;c\n1;2;3')).toBe(';');
    });

    it('detects tab', () => {
        expect(detectSeparator('a\tb\tc\n1\t2\t3')).toBe('\t');
    });

    it('defaults to comma for empty input', () => {
        expect(detectSeparator('')).toBe(',');
    });

    it('ignores separators inside quoted fields', () => {
        // Two real semicolons per line; commas only appear inside quotes.
        const text = '"a,a";"b,b";c\n"1,1";"2,2";3';
        expect(detectSeparator(text)).toBe(';');
    });

    it('prefers the separator that appears consistently across lines', () => {
        // comma appears 2x in every line; semicolon only on the first.
        const text = 'a,b,c;d\n1,2,3\n4,5,6';
        expect(detectSeparator(text)).toBe(',');
    });
});

describe('CSV_SEPARATORS constant', () => {
    it('exposes comma, semicolon and tab values', () => {
        expect(CSV_SEPARATORS.map(s => s.value)).toEqual([',', ';', '\t']);
    });
});

// ============================================================================
// csv-coordinate-converter: autoDetectColumnMapping
// ============================================================================

describe('autoDetectColumnMapping', () => {
    it('maps decimal lat/long from common header names', () => {
        const m = autoDetectColumnMapping(['Nome', 'Latitude', 'Longitude'], 'latlong_dd');
        expect(m).toEqual({ latitude: 'Latitude', longitude: 'Longitude' });
    });

    it('is case-insensitive and trims header names', () => {
        const m = autoDetectColumnMapping(['  LAT  ', ' Lng '], 'latlong_dd');
        expect(m).toEqual({ latitude: '  LAT  ', longitude: ' Lng ' });
    });

    it('detects x/y as longitude/latitude', () => {
        const m = autoDetectColumnMapping(['x', 'y'], 'latlong_dd');
        expect(m).toEqual({ latitude: 'y', longitude: 'x' });
    });

    it('maps UTM easting/northing and optional zone', () => {
        const m = autoDetectColumnMapping(['este', 'norte', 'fuso'], 'utm');
        expect(m).toEqual({ easting: 'este', northing: 'norte', zone: 'fuso' });
    });

    it('returns partial mapping when only some columns match', () => {
        const m = autoDetectColumnMapping(['latitude', 'foo'], 'latlong_dd');
        expect(m).toEqual({ latitude: 'latitude' });
    });

    it('returns {} for an unknown format id', () => {
        expect(autoDetectColumnMapping(['lat', 'lng'], 'nope')).toEqual({});
    });

    it('maps the single MGRS column', () => {
        const m = autoDetectColumnMapping(['grid'], 'mgrs');
        expect(m).toEqual({ mgrs: 'grid' });
    });

    it('every hint in COLUMN_HINTS is stored lowercase and trimmed', () => {
        for (const hints of Object.values(COLUMN_HINTS)) {
            for (const hint of hints) {
                expect(hint).toBe(hint.toLowerCase().trim());
            }
        }
    });
});

// ============================================================================
// csv-coordinate-converter: convertRowToLatLng — decimal degrees
// ============================================================================

const DD = { latitude: 'lat', longitude: 'lng' };

describe('convertRowToLatLng — latlong_dd', () => {
    it('parses plain decimal degrees', () => {
        const r = convertRowToLatLng({ lat: '-22.455921', lng: '-44.449655' }, 'latlong_dd', DD);
        expect(r.lat).toBeCloseTo(-22.455921, 6);
        expect(r.lng).toBeCloseTo(-44.449655, 6);
    });

    it('accepts comma as decimal separator', () => {
        const r = convertRowToLatLng({ lat: '-22,455921', lng: '-44,449655' }, 'latlong_dd', DD);
        expect(r.lat).toBeCloseTo(-22.455921, 6);
        expect(r.lng).toBeCloseTo(-44.449655, 6);
    });

    it('returns null when a column is missing/empty', () => {
        expect(convertRowToLatLng({ lat: '', lng: '1' }, 'latlong_dd', DD)).toBeNull();
        expect(convertRowToLatLng({ lat: '1' }, 'latlong_dd', DD)).toBeNull();
    });

    it('returns null for out-of-range latitude', () => {
        expect(convertRowToLatLng({ lat: '95', lng: '0' }, 'latlong_dd', DD)).toBeNull();
    });

    it('returns null for out-of-range longitude', () => {
        expect(convertRowToLatLng({ lat: '0', lng: '200' }, 'latlong_dd', DD)).toBeNull();
    });

    it('accepts boundary values (±90, ±180)', () => {
        expect(convertRowToLatLng({ lat: '90', lng: '180' }, 'latlong_dd', DD)).toEqual({ lat: 90, lng: 180 });
        expect(convertRowToLatLng({ lat: '-90', lng: '-180' }, 'latlong_dd', DD)).toEqual({ lat: -90, lng: -180 });
    });

    it('returns null for non-numeric content', () => {
        expect(convertRowToLatLng({ lat: 'abc', lng: '0' }, 'latlong_dd', DD)).toBeNull();
    });

    it('returns null for an unknown format id', () => {
        expect(convertRowToLatLng({ lat: '0', lng: '0' }, 'bogus', DD)).toBeNull();
    });
});

// ============================================================================
// _parseNumber — exercised via latlong_dd / utm (the BUG under test)
// ============================================================================

describe('_parseNumber (via convertRowToLatLng) — separator handling', () => {
    it('treats a single comma as the decimal separator', () => {
        const r = convertRowToLatLng({ lat: '1,5', lng: '2,5' }, 'latlong_dd', DD);
        expect(r).toEqual({ lat: 1.5, lng: 2.5 });
    });

    // BUG FIX: previously replace(',', '.') swapped only the FIRST comma, so a
    // pt-BR grouped number like "12.345,67" parsed as 12.345 instead of 12345.67.
    it('parses pt-BR thousands+decimal "1.234,56" as 1234.56 (UTM easting)', () => {
        const r = convertRowToLatLng(
            { e: '500.000,00', n: '7.516.602,00', z: '23S' },
            'utm',
            { easting: 'e', northing: 'n', zone: 'z' }
        );
        // 500000E / 7516602N in zone 23S is a valid southern-hemisphere point.
        expect(r).not.toBeNull();
        expect(r.lat).toBeGreaterThan(-90);
        expect(r.lat).toBeLessThan(0);
    });

    it('parses en-US thousands+decimal "12,345.0" by stripping the comma grouping', () => {
        // "12,345.0" -> comma groups thousands -> 12345.0 (out of lng range -> null).
        const r = convertRowToLatLng({ lat: '1.5', lng: '12,345.0' }, 'latlong_dd', DD);
        expect(r).toBeNull();
        // "1,23.0" -> comma before dot -> comma is grouping -> 123.0 (in range).
        const r2 = convertRowToLatLng({ lat: '1.5', lng: '1,23.0' }, 'latlong_dd', DD);
        expect(r2).not.toBeNull();
        expect(r2.lng).toBeCloseTo(123, 6);
    });

    it('does NOT truncate at the first comma (regression guard)', () => {
        // OLD BUG: "500.000,00".replace(',', '.') -> "500.000.00" -> parseFloat -> 500.
        // FIX: pt-BR grouping is stripped -> 500000 (a valid in-band UTM easting).
        const r = convertRowToLatLng(
            { e: '500.000,00', n: '7.000.000,00', z: '23' },
            'utm',
            { easting: 'e', northing: 'n', zone: 'z' }
        );
        expect(r).not.toBeNull(); // proves easting parsed as 500000, not 500
        expect(r.lat).toBeLessThan(0);
    });
});

// ============================================================================
// convertRowToLatLng — DMS (single axis per column, PT-BR O/L)
// ============================================================================

describe('convertRowToLatLng — latlong_dms', () => {
    it('parses DMS with degree symbols and S/O directions', () => {
        const r = convertRowToLatLng(
            { lat: '22°27\'21.3" S', lng: '44°26\'58.8" O' },
            'latlong_dms',
            DD
        );
        expect(r.lat).toBeCloseTo(-22.4559, 3);
        expect(r.lng).toBeCloseTo(-44.4497, 3);
    });

    it('treats PT-BR "L" (Leste) as positive longitude', () => {
        const r = convertRowToLatLng(
            { lat: '10°00\'00" N', lng: '20°00\'00" L' },
            'latlong_dms',
            DD
        );
        expect(r.lat).toBeCloseTo(10, 6);
        expect(r.lng).toBeCloseTo(20, 6);
    });

    it('treats PT-BR "O" (Oeste) as negative longitude', () => {
        const r = convertRowToLatLng(
            { lat: '10°00\'00" S', lng: '20°00\'00" O' },
            'latlong_dms',
            DD
        );
        expect(r.lat).toBeCloseTo(-10, 6);
        expect(r.lng).toBeCloseTo(-20, 6);
    });

    it('parses space-separated DMS', () => {
        const r = convertRowToLatLng(
            { lat: '22 27 21 S', lng: '44 26 58 O' },
            'latlong_dms',
            DD
        );
        expect(r.lat).toBeLessThan(0);
        expect(r.lng).toBeLessThan(0);
    });

    it('parses DM (degrees + minutes, no seconds)', () => {
        const r = convertRowToLatLng(
            { lat: '22°30\' S', lng: '44°30\' O' },
            'latlong_dms',
            DD
        );
        expect(r.lat).toBeCloseTo(-22.5, 6);
        expect(r.lng).toBeCloseTo(-44.5, 6);
    });

    it('accepts comma as decimal in the seconds field', () => {
        const r = convertRowToLatLng(
            { lat: '22°27\'21,3" S', lng: '44°26\'58,8" O' },
            'latlong_dms',
            DD
        );
        expect(r.lat).toBeCloseTo(-22.4559, 3);
    });

    it('falls back to a plain decimal number', () => {
        const r = convertRowToLatLng({ lat: '-22.5', lng: '-44.5' }, 'latlong_dms', DD);
        expect(r).toEqual({ lat: -22.5, lng: -44.5 });
    });

    it('rejects minutes >= 60', () => {
        expect(convertRowToLatLng(
            { lat: '22°70\'00" S', lng: '44°00\'00" O' },
            'latlong_dms',
            DD
        )).toBeNull();
    });

    it('rejects seconds >= 60', () => {
        expect(convertRowToLatLng(
            { lat: '22°00\'70" S', lng: '44°00\'00" O' },
            'latlong_dms',
            DD
        )).toBeNull();
    });

    it('returns null for an empty column', () => {
        expect(convertRowToLatLng({ lat: '', lng: '44°00\'00" O' }, 'latlong_dms', DD)).toBeNull();
    });

    it('honors a leading minus sign on DMS', () => {
        const r = convertRowToLatLng(
            { lat: '-22°30\'00"', lng: '-44°30\'00"' },
            'latlong_dms',
            DD
        );
        expect(r.lat).toBeCloseTo(-22.5, 6);
        expect(r.lng).toBeCloseTo(-44.5, 6);
    });
});

// ============================================================================
// convertRowToLatLng — MGRS
// ============================================================================

describe('convertRowToLatLng — mgrs', () => {
    const M = { mgrs: 'g' };

    it('parses an MGRS string (spaces ignored)', () => {
        const r = convertRowToLatLng({ g: '23K PP 12345 67890' }, 'mgrs', M);
        expect(r).not.toBeNull();
        expect(r.lat).toBeLessThan(0); // band K is southern hemisphere
        expect(typeof r.lng).toBe('number');
    });

    it('returns null for an empty MGRS column', () => {
        expect(convertRowToLatLng({ g: '' }, 'mgrs', M)).toBeNull();
    });

    it('returns null for an invalid MGRS string', () => {
        expect(convertRowToLatLng({ g: 'not-mgrs' }, 'mgrs', M)).toBeNull();
    });
});

// ============================================================================
// convertRowToLatLng — UTM (_parseUTMZone band-letter handling)
// ============================================================================

describe('convertRowToLatLng — utm', () => {
    const U = { easting: 'e', northing: 'n' };
    const Uz = { easting: 'e', northing: 'n', zone: 'z' };

    it('converts a southern-hemisphere UTM point using a fixed zone "23S"', () => {
        const r = convertRowToLatLng(
            { e: '500000', n: '7516602' },
            'utm',
            U,
            { zone: '23S' }
        );
        expect(r).not.toBeNull();
        expect(r.lat).toBeLessThan(0);
    });

    it('reads the zone from a column when mapping.zone is set', () => {
        const r = convertRowToLatLng({ e: '500000', n: '7516602', z: '23S' }, 'utm', Uz);
        expect(r).not.toBeNull();
        expect(r.lat).toBeLessThan(0);
    });

    it('treats an MGRS band letter "23K" as southern (Brazil default)', () => {
        const south = convertRowToLatLng({ e: '500000', n: '7516602', z: '23K' }, 'utm', Uz);
        const explicitS = convertRowToLatLng({ e: '500000', n: '7516602', z: '23S' }, 'utm', Uz);
        expect(south).not.toBeNull();
        // Band K and explicit S both resolve to the southern hemisphere -> same point.
        expect(south.lat).toBeCloseTo(explicitS.lat, 6);
        expect(south.lng).toBeCloseTo(explicitS.lng, 6);
    });

    it('treats a northern band letter "23N" as northern hemisphere', () => {
        const r = convertRowToLatLng({ e: '500000', n: '4000000', z: '23N' }, 'utm', Uz);
        expect(r).not.toBeNull();
        expect(r.lat).toBeGreaterThan(0);
    });

    it('defaults a bare zone "23" to the southern hemisphere', () => {
        const bare = convertRowToLatLng({ e: '500000', n: '7516602', z: '23' }, 'utm', Uz);
        const south = convertRowToLatLng({ e: '500000', n: '7516602', z: '23S' }, 'utm', Uz);
        expect(bare).not.toBeNull();
        expect(bare.lat).toBeCloseTo(south.lat, 6);
    });

    it('returns null for a zone outside [1, 60]', () => {
        expect(convertRowToLatLng({ e: '500000', n: '7516602', z: '99' }, 'utm', Uz)).toBeNull();
        expect(convertRowToLatLng({ e: '500000', n: '7516602', z: '0' }, 'utm', Uz)).toBeNull();
    });

    it('returns null when no zone is provided', () => {
        expect(convertRowToLatLng({ e: '500000', n: '7516602' }, 'utm', U, {})).toBeNull();
    });

    it('returns null for easting out of band', () => {
        expect(convertRowToLatLng({ e: '50', n: '7516602', z: '23S' }, 'utm', Uz)).toBeNull();
        expect(convertRowToLatLng({ e: '900000', n: '7516602', z: '23S' }, 'utm', Uz)).toBeNull();
    });

    it('returns null for negative northing', () => {
        expect(convertRowToLatLng({ e: '500000', n: '-5', z: '23S' }, 'utm', Uz)).toBeNull();
    });

    it('returns null when easting/northing are missing', () => {
        expect(convertRowToLatLng({ e: '', n: '7516602', z: '23S' }, 'utm', Uz)).toBeNull();
        expect(convertRowToLatLng({ e: '500000', z: '23S' }, 'utm', Uz)).toBeNull();
    });

    it('returns null for a malformed zone string', () => {
        expect(convertRowToLatLng({ e: '500000', n: '7516602', z: 'abc' }, 'utm', Uz)).toBeNull();
    });
});

// ============================================================================
// CSV_COORDINATE_FORMATS constant sanity
// ============================================================================

describe('CSV_COORDINATE_FORMATS constant', () => {
    it('exposes the four expected format ids', () => {
        expect(CSV_COORDINATE_FORMATS.map(f => f.id)).toEqual([
            'latlong_dd', 'latlong_dms', 'mgrs', 'utm',
        ]);
    });

    it('every format declares requiredColumns', () => {
        for (const f of CSV_COORDINATE_FORMATS) {
            expect(Array.isArray(f.requiredColumns)).toBe(true);
            expect(f.requiredColumns.length).toBeGreaterThan(0);
        }
    });
});

// ============================================================================
// csvToGeoJSON — composition, [lng, lat] order
// ============================================================================

describe('csvToGeoJSON', () => {
    const baseConfig = {
        separator: ',',
        coordinateFormat: 'latlong_dd',
        columnMapping: { latitude: 'lat', longitude: 'lng' },
    };

    it('produces a FeatureCollection with [lng, lat] coordinate order', () => {
        const csvText = 'nome,lat,lng\nAlfa,-22.5,-44.5';
        const { geoJSON, skippedCount } = csvToGeoJSON({ ...baseConfig, csvText });
        expect(geoJSON.type).toBe('FeatureCollection');
        expect(geoJSON.features).toHaveLength(1);
        const f = geoJSON.features[0];
        expect(f.geometry.type).toBe('Point');
        // GeoJSON order is [lng, lat]
        expect(f.geometry.coordinates[0]).toBeCloseTo(-44.5, 6); // lng first
        expect(f.geometry.coordinates[1]).toBeCloseTo(-22.5, 6); // lat second
        expect(skippedCount).toBe(0);
    });

    it('copies non-coordinate columns into feature properties', () => {
        const csvText = 'nome,lat,lng\nAlfa,-22.5,-44.5';
        const { geoJSON } = csvToGeoJSON({ ...baseConfig, csvText });
        expect(geoJSON.features[0].properties).toEqual({ nome: 'Alfa' });
        // coordinate columns are excluded from properties
        expect(geoJSON.features[0].properties.lat).toBeUndefined();
    });

    it('skips invalid rows, records errors with 1-based row numbers', () => {
        const csvText = 'nome,lat,lng\nA,-22.5,-44.5\nB,999,0\nC,-23,-45';
        const { geoJSON, errors, skippedCount } = csvToGeoJSON({ ...baseConfig, csvText });
        expect(geoJSON.features).toHaveLength(2);
        expect(skippedCount).toBe(1);
        expect(errors).toHaveLength(1);
        // Header is row 1; first data row is row 2; the bad "B" row is row 3.
        expect(errors[0].row).toBe(3);
    });

    it('throws when there are no data rows', () => {
        expect(() => csvToGeoJSON({ ...baseConfig, csvText: 'nome,lat,lng' }))
            .toThrow(/Nenhuma linha de dados/);
    });

    it('throws when no valid coordinates are produced', () => {
        const csvText = 'nome,lat,lng\nA,999,999';
        expect(() => csvToGeoJSON({ ...baseConfig, csvText }))
            .toThrow(/Nenhuma coordenada válida/);
    });

    it('throws when exceeding the 1000-feature limit', () => {
        const rows = Array.from({ length: 1001 }, (_, i) => `P${i},-22.5,-44.5`).join('\n');
        const csvText = `nome,lat,lng\n${rows}`;
        expect(() => csvToGeoJSON({ ...baseConfig, csvText }))
            .toThrow(/Muitas linhas/);
    });
});

// ============================================================================
// Property-based: round-trips & invariants
// ============================================================================

// Keep away from poles/antimeridian where UTM/MGRS are undefined or wrap.
const latArb = () => fc.double({ min: -70, max: 70, noNaN: true });
const lngArb = () => fc.double({ min: -170, max: 170, noNaN: true });

describe('round-trip & invariant properties', () => {
    it('latlong_dd: convertRowToLatLng(format(p)) ≈ p', () => {
        fc.assert(fc.property(latArb(), lngArb(), (la, lo) => {
            const r = convertRowToLatLng(
                { lat: String(la), lng: String(lo) },
                'latlong_dd',
                DD
            );
            expect(r).not.toBeNull();
            expect(r.lat).toBeCloseTo(la, 6);
            expect(r.lng).toBeCloseTo(lo, 6);
        }));
    });

    it('comma vs dot decimal forms parse to the same number', () => {
        fc.assert(fc.property(
            fc.double({ min: -89, max: 89, noNaN: true }),
            (la) => {
                const dot = convertRowToLatLng({ lat: String(la), lng: '0' }, 'latlong_dd', DD);
                const comma = convertRowToLatLng(
                    { lat: String(la).replace('.', ','), lng: '0' },
                    'latlong_dd',
                    DD
                );
                expect(comma).not.toBeNull();
                expect(comma.lat).toBeCloseTo(dot.lat, 9);
            }
        ));
    });

    it('parseCSV: every row object has exactly the header keys', () => {
        fc.assert(fc.property(
            fc.array(fc.tuple(
                fc.integer({ min: 0, max: 999 }),
                fc.integer({ min: 0, max: 999 })
            ), { minLength: 1, maxLength: 20 }),
            (pairs) => {
                const body = pairs.map(([a, b]) => `${a},${b}`).join('\n');
                const { headers, rows, totalRows } = parseCSV(`x,y\n${body}`, ',');
                expect(headers).toEqual(['x', 'y']);
                expect(totalRows).toBe(pairs.length);
                for (const row of rows) {
                    expect(Object.keys(row).sort()).toEqual(['x', 'y']);
                }
            }
        ));
    });

    it('detectSeparator: chosen separator yields the most columns on line 1', () => {
        fc.assert(fc.property(
            fc.constantFrom(',', ';', '\t'),
            fc.integer({ min: 2, max: 8 }),
            (sep, cols) => {
                const header = Array.from({ length: cols }, (_, i) => `c${i}`).join(sep);
                const line2 = Array.from({ length: cols }, (_, i) => String(i)).join(sep);
                const detected = detectSeparator(`${header}\n${line2}`);
                expect(detected).toBe(sep);
            }
        ));
    });
});

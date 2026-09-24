// Path: tests/helpers/shapefile-fixture.js

/**
 * @fileoverview Builds, in memory, a zipped shapefile with ONE polygon that has a hole, written in
 * the NON-ESRI ring orientation (outer ring counterclockwise, hole clockwise).
 *
 * WHY THIS ORIENTATION IS THE SUBJECT. The ESRI specification winds outer rings clockwise, and
 * `shpjs` classifies rings by that rule first. Written the other way round, which is what tools
 * that start from GeoJSON (RFC 7946 winds outer rings counterclockwise) often produce, the hole is
 * read as an outer ring, the real outer ring becomes an orphan, and `handleRings`
 * (`shpjs/lib/parseShp.js`) takes its second pass, the only one that calls
 * `Array.prototype.toReversed`. A shapefile without a hole, or with ESRI winding, never reaches
 * that line, and a test built on one would pass without measuring anything.
 *
 * The bytes follow the ESRI Shapefile Technical Description (1998): big-endian file code and
 * lengths in 16-bit words, little-endian everything else. The `.dbf` is dBase III with one
 * character field, `NOME`.
 */

import JSZip from 'jszip';

/** Outer ring, counterclockwise in lon/lat: east along the bottom, north, west along the top. */
export const OUTER_RING = Object.freeze([[-43.3, -22.95], [-43.1, -22.95], [-43.1, -22.85], [-43.3, -22.85], [-43.3, -22.95]]);

/** Hole, clockwise: north, east, south. */
export const HOLE_RING = Object.freeze([[-43.25, -22.92], [-43.25, -22.88], [-43.15, -22.88], [-43.15, -22.92], [-43.25, -22.92]]);

/** The value of the only attribute of the only record. */
export const FEATURE_NAME = 'Area com furo';

const WGS84_PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],'
    + 'PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';

/**
 * @returns {Promise<Uint8Array>} The zip, with `.shp`, `.shx`, `.dbf` and `.prj`.
 */
export async function buildHoleShapefileZip() {
    const rings = [OUTER_RING, HOLE_RING];
    const points = rings.flat();
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const contentBytes = 4 + 32 + 4 + 4 + 4 * rings.length + 16 * points.length;

    const header = (view, totalBytes) => {
        view.setInt32(0, 9994, false);
        view.setInt32(24, totalBytes / 2, false);
        view.setInt32(28, 1000, true);
        view.setInt32(32, 5, true); // polygon
        bbox.forEach((v, i) => view.setFloat64(36 + 8 * i, v, true));
    };

    const shp = new ArrayBuffer(100 + 8 + contentBytes);
    const s = new DataView(shp);
    header(s, shp.byteLength);
    let o = 100;
    s.setInt32(o, 1, false); s.setInt32(o + 4, contentBytes / 2, false); o += 8;
    s.setInt32(o, 5, true); o += 4;
    for (const v of bbox) { s.setFloat64(o, v, true); o += 8; }
    s.setInt32(o, rings.length, true); o += 4;
    s.setInt32(o, points.length, true); o += 4;
    let start = 0;
    for (const ring of rings) { s.setInt32(o, start, true); o += 4; start += ring.length; }
    for (const [x, y] of points) { s.setFloat64(o, x, true); s.setFloat64(o + 8, y, true); o += 16; }

    const shx = new ArrayBuffer(100 + 8);
    const x = new DataView(shx);
    header(x, shx.byteLength);
    x.setInt32(100, 50, false);
    x.setInt32(104, contentBytes / 2, false);

    const fieldLength = 20;
    const recordLength = 1 + fieldLength;
    const headerLength = 32 + 32 + 1;
    const dbf = new Uint8Array(headerLength + recordLength + 1);
    const d = new DataView(dbf.buffer);
    dbf[0] = 3; dbf[1] = 126; dbf[2] = 9; dbf[3] = 23;
    d.setInt32(4, 1, true);
    d.setInt16(8, headerLength, true);
    d.setInt16(10, recordLength, true);
    dbf.set(new TextEncoder().encode('NOME'), 32);
    dbf[32 + 11] = 'C'.charCodeAt(0);
    dbf[32 + 16] = fieldLength;
    dbf[64] = 0x0d;
    dbf[65] = 0x20;
    dbf.set(new TextEncoder().encode(FEATURE_NAME.padEnd(fieldLength, ' ')), 66);
    dbf[headerLength + recordLength] = 0x1a;

    const zip = new JSZip();
    zip.file('area.shp', shp);
    zip.file('area.shx', shx);
    zip.file('area.dbf', dbf);
    zip.file('area.prj', WGS84_PRJ);
    return zip.generateAsync({ type: 'uint8array' });
}

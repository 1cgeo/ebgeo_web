// Path: tests/unit/kml-geometry.test.js

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    formatCoordinates,
    buildLineString,
    buildPolygon,
    buildGeometry,
    dashLineString,
    dashPatternToMeters,
    fitDashPattern,
    lineLength,
    imageLatLonBox,
    normalizeSignedAngle,
    LINE_STYLE_DASH_PATTERNS,
} from '@js/import_export/kmz/kml-geometry.js';

describe('formatCoordinates', () => {
    it('emits lng,lat,alt in GeoJSON axis order', () => {
        // -47 is the longitude and -15 the latitude; swapping them puts the
        // feature in the wrong hemisphere, which is the classic KML bug.
        expect(formatCoordinates([[-47.9, -15.8]]))
            .toBe('-47.900000,-15.800000,0.000000');
    });

    it('keeps a supplied altitude', () => {
        expect(formatCoordinates([[1, 2, 300]])).toBe('1.000000,2.000000,300.000000');
    });

    it('never emits "-0"', () => {
        expect(formatCoordinates([[-0, -0]])).toBe('0.000000,0.000000,0.000000');
        expect(formatCoordinates([[-0.0000001, 0]])).not.toContain('-0.000000');
    });

    it('drops malformed positions instead of emitting NaN', () => {
        const out = formatCoordinates([[1, 2], null, [NaN, 5], ['a', 'b'], [3, 4]]);
        expect(out).toBe('1.000000,2.000000,0.000000 3.000000,4.000000,0.000000');
        expect(out).not.toContain('NaN');
    });

    it('handles non-array input', () => {
        expect(formatCoordinates(null)).toBe('');
        expect(formatCoordinates(undefined)).toBe('');
    });

    it('supports antimeridian and pole boundaries', () => {
        expect(formatCoordinates([[180, 90], [-180, -90]]))
            .toBe('180.000000,90.000000,0.000000 -180.000000,-90.000000,0.000000');
    });
});

describe('buildLineString', () => {
    it('returns null for degenerate lines', () => {
        expect(buildLineString([])).toBeNull();
        expect(buildLineString([[1, 2]])).toBeNull();
        expect(buildLineString(null)).toBeNull();
    });

    it('builds a LineString for two or more points', () => {
        expect(buildLineString([[1, 2], [3, 4]])).toContain('<LineString>');
    });
});

describe('buildPolygon', () => {
    it('auto-closes an open ring', () => {
        const kml = buildPolygon([[[0, 0], [1, 0], [1, 1]]]);
        const coords = kml.match(/<coordinates>([^<]*)<\/coordinates>/)[1].split(' ');
        expect(coords[0]).toBe(coords[coords.length - 1]);
    });

    it('does not double-close an already closed ring', () => {
        const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
        const coords = buildPolygon([ring])
            .match(/<coordinates>([^<]*)<\/coordinates>/)[1].split(' ');
        expect(coords).toHaveLength(4);
    });

    it('maps additional rings to innerBoundaryIs', () => {
        const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
        const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
        const kml = buildPolygon([outer, hole]);
        expect(kml).toContain('<outerBoundaryIs>');
        expect(kml).toContain('<innerBoundaryIs>');
        expect(kml.match(/<innerBoundaryIs>/g)).toHaveLength(1);
    });

    it('rejects rings with too few vertices', () => {
        expect(buildPolygon([[[0, 0], [1, 1]]])).toBeNull();
        expect(buildPolygon([])).toBeNull();
        expect(buildPolygon(null)).toBeNull();
    });

    it('drops degenerate holes but keeps the polygon', () => {
        const outer = [[0, 0], [10, 0], [10, 10], [0, 0]];
        const kml = buildPolygon([outer, [[1, 1]]]);
        expect(kml).toContain('<outerBoundaryIs>');
        expect(kml).not.toContain('<innerBoundaryIs>');
    });
});

describe('buildGeometry', () => {
    it('handles each supported GeoJSON type', () => {
        expect(buildGeometry({ type: 'Point', coordinates: [1, 2] })).toContain('<Point>');
        expect(buildGeometry({ type: 'LineString', coordinates: [[1, 2], [3, 4]] })).toContain('<LineString>');
        expect(buildGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })).toContain('<Polygon>');
    });

    it('wraps MultiPolygon in MultiGeometry', () => {
        const geometry = {
            type: 'MultiPolygon',
            coordinates: [
                [[[0, 0], [1, 0], [1, 1], [0, 0]]],
                [[[5, 5], [6, 5], [6, 6], [5, 5]]],
            ],
        };
        const kml = buildGeometry(geometry);
        expect(kml).toContain('<MultiGeometry>');
        expect(kml.match(/<Polygon>/g)).toHaveLength(2);
    });

    it('does not wrap a single-part MultiPolygon in MultiGeometry', () => {
        const geometry = {
            type: 'MultiPolygon',
            coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]],
        };
        expect(buildGeometry(geometry)).not.toContain('<MultiGeometry>');
    });

    it('returns null rather than malformed XML for unusable input', () => {
        expect(buildGeometry(null)).toBeNull();
        expect(buildGeometry({})).toBeNull();
        expect(buildGeometry({ type: 'Nonsense', coordinates: [] })).toBeNull();
        expect(buildGeometry({ type: 'LineString', coordinates: [[1, 2]] })).toBeNull();
        expect(buildGeometry({ type: 'Polygon', coordinates: [] })).toBeNull();
    });

    it('emits a dashed polygon as fill plus separate outline runs', () => {
        const geometry = {
            type: 'Polygon',
            coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0]]],
        };
        const kml = buildGeometry(geometry, { dashMeters: [100, 100] });
        expect(kml).toContain('<MultiGeometry>');
        expect(kml).toContain('<Polygon>');
        expect(kml).toContain('<LineString>');
    });
});

describe('dashLineString', () => {
    const line = [[0, 0], [1, 0]]; // ~111 km along the equator

    it('returns the line untouched for a solid pattern', () => {
        expect(dashLineString(line, [1, 0])).toEqual([line]);
        expect(dashLineString(line, [])).toEqual([line]);
        expect(dashLineString(line, [0, 0])).toEqual([line]);
    });

    it('returns nothing for a degenerate line', () => {
        expect(dashLineString([], [100, 100])).toEqual([]);
        expect(dashLineString([[0, 0]], [100, 100])).toEqual([]);
        expect(dashLineString(null, [100, 100])).toEqual([]);
    });

    it('splits a line into multiple runs', () => {
        const runs = dashLineString(line, [10000, 10000]);
        expect(runs.length).toBeGreaterThan(1);
        runs.forEach(run => expect(run.length).toBeGreaterThanOrEqual(2));
    });

    it('emits roughly the on-fraction of the total length', () => {
        // 50/50 pattern over ~111 km should draw about half of it.
        const runs = dashLineString(line, [10000, 10000]);
        const drawn = runs.reduce((sum, run) => {
            let d = 0;
            for (let i = 0; i < run.length - 1; i++) d += Math.abs(run[i + 1][0] - run[i][0]);
            return sum + d;
        }, 0);
        expect(drawn).toBeGreaterThan(0.4);
        expect(drawn).toBeLessThan(0.6);
    });

    it('yields a single partial run when the pattern outruns the line', () => {
        const runs = dashLineString(line, [1e9, 1e9]);
        expect(runs).toHaveLength(1);
    });

    it('falls back to a solid line instead of exploding on tiny dashes', () => {
        // A 1 cm dash over 111 km would be millions of segments.
        const runs = dashLineString(line, [0.01, 0.01]);
        expect(runs).toEqual([line]);
    });

    it('keeps every emitted vertex inside the original bounding box', () => {
        fc.assert(fc.property(
            fc.double({ min: 100, max: 50000, noNaN: true }),
            fc.double({ min: 100, max: 50000, noNaN: true }),
            (on, off) => {
                const runs = dashLineString(line, [on, off]);
                for (const run of runs) {
                    for (const [lng, lat] of run) {
                        expect(lng).toBeGreaterThanOrEqual(-1e-9);
                        expect(lng).toBeLessThanOrEqual(1 + 1e-9);
                        expect(Math.abs(lat)).toBeLessThan(1e-9);
                    }
                }
            }
        ));
    });
});

describe('dashPatternToMeters', () => {
    it('scales pixels by the ground resolution', () => {
        const meters = dashPatternToMeters([8, 4], 0, 15);
        expect(meters).toHaveLength(2);
        expect(meters[0]).toBeGreaterThan(0);
        expect(meters[0] / meters[1]).toBeCloseTo(2);
    });

    it('shrinks with latitude', () => {
        const atEquator = dashPatternToMeters([8], 0, 15)[0];
        const atSixty = dashPatternToMeters([8], 60, 15)[0];
        expect(atSixty).toBeLessThan(atEquator);
    });

    it('returns an empty pattern for unusable input', () => {
        expect(dashPatternToMeters([8, 4], NaN, 15)).toEqual([]);
        expect(dashPatternToMeters([8, 4], 0, NaN)).toEqual([]);
        expect(dashPatternToMeters(null, 0, 15)).toEqual([]);
    });

    it('exposes a pattern for every app line style', () => {
        for (const pattern of Object.values(LINE_STYLE_DASH_PATTERNS)) {
            expect(pattern.length).toBeGreaterThanOrEqual(2);
            expect(pattern.every(n => Number.isFinite(n) && n > 0)).toBe(true);
        }
    });
});

describe('lineLength', () => {
    it('measures a degree of longitude at the equator as ~111 km', () => {
        expect(lineLength([[0, 0], [1, 0]])).toBeGreaterThan(111000);
        expect(lineLength([[0, 0], [1, 0]])).toBeLessThan(112000);
    });

    it('sums multiple segments', () => {
        const single = lineLength([[0, 0], [1, 0]]);
        const double = lineLength([[0, 0], [1, 0], [2, 0]]);
        expect(double).toBeCloseTo(single * 2, 0);
    });

    it('returns zero for degenerate input', () => {
        expect(lineLength([])).toBe(0);
        expect(lineLength([[0, 0]])).toBe(0);
        expect(lineLength(null)).toBe(0);
    });
});

/** Lower bound asserted by the property test, allowing float slack. */
const MIN_CYCLES_TOLERANCE = 5.99;

describe('fitDashPattern', () => {
    // Regression: dash lengths were converted at a GUESSED reference zoom.
    // A line drawn while zoomed in produced one huge dash (looked solid);
    // one drawn while zoomed out produced thousands of specks.

    it('tightens a pattern too coarse for a short line', () => {
        // 500 m pattern cycle on a 100 m line would draw a single dash.
        const fitted = fitDashPattern([400, 100], 100);
        const cycle = fitted[0] + fitted[1];
        expect(100 / cycle).toBeCloseTo(6, 5);
    });

    it('loosens a pattern far too fine for a long line', () => {
        const fitted = fitDashPattern([1, 1], 100000);
        const cycle = fitted[0] + fitted[1];
        expect(100000 / cycle).toBeCloseTo(150, 5);
    });

    it('leaves a already-reasonable pattern untouched', () => {
        // 1000 m line, 50 m cycle -> 20 cycles, inside the accepted band.
        const pattern = [30, 20];
        expect(fitDashPattern(pattern, 1000)).toBe(pattern);
    });

    it('preserves the on/off ratio when rescaling', () => {
        const fitted = fitDashPattern([800, 200], 100);
        expect(fitted[0] / fitted[1]).toBeCloseTo(4, 6);
    });

    it('returns an empty pattern for unusable input', () => {
        expect(fitDashPattern([100, 50], 0)).toEqual([]);
        expect(fitDashPattern([100, 50], NaN)).toEqual([]);
        expect(fitDashPattern([100], 1000)).toEqual([]);
        expect(fitDashPattern(null, 1000)).toEqual([]);
        expect(fitDashPattern([0, 0], 1000)).toEqual([]);
    });

    it('always yields a visible dash count for any realistic line', () => {
        fc.assert(fc.property(
            fc.double({ min: 10, max: 500000, noNaN: true }),
            fc.double({ min: 5, max: 20, noNaN: true }),
            (length, zoom) => {
                const meters = dashPatternToMeters([8, 4], -15.8, zoom);
                const fitted = fitDashPattern(meters, length);
                if (fitted.length < 2) return;
                const cycles = length / (fitted[0] + fitted[1]);
                // Never a single giant dash, never an unrenderable swarm.
                expect(cycles).toBeGreaterThanOrEqual(MIN_CYCLES_TOLERANCE);
                expect(cycles).toBeLessThanOrEqual(151);
            }
        ));
    });
});

describe('imageLatLonBox', () => {
    const base = { lng: 0, lat: 0, width: 100, height: 50, size: 1, createdAtZoom: 15 };

    it('preserves the image aspect ratio at the equator', () => {
        const box = imageLatLonBox(base);
        const lngSpan = box.east - box.west;
        const latSpan = box.north - box.south;
        expect(lngSpan / latSpan).toBeCloseTo(100 / 50, 5);
    });

    it('keeps the longitude span latitude-invariant, as Web Mercator requires', () => {
        // metersPerPixel shrinks by cos(lat) while a degree of longitude shrinks
        // by the same factor, so the two cancel: a 100px image spans the same
        // number of DEGREES of longitude everywhere. Dropping the cos(lat)
        // division would break this and squash images away from the equator.
        const equatorSpan = (b => b.east - b.west)(imageLatLonBox(base));
        const sixtySpan = (b => b.east - b.west)(imageLatLonBox({ ...base, lat: 60 }));
        expect(sixtySpan).toBeCloseTo(equatorSpan, 9);
    });

    it('compresses the latitude span away from the equator', () => {
        // Latitude degrees do NOT shrink, so the same pixel height covers fewer
        // of them at high latitude — this is what keeps the image square on screen.
        const equatorSpan = (b => b.north - b.south)(imageLatLonBox(base));
        const sixtySpan = (b => b.north - b.south)(imageLatLonBox({ ...base, lat: 60 }));
        expect(sixtySpan).toBeCloseTo(equatorSpan * Math.cos(60 * Math.PI / 180), 9);
    });

    it('stays finite at the poles', () => {
        const box = imageLatLonBox({ ...base, lat: 90 });
        expect(box).not.toBeNull();
        expect(Number.isFinite(box.east)).toBe(true);
        expect(Number.isFinite(box.west)).toBe(true);
    });

    it('clamps latitude to +/-90', () => {
        const north = imageLatLonBox({ ...base, lat: 89.999, createdAtZoom: 1 });
        expect(north.north).toBeLessThanOrEqual(90);
        const south = imageLatLonBox({ ...base, lat: -89.999, createdAtZoom: 1 });
        expect(south.south).toBeGreaterThanOrEqual(-90);
    });

    it('negates rotation for KML counter-clockwise convention', () => {
        expect(imageLatLonBox({ ...base, rotation: 90 }).rotation).toBe(-90);
        expect(imageLatLonBox({ ...base, rotation: 270 }).rotation).toBe(90);
        expect(imageLatLonBox({ ...base, rotation: 0 }).rotation).toBe(0);
        expect(imageLatLonBox({ ...base, rotation: NaN }).rotation).toBe(0);
    });

    it('returns null when the extent cannot be determined', () => {
        expect(imageLatLonBox({ ...base, width: NaN })).toBeNull();
        expect(imageLatLonBox({ ...base, createdAtZoom: undefined })).toBeNull();
        expect(imageLatLonBox({ ...base, size: 0 })).toBeNull();
        expect(imageLatLonBox({ ...base, width: 0 })).toBeNull();
        expect(imageLatLonBox({ ...base, lng: NaN })).toBeNull();
    });

    it('scales with the size multiplier', () => {
        const single = imageLatLonBox(base);
        const double = imageLatLonBox({ ...base, size: 2 });
        expect(double.north - double.south).toBeCloseTo((single.north - single.south) * 2, 6);
    });
});

describe('normalizeSignedAngle', () => {
    it('wraps into (-180, 180]', () => {
        expect(normalizeSignedAngle(0)).toBe(0);
        expect(normalizeSignedAngle(180)).toBe(180);
        expect(normalizeSignedAngle(-180)).toBe(180);
        expect(normalizeSignedAngle(270)).toBe(-90);
        expect(normalizeSignedAngle(360)).toBe(0);
    });

    it('never returns -0 and defaults non-finite input', () => {
        expect(Object.is(normalizeSignedAngle(-0), -0)).toBe(false);
        expect(normalizeSignedAngle(NaN)).toBe(0);
    });

    it('always lands in (-180, 180]', () => {
        fc.assert(fc.property(
            fc.double({ min: -10000, max: 10000, noNaN: true }),
            (deg) => {
                const a = normalizeSignedAngle(deg);
                expect(a).toBeGreaterThan(-180.0000001);
                expect(a).toBeLessThanOrEqual(180);
            }
        ));
    });
});

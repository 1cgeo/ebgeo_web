import { describe, it, expect, beforeAll, vi } from 'vitest';
import fc from 'fast-check';

// add_arrow_geometry imports BaseGeometry from the `@tools` barrel, which pulls
// in DOM/MapLibre-coupled modules. Mock the barrel with a trivial BaseGeometry so
// the pure geometry math can be tested in the `node` environment.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
    },
}));

// ============================================================================
// Deterministic planar turf stub
// ----------------------------------------------------------------------------
// Coordinates are treated as [x, y] in metres on a flat plane. Compass bearing
// convention matches turf: 0 = +y (north), 90 = +x (east), clockwise.
// `lineOffset` with a POSITIVE distance offsets to the RIGHT of the travel
// direction, which is what the real turf does (verified in the vendored bundle)
// and what fixes the vertex order of the arrow tail.
// ============================================================================

const DEG = Math.PI / 180;

/** Accept a bare [x, y], a Point Feature or a Point geometry. */
function toCoord(input) {
    if (Array.isArray(input)) return input;
    if (input?.geometry?.coordinates) return input.geometry.coordinates;
    if (input?.coordinates) return input.coordinates;
    throw new Error(`turf stub: unsupported point input ${JSON.stringify(input)}`);
}

/** Round to 9 decimals so floating-point noise does not leak into snapshots. */
function r(n) {
    return Math.round(n * 1e9) / 1e9;
}

function planarBearing(from, to) {
    const [x1, y1] = toCoord(from);
    const [x2, y2] = toCoord(to);
    return r(Math.atan2(x2 - x1, y2 - y1) / DEG);
}

function planarDestination(origin, distance, bearing) {
    const [x, y] = toCoord(origin);
    return {
        type: 'Feature',
        properties: {},
        geometry: {
            type: 'Point',
            coordinates: [r(x + distance * Math.sin(bearing * DEG)), r(y + distance * Math.cos(bearing * DEG))],
        },
    };
}

/**
 * Project a coordinate onto a line: nearest point, its distance to the line and
 * how far along the line it sits. Enough for the airmobile crossover geometry.
 */
function locate(line, coord) {
    const coords = line.geometry.coordinates;
    let best = { dist: Infinity, along: 0, point: coords[0] };
    let travelled = 0;
    for (let i = 1; i < coords.length; i++) {
        const [ax, ay] = coords[i - 1];
        const [bx, by] = coords[i];
        const dx = bx - ax;
        const dy = by - ay;
        const segLen = Math.hypot(dx, dy);
        let t = segLen === 0 ? 0 : ((coord[0] - ax) * dx + (coord[1] - ay) * dy) / (segLen * segLen);
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx;
        const py = ay + t * dy;
        const d = Math.hypot(coord[0] - px, coord[1] - py);
        if (d < best.dist) best = { dist: d, along: travelled + t * segLen, point: [r(px), r(py)] };
        travelled += segLen;
    }
    return best;
}

/** Cumulative planar distance of every vertex of a line. */
function cumulative(coords) {
    const out = [0];
    for (let i = 1; i < coords.length; i++) {
        out.push(out[i - 1] + Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]));
    }
    return out;
}

/** Planar segment-segment intersection, or null when the segments are parallel. */
function segmentIntersection(p1, p2, p3, p4) {
    const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (d === 0) return null;
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return [r(p1[0] + t * (p2[0] - p1[0])), r(p1[1] + t * (p2[1] - p1[1]))];
}

beforeAll(() => {
    globalThis.turf = {
        lineString: (coords) => ({
            type: 'Feature', properties: {},
            geometry: { type: 'LineString', coordinates: coords },
        }),
        point: (c) => ({
            type: 'Feature', properties: {},
            geometry: { type: 'Point', coordinates: toCoord(c) },
        }),
        feature: (geometry) => ({ type: 'Feature', properties: {}, geometry }),
        featureCollection: (features) => ({ type: 'FeatureCollection', features }),
        bearing: planarBearing,
        destination: (origin, distance, bearing) => planarDestination(origin, distance, bearing),
        midpoint: (a, b) => {
            const [x1, y1] = toCoord(a);
            const [x2, y2] = toCoord(b);
            return {
                type: 'Feature', properties: {},
                geometry: { type: 'Point', coordinates: [r((x1 + x2) / 2), r((y1 + y2) / 2)] },
            };
        },
        length: (line) => {
            const coords = line.geometry.coordinates;
            let total = 0;
            for (let i = 1; i < coords.length; i++) {
                const dx = coords[i][0] - coords[i - 1][0];
                const dy = coords[i][1] - coords[i - 1][1];
                total += Math.hypot(dx, dy);
            }
            return r(total);
        },
        // Positive distance = right of the travel direction. Each vertex is
        // shifted along the perpendicular of its own segment (last vertex reuses
        // the last segment), which is exact for the straight and V-shaped axes
        // used in these tests.
        lineOffset: (line, distance) => {
            const coords = line.geometry.coordinates;
            const side = distance >= 0 ? 90 : -90;
            const magnitude = Math.abs(distance);
            const out = coords.map((coord, i) => {
                const a = i === coords.length - 1 ? coords[i - 1] : coords[i];
                const b = i === coords.length - 1 ? coords[i] : coords[i + 1];
                const seg = planarBearing(a, b);
                return planarDestination(coord, magnitude, seg + side).geometry.coordinates;
            });
            return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: out } };
        },
        along: (line, distance) => {
            const coords = line.geometry.coordinates;
            const cum = cumulative(coords);
            const total = cum[cum.length - 1];
            const target = Math.max(0, Math.min(total, distance));
            for (let i = 1; i < coords.length; i++) {
                if (cum[i] >= target) {
                    const segLen = cum[i] - cum[i - 1];
                    const t = segLen === 0 ? 0 : (target - cum[i - 1]) / segLen;
                    return {
                        type: 'Feature', properties: {},
                        geometry: {
                            type: 'Point',
                            coordinates: [
                                r(coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0])),
                                r(coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1])),
                            ],
                        },
                    };
                }
            }
            return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coords[coords.length - 1] } };
        },
        nearestPointOnLine: (line, pt) => {
            const found = locate(line, toCoord(pt));
            return {
                type: 'Feature',
                properties: { dist: found.dist, location: found.along },
                geometry: { type: 'Point', coordinates: found.point },
            };
        },
        lineSlice: (start, stop, line) => {
            const coords = line.geometry.coordinates;
            const a = locate(line, toCoord(start));
            const b = locate(line, toCoord(stop));
            const [from, to] = a.along <= b.along ? [a, b] : [b, a];
            const cum = cumulative(coords);
            const out = [from.point];
            for (let i = 0; i < coords.length; i++) {
                if (cum[i] > from.along && cum[i] < to.along) out.push(coords[i]);
            }
            out.push(to.point);
            return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: out } };
        },
        lineIntersect: (l1, l2) => {
            const a = l1.geometry.coordinates;
            const b = l2.geometry.coordinates;
            const features = [];
            for (let i = 1; i < a.length; i++) {
                for (let j = 1; j < b.length; j++) {
                    const hit = segmentIntersection(a[i - 1], a[i], b[j - 1], b[j]);
                    if (hit) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: hit } });
                }
            }
            return { type: 'FeatureCollection', features };
        },
        // NOT a real union: it just collects every ring into a MultiPolygon so a
        // merged arrow keeps one polygon per branch and each branch's vertex
        // count stays observable.
        union: (collection) => {
            const polygons = [];
            for (const f of collection.features) {
                if (f.geometry.type === 'Polygon') polygons.push(f.geometry.coordinates);
                else polygons.push(...f.geometry.coordinates);
            }
            return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons } };
        },
    };
});

const { default: AddArrowGeometry } = await import('../../src/js/military_tools/arrow_tool/add_arrow_geometry.js');

const geom = new AddArrowGeometry();

// A due-east axis 1000 m long, so bearings are exactly 90.
const EAST_AXIS = [[0, 0], [1000, 0]];
const BASE_PROPS = { width: 200, headLengthRatio: 1.5, showArrowHead: true };

// ============================================================================
// Negative control: the geometry of an arrow WITHOUT the flag must stay byte
// for byte what it is today. The inline snapshot below was recorded against
// the pre-`doubleHeaded` code; if implementing the flag changes it, this test
// goes red instead of silently re-recording.
// ============================================================================

describe('AddArrowGeometry — negative control (no doubleHeaded)', () => {
    it('golden: single-headed east arrow is unchanged', () => {
        expect(geom.generate(EAST_AXIS, BASE_PROPS)).toMatchInlineSnapshot(`
          {
            "coordinates": [
              [
                [
                  0,
                  -100,
                ],
                [
                  1000,
                  -100,
                ],
                [
                  1000,
                  -250,
                ],
                [
                  1750,
                  0,
                ],
                [
                  1000,
                  250,
                ],
                [
                  1000,
                  100,
                ],
                [
                  0,
                  100,
                ],
                [
                  0,
                  -100,
                ],
              ],
            ],
            "type": "Polygon",
          }
        `);
    });

    it('golden: airmobile arrow is unchanged', () => {
        expect(geom.generate(EAST_AXIS, { ...BASE_PROPS, airmobile: true })).toMatchInlineSnapshot(`
          {
            "coordinates": [
              [
                [
                  [
                    0,
                    -100,
                  ],
                  [
                    850,
                    0,
                  ],
                  [
                    0,
                    100,
                  ],
                  [
                    0,
                    -100,
                  ],
                ],
              ],
              [
                [
                  [
                    1000,
                    -100,
                  ],
                  [
                    1000,
                    -250,
                  ],
                  [
                    1750,
                    0,
                  ],
                  [
                    1000,
                    250,
                  ],
                  [
                    1000,
                    100,
                  ],
                  [
                    850,
                    0,
                  ],
                  [
                    1000,
                    -100,
                  ],
                ],
              ],
            ],
            "type": "MultiPolygon",
          }
        `);
    });

    it('absent, false and undefined doubleHeaded all produce the same polygon', () => {
        const nominal = JSON.stringify(geom.generate(EAST_AXIS, BASE_PROPS));
        expect(JSON.stringify(geom.generate(EAST_AXIS, { ...BASE_PROPS, doubleHeaded: false }))).toBe(nominal);
        expect(JSON.stringify(geom.generate(EAST_AXIS, { ...BASE_PROPS, doubleHeaded: undefined }))).toBe(nominal);
    });
});

// ============================================================================
// Helpers for the double-headed assertions
// ============================================================================

/** Sign of the side of segment a-to-b that p falls on (planar cross product). */
function sideOf(a, b, p) {
    return Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
}

const ring = (geometry) => geometry.coordinates[0];

// A 5 km east axis: long enough that the nominal heads fit without clamping.
const LONG_AXIS = [[0, 0], [5000, 0]];
const LONG_PROPS = { width: 200, headLengthRatio: 1.5, showArrowHead: true };
// width 200 -> head base 500, nominal head length 750, two heads = 1500 <= 5000.
const NOMINAL_HEAD = 750;

// ============================================================================
// doubleHeaded: the second head
// ============================================================================

describe('AddArrowGeometry.generate — doubleHeaded', () => {
    it('adds exactly three vertices to a straight arrow', () => {
        const single = ring(geom.generate(LONG_AXIS, LONG_PROPS));
        const dual = ring(geom.generate(LONG_AXIS, { ...LONG_PROPS, doubleHeaded: true }));
        expect(dual.length).toBe(single.length + 3);
    });

    it('puts a tip before the start and a tip past the end', () => {
        const dual = ring(geom.generate(LONG_AXIS, { ...LONG_PROPS, doubleHeaded: true }));
        expect(dual.some(([x]) => x < 0)).toBe(true);
        expect(dual.some(([x]) => x > 5000)).toBe(true);
    });

    it('closes the ring and keeps the two tips symmetric about the axis', () => {
        const dual = ring(geom.generate(LONG_AXIS, { ...LONG_PROPS, doubleHeaded: true }));
        expect(dual[0]).toEqual(dual[dual.length - 1]);

        const headTip = dual.find(([x]) => x > 5000);
        const tailTip = dual.find(([x]) => x < 0);
        expect(headTip).toEqual([5000 + NOMINAL_HEAD, 0]);
        expect(tailTip).toEqual([-NOMINAL_HEAD, 0]);
    });

    it('does not draw any head when showArrowHead is off (master toggle)', () => {
        const noHead = geom.generate(LONG_AXIS, { ...LONG_PROPS, showArrowHead: false });
        const noHeadDual = geom.generate(LONG_AXIS, { ...LONG_PROPS, showArrowHead: false, doubleHeaded: true });
        expect(JSON.stringify(noHeadDual)).toBe(JSON.stringify(noHead));
    });

    it('orients each head by its own end of a V-shaped axis', () => {
        // East then north: the leading head points north, the tail head west.
        const axis = [[0, 0], [1000, 0], [1000, 1000]];
        const dual = ring(geom.generate(axis, { ...LONG_PROPS, doubleHeaded: true }));

        const headTip = dual.find(([, y]) => y > 1000);
        const tailTip = dual.find(([x]) => x < 0);
        expect(headTip).toEqual([1000, 1000 + NOMINAL_HEAD]);
        expect(tailTip).toEqual([-NOMINAL_HEAD, 0]);
    });

    it('keeps the tail symmetric for a negative width (Math.abs)', () => {
        const dual = ring(geom.generate(LONG_AXIS, { ...LONG_PROPS, width: -200, doubleHeaded: true }));
        const tailTipIndex = dual.findIndex(([x]) => x < 0);
        const cornerRight = dual[tailTipIndex - 1];
        const cornerLeft = dual[tailTipIndex + 1];
        // toBeCloseTo, not toBe: the planar stub can produce -0 on the axis.
        expect(cornerRight[0]).toBeCloseTo(0, 9);
        expect(cornerLeft[0]).toBeCloseTo(0, 9);
        expect(cornerRight[1]).toBe(-cornerLeft[1]);
        expect(Math.abs(cornerRight[1])).toBe(250);
    });
});

// ============================================================================
// Ring orientation: the classic failure of a second head is a bow tie
// ============================================================================

describe('AddArrowGeometry.generate — tail vertex order', () => {
    it.each([
        ['straight', [[0, 0], [5000, 0]]],
        ['V-shaped', [[0, 0], [1000, 0], [1000, 1000]]],
    ])('keeps the tail corners on the side the ring arrives from (%s)', (_name, axis) => {
        const dual = ring(geom.generate(axis, { ...LONG_PROPS, doubleHeaded: true }));
        const n = dual.length;

        // Tail block sits just before the closing vertex.
        const lastBodyPoint = dual[n - 5];
        const tailCornerRight = dual[n - 4];
        const tailCornerLeft = dual[n - 2];
        const firstBodyPoint = dual[0];

        const a = axis[0];
        const b = axis[1];
        expect(sideOf(a, b, tailCornerRight)).toBe(sideOf(a, b, lastBodyPoint));
        expect(sideOf(a, b, tailCornerLeft)).toBe(sideOf(a, b, firstBodyPoint));
        // ...and the two corners straddle the axis, so the head is not folded.
        expect(sideOf(a, b, tailCornerRight)).toBe(-sideOf(a, b, tailCornerLeft));
    });
});

// ============================================================================
// resolveHeadLengths — the clamp
// ============================================================================

describe('AddArrowGeometry.resolveHeadLengths', () => {
    const line = (coords) => globalThis.turf.lineString(coords);

    it('returns the nominal head and no tail without the flag, without touching turf.length', () => {
        const realLength = globalThis.turf.length;
        globalThis.turf.length = () => { throw new Error('turf.length must not be called for a single-headed arrow'); };
        try {
            expect(geom.resolveHeadLengths(null, 1875, false)).toEqual({ headLength: 1875, tailLength: 0 });
        } finally {
            globalThis.turf.length = realLength;
        }
    });

    it('leaves both heads nominal when they fit inside the axis', () => {
        expect(geom.resolveHeadLengths(line(LONG_AXIS), 750, true))
            .toEqual({ headLength: 750, tailLength: 750 });
    });

    it('shrinks both heads to the axis budget on a very short arrow', () => {
        // 20 m axis, width 500 -> head base 1250, nominal head 1875 each.
        const shortLine = line([[0, 0], [20, 0]]);
        const { headLength, tailLength } = geom.resolveHeadLengths(shortLine, 1875, true);
        expect(headLength).toBe(tailLength);
        expect(headLength + tailLength).toBeLessThanOrEqual(20);
        expect(headLength).toBeGreaterThan(0);
    });

    it('does not divide by zero on a zero-length axis', () => {
        const degenerate = line([[0, 0], [0, 0]]);
        const out = geom.resolveHeadLengths(degenerate, 100, true);
        expect(Number.isFinite(out.headLength)).toBe(true);
        expect(Number.isFinite(out.tailLength)).toBe(true);
    });

    it('property: without the flag the nominal length always survives untouched', () => {
        fc.assert(fc.property(
            fc.double({ min: 0, max: 1e7, noNaN: true }),
            fc.double({ min: 0, max: 1e7, noNaN: true }),
            (nominal, axisLength) => {
                const out = geom.resolveHeadLengths(line([[0, 0], [axisLength, 0]]), nominal, false);
                return out.headLength === nominal && out.tailLength === 0;
            }
        ));
    });

    it('property: with the flag the two heads never exceed the axis length', () => {
        fc.assert(fc.property(
            fc.double({ min: 1, max: 1e6, noNaN: true }),
            fc.double({ min: 1, max: 1e6, noNaN: true }),
            (nominal, axisLength) => {
                const out = geom.resolveHeadLengths(line([[0, 0], [axisLength, 0]]), nominal, true);
                return out.headLength === out.tailLength
                    && out.headLength + out.tailLength <= Math.max(axisLength, nominal * 2) + 1e-6;
            }
        ));
    });
});

// ============================================================================
// Degenerate inputs
// ============================================================================

describe('AddArrowGeometry.generate — degenerate inputs', () => {
    it('returns null for fewer than two coordinates, flag or not', () => {
        expect(geom.generate([[0, 0]], { ...LONG_PROPS, doubleHeaded: true })).toBeNull();
        expect(geom.generate([], { ...LONG_PROPS, doubleHeaded: true })).toBeNull();
    });

    it('produces no NaN when both vertices coincide', () => {
        const out = geom.generate([[0, 0], [0, 0]], { ...LONG_PROPS, doubleHeaded: true });
        expect(out.type).toBe('Polygon');
        for (const [x, y] of ring(out)) {
            expect(Number.isFinite(x)).toBe(true);
            expect(Number.isFinite(y)).toBe(true);
        }
    });
});

// ============================================================================
// Airmobile and merged arrows carry the flag too
// ============================================================================

describe('AddArrowGeometry.generate — doubleHeaded on other shapes', () => {
    it('adds the tail head to the rear polygon of an airmobile arrow', () => {
        const single = geom.generate(LONG_AXIS, { ...LONG_PROPS, airmobile: true });
        const dual = geom.generate(LONG_AXIS, { ...LONG_PROPS, airmobile: true, doubleHeaded: true });

        expect(dual.type).toBe('MultiPolygon');
        // Polygon 1 is the rear half: it is the one that grows.
        expect(dual.coordinates[0][0].length).toBe(single.coordinates[0][0].length + 3);
        expect(dual.coordinates[1][0].length).toBe(single.coordinates[1][0].length);
        expect(dual.coordinates[0][0].some(([x]) => x < 0)).toBe(true);
    });

    it('reads doubleHeaded per branch on a merged arrow', () => {
        const branches = [
            { baseCoordinates: LONG_AXIS, width: 200, headLengthRatio: 1.5, doubleHeaded: true },
            { baseCoordinates: [[0, 20000], [5000, 20000]], width: 200, headLengthRatio: 1.5 },
        ];
        const merged = geom.generate(LONG_AXIS, { isMerged: true, branches, ...LONG_PROPS });

        expect(merged.type).toBe('MultiPolygon');
        expect(merged.coordinates[0][0].length).toBe(merged.coordinates[1][0].length + 3);
        expect(merged.coordinates[0][0].some(([x]) => x < 0)).toBe(true);
        expect(merged.coordinates[1][0].some(([x]) => x < 0)).toBe(false);
    });
});

// ============================================================================
// Handles follow the tip that is actually drawn
// ============================================================================

describe('AddArrowGeometry.createSingleHandles — headLength handle', () => {
    const handleOf = (properties) => geom
        .createSingleHandles({ properties: { id: 'a1', ...properties } })
        .find(h => h.properties.handleType === 'headLength');

    it('sits on the nominal tip for a single-headed arrow', () => {
        const handle = handleOf({ baseCoordinates: LONG_AXIS, ...LONG_PROPS });
        expect(handle.geometry.coordinates).toEqual([5000 + NOMINAL_HEAD, 0]);
    });

    it('follows the clamped tip when both heads no longer fit', () => {
        const axis = [[0, 0], [20, 0]];
        const props = { baseCoordinates: axis, width: 500, headLengthRatio: 1.5, showArrowHead: true };
        const nominal = handleOf(props);
        const clamped = handleOf({ ...props, doubleHeaded: true });

        expect(nominal.geometry.coordinates[0]).toBeCloseTo(20 + 1875, 6);
        expect(clamped.geometry.coordinates[0]).toBeLessThan(nominal.geometry.coordinates[0]);
        expect(clamped.geometry.coordinates[0]).toBeCloseTo(30, 6);
    });
});

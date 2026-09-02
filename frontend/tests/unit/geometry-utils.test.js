import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    pixelsToDegrees,
    degreesToPixels,
    createPointBoundingBox,
    normalizeCoordinates,
    calculateDistance,
    calculateBearing,
    wrapLongitude,
    clampLatitude,
    flattenPositions,
    antimeridianSafeLngSpan,
    translateKeypoints
} from '../../src/js/utilities/geometry-utils.js';

// ============================================================================
// pixelsToDegrees / degreesToPixels
// ============================================================================

describe('pixelsToDegrees', () => {
    it('returns 0 for 0 pixels', () => {
        expect(pixelsToDegrees(0, 0, 10)).toBe(0);
    });

    it('returns larger degrees at lower zoom levels', () => {
        const lowZoom = pixelsToDegrees(100, 0, 5);
        const highZoom = pixelsToDegrees(100, 0, 15);
        expect(lowZoom).toBeGreaterThan(highZoom);
    });

    it('returns smaller degrees at higher latitudes (Mercator distortion)', () => {
        const equator = pixelsToDegrees(100, 0, 10);
        const highLat = pixelsToDegrees(100, 60, 10);
        expect(highLat).toBeLessThan(equator);
    });

    it('handles negative latitudes (southern hemisphere)', () => {
        const north = pixelsToDegrees(100, 30, 10);
        const south = pixelsToDegrees(100, -30, 10);
        expect(north).toBeCloseTo(south, 10);
    });
});

describe('degreesToPixels', () => {
    it('is inverse of pixelsToDegrees', () => {
        const latitude = -23.5;
        const zoom = 15;
        const originalPixels = 50;
        const degrees = pixelsToDegrees(originalPixels, latitude, zoom);
        const backToPixels = degreesToPixels(degrees, latitude, zoom);
        expect(backToPixels).toBeCloseTo(originalPixels, 5);
    });

    it('returns 0 for 0 degrees', () => {
        expect(degreesToPixels(0, 0, 10)).toBe(0);
    });
});

// ============================================================================
// createPointBoundingBox
// ============================================================================

describe('createPointBoundingBox', () => {
    it('creates a GeoJSON Polygon', () => {
        const bbox = createPointBoundingBox([-43.2, -22.9], 10, 15);
        expect(bbox.type).toBe('Polygon');
        expect(bbox.coordinates).toHaveLength(1);
        expect(bbox.coordinates[0]).toHaveLength(5); // Closed ring
    });

    it('first and last coordinates are the same (closed ring)', () => {
        const bbox = createPointBoundingBox([-43.2, -22.9], 10, 15);
        const ring = bbox.coordinates[0];
        expect(ring[0]).toEqual(ring[4]);
    });

    it('creates bbox centered on the point', () => {
        const center = [-43.2, -22.9];
        const bbox = createPointBoundingBox(center, 10, 15);
        const ring = bbox.coordinates[0];
        // Centroid should be approximately at the original point
        const avgLng = (ring[0][0] + ring[2][0]) / 2;
        const avgLat = (ring[0][1] + ring[2][1]) / 2;
        expect(avgLng).toBeCloseTo(center[0], 5);
        expect(avgLat).toBeCloseTo(center[1], 5);
    });
});

// ============================================================================
// normalizeCoordinates
// ============================================================================

describe('normalizeCoordinates', () => {
    it('parses JSON string to array', () => {
        expect(normalizeCoordinates('[1, 2]')).toEqual([1, 2]);
    });

    it('passes through arrays', () => {
        const arr = [1, 2, 3];
        expect(normalizeCoordinates(arr)).toBe(arr);
    });

    it('returns null for invalid JSON', () => {
        expect(normalizeCoordinates('invalid')).toBeNull();
    });

    it('returns null for non-array JSON', () => {
        expect(normalizeCoordinates('{"a":1}')).toBeNull();
    });

    it('handles nested coordinate arrays (line/polygon)', () => {
        const input = '[[1,2],[3,4]]';
        const result = normalizeCoordinates(input);
        expect(result).toEqual([[1, 2], [3, 4]]);
    });
});

// ============================================================================
// calculateDistance
// ============================================================================

describe('calculateDistance', () => {
    it('returns 0 for same point', () => {
        const point = [-43.2, -22.9];
        expect(calculateDistance(point, point)).toBe(0);
    });

    it('calculates distance between Rio de Janeiro and São Paulo (~357 km)', () => {
        const rio = [-43.1729, -22.9068];
        const sp = [-46.6333, -23.5505];
        const distance = calculateDistance(rio, sp);
        // ~357 km with Haversine
        expect(distance).toBeGreaterThan(350000);
        expect(distance).toBeLessThan(365000);
    });

    it('calculates distance between known points (Brasilia to Rio ~933 km)', () => {
        const brasilia = [-47.8825, -15.7942];
        const rio = [-43.1729, -22.9068];
        const distance = calculateDistance(brasilia, rio);
        expect(distance).toBeGreaterThan(900000);
        expect(distance).toBeLessThan(960000);
    });

    it('is symmetric', () => {
        const p1 = [-43.2, -22.9];
        const p2 = [-46.6, -23.5];
        expect(calculateDistance(p1, p2)).toBeCloseTo(calculateDistance(p2, p1), 5);
    });

    it('handles cross-hemisphere points', () => {
        const north = [-43.2, 10.0];
        const south = [-43.2, -10.0];
        const distance = calculateDistance(north, south);
        // ~20 degrees of latitude ≈ 2222 km
        expect(distance).toBeGreaterThan(2200000);
        expect(distance).toBeLessThan(2250000);
    });
});

// ============================================================================
// calculateBearing
// ============================================================================

describe('calculateBearing', () => {
    it('returns 0 for due north', () => {
        const p1 = [-43.2, -22.9];
        const p2 = [-43.2, -22.0]; // Same lng, higher lat
        const bearing = calculateBearing(p1, p2);
        expect(bearing).toBeCloseTo(0, 0);
    });

    it('returns ~90 for due east', () => {
        const p1 = [-43.2, -22.9];
        const p2 = [-42.2, -22.9]; // Higher lng, same lat
        const bearing = calculateBearing(p1, p2);
        expect(bearing).toBeCloseTo(90, 0);
    });

    it('returns ~180 for due south', () => {
        const p1 = [-43.2, -22.0];
        const p2 = [-43.2, -23.0]; // Same lng, lower lat
        const bearing = calculateBearing(p1, p2);
        expect(bearing).toBeCloseTo(180, 0);
    });

    it('returns ~270 for due west', () => {
        const p1 = [-43.2, -22.9];
        const p2 = [-44.2, -22.9]; // Lower lng, same lat
        const bearing = calculateBearing(p1, p2);
        expect(bearing).toBeCloseTo(270, 0);
    });

    it('returns value in range [0, 360)', () => {
        const p1 = [-43.2, -22.9];
        const p2 = [-44.5, -23.8];
        const bearing = calculateBearing(p1, p2);
        expect(bearing).toBeGreaterThanOrEqual(0);
        expect(bearing).toBeLessThan(360);
    });
});

// ============================================================================
// wrapLongitude / clampLatitude
// ============================================================================

describe('wrapLongitude', () => {
    it('leaves an in-range longitude untouched', () => {
        expect(wrapLongitude(-43.2)).toBeCloseTo(-43.2, 10);
        expect(wrapLongitude(0)).toBe(0);
        expect(wrapLongitude(179.9)).toBeCloseTo(179.9, 10);
    });

    it('wraps a longitude past the antimeridian back into range', () => {
        // The real-world bug: panning east past +180 yields an unwrapped lng.
        expect(wrapLongitude(187.3)).toBeCloseTo(-172.7, 10);
        expect(wrapLongitude(-187.3)).toBeCloseTo(172.7, 10);
    });

    it('wraps a multiply-wrapped longitude (several pans around the globe)', () => {
        expect(wrapLongitude(-420)).toBeCloseTo(-60, 10);
        expect(wrapLongitude(720)).toBe(0);
        expect(wrapLongitude(541)).toBeCloseTo(-179, 10);
    });

    it('maps the +180 boundary to -180, matching MapLibre LngLat.wrap()', () => {
        expect(wrapLongitude(180)).toBe(-180);
        expect(wrapLongitude(-180)).toBe(-180);
        expect(wrapLongitude(540)).toBe(-180);
    });

    it('returns NaN for non-finite input instead of a bogus number', () => {
        expect(wrapLongitude(NaN)).toBeNaN();
        expect(wrapLongitude(Infinity)).toBeNaN();
        expect(wrapLongitude(-Infinity)).toBeNaN();
        expect(wrapLongitude(undefined)).toBeNaN();
        expect(wrapLongitude(null)).toBeNaN();
    });

    it('always produces a value the backend accepts: [-180, 180]', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
                (lng) => {
                    const wrapped = wrapLongitude(lng);
                    expect(wrapped).toBeGreaterThanOrEqual(-180);
                    expect(wrapped).toBeLessThanOrEqual(180);
                }
            )
        );
    });

    it('is idempotent — wrapping an already-wrapped value changes nothing', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
                (lng) => {
                    const once = wrapLongitude(lng);
                    expect(wrapLongitude(once)).toBeCloseTo(once, 10);
                }
            )
        );
    });

    it('preserves the geographic position (congruent mod 360)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -1e4, max: 1e4, noNaN: true, noDefaultInfinity: true }),
                (lng) => {
                    const delta = wrapLongitude(lng) - lng;
                    // The shift must be a whole number of full turns.
                    const turns = delta / 360;
                    expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
                }
            )
        );
    });
});

describe('clampLatitude', () => {
    it('leaves an in-range latitude untouched', () => {
        expect(clampLatitude(-22.9)).toBeCloseTo(-22.9, 10);
        expect(clampLatitude(0)).toBe(0);
        expect(clampLatitude(85)).toBe(85);
    });

    it('clamps beyond the poles to the ±90 boundary', () => {
        expect(clampLatitude(91)).toBe(90);
        expect(clampLatitude(-91)).toBe(-90);
        expect(clampLatitude(1000)).toBe(90);
    });

    it('keeps the exact pole values', () => {
        expect(clampLatitude(90)).toBe(90);
        expect(clampLatitude(-90)).toBe(-90);
    });

    it('returns NaN for non-finite input (a `?? 0` guard would not catch this)', () => {
        expect(clampLatitude(NaN)).toBeNaN();
        expect(clampLatitude(Infinity)).toBeNaN();
        expect(clampLatitude(-Infinity)).toBeNaN();
        expect(clampLatitude(undefined)).toBeNaN();
    });

    it('always produces a value the backend accepts: [-90, 90]', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
                (lat) => {
                    const clamped = clampLatitude(lat);
                    expect(clamped).toBeGreaterThanOrEqual(-90);
                    expect(clamped).toBeLessThanOrEqual(90);
                }
            )
        );
    });

    it('is idempotent', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
                (lat) => {
                    const once = clampLatitude(lat);
                    expect(clampLatitude(once)).toBe(once);
                }
            )
        );
    });
});


// ============================================================================
// flattenPositions
//
// Promovida em 2026-09-01 de `context-menu.control.js` (`_extractCoordinates`), onde era uma
// de TRÊS cópias do mesmo passeio. As cópias não divergiam em estilo, divergiam em QUAIS
// TIPOS tratavam, que é a diferença que nada reporta: um tipo esquecido devolve lista vazia,
// e lista vazia é resposta bem-formada.
// ============================================================================

describe('flattenPositions', () => {
    it('reads a Point as one position', () => {
        expect(flattenPositions({ type: 'Point', coordinates: [1, 2] })).toEqual([[1, 2]]);
    });

    it('reads a LineString and a MultiPoint as a flat list', () => {
        const coords = [[0, 0], [1, 1]];
        expect(flattenPositions({ type: 'LineString', coordinates: coords })).toEqual(coords);
        expect(flattenPositions({ type: 'MultiPoint', coordinates: coords })).toEqual(coords);
    });

    it('descends one ring level for Polygon and MultiLineString', () => {
        const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
        expect(flattenPositions(polygon)).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);

        const multiLine = { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2]]] };
        expect(flattenPositions(multiLine)).toEqual([[0, 0], [1, 1], [2, 2]]);
    });

    it('includes a POLYGON HOLE, which sits at the same depth as the exterior ring', () => {
        const withHole = {
            type: 'Polygon',
            coordinates: [
                [[0, 0], [10, 0], [10, 10], [0, 0]],
                [[2, 2], [3, 2], [3, 3], [2, 2]],
            ],
        };
        expect(flattenPositions(withHole)).toHaveLength(8);
        expect(flattenPositions(withHole)).toContainEqual([2, 2]);
    });

    it('descends two levels for MultiPolygon', () => {
        const multi = {
            type: 'MultiPolygon',
            coordinates: [
                [[[0, 0], [1, 0], [1, 1], [0, 0]]],
                [[[5, 5], [6, 5], [6, 6], [5, 5]]],
            ],
        };
        expect(flattenPositions(multi)).toEqual([
            [0, 0], [1, 0], [1, 1], [0, 0],
            [5, 5], [6, 5], [6, 6], [5, 5],
        ]);
    });

    it('recurses through a GeometryCollection, mixing depths', () => {
        const collection = {
            type: 'GeometryCollection',
            geometries: [
                { type: 'Point', coordinates: [1, 1] },
                { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] },
            ],
        };
        expect(flattenPositions(collection)).toEqual([[1, 1], [0, 0], [2, 0], [2, 2], [0, 0]]);
    });

    it('returns an EMPTY ARRAY, never null, for anything unusable', () => {
        // The caller loops over the result; a null here would throw far from the cause.
        expect(flattenPositions(null)).toEqual([]);
        expect(flattenPositions(undefined)).toEqual([]);
        expect(flattenPositions({})).toEqual([]);
        expect(flattenPositions({ type: 'Point' })).toEqual([]);
        expect(flattenPositions({ type: 'GeometryCollection' })).toEqual([]);
        expect(flattenPositions({ type: 'Nada Disso', coordinates: [[1, 2]] })).toEqual([]);
        expect(flattenPositions('LineString')).toEqual([]);
    });
});

// ============================================================================
// antimeridianSafeLngSpan
//
// Movida literalmente de `terrain/data-layers.manager.js`, onde já tinha pago o defeito que
// os casos abaixo descrevem. Os exemplos são os do comentário original.
// ============================================================================

describe('antimeridianSafeLngSpan', () => {
    it('an ordinary span is just [min, max]', () => {
        expect(antimeridianSafeLngSpan([-43.5, -43.1, -43.3])).toEqual([-43.5, -43.1]);
    });

    it('a single longitude spans nothing', () => {
        expect(antimeridianSafeLngSpan([10])).toEqual([10, 10]);
    });

    it('THE DEFECT: 179 and -179 give a 2-degree span, not the whole world mirrored', () => {
        const [west, east] = antimeridianSafeLngSpan([179, -179]);
        expect(west).toBe(179);
        expect(east).toBe(181);
        // The old min/max answer was [-179, 179], a 358-degree box that framed everything
        // EXCEPT the data. The number that tells the two apart is the WIDTH.
        expect(east - west).toBe(2);
    });

    it('keeps west < east by expressing east beyond 180', () => {
        const [west, east] = antimeridianSafeLngSpan([170, 175, -175, -170]);
        expect(west).toBe(170);
        expect(east).toBe(190);
        expect(east).toBeGreaterThan(west);
    });

    it('picks the LARGEST empty arc, which need not be the wrap', () => {
        // Two clusters straddling the date line plus one lone point at Greenwich. The wrap gap
        // is only 2 degrees wide, so it LOSES: the widest empty arc is one of the two
        // 178-degree oceans, and the span is its complement.
        const [west, east] = antimeridianSafeLngSpan([178, 179, -179, -178, 0]);
        expect([west, east]).toEqual([0, 182]);
        // Every input is inside, counting -179 as 181 and -178 as 182.
        expect(east - west).toBe(182);
    });

    it('a TIE between two equally wide gaps is broken by the FIRST one, going east', () => {
        // Written down because it is arbitrary and because both answers are correct: the set
        // above has two 178-degree gaps (0->178 and -178->0), and the loop keeps the first
        // because it compares with `>` and not `>=`. Anyone changing that operator flips this
        // span to [178, 360], which is the same set of meridians expressed differently, and
        // this case is what tells them the change was theirs.
        const [west] = antimeridianSafeLngSpan([178, 179, -179, -178, 0]);
        expect(west).toBe(0);
    });

    it('does not mutate the caller\'s array', () => {
        const lngs = [10, -170, 170];
        antimeridianSafeLngSpan(lngs);
        expect(lngs).toEqual([10, -170, 170]);
    });

    it('INVARIANT: the span always covers every input longitude, modulo 360', () => {
        fc.assert(fc.property(
            fc.array(fc.double({ min: -180, max: 180, noNaN: true }), { minLength: 1, maxLength: 15 }),
            (lngs) => {
                const [west, east] = antimeridianSafeLngSpan(lngs);
                expect(east).toBeGreaterThanOrEqual(west);
                for (const lng of lngs) {
                    const inside = (lng >= west - 1e-9 && lng <= east + 1e-9)
                        || (lng + 360 >= west - 1e-9 && lng + 360 <= east + 1e-9);
                    expect(inside).toBe(true);
                }
            },
        ));
    });
});

// ============================================================================
// translateKeypoints
//
// Promovida de `phone/phone-move-geometry.js`, e o controle negativo dela é aquele arquivo:
// `phone-move-geometry.test.js` dirige `translateFeature`, que agora chega aqui, então
// quebrar esta função deixa AS DUAS suítes vermelhas. É a única das três promoções que já
// nasce com um chamador coberto do outro lado.
// ============================================================================

describe('translateKeypoints', () => {
    const rota = () => [
        { t: 1000, lng: 0, lat: 0 },
        { t: 2000, lng: 1, lat: 1 },
    ];

    it('moves every keypoint and preserves `t` and any extra field', () => {
        const moved = translateKeypoints(
            [{ t: 5, lng: 10, lat: 20, rotulo: 'alvo' }], 1, -2,
        );
        expect(moved).toEqual([{ t: 5, lng: 11, lat: 18, rotulo: 'alvo' }]);
    });

    it('clamps latitude to the pole rather than mirroring over it', () => {
        expect(translateKeypoints([{ t: 0, lng: 0, lat: 80 }], 0, 20)[0].lat).toBe(90);
        expect(translateKeypoints([{ t: 0, lng: 0, lat: -80 }], 0, -20)[0].lat).toBe(-90);
    });

    it('does NOT wrap longitude: an unwrapped result is the caller\'s to interpret', () => {
        // The geometry walk does the same, and a per-vertex wrap would tear a shape that
        // straddles the antimeridian into two halves on opposite edges of the world.
        expect(translateKeypoints([{ t: 0, lng: 179, lat: 0 }], 3, 0)[0].lng).toBe(182);
    });

    it('applies the optional shift ON TOP of the delta, associated as the geometry walk does', () => {
        expect(translateKeypoints([{ t: 0, lng: 179, lat: 0 }], 3, 0, -360)[0].lng).toBe(-178);
    });

    it('ALL OR NOTHING: one broken keypoint refuses the whole route', () => {
        expect(translateKeypoints([{ t: 0, lng: 0, lat: 0 }, { t: 1, lng: NaN, lat: 0 }], 1, 1)).toBeNull();
        expect(translateKeypoints([{ t: 0, lng: 0, lat: 0 }, null], 1, 1)).toBeNull();
        expect(translateKeypoints([{ t: 0, lng: '0', lat: 0 }], 1, 1)).toBeNull();
        expect(translateKeypoints([{ t: 0, lng: 0, lat: Infinity }], 1, 1)).toBeNull();
    });

    it('refuses a non-array, and accepts an empty array as an empty route', () => {
        expect(translateKeypoints(null, 1, 1)).toBeNull();
        expect(translateKeypoints(undefined, 1, 1)).toBeNull();
        expect(translateKeypoints('rota', 1, 1)).toBeNull();
        expect(translateKeypoints([], 1, 1)).toEqual([]);
    });

    it('never mutates the input keypoints', () => {
        const original = rota();
        translateKeypoints(original, 10, 10);
        expect(original).toEqual(rota());
    });

    it('INVARIANT: the shape of the route survives (every gap between keypoints is kept)', () => {
        fc.assert(fc.property(
            fc.double({ min: -50, max: 50, noNaN: true }),
            fc.double({ min: -50, max: 50, noNaN: true }),
            (dLng, dLat) => {
                const moved = translateKeypoints(rota(), dLng, dLat);
                expect(moved[1].lng - moved[0].lng).toBeCloseTo(1, 9);
                // Latitude only survives while the clamp is not in play, which is the whole
                // range this property is generated over.
                expect(moved[1].lat - moved[0].lat).toBeCloseTo(1, 9);
            },
        ));
    });
});

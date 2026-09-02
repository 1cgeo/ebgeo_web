// Path: tests/unit/arrow-geometry.test.js

/**
 * @fileoverview Pure-logic suite for `AddArrowGeometry`
 * (`src/js/military_tools/arrow_tool/add_arrow_geometry.js`), domain `mil-arrow`
 * of `tests/TESTING-BACKLOG.md`.
 *
 * WHAT IT PINS
 * - `normalizeBaseCoordinates`: the four input shapes (array by reference, JSON
 *   string, malformed string, non-array) and the shape check that keeps a JSON
 *   scalar from escaping as a scalar.
 * - `removeVertexAtIndex`: bounds, the integer test, the two-vertex floor,
 *   immutability of the input.
 * - `validate`: the finiteness gate, and the 10 m floor measured against the REAL haversine of
 *   `utilities/geometry-utils.js` (the mock BaseGeometry delegates to the very
 *   function the real base class delegates to), cross-checked by an INDEPENDENT
 *   chord-length derivation written in this file.
 * - `_applyWidthFromHandle`: the side sign, which is the `sideSign(a,b,p)` the
 *   backlog proposes extracting. The cross product is re-derived here from the
 *   raw coordinates, not by calling back into the module.
 * - `_applyHeadLengthFromHandle`: the forward/backward classification across the
 *   -180/180 bearing wrap, the 100 m dead zone, the `width || 500` fallback.
 * - `_applyAirmobileFromHandle`: the [0.01, 0.99] clamp.
 * - `updateFromHandle`: which branches guard their index and which do not.
 * - The four GOLDEN inline snapshots of the one-headed arrow, recorded with the
 *   tree clean BEFORE `doubleHeaded` existed. They say nothing about the arrow
 *   being right; they say it did not change.
 * - `resolveHeadLengths`, which is pure arithmetic and takes the axis length as a
 *   NUMBER, so it needs no stub at all.
 * - The `doubleHeaded` tail, STRUCTURALLY: how many vertices it adds, which end it
 *   is anchored to, which of the two `bearing()` calls it uses, that the flag is
 *   strictly `=== true`, and that `showArrowHead` is the master switch.
 * - `createCrossedPolygonsWithHead` called DIRECTLY (it is pure: it takes lines and
 *   points already computed), which is what says the tail goes into polygon 1.
 * - The `headLength` handle of `createSingleHandles`, including its clamp.
 *
 * WHAT IT DOES NOT REACH
 * - Anything that needs real turf: the polygon SHAPE of a generated arrow is only
 *   asserted structurally (vertex count, closed ring, ordering of the head
 *   points), never metrically. `lineOffset`, `destination` and `bearing` are
 *   planar stubs, so no statement here is evidence about geodesy. Worse, the
 *   stub's `lineOffset` sign is the INVERSE of the vendored turf's (positive
 *   moves NORTH here, i.e. LEFT of an eastward course, while real turf moves
 *   RIGHT), so no argument about SIDES may be made from this file. Absence of
 *   self-intersection in the double-headed tail is measured in
 *   `arrow-geometry-turf-real.test.js`, against the real bundle.
 * - `generateAirmobileArrowGeometry` end to end: the stub has no `lineSlice` nor
 *   `lineIntersect`, so every airmobile call here lands in the `catch` and comes
 *   back as a normal arrow. That path IS pinned (the rescue must carry the flag),
 *   but the crossed geometry itself is only reached in the real-turf file.
 * - `createMergedHandles`, `createAirmobileHandle`, `getBoundingBox`.
 * - `isPointTooClose` (thin wrapper over the same haversine as `validate`).
 * - `extractBranches` and the merge/split gates live in `arrow-merge.test.js`; the
 *   four `doubleHeaded` lists of the control live in
 *   `arrow-control-doubleheaded.test.js`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fc from 'fast-check';
import { calculateDistance as realHaversine } from '../../src/js/utilities/geometry-utils.js';

// `add_arrow_geometry.js` imports BaseGeometry from the `@tools` barrel, which drags
// DOM/MapLibre-coupled modules into a `node` run. Mock the barrel with a trivial base
// class. `calculateDistance` is NOT re-implemented here: it delegates to the same
// `utilities/geometry-utils.js` function the real `BaseGeometry` delegates to, so
// `validate` is measured against production distance math, not against a test double.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = { ...properties }; }
        calculateDistance(a, b) { return realHaversine(a, b); }
    },
}));

// ============================================================================
// Independent re-derivations (never composed from the module under test)
// ============================================================================

/**
 * Great-circle distance via 3D unit vectors and the chord length.
 *
 * Deliberately a different algebraic route from the haversine the production code
 * uses (Cartesian embedding, not the half-angle identity), so agreement between the
 * two is evidence and not a tautology. The chord form was chosen over the spherical
 * law of cosines because the latter loses ~1e-4 m to `Math.acos` at the 10 m scale,
 * which is exactly the scale of the boundary this suite has to measure: an oracle
 * that is wrong where the assertion lives is not an oracle. Same sphere radius as
 * `geometry-utils.js`.
 *
 * @param {Array<number>} a - [lng, lat]
 * @param {Array<number>} b - [lng, lat]
 * @returns {number} Distance in meters
 */
function chordDistance(a, b) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const toVec = ([lng, lat]) => {
        const phi = lat * toRad;
        const lambda = lng * toRad;
        return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
    };
    const [x1, y1, z1] = toVec(a);
    const [x2, y2, z2] = toVec(b);
    const chord = Math.hypot(x1 - x2, y1 - y2, z1 - z2);
    return 2 * R * Math.asin(Math.min(1, chord / 2));
}

/**
 * Signed area of the triangle (a, b, p) in raw lng/lat units. This is the exact
 * expression `_applyWidthFromHandle` uses to pick the sign, written out here from
 * the coordinates rather than obtained by calling the module.
 * @param {Array<number>} a - Segment start
 * @param {Array<number>} b - Segment end
 * @param {Array<number>} p - Probe point
 * @returns {number} Positive when p lies on one side, negative on the other, 0 when collinear
 */
function crossProduct(a, b, p) {
    return (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
}

// ============================================================================
// Deterministic planar turf stub
// ============================================================================

const turfState = {
    bearing: 90,
    tipBearing: null,      // when set, the SECOND bearing() call returns this
    length: 500,
    pointToLineDistance: 777,
    nearestLocation: 5,
};

const coordOf = (p) => (p && p.geometry ? p.geometry.coordinates : p);
const feat = (coords) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords } });

beforeAll(() => {
    let bearingCalls = 0;
    globalThis.turf = {
        lineString: (coords) => {
            // Mirror the real turf contract closely enough that a non-array input is
            // an error, which is what routes `generateSingleArrow` into its catch.
            if (!Array.isArray(coords)) throw new Error('coordinates must be an array');
            return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
        },
        point: (c) => feat(c),
        // Offset marks each vertex so left and right lines are distinguishable.
        lineOffset: (line, offset) => ({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: line.geometry.coordinates.map((c) => [c[0], c[1] + offset]),
            },
        }),
        bearing: () => {
            const isSecond = bearingCalls++ % 2 === 1;
            return (isSecond && turfState.tipBearing !== null) ? turfState.tipBearing : turfState.bearing;
        },
        // Encodes its own arguments so the caller's intent is observable.
        destination: (p, dist, brg) => feat([coordOf(p)[0] + dist, coordOf(p)[1] + brg]),
        length: () => turfState.length,
        pointToLineDistance: () => turfState.pointToLineDistance,
        nearestPointOnLine: () => ({ properties: { location: turfState.nearestLocation } }),
        along: (_line, d) => feat([d, 0]),
        // Only `createSingleHandles` reads it; planar midpoint is enough.
        midpoint: (a, b) => {
            const [x1, y1] = coordOf(a);
            const [x2, y2] = coordOf(b);
            return feat([(x1 + x2) / 2, (y1 + y2) / 2]);
        },
        bbox: () => [0, 0, 1, 1],
        feature: (g) => ({ type: 'Feature', geometry: g }),
    };
    globalThis.turf.__resetBearingCalls = () => { bearingCalls = 0; };
});

afterAll(() => { delete globalThis.turf; });

const { default: AddArrowGeometry } = await import('../../src/js/military_tools/arrow_tool/add_arrow_geometry.js');

const geom = new AddArrowGeometry();

/** Fresh feature so no test can be contaminated by a previous mutation. */
const arrowFeature = (props = {}) => ({
    type: 'Feature',
    properties: { id: 'arrow-1', baseCoordinates: [[0, 0], [1, 0], [2, 0]], ...props },
});

// ============================================================================
// normalizeBaseCoordinates
// ============================================================================

describe('AddArrowGeometry.normalizeBaseCoordinates', () => {
    it('devolve o MESMO array quando a entrada já é um array (sem cópia)', () => {
        const input = [[0, 0], [1, 1]];
        expect(geom.normalizeBaseCoordinates(input)).toBe(input);
    });

    it('faz parse de string JSON de coordenadas', () => {
        expect(geom.normalizeBaseCoordinates('[[0,0],[1,1]]')).toEqual([[0, 0], [1, 1]]);
    });

    it('round-trip: JSON.stringify seguido de normalize devolve as mesmas coordenadas', () => {
        // `-0` is excluded on purpose and pinned in its own case below: JSON has no
        // negative zero, so that loss belongs to the format and not to this function.
        const noNegativeZero = (x) => (Object.is(x, -0) ? 0 : x);
        fc.assert(fc.property(
            fc.array(
                fc.tuple(
                    fc.double({ min: -180, max: 180, noNaN: true }).map(noNegativeZero),
                    fc.double({ min: -90, max: 90, noNaN: true }).map(noNegativeZero),
                ),
                { minLength: 1, maxLength: 12 },
            ),
            (coords) => {
                expect(geom.normalizeBaseCoordinates(JSON.stringify(coords))).toEqual(coords);
            },
        ), { numRuns: 120 });
    });

    it('o round-trip por JSON PERDE o sinal do zero (-0 volta como +0)', () => {
        const out = geom.normalizeBaseCoordinates(JSON.stringify([[-0, 0], [1, 1]]));
        expect(Object.is(out[0][0], -0)).toBe(false);
        expect(out[0][0]).toBe(0);
        // Numerically harmless here, but it means a persisted arrow is not byte-identical
        // to the in-memory one, which matters to any equality check on coordinates.
        expect(Object.is(geom.normalizeBaseCoordinates([[-0, 0]])[0][0], -0)).toBe(true);
    });

    it('JSON malformado vira [] (não lança)', () => {
        expect(geom.normalizeBaseCoordinates('[[0,0]')).toEqual([]);
        expect(geom.normalizeBaseCoordinates('')).toEqual([]);
    });

    it('não-array e não-string viram []', () => {
        expect(geom.normalizeBaseCoordinates(null)).toEqual([]);
        expect(geom.normalizeBaseCoordinates(undefined)).toEqual([]);
        expect(geom.normalizeBaseCoordinates(42)).toEqual([]);
        expect(geom.normalizeBaseCoordinates({ a: 1 })).toEqual([]);
    });

    it('array vazio sobrevive como array vazio', () => {
        expect(geom.normalizeBaseCoordinates([])).toEqual([]);
    });
});

describe('CONSERTADO: normalizeBaseCoordinates deixava escapar o escalar de um JSON válido', () => {
    // The string branch used to return `JSON.parse(...)` with no shape check, so any
    // valid JSON scalar or object left the function pretending to be a coordinate
    // list: `'42'` -> 42, `'null'` -> null, `'{}'` -> {}. Downstream,
    // `coords.length < 2` was `undefined < 2` === false for 42, so the length guard
    // did NOT fire and invalid GeoJSON reached the caller (next block).
    // The parsed value is now shape-checked and a non-array falls back to [].

    it('CONTROLE: a função é alcançável e discrimina (string boa devolve o array)', () => {
        expect(geom.normalizeBaseCoordinates('[[0,0],[1,1]]')).toEqual([[0, 0], [1, 1]]);
        expect(geom.normalizeBaseCoordinates('lixo')).toEqual([]);
    });

    it('escalares e objetos JSON válidos viram [], como o JSON malformado', () => {
        expect(geom.normalizeBaseCoordinates('42')).toEqual([]);
        expect(geom.normalizeBaseCoordinates('null')).toEqual([]);
        expect(geom.normalizeBaseCoordinates('{}')).toEqual([]);
    });

    it('sempre devolve um array (antes devolvia o escalar 42)', () => {
        expect(Array.isArray(geom.normalizeBaseCoordinates('42'))).toBe(true);
    });
});

describe('CONSERTADO: o escalar que escapava virava geometria GeoJSON inválida', () => {
    it('CONTROLE: entrada boa produz um Polygon com anel fechado', () => {
        const g = geom.generateSingleArrow([[0, 0], [1, 0], [2, 0]], { width: 1000 });
        expect(g.type).toBe('Polygon');
        expect(g.coordinates[0][0]).toEqual(g.coordinates[0][g.coordinates[0].length - 1]);
    });

    it("recusa baseCoordinates '42' (antes emitia LineString com coordinates: 42)", () => {
        const g = geom.generateSingleArrow('42', { width: 1000 });
        expect(g === null || Array.isArray(g.coordinates)).toBe(true);
        // Absolute anchor: the length guard now fires, so the answer is the refusal
        // sentinel and not some other well-formed geometry.
        expect(g).toBeNull();
    });

    it("recusa baseCoordinates 'null' (antes lançava TypeError fora do try)", () => {
        expect(() => geom.generateSingleArrow('null', { width: 1000 })).not.toThrow();
        expect(geom.generateSingleArrow('null', { width: 1000 })).toBeNull();
    });
});

// ============================================================================
// removeVertexAtIndex
// ============================================================================

describe('AddArrowGeometry.removeVertexAtIndex', () => {
    const three = () => [[0, 0], [1, 1], [2, 2]];

    it('remove o vértice pedido e devolve um array novo', () => {
        const input = three();
        const out = geom.removeVertexAtIndex(input, 1);
        expect(out).toEqual([[0, 0], [2, 2]]);
        expect(out).not.toBe(input);
    });

    it('não muta a entrada', () => {
        const input = three();
        geom.removeVertexAtIndex(input, 0);
        expect(input).toEqual([[0, 0], [1, 1], [2, 2]]);
    });

    it('recusa índice fora do intervalo, nas duas pontas', () => {
        expect(geom.removeVertexAtIndex(three(), -1)).toBeNull();
        expect(geom.removeVertexAtIndex(three(), 3)).toBeNull();
        expect(geom.removeVertexAtIndex(three(), 99)).toBeNull();
    });

    it('recusa quando sobraria menos de 2 vértices (piso da seta)', () => {
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1]], 0)).toBeNull();
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1]], 1)).toBeNull();
    });

    it('recusa coleção vazia ou ausente', () => {
        expect(geom.removeVertexAtIndex([], 0)).toBeNull();
        expect(geom.removeVertexAtIndex(null, 0)).toBeNull();
        expect(geom.removeVertexAtIndex(undefined, 0)).toBeNull();
    });

    it('propriedade: para índice válido, o resultado é a entrada menos aquele item', () => {
        fc.assert(fc.property(
            fc.array(fc.tuple(fc.integer(), fc.integer()), { minLength: 3, maxLength: 15 }),
            fc.nat(),
            (coords, rawIndex) => {
                const index = rawIndex % coords.length;
                const before = JSON.stringify(coords);
                const out = geom.removeVertexAtIndex(coords, index);
                expect(out).not.toBeNull();
                expect(out.length).toBe(coords.length - 1);
                const expected = coords.filter((_, i) => i !== index);
                expect(out).toEqual(expected);
                expect(JSON.stringify(coords)).toBe(before);
            },
        ), { numRuns: 200 });
    });
});

describe('CONSERTADO: removeVertexAtIndex aceitava índice não-inteiro', () => {
    // `index < 0` and `index >= length` are both false for NaN, so the old guard let
    // it through and `Array.prototype.splice` coerced NaN to 0: the FIRST vertex was
    // deleted instead of nothing. `x ?? 0` would not have helped either; the guard
    // needed `Number.isInteger`, which is what it has now.

    it('CONTROLE: o mesmo caminho recusa um índice inteiro fora do intervalo', () => {
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], 3)).toBeNull();
    });

    it('recusa NaN (antes apagava o vértice 0 em silêncio)', () => {
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], NaN)).toBeNull();
    });

    it('recusa o índice fracionário 1.5 (antes o splice o truncava para 1)', () => {
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], 1.5)).toBeNull();
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], Infinity)).toBeNull();
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], '1')).toBeNull();
    });
});

// ============================================================================
// validate — the 10 m floor
// ============================================================================

describe('AddArrowGeometry.validate', () => {
    /** Latitude delta, in degrees, that puts two points `meters` apart on a meridian. */
    const degreesForMeters = (meters) => (meters / 6371000) * (180 / Math.PI);

    it('recusa menos de 2 vértices', () => {
        expect(geom.validate([])).toBe(false);
        expect(geom.validate([[0, 0]])).toBe(false);
        expect(geom.validate(null)).toBe(false);
    });

    it('recusa vértices coincidentes (distância 0)', () => {
        expect(geom.validate([[0, 0], [0, 0]])).toBe(false);
    });

    it('aceita quando cada par consecutivo passa dos 10 m', () => {
        expect(geom.validate([[0, 0], [1, 1]])).toBe(true);
    });

    it('a fronteira de 10 m é `<` estrito: exatamente 10 m é VÁLIDO', () => {
        const at10 = degreesForMeters(10);
        // The independent derivation confirms the constructed pair really is 10 m apart
        // before the assertion about the boundary means anything.
        expect(chordDistance([0, 0], [0, at10])).toBeCloseTo(10, 6);
        expect(geom.validate([[0, 0], [0, at10]])).toBe(true);
        expect(geom.validate([[0, 0], [0, degreesForMeters(9.999999)]])).toBe(false);
        expect(geom.validate([[0, 0], [0, degreesForMeters(10.000001)]])).toBe(true);
    });

    it('reprova quando UM par no meio da polilinha está abaixo do piso', () => {
        const tiny = degreesForMeters(2);
        expect(geom.validate([[0, 0], [1, 0], [1, tiny]])).toBe(false);
    });

    it('aceita string JSON, porque normaliza antes de medir', () => {
        expect(geom.validate('[[0,0],[1,1]]')).toBe(true);
        expect(geom.validate('[[0,0],[0,0]]')).toBe(false);
    });

    it('propriedade: validate concorda com uma derivação INDEPENDENTE (corda 3D)', () => {
        fc.assert(fc.property(
            fc.array(
                fc.tuple(
                    fc.double({ min: -170, max: 170, noNaN: true }),
                    fc.double({ min: -80, max: 80, noNaN: true }),
                ),
                { minLength: 0, maxLength: 6 },
            ),
            (coords) => {
                let expected = coords.length >= 2;
                for (let i = 1; expected && i < coords.length; i++) {
                    // The two formulas disagree only in the last bits, so a pair that
                    // lands within a micrometre of the 10 m floor is not a fair oracle.
                    const d = chordDistance(coords[i - 1], coords[i]);
                    fc.pre(Math.abs(d - 10) > 1e-3);
                    if (d < 10) expected = false;
                }
                expect(geom.validate(coords)).toBe(expected);
            },
        ), { numRuns: 300 });
    });
});

describe('CONSERTADO: validate aceitava coordenada não-finita', () => {
    // The haversine of a NaN/Infinity pair is NaN, and `NaN < 10` is false, so the
    // "too close" test never fired. Classic "`x ?? 0` does not guard NaN" shape:
    // nothing in the chain asked `Number.isFinite`. It does now, BEFORE the floor.

    it('CONTROLE: o mesmo predicado reprova um par finito abaixo do piso', () => {
        expect(geom.validate([[0, 0], [0, 0]])).toBe(false);
    });

    it('recusa NaN (antes aceitava)', () => {
        expect(geom.validate([[0, 0], [NaN, NaN]])).toBe(false);
        expect(geom.validate([[NaN, 0], [1, 1]])).toBe(false);
    });

    it('recusa Infinity nas duas componentes e nos dois sinais (antes aceitava)', () => {
        expect(geom.validate([[0, 0], [Infinity, 1]])).toBe(false);
        expect(geom.validate([[0, 0], [1, -Infinity]])).toBe(false);
    });

    it('recusa vértice que não é par de números', () => {
        expect(geom.validate([[0, 0], ['1', '1']])).toBe(false);
        expect(geom.validate([[0, 0], [1]])).toBe(false);
        expect(geom.validate([[0, 0], null])).toBe(false);
    });

    it("recusa o escalar de '42' (antes aceitava, sem par nenhum para medir)", () => {
        expect(geom.validate('42')).toBe(false);
    });
});

// ============================================================================
// _applyWidthFromHandle — the side sign the backlog proposes extracting
// ============================================================================

describe('AddArrowGeometry._applyWidthFromHandle (sinal do lado)', () => {
    const segment = [[0, 0], [1, 0]];   // last two vertices: due east in the stub's plane

    it('a magnitude é a distância ponto-linha; o sinal vem do lado', () => {
        turfState.pointToLineDistance = 777;
        const north = {};
        geom._applyWidthFromHandle(north, segment, [0.5, 1]);
        const south = {};
        geom._applyWidthFromHandle(south, segment, [0.5, -1]);

        expect(Math.abs(north.width)).toBe(777);
        expect(Math.abs(south.width)).toBe(777);
        expect(Math.sign(north.width)).toBe(-Math.sign(south.width));
        // Absolute anchor, so the two assertions above cannot both be satisfied by a
        // pair of equally wrong signs.
        expect(north.width).toBe(777);
        expect(south.width).toBe(-777);
    });

    it('colinear NÃO inverte o sinal (o teste é `> 0` estrito)', () => {
        turfState.pointToLineDistance = 777;
        const onLine = {};
        geom._applyWidthFromHandle(onLine, segment, [0.5, 0]);
        expect(crossProduct(segment[0], segment[1], [0.5, 0])).toBe(0);
        expect(onLine.width).toBe(777);
    });

    it('usa os DOIS últimos vértices, não os dois primeiros', () => {
        turfState.pointToLineDistance = 5;
        // Segment (1,0)->(1,1) points north, so "north of the line" is now east of it.
        const props = {};
        geom._applyWidthFromHandle(props, [[0, 0], [1, 0], [1, 1]], [2, 0.5]);
        const expectedSign = crossProduct([1, 0], [1, 1], [2, 0.5]) > 0 ? -1 : 1;
        expect(props.width).toBe(5 * expectedSign);
    });

    it('propriedade: sign(width) === (cross > 0 ? -1 : +1), com cross derivado à parte', () => {
        const coord = () => fc.tuple(
            fc.integer({ min: -50, max: 50 }),
            fc.integer({ min: -50, max: 50 }),
        );
        fc.assert(fc.property(coord(), coord(), coord(), fc.integer({ min: 1, max: 5000 }), (a, b, p, dist) => {
            fc.pre(a[0] !== b[0] || a[1] !== b[1]);
            turfState.pointToLineDistance = dist;
            const props = {};
            geom._applyWidthFromHandle(props, [a, b], p);
            const cross = crossProduct(a, b, p);
            expect(props.width).toBe(cross > 0 ? -dist : dist);
        }), { numRuns: 250 });
    });

    it('borda: distância 0 grava -0 do lado que inverte (largura degenerada, sem aviso)', () => {
        turfState.pointToLineDistance = 0;
        const props = {};
        geom._applyWidthFromHandle(props, segment, [0.5, -1]);   // cross > 0
        expect(Object.is(props.width, -0)).toBe(true);
        // Documented consequence: the generated body collapses to zero width and
        // nothing in this path complains.
        expect(Math.abs(props.width / 2)).toBe(0);
        turfState.pointToLineDistance = 777;
    });
});

// ============================================================================
// _applyHeadLengthFromHandle
// ============================================================================

describe('AddArrowGeometry._applyHeadLengthFromHandle', () => {
    const coords = [[0, 0], [1, 0]];

    const drag = (props, { bearing = 0, tipBearing = 0, distance = 5000 } = {}) => {
        turfState.bearing = bearing;
        turfState.tipBearing = tipBearing;
        turfState.length = distance;
        globalThis.turf.__resetBearingCalls();
        geom._applyHeadLengthFromHandle(props, coords, [2, 2]);
        turfState.tipBearing = null;
    };

    it('grava ratio = distância / (|width| * 2.5) quando o arrasto vai para a frente', () => {
        const props = { width: 1000 };
        drag(props, { distance: 5000 });
        expect(props.headLengthRatio).toBe(5000 / 2500);
    });

    it('a largura negativa não muda o ratio (usa o módulo)', () => {
        const props = { width: -1000 };
        drag(props, { distance: 5000 });
        expect(props.headLengthRatio).toBe(2);
    });

    it('piso de 0.5: arrasto curto perto da ponta não encolhe além disso', () => {
        const props = { width: 10000 };
        drag(props, { distance: 500 });
        expect(props.headLengthRatio).toBe(0.5);
    });

    it('zona morta: abaixo de 100 m o ratio anterior é PRESERVADO (nada acontece)', () => {
        const props = { width: 1000, headLengthRatio: 9 };
        drag(props, { distance: 50 });
        expect(props.headLengthRatio).toBe(9);
        // Exactly 100 is also dead (`> 100` strict).
        const atBoundary = { width: 1000, headLengthRatio: 9 };
        drag(atBoundary, { distance: 100 });
        expect(atBoundary.headLengthRatio).toBe(9);
    });

    it('arrasto para TRÁS não mexe no ratio', () => {
        const props = { width: 1000, headLengthRatio: 9 };
        drag(props, { bearing: 0, tipBearing: 180, distance: 5000 });
        expect(props.headLengthRatio).toBe(9);
    });

    it('a classificação frente/trás ATRAVESSA a costura -180/180', () => {
        // bearing 179 and tip -179 are 2 degrees apart, i.e. forward.
        const wrapped = { width: 1000 };
        drag(wrapped, { bearing: 179, tipBearing: -179, distance: 5000 });
        expect(wrapped.headLengthRatio).toBe(2);

        const wrappedOther = { width: 1000 };
        drag(wrappedOther, { bearing: -179, tipBearing: 179, distance: 5000 });
        expect(wrappedOther.headLengthRatio).toBe(2);

        // ...and a genuinely sideways drag (90 degrees) is still rejected.
        const sideways = { width: 1000, headLengthRatio: 9 };
        drag(sideways, { bearing: 179, tipBearing: -91, distance: 5000 });
        expect(sideways.headLengthRatio).toBe(9);
    });

    it('propriedade: aceita exatamente quando a diferença angular REAL é menor que 90 graus', () => {
        fc.assert(fc.property(
            fc.integer({ min: -180, max: 180 }),
            fc.integer({ min: -180, max: 180 }),
            (bearing, tipBearing) => {
                // Independent derivation of the true angular separation.
                const raw = bearing - tipBearing;
                const trueDiff = Math.abs(((raw % 360) + 540) % 360 - 180);
                fc.pre(Math.abs(trueDiff - 90) > 1e-9);
                const props = { width: 1000 };
                drag(props, { bearing, tipBearing, distance: 5000 });
                expect(props.headLengthRatio !== undefined).toBe(trueDiff < 90);
            },
        ), { numRuns: 250 });
    });

    it('FORMA `valor || padrao`: width 0 cai para 500, e o ratio deixa de casar com o corpo', () => {
        // Reachable: `_applyWidthFromHandle` writes 0 (or -0) whenever the drag lands
        // on the body axis. The head is then sized from a 500 m body that does not exist.
        const zeroWidth = { width: 0 };
        drag(zeroWidth, { distance: 5000 });
        expect(zeroWidth.headLengthRatio).toBe(5000 / 1250);

        const thousand = { width: 1000 };
        drag(thousand, { distance: 5000 });
        expect(thousand.headLengthRatio).toBe(5000 / 2500);

        // The two differ, which is what makes the fallback observable.
        expect(zeroWidth.headLengthRatio).not.toBe(thousand.headLengthRatio);
    });
});

// ============================================================================
// _applyAirmobileFromHandle
// ============================================================================

describe('AddArrowGeometry._applyAirmobileFromHandle', () => {
    it('normaliza a posição pela razão distância/comprimento', () => {
        turfState.length = 10;
        turfState.nearestLocation = 5;
        const props = {};
        geom._applyAirmobileFromHandle(props, [[0, 0], [1, 1]], [0, 0]);
        expect(props.airmobilePosition).toBe(0.5);
    });

    it('clampa nas duas pontas em [0.01, 0.99]', () => {
        turfState.length = 10;
        turfState.nearestLocation = 0;
        const start = {};
        geom._applyAirmobileFromHandle(start, [[0, 0], [1, 1]], [0, 0]);
        expect(start.airmobilePosition).toBe(0.01);

        turfState.nearestLocation = 10;
        const end = {};
        geom._applyAirmobileFromHandle(end, [[0, 0], [1, 1]], [0, 0]);
        expect(end.airmobilePosition).toBe(0.99);
    });
});

describe('CONSERTADO: _applyAirmobileFromHandle gravava NaN em linha de comprimento zero', () => {
    // 0/0 is NaN, and `Math.max(0.01, Math.min(0.99, NaN))` is NaN, not 0.01: neither
    // Math.min nor Math.max sanitizes it. The clamp read like a guard and was not one.
    // The RATIO is now guarded before the clamp, falling back to the 0.5 that
    // `createAirmobileHandle` already uses as its default position.
    const zeroLengthLine = () => {
        turfState.length = 0;
        turfState.nearestLocation = 0;
    };

    it('CONTROLE: com comprimento não nulo o mesmo caminho clampa corretamente', () => {
        turfState.length = 10;
        turfState.nearestLocation = 0;
        const props = {};
        geom._applyAirmobileFromHandle(props, [[0, 0], [1, 1]], [0, 0]);
        expect(props.airmobilePosition).toBe(0.01);
    });

    it('continua dentro de [0.01, 0.99] em linha degenerada (antes gravava NaN)', () => {
        zeroLengthLine();
        const props = {};
        geom._applyAirmobileFromHandle(props, [[0, 0], [0, 0]], [0, 0]);
        expect(Number.isFinite(props.airmobilePosition)).toBe(true);
        // Absolute anchor: the fallback is the midpoint, not a clamp boundary, so a
        // future change that silently returned 0.01 or 0.99 here would be caught.
        expect(props.airmobilePosition).toBe(0.5);
        turfState.length = 500;
        turfState.nearestLocation = 5;
    });

    it('a distância não-finita também cai no meio, sem virar NaN', () => {
        turfState.length = 10;
        turfState.nearestLocation = NaN;
        const props = {};
        geom._applyAirmobileFromHandle(props, [[0, 0], [1, 1]], [0, 0]);
        expect(props.airmobilePosition).toBe(0.5);
        turfState.length = 500;
        turfState.nearestLocation = 5;
    });
});

// ============================================================================
// updateFromHandle — which branches guard their index
// ============================================================================

describe('AddArrowGeometry.updateFromHandle', () => {
    it('vertex move a coordenada do índice pedido', () => {
        const out = geom.updateFromHandle('vertex', [9, 9], arrowFeature(), 1);
        expect(out.properties.baseCoordinates).toEqual([[0, 0], [9, 9], [2, 0]]);
    });

    it('midpoint insere DEPOIS do índice pedido', () => {
        const out = geom.updateFromHandle('midpoint', [9, 9], arrowFeature(), 0);
        expect(out.properties.baseCoordinates).toEqual([[0, 0], [9, 9], [1, 0], [2, 0]]);
    });

    it('não muta a feição de entrada', () => {
        const feature = arrowFeature();
        geom.updateFromHandle('vertex', [9, 9], feature, 1);
        expect(feature.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [2, 0]]);
    });

    it('recusa handleType ausente', () => {
        expect(geom.updateFromHandle(null, [9, 9], arrowFeature(), 0)).toBeNull();
        expect(geom.updateFromHandle('', [9, 9], arrowFeature(), 0)).toBeNull();
    });

    it('recusa quando restam menos de 2 coordenadas', () => {
        expect(geom.updateFromHandle('vertex', [9, 9], arrowFeature({ baseCoordinates: [[0, 0]] }), 0)).toBeNull();
    });

    it('o ramo MODERNO de vertex guarda as duas pontas do índice', () => {
        const low = geom.updateFromHandle('vertex', [9, 9], arrowFeature(), -1);
        expect(low.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [2, 0]]);
        expect(Object.prototype.hasOwnProperty.call(low.properties.baseCoordinates, '-1')).toBe(false);

        const high = geom.updateFromHandle('vertex', [9, 9], arrowFeature(), 3);
        expect(high.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [2, 0]]);
    });

    it('handleType desconhecido NÃO é recusado: devolve as propriedades intactas e regenera', () => {
        // Documented divergence from the boundary tool, which returns null for an
        // unknown handle. `calculatePreview` inherits it: there is no allowlist.
        const out = geom.updateFromHandle('handle-que-nao-existe', [9, 9], arrowFeature(), 0);
        expect(out).not.toBeNull();
        expect(out.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [2, 0]]);
        expect(out.geometry.type).toBe('Polygon');
    });
});

describe('CONSERTADO: o ramo LEGADO `vertex-N` não conferia limite nenhum', () => {
    // The modern branch checks `handleIndex >= 0 && handleIndex < coords.length`. The
    // legacy string branch (`vertex-N` / `midpoint-N`) parsed N and assigned straight
    // into the array, so an out-of-range N grew a SPARSE array with holes. It now
    // carries the SAME bounds as the modern branch.

    it('CONTROLE: o mesmo ramo legado funciona para um índice dentro do intervalo', () => {
        const out = geom.updateFromHandle('vertex-1', [9, 9], arrowFeature());
        expect(out.properties.baseCoordinates).toEqual([[0, 0], [9, 9], [2, 0]]);
        const mid = geom.updateFromHandle('midpoint-0', [9, 9], arrowFeature());
        expect(mid.properties.baseCoordinates).toEqual([[0, 0], [9, 9], [1, 0], [2, 0]]);
    });

    it('ignora `vertex-99` (antes criava um array esparso de 100 posições)', () => {
        const out = geom.updateFromHandle('vertex-99', [9, 9], arrowFeature());
        const coords = out.properties.baseCoordinates;
        expect(coords.length).toBe(3);
        expect(coords).toEqual([[0, 0], [1, 0], [2, 0]]);
    });

    it('ignora `vertex-abc` (NaN); antes escrevia na chave "NaN"', () => {
        const out = geom.updateFromHandle('vertex-abc', [9, 9], arrowFeature());
        expect(Object.prototype.hasOwnProperty.call(out.properties.baseCoordinates, 'NaN')).toBe(false);
        expect(out.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [2, 0]]);
    });

    it('o ramo legado de midpoint também guarda as duas pontas', () => {
        // `midpoint-2` on a 3-vertex arrow would append past the last segment.
        expect(geom.updateFromHandle('midpoint-2', [9, 9], arrowFeature()).properties.baseCoordinates)
            .toEqual([[0, 0], [1, 0], [2, 0]]);
        expect(geom.updateFromHandle('midpoint-abc', [9, 9], arrowFeature()).properties.baseCoordinates)
            .toEqual([[0, 0], [1, 0], [2, 0]]);
    });
});

// ============================================================================
// GOLDEN da seta de UMA cabeça
// ----------------------------------------------------------------------------
// Gravados com a árvore da seta LIMPA, ANTES de `doubleHeaded` existir. Eles não
// afirmam que a geometria está CERTA: o stub é planar e o sinal do `lineOffset`
// dele é o INVERSO do turf real, então nada aqui é evidência sobre geodesia.
// Eles afirmam que ela não MUDOU. São o controle negativo da refatoração que
// extraiu `computeHeadPoints` e `resolveHeadLengths` de dentro dos dois
// geradores: qualquer desvio numérico no caminho SEM a flag (que é o caminho de
// toda seta que já existe no disco de alguém) aparece aqui como diff de
// snapshot, e não como um bug de desenho descoberto meses depois.
//
// Se um destes falhar, a pergunta não é "atualizo o snapshot?": é qual seta
// existente passou a ser desenhada de outro jeito.
// ============================================================================

describe('GOLDEN: a seta de uma cabeça é byte a byte a de antes', () => {
    beforeEach(() => {
        // O estado do stub é de módulo e os blocos anteriores o mutam. Fixá-lo
        // aqui é o que torna estes quatro casos independentes da ordem.
        turfState.bearing = 90;
        turfState.tipBearing = null;
        turfState.length = 500;
        globalThis.turf.__resetBearingCalls();
    });

    it('reta de três vértices', () => {
        expect(geom.generateSingleArrow([[0, 0], [1, 0], [2, 0]], { width: 1000, headLengthRatio: 1.5 }))
            .toMatchInlineSnapshot(`
              {
                "coordinates": [
                  [
                    [
                      0,
                      500,
                    ],
                    [
                      1,
                      500,
                    ],
                    [
                      2,
                      500,
                    ],
                    [
                      1252,
                      180,
                    ],
                    [
                      3752,
                      90,
                    ],
                    [
                      1252,
                      0,
                    ],
                    [
                      2,
                      -500,
                    ],
                    [
                      1,
                      -500,
                    ],
                    [
                      0,
                      -500,
                    ],
                    [
                      0,
                      500,
                    ],
                  ],
                ],
                "type": "Polygon",
              }
            `);
    });

    it('eixo em "V"', () => {
        expect(geom.generateSingleArrow([[0, 0], [1, 1], [2, 0]], { width: 800 }))
            .toMatchInlineSnapshot(`
              {
                "coordinates": [
                  [
                    [
                      0,
                      400,
                    ],
                    [
                      1,
                      401,
                    ],
                    [
                      2,
                      400,
                    ],
                    [
                      1002,
                      180,
                    ],
                    [
                      3002,
                      90,
                    ],
                    [
                      1002,
                      0,
                    ],
                    [
                      2,
                      -400,
                    ],
                    [
                      1,
                      -399,
                    ],
                    [
                      0,
                      -400,
                    ],
                    [
                      0,
                      400,
                    ],
                  ],
                ],
                "type": "Polygon",
              }
            `);
    });

    it('sem cabeça (`showArrowHead: false`)', () => {
        expect(geom.generateSingleArrow([[0, 0], [1, 0], [2, 0]], { width: 1000, showArrowHead: false }))
            .toMatchInlineSnapshot(`
              {
                "coordinates": [
                  [
                    [
                      0,
                      500,
                    ],
                    [
                      1,
                      500,
                    ],
                    [
                      2,
                      500,
                    ],
                    [
                      2,
                      -500,
                    ],
                    [
                      1,
                      -500,
                    ],
                    [
                      0,
                      -500,
                    ],
                    [
                      0,
                      500,
                    ],
                  ],
                ],
                "type": "Polygon",
              }
            `);
    });

    it('largura negativa', () => {
        expect(geom.generateSingleArrow([[0, 0], [1, 0], [2, 0]], { width: -1000 }))
            .toMatchInlineSnapshot(`
              {
                "coordinates": [
                  [
                    [
                      0,
                      500,
                    ],
                    [
                      1,
                      500,
                    ],
                    [
                      2,
                      500,
                    ],
                    [
                      1252,
                      180,
                    ],
                    [
                      3752,
                      90,
                    ],
                    [
                      1252,
                      0,
                    ],
                    [
                      2,
                      -500,
                    ],
                    [
                      1,
                      -500,
                    ],
                    [
                      0,
                      -500,
                    ],
                    [
                      0,
                      500,
                    ],
                  ],
                ],
                "type": "Polygon",
              }
            `);
    });
});

// ============================================================================
// resolveHeadLengths — aritmética pura, SEM turf
// ----------------------------------------------------------------------------
// Ela recebe o comprimento do eixo como NÚMERO justamente para poder ser medida
// aqui sem stub nenhum: quem chama `turf.length` é o gerador, dentro do ternário
// da flag. As duas propriedades que valem: sem a flag o nominal sobrevive
// intocado (é o caminho de toda seta que já existe), e com a flag as duas
// cabeças somadas nunca passam do eixo.
// ============================================================================

describe('AddArrowGeometry.resolveHeadLengths', () => {
    it('sem a flag devolve o nominal e cauda ZERO', () => {
        expect(geom.resolveHeadLengths(10000, 3750, false)).toEqual({ headLength: 3750, tailLength: 0 });
    });

    it('sem a flag ignora o eixo, inclusive um eixo absurdo', () => {
        // Um eixo de 1 m NÃO encolhe a cabeça de uma seta de uma ponta só: o
        // clamp é orçamento das DUAS cabeças e não existe fora da flag.
        expect(geom.resolveHeadLengths(1, 3750, false)).toEqual({ headLength: 3750, tailLength: 0 });
    });

    it('com a flag, cabeças que cabem no eixo ficam nominais', () => {
        // 3750 * 2 = 7500 <= 100000: nada a repartir.
        expect(geom.resolveHeadLengths(100000, 3750, true)).toEqual({ headLength: 3750, tailLength: 3750 });
    });

    it('com a flag, cabeças que não cabem encolhem JUNTAS até o eixo', () => {
        // 3750 * 2 = 7500 > 5000 → escala 2/3 nas duas.
        expect(geom.resolveHeadLengths(5000, 3750, true)).toEqual({ headLength: 2500, tailLength: 2500 });
        // Absoluto que não depende da escala: a soma é exatamente o eixo.
        const { headLength, tailLength } = geom.resolveHeadLengths(5000, 3750, true);
        expect(headLength + tailLength).toBe(5000);
    });

    it('a fronteira exata (soma == eixo) NÃO encolhe', () => {
        expect(geom.resolveHeadLengths(7500, 3750, true)).toEqual({ headLength: 3750, tailLength: 3750 });
    });

    it('eixo zero ou negativo não divide por zero nem devolve NaN', () => {
        for (const axis of [0, -0, -1000]) {
            const out = geom.resolveHeadLengths(axis, 3750, true);
            expect(Number.isFinite(out.headLength)).toBe(true);
            expect(Number.isFinite(out.tailLength)).toBe(true);
            expect(out).toEqual({ headLength: 3750, tailLength: 3750 });
        }
    });

    it('eixo não-finito cai no ramo sem clamp em vez de propagar NaN', () => {
        for (const axis of [NaN, Infinity, -Infinity, undefined, null]) {
            expect(geom.resolveHeadLengths(axis, 3750, true)).toEqual({ headLength: 3750, tailLength: 3750 });
        }
    });

    it('PROPRIEDADE: sem a flag o nominal sobrevive para QUALQUER eixo', () => {
        fc.assert(fc.property(
            fc.oneof(
                fc.double(),
                fc.constantFrom(0, -0, NaN, Infinity, -Infinity, -1),
            ),
            fc.double({ min: 0, max: 1e6, noNaN: true }),
            (axis, nominal) => {
                const out = geom.resolveHeadLengths(axis, nominal, false);
                expect(out.headLength).toBe(nominal);
                expect(out.tailLength).toBe(0);
            },
        ));
    });

    it('PROPRIEDADE: com a flag e eixo finito positivo, as duas cabeças cabem no eixo', () => {
        fc.assert(fc.property(
            fc.double({ min: 1e-3, max: 1e7, noNaN: true }),
            fc.double({ min: 0, max: 1e7, noNaN: true }),
            (axis, nominal) => {
                const { headLength, tailLength } = geom.resolveHeadLengths(axis, nominal, true);
                expect(headLength).toBe(tailLength);
                // As duas cabeças somadas nunca passam do eixo. A folga relativa é
                // de ponto flutuante: `budget / total` não fecha exato em binário.
                expect(headLength + tailLength).toBeLessThanOrEqual(axis * (1 + 1e-9));
                expect(Number.isNaN(headLength)).toBe(false);
            },
        ));
    });
});

// ============================================================================
// generate — a flag `doubleHeaded`
// ----------------------------------------------------------------------------
// Sob o stub planar. O que se prende aqui é ESTRUTURA (quantos vértices, em que
// ordem, ancorados em qual ponta e com qual rumo), nunca forma: o sinal do
// `lineOffset` do stub é o inverso do turf real, então a ausência de gravata
// borboleta é medida em `arrow-geometry-turf-real.test.js`, com turf de verdade.
// ============================================================================

describe('AddArrowGeometry.generate — doubleHeaded', () => {
    const straight = [[0, 0], [1, 0], [2, 0]];

    beforeEach(() => {
        turfState.bearing = 90;
        turfState.tipBearing = null;
        // Eixo largo: as duas cabeças cabem, então o clamp fica FORA do caminho
        // e cada caso mede uma coisa só.
        turfState.length = 100000;
        globalThis.turf.__resetBearingCalls();
    });

    const ring = (props) => geom.generateSingleArrow(straight, { width: 1000, ...props }).coordinates[0];

    it('acrescenta EXATAMENTE três vértices à seta reta', () => {
        expect(ring({ doubleHeaded: true }).length - ring({}).length).toBe(3);
    });

    it('a cauda é ancorada no PRIMEIRO vértice e usa o rumo do segmento INVERTIDO', () => {
        // O stub devolve `tipBearing` na SEGUNDA chamada de `bearing`, que é
        // exatamente `bearing(coords[1], coords[0])`. Se a cauda reusasse o rumo
        // da cabeça, estes três números seriam outros.
        turfState.tipBearing = 270;
        globalThis.turf.__resetBearingCalls();

        const coords = ring({ doubleHeaded: true });
        const tail = coords.slice(-4, -1);

        // `destination` do stub codifica os próprios argumentos: [x + dist, y + brg].
        // Âncora [0, 0], meia base 1250, cauda nominal 2500 * 1.5 = 3750.
        expect(tail).toEqual([
            [1250, 360],   // cornerRight: 270 + 90
            [3750, 270],   // tip: rumo da cauda, comprimento nominal
            [1250, 180],   // cornerLeft: 270 - 90
        ]);
    });

    it('a ordem é cornerRight, tip, cornerLeft (o mesmo do bico, espelhado)', () => {
        turfState.tipBearing = 270;
        globalThis.turf.__resetBearingCalls();

        const coords = ring({ doubleHeaded: true });
        const [cornerRight, tip, cornerLeft] = coords.slice(-4, -1);

        // O que a ordem significa no stub: os dois cantos estão à mesma distância
        // da âncora e o bico está mais longe, no rumo da cauda.
        expect(cornerRight[0]).toBe(cornerLeft[0]);
        expect(tip[1]).toBe(270);
        expect(cornerRight[1] - 270).toBe(90);
        expect(cornerLeft[1] - 270).toBe(-90);
    });

    it('o anel continua fechado', () => {
        const coords = ring({ doubleHeaded: true });
        expect(coords[0]).toEqual(coords[coords.length - 1]);
    });

    it('`showArrowHead: false` é o toggle MESTRE: nem bico nem cauda', () => {
        const off = ring({ doubleHeaded: true, showArrowHead: false });
        expect(off).toEqual(ring({ showArrowHead: false }));
        // Absoluto: um corpo de três vértices vira anel de 3 + 3 + 1.
        expect(off.length).toBe(7);
    });

    it('largura negativa: a cauda usa o módulo, como o bico', () => {
        turfState.tipBearing = 270;
        globalThis.turf.__resetBearingCalls();
        const negative = ring({ width: -1000, doubleHeaded: true }).slice(-4, -1);

        turfState.tipBearing = 270;
        globalThis.turf.__resetBearingCalls();
        const positive = ring({ width: 1000, doubleHeaded: true }).slice(-4, -1);

        expect(negative).toEqual(positive);
    });

    it('eixo em "V" também ganha os três vértices', () => {
        const v = [[0, 0], [1, 1], [2, 0]];
        const withFlag = geom.generateSingleArrow(v, { width: 800, doubleHeaded: true }).coordinates[0];
        globalThis.turf.__resetBearingCalls();
        const without = geom.generateSingleArrow(v, { width: 800 }).coordinates[0];
        expect(withFlag.length - without.length).toBe(3);
    });

    it('o clamp encurta as DUAS cabeças quando somadas passariam do eixo', () => {
        // Eixo 5000 contra nominal 3750 cada: escala 2/3, as duas viram 2500.
        turfState.length = 5000;
        turfState.tipBearing = 270;
        globalThis.turf.__resetBearingCalls();

        const coords = ring({ doubleHeaded: true });
        // Anel de 13: 0..2 corpo esquerdo, 3..5 bico, 6..8 corpo direito,
        // 9..11 cauda, 12 fechamento.
        const headTip = coords[4];
        const tailTip = coords[10];

        // Bico: âncora [2, 0], rumo 90 (primeira chamada de bearing).
        expect(headTip).toEqual([2 + 2500, 90]);
        // Cauda: âncora [0, 0], rumo 270 (segunda chamada).
        expect(tailTip).toEqual([2500, 270]);
    });

    it('o clamp NÃO morde a seta de uma cabeça só (eixo curtíssimo)', () => {
        turfState.length = 1;
        globalThis.turf.__resetBearingCalls();
        const coords = ring({});
        // Bico nominal intocado: 2500 * 1.5 = 3750, âncora [2, 0], rumo 90.
        expect(coords[4]).toEqual([2 + 3750, 90]);
    });

    it('sem a flag o eixo NUNCA é medido (`turf.length` fica no ternário)', () => {
        const original = globalThis.turf.length;
        let calls = 0;
        globalThis.turf.length = (...args) => { calls++; return original(...args); };
        try {
            geom.generateSingleArrow(straight, { width: 1000 });
            expect(calls).toBe(0);

            globalThis.turf.__resetBearingCalls();
            geom.generateSingleArrow(straight, { width: 1000, doubleHeaded: true });
            expect(calls).toBe(1);
        } finally {
            globalThis.turf.length = original;
        }
    });
});

describe('AddArrowGeometry.generate — a flag é ESTRITAMENTE `=== true`', () => {
    const straight = [[0, 0], [1, 0], [2, 0]];

    beforeEach(() => {
        turfState.bearing = 90;
        turfState.tipBearing = null;
        turfState.length = 100000;
        globalThis.turf.__resetBearingCalls();
    });

    it('ausente, false, undefined, null, 0, 1 e "sim" dão a MESMA seta', () => {
        // O par que importa é 1 e "sim": um `Boolean(x)` aqui ligaria a cauda
        // para o dado que voltasse do jsonb com outra forma, e ninguém saberia.
        const baseline = JSON.stringify(geom.generateSingleArrow(straight, { width: 1000 }));

        for (const value of [false, undefined, null, 0, 1, 'sim', '', 'true']) {
            globalThis.turf.__resetBearingCalls();
            const out = geom.generateSingleArrow(straight, { width: 1000, doubleHeaded: value });
            expect(JSON.stringify(out)).toBe(baseline);
        }
    });

    it('CONTROLE: o booleano `true` de fato muda a saída', () => {
        const baseline = JSON.stringify(geom.generateSingleArrow(straight, { width: 1000 }));
        globalThis.turf.__resetBearingCalls();
        expect(JSON.stringify(geom.generateSingleArrow(straight, { width: 1000, doubleHeaded: true })))
            .not.toBe(baseline);
    });
});

describe('AddArrowGeometry.generate — doubleHeaded em entrada degenerada', () => {
    beforeEach(() => {
        turfState.bearing = 90;
        turfState.tipBearing = null;
        turfState.length = 100000;
        globalThis.turf.__resetBearingCalls();
    });

    it('menos de dois vértices continua recusando, com ou sem a flag', () => {
        expect(geom.generateSingleArrow([[0, 0]], { width: 1000, doubleHeaded: true })).toBeNull();
        expect(geom.generateSingleArrow([], { width: 1000, doubleHeaded: true })).toBeNull();
    });

    it('dois vértices COINCIDENTES não produzem NaN nenhum', () => {
        turfState.length = 0;
        const out = geom.generateSingleArrow([[5, 5], [5, 5]], { width: 1000, doubleHeaded: true });
        const flat = out.coordinates[0].flat();
        expect(flat.length).toBeGreaterThan(0);
        expect(flat.every((n) => Number.isFinite(n))).toBe(true);
    });
});

// ============================================================================
// createCrossedPolygonsWithHead — o aeromóvel, medido DIRETO
// ----------------------------------------------------------------------------
// Por que direto e não por `generateSingleArrow({ airmobile: true })`: o stub não
// tem `lineSlice` nem `lineIntersect`, então o caminho aeromóvel inteiro cai no
// `catch` e volta como seta normal. A montagem dos dois polígonos, porém, é pura
// (recebe linhas e pontos prontos), e é o que decide EM QUAL metade a cauda entra.
// O aeromóvel de ponta a ponta está em `arrow-geometry-turf-real.test.js`.
// ============================================================================

describe('AddArrowGeometry.createCrossedPolygonsWithHead', () => {
    const line = (coords) => ({ geometry: { coordinates: coords } });
    const left1 = line([[0, 1], [1, 1]]);
    const left2 = line([[1, 1], [2, 1]]);
    const right1 = line([[0, -1], [1, -1]]);
    const right2 = line([[1, -1], [2, -1]]);
    const handle = [1, 0];
    const head = { cornerRight: [9, 1], tip: [10, 0], cornerLeft: [9, -1] };
    const tail = { cornerRight: [-9, -1], tip: [-10, 0], cornerLeft: [-9, 1] };

    it('CONTROLE: sem cauda, os dois polígonos são os de sempre', () => {
        const out = geom.createCrossedPolygonsWithHead(left1, left2, right1, right2, handle, head);
        expect(out.type).toBe('MultiPolygon');
        expect(out.coordinates[0][0]).toEqual([[0, 1], handle, [0, -1], [0, 1]]);
        expect(out.coordinates[1][0]).toEqual([[2, 1], [9, 1], [10, 0], [9, -1], [2, -1], handle, [2, 1]]);
    });

    it('a cauda entra no polígono 1 (a metade TRASEIRA), antes do fechamento', () => {
        const out = geom.createCrossedPolygonsWithHead(left1, left2, right1, right2, handle, head, tail);
        expect(out.coordinates[0][0]).toEqual([
            [0, 1], handle, [0, -1],
            [-9, -1], [-10, 0], [-9, 1],   // cornerRight, tip, cornerLeft
            [0, 1],
        ]);
    });

    it('o polígono 2 (a metade da FRENTE) fica idêntico', () => {
        const semCauda = geom.createCrossedPolygonsWithHead(left1, left2, right1, right2, handle, head);
        const comCauda = geom.createCrossedPolygonsWithHead(left1, left2, right1, right2, handle, head, tail);
        expect(comCauda.coordinates[1]).toEqual(semCauda.coordinates[1]);
        expect(comCauda.coordinates[0][0].length - semCauda.coordinates[0][0].length).toBe(3);
    });

    it('`null` e ausente são o mesmo (o default é o desligado)', () => {
        const ausente = geom.createCrossedPolygonsWithHead(left1, left2, right1, right2, handle, head);
        const nulo = geom.createCrossedPolygonsWithHead(left1, left2, right1, right2, handle, head, null);
        expect(nulo).toEqual(ausente);
    });
});

describe('AddArrowGeometry — o socorro do aeromóvel carrega a flag', () => {
    // O `catch` de `generateAirmobileArrowGeometry` refaz a seta pelo caminho
    // normal. Se ele esquecesse `doubleHeaded`, a seta de duas pontas perderia a
    // cauda EXATAMENTE quando a geometria cruzada falhasse, sem um erro na tela.
    // O stub não tem `lineSlice`, então este é o caminho que ele exercita.
    beforeEach(() => {
        turfState.bearing = 90;
        turfState.tipBearing = null;
        turfState.length = 100000;
        globalThis.turf.__resetBearingCalls();
    });

    it('cai no caminho normal e ainda desenha a cauda', () => {
        const semFlag = geom.generateSingleArrow([[0, 0], [1, 0], [2, 0]], { width: 1000, airmobile: true });
        globalThis.turf.__resetBearingCalls();
        const comFlag = geom.generateSingleArrow([[0, 0], [1, 0], [2, 0]], { width: 1000, airmobile: true, doubleHeaded: true });

        expect(semFlag.type).toBe('Polygon');
        expect(comFlag.coordinates[0].length - semFlag.coordinates[0].length).toBe(3);
    });
});

describe('AddArrowGeometry.generateMergedGeometry — doubleHeaded por RAMO', () => {
    beforeEach(() => {
        turfState.bearing = 90;
        turfState.tipBearing = null;
        turfState.length = 100000;
        globalThis.turf.__resetBearingCalls();
    });

    it('só o ramo com a flag ganha a cauda', () => {
        // O stub não tem `turf.union`, então a combinação cai no fallback de
        // MultiPolygon, que é o que deixa cada ramo legível separadamente.
        const merged = geom.generate(null, {
            isMerged: true,
            width: 1000,
            branches: [
                { baseCoordinates: [[0, 0], [1, 0], [2, 0]], doubleHeaded: true },
                { baseCoordinates: [[0, 0], [1, 0], [2, 0]] },
            ],
        });

        expect(merged.type).toBe('MultiPolygon');
        expect(merged.coordinates[0][0].length - merged.coordinates[1][0].length).toBe(3);
    });

    it('o valor do TOPO não vaza para um ramo que não o declara', () => {
        // `generateMergedGeometry` lê `branch.doubleHeaded === true` e não faz
        // `branch.X || properties.X` como faz com largura: ligar no topo sem
        // escrever nos ramos não pode ligar a cauda de ninguém.
        const merged = geom.generate(null, {
            isMerged: true,
            width: 1000,
            doubleHeaded: true,
            branches: [
                { baseCoordinates: [[0, 0], [1, 0], [2, 0]] },
                { baseCoordinates: [[0, 0], [1, 0], [2, 0]] },
            ],
        });
        expect(merged.coordinates[0][0].length).toBe(merged.coordinates[1][0].length);
    });
});

// ============================================================================
// createSingleHandles — a alça de comprimento de cabeça
// ----------------------------------------------------------------------------
// Risco 4 do plano: quando o clamp morde, a alça desenhada no bico NOMINAL fica
// fora da seta e o arrasto seguinte parece grudento, porque
// `_applyHeadLengthFromHandle` não sabe do clamp.
// ============================================================================

describe('AddArrowGeometry.createSingleHandles — alça headLength e o clamp', () => {
    const handleFor = (props) => {
        globalThis.turf.__resetBearingCalls();
        const feature = {
            type: 'Feature',
            properties: { id: 'a1', baseCoordinates: [[0, 0], [2, 0]], width: 1000, ...props },
        };
        return geom.createSingleHandles(feature).find((h) => h.properties.handleType === 'headLength');
    };

    beforeEach(() => {
        turfState.bearing = 90;
        turfState.tipBearing = null;
        turfState.length = 100000;
    });

    it('sem a flag a alça fica no bico NOMINAL', () => {
        // `destination([2, 0], 2500 * 1.5, 90)` no stub → [2 + 3750, 0 + 90].
        expect(handleFor({}).geometry.coordinates).toEqual([3752, 90]);
    });

    it('com a flag e eixo folgado a alça também fica no nominal', () => {
        expect(handleFor({ doubleHeaded: true }).geometry.coordinates).toEqual([3752, 90]);
    });

    it('com a flag e eixo apertado a alça SEGUE o bico encurtado', () => {
        turfState.length = 5000;
        expect(handleFor({ doubleHeaded: true }).geometry.coordinates).toEqual([2502, 90]);
    });

    it('`showArrowHead: false` continua sem alça de comprimento, com ou sem a flag', () => {
        expect(handleFor({ showArrowHead: false, doubleHeaded: true })).toBeUndefined();
    });
});

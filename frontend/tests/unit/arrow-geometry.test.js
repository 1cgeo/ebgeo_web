// Path: tests/unit/arrow-geometry.test.js

/**
 * @fileoverview Pure-logic suite for `AddArrowGeometry`
 * (`src/js/military_tools/arrow_tool/add_arrow_geometry.js`), domain `mil-arrow`
 * of `tests/TESTING-BACKLOG.md`.
 *
 * WHAT IT PINS
 * - `normalizeBaseCoordinates`: the four input shapes (array by reference, JSON
 *   string, malformed string, non-array) and the fact that a JSON scalar escapes
 *   as a scalar.
 * - `removeVertexAtIndex`: bounds, the two-vertex floor, immutability of the input.
 * - `validate`: the 10 m floor is measured against the REAL haversine of
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
 *
 * WHAT IT DOES NOT REACH
 * - Anything that needs real turf: the polygon SHAPE of a generated arrow is only
 *   asserted structurally (vertex count, closed ring, ordering of the head
 *   points), never metrically. `lineOffset`, `destination` and `bearing` are
 *   planar stubs, so no statement here is evidence about geodesy.
 * - `generateAirmobileArrowGeometry` / `createCrossedPolygons*`, `createHandles`,
 *   `createMergedHandles`, `createAirmobileHandle`, `getBoundingBox` and
 *   `generateMergedGeometry`: those are turf-shape orchestration, not pure logic.
 * - `isPointTooClose` (thin wrapper over the same haversine as `validate`).
 * - `extractBranches` and the merge/split gates live in `arrow-merge.test.js`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

describe('DEFEITO: normalizeBaseCoordinates deixa escapar o escalar de um JSON válido', () => {
    // The string branch returns `JSON.parse(...)` with no shape check, so any valid
    // JSON scalar or object leaves the function pretending to be a coordinate list.
    // Measured: `'42'` -> 42, `'null'` -> null, `'{}'` -> {}. Downstream,
    // `coords.length < 2` is `undefined < 2` === false for 42, so the length guard
    // does NOT fire and an invalid GeoJSON reaches the caller (next block).

    it('CONTROLE: a função é alcançável e discrimina (string boa devolve o array)', () => {
        expect(geom.normalizeBaseCoordinates('[[0,0],[1,1]]')).toEqual([[0, 0], [1, 1]]);
        expect(geom.normalizeBaseCoordinates('lixo')).toEqual([]);
    });

    it('comportamento OBSERVADO hoje: escalares e objetos passam intactos', () => {
        expect(geom.normalizeBaseCoordinates('42')).toBe(42);
        expect(geom.normalizeBaseCoordinates('null')).toBeNull();
        expect(geom.normalizeBaseCoordinates('{}')).toEqual({});
    });

    it.fails('DEVERIA sempre devolver um array (hoje devolve o escalar 42)', () => {
        expect(Array.isArray(geom.normalizeBaseCoordinates('42'))).toBe(true);
    });
});

describe('DEFEITO: o escalar que escapa vira geometria GeoJSON inválida', () => {
    it('CONTROLE: entrada boa produz um Polygon com anel fechado', () => {
        const g = geom.generateSingleArrow([[0, 0], [1, 0], [2, 0]], { width: 1000 });
        expect(g.type).toBe('Polygon');
        expect(g.coordinates[0][0]).toEqual(g.coordinates[0][g.coordinates[0].length - 1]);
    });

    it.fails("DEVERIA recusar baseCoordinates '42' (hoje emite LineString com coordinates: 42)", () => {
        const g = geom.generateSingleArrow('42', { width: 1000 });
        expect(g === null || Array.isArray(g.coordinates)).toBe(true);
    });

    it('OBSERVADO: a saída é {type:"LineString", coordinates: 42}', () => {
        expect(geom.generateSingleArrow('42', { width: 1000 }))
            .toEqual({ type: 'LineString', coordinates: 42 });
    });

    it.fails("DEVERIA recusar baseCoordinates 'null' (hoje lança TypeError fora do try)", () => {
        expect(() => geom.generateSingleArrow('null', { width: 1000 })).not.toThrow();
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

describe('DEFEITO: removeVertexAtIndex aceita índice não-inteiro', () => {
    // `index < 0` and `index >= length` are both false for NaN, so the guard lets it
    // through and `Array.prototype.splice` coerces NaN to 0: the FIRST vertex is
    // deleted instead of nothing. `x ?? 0` would not have helped either; the guard
    // needs `Number.isInteger`.

    it('CONTROLE: o mesmo caminho recusa um índice inteiro fora do intervalo', () => {
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], 3)).toBeNull();
    });

    it.fails('DEVERIA recusar NaN (hoje apaga o vértice 0 em silêncio)', () => {
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], NaN)).toBeNull();
    });

    it('OBSERVADO: NaN apaga o primeiro vértice', () => {
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], NaN)).toEqual([[1, 1], [2, 2]]);
    });

    it('OBSERVADO: índice fracionário 1.5 é truncado para 1 pelo splice', () => {
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], 1.5)).toEqual([[0, 0], [2, 2]]);
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

describe('DEFEITO: validate aceita coordenada não-finita', () => {
    // The haversine of a NaN/Infinity pair is NaN, and `NaN < 10` is false, so the
    // "too close" test never fires. This is the classic "`x ?? 0` does not guard NaN"
    // shape: nothing in the chain asks `Number.isFinite`.

    it('CONTROLE: o mesmo predicado reprova um par finito abaixo do piso', () => {
        expect(geom.validate([[0, 0], [0, 0]])).toBe(false);
    });

    it.fails('DEVERIA recusar NaN (hoje aceita)', () => {
        expect(geom.validate([[0, 0], [NaN, NaN]])).toBe(false);
    });

    it.fails('DEVERIA recusar Infinity (hoje aceita)', () => {
        expect(geom.validate([[0, 0], [Infinity, 1]])).toBe(false);
    });

    it('OBSERVADO: os dois passam como válidos', () => {
        expect(geom.validate([[0, 0], [NaN, NaN]])).toBe(true);
        expect(geom.validate([[0, 0], [Infinity, 1]])).toBe(true);
    });

    it.fails("DEVERIA recusar o escalar de '42' (hoje aceita, sem par nenhum para medir)", () => {
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

describe('DEFEITO: _applyAirmobileFromHandle grava NaN em linha de comprimento zero', () => {
    // 0/0 is NaN, and `Math.max(0.01, Math.min(0.99, NaN))` is NaN, not 0.01: neither
    // Math.min nor Math.max sanitizes it. The clamp reads like a guard and is not one.
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

    it.fails('DEVERIA continuar dentro de [0.01, 0.99] (hoje grava NaN)', () => {
        zeroLengthLine();
        const props = {};
        geom._applyAirmobileFromHandle(props, [[0, 0], [0, 0]], [0, 0]);
        expect(Number.isFinite(props.airmobilePosition)).toBe(true);
    });

    it('OBSERVADO: airmobilePosition vira NaN', () => {
        zeroLengthLine();
        const props = {};
        geom._applyAirmobileFromHandle(props, [[0, 0], [0, 0]], [0, 0]);
        expect(Number.isNaN(props.airmobilePosition)).toBe(true);
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

describe('DEFEITO: o ramo LEGADO `vertex-N` não confere limite nenhum', () => {
    // The modern branch checks `handleIndex >= 0 && handleIndex < coords.length`.
    // The legacy string branch (`vertex-N` / `midpoint-N`) parses N and assigns
    // straight into the array, so an out-of-range N grows a SPARSE array with holes.

    it('CONTROLE: o mesmo ramo legado funciona para um índice dentro do intervalo', () => {
        const out = geom.updateFromHandle('vertex-1', [9, 9], arrowFeature());
        expect(out.properties.baseCoordinates).toEqual([[0, 0], [9, 9], [2, 0]]);
    });

    it.fails('DEVERIA ignorar `vertex-99` (hoje cria um array esparso de 100 posições)', () => {
        const out = geom.updateFromHandle('vertex-99', [9, 9], arrowFeature());
        expect(out.properties.baseCoordinates.length).toBe(3);
    });

    it('OBSERVADO: o array cresce para 100, com 97 buracos', () => {
        const out = geom.updateFromHandle('vertex-99', [9, 9], arrowFeature());
        const coords = out.properties.baseCoordinates;
        expect(coords.length).toBe(100);
        expect(coords[99]).toEqual([9, 9]);
        expect(Object.prototype.hasOwnProperty.call(coords, 50)).toBe(false);
    });

    it.fails('DEVERIA ignorar `vertex-abc` (NaN); hoje escreve na chave "NaN"', () => {
        const out = geom.updateFromHandle('vertex-abc', [9, 9], arrowFeature());
        expect(Object.prototype.hasOwnProperty.call(out.properties.baseCoordinates, 'NaN')).toBe(false);
    });
});

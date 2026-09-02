// Path: tests/unit/boundary-geometry-coordenadas-e-echelon.test.js

/**
 * @fileoverview Second suite for `AddBoundaryGeometry`
 * (`src/js/military_tools/boundary_tool/add_boundary_geometry.js`), covering the
 * `mil-boundary` rows of `tests/TESTING-BACKLOG.md` that `boundary-geometry.test.js`
 * leaves open. It is a SEPARATE file on purpose: the sibling suite owns the symbol
 * instance model (`getSymbolInstances`, `getAnchorInstance`, `createLineWithGaps`,
 * `createHandles`, the `symbol_handle` drag), and nothing here re-asserts it.
 *
 * WHAT IT PINS
 * - The THREE divergent coordinate policies that live side by side in this one file:
 *   `validate` (filter, "at least 2 survivors"), `isValidBoundary` (every) and
 *   `normalizeBaseCoordinates` (all-or-nothing, null). The same input gets three
 *   different answers, and that contrast is the point.
 * - `getBoundingBox`: the empty/all-invalid sentinel, the antimeridian span, the
 *   coercion of numeric strings and of `null`.
 * - `removeVertexAtIndex`: bounds, the two-vertex floor, immutability.
 * - `generateBoundaryGeometry`: which fallback each bad input actually reaches.
 * - `createEchelonSymbol`: the line/polygon arithmetic (2 per X, 1 per I, one polygon
 *   per o) and what an unknown character does.
 * - `generateBoundaryTexts`: the finite-guarded ratio fallback, the size fallback
 *   that now comes from the zoom model, the cap by line length, the zoom anchor
 *   the label carries, and the rotation seam at bearing 0 and 180 plus the
 *   north-facing pair.
 * - `updateFromHandle` for `vertex` and `midpoint`: the asymmetric index guards.
 *
 * WHY THE LABEL FIXTURES CARRY AN `echelon`. The label offset is `effective size
 * * ratio`, and the effective size is bounded by what the line can carry (all the
 * gaps together may take at most half of it). The cap divides by the number of
 * symbols, and a boundary with NO echelon falls back to three, which on this
 * stub's 10 km line caps at 0.926 km. Fixtures that author 2 km therefore declare
 * a single 'X', so that the numbers below measure the ratio and not the cap; the
 * cap has a block of its own.
 *
 * WHAT IT DOES NOT REACH
 * - Real geodesy. `turf.destination`, `turf.along` and `turf.bearing` are planar
 *   stubs that ENCODE their arguments, so every coordinate asserted below is a
 *   readout of what the module ASKED for, never of where a point really lands.
 * - `size_handle` and `text_distance_handle` (turf distance orchestration),
 *   `createLineWithGaps` and `createHandles` (sibling suite), `generateBoundaryCircles`
 *   and `isPointTooClose`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('@tools', () => ({
    BaseGeometry: class { constructor(properties = {}) { this.properties = { ...properties }; } },
}));

// Planar stub. `destination` and `along` encode their own arguments into the returned
// coordinate so the caller's request is observable; `bearing` is switchable because the
// text rotation seam is a function of it.
const turfState = { bearing: 90, length: 10 };
const coordOf = (p) => (p && p.geometry ? p.geometry.coordinates : p);
const pointFeature = (coords) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords } });

beforeAll(() => {
    globalThis.turf = {
        lineString: (coords) => {
            if (!Array.isArray(coords)) throw new Error('coordinates must be an array');
            return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
        },
        point: (c) => pointFeature(c),
        length: () => turfState.length,
        along: (_line, dist) => pointFeature([dist, 0]),
        bearing: () => turfState.bearing,
        destination: (p, dist, brg) => pointFeature([coordOf(p)[0] + dist, coordOf(p)[1] + brg]),
        lineSlice: (from, to) => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [coordOf(from), coordOf(to)] },
        }),
        nearestPointOnLine: () => ({ properties: { location: 5 } }),
        distance: () => 1,
        circle: (center, radius) => ({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[coordOf(center), [radius, 0], [0, radius], coordOf(center)]] },
        }),
    };
});

afterAll(() => { delete globalThis.turf; });

const { default: AddBoundaryGeometry } = await import('../../src/js/military_tools/boundary_tool/add_boundary_geometry.js');

const geom = new AddBoundaryGeometry();

const boundaryFeature = (props = {}) => ({
    type: 'Feature',
    properties: { id: 'b1', baseCoordinates: [[0, 0], [1, 0], [2, 0]], ...props },
});

// ============================================================================
// The three divergent coordinate policies
// ============================================================================

describe('AddBoundaryGeometry: as TRÊS políticas de coordenada divergem', () => {
    const oneBadVertex = [[0, 0], [1, 1], [NaN, 2]];

    it('mesma entrada, três respostas diferentes', () => {
        // `validate` filters and asks for >= 2 survivors, so a poisoned vertex passes.
        expect(geom.validate(oneBadVertex)).toBe(true);
        // `isValidBoundary` uses `every`, so it refuses.
        expect(geom.isValidBoundary(oneBadVertex)).toBe(false);
        // `normalizeBaseCoordinates` is all-or-nothing and returns null.
        expect(geom.normalizeBaseCoordinates(oneBadVertex)).toBeNull();
    });

    it('as três concordam quando TODOS os vértices são bons', () => {
        const good = [[0, 0], [1, 1]];
        expect(geom.validate(good)).toBe(true);
        expect(geom.isValidBoundary(good)).toBe(true);
        expect(geom.normalizeBaseCoordinates(good)).toBe(good);
    });

    it('as três concordam em recusar menos de 2 vértices', () => {
        expect(geom.validate([[0, 0]])).toBe(false);
        expect(geom.isValidBoundary([[0, 0]])).toBe(false);
        // ...except that normalize accepts a one-vertex array as a valid array.
        expect(geom.normalizeBaseCoordinates([[0, 0]])).toEqual([[0, 0]]);
    });

    it('propriedade: normalize devolve não-nulo exatamente quando isValidBoundary aceita, para len >= 2', () => {
        fc.assert(fc.property(
            fc.array(
                fc.oneof(
                    fc.tuple(fc.integer({ min: -180, max: 180 }), fc.integer({ min: -90, max: 90 })),
                    fc.constant([NaN, 0]),
                    fc.constant(['1', 2]),
                    fc.constant([0]),
                ),
                { minLength: 2, maxLength: 8 },
            ),
            (coords) => {
                expect(geom.normalizeBaseCoordinates(coords) !== null).toBe(geom.isValidBoundary(coords));
            },
        ), { numRuns: 250 });
    });
});

// ============================================================================
// normalizeBaseCoordinates
// ============================================================================

describe('AddBoundaryGeometry.normalizeBaseCoordinates', () => {
    it('devolve o MESMO array quando ele já é válido', () => {
        const input = [[0, 0], [1, 1]];
        expect(geom.normalizeBaseCoordinates(input)).toBe(input);
    });

    it('null, undefined e string vazia viram null (a string vazia é falsy antes do parse)', () => {
        expect(geom.normalizeBaseCoordinates(null)).toBeNull();
        expect(geom.normalizeBaseCoordinates(undefined)).toBeNull();
        expect(geom.normalizeBaseCoordinates('')).toBeNull();
    });

    it('faz parse de string JSON e recursa na validação', () => {
        expect(geom.normalizeBaseCoordinates('[[0,0],[1,1]]')).toEqual([[0, 0], [1, 1]]);
        expect(geom.normalizeBaseCoordinates('[[0,0],[null,1]]')).toBeNull();
    });

    it('JSON válido que NÃO é array vira null', () => {
        // The arrow tool used to return the scalar here; it now refuses too, with its
        // own sentinel ([] rather than null). The SENTINELS still differ, the policy
        // no longer does.
        expect(geom.normalizeBaseCoordinates('42')).toBeNull();
        expect(geom.normalizeBaseCoordinates('{"a":1}')).toBeNull();
    });

    it('JSON malformado vira null (não lança)', () => {
        expect(geom.normalizeBaseCoordinates('[[0,0]')).toBeNull();
    });

    it('array VAZIO sobrevive como array vazio (o `every` é vacuamente verdadeiro)', () => {
        expect(geom.normalizeBaseCoordinates([])).toEqual([]);
        expect(geom.normalizeBaseCoordinates('[]')).toEqual([]);
    });

    it('all-or-nothing: UM vértice ruim invalida a lista inteira', () => {
        expect(geom.normalizeBaseCoordinates([[0, 0], [1, 1], [2, 'x']])).toBeNull();
        expect(geom.normalizeBaseCoordinates([[0, 0], [1, 1], [2]])).toBeNull();
        expect(geom.normalizeBaseCoordinates([[0, 0], [1, 1], null])).toBeNull();
    });

    it('vértice com terceira componente (z) é aceito e preservado', () => {
        expect(geom.normalizeBaseCoordinates([[0, 0, 100], [1, 1, 200]])).toEqual([[0, 0, 100], [1, 1, 200]]);
    });

    it('round-trip: string JSON de coordenadas finitas volta igual', () => {
        const noNegativeZero = (x) => (Object.is(x, -0) ? 0 : x);
        fc.assert(fc.property(
            fc.array(
                fc.tuple(
                    fc.double({ min: -180, max: 180, noNaN: true }).map(noNegativeZero),
                    fc.double({ min: -90, max: 90, noNaN: true }).map(noNegativeZero),
                ),
                { minLength: 2, maxLength: 10 },
            ),
            (coords) => {
                expect(geom.normalizeBaseCoordinates(JSON.stringify(coords))).toEqual(coords);
            },
        ), { numRuns: 120 });
    });
});

describe('CONSERTADO: normalizeBaseCoordinates aceitava Infinity', () => {
    // `!isNaN(Infinity)` is false, so the old "is it a real number" test let it
    // through: `typeof` said number and NaN said no, but nothing asked
    // `Number.isFinite`. The same shape as the `validate` bugs Lote 1 fixed in
    // circle/line/polygon. The four hand-written copies of that predicate are now one
    // `AddBoundaryGeometry.isFinitePosition`.

    it('CONTROLE: o mesmo predicado recusa NaN', () => {
        expect(geom.normalizeBaseCoordinates([[0, 0], [NaN, 1]])).toBeNull();
    });

    it('recusa Infinity (antes devolvia o array)', () => {
        expect(geom.normalizeBaseCoordinates([[0, 0], [Infinity, 1]])).toBeNull();
    });

    it('recusa -Infinity (antes devolvia o array)', () => {
        expect(geom.normalizeBaseCoordinates([[0, 0], [1, -Infinity]])).toBeNull();
    });

    it('as três funções recusam Infinity em conjunto', () => {
        const withInfinity = [[0, 0], [Infinity, 1]];
        expect(geom.normalizeBaseCoordinates(withInfinity)).toBeNull();
        expect(geom.validate(withInfinity)).toBe(false);
        expect(geom.isValidBoundary(withInfinity)).toBe(false);
        // Control: the same three still ACCEPT the finite version of that list, so
        // the block above is not passing because the predicate rejects everything.
        const finite = [[0, 0], [1, 1]];
        expect(geom.normalizeBaseCoordinates(finite)).toBe(finite);
        expect(geom.validate(finite)).toBe(true);
        expect(geom.isValidBoundary(finite)).toBe(true);
    });
});

// ============================================================================
// getBoundingBox
// ============================================================================

describe('AddBoundaryGeometry.getBoundingBox', () => {
    it('calcula o retângulo envolvente', () => {
        expect(geom.getBoundingBox([[1, 5], [-3, 2], [7, -4]])).toEqual([-3, -4, 7, 5]);
    });

    it('vazio, null e todos inválidos caem no sentinel [0, 0, 0, 0]', () => {
        expect(geom.getBoundingBox([])).toEqual([0, 0, 0, 0]);
        expect(geom.getBoundingBox(null)).toEqual([0, 0, 0, 0]);
        expect(geom.getBoundingBox(undefined)).toEqual([0, 0, 0, 0]);
        expect(geom.getBoundingBox([[NaN, NaN], ['x', 'y']])).toEqual([0, 0, 0, 0]);
    });

    it('ponto único vira um retângulo degenerado, não o sentinel', () => {
        expect(geom.getBoundingBox([[3, 4]])).toEqual([3, 4, 3, 4]);
    });

    it('ignora os vértices inválidos e usa os que sobram', () => {
        expect(geom.getBoundingBox([[1, 1], [NaN, 9], [5, 5]])).toEqual([1, 1, 5, 5]);
    });

    it('antimeridiano: a caixa atravessa o globo inteiro (ingênua, por desenho)', () => {
        // 179E and 179W are 2 degrees apart on the ground; the box says 358.
        expect(geom.getBoundingBox([[179, 0], [-179, 1]])).toEqual([-179, 0, 179, 1]);
    });

    it('polos: latitude +-90 é aceita como qualquer outra', () => {
        expect(geom.getBoundingBox([[0, -90], [0, 90]])).toEqual([0, -90, 0, 90]);
    });

    it('propriedade: todo vértice válido cai DENTRO da caixa devolvida', () => {
        fc.assert(fc.property(
            fc.array(
                fc.tuple(fc.integer({ min: -180, max: 180 }), fc.integer({ min: -90, max: 90 })),
                { minLength: 1, maxLength: 20 },
            ),
            (coords) => {
                const [minLng, minLat, maxLng, maxLat] = geom.getBoundingBox(coords);
                expect(coords.length).toBeGreaterThan(0);
                for (const [lng, lat] of coords) {
                    expect(lng).toBeGreaterThanOrEqual(minLng);
                    expect(lng).toBeLessThanOrEqual(maxLng);
                    expect(lat).toBeGreaterThanOrEqual(minLat);
                    expect(lat).toBeLessThanOrEqual(maxLat);
                }
            },
        ), { numRuns: 200 });
    });

    it('propriedade: a caixa não depende da ORDEM dos vértices', () => {
        fc.assert(fc.property(
            fc.array(
                fc.tuple(fc.integer({ min: -180, max: 180 }), fc.integer({ min: -90, max: 90 })),
                { minLength: 2, maxLength: 12 },
            ),
            (coords) => {
                expect(geom.getBoundingBox([...coords].reverse())).toEqual(geom.getBoundingBox(coords));
            },
        ), { numRuns: 150 });
    });

    it('OBSERVADO: string numérica e null são COAGIDOS, não filtrados', () => {
        // `isNaN('1')` is false and `isNaN(null)` is false (Number(null) === 0), so both
        // survive the filter and reach Math.min/Math.max, where they coerce.
        expect(geom.getBoundingBox([['1', '2'], [3, 4]])).toEqual([1, 2, 3, 4]);
        expect(geom.getBoundingBox([[null, null], [null, null]])).toEqual([0, 0, 0, 0]);
        // The second line is why the sentinel is ambiguous: a list of nulls and an
        // empty list are indistinguishable in the return value.
    });

    it('OBSERVADO: entrada não-array lança TypeError em vez de devolver o sentinel', () => {
        expect(() => geom.getBoundingBox('abc')).toThrow(TypeError);
        expect(() => geom.getBoundingBox(42)).toThrow(TypeError);
    });
});

// ============================================================================
// removeVertexAtIndex
// ============================================================================

describe('AddBoundaryGeometry.removeVertexAtIndex', () => {
    const three = () => [[0, 0], [1, 1], [2, 2]];

    it('remove o vértice pedido e devolve um array novo', () => {
        const input = three();
        const out = geom.removeVertexAtIndex(input, 2);
        expect(out).toEqual([[0, 0], [1, 1]]);
        expect(out).not.toBe(input);
        expect(input).toEqual([[0, 0], [1, 1], [2, 2]]);
    });

    it('recusa índice fora do intervalo nas duas pontas', () => {
        expect(geom.removeVertexAtIndex(three(), -1)).toBeNull();
        expect(geom.removeVertexAtIndex(three(), 3)).toBeNull();
    });

    it('recusa quando sobraria menos de 2 vértices', () => {
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1]], 0)).toBeNull();
    });

    it('recusa entrada vazia ou ausente', () => {
        expect(geom.removeVertexAtIndex([], 0)).toBeNull();
        expect(geom.removeVertexAtIndex(null, 0)).toBeNull();
    });

    it('propriedade: para índice válido, sai a entrada menos aquele item, sem mutação', () => {
        fc.assert(fc.property(
            fc.array(fc.tuple(fc.integer(), fc.integer()), { minLength: 3, maxLength: 15 }),
            fc.nat(),
            (coords, rawIndex) => {
                const index = rawIndex % coords.length;
                const snapshot = JSON.stringify(coords);
                const out = geom.removeVertexAtIndex(coords, index);
                expect(out.length).toBe(coords.length - 1);
                expect(out).toEqual(coords.filter((_, i) => i !== index));
                expect(JSON.stringify(coords)).toBe(snapshot);
            },
        ), { numRuns: 200 });
    });
});

describe('CONSERTADO: removeVertexAtIndex aceitava índice não-inteiro (mesmo defeito da seta)', () => {
    it('CONTROLE: o mesmo caminho recusa um inteiro fora do intervalo', () => {
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], 5)).toBeNull();
        // ...and still accepts a valid one, so the guard did not close entirely.
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], 1)).toEqual([[0, 0], [2, 2]]);
    });

    it('recusa NaN e o fracionário (antes NaN apagava o vértice 0)', () => {
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], NaN)).toBeNull();
        expect(geom.removeVertexAtIndex([[0, 0], [1, 1], [2, 2]], 1.5)).toBeNull();
    });
});

// ============================================================================
// generateBoundaryGeometry — which fallback each bad input reaches
// ============================================================================

describe('AddBoundaryGeometry.generateBoundaryGeometry', () => {
    it('caminho feliz: MultiLineString com o traço e os símbolos', () => {
        const out = geom.generateBoundaryGeometry({
            baseCoordinates: [[0, 0], [10, 0]], symbol_size: 0.5, echelon: 'XX',
        });
        expect(out.type).toBe('MultiLineString');
        // 2 gap segments + 2 lines per X, twice: the count is what makes this assertion
        // more than "it returned something".
        expect(out.coordinates.length).toBe(2 + 4);
    });

    it('baseCoordinates null vira uma LineString degenerada em [[0,0],[0,0]]', () => {
        expect(geom.generateBoundaryGeometry({ baseCoordinates: null }))
            .toEqual({ type: 'LineString', coordinates: [[0, 0], [0, 0]] });
    });

    it('UM vértice ruim também vira [[0,0],[0,0]], porque normalize já devolveu null', () => {
        // Note which fallback is NOT reached: there used to be a second
        // `[[0,0],[1,1]]` branch guarded by a `hasValidCoords` re-check, and it was
        // dead, since normalize enforces the same predicate one step earlier and
        // returns null. It has been pruned.
        expect(geom.generateBoundaryGeometry({ baseCoordinates: [[0, 0], [NaN, 1]] }))
            .toEqual({ type: 'LineString', coordinates: [[0, 0], [0, 0]] });
        expect(geom.generateBoundaryGeometry({ baseCoordinates: 'lixo' }))
            .toEqual({ type: 'LineString', coordinates: [[0, 0], [0, 0]] });
    });

    it('um único vértice vira a LineString degenerada de UM ponto', () => {
        expect(geom.generateBoundaryGeometry({ baseCoordinates: [[5, 5]] }))
            .toEqual({ type: 'LineString', coordinates: [[5, 5]] });
    });
});

describe('CONSERTADO: lista vazia produzia uma LineString com ZERO posições', () => {
    // `[]` is truthy, so `baseCoordinates || [[0,0],[0,0]]` kept the empty array and
    // the fallback emitted `{type:'LineString', coordinates: []}`. GeoJSON requires a
    // LineString to have at least two positions, so that was malformed output, not a
    // degenerate one. The fallback now tests the LENGTH instead of the truthiness.

    it('CONTROLE: null, no mesmo ramo, produz uma LineString com duas posições', () => {
        expect(geom.generateBoundaryGeometry({ baseCoordinates: null }).coordinates.length).toBe(2);
    });

    it('emite ao menos 2 posições para a lista vazia (antes emitia 0)', () => {
        expect(geom.generateBoundaryGeometry({ baseCoordinates: [] }).coordinates.length).toBeGreaterThanOrEqual(2);
    });

    it("[] e '[]' caem no mesmo degenerado de null", () => {
        expect(geom.generateBoundaryGeometry({ baseCoordinates: [] }))
            .toEqual({ type: 'LineString', coordinates: [[0, 0], [0, 0]] });
        expect(geom.generateBoundaryGeometry({ baseCoordinates: '[]' }))
            .toEqual({ type: 'LineString', coordinates: [[0, 0], [0, 0]] });
    });

    it('LIMITE CONHECIDO: o vértice ÚNICO ainda sai com uma posição só', () => {
        // Also malformed GeoJSON, and deliberately left alone here: the only caller
        // that can produce it is a boundary mid-draw, and the sibling test above
        // ("um único vértice vira a LineString degenerada de UM ponto") pins it.
        expect(geom.generateBoundaryGeometry({ baseCoordinates: [[5, 5]] }).coordinates.length).toBe(1);
    });
});

// ============================================================================
// createEchelonSymbol
// ============================================================================

describe('AddBoundaryGeometry.createEchelonSymbol', () => {
    const center = () => pointFeature([0, 0]);

    it('cada X vira DUAS linhas cruzadas, cada I vira UMA, cada o vira UM polígono', () => {
        const cases = [
            ['X', 2, 0],
            ['XX', 4, 0],
            ['XXX', 6, 0],
            ['I', 1, 0],
            ['II', 2, 0],
            ['III', 3, 0],
            ['o', 0, 1],
            ['oo', 0, 2],
            ['XXI', 5, 0],
            ['XIo', 3, 1],
        ];
        expect(cases.length).toBe(10);
        for (const [echelon, lines, polys] of cases) {
            const out = geom.createEchelonSymbol(echelon, center(), 1, 0);
            expect(out.lines.length).toBe(lines);
            expect(out.polygons.length).toBe(polys);
        }
    });

    it('propriedade: #linhas === 2*(qtd de X) + (qtd de I) e #polígonos === (qtd de o)', () => {
        fc.assert(fc.property(
            fc.stringMatching(/^[XIo]{1,8}$/),
            (echelon) => {
                const count = (ch) => [...echelon].filter((c) => c === ch).length;
                const out = geom.createEchelonSymbol(echelon, center(), 1, 0);
                expect(out.lines.length).toBe(2 * count('X') + count('I'));
                expect(out.polygons.length).toBe(count('o'));
            },
        ), { numRuns: 200 });
    });

    it('caractere desconhecido é ignorado em silêncio (nem linha, nem polígono, nem aviso)', () => {
        const out = geom.createEchelonSymbol('zz', center(), 1, 0);
        expect(out.lines.length).toBe(0);
        expect(out.polygons.length).toBe(0);
        // ...but it still consumes a slot in the spacing, so a mixed string shifts.
        const mixed = geom.createEchelonSymbol('XzX', center(), 1, 0);
        expect(mixed.lines.length).toBe(4);
    });

    it('string vazia devolve conjuntos vazios sem lançar', () => {
        const out = geom.createEchelonSymbol('', center(), 1, 0);
        expect(out.lines.length).toBe(0);
        expect(out.polygons.length).toBe(0);
    });

    it('cada linha do X tem exatamente 2 pontos, e os dois braços são perpendiculares no pedido', () => {
        const out = geom.createEchelonSymbol('X', center(), 2, 0);
        expect(out.lines.length).toBe(2);
        for (const line of out.lines) {
            expect(line.length).toBe(2);
        }
        // The stub encodes `destination(p, dist, bearing)` as [x + dist, y + bearing], so
        // the SECOND slot reads back the bearing that was requested: +45/+225 and -45/+135.
        expect(out.lines[0].map((p) => p[1])).toEqual([45, 225]);
        expect(out.lines[1].map((p) => p[1])).toEqual([-45, 135]);
    });
});

// ============================================================================
// generateBoundaryTexts
// ============================================================================

describe('AddBoundaryGeometry.generateBoundaryTexts', () => {
    // `echelon: 'X'` is not decoration: since the label offset rides the EFFECTIVE
    // symbol size, it is bounded by the cap the line can carry, and the cap divides
    // by the number of symbols. Without an echelon the fallback is THREE symbols,
    // which on the stub's 10 km line caps the size at 0.926 km and would make every
    // offset below a readout of the cap instead of of the ratio. A single 'X' caps
    // at 2.78 km, above the 2 km these fixtures author. The cap itself is pinned in
    // `AddBoundaryGeometry.generateBoundaryTexts: teto pelo comprimento da linha`.
    const withText = (extra = {}) => boundaryFeature({
        baseCoordinates: [[0, 0], [1, 0]],
        text_top: 'CIMA', symbol_size: 2, echelon: 'X', ...extra,
    });

    it('sem texto nenhum, nada é emitido', () => {
        expect(geom.generateBoundaryTexts(boundaryFeature({ symbol_size: 2 }))).toEqual([]);
    });

    it('sem coordenadas válidas, nada é emitido', () => {
        expect(geom.generateBoundaryTexts(boundaryFeature({ baseCoordinates: null, text_top: 'X' }))).toEqual([]);
        expect(geom.generateBoundaryTexts(boundaryFeature({ baseCoordinates: [[0, 0]], text_top: 'X' }))).toEqual([]);
    });

    it('emite um texto por instância que opta por rótulo, com id indexado', () => {
        const out = geom.generateBoundaryTexts(withText({
            text_bottom: 'BAIXO',
            symbol_instances: [{ ratio: 0.2 }, { ratio: 0.8 }],
        }));
        expect(out.length).toBe(4);
        expect(out.map((f) => f.id)).toEqual([
            'b1-text-top-0', 'b1-text-bottom-0', 'b1-text-top-1', 'b1-text-bottom-1',
        ]);
    });

    it('topo e base saem em direções opostas a partir do centro', () => {
        const out = geom.generateBoundaryTexts(withText({ text_bottom: 'BAIXO', text_distance_ratio: 1 }));
        expect(out.length).toBe(2);
        // Stub `destination` encodes the requested distance in x: +2 and -2 for size 2.
        expect(out[0].geometry.coordinates[0] - out[1].geometry.coordinates[0]).toBe(4);
    });
});

describe('CONSERTADO: text_distance_ratio === 0 caía para 0.9 (forma falsy-zero)', () => {
    // `symbol_size * (text_distance_ratio || 0.9)`. Zero is a ratio the user can set
    // (the drag handle clamps at TEXT_DISTANCE_MIN 0.1, but a persisted or imported
    // feature is not clamped), and it means "label glued to the symbol". It came back
    // as 0.9, i.e. almost the default, with nothing reporting the substitution. The
    // fallback is now `Number.isFinite`, so only a MISSING ratio reaches the default.
    const withRatio = (ratio) => boundaryFeature({
        baseCoordinates: [[0, 0], [1, 0]], text_top: 'CIMA', symbol_size: 2, echelon: 'X',
        text_distance_ratio: ratio,
    });

    // The stub places the symbol centre at x = totalLength * ratio = 10 * 0.5 = 5 and
    // then adds the requested label offset, so the offset is `x - 5`.
    const SYMBOL_CENTER_X = 5;
    const offsetOf = (ratio) => geom.generateBoundaryTexts(withRatio(ratio))[0].geometry.coordinates[0] - SYMBOL_CENTER_X;

    it('CONTROLE: um ratio não-nulo é respeitado (symbol_size * ratio chega ao destination)', () => {
        expect(offsetOf(1)).toBe(2);
        expect(offsetOf(0.5)).toBe(1);
        expect(offsetOf(2)).toBe(4);
    });

    it('usa offset 0 para ratio 0 (antes usava 0.9, ou seja offset 1.8)', () => {
        expect(offsetOf(0)).toBe(0);
    });

    it('ratio 0 deixou de produzir a mesma saída de ratio ausente', () => {
        expect(offsetOf(undefined)).toBeCloseTo(1.8, 10);
        expect(offsetOf(0)).not.toBe(offsetOf(undefined));
        // A non-finite ratio still falls back, which is the case the guard is for.
        expect(offsetOf(NaN)).toBeCloseTo(1.8, 10);
        expect(offsetOf('1')).toBeCloseTo(1.8, 10);
    });
});

describe('CONSERTADO: symbol_size ausente produzia coordenada NaN, sem erro', () => {
    // `undefined * (ratio || 0.9)` is NaN, and NaN flowed straight into
    // `turf.destination` and out into the emitted feature's geometry. The size now
    // goes through `resolveSymbolSize`, whose fallback is the zoom model's
    // `BOUNDARY_ZOOM_DEFAULTS.symbolSizeKm` (1 km). It used to be the geometry's
    // own DEFAULT_SYMBOL_SIZE (2 km), and that constant is GONE: two fallbacks for
    // one value is how a boundary drew its label off one size and its symbol off
    // another. The number below moved with it, from 1.8 to 0.9.

    it('CONTROLE: com symbol_size definido a coordenada é finita e vale o pedido', () => {
        const out = geom.generateBoundaryTexts(boundaryFeature({
            baseCoordinates: [[0, 0], [1, 0]], text_top: 'CIMA', symbol_size: 2, echelon: 'X',
            text_distance_ratio: 1,
        }));
        expect(Number.isFinite(out[0].geometry.coordinates[0])).toBe(true);
        expect(out[0].geometry.coordinates[0]).toBe(7);   // centre 5 + offset 2
    });

    it('emite coordenada finita sem symbol_size (antes emitia NaN)', () => {
        const out = geom.generateBoundaryTexts(boundaryFeature({
            baseCoordinates: [[0, 0], [1, 0]], text_top: 'CIMA', echelon: 'X',
        }));
        expect(out.length).toBe(1);
        expect(Number.isFinite(out[0].geometry.coordinates[0])).toBe(true);
        // Absolute anchor: the model default of 1 km times the default ratio 0.9.
        expect(out[0].geometry.coordinates[0]).toBeCloseTo(5 + 0.9, 10);
    });

    it('symbol_size não-finito também cai no padrão', () => {
        for (const bad of [NaN, Infinity, '2', null]) {
            const out = geom.generateBoundaryTexts(boundaryFeature({
                baseCoordinates: [[0, 0], [1, 0]], text_top: 'CIMA', echelon: 'X', symbol_size: bad,
            }));
            expect(out.length).toBe(1);
            expect(Number.isFinite(out[0].geometry.coordinates[0])).toBe(true);
        }
    });
});

describe('AddBoundaryGeometry.generateBoundaryTexts: teto pelo comprimento da linha', () => {
    // The reason every label fixture above carries an `echelon`. The offset is
    // `effective * ratio`, and `effective` is bounded by what the line can carry:
    // gaps for all the instances together may take at most half of it, and one
    // symbol costs `1.5 * 1.2` km of gap per km of size.
    const SYMBOL_CENTER_X = 5;   // stub: length 10, single instance at ratio 0.5
    const offsetOf = (props) => geom.generateBoundaryTexts(boundaryFeature({
        baseCoordinates: [[0, 0], [1, 0]], text_top: 'CIMA', text_distance_ratio: 1, ...props,
    }))[0].geometry.coordinates[0] - SYMBOL_CENTER_X;

    it('um símbolo pequeno passa incólume pelo teto', () => {
        expect(offsetOf({ symbol_size: 2, echelon: 'X' })).toBeCloseTo(2, 10);
    });

    it('um símbolo grande demais para a linha satura no teto', () => {
        // 10 km, uma instância, um 'X': 10 * 0.5 / (1 * 1 * 1.8).
        expect(offsetOf({ symbol_size: 40, echelon: 'X' })).toBeCloseTo(10 * 0.5 / 1.8, 10);
    });

    it('o teto cai com o número de símbolos do escalão e com o de instâncias', () => {
        expect(offsetOf({ symbol_size: 40, echelon: 'XXX' })).toBeCloseTo(10 * 0.5 / (3 * 1.8), 10);
        expect(offsetOf({
            symbol_size: 40, echelon: 'X',
            symbol_instances: [{ ratio: 0.5 }, { ratio: 0.9 }],
        })).toBeCloseTo(10 * 0.5 / (2 * 1.8), 10);
    });

    it('sem escalão declarado o teto assume TRÊS símbolos, como o vão da linha', () => {
        // `echelonSymbolCount` mirrors the fallback `createLineWithGaps` has always
        // used, so the gap the line reserves and the cap agree on the symbol count.
        expect(offsetOf({ symbol_size: 40 })).toBeCloseTo(10 * 0.5 / (3 * 1.8), 10);
    });
});

describe('AddBoundaryGeometry.generateBoundaryTexts: eixo do zoom', () => {
    // The two new properties the label carries, and the one it derives.
    const anchored = (extra = {}) => boundaryFeature({
        baseCoordinates: [[0, 0], [1, 0]], text_top: 'CIMA', text_bottom: 'BAIXO',
        symbol_size: 2, echelon: 'X', text_size: 35, ...extra,
    });

    it('carrega o tamanho derivado do pai para os dois rótulos', () => {
        const out = geom.generateBoundaryTexts(anchored({ calculatedTextSize: 70 }));
        expect(out).toHaveLength(2);
        expect(out.map((f) => f.properties.calculatedTextSize)).toEqual([70, 70]);
        // The authored base travels along so the PDF export can rescale it.
        expect(out.map((f) => f.properties.text_size)).toEqual([35, 35]);
    });

    it('cai no text_size quando o pai não tem derivado (legado)', () => {
        expect(geom.generateBoundaryTexts(anchored())[0].properties.calculatedTextSize).toBe(35);
    });

    it('propaga a âncora, e a deixa indefinida no legado', () => {
        const anchoredOut = geom.generateBoundaryTexts(anchored({
            createdAtZoom: 12.5, zoomCorrectionEnabled: false,
        }));
        expect(anchoredOut[0].properties.createdAtZoom).toBe(12.5);
        expect(anchoredOut[0].properties.zoomCorrectionEnabled).toBe(false);

        // The export skips a feature with no `createdAtZoom`, which is what keeps a
        // legacy boundary rendering exactly as it did.
        const legacy = geom.generateBoundaryTexts(anchored());
        expect(legacy[0].properties.createdAtZoom).toBeUndefined();
        expect(legacy[0].properties.zoomCorrectionEnabled).toBeUndefined();
    });
});

describe('AddBoundaryGeometry.generateBoundaryTexts: costura da rotação', () => {
    // The branch itself moved to `computeTextRotation` (the zoom model), and this
    // block keeps measuring it THROUGH the geometry, which is the only place that
    // decides whether the local bearing reaches it at all. The unit-level table of
    // the function lives in `tests/unit/boundary-zoom-model.test.js`.
    const rotationAt = (bearing, extra = {}) => {
        turfState.bearing = bearing;
        const out = geom.generateBoundaryTexts(boundaryFeature({
            baseCoordinates: [[0, 0], [1, 0]], text_top: 'CIMA', symbol_size: 2, ...extra,
        }));
        expect(out.length).toBe(1);
        return out[0].properties.rotation;
    };

    afterAll(() => { turfState.bearing = 90; });

    it('o par do norte: `text_north_facing` zera a rotação em qualquer azimute', () => {
        // With `text-rotation-alignment: 'map'` on the layer, 0 IS map north, so
        // the label reads upright no matter how the line runs or the camera turns.
        for (const bearing of [0, 45, 90, 137, 180, 270, -12]) {
            expect(rotationAt(bearing, { text_north_facing: true })).toBe(0);
        }
    });

    it('só o literal `true` liga o norte; o resto continua perpendicular', () => {
        // Bearing 45 and NOT 90: the legacy branch answers 0 for a bearing of 90,
        // the same as north-facing, so that case cannot tell the two apart.
        expect(rotationAt(45, { text_north_facing: true })).toBe(0);
        expect(rotationAt(45, { text_north_facing: 'sim' })).toBe(-45);
        expect(rotationAt(45, { text_north_facing: 1 })).toBe(-45);
        expect(rotationAt(45, {})).toBe(-45);
    });

    it('o ramo `<= 0 || >= 180` soma 90; o do meio subtrai 90', () => {
        expect(rotationAt(0)).toBe(90);
        expect(rotationAt(-90)).toBe(0);
        expect(rotationAt(180)).toBe(270);
        expect(rotationAt(90)).toBe(0);
        expect(rotationAt(45)).toBe(-45);
    });

    it('a costura em 0 é DESCONTÍNUA: 180 graus de salto por um milionésimo de azimute', () => {
        const justBelow = rotationAt(-0.0001);
        const justAbove = rotationAt(0.0001);
        expect(justBelow).toBeCloseTo(89.9999, 6);
        expect(justAbove).toBeCloseTo(-89.9999, 6);
        expect(Math.abs(justBelow - justAbove)).toBeCloseTo(179.9998, 4);
    });

    it('a costura em 180 salta 180 graus do mesmo jeito', () => {
        const justBelow = rotationAt(179.9999);
        const justAbove = rotationAt(180);
        expect(justBelow).toBeCloseTo(89.9999, 6);
        expect(justAbove).toBe(270);
        expect(Math.abs(justBelow - justAbove)).toBeCloseTo(180.0001, 3);
    });
});

// ============================================================================
// updateFromHandle — the asymmetric index guards
// ============================================================================

describe('AddBoundaryGeometry.updateFromHandle: guardas de entrada', () => {
    it('recusa newPosition inválido', () => {
        expect(geom.updateFromHandle('vertex', null, boundaryFeature(), 0)).toBeNull();
        expect(geom.updateFromHandle('vertex', [0], boundaryFeature(), 0)).toBeNull();
        expect(geom.updateFromHandle('vertex', ['a', 'b'], boundaryFeature(), 0)).toBeNull();
        expect(geom.updateFromHandle('vertex', [NaN, 0], boundaryFeature(), 0)).toBeNull();
    });

    it('recusa feature, handleType e coordenadas ausentes', () => {
        expect(geom.updateFromHandle('vertex', [9, 9], null, 0)).toBeNull();
        expect(geom.updateFromHandle('vertex', [9, 9], {}, 0)).toBeNull();
        expect(geom.updateFromHandle(null, [9, 9], boundaryFeature(), 0)).toBeNull();
        expect(geom.updateFromHandle('vertex', [9, 9], boundaryFeature({ baseCoordinates: [[0, 0]] }), 0)).toBeNull();
    });

    it('recusa handleType desconhecido (ao contrário da seta, que aceita qualquer um)', () => {
        expect(geom.updateFromHandle('handle-que-nao-existe', [9, 9], boundaryFeature(), 0)).toBeNull();
    });

    it('não muta a feição de entrada', () => {
        const feature = boundaryFeature();
        geom.updateFromHandle('vertex', [9, 9], feature, 1);
        expect(feature.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [2, 0]]);
    });

    it('vertex move a coordenada do índice pedido', () => {
        const out = geom.updateFromHandle('vertex', [9, 9], boundaryFeature(), 1);
        expect(out.properties.baseCoordinates).toEqual([[0, 0], [9, 9], [2, 0]]);
    });

    it('midpoint insere NO índice pedido (não depois dele, como faz a seta)', () => {
        const out = geom.updateFromHandle('midpoint', [9, 9], boundaryFeature(), 1);
        expect(out.properties.baseCoordinates).toEqual([[0, 0], [9, 9], [1, 0], [2, 0]]);
    });

    it('OBSERVADO: newPosition com Infinity é ACEITO (isNaN não é isFinite)', () => {
        const out = geom.updateFromHandle('vertex', [Infinity, 1], boundaryFeature(), 0);
        expect(out).not.toBeNull();
        expect(out.properties.baseCoordinates[0]).toEqual([Infinity, 1]);
    });
});

describe('CONSERTADO: os índices de vertex e midpoint não tinham limite INFERIOR', () => {
    // The arrow tool writes `handleIndex >= 0 && handleIndex < coords.length`. Here the
    // guards were `handleIndex < coordinates.length` and `handleIndex <= coordinates.length`,
    // with no lower bound, so a negative index was accepted by both branches and each did
    // something different and wrong: `vertex` wrote a non-index property `"-1"` onto the
    // array (invisible to JSON, invisible to length) and `midpoint` spliced from the END.
    // Both now demand an INTEGER at or above 0; the asymmetric upper bound stays.

    it('CONTROLE: o mesmo ramo recusa o índice alto (vertex) e converge (midpoint)', () => {
        const highVertex = geom.updateFromHandle('vertex', [9, 9], boundaryFeature(), 3);
        expect(highVertex.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [2, 0]]);
        const wayHigh = geom.updateFromHandle('midpoint', [9, 9], boundaryFeature(), 4);
        expect(wayHigh.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [2, 0]]);
    });

    it('ignora vertex com índice -1 (antes escrevia a chave "-1" no array)', () => {
        const out = geom.updateFromHandle('vertex', [9, 9], boundaryFeature(), -1);
        const coords = out.properties.baseCoordinates;
        expect(Object.prototype.hasOwnProperty.call(coords, '-1')).toBe(false);
        expect(coords[-1]).toBeUndefined();
        expect(coords.length).toBe(3);
        expect(Array.from(coords)).toEqual([[0, 0], [1, 0], [2, 0]]);
    });

    it('ignora midpoint com índice -1 (antes inseria ANTES do último vértice)', () => {
        const out = geom.updateFromHandle('midpoint', [9, 9], boundaryFeature(), -1);
        expect(out.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [2, 0]]);
    });

    it('os dois ramos também recusam índice não-inteiro', () => {
        expect(geom.updateFromHandle('vertex', [9, 9], boundaryFeature(), NaN).properties.baseCoordinates)
            .toEqual([[0, 0], [1, 0], [2, 0]]);
        expect(geom.updateFromHandle('midpoint', [9, 9], boundaryFeature(), 1.5).properties.baseCoordinates)
            .toEqual([[0, 0], [1, 0], [2, 0]]);
    });

    it('MANTIDO: o `<=` do midpoint aceita índice IGUAL ao comprimento e anexa no fim', () => {
        // Backlog row: "midpoint uses `<=`, vertex uses `<`". Confirmed, and here is what
        // it buys: index 3 on a 3-vertex boundary appends instead of doing nothing.
        const out = geom.updateFromHandle('midpoint', [9, 9], boundaryFeature(), 3);
        expect(out.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [2, 0], [9, 9]]);
    });
});

// Path: tests/unit/brush-geometry.test.js

/**
 * @fileoverview Pins the pure math of `AddBrushGeometry`
 * (`src/js/draw_tools/brush_tool/add_brush_geometry.js`): `validate`,
 * `createLineStringGeometry`, `simplifyLine`, `calculatePointLineDistance`,
 * `getBoundingBox`, `applyOffset`, `getCenter`, `calculateTotalLength`,
 * `isPixelDistanceSufficient` and `normalizeCoordinates`.
 *
 * The `@tools` barrel is mocked with a trivial BaseGeometry (it drags
 * DOM/MapLibre in), so what this suite reaches is the arithmetic of the class
 * and nothing else.
 *
 * What it does NOT reach: the real haversine of `BaseGeometry.calculateDistance`
 * (`calculateTotalLength` is pinned by call structure over a spy, not by
 * distances in metres), the MapLibre control that drives the tool, and the
 * pixel-space plumbing that feeds `isPixelDistanceSufficient` a projected point.
 *
 * Several tests below assert MEASURED behaviour that looks like a defect. They
 * are marked in the test name with "defeito" or "documenta" so a future reader
 * does not mistake the green for approval.
 *
 * FIXED ON 2026-08-24:
 * - `simplifyLine` anchors on the last point KEPT instead of on the original
 *   neighbour, so a smooth curve no longer collapses to [first, last].
 * - `getBoundingBox` sweeps once instead of spreading four times, so it survives
 *   a stroke of hundreds of thousands of points.
 * - `validate` rejects a non-finite coordinate, like circle/line/polygon/ellipse.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// add_brush_geometry imports BaseGeometry from the `@tools` barrel, which pulls
// in DOM/MapLibre-coupled modules. Mock it with a trivial base; the only base
// method the class uses is calculateDistance, stubbed here as a constant so the
// summation structure of calculateTotalLength can be observed by a spy.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
        calculateDistance(_a, _b) { return 1; }
    },
}));

const { default: AddBrushGeometry } = await import('../../src/js/draw_tools/brush_tool/add_brush_geometry.js');

const geom = new AddBrushGeometry();

/** Finite lng/lat pair generator. */
const arbPoint = fc.tuple(
    fc.double({ min: -180, max: 180, noNaN: true }),
    fc.double({ min: -90, max: 90, noNaN: true })
);

/** At least two points, which is what `validate` demands. */
const arbLine = fc.array(arbPoint, { minLength: 2, maxLength: 40 });

// ============================================================================
// validate
// ============================================================================

describe('AddBrushGeometry.validate', () => {
    it('aceita dois pontos finitos', () => {
        expect(geom.validate([[0, 0], [1, 1]])).toBe(true);
    });

    it('aceita pontos com terceira dimensao (length >= 2)', () => {
        expect(geom.validate([[0, 0, 5], [1, 1, 6]])).toBe(true);
    });

    it('recusa null, nao-array, vazio e um unico ponto', () => {
        expect(geom.validate(null)).toBe(false);
        expect(geom.validate(undefined)).toBe(false);
        expect(geom.validate('[[0,0],[1,1]]')).toBe(false);
        expect(geom.validate([])).toBe(false);
        expect(geom.validate([[0, 0]])).toBe(false);
    });

    it('recusa ponto curto, coordenada string e NaN', () => {
        expect(geom.validate([[0, 0], [1]])).toBe(false);
        expect(geom.validate([[0, 0], ['1', 1]])).toBe(false);
        expect(geom.validate([[0, 0], [NaN, 1]])).toBe(false);
        expect(geom.validate([[0, 0], [1, NaN]])).toBe(false);
    });

    // Ex-defeito, corrigido em 2026-08-24: `isNaN` deixava Infinity passar, e o
    // guarda passou a ser `Number.isFinite`, como em circle/line/polygon/ellipse.
    it('recusa Infinity (o guarda e Number.isFinite, nao isNaN)', () => {
        expect(geom.validate([[0, 0], [Infinity, 1]])).toBe(false);
        expect(geom.validate([[0, 0], [1, -Infinity]])).toBe(false);
    });

    it('propriedade: toda linha finita de >= 2 pontos valida', () => {
        fc.assert(fc.property(arbLine, (pts) => {
            expect(geom.validate(pts)).toBe(true);
        }));
    });
});

// ============================================================================
// generate / createLineStringGeometry
// ============================================================================

describe('AddBrushGeometry.createLineStringGeometry', () => {
    it('produz LineString com as mesmas coordenadas', () => {
        const pts = [[0, 0], [1, 1], [2, 3]];
        expect(geom.generate(pts)).toEqual({ type: 'LineString', coordinates: pts });
    });

    it('lanca para entrada invalida', () => {
        expect(() => geom.createLineStringGeometry([[0, 0]])).toThrow(/Invalid points/);
        expect(() => geom.createLineStringGeometry(null)).toThrow(/Invalid points/);
    });

    it('documenta: a copia e RASA, os pontos internos continuam por referencia', () => {
        const pts = [[0, 0], [1, 1]];
        const out = geom.createLineStringGeometry(pts);
        expect(out.coordinates).not.toBe(pts);          // outer array is new
        expect(out.coordinates[0]).toBe(pts[0]);        // inner arrays are shared
        out.coordinates[0][0] = 99;
        expect(pts[0][0]).toBe(99);                     // mutation leaks back
    });

    it('createHandles e updateFromHandle sao inertes', () => {
        expect(geom.createHandles({})).toEqual([]);
        expect(geom.updateFromHandle('any', [0, 0], {})).toBeNull();
    });
});

// ============================================================================
// calculatePointLineDistance
// ============================================================================

describe('AddBrushGeometry.calculatePointLineDistance', () => {
    it('pe da perpendicular dentro do segmento', () => {
        expect(geom.calculatePointLineDistance([0, 1], [-1, 0], [1, 0])).toBeCloseTo(1, 12);
        expect(geom.calculatePointLineDistance([0.5, 0], [0, 0], [1, 0])).toBeCloseTo(0, 12);
    });

    it('segmento degenerado (lenSq === 0) devolve a distancia ao ponto, sem NaN', () => {
        const d = geom.calculatePointLineDistance([3, 4], [0, 0], [0, 0]);
        expect(d).toBe(5);
        expect(Number.isNaN(d)).toBe(false);
    });

    it('param < 0 mede ate o inicio; param > 1 mede ate o fim', () => {
        expect(geom.calculatePointLineDistance([-2, 0], [0, 0], [1, 0])).toBeCloseTo(2, 12);
        expect(geom.calculatePointLineDistance([3, 0], [0, 0], [1, 0])).toBeCloseTo(2, 12);
    });

    it('documenta: sem wrap de antimeridiano, 179 e -179 ficam a 358 graus', () => {
        // Geographically these are ~2 degrees apart; the planar math says 358.
        const d = geom.calculatePointLineDistance([179, 0], [-179, 0], [-179, 1]);
        expect(d).toBeCloseTo(358, 9);
    });

    it('propriedade: nunca excede a distancia a nenhum dos extremos, e e finita e >= 0', () => {
        fc.assert(fc.property(arbPoint, arbPoint, arbPoint, (p, a, b) => {
            const d = geom.calculatePointLineDistance(p, a, b);
            const da = Math.hypot(p[0] - a[0], p[1] - a[1]);
            const db = Math.hypot(p[0] - b[0], p[1] - b[1]);
            expect(Number.isFinite(d)).toBe(true);
            expect(d).toBeGreaterThanOrEqual(0);
            // Tolerance is relative: the coordinates span 360 degrees.
            expect(d).toBeLessThanOrEqual(Math.min(da, db) + 1e-9);
        }));
    });
});

// ============================================================================
// simplifyLine
// ============================================================================

describe('AddBrushGeometry.simplifyLine', () => {
    it('<= 2 pontos e identidade, pela propria referencia', () => {
        const one = [[0, 0]];
        const two = [[0, 0], [1, 1]];
        expect(geom.simplifyLine(one)).toBe(one);
        expect(geom.simplifyLine(two)).toBe(two);
    });

    it('linha reta densa colapsa em [primeiro, ultimo]', () => {
        const pts = Array.from({ length: 25 }, (_, i) => [i * 0.001, 0]);
        expect(pts.length).toBe(25);
        expect(geom.simplifyLine(pts)).toEqual([[0, 0], [0.024, 0]]);
    });

    it('quina preservada quando o desvio supera a tolerancia', () => {
        const out = geom.simplifyLine([[0, 0], [1, 0], [1, 1]], 0.1);
        expect(out).toEqual([[0, 0], [1, 0], [1, 1]]);
    });

    /** Quarter circle of radius 1, sampled every 2 degrees. */
    const quarterArc = () => Array.from({ length: 46 }, (_, i) => {
        const t = (i * 2 * Math.PI) / 180;
        return [Math.cos(t), Math.sin(t)];
    });

    // Ex-defeito, corrigido em 2026-08-24. The anchor used to be points[i - 1], a
    // chord that moves with the candidate, so every point of a smooth arc read as
    // locally straight (~3e-4 from its own two neighbours) and the whole arc
    // collapsed to [first, last], 0.29 away from the kept chord at its middle.
    // The anchor is the last point KEPT now.
    it('curva suave sobrevive: a ancora e o ultimo ponto MANTIDO', () => {
        const arc = quarterArc();
        expect(arc.length).toBe(46);

        const out = geom.simplifyLine(arc, 0.001);
        expect(out.length).toBeGreaterThan(2);
        expect(out[0]).toEqual(arc[0]);
        expect(out[out.length - 1]).toEqual(arc[45]);

        // Control: what the old anchor threw away really was far from the chord it
        // kept, so this is loss of shape recovered and not extra points for nothing.
        expect(geom.calculatePointLineDistance(arc[23], arc[0], arc[45])).toBeGreaterThan(0.2);
    });

    it('a saida respeita a tolerancia: nenhum ponto original fica alem dela', () => {
        const arc = quarterArc();
        const out = geom.simplifyLine(arc, 0.001);

        let worst = 0;
        for (const p of arc) {
            let best = Infinity;
            for (let i = 0; i < out.length - 1; i++) {
                best = Math.min(best, geom.calculatePointLineDistance(p, out[i], out[i + 1]));
            }
            worst = Math.max(worst, best);
        }
        expect(out.length).toBeGreaterThan(2);
        expect(worst).toBeLessThan(0.001);
    });

    it('defeito: ponto com NaN e descartado em silencio (NaN > tol e false)', () => {
        const out = geom.simplifyLine([[0, 0], [NaN, 5], [1, 1]], 1e-9);
        expect(out).toEqual([[0, 0], [1, 1]]);
        expect(out.some(p => Number.isNaN(p[0]))).toBe(false);
    });

    it('documenta: entrada null lanca TypeError (nao ha guarda)', () => {
        expect(() => geom.simplifyLine(null)).toThrow(TypeError);
    });

    it('propriedade: a saida e subsequencia da entrada e mantem as pontas', () => {
        fc.assert(fc.property(fc.array(arbPoint, { minLength: 3, maxLength: 30 }), fc.double({ min: 1e-9, max: 10, noNaN: true }), (pts, tol) => {
            const out = geom.simplifyLine(pts, tol);
            expect(out.length).toBeGreaterThanOrEqual(2);
            expect(out[0]).toBe(pts[0]);
            expect(out[out.length - 1]).toBe(pts[pts.length - 1]);
            // Subsequence check, by identity, in order.
            let cursor = 0;
            for (const kept of out) {
                while (cursor < pts.length && pts[cursor] !== kept) cursor++;
                expect(cursor).toBeLessThan(pts.length);
                cursor++;
            }
        }));
    });

    it('propriedade: tolerancia maior nunca mantem mais pontos', () => {
        fc.assert(fc.property(fc.array(arbPoint, { minLength: 3, maxLength: 30 }), fc.double({ min: 1e-9, max: 1, noNaN: true }), fc.double({ min: 1, max: 100, noNaN: true }), (pts, small, big) => {
            expect(geom.simplifyLine(pts, big).length).toBeLessThanOrEqual(geom.simplifyLine(pts, small).length);
        }));
    });
});

// ============================================================================
// getBoundingBox
// ============================================================================

describe('AddBrushGeometry.getBoundingBox', () => {
    it('devolve [minLng, minLat, maxLng, maxLat]', () => {
        expect(geom.getBoundingBox([[2, -1], [-3, 4], [0, 0]])).toEqual([-3, -1, 2, 4]);
    });

    it('entrada invalida devolve null', () => {
        expect(geom.getBoundingBox([[0, 0]])).toBeNull();
        expect(geom.getBoundingBox(null)).toBeNull();
        expect(geom.getBoundingBox([[0, 0], [NaN, 1]])).toBeNull();
    });

    it('linha degenerada produz caixa de area zero', () => {
        expect(geom.getBoundingBox([[5, 5], [5, 5]])).toEqual([5, 5, 5, 5]);
    });

    it('documenta: sem wrap, um traco sobre o antimeridiano abre o globo inteiro', () => {
        expect(geom.getBoundingBox([[179, 0], [-179, 0]])).toEqual([-179, 0, 179, 0]);
    });

    // Ex-defeito, corrigido em 2026-08-24. `Math.min(...lngs)` pushes one argument
    // per point and threw RangeError past ~125k of them (measured on this Node);
    // a long stroke gets there, since the tool appends a point every 3 pixels of
    // drag. There were FOUR spreads, and fixing fewer than four would still throw.
    it('a caixa sai para 200k pontos, sem estourar a pilha', () => {
        const pts = Array.from({ length: 200000 }, (_, i) => [i * 1e-6, 0]);
        expect(pts.length).toBe(200000);

        // The expected max is the last point's own value, NOT the literal 0.199999:
        // 199999 * 1e-6 is 0.19999899999999998, a different double. Writing the
        // literal here is what kept the old `it.fails` green after the fix.
        expect(geom.getBoundingBox(pts)).toEqual([0, 0, pts[199999][0], 0]);
        expect(pts[199999][0]).not.toBe(0.199999);
    });

    it('as QUATRO extremidades saem do mesmo varredura, em array grande', () => {
        // One-sided fixes pass the test above by accident: the first spread to
        // throw is the only one it observes. This one moves every extreme to a
        // different point of a 150k array, past the spread limit on all four.
        const pts = Array.from({ length: 150000 }, (_, i) => [i * 1e-6, 0]);
        pts[10] = [-5, 0];
        pts[20] = [7, 0];
        pts[30] = [0, -3];
        pts[40] = [0, 9];
        expect(geom.getBoundingBox(pts)).toEqual([-5, -3, 7, 9]);
    });

    it('propriedade: todo ponto cai dentro da caixa', () => {
        fc.assert(fc.property(arbLine, (pts) => {
            const [minLng, minLat, maxLng, maxLat] = geom.getBoundingBox(pts);
            expect(pts.length).toBeGreaterThanOrEqual(2);
            for (const [lng, lat] of pts) {
                expect(lng).toBeGreaterThanOrEqual(minLng);
                expect(lng).toBeLessThanOrEqual(maxLng);
                expect(lat).toBeGreaterThanOrEqual(minLat);
                expect(lat).toBeLessThanOrEqual(maxLat);
            }
        }));
    });
});

// ============================================================================
// applyOffset / getCenter
// ============================================================================

describe('AddBrushGeometry.applyOffset', () => {
    it('desloca todos os pontos', () => {
        expect(geom.applyOffset([[0, 0], [1, 1]], 2, -3)).toEqual([[2, -3], [3, -2]]);
    });

    it('entrada invalida devolve a PROPRIA referencia, nao uma copia', () => {
        const bad = [[0, 0]];
        expect(geom.applyOffset(bad, 1, 1)).toBe(bad);
    });

    it('documenta: a terceira dimensao e descartada', () => {
        const out = geom.applyOffset([[0, 0, 7], [1, 1, 8]], 1, 1);
        expect(out).toEqual([[1, 1], [2, 2]]);
        expect(out[0]).toHaveLength(2);
    });

    it('propriedade: round-trip +d/-d volta ao original', () => {
        fc.assert(fc.property(arbLine, fc.double({ min: -10, max: 10, noNaN: true }), fc.double({ min: -10, max: 10, noNaN: true }), (pts, dx, dy) => {
            const back = geom.applyOffset(geom.applyOffset(pts, dx, dy), -dx, -dy);
            expect(back).toHaveLength(pts.length);
            for (let i = 0; i < pts.length; i++) {
                expect(back[i][0]).toBeCloseTo(pts[i][0], 9);
                expect(back[i][1]).toBeCloseTo(pts[i][1], 9);
            }
        }));
    });
});

describe('AddBrushGeometry.getCenter', () => {
    it('documenta: devolve o PRIMEIRO ponto, nao o centro', () => {
        expect(geom.getCenter([[10, 10], [20, 20], [30, 30]])).toEqual([10, 10]);
    });

    it('entrada invalida devolve null', () => {
        expect(geom.getCenter([[0, 0]])).toBeNull();
    });
});

// ============================================================================
// calculateTotalLength (structure only; the haversine lives in BaseGeometry)
// ============================================================================

describe('AddBrushGeometry.calculateTotalLength', () => {
    it('soma exatamente n-1 segmentos, em pares consecutivos', () => {
        const spy = vi.spyOn(geom, 'calculateDistance').mockReturnValue(1);
        const pts = [[0, 0], [1, 1], [2, 2], [3, 3]];

        expect(geom.calculateTotalLength(pts)).toBe(3);
        expect(spy.mock.calls).toHaveLength(3);
        spy.mock.calls.forEach((call, i) => {
            expect(call[0]).toBe(pts[i]);
            expect(call[1]).toBe(pts[i + 1]);
        });
        spy.mockRestore();
    });

    it('entrada invalida devolve 0 sem chamar a distancia', () => {
        const spy = vi.spyOn(geom, 'calculateDistance');
        expect(geom.calculateTotalLength([[0, 0]])).toBe(0);
        expect(geom.calculateTotalLength(null)).toBe(0);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

// ============================================================================
// isPixelDistanceSufficient
// ============================================================================

describe('AddBrushGeometry.isPixelDistanceSufficient', () => {
    it('sem ponto anterior, sempre suficiente', () => {
        expect(geom.isPixelDistanceSufficient(null, { x: 0, y: 0 })).toBe(true);
        expect(geom.isPixelDistanceSufficient(undefined, { x: 0, y: 0 })).toBe(true);
    });

    it('a fronteira de 3 px e inclusiva (>=)', () => {
        expect(geom.isPixelDistanceSufficient({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true);
        expect(geom.isPixelDistanceSufficient({ x: 0, y: 0 }, { x: 2.999, y: 0 })).toBe(false);
    });

    it('mede na diagonal (3,4) -> 5', () => {
        expect(geom.isPixelDistanceSufficient({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
    });
});

// ============================================================================
// normalizeCoordinates
// ============================================================================

describe('AddBrushGeometry.normalizeCoordinates', () => {
    let errSpy;
    beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { errSpy.mockRestore(); });

    it('desserializa string JSON de array', () => {
        expect(geom.normalizeCoordinates('[[0,0],[1,1]]')).toEqual([[0, 0], [1, 1]]);
    });

    it('JSON malformado devolve null', () => {
        expect(geom.normalizeCoordinates('[[0,0]')).toBeNull();
        expect(errSpy).toHaveBeenCalled();
    });

    it("documenta: '5' e 'null' desserializam para nao-array e viram null", () => {
        expect(geom.normalizeCoordinates('5')).toBeNull();
        expect(geom.normalizeCoordinates('null')).toBeNull();
    });

    it('nao-array devolve null', () => {
        expect(geom.normalizeCoordinates({ a: 1 })).toBeNull();
        expect(geom.normalizeCoordinates(42)).toBeNull();
        expect(geom.normalizeCoordinates(null)).toBeNull();
    });

    it('documenta: array passa por referencia, SEM checar comprimento nem conteudo', () => {
        const arr = [[0, 0]];
        expect(geom.normalizeCoordinates(arr)).toBe(arr);
        // Contrast with validate(), which would reject this same value.
        expect(geom.validate(arr)).toBe(false);
        expect(geom.normalizeCoordinates([])).toEqual([]);
    });
});

// Path: tests/unit/point-geometry.test.js

/**
 * @fileoverview Unit tests for AddPointGeometry (`draw_tools/point_tool/add_point_geometry.js`).
 *
 * WHAT THIS SUITE PINS
 * - `calculateSelectionBoxGeometry`: the full arithmetic, against a formula
 *   re-derived here from the Web Mercator definition instead of reusing the
 *   module's own `pixelsToDegrees` composition, so an error in the composition
 *   (a lost `/ 2`, a padding counted once, the diameter scale dropped) shows up.
 *   Also the `effectiveZoom !== null` test that keeps zoom 0 usable, and the
 *   collapse at the poles, where cos(lat) drives the box to zero.
 * - The five-argument signature: the tool's own creation path calls it with FOUR
 *   arguments and relies on the `effectiveZoom = null` default, which is correct
 *   at creation time because createdAtZoom IS the current zoom there.
 * - `validate` / `isValidPoint`, `createPointGeometry` (which throws, unlike the
 *   image tool's silent `generate`), `normalizeCoordinates`, `getCenter`,
 *   `applyOffset`, `getBoundingBox`, `recalculateSelectionBox`.
 *
 * WHAT IT DOES NOT REACH
 * - Anything in `add_point_control.js`: markers, per-feature images, store writes,
 *   the attributes panel. The geometry class is the whole subject.
 * - `pixelsToDegrees` itself, which has its own suite (tests/unit/geometry-utils.test.js).
 *   Here it is only used through the class, never asserted on its own.
 * - Whether the drawn selection box matches the rendered circle in pixels: only the
 *   geographic formula is pinned.
 *
 * FIXED ON 2026-08-24: `validate` rejects a non-finite coordinate (so an infinite
 * one no longer reaches `calculateSelectionBoxGeometry` and yields a ring of NaN),
 * and `recalculateSelectionBox` stopped reading `size: 0` as the default 10.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';

// add_point_geometry imports BaseGeometry from the `@tools` barrel, which pulls in
// DOM/MapLibre-coupled modules. Mock the barrel with a trivial BaseGeometry so the
// pure math can be exercised in the `node` environment. `pixelsToDegrees` comes from
// a leaf utility module with no imports and is left real.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
    },
}));

const { default: AddPointGeometry } = await import('../../src/js/draw_tools/point_tool/add_point_geometry.js');

const geom = new AddPointGeometry();

/**
 * Independent re-derivation of the pixel-to-degree conversion, collapsed to a
 * single expression: degrees = pixels * cos(lat) * 360 / 2^(zoom + 8).
 * Deliberately NOT the module's own two-step composition, so that a mistake in
 * that composition cannot be confirmed by the check that is meant to catch it.
 * @param {number} pixels
 * @param {number} latitude - degrees
 * @param {number} zoom
 * @returns {number} degrees
 */
function degreesFor(pixels, latitude, zoom) {
    return pixels * Math.cos(latitude * Math.PI / 180) * 360 / (2 ** (zoom + 8));
}

/** Half-extent the class should produce: (size*2 + lineWidth + 2*2) pixels, halved. */
function expectedHalfExtent(size, lineWidth, latitude, zoom) {
    return degreesFor(size * 2 + lineWidth + 4, latitude, zoom) / 2;
}

// `normalizeCoordinates` logs on every rejection; keep the run readable.
let errorSpy;
beforeAll(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { errorSpy.mockRestore(); });

// ============================================================================
// validate / isValidPoint
// ============================================================================

describe('AddPointGeometry.validate', () => {
    it('aceita um par numerico', () => {
        expect(geom.validate([0, 0])).toBe(true);
        expect(geom.validate([-44.5, -22.9])).toBe(true);
    });

    it('aceita um terceiro componente extra', () => {
        expect(geom.validate([1, 2, 300])).toBe(true);
    });

    it('rejeita ausente, curto e nao-array', () => {
        expect(geom.validate(null)).toBe(false);
        expect(geom.validate(undefined)).toBe(false);
        expect(geom.validate([])).toBe(false);
        expect(geom.validate([1])).toBe(false);
        expect(geom.validate('0,0')).toBe(false);
        expect(geom.validate({ lng: 0, lat: 0 })).toBe(false);
    });

    it('rejeita coordenada em string, null e NaN', () => {
        expect(geom.validate(['0', '0'])).toBe(false);
        expect(geom.validate([null, null])).toBe(false);
        expect(geom.validate([NaN, 0])).toBe(false);
        expect(geom.validate([0, NaN])).toBe(false);
    });

    // Nothing checks the geographic range: the guard is type + NaN only.
    it('NAO checa faixa geografica: 400 de longitude passa', () => {
        expect(geom.validate([400, 200])).toBe(true);
    });

    // CONTROL: the symbol is reachable and it DOES discriminate, so the Infinity
    // case below cannot pass vacuously against a guard that rejects everything.
    it('controle: validate discrimina (par bom true, NaN false)', () => {
        expect(geom.validate([0, 0])).toBe(true);
        expect(geom.validate([NaN, 0])).toBe(false);
    });

    // Ex-DEFEITO, corrigido em 2026-08-24. `isNaN(Infinity)` is false and
    // `typeof Infinity === 'number'`, so an infinite coordinate was accepted and
    // flowed all the way into `calculateSelectionBoxGeometry` (see the Infinity
    // case below, which now gets a null). The guard is Number.isFinite now, the
    // same one the circle, line, polygon and ellipse tools use.
    it('rejeita coordenada Infinity, como circle/line/polygon fazem', () => {
        expect(geom.validate([Infinity, 0])).toBe(false);
        expect(geom.validate([0, -Infinity])).toBe(false);
    });

    it('isValidPoint delega e concorda com validate em toda entrada', () => {
        const cases = [
            null, undefined, [], [1], [1, 2], [1, 2, 3], ['1', '2'],
            [NaN, 0], [0, NaN], [Infinity, 0], 'x', {}, [null, null],
        ];
        expect(cases.length).toBe(13);
        for (const c of cases) {
            expect(geom.isValidPoint(c)).toBe(geom.validate(c));
        }
    });

    it('propriedade: todo par finito e aceito', () => {
        fc.assert(fc.property(
            fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
            fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
            (a, b) => {
                expect(geom.validate([a, b])).toBe(true);
            }
        ));
    });
});

// ============================================================================
// createPointGeometry / generate
// ============================================================================

describe('AddPointGeometry.createPointGeometry', () => {
    it('devolve um Point GeoJSON', () => {
        expect(geom.createPointGeometry([1, 2])).toEqual({ type: 'Point', coordinates: [1, 2] });
    });

    // Contrast with AddImageGeometry.generatePointGeometry, which rebuilds the pair
    // as [c[0], c[1]] and therefore DROPS the third component.
    it('PRESERVA o terceiro componente (z), ao contrario da ferramenta de imagem', () => {
        expect(geom.createPointGeometry([1, 2, 300]).coordinates).toEqual([1, 2, 300]);
    });

    it('copia o array: mutar a saida nao altera a entrada', () => {
        const input = [1, 2];
        const out = geom.createPointGeometry(input);
        expect(out.coordinates).not.toBe(input);
        out.coordinates[0] = 99;
        expect(input[0]).toBe(1);
    });

    // Unlike the image tool, which silently produces garbage geometry.
    it('LANCA em coordenada invalida, em vez de gerar geometria ruim', () => {
        expect(() => geom.createPointGeometry(null)).toThrow('Invalid coordinates for point geometry');
        expect(() => geom.createPointGeometry([1])).toThrow();
        expect(() => geom.createPointGeometry(['a', 'b'])).toThrow();
        expect(() => geom.createPointGeometry([NaN, 0])).toThrow();
    });

    it('generate delega e portanto tambem lanca', () => {
        expect(geom.generate([3, 4])).toEqual({ type: 'Point', coordinates: [3, 4] });
        expect(() => geom.generate([NaN, 0])).toThrow();
    });
});

// ============================================================================
// normalizeCoordinates
// ============================================================================

describe('AddPointGeometry.normalizeCoordinates', () => {
    it('faz parse de um array em JSON', () => {
        expect(geom.normalizeCoordinates('[1,2]')).toEqual([1, 2]);
    });

    it('JSON malformado devolve null', () => {
        expect(geom.normalizeCoordinates('{oops')).toBeNull();
    });

    // JSON.parse succeeds and yields a scalar; the array guard is what saves it.
    it('JSON escalar valido ainda devolve null pelo guarda de array', () => {
        expect(geom.normalizeCoordinates('5')).toBeNull();
        expect(geom.normalizeCoordinates('null')).toBeNull();
        expect(geom.normalizeCoordinates('"1,2"')).toBeNull();
    });

    it('array curto ou ausente devolve null', () => {
        expect(geom.normalizeCoordinates([1])).toBeNull();
        expect(geom.normalizeCoordinates([])).toBeNull();
        expect(geom.normalizeCoordinates(null)).toBeNull();
        expect(geom.normalizeCoordinates(undefined)).toBeNull();
    });

    // The normalizer is weaker than `validate`: it only checks arrayness and length.
    it('NAO valida numeros: par de strings passa (mais fraco que validate)', () => {
        expect(geom.normalizeCoordinates(['a', 'b'])).toEqual(['a', 'b']);
        expect(geom.validate(['a', 'b'])).toBe(false);
    });

    it('array valido volta POR REFERENCIA, nao copiado', () => {
        const input = [1, 2];
        expect(geom.normalizeCoordinates(input)).toBe(input);
    });
});

// ============================================================================
// getCenter / applyOffset / getBoundingBox
// ============================================================================

describe('AddPointGeometry.getCenter', () => {
    it('devolve as proprias coordenadas', () => {
        expect(geom.getCenter([1, 2])).toEqual([1, 2]);
    });

    it('invalido devolve null', () => {
        expect(geom.getCenter([NaN, 0])).toBeNull();
        expect(geom.getCenter(null)).toBeNull();
    });

    // No copy: the caller gets an alias, so mutating the "center" mutates the point.
    it('devolve a MESMA referencia, nao uma copia', () => {
        const input = [1, 2];
        expect(geom.getCenter(input)).toBe(input);
    });
});

describe('AddPointGeometry.applyOffset', () => {
    it('soma os deltas e devolve um novo array', () => {
        const input = [10, 20];
        const out = geom.applyOffset(input, 1, -2);
        expect(out).toEqual([11, 18]);
        expect(out).not.toBe(input);
    });

    it('descarta z ao deslocar', () => {
        expect(geom.applyOffset([1, 2, 3], 0, 0)).toEqual([1, 2]);
    });

    // No-op on invalid input: the ORIGINAL value comes back, identical reference.
    it('coordenada invalida volta inalterada, pela mesma referencia', () => {
        const bad = [NaN, 0];
        expect(geom.applyOffset(bad, 5, 5)).toBe(bad);
        expect(geom.applyOffset(null, 5, 5)).toBeNull();
        expect(geom.applyOffset('x', 5, 5)).toBe('x');
    });

    // The guard covers the coordinates, never the deltas.
    it('delta NaN nao e guardado e contamina a saida', () => {
        expect(geom.applyOffset([1, 2], NaN, 0)[0]).toBeNaN();
    });

    it('propriedade: round-trip +d/-d volta ao ponto de partida', () => {
        fc.assert(fc.property(
            fc.double({ min: -170, max: 170, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: -5, max: 5, noNaN: true }),
            fc.double({ min: -5, max: 5, noNaN: true }),
            (lng, lat, dx, dy) => {
                const there = geom.applyOffset([lng, lat], dx, dy);
                const back = geom.applyOffset(there, -dx, -dy);
                expect(back[0]).toBeCloseTo(lng, 9);
                expect(back[1]).toBeCloseTo(lat, 9);
            }
        ));
    });
});

describe('AddPointGeometry.getBoundingBox', () => {
    it('e degenerado: min e max coincidem', () => {
        expect(geom.getBoundingBox([1, 2])).toEqual([1, 2, 1, 2]);
    });

    it('descarta z', () => {
        expect(geom.getBoundingBox([1, 2, 3])).toEqual([1, 2, 1, 2]);
    });

    it('invalido devolve null (nao um bbox de NaN)', () => {
        expect(geom.getBoundingBox([NaN, 0])).toBeNull();
        expect(geom.getBoundingBox(null)).toBeNull();
        expect(geom.getBoundingBox([1])).toBeNull();
    });
});

// ============================================================================
// calculateSelectionBoxGeometry
// ============================================================================

describe('AddPointGeometry.calculateSelectionBoxGeometry', () => {
    it('devolve null em coordenada invalida, sem lancar', () => {
        expect(geom.calculateSelectionBoxGeometry(null, 10, 2, 12)).toBeNull();
        expect(geom.calculateSelectionBoxGeometry([NaN, 0], 10, 2, 12)).toBeNull();
        expect(geom.calculateSelectionBoxGeometry([1], 10, 2, 12)).toBeNull();
    });

    it('produz um anel FECHADO de 5 vertices', () => {
        const box = geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12);
        expect(box.type).toBe('Polygon');
        expect(box.coordinates.length).toBe(1);
        const ring = box.coordinates[0];
        expect(ring.length).toBe(5);
        expect(ring[0]).toEqual(ring[4]);
    });

    // The whole composition in one number: diameter = size*2, plus lineWidth,
    // plus 2*2 of padding, converted at the centre latitude and halved.
    it('bate com a formula re-derivada: (size*2 + lineWidth + 4) px, convertidos e divididos por 2', () => {
        const lat = -22.9;
        const box = geom.calculateSelectionBoxGeometry([-44.5, lat], 10, 3, 14);
        const ring = box.coordinates[0];
        const half = expectedHalfExtent(10, 3, lat, 14);
        expect(ring[1][0] - ring[0][0]).toBeCloseTo(2 * half, 12);
        expect(ring[0][0]).toBeCloseTo(-44.5 - half, 12);
        expect(ring[0][1]).toBeCloseTo(lat + half, 12);
    });

    it('a caixa e quadrada em grau: mesma extensao em lng e lat', () => {
        const ring = geom.calculateSelectionBoxGeometry([0, 45], 10, 2, 12).coordinates[0];
        const lngs = ring.map(p => p[0]);
        const lats = ring.map(p => p[1]);
        expect(Math.max(...lngs) - Math.min(...lngs))
            .toBeCloseTo(Math.max(...lats) - Math.min(...lats), 12);
    });

    // `lineWidth || 0`: NaN is falsy, so it lands on 0 as well as undefined/null.
    it('lineWidth ausente, null ou NaN conta como 0', () => {
        const base = geom.calculateSelectionBoxGeometry([0, 0], 10, 0, 12);
        for (const bad of [undefined, null, NaN]) {
            expect(geom.calculateSelectionBoxGeometry([0, 0], 10, bad, 12)).toEqual(base);
        }
    });

    it('lineWidth alarga a caixa em 1 grau-equivalente por unidade de pixel', () => {
        const thin = geom.calculateSelectionBoxGeometry([0, 0], 10, 0, 12).coordinates[0];
        const thick = geom.calculateSelectionBoxGeometry([0, 0], 10, 4, 12).coordinates[0];
        const grow = (thick[1][0] - thick[0][0]) - (thin[1][0] - thin[0][0]);
        expect(grow).toBeCloseTo(degreesFor(4, 0, 12), 12);
    });

    it('sem effectiveZoom usa createdAtZoom', () => {
        const a = geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12);
        const b = geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12, null);
        expect(a).toEqual(b);
    });

    it('effectiveZoom substitui createdAtZoom', () => {
        const withOverride = geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12, 18);
        const atEighteen = geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 18);
        expect(withOverride).toEqual(atEighteen);
    });

    // REGRESSION. The check is `effectiveZoom !== null`, not truthiness, so zoom 0
    // (the whole world in one tile) is honoured. A `!effectiveZoom` here would fall
    // back to createdAtZoom and draw a box orders of magnitude too small.
    it('effectiveZoom 0 e usado: zero e zoom valido, nao valor falsy', () => {
        const atZero = geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12, 0);
        const expected = expectedHalfExtent(10, 2, 0, 0);
        expect(atZero.coordinates[0][1][0]).toBeCloseTo(expected, 12);
        // And it is NOT the createdAtZoom=12 box.
        expect(atZero).not.toEqual(geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12));
    });

    it('effectiveZoom undefined aciona o default e cai para createdAtZoom', () => {
        expect(geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12, undefined))
            .toEqual(geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12));
    });

    it('a caixa encolhe pela metade a cada nivel de zoom ganho', () => {
        const at12 = geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12).coordinates[0];
        const at13 = geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 13).coordinates[0];
        const w12 = at12[1][0] - at12[0][0];
        const w13 = at13[1][0] - at13[0][0];
        expect(w13).toBeCloseTo(w12 / 2, 14);
    });

    // cos(90 degrees) is 6.1e-17, not exactly 0, so the box collapses to a
    // sub-nanometre square instead of disappearing or blowing up.
    it('no polo a caixa colapsa: cos(90) leva a extensao a praticamente zero', () => {
        const ring = geom.calculateSelectionBoxGeometry([0, 90], 10, 2, 12).coordinates[0];
        const width = ring[1][0] - ring[0][0];
        expect(width).toBeGreaterThan(0);
        expect(width).toBeLessThan(1e-15);
    });

    // Past the pole cos(lat) turns negative and the ring is emitted inverted, with
    // no guard anywhere. `validate` does not check the geographic range, so a
    // latitude of 100 reaches here intact.
    it('latitude alem de 90 inverte o anel (cos negativo), sem recusa', () => {
        const ring = geom.calculateSelectionBoxGeometry([0, 100], 10, 2, 12).coordinates[0];
        expect(ring[1][0]).toBeLessThan(ring[0][0]);
    });

    // Consequence of the `validate` fix of 2026-08-24: an infinite coordinate used
    // to be accepted here and produced a whole ring of NaN. It is refused now.
    it('coordenada Infinity devolve null, nao um anel de NaN', () => {
        expect(geom.calculateSelectionBoxGeometry([0, Infinity], 10, 2, 12)).toBeNull();
        expect(geom.calculateSelectionBoxGeometry([-Infinity, 0], 10, 2, 12)).toBeNull();
    });

    it('size 0 e lineWidth 0 ainda deixam a caixa do padding (2 px por lado)', () => {
        const ring = geom.calculateSelectionBoxGeometry([0, 0], 0, 0, 12).coordinates[0];
        expect(ring[1][0] - ring[0][0]).toBeCloseTo(degreesFor(4, 0, 12), 14);
    });

    it('propriedade: anel fechado, centrado e com extensao igual a formula re-derivada', () => {
        fc.assert(fc.property(
            fc.double({ min: -170, max: 170, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: 0, max: 60, noNaN: true }),
            fc.double({ min: 0, max: 10, noNaN: true }),
            fc.double({ min: 1, max: 22, noNaN: true }),
            (lng, lat, size, lineWidth, zoom) => {
                const ring = geom.calculateSelectionBoxGeometry([lng, lat], size, lineWidth, zoom).coordinates[0];
                expect(ring.length).toBe(5);
                expect(ring[0]).toEqual(ring[4]);
                const lngs = ring.map(p => p[0]);
                const lats = ring.map(p => p[1]);
                expect((Math.min(...lngs) + Math.max(...lngs)) / 2).toBeCloseTo(lng, 9);
                expect((Math.min(...lats) + Math.max(...lats)) / 2).toBeCloseTo(lat, 9);
                const half = expectedHalfExtent(size, lineWidth, lat, zoom);
                expect(Math.max(...lngs) - Math.min(...lngs)).toBeCloseTo(2 * half, 12);
            }
        ));
    });

    it('propriedade: o ponto de origem esta sempre DENTRO da caixa', () => {
        fc.assert(fc.property(
            fc.double({ min: -170, max: 170, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: 0.1, max: 60, noNaN: true }),
            fc.double({ min: 1, max: 22, noNaN: true }),
            (lng, lat, size, zoom) => {
                const ring = geom.calculateSelectionBoxGeometry([lng, lat], size, 1, zoom).coordinates[0];
                const lngs = ring.map(p => p[0]);
                const lats = ring.map(p => p[1]);
                expect(Math.min(...lngs)).toBeLessThan(lng);
                expect(Math.max(...lngs)).toBeGreaterThan(lng);
                expect(Math.min(...lats)).toBeLessThan(lat);
                expect(Math.max(...lats)).toBeGreaterThan(lat);
            }
        ));
    });
});

// ============================================================================
// recalculateSelectionBox
// ============================================================================

describe('AddPointGeometry.recalculateSelectionBox', () => {
    const featureWith = (props) => ({
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { size: 10, lineWidth: 2, sizeCreatedAtZoom: 12, ...props },
    });

    it('com correcao de zoom LIGADA ignora o zoom corrente e usa sizeCreatedAtZoom', () => {
        expect(geom.recalculateSelectionBox(featureWith({ sizeZoomCorrectionEnabled: true }), 18))
            .toEqual(geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12));
    });

    it('propriedade ausente conta como ligada (so `=== false` desliga)', () => {
        expect(geom.recalculateSelectionBox(featureWith({}), 18))
            .toEqual(geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12));
    });

    it('com correcao DESLIGADA usa o zoom corrente', () => {
        expect(geom.recalculateSelectionBox(featureWith({ sizeZoomCorrectionEnabled: false }), 18))
            .toEqual(geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 18));
    });

    it("a string 'false' NAO desliga a correcao (comparacao estrita)", () => {
        expect(geom.recalculateSelectionBox(featureWith({ sizeZoomCorrectionEnabled: 'false' }), 18))
            .toEqual(geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12));
    });

    it('correcao desligada com zoom corrente 0 usa 0, nao sizeCreatedAtZoom', () => {
        expect(geom.recalculateSelectionBox(featureWith({ sizeZoomCorrectionEnabled: false }), 0))
            .toEqual(geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 0));
    });

    // Ex-DEFEITO de FALSY-ZERO, corrigido em 2026-08-24: `size || 10` media um
    // ponto de tamanho 0 (um marcador invisivel legitimo) como se fosse o padrao
    // 10, e a caixa de selecao saia muito maior que o marcador.
    it('size 0 e medido como 0, nao como o default 10', () => {
        expect(geom.recalculateSelectionBox(featureWith({ size: 0 }), null))
            .toEqual(geom.calculateSelectionBoxGeometry([0, 0], 0, 2, 12));
        // Control: the two boxes really are different, so the case discriminates.
        expect(geom.calculateSelectionBoxGeometry([0, 0], 0, 2, 12))
            .not.toEqual(geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12));
    });

    it('size ausente ou NaN ainda cai para o default 10', () => {
        for (const bad of [undefined, null, NaN, 'x']) {
            expect(geom.recalculateSelectionBox(featureWith({ size: bad }), null))
                .toEqual(geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 12));
        }
    });

    // Same coalescing on the anchor zoom, but here 0 maps to 0, so it is harmless.
    it('sizeCreatedAtZoom ausente vira 0, o que produz a caixa de mundo inteiro', () => {
        expect(geom.recalculateSelectionBox(featureWith({ sizeCreatedAtZoom: undefined }), null))
            .toEqual(geom.calculateSelectionBoxGeometry([0, 0], 10, 2, 0));
    });

    it('lineWidth ausente vira 0', () => {
        expect(geom.recalculateSelectionBox(featureWith({ lineWidth: undefined }), null))
            .toEqual(geom.calculateSelectionBoxGeometry([0, 0], 10, 0, 12));
    });

    it('geometria invalida devolve null em vez de lancar', () => {
        const broken = { geometry: { coordinates: [NaN, 0] }, properties: {} };
        expect(geom.recalculateSelectionBox(broken, 12)).toBeNull();
    });
});

// ============================================================================
// Assinatura de 5 argumentos e o sitio de criacao
// ============================================================================

describe('AddPointGeometry: a assinatura de 5 argumentos e o sitio de criacao', () => {
    it('a funcao declara 4 parametros obrigatorios (o quinto tem default)', () => {
        expect(AddPointGeometry.prototype.calculateSelectionBoxGeometry.length).toBe(4);
    });

    // `createPointAtCoordinates` (add_point_control.js) calls this with FOUR
    // arguments, passing the CURRENT zoom as createdAtZoom and letting
    // `effectiveZoom` default to null. That is correct at creation time, because
    // the feature is stamped with `sizeCreatedAtZoom: currentZoom` in the same
    // breath, so both branches of the ternary resolve to the same number. This
    // test states the equivalence so a future signature change cannot break the
    // creation path silently.
    it('no instante da criacao os dois ramos coincidem: 4 args === 5 args com o mesmo zoom', () => {
        const currentZoom = 15.5;
        const fourArgs = geom.calculateSelectionBoxGeometry([-44.5, -22.9], 10, 2, currentZoom);
        const fiveArgs = geom.calculateSelectionBoxGeometry([-44.5, -22.9], 10, 2, currentZoom, currentZoom);
        expect(fourArgs).toEqual(fiveArgs);
    });
});

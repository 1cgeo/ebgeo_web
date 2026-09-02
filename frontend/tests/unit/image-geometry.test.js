// Path: tests/unit/image-geometry.test.js

/**
 * @fileoverview Unit tests for AddImageGeometry (`draw_tools/image_tool/add_image_geometry.js`).
 *
 * WHAT THIS SUITE PINS
 * - `calculateZoomAdjustedSize`: the clamp is 10 here, NOT the 255 of the text tool,
 *   and it is a one-sided clamp applied AFTER the power, so a base above 10 is
 *   capped even with zoom difference 0, and a negative base is not bounded at all.
 * - `calculateSelectionBoxGeometry`: the wiring only, PLUS the coercion of the
 *   dimensions (2026-09-02), because this is the single funnel through which an
 *   image's width and height reach the drawing. The pixel-to-degree math is the
 *   caller's (`uiManager`), so it is stubbed and its ARGUMENTS are asserted: the
 *   0.625 scale, the padding counted twice, the finiteness test that keeps zoom 0 a
 *   usable zoom instead of a falsy one, and the fallbacks for a feature whose
 *   `width`/`height`/`size`/`createdAtZoom` are missing or not finite.
 * - `createSelectionBoxFromDegrees`: the ring is closed with five vertices, the
 *   fifth repeats the first, and a non-finite span falls back per axis instead of
 *   putting NaN into every vertex.
 * - `getBoundingBox`: it divides BOTH axes by 111320 with no cos(lat) correction,
 *   which is a real divergence from the selection box that the tests state out loud.
 * - `normalizeCoordinates`, `moveImage`, `generate`, `createHandles`,
 *   `updateFromHandle`, `recalculateSelectionBox`.
 *
 * WHAT IT DOES NOT REACH
 * - Nothing in `add_image_control.js`: rendering, MapLibre sources, the image blob
 *   pipeline and the actual `uiManager` implementation are all outside the module.
 * - The real `calculateExpandedDimensions` (rotation-expanded AABB) lives in the UI
 *   manager and is a separate target; here it is a stub, so a rotation bug there
 *   would NOT turn this suite red.
 * - Whether the geographic box matches what is drawn on screen: only the formula is
 *   pinned, never a pixel.
 *
 * FIXED ON 2026-08-24: `validate` (and `isValidPosition`, which now delegates to it)
 * rejects a non-finite coordinate, like circle/line/polygon/ellipse already did.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';

// add_image_geometry imports BaseGeometry from the `@tools` barrel, which pulls in
// DOM/MapLibre-coupled modules. Mock the barrel with a trivial BaseGeometry so the
// pure math can be exercised in the `node` environment.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
    },
}));

const { default: AddImageGeometry, IMAGE_BOX_FALLBACKS } = await import('../../src/js/draw_tools/image_tool/add_image_geometry.js');

const geom = new AddImageGeometry();

/**
 * Stub UI manager. `calculateExpandedDimensions` is the identity (so the rotation
 * expansion never masks the scale arithmetic under test) and `pixelsToDegrees` is a
 * linear stand-in that records the zoom it was handed.
 */
function makeUiManager() {
    return {
        calculateExpandedDimensions: vi.fn((width, height) => ({ width, height })),
        pixelsToDegrees: vi.fn((pixels) => pixels / 1000),
    };
}

// `normalizeCoordinates` logs on every rejection; keep the run readable.
let errorSpy;
beforeAll(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { errorSpy.mockRestore(); });

// ============================================================================
// calculateZoomAdjustedSize
// ============================================================================

describe('AddImageGeometry.calculateZoomAdjustedSize', () => {
    it('dobra o tamanho a cada nivel de zoom ganho', () => {
        expect(geom.calculateZoomAdjustedSize(1, 15, 16)).toBe(2);
        expect(geom.calculateZoomAdjustedSize(1, 15, 17)).toBe(4);
    });

    it('devolve o tamanho base quando a diferenca de zoom e zero', () => {
        expect(geom.calculateZoomAdjustedSize(3, 12, 12)).toBe(3);
    });

    it('divide pela metade a cada nivel de zoom perdido, sem piso', () => {
        expect(geom.calculateZoomAdjustedSize(1, 15, 14)).toBe(0.5);
        expect(geom.calculateZoomAdjustedSize(1, 15, 5)).toBeCloseTo(2 ** -10, 12);
    });

    it('clampa em 10, nao em 255 como a ferramenta de texto', () => {
        expect(geom.calculateZoomAdjustedSize(1, 0, 20)).toBe(10);
    });

    // The clamp is applied to the PRODUCT, so a base already above the ceiling is
    // capped even though no zoom scaling happened at all.
    it('clampa uma base acima de 10 mesmo com diferenca de zoom zero', () => {
        expect(geom.calculateZoomAdjustedSize(11, 5, 5)).toBe(10);
    });

    it('base 0 permanece 0 em qualquer zoom', () => {
        expect(geom.calculateZoomAdjustedSize(0, 0, 20)).toBe(0);
        expect(geom.calculateZoomAdjustedSize(0, 20, 0)).toBe(0);
    });

    // Math.min is a one-sided clamp: nothing bounds the result from below.
    it('base negativa NAO e clampada (Math.min so tem teto)', () => {
        expect(geom.calculateZoomAdjustedSize(-4, 10, 10)).toBe(-4);
        expect(geom.calculateZoomAdjustedSize(-4, 0, 20)).toBeLessThan(-4);
    });

    it('createdAtZoom +Infinity colapsa para 0 (2 elevado a -Infinity)', () => {
        expect(geom.calculateZoomAdjustedSize(5, Infinity, 10)).toBe(0);
    });

    it('currentZoom +Infinity satura no teto de 10', () => {
        expect(geom.calculateZoomAdjustedSize(5, 10, Infinity)).toBe(10);
    });

    // `Math.min(NaN, 10)` is NaN, so the ceiling does not sanitise a bad zoom:
    // the caller receives NaN and writes it into the feature.
    it('zoom NaN propaga NaN, o teto nao sanitiza', () => {
        expect(geom.calculateZoomAdjustedSize(2, NaN, 10)).toBeNaN();
        expect(geom.calculateZoomAdjustedSize(2, 10, NaN)).toBeNaN();
    });

    it('dois zooms infinitos de mesmo sinal dao NaN (Infinity - Infinity)', () => {
        expect(geom.calculateZoomAdjustedSize(2, Infinity, Infinity)).toBeNaN();
    });

    it('propriedade: base finita nao negativa nunca ultrapassa 10 nem fica negativa', () => {
        fc.assert(fc.property(
            fc.double({ min: 0, max: 1000, noNaN: true }),
            fc.double({ min: -30, max: 30, noNaN: true }),
            fc.double({ min: -30, max: 30, noNaN: true }),
            (base, createdAt, current) => {
                const out = geom.calculateZoomAdjustedSize(base, createdAt, current);
                expect(out).toBeLessThanOrEqual(10);
                expect(out).toBeGreaterThanOrEqual(0);
            }
        ));
    });

    it('propriedade: monotonico nao decrescente no zoom corrente', () => {
        fc.assert(fc.property(
            fc.double({ min: 0.01, max: 100, noNaN: true }),
            fc.double({ min: -20, max: 20, noNaN: true }),
            fc.double({ min: -20, max: 20, noNaN: true }),
            fc.double({ min: 0, max: 20, noNaN: true }),
            (base, createdAt, current, delta) => {
                const lower = geom.calculateZoomAdjustedSize(base, createdAt, current);
                const higher = geom.calculateZoomAdjustedSize(base, createdAt, current + delta);
                expect(higher).toBeGreaterThanOrEqual(lower);
            }
        ));
    });
});

// ============================================================================
// validate / isValidPosition
// ============================================================================

describe('AddImageGeometry.validate', () => {
    it('aceita um par numerico', () => {
        expect(geom.validate([0, 0])).toBe(true);
        expect(geom.validate([-44.5, -22.9])).toBe(true);
    });

    it('aceita um terceiro componente extra', () => {
        expect(geom.validate([1, 2, 300])).toBe(true);
    });

    it('rejeita ausente, curto e nao-array', () => {
        expect(geom.validate(null)).toBeFalsy();
        expect(geom.validate(undefined)).toBeFalsy();
        expect(geom.validate([])).toBe(false);
        expect(geom.validate([1])).toBe(false);
        expect(geom.validate('0,0')).toBe(false);
    });

    it('rejeita coordenada em string e NaN', () => {
        expect(geom.validate(['0', '0'])).toBe(false);
        expect(geom.validate([NaN, 0])).toBe(false);
        expect(geom.validate([0, NaN])).toBe(false);
    });

    // CONTROL: the symbol is reachable and it DOES discriminate, so the Infinity
    // case below cannot pass vacuously against a guard that rejects everything.
    it('controle: validate discrimina (par bom true, NaN false)', () => {
        expect(geom.validate([0, 0])).toBe(true);
        expect(geom.validate([NaN, 0])).toBe(false);
    });

    // Ex-DEFEITO, corrigido em 2026-08-24. `isNaN(Infinity)` is false and
    // `typeof Infinity === 'number'`, so an infinite coordinate was accepted here
    // while the circle, line, polygon and ellipse tools already rejected it
    // (see tests/unit/circle-geometry.test.js). The guard is Number.isFinite now.
    it('rejeita coordenada Infinity, como circle/line/polygon fazem', () => {
        expect(geom.validate([Infinity, 0])).toBe(false);
        expect(geom.validate([0, -Infinity])).toBe(false);
    });

    it('isValidPosition e validate concordam em toda entrada', () => {
        const cases = [
            null, undefined, [], [1], [1, 2], [1, 2, 3], ['1', '2'],
            [NaN, 0], [0, NaN], [Infinity, 0], 'x', {}, [null, null],
        ];
        expect(cases.length).toBe(13);
        for (const c of cases) {
            expect(Boolean(geom.isValidPosition(c))).toBe(Boolean(geom.validate(c)));
        }
    });
});

// ============================================================================
// normalizeCoordinates
// ============================================================================

describe('AddImageGeometry.normalizeCoordinates', () => {
    it('faz parse de um array em JSON', () => {
        expect(geom.normalizeCoordinates('[1,2]')).toEqual([1, 2]);
    });

    it('JSON malformado devolve null', () => {
        expect(geom.normalizeCoordinates('nao e json')).toBeNull();
    });

    // JSON.parse succeeds and yields a scalar; the array guard is what saves it.
    it('JSON escalar valido ainda devolve null pelo guarda de array', () => {
        expect(geom.normalizeCoordinates('5')).toBeNull();
        expect(geom.normalizeCoordinates('null')).toBeNull();
        expect(geom.normalizeCoordinates('{"lng":1}')).toBeNull();
    });

    it('array curto devolve null', () => {
        expect(geom.normalizeCoordinates([1])).toBeNull();
        expect(geom.normalizeCoordinates([])).toBeNull();
        expect(geom.normalizeCoordinates(null)).toBeNull();
    });

    // No numeric validation at all: the guard is length + arrayness only.
    it('array de strings passa: nao ha validacao numerica aqui', () => {
        expect(geom.normalizeCoordinates(['a', 'b'])).toEqual(['a', 'b']);
    });

    it('array valido volta POR REFERENCIA, nao copiado', () => {
        const input = [1, 2];
        expect(geom.normalizeCoordinates(input)).toBe(input);
    });

    // Found by the property below before it was narrowed: `JSON.stringify(-0)` is
    // the string "0", so the round-trip through a serialised coordinate silently
    // loses the sign of negative zero. Harmless for a coordinate, but it is the
    // reason the property compares numerically instead of with deep equality.
    it('round-trip por JSON perde o -0 (vira +0)', () => {
        const out = geom.normalizeCoordinates(JSON.stringify([0, -0]));
        expect(out).toEqual([0, 0]);
        expect(Object.is(out[1], -0)).toBe(false);
    });

    it('propriedade: round-trip por JSON preserva o par numericamente', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -90, max: 90, noNaN: true }),
            (lng, lat) => {
                const out = geom.normalizeCoordinates(JSON.stringify([lng, lat]));
                expect(out.length).toBe(2);
                expect(out[0] === lng).toBe(true);
                expect(out[1] === lat).toBe(true);
            }
        ));
    });
});

// ============================================================================
// calculateSelectionBoxGeometry (wiring into uiManager)
// ============================================================================

describe('AddImageGeometry.calculateSelectionBoxGeometry', () => {
    it('escala width/height por size e pelo fator 0.625 antes de expandir', () => {
        const ui = makeUiManager();
        geom.calculateSelectionBoxGeometry([0, 0], 100, 40, 2, 30, 12, ui);
        expect(ui.calculateExpandedDimensions).toHaveBeenCalledTimes(1);
        expect(ui.calculateExpandedDimensions).toHaveBeenCalledWith(125, 50, 30);
    });

    it('soma o padding DUAS vezes (uma por lado) em cada eixo', () => {
        const ui = makeUiManager();
        geom.calculateSelectionBoxGeometry([0, 0], 100, 40, 1, 0, 12, ui);
        // expanded = (62.5, 25) pelo stub identidade; padding 5 vira +10 em cada eixo.
        expect(ui.pixelsToDegrees.mock.calls.length).toBe(2);
        expect(ui.pixelsToDegrees.mock.calls[0][0]).toBeCloseTo(72.5, 10);
        expect(ui.pixelsToDegrees.mock.calls[1][0]).toBeCloseTo(35, 10);
    });

    it('usa a latitude do centro nas duas conversoes', () => {
        const ui = makeUiManager();
        geom.calculateSelectionBoxGeometry([-44.5, -22.9], 10, 10, 1, 0, 12, ui);
        expect(ui.pixelsToDegrees.mock.calls[0][1]).toBe(-22.9);
        expect(ui.pixelsToDegrees.mock.calls[1][1]).toBe(-22.9);
    });

    it('sem effectiveZoom usa createdAtZoom', () => {
        const ui = makeUiManager();
        geom.calculateSelectionBoxGeometry([0, 0], 10, 10, 1, 0, 12, ui);
        expect(ui.pixelsToDegrees.mock.calls[0][2]).toBe(12);
    });

    it('effectiveZoom explicito substitui createdAtZoom', () => {
        const ui = makeUiManager();
        geom.calculateSelectionBoxGeometry([0, 0], 10, 10, 1, 0, 12, ui, 18);
        expect(ui.pixelsToDegrees.mock.calls[0][2]).toBe(18);
    });

    // REGRESSION. The test is `effectiveZoom !== null`, not a truthiness test, so
    // zoom 0 (a real zoom, the whole world in one tile) is honoured. A `!effectiveZoom`
    // here would silently fall back to createdAtZoom and draw the box at the wrong scale.
    it('effectiveZoom 0 e usado: zero e zoom valido, nao valor falsy', () => {
        const ui = makeUiManager();
        geom.calculateSelectionBoxGeometry([0, 0], 10, 10, 1, 0, 12, ui, 0);
        expect(ui.pixelsToDegrees.mock.calls[0][2]).toBe(0);
    });

    it('effectiveZoom null explicito cai para createdAtZoom', () => {
        const ui = makeUiManager();
        geom.calculateSelectionBoxGeometry([0, 0], 10, 10, 1, 0, 7, ui, null);
        expect(ui.pixelsToDegrees.mock.calls[0][2]).toBe(7);
    });

    // `effectiveZoom = null` is a DEFAULT parameter, and defaults only fire for
    // `undefined`. Passing undefined therefore behaves like passing nothing.
    it('effectiveZoom undefined aciona o default e cai para createdAtZoom', () => {
        const ui = makeUiManager();
        geom.calculateSelectionBoxGeometry([0, 0], 10, 10, 1, 0, 9, ui, undefined);
        expect(ui.pixelsToDegrees.mock.calls[0][2]).toBe(9);
    });

    // ------------------------------------------------------------------
    // Coercao das dimensoes (2026-09-02). Esta funcao e o FUNIL UNICO por onde a
    // largura e a altura de uma imagem entram no desenho: os seis sitios de
    // `add_image_control.js` leem `properties.width`/`properties.height` cru, e um
    // `.ebgeo` antigo traz esses numeros com outro nome (`largura`/`altura`) e sem
    // `createdAtZoom` nenhum. Sem a coercao, todo produto abaixo era NaN.
    // ------------------------------------------------------------------

    it('width/height ausentes caem na dimensao declarada, sem NaN', () => {
        const ui = makeUiManager();
        geom.calculateSelectionBoxGeometry([0, 0], undefined, undefined, 1, 0, 12, ui);
        // 100 * 1 * 0.625 = 62.5 pelo stub identidade; +10 do padding nos dois lados.
        expect(ui.calculateExpandedDimensions).toHaveBeenCalledWith(62.5, 62.5, 0);
        expect(ui.pixelsToDegrees.mock.calls[0][0]).toBeCloseTo(72.5, 10);
    });

    it('width/height NaN, zero e negativo caem no mesmo fallback', () => {
        for (const par of [[NaN, NaN], [0, 0], [-10, -10], [Infinity, Infinity]]) {
            const ui = makeUiManager();
            geom.calculateSelectionBoxGeometry([0, 0], par[0], par[1], 1, 0, 12, ui);
            expect(ui.calculateExpandedDimensions).toHaveBeenCalledWith(62.5, 62.5, 0);
        }
    });

    it('size e rotation nao finitos caem em 1 e 0; rotation negativa e legitima', () => {
        const ui = makeUiManager();
        geom.calculateSelectionBoxGeometry([0, 0], 100, 40, NaN, NaN, 12, ui);
        expect(ui.calculateExpandedDimensions).toHaveBeenCalledWith(62.5, 25, 0);

        const ui2 = makeUiManager();
        geom.calculateSelectionBoxGeometry([0, 0], 100, 40, 1, -45, 12, ui2);
        expect(ui2.calculateExpandedDimensions).toHaveBeenCalledWith(62.5, 25, -45);
    });

    // CONTROLE POSITIVO: a coercao nao reescreve o caso bom. Sem esta linha, uma
    // guarda que devolvesse SEMPRE o fallback deixaria os tres casos acima verdes.
    it('controle: width/height finitos passam intactos pela coercao', () => {
        const ui = makeUiManager();
        geom.calculateSelectionBoxGeometry([0, 0], 100, 40, 2, 30, 12, ui);
        expect(ui.calculateExpandedDimensions).toHaveBeenCalledWith(125, 50, 30);
    });

    it('sem zoom usavel o poligono sai finito, pelo fallback em graus', () => {
        // `pixelsToDegrees` real devolve NaN para zoom undefined; aqui o stub imita
        // isso para medir o que o funil faz com o resultado.
        const ui = {
            calculateExpandedDimensions: vi.fn((w, h) => ({ width: w, height: h })),
            pixelsToDegrees: vi.fn((px, _lat, zoom) => (Number.isFinite(zoom) ? px : NaN)),
        };
        const box = geom.calculateSelectionBoxGeometry([10, 20], undefined, undefined, 1, 0, undefined, ui);
        for (const p of box.coordinates[0]) {
            expect(Number.isFinite(p[0])).toBe(true);
            expect(Number.isFinite(p[1])).toBe(true);
        }
    });

    it('devolve um Polygon centrado nas coordenadas', () => {
        const ui = makeUiManager();
        const box = geom.calculateSelectionBoxGeometry([10, 20], 1000, 1000, 1, 0, 12, ui);
        expect(box.type).toBe('Polygon');
        const ring = box.coordinates[0];
        expect(ring.length).toBe(5);
        const lngs = ring.map(p => p[0]);
        const lats = ring.map(p => p[1]);
        expect((Math.min(...lngs) + Math.max(...lngs)) / 2).toBeCloseTo(10, 10);
        expect((Math.min(...lats) + Math.max(...lats)) / 2).toBeCloseTo(20, 10);
    });
});

// ============================================================================
// createSelectionBoxFromDegrees
// ============================================================================

describe('AddImageGeometry.createSelectionBoxFromDegrees', () => {
    it('produz um anel FECHADO de 5 vertices', () => {
        const box = geom.createSelectionBoxFromDegrees([0, 0], 2, 4);
        const ring = box.coordinates[0];
        expect(ring.length).toBe(5);
        expect(ring[0]).toEqual(ring[4]);
    });

    it('metade da largura para cada lado, metade da altura para cima e para baixo', () => {
        const box = geom.createSelectionBoxFromDegrees([10, 20], 2, 4);
        expect(box.coordinates[0]).toEqual([
            [9, 22], [11, 22], [11, 18], [9, 18], [9, 22],
        ]);
    });

    it('degenerado: 0 x 0 colapsa os cinco vertices no centro', () => {
        const ring = geom.createSelectionBoxFromDegrees([3, 4], 0, 0).coordinates[0];
        expect(ring.length).toBe(5);
        for (const p of ring) expect(p).toEqual([3, 4]);
    });

    // No sign guard: a negative extent inverts the ring instead of being rejected.
    it('extensao negativa inverte o anel, nao e recusada', () => {
        const ring = geom.createSelectionBoxFromDegrees([0, 0], -2, -2).coordinates[0];
        expect(ring[0]).toEqual([1, -1]);
        expect(ring[2]).toEqual([-1, 1]);
    });

    // CORRIGIDO EM 2026-09-02 (antes: "NaN de entrada vira NaN em todo vertice").
    // Um vertice NaN nao levanta erro nenhum: ele chega ao MapLibre e deixa de ser
    // observavel como valor. Agora a extensao nao finita cai no fallback declarado,
    // e o eixo SAO tratado de forma independente: so o eixo poluido e substituido.
    it('NaN de entrada cai no fallback declarado, sem NaN em vertice nenhum', () => {
        const ring = geom.createSelectionBoxFromDegrees([0, 0], NaN, 2).coordinates[0];
        expect(ring.length).toBe(5);
        for (const p of ring) {
            expect(Number.isFinite(p[0])).toBe(true);
            expect(Number.isFinite(p[1])).toBe(true);
        }
        const lngs = ring.map(p => p[0]);
        const lats = ring.map(p => p[1]);
        expect(Math.max(...lngs) - Math.min(...lngs)).toBeCloseTo(IMAGE_BOX_FALLBACKS.extentDegrees, 12);
        // O eixo sadio passa intacto: 2 graus continuam 2 graus.
        expect(Math.max(...lats) - Math.min(...lats)).toBeCloseTo(2, 12);
    });

    it('Infinity tambem cai no fallback (a outra metade do nao-finito)', () => {
        const ring = geom.createSelectionBoxFromDegrees([0, 0], Infinity, -Infinity).coordinates[0];
        for (const p of ring) {
            expect(Number.isFinite(p[0])).toBe(true);
            expect(Number.isFinite(p[1])).toBe(true);
        }
    });

    // CONTROLE POSITIVO do fallback: ele nao substitui tudo. Uma entrada finita
    // qualquer, zero e negativo inclusive, continua passando verbatim (os dois casos
    // acima), senao esta guarda estaria verde por recusar todo mundo.
    it('controle: entrada finita normal nao e tocada pelo fallback', () => {
        const ring = geom.createSelectionBoxFromDegrees([10, 20], 2, 4).coordinates[0];
        expect(ring).toEqual([
            [9, 22], [11, 22], [11, 18], [9, 18], [9, 22],
        ]);
    });

    it('propriedade: anel fechado, largura e altura exatas e centro preservado', () => {
        fc.assert(fc.property(
            fc.double({ min: -170, max: 170, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: 0, max: 5, noNaN: true }),
            fc.double({ min: 0, max: 5, noNaN: true }),
            (lng, lat, w, h) => {
                const ring = geom.createSelectionBoxFromDegrees([lng, lat], w, h).coordinates[0];
                expect(ring.length).toBe(5);
                expect(ring[0]).toEqual(ring[4]);
                const lngs = ring.map(p => p[0]);
                const lats = ring.map(p => p[1]);
                expect(Math.max(...lngs) - Math.min(...lngs)).toBeCloseTo(w, 9);
                expect(Math.max(...lats) - Math.min(...lats)).toBeCloseTo(h, 9);
                expect((Math.min(...lngs) + Math.max(...lngs)) / 2).toBeCloseTo(lng, 9);
            }
        ));
    });
});

// ============================================================================
// getBoundingBox
// ============================================================================

describe('AddImageGeometry.getBoundingBox', () => {
    it('devolve [minLng, minLat, maxLng, maxLat] centrado nas coordenadas', () => {
        const [minLng, minLat, maxLng, maxLat] = geom.getBoundingBox([0, 0], 111320, 111320, 1);
        // 111320 px * 1 * 0.625 / 111320 = 0.625 grau, metade para cada lado.
        expect(minLng).toBeCloseTo(-0.3125, 10);
        expect(maxLng).toBeCloseTo(0.3125, 10);
        expect(minLat).toBeCloseTo(-0.3125, 10);
        expect(maxLat).toBeCloseTo(0.3125, 10);
    });

    // DOCUMENTED DIVERGENCE, not a passing grade: `calculateSelectionBoxGeometry`
    // converts through the UI manager (which does apply the Mercator cos(lat) factor)
    // while this one hardcodes 111320 on BOTH axes. At latitude 60 the longitude span
    // is therefore about half of what the drawn selection box uses.
    it('NAO corrige por latitude: o mesmo tamanho em grau no equador e a 60 graus', () => {
        const atEquator = geom.getBoundingBox([0, 0], 1000, 1000, 1);
        const atSixty = geom.getBoundingBox([0, 60], 1000, 1000, 1);
        expect(atSixty[2] - atSixty[0]).toBeCloseTo(atEquator[2] - atEquator[0], 12);
    });

    it('size 0 colapsa a caixa no ponto', () => {
        expect(geom.getBoundingBox([5, 6], 100, 100, 0)).toEqual([5, 6, 5, 6]);
    });

    it('nao valida a entrada: coordenada NaN vira bbox NaN', () => {
        const bbox = geom.getBoundingBox([NaN, 0], 100, 100, 1);
        expect(Number.isNaN(bbox[0])).toBe(true);
    });

    it('propriedade: min <= max nos dois eixos e o centro e o ponto de entrada', () => {
        fc.assert(fc.property(
            fc.double({ min: -170, max: 170, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: 0, max: 5000, noNaN: true }),
            fc.double({ min: 0, max: 5000, noNaN: true }),
            fc.double({ min: 0, max: 10, noNaN: true }),
            (lng, lat, w, h, size) => {
                const [minLng, minLat, maxLng, maxLat] = geom.getBoundingBox([lng, lat], w, h, size);
                expect(minLng).toBeLessThanOrEqual(maxLng);
                expect(minLat).toBeLessThanOrEqual(maxLat);
                expect((minLng + maxLng) / 2).toBeCloseTo(lng, 9);
                expect((minLat + maxLat) / 2).toBeCloseTo(lat, 9);
            }
        ));
    });
});

// ============================================================================
// generate / generatePointGeometry / moveImage / handles
// ============================================================================

describe('AddImageGeometry.generate', () => {
    it('devolve um Point GeoJSON', () => {
        expect(geom.generate([1, 2])).toEqual({ type: 'Point', coordinates: [1, 2] });
    });

    // Contrast with AddPointGeometry.createPointGeometry, which spreads the whole
    // array and therefore KEEPS a third component.
    it('descarta o terceiro componente (z), ao contrario da ferramenta de ponto', () => {
        expect(geom.generate([1, 2, 300]).coordinates).toEqual([1, 2]);
    });

    // No validate() call on this path: unlike the point tool, an invalid pair is
    // happily turned into geometry.
    it('NAO valida: coordenada em string vira geometria mesmo assim', () => {
        expect(geom.generate(['a', 'b']).coordinates).toEqual(['a', 'b']);
    });

    it('copia: mutar a saida nao altera a entrada', () => {
        const input = [1, 2];
        const out = geom.generate(input);
        out.coordinates[0] = 99;
        expect(input[0]).toBe(1);
    });
});

describe('AddImageGeometry.moveImage', () => {
    it('soma os deltas e devolve um novo array de dois elementos', () => {
        const input = [10, 20];
        const out = geom.moveImage(input, 1, -2);
        expect(out).toEqual([11, 18]);
        expect(out).not.toBe(input);
    });

    it('descarta z na movimentacao', () => {
        expect(geom.moveImage([1, 2, 3], 0, 0)).toEqual([1, 2]);
    });

    it('nao ha guarda: delta NaN propaga', () => {
        expect(geom.moveImage([1, 2], NaN, 0)[0]).toBeNaN();
    });

    it('propriedade: round-trip +d/-d volta ao ponto de partida', () => {
        fc.assert(fc.property(
            fc.double({ min: -170, max: 170, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: -5, max: 5, noNaN: true }),
            fc.double({ min: -5, max: 5, noNaN: true }),
            (lng, lat, dx, dy) => {
                const there = geom.moveImage([lng, lat], dx, dy);
                const back = geom.moveImage(there, -dx, -dy);
                expect(back[0]).toBeCloseTo(lng, 9);
                expect(back[1]).toBeCloseTo(lat, 9);
            }
        ));
    });
});

describe('AddImageGeometry: imagem nao tem handles', () => {
    it('createHandles devolve sempre lista vazia', () => {
        expect(geom.createHandles({ properties: {} })).toEqual([]);
        expect(geom.createHandles(null)).toEqual([]);
    });

    it('updateFromHandle devolve sempre null', () => {
        expect(geom.updateFromHandle('rotate', [0, 0], {})).toBeNull();
        expect(geom.updateFromHandle(null, null, null)).toBeNull();
    });
});

// ============================================================================
// recalculateSelectionBox
// ============================================================================

describe('AddImageGeometry.recalculateSelectionBox', () => {
    const featureWith = (props) => ({
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { width: 100, height: 50, size: 1, rotation: 0, createdAtZoom: 12, ...props },
    });

    it('com correcao de zoom LIGADA ignora o zoom corrente e usa createdAtZoom', () => {
        const ui = makeUiManager();
        geom.recalculateSelectionBox(featureWith({ zoomCorrectionEnabled: true }), ui, 18);
        expect(ui.pixelsToDegrees.mock.calls[0][2]).toBe(12);
    });

    it('propriedade ausente conta como ligada (so `=== false` desliga)', () => {
        const ui = makeUiManager();
        geom.recalculateSelectionBox(featureWith({}), ui, 18);
        expect(ui.pixelsToDegrees.mock.calls[0][2]).toBe(12);
    });

    it('com correcao DESLIGADA usa o zoom corrente', () => {
        const ui = makeUiManager();
        geom.recalculateSelectionBox(featureWith({ zoomCorrectionEnabled: false }), ui, 18);
        expect(ui.pixelsToDegrees.mock.calls[0][2]).toBe(18);
    });

    // Strict `=== false`: the string 'false' (as it can arrive from a serialised
    // property bag) does NOT disable the correction.
    it("a string 'false' NAO desliga a correcao (comparacao estrita)", () => {
        const ui = makeUiManager();
        geom.recalculateSelectionBox(featureWith({ zoomCorrectionEnabled: 'false' }), ui, 18);
        expect(ui.pixelsToDegrees.mock.calls[0][2]).toBe(12);
    });

    it('correcao desligada e zoom corrente omitido cai de volta para createdAtZoom', () => {
        const ui = makeUiManager();
        geom.recalculateSelectionBox(featureWith({ zoomCorrectionEnabled: false }), ui);
        expect(ui.pixelsToDegrees.mock.calls[0][2]).toBe(12);
    });

    it('correcao desligada com zoom corrente 0 usa 0, nao createdAtZoom', () => {
        const ui = makeUiManager();
        geom.recalculateSelectionBox(featureWith({ zoomCorrectionEnabled: false }), ui, 0);
        expect(ui.pixelsToDegrees.mock.calls[0][2]).toBe(0);
    });
});

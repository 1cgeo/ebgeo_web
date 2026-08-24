// Path: tests/unit/text-geometry.test.js

/**
 * @fileoverview Pins the pure math of the text tool:
 * `AddTextGeometry` (`src/js/draw_tools/text_tool/add_text_geometry.js`) and
 * `SelectionHighlightManager.calculateExpandedDimensions`
 * (`src/js/tool_manager/managers/selection-highlight.manager.js`), which is the
 * rotated-AABB routine the text selection box depends on.
 *
 * Two collaborators are replaced, and only these two: the `@tools` barrel
 * (BaseGeometry is trivial here, and `createSelectionBoxFromDegrees` becomes a
 * recorder so the arguments that reach it can be asserted without duplicating
 * the polygon math), and `measureTextSize`, which needs a real canvas. `turf` is
 * a global here as it is in the app, so `turf.bearing` is stubbed per test.
 *
 * What this suite does NOT reach: the canvas text metrics themselves (multi-line
 * width via `measureText`, the `(fontSize - 8) * lines` height), the MapLibre
 * side of the highlight manager (`createSelectionBox`, projection, layers), and
 * the polygon actually emitted by the real `createSelectionBoxFromDegrees`
 * (covered where BaseGeometry lives, not here).
 *
 * Tests whose name carries "defeito" or "documenta" assert MEASURED behaviour
 * that is wrong or surprising. The green there means "still behaves like this",
 * never "approved".
 *
 * FIXED ON 2026-08-24, and the cases below now pin the corrected behaviour
 * instead of the defect:
 * - `calculateRotationFromHandle` no longer emits negative rotations, and the
 *   [271, 359] quadrant is reachable (a single `+= 360` could not wrap a value
 *   that starts in [-450, -90]).
 * - `calculateRotationHandlePosition` honours map zoom 0 instead of falling back
 *   to `createdAtZoom`.
 * - `validate` rejects a non-finite coordinate, like circle/line/polygon/ellipse.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

/** Records the arguments the selection box is built from. */
const boxCalls = [];

vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
        createSelectionBoxFromDegrees(coordinates, widthDegrees, heightDegrees) {
            boxCalls.push({ coordinates, widthDegrees, heightDegrees });
            return { type: 'BoxStub', coordinates, widthDegrees, heightDegrees };
        }
    },
}));

// The highlight manager imports the store barrel for getStateManager; it is not
// used by calculateExpandedDimensions.
vi.mock('@store', () => ({
    getStateManager: () => ({ get: () => undefined, set: () => {} }),
}));

const { default: AddTextGeometry } = await import('../../src/js/draw_tools/text_tool/add_text_geometry.js');
const { SelectionHighlightManager } = await import('../../src/js/tool_manager/managers/selection-highlight.manager.js');
const { pixelsToDegrees } = await import('../../src/js/utilities/geometry-utils.js');

const geom = new AddTextGeometry();

// Canvas is unavailable in the `node` environment; every caller of
// measureTextSize below assumes this fixed 100x20 text box.
const TEXT_W = 100;
const TEXT_H = 20;
geom.measureTextSize = () => ({ width: TEXT_W, height: TEXT_H });

// The manager only needs a map that accepts `on` during construction.
const highlight = new SelectionHighlightManager({ on: () => {} }, { hasSelectedFeatures: () => false });

// ============================================================================
// validate / isValidPosition
// ============================================================================

describe('AddTextGeometry.validate', () => {
    it('aceita par finito e ignora dimensoes extras', () => {
        expect(geom.validate([0, 0])).toBe(true);
        expect(geom.validate([-45.5, -23.5, 700])).toBe(true);
    });

    it('recusa null, curto, string e NaN', () => {
        expect(geom.validate(null)).toBeFalsy();
        expect(geom.validate([0])).toBe(false);
        expect(geom.validate('[0,0]')).toBe(false);
        expect(geom.validate(['0', 0])).toBe(false);
        expect(geom.validate([0, NaN])).toBe(false);
    });

    // Ex-defeito, corrigido em 2026-08-24: `isNaN` deixava Infinity passar, e o
    // guarda passou a ser `Number.isFinite`, como em circle/line/polygon/ellipse.
    it('recusa Infinity (o guarda e Number.isFinite, nao isNaN)', () => {
        expect(geom.validate([Infinity, 0])).toBe(false);
        expect(geom.validate([0, -Infinity])).toBe(false);
    });

    it('documenta: null devolve o proprio null, nao false', () => {
        // The chain starts with `coordinates &&`, so falsy input is returned raw.
        expect(geom.validate(null)).toBe(null);
        expect(geom.validate(undefined)).toBe(undefined);
    });

    // Era a mesma regra DUPLICADA; desde 2026-08-24 `isValidPosition` delega a
    // `validate`, e este caso continua cobrando a equivalencia entrada a entrada.
    it('isValidPosition e validate sao a MESMA regra', () => {
        const samples = [
            [0, 0], [180, 90], [-180, -90], [Infinity, 0], [0, NaN],
            [0], [], null, undefined, '0,0', ['0', 0], [0, 0, 1], {}, 42,
        ];
        expect(samples).toHaveLength(14);
        for (const s of samples) {
            expect(geom.isValidPosition(s)).toEqual(geom.validate(s));
        }
    });
});

// ============================================================================
// normalizeCoordinates
// ============================================================================

describe('AddTextGeometry.normalizeCoordinates', () => {
    let errSpy;
    beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { errSpy.mockRestore(); });

    it('desserializa string JSON', () => {
        expect(geom.normalizeCoordinates('[1,2]')).toEqual([1, 2]);
    });

    it('JSON malformado devolve null', () => {
        expect(geom.normalizeCoordinates('[1,')).toBeNull();
        expect(errSpy).toHaveBeenCalled();
    });

    it("'5' e 'null' viram null (nao sao array)", () => {
        expect(geom.normalizeCoordinates('5')).toBeNull();
        expect(geom.normalizeCoordinates('null')).toBeNull();
    });

    it('array curto devolve null (ao contrario do brush, aqui HA checagem de comprimento)', () => {
        expect(geom.normalizeCoordinates([1])).toBeNull();
        expect(geom.normalizeCoordinates([])).toBeNull();
    });

    it('documenta: nao valida CONTEUDO, entao string dentro do array passa', () => {
        expect(geom.normalizeCoordinates(['a', 'b'])).toEqual(['a', 'b']);
        expect(geom.validate(['a', 'b'])).toBe(false);
    });
});

// ============================================================================
// generatePointGeometry / moveText / affectsVisuals / validateText
// ============================================================================

describe('AddTextGeometry.generatePointGeometry', () => {
    it('trunca para duas dimensoes', () => {
        expect(geom.generate([1, 2, 3])).toEqual({ type: 'Point', coordinates: [1, 2] });
    });

    it('documenta: nao valida nada, entrada suja atravessa', () => {
        expect(geom.generate([NaN, undefined])).toEqual({ type: 'Point', coordinates: [NaN, undefined] });
    });
});

describe('AddTextGeometry.moveText', () => {
    it('soma o delta e devolve novo array', () => {
        const c = [10, 20];
        const out = geom.moveText(c, -1, 2);
        expect(out).toEqual([9, 22]);
        expect(out).not.toBe(c);
        expect(c).toEqual([10, 20]);
    });

    it('documenta: NaN atravessa sem guarda', () => {
        expect(geom.moveText([0, 0], NaN, 1)[0]).toBeNaN();
    });

    it('propriedade: round-trip +d/-d volta ao original', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -90, max: 90, noNaN: true }),
            fc.double({ min: -10, max: 10, noNaN: true }),
            fc.double({ min: -10, max: 10, noNaN: true }),
            (lng, lat, dx, dy) => {
                const back = geom.moveText(geom.moveText([lng, lat], dx, dy), -dx, -dy);
                expect(back[0]).toBeCloseTo(lng, 9);
                expect(back[1]).toBeCloseTo(lat, 9);
            }
        ));
    });
});

describe('AddTextGeometry.affectsVisuals / validateText', () => {
    it('as cinco propriedades visuais e nada mais', () => {
        const visual = ['text', 'size', 'rotation', 'showBackground', 'backgroundBorderWidth'];
        expect(visual).toHaveLength(5);
        for (const p of visual) expect(geom.affectsVisuals(p)).toBe(true);
        for (const p of ['color', 'id', 'createdAtZoom', 'zoomCorrectionEnabled', '']) {
            expect(geom.affectsVisuals(p)).toBe(false);
        }
    });

    it('documenta: zoomCorrectionEnabled NAO conta como visual, apesar de mudar a caixa', () => {
        expect(geom.affectsVisuals('zoomCorrectionEnabled')).toBe(false);
    });

    it('validateText exige string nao vazia depois do trim', () => {
        expect(geom.validateText('ola')).toBe(true);
        expect(geom.validateText('   ')).toBe(false);
        expect(geom.validateText('')).toBe(false);
        expect(geom.validateText(null)).toBe(false);
        expect(geom.validateText(123)).toBe(false);
    });
});

// ============================================================================
// calculateZoomAdjustedSize
// ============================================================================

describe('AddTextGeometry.calculateZoomAdjustedSize', () => {
    it('um nivel de zoom dobra o tamanho', () => {
        expect(geom.calculateZoomAdjustedSize(16, 10, 11)).toBe(32);
    });

    it('diferenca zero devolve a base exata', () => {
        expect(geom.calculateZoomAdjustedSize(16, 10, 10)).toBe(16);
    });

    it('afasta-se pela metade a cada nivel abaixo', () => {
        expect(geom.calculateZoomAdjustedSize(16, 10, 8)).toBe(4);
    });

    it('teto de 255 px', () => {
        expect(geom.calculateZoomAdjustedSize(16, 0, 20)).toBe(255);
        expect(geom.calculateZoomAdjustedSize(1, 0, Infinity)).toBe(255);
    });

    it('base 0 continua 0; base negativa NAO tem piso', () => {
        expect(geom.calculateZoomAdjustedSize(0, 5, 12)).toBe(0);
        expect(geom.calculateZoomAdjustedSize(-10, 10, 11)).toBe(-20);
    });

    it('defeito: NaN nao e protegido e vaza como tamanho', () => {
        expect(geom.calculateZoomAdjustedSize(16, NaN, 11)).toBeNaN();
        expect(geom.calculateZoomAdjustedSize(NaN, 10, 11)).toBeNaN();
        expect(geom.calculateZoomAdjustedSize(16, undefined, 11)).toBeNaN();
    });

    it('documenta: zoom -Infinity zera o tamanho em vez de recusar', () => {
        expect(geom.calculateZoomAdjustedSize(16, 10, -Infinity)).toBe(0);
    });

    it('propriedade: monotonico no zoom atual e sempre <= 255', () => {
        fc.assert(fc.property(
            fc.double({ min: 1, max: 200, noNaN: true }),
            fc.double({ min: 0, max: 22, noNaN: true }),
            fc.double({ min: 0, max: 22, noNaN: true }),
            (base, z0, z1) => {
                const lo = geom.calculateZoomAdjustedSize(base, z0, Math.min(z0, z1));
                const hi = geom.calculateZoomAdjustedSize(base, z0, Math.max(z0, z1));
                expect(lo).toBeLessThanOrEqual(hi);
                expect(hi).toBeLessThanOrEqual(255);
            }
        ));
    });
});

// ============================================================================
// calculateRotationFromHandle — turf.bearing is a global in the app
// ============================================================================

describe('AddTextGeometry.calculateRotationFromHandle', () => {
    let bearingValue;
    beforeEach(() => {
        globalThis.turf = { bearing: () => bearingValue };
    });
    afterEach(() => {
        delete globalThis.turf;
    });

    const rotFor = (b) => { bearingValue = b; return geom.calculateRotationFromHandle([0, 0], [1, 1]); };

    it('a marca oeste (bearing -90) e rotacao 0', () => {
        expect(rotFor(-90)).toBe(0);
    });

    it('bearing 0 (norte) e rotacao 90', () => {
        expect(rotFor(0)).toBe(90);
    });

    it('bearing 90 (leste) e rotacao 180', () => {
        expect(rotFor(90)).toBe(180);
    });

    it('bearing 180 (sul) e rotacao 270', () => {
        expect(rotFor(180)).toBe(270);
    });

    it('arredonda para inteiro', () => {
        expect(rotFor(-89.6)).toBe(0);
        expect(rotFor(-89.4)).toBe(1);
    });

    // Ex-DEFEITO, corrigido em 2026-08-24. turf.bearing returns [-180, 180], so
    // rotation = bearing - 270 lands in [-450, -90] and a single `+= 360` left the
    // result in [-90, 270]: a text rotated 350 degrees came back as -10 and one at
    // 280 came back as -80, and that negative number was written to the feature.
    it('bearing em [-180, -90) devolve rotacao no ultimo quadrante, nunca NEGATIVA', () => {
        expect(rotFor(-100)).toBe(350);
        expect(rotFor(-170)).toBe(280);
        expect(rotFor(-180)).toBe(270);
    });

    // Ex-DEFEITO, corrigido em 2026-08-24: o intervalo saltava de 270 para -90.
    it('toda rotacao em [271, 359] e alcancavel', () => {
        const reachable = new Set();
        for (let b = -180; b <= 180; b += 1) reachable.add(rotFor(b));
        expect(reachable.size).toBeGreaterThan(300);
        for (let r = 271; r <= 359; r++) expect(reachable.has(r)).toBe(true);
    });

    it('o arredondamento nao reintroduz 360, nem fora do contrato de turf.bearing', () => {
        // The backlog blamed `Math.round` for reintroducing 360, which was the
        // wrong half of the same `if`: it only happens for a bearing turf never
        // emits (269.7 gives 359.7 pre-round). The final `% 360` closes it anyway.
        expect(rotFor(269.7)).toBe(0);
        let max = -Infinity;
        for (let b = -180; b <= 180; b += 0.5) max = Math.max(max, rotFor(b));
        expect(max).toBe(359);
    });

    it('a saida fica em [0, 360) para todo bearing valido de turf', () => {
        fc.assert(fc.property(fc.double({ min: -180, max: 180, noNaN: true }), (b) => {
            bearingValue = b;
            const r = geom.calculateRotationFromHandle([0, 0], [1, 1]);
            expect(r).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThan(360);
        }));
    });

    it('updateFromHandle so responde ao handle "rotation"', () => {
        bearingValue = 0;
        expect(geom.updateFromHandle('rotation', [1, 1], { geometry: { coordinates: [0, 0] } })).toEqual({ rotation: 90 });
        expect(geom.updateFromHandle('eccentricity', [1, 1], { geometry: { coordinates: [0, 0] } })).toBeNull();
        expect(geom.updateFromHandle(undefined, [1, 1], { geometry: { coordinates: [0, 0] } })).toBeNull();
    });
});

// ============================================================================
// calculateRotationHandlePosition / createHandles
// ============================================================================

describe('AddTextGeometry.calculateRotationHandlePosition', () => {
    const featureAt = (lng, lat, rotation = 0, createdAtZoom = 12) => ({
        geometry: { coordinates: [lng, lat] },
        properties: { id: 'f1', text: 'abc', size: 16, rotation, createdAtZoom },
    });

    /** Same offset the source computes: half the measured width + 12 px. */
    const offsetPx = (TEXT_W / 2) + 12;

    it('rotacao 0 poe a alca a OESTE do centro', () => {
        const pos = geom.calculateRotationHandlePosition(featureAt(0, 0, 0), 12);
        const expected = pixelsToDegrees(offsetPx, 0, 12);
        expect(pos[0]).toBeCloseTo(-expected, 12);
        expect(pos[1]).toBeCloseTo(0, 12);
    });

    it('rotacao 90 leva a alca para o NORTE', () => {
        const pos = geom.calculateRotationHandlePosition(featureAt(0, 0, 90), 12);
        const expected = pixelsToDegrees(offsetPx, 0, 12);
        expect(pos[0]).toBeCloseTo(0, 12);
        expect(pos[1]).toBeCloseTo(expected, 12);
    });

    it('um nivel de zoom a menos afasta a alca ao dobro', () => {
        const near = geom.calculateRotationHandlePosition(featureAt(0, 0, 0), 12);
        const far = geom.calculateRotationHandlePosition(featureAt(0, 0, 0), 11);
        expect(Math.abs(far[0])).toBeCloseTo(Math.abs(near[0]) * 2, 12);
    });

    // Ex-DEFEITO, corrigido em 2026-08-24: `mapZoom || createdAtZoom` engolia o
    // zoom 0, que e um zoom legitimo (o mundo inteiro num tile), e desenhava a
    // alca ~4096x mais perto do que devia.
    it('mapZoom === 0 e usado, nao substituido por createdAtZoom', () => {
        const atZeroZoom = geom.calculateRotationHandlePosition(featureAt(0, 0, 0), 0);
        const atCreated = geom.calculateRotationHandlePosition(featureAt(0, 0, 0), 12);
        expect(atZeroZoom[0]).toBeCloseTo(-pixelsToDegrees(offsetPx, 0, 0), 12);
        expect(atZeroZoom[0]).not.toBe(atCreated[0]);
    });

    it('mapZoom ausente ou NaN ainda cai para createdAtZoom', () => {
        const atCreated = geom.calculateRotationHandlePosition(featureAt(0, 0, 0), 12);
        expect(geom.calculateRotationHandlePosition(featureAt(0, 0, 0, 12), undefined)).toEqual(atCreated);
        expect(geom.calculateRotationHandlePosition(featureAt(0, 0, 0, 12), NaN)).toEqual(atCreated);
    });

    it('documenta: o deslocamento e o MESMO em grau de lng e de lat, sem correcao por cosseno', () => {
        // At 60 degrees of latitude a degree of longitude is half a degree of
        // latitude on the ground, so the handle drifts off the text as latitude
        // grows. West and north offsets come out numerically identical.
        const west = geom.calculateRotationHandlePosition(featureAt(0, 60, 0), 12);
        const north = geom.calculateRotationHandlePosition(featureAt(0, 60, 90), 12);
        expect(Math.abs(west[0] - 0)).toBeCloseTo(Math.abs(north[1] - 60), 12);
    });

    it('createHandles devolve um handle de rotacao, e [] para posicao invalida', () => {
        const handles = geom.createHandles(featureAt(0, 0, 0), 12);
        expect(handles).toHaveLength(1);
        expect(handles[0].properties.handleId).toBe('rotation');
        expect(handles[0].properties.featureId).toBe('f1');
        expect(handles[0].geometry.type).toBe('Point');

        const broken = featureAt(0, 0, 0);
        broken.geometry.coordinates = [NaN, 0];
        expect(geom.createHandles(broken, 12)).toEqual([]);
    });
});

// ============================================================================
// getBoundingBox
// ============================================================================

describe('AddTextGeometry.getBoundingBox', () => {
    it('rotacao 0 usa a maior dimensao', () => {
        const bbox = geom.getBoundingBox([0, 0], 'abc', 16, 0);
        const half = (Math.max(TEXT_W, TEXT_H) / 111320) / 2;
        expect(bbox).toEqual([-half, -half, half, half]);
    });

    it('rotacao != 0 usa a diagonal', () => {
        const bbox = geom.getBoundingBox([0, 0], 'abc', 16, 45);
        const half = (Math.hypot(TEXT_W, TEXT_H) / 111320) / 2;
        expect(bbox[2]).toBeCloseTo(half, 15);
    });

    it('o contorno de fundo soma 2x a espessura da borda', () => {
        const plain = geom.getBoundingBox([0, 0], 'abc', 16, 0, false, 3);
        const boxed = geom.getBoundingBox([0, 0], 'abc', 16, 0, true, 3);
        expect(boxed[2] - plain[2]).toBeCloseTo((6 / 111320) / 2, 15);
    });

    it('borda 0 com fundo ligado nao soma nada', () => {
        expect(geom.getBoundingBox([0, 0], 'abc', 16, 0, true, 0))
            .toEqual(geom.getBoundingBox([0, 0], 'abc', 16, 0, false, 1));
    });

    it('documenta: a caixa e QUADRADA em graus, mesmo para texto 100x20', () => {
        const [minLng, minLat, maxLng, maxLat] = geom.getBoundingBox([10, 60], 'abc', 16, 0);
        expect(maxLng - minLng).toBeCloseTo(maxLat - minLat, 15);
        // And there is no cosLat correction, so at latitude 60 the box is twice
        // as wide on the ground as it is tall.
        expect(minLng).toBeLessThan(10);
        expect(maxLat).toBeGreaterThan(60);
    });

    it('propriedade: a caixa e centrada e nunca vazia', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -85, max: 85, noNaN: true }),
            fc.double({ min: 0, max: 359, noNaN: true }),
            (lng, lat, rot) => {
                const [a, b, c, d] = geom.getBoundingBox([lng, lat], 'abc', 16, rot);
                expect((a + c) / 2).toBeCloseTo(lng, 9);
                expect((b + d) / 2).toBeCloseTo(lat, 9);
                expect(c).toBeGreaterThan(a);
                expect(d).toBeGreaterThan(b);
            }
        ));
    });
});

// ============================================================================
// calculateSelectionBoxGeometry / recalculateSelectionBox
// ============================================================================

describe('AddTextGeometry.calculateSelectionBoxGeometry', () => {
    /** uiManager double: identity expansion, and pixels recorded verbatim. */
    const makeUi = () => {
        const calls = [];
        return {
            calls,
            calculateExpandedDimensions: (w, h, _rot) => ({ width: w, height: h }),
            pixelsToDegrees: (px, lat, zoom) => { calls.push({ px, lat, zoom }); return px; },
        };
    };

    beforeEach(() => { boxCalls.length = 0; });

    it('padding padrao de 5 px de cada lado', () => {
        const ui = makeUi();
        geom.calculateSelectionBoxGeometry([0, 0], 'abc', 16, 0, 12, ui);
        expect(ui.calls).toHaveLength(2);
        expect(ui.calls[0].px).toBe(TEXT_W + 10);
        expect(ui.calls[1].px).toBe(TEXT_H + 10);
    });

    it('fundo com borda acrescenta a espessura ao padding', () => {
        const ui = makeUi();
        geom.calculateSelectionBoxGeometry([0, 0], 'abc', 16, 0, 12, ui, true, 4);
        expect(ui.calls[0].px).toBe(TEXT_W + 18); // (5 + 4) * 2
    });

    it('fundo com borda 0 nao acrescenta nada', () => {
        const ui = makeUi();
        geom.calculateSelectionBoxGeometry([0, 0], 'abc', 16, 0, 12, ui, true, 0);
        expect(ui.calls[0].px).toBe(TEXT_W + 10);
    });

    it('effectiveZoom null usa createdAtZoom', () => {
        const ui = makeUi();
        geom.calculateSelectionBoxGeometry([0, 0], 'abc', 16, 0, 12, ui, false, 1, null);
        expect(ui.calls[0].zoom).toBe(12);
    });

    it('effectiveZoom === 0 e um zoom VALIDO e prevalece (a guarda e !== null)', () => {
        const ui = makeUi();
        geom.calculateSelectionBoxGeometry([0, 0], 'abc', 16, 0, 12, ui, false, 1, 0);
        expect(ui.calls[0].zoom).toBe(0);
    });

    it('a caixa e construida a partir dos graus devolvidos pelo uiManager', () => {
        const ui = makeUi();
        const out = geom.calculateSelectionBoxGeometry([7, 8], 'abc', 16, 0, 12, ui);
        expect(boxCalls).toHaveLength(1);
        expect(boxCalls[0].coordinates).toEqual([7, 8]);
        expect(boxCalls[0].widthDegrees).toBe(TEXT_W + 10);
        expect(boxCalls[0].heightDegrees).toBe(TEXT_H + 10);
        expect(out.type).toBe('BoxStub');
    });

    it('recalculateSelectionBox so passa o zoom atual quando a correcao esta DESLIGADA', () => {
        const ui = makeUi();
        const base = {
            geometry: { coordinates: [0, 0] },
            properties: { text: 'abc', size: 16, rotation: 0, createdAtZoom: 12, showBackground: false, backgroundBorderWidth: 1 },
        };

        geom.recalculateSelectionBox({ ...base, properties: { ...base.properties, zoomCorrectionEnabled: false } }, ui, 17);
        expect(ui.calls[0].zoom).toBe(17);

        ui.calls.length = 0;
        geom.recalculateSelectionBox({ ...base, properties: { ...base.properties, zoomCorrectionEnabled: true } }, ui, 17);
        expect(ui.calls[0].zoom).toBe(12);

        // undefined is NOT `=== false`, so an old feature keeps zoom correction.
        ui.calls.length = 0;
        geom.recalculateSelectionBox(base, ui, 17);
        expect(ui.calls[0].zoom).toBe(12);
    });
});

describe('AddTextGeometry.destroy', () => {
    it('solta canvas e contexto de medicao', () => {
        const g = new AddTextGeometry();
        g.measurementCanvas = {};
        g.measurementContext = {};
        g.destroy();
        expect(g.measurementCanvas).toBeNull();
        expect(g.measurementContext).toBeNull();
    });
});

// ============================================================================
// SelectionHighlightManager.calculateExpandedDimensions (rotated AABB)
// ============================================================================

describe('SelectionHighlightManager.calculateExpandedDimensions', () => {
    const f = (w, h, r) => highlight.calculateExpandedDimensions(w, h, r);

    it('rotacao 0 e atalho EXATO, sem passar pela trigonometria', () => {
        expect(f(10, 20, 0)).toEqual({ width: 10, height: 20 });
        expect(f(0, 0, 0)).toEqual({ width: 0, height: 0 });
    });

    it('90 graus troca largura e altura', () => {
        const out = f(10, 20, 90);
        expect(out.width).toBeCloseTo(20, 12);
        expect(out.height).toBeCloseTo(10, 12);
    });

    it('180 graus devolve as dimensoes originais', () => {
        const out = f(10, 20, 180);
        expect(out.width).toBeCloseTo(10, 12);
        expect(out.height).toBeCloseTo(20, 12);
    });

    it('45 graus da (w+h)/raiz(2) nas duas dimensoes', () => {
        const out = f(10, 20, 45);
        expect(out.width).toBeCloseTo(30 / Math.SQRT2, 12);
        expect(out.height).toBeCloseTo(30 / Math.SQRT2, 12);
    });

    it('e simetrica em +r e -r, exatamente', () => {
        for (const r of [1, 13, 45, 77, 90, 137, 180, 270]) {
            expect(f(10, 20, r)).toEqual(f(10, 20, -r));
        }
    });

    it('documenta: 360 NAO cai no atalho e devolve numero contaminado por float', () => {
        const out = f(10, 20, 360);
        expect(out.width).not.toBe(10);
        expect(out.width).toBeCloseTo(10, 12);
    });

    it('defeito: rotacao NaN produz dimensoes NaN, sem guarda', () => {
        const out = f(10, 20, NaN);
        expect(out.width).toBeNaN();
        expect(out.height).toBeNaN();
    });

    it('documenta: a string "0" pula o atalho (=== estrito) e mesmo assim acerta', () => {
        // '0' * (PI/180) is exactly 0, so cos is exactly 1 and sin exactly 0 and
        // the rotated AABB happens to land on the original numbers. The early
        // return is bypassed, which only shows up as wasted work, not as drift.
        expect(f(10, 20, '0')).toEqual({ width: 10, height: 20 });
        // A string that is not zero does rotate, so the branch really is reached.
        expect(f(10, 20, '90').width).toBeCloseTo(20, 12);
    });

    it('propriedade: a area da caixa nunca encolhe', () => {
        fc.assert(fc.property(
            fc.double({ min: 0.1, max: 1000, noNaN: true }),
            fc.double({ min: 0.1, max: 1000, noNaN: true }),
            fc.double({ min: -720, max: 720, noNaN: true }),
            (w, h, r) => {
                const out = f(w, h, r);
                expect(out.width * out.height).toBeGreaterThanOrEqual(w * h - 1e-9);
                expect(out.width + out.height).toBeGreaterThanOrEqual(w + h - 1e-9);
            }
        ));
    });

    it('propriedade: girar 180 graus a mais nao muda a caixa', () => {
        fc.assert(fc.property(
            fc.double({ min: 0.1, max: 1000, noNaN: true }),
            fc.double({ min: 0.1, max: 1000, noNaN: true }),
            fc.double({ min: 1, max: 179, noNaN: true }),
            (w, h, r) => {
                const a = f(w, h, r);
                const b = f(w, h, r + 180);
                expect(a.width).toBeCloseTo(b.width, 9);
                expect(a.height).toBeCloseTo(b.height, 9);
            }
        ));
    });
});

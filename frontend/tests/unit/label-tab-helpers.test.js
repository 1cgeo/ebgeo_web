// Path: tests/unit/label-tab-helpers.test.js

/**
 * @fileoverview Unit tests for the pure half of `tool_manager/helpers/label-tab.helpers.js`,
 * the shared "Etiqueta" tab used by every shape tool.
 *
 * WHAT THIS SUITE PINS
 * - `computeShapeCentroid`: the closing-vertex rule (a closed ring must not count
 *   its repeated first point, or every centroid drifts toward that corner), the
 *   guards for a short or absent ring, and the fact that holes are ignored.
 * - `recalcLabelSize`: the zoom-correction arithmetic that keeps a label the same
 *   VISUAL size while the map zooms, its 255 ceiling with no floor, the strict
 *   `=== false` opt-out, and the backfill of `labelCreatedAtZoom`, which is
 *   written into BOTH features it is handed.
 * - `hasLabelChanged`: that it compares exactly the nine keys of
 *   LABEL_DEFAULT_PROPERTIES and nothing else. The key count is asserted, so the
 *   `some` loop cannot pass vacuously if that object is ever emptied.
 *
 * WHAT IT DOES NOT REACH
 * - Everything DOM-coupled in the same file: `buildShapeTabsWithLabel`,
 *   `_buildLabelTab`, `syncLabelSource`, `createLabelZoomHandler` and
 *   `createFillAreaButton` need a document, a MapLibre source and the GeoJSON
 *   dispatcher. The environment here is `node`, and those imports are mocked away.
 * - Whether MapLibre renders the resulting `labelCalculatedSize` at the size the
 *   math intends: no pixel is observed.
 *
 * FIXED ON 2026-08-24:
 * - `recalcLabelSize` stopped reading `labelCreatedAtZoom: 0` (the value in
 *   LABEL_DEFAULT_PROPERTIES) as missing and overwriting it, and stopped reading
 *   `labelSize: 0` as the default 14.
 * - `computeShapeCentroid` averages longitudes unwrapped, so a shape straddling
 *   the antimeridian no longer gets its label on the far side of the globe.
 * - `createLabelZoomHandler` used to duplicate the recalculation arithmetic
 *   inline, so this suite could stay green over a wrong copy. It calls
 *   `recalcLabelSize` now. The handler itself is still out of reach here: it
 *   needs a MapLibre source and the GeoJSON dispatcher.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// The module pulls the attribute-panel widget barrel, the measurement formatter
// and the GeoJSON dispatcher. None of the three is reachable from the pure
// helpers under test, and all three are DOM/MapLibre-coupled, so they are stubbed.
vi.mock('@tools/helpers/index.js', () => ({
    createModernSlider: vi.fn(),
    createModernColorPicker: vi.fn(),
    createModernToggle: vi.fn(),
    createModernTextarea: vi.fn(),
    createSectionDivider: vi.fn(),
}));

vi.mock('@js/measurement_tool/measurement-geometry.js', () => ({
    formatAreaAuto: vi.fn(() => '0 m²'),
}));

vi.mock('@layers/geojson-dispatcher.js', () => ({
    getGeoJsonDispatcher: vi.fn(),
}));

const {
    computeShapeCentroid,
    recalcLabelSize,
    hasLabelChanged,
    LABEL_DEFAULT_PROPERTIES,
    LABEL_ZOOM_PROPERTIES,
} = await import('../../src/js/tool_manager/helpers/label-tab.helpers.js');

// ============================================================================
// computeShapeCentroid
// ============================================================================

describe('computeShapeCentroid', () => {
    it('quadrado ABERTO: media dos quatro vertices', () => {
        expect(computeShapeCentroid([[[0, 0], [2, 0], [2, 2], [0, 2]]])).toEqual([1, 1]);
    });

    // The closing vertex repeats the first one; counting it would pull every
    // centroid toward that corner.
    it('quadrado FECHADO: o vertice de fechamento e excluido, e o centro nao desloca', () => {
        const closed = computeShapeCentroid([[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]);
        const open = computeShapeCentroid([[[0, 0], [2, 0], [2, 2], [0, 2]]]);
        expect(closed).toEqual([1, 1]);
        expect(closed).toEqual(open);
    });

    // Control for the test above: if the closing vertex were counted, the result
    // would be this biased value, which is what the code must NOT produce.
    it('controle: contar o fechamento daria 0.8, e nao e o que sai', () => {
        const withClosingCounted = (0 + 2 + 2 + 0 + 0) / 5;
        expect(withClosingCounted).toBe(0.8);
        expect(computeShapeCentroid([[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]])[0]).not.toBe(0.8);
    });

    it('coordenadas ausentes ou vazias devolvem null', () => {
        expect(computeShapeCentroid(null)).toBeNull();
        expect(computeShapeCentroid(undefined)).toBeNull();
        expect(computeShapeCentroid([])).toBeNull();
    });

    it('anel ausente ou com menos de 3 vertices devolve null', () => {
        expect(computeShapeCentroid([null])).toBeNull();
        expect(computeShapeCentroid([[]])).toBeNull();
        expect(computeShapeCentroid([[[0, 0]]])).toBeNull();
        expect(computeShapeCentroid([[[0, 0], [1, 1]]])).toBeNull();
    });

    // The closing rule is applied AFTER the length guard, so a three-vertex ring
    // that happens to be closed is averaged over two points, not rejected.
    it('anel de 3 vertices ja fechado vira media de DOIS pontos, nao null', () => {
        expect(computeShapeCentroid([[[0, 0], [1, 0], [0, 0]]])).toEqual([0.5, 0]);
    });

    it('so o anel externo conta: buracos sao ignorados', () => {
        const withHole = [
            [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
            [[4, 4], [5, 4], [5, 5], [4, 5], [4, 4]],
        ];
        expect(computeShapeCentroid(withHole)).toEqual([5, 5]);
    });

    // Ex-DEFEITO, corrigido em 2026-08-24: a media crua de longitude nao tratava o
    // antimeridiano, e uma forma sobre +/-180 recebia centroide do lado OPOSTO do
    // globo (0, no meio do Atlantico). As longitudes sao somadas desenroladas em
    // relacao ao primeiro vertice.
    it('no antimeridiano o centroide fica SOBRE a forma, nao do lado oposto', () => {
        const straddling = [[[179, 0], [-179, 0], [-179, 2], [179, 2], [179, 0]]];
        expect(computeShapeCentroid(straddling)).toEqual([180, 1]);
    });

    it('assimetrico sobre o antimeridiano: o centroide pende para o lado mais cheio', () => {
        // Three vertices at 179 and one at -179 (unwrapped to 181): mean 179.5.
        const straddling = [[[179, 0], [179, 2], [179, 4], [-179, 2]]];
        expect(computeShapeCentroid(straddling)).toEqual([179.5, 2]);
    });

    it('longe do antimeridiano o desenrolamento e inerte', () => {
        expect(computeShapeCentroid([[[-45, -23], [-43, -23], [-43, -21], [-45, -21]]]))
            .toEqual([-44, -22]);
    });

    it('vertice NaN contamina o centroide, sem erro', () => {
        const out = computeShapeCentroid([[[NaN, 0], [2, 0], [2, 2], [0, 2]]]);
        expect(Number.isNaN(out[0])).toBe(true);
        expect(out[1]).toBe(1);
    });

    // The longitude window is deliberately narrow (60 degrees around a base) and NOT
    // the whole globe: since 2026-08-24 longitudes are averaged unwrapped, so a ring
    // that straddles the antimeridian has a centroid OUTSIDE its naive bbox by
    // design, which is the whole point of the fix. A wide generator hit that case
    // only sometimes, which is a flake, not a property.
    it('propriedade: o centroide fica dentro do bbox de um anel que nao cruza o antimeridiano', () => {
        const vertex = () => fc.tuple(
            fc.double({ min: -30, max: 30, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true })
        );
        return fc.assert(fc.property(
            fc.array(vertex(), { minLength: 3, maxLength: 20 }),
            (ring) => {
                const out = computeShapeCentroid([ring]);
                const lngs = ring.map(p => p[0]);
                const lats = ring.map(p => p[1]);
                expect(out[0]).toBeGreaterThanOrEqual(Math.min(...lngs) - 1e-9);
                expect(out[0]).toBeLessThanOrEqual(Math.max(...lngs) + 1e-9);
                expect(out[1]).toBeGreaterThanOrEqual(Math.min(...lats) - 1e-9);
                expect(out[1]).toBeLessThanOrEqual(Math.max(...lats) + 1e-9);
            }
        ));
    });

    it('propriedade: transladar o anel translada o centroide igual', () => {
        const vertex = () => fc.tuple(
            fc.double({ min: -50, max: 50, noNaN: true }),
            fc.double({ min: -50, max: 50, noNaN: true })
        );
        return fc.assert(fc.property(
            fc.array(vertex(), { minLength: 3, maxLength: 12 }),
            fc.double({ min: -10, max: 10, noNaN: true }),
            (ring, shift) => {
                const base = computeShapeCentroid([ring]);
                const moved = computeShapeCentroid([ring.map(([x, y]) => [x + shift, y])]);
                expect(moved[0]).toBeCloseTo(base[0] + shift, 8);
                expect(moved[1]).toBeCloseTo(base[1], 8);
            }
        ));
    });
});

// ============================================================================
// recalcLabelSize
// ============================================================================

/** Build the (source, selected) pair the function mutates. */
function pair(props) {
    return [
        { properties: { ...props } },
        { properties: { ...props } },
    ];
}

describe('recalcLabelSize', () => {
    it('diferenca de zoom zero devolve o proprio labelSize', () => {
        const [src, sel] = pair({ labelSize: 20, labelCreatedAtZoom: 12 });
        recalcLabelSize(src, sel, 12);
        expect(src.properties.labelCalculatedSize).toBe(20);
    });

    it('dobra a cada nivel de zoom ganho e divide pela metade a cada perdido', () => {
        const [a, b] = pair({ labelSize: 14, labelCreatedAtZoom: 12 });
        recalcLabelSize(a, b, 13);
        expect(a.properties.labelCalculatedSize).toBe(28);

        const [c, d] = pair({ labelSize: 14, labelCreatedAtZoom: 12 });
        recalcLabelSize(c, d, 11);
        expect(c.properties.labelCalculatedSize).toBe(7);
    });

    it('escreve o MESMO resultado nas duas feicoes recebidas', () => {
        const [src, sel] = pair({ labelSize: 14, labelCreatedAtZoom: 10 });
        recalcLabelSize(src, sel, 13);
        expect(src.properties.labelCalculatedSize).toBe(112);
        expect(sel.properties.labelCalculatedSize).toBe(112);
    });

    it('aceita a mesma feicao passada duas vezes (e como o controle a chama)', () => {
        const f = { properties: { labelSize: 14, labelCreatedAtZoom: 10 } };
        recalcLabelSize(f, f, 11);
        expect(f.properties.labelCalculatedSize).toBe(28);
    });

    // Until 2026-08-24 an anchor of 0 was falsy and got overwritten by the backfill,
    // which is why this case anchors at 2. It reaches the ceiling from 0 too now.
    it('teto de 255, e ele e alcancado por zoom alto', () => {
        const [src, sel] = pair({ labelSize: 14, labelCreatedAtZoom: 2 });
        recalcLabelSize(src, sel, 21);
        expect(src.properties.labelCalculatedSize).toBe(255);
    });

    // One-sided clamp: nothing stops the label from shrinking to nothing.
    it('NAO ha piso: zoom muito abaixo do de referencia encolhe sem limite', () => {
        const [src, sel] = pair({ labelSize: 14, labelCreatedAtZoom: 20 });
        recalcLabelSize(src, sel, 0);
        expect(src.properties.labelCalculatedSize).toBeGreaterThan(0);
        expect(src.properties.labelCalculatedSize).toBeLessThan(0.0001);
    });

    it('com a correcao DESLIGADA o tamanho e o labelSize cru, sem zoom', () => {
        const [src, sel] = pair({
            labelSize: 18, labelCreatedAtZoom: 5, labelZoomCorrectionEnabled: false,
        });
        recalcLabelSize(src, sel, 20);
        expect(src.properties.labelCalculatedSize).toBe(18);
        expect(sel.properties.labelCalculatedSize).toBe(18);
    });

    it("so `=== false` desliga: a string 'false' e 0 mantem a correcao ligada", () => {
        for (const notFalse of ['false', 0, null, undefined]) {
            const [src, sel] = pair({
                labelSize: 10, labelCreatedAtZoom: 12, labelZoomCorrectionEnabled: notFalse,
            });
            recalcLabelSize(src, sel, 13);
            expect(src.properties.labelCalculatedSize).toBe(20);
        }
    });

    it('labelSize ausente cai para o padrao 14', () => {
        const [src, sel] = pair({ labelCreatedAtZoom: 12 });
        recalcLabelSize(src, sel, 12);
        expect(src.properties.labelCalculatedSize).toBe(14);
    });

    // Ex-DEFEITO de FALSY-ZERO, corrigido em 2026-08-24: uma etiqueta deliberadamente
    // de tamanho 0 era redesenhada em 14.
    it('labelSize 0 permanece 0, nao cai para 14', () => {
        const [src, sel] = pair({ labelSize: 0, labelCreatedAtZoom: 12 });
        recalcLabelSize(src, sel, 12);
        expect(src.properties.labelCalculatedSize).toBe(0);
        expect(sel.properties.labelCalculatedSize).toBe(0);
    });

    it('labelSize nao numerico (NaN, string, null) ainda cai para 14', () => {
        for (const bad of [NaN, '18', null]) {
            const [src, sel] = pair({ labelSize: bad, labelCreatedAtZoom: 12 });
            recalcLabelSize(src, sel, 12);
            expect(src.properties.labelCalculatedSize).toBe(14);
        }
    });

    it('faz backfill de labelCreatedAtZoom nas DUAS feicoes quando ele falta', () => {
        const [src, sel] = pair({ labelSize: 14 });
        recalcLabelSize(src, sel, 16.5);
        expect(src.properties.labelCreatedAtZoom).toBe(16.5);
        expect(sel.properties.labelCreatedAtZoom).toBe(16.5);
        // Backfilled to the current zoom, so the difference is zero and the size is base.
        expect(src.properties.labelCalculatedSize).toBe(14);
    });

    // Ex-DEFEITO de FALSY-ZERO, e este era o de dentes: `labelCreatedAtZoom: 0` e o
    // valor de LABEL_DEFAULT_PROPERTIES, entao toda forma cuja etiqueta nunca foi
    // reancorada carregava um zero LEGITIMO que o guarda lia como ausente e
    // SOBRESCREVIA com o zoom corrente, reancorando a correcao onde o usuario
    // estivesse. Corrigido em 2026-08-24: so ancora nao finita e ausente.
    it('labelCreatedAtZoom 0 e preservado, nao tratado como ausente', () => {
        const [src, sel] = pair({ labelSize: 14, labelCreatedAtZoom: 0 });
        recalcLabelSize(src, sel, 17);
        expect(src.properties.labelCreatedAtZoom).toBe(0);
        expect(sel.properties.labelCreatedAtZoom).toBe(0);
        // Anchored at zoom 0 and seen at 17, the size grows until the 255 ceiling.
        expect(src.properties.labelCalculatedSize).toBe(255);
    });

    it('ancora nao finita (NaN, null, string) continua sendo backfill', () => {
        for (const bad of [undefined, null, NaN, '12']) {
            const [src, sel] = pair({ labelSize: 14, labelCreatedAtZoom: bad });
            recalcLabelSize(src, sel, 9.5);
            expect(src.properties.labelCreatedAtZoom).toBe(9.5);
            expect(sel.properties.labelCreatedAtZoom).toBe(9.5);
            expect(src.properties.labelCalculatedSize).toBe(14);
        }
    });

    it('controle: com labelCreatedAtZoom 1 (nao falsy) o valor e preservado e o tamanho cresce', () => {
        const [src, sel] = pair({ labelSize: 14, labelCreatedAtZoom: 1 });
        recalcLabelSize(src, sel, 17);
        expect(src.properties.labelCreatedAtZoom).toBe(1);
        expect(src.properties.labelCalculatedSize).toBe(255);
    });

    it('zoom corrente NaN produz labelCalculatedSize NaN, sem erro', () => {
        const [src, sel] = pair({ labelSize: 14, labelCreatedAtZoom: 12 });
        recalcLabelSize(src, sel, NaN);
        expect(Number.isNaN(src.properties.labelCalculatedSize)).toBe(true);
    });

    it('propriedade: com correcao ligada e labelSize positivo o resultado fica em (0, 255]', () => {
        return fc.assert(fc.property(
            fc.double({ min: 1, max: 32, noNaN: true }),
            fc.double({ min: 1, max: 22, noNaN: true }),
            fc.double({ min: 1, max: 22, noNaN: true }),
            (labelSize, createdAt, current) => {
                const [src, sel] = pair({ labelSize, labelCreatedAtZoom: createdAt });
                recalcLabelSize(src, sel, current);
                const out = src.properties.labelCalculatedSize;
                expect(out).toBeGreaterThan(0);
                expect(out).toBeLessThanOrEqual(255);
                expect(sel.properties.labelCalculatedSize).toBe(out);
            }
        ));
    });

    it('propriedade: idempotente, recalcular no mesmo zoom nao muda nada', () => {
        return fc.assert(fc.property(
            fc.double({ min: 1, max: 32, noNaN: true }),
            fc.double({ min: 1, max: 20, noNaN: true }),
            fc.double({ min: 1, max: 20, noNaN: true }),
            (labelSize, createdAt, current) => {
                const [src, sel] = pair({ labelSize, labelCreatedAtZoom: createdAt });
                recalcLabelSize(src, sel, current);
                const first = src.properties.labelCalculatedSize;
                recalcLabelSize(src, sel, current);
                expect(src.properties.labelCalculatedSize).toBe(first);
            }
        ));
    });
});

// ============================================================================
// hasLabelChanged
// ============================================================================

describe('hasLabelChanged', () => {
    // The `some` below iterates the keys of LABEL_DEFAULT_PROPERTIES. Asserting the
    // count keeps the whole block from passing vacuously if that object is emptied.
    it('compara exatamente as NOVE chaves de LABEL_DEFAULT_PROPERTIES', () => {
        const keys = Object.keys(LABEL_DEFAULT_PROPERTIES);
        expect(keys.length).toBe(9);
        expect(keys.sort()).toEqual([
            'labelCalculatedSize', 'labelColor', 'labelCreatedAtZoom', 'labelOutlineColor',
            'labelOutlineWidth', 'labelSize', 'labelText', 'labelZoomCorrectionEnabled',
            'showLabel',
        ]);
    });

    it('propriedades identicas: nada mudou', () => {
        const snapshot = { ...LABEL_DEFAULT_PROPERTIES };
        expect(hasLabelChanged({ properties: { ...snapshot } }, snapshot)).toBe(false);
    });

    it('cada uma das nove chaves, sozinha, e suficiente para acusar mudanca', () => {
        const keys = Object.keys(LABEL_DEFAULT_PROPERTIES);
        expect(keys.length).toBe(9);
        for (const key of keys) {
            const snapshot = { ...LABEL_DEFAULT_PROPERTIES };
            const changed = { ...snapshot, [key]: '__outro__' };
            expect(hasLabelChanged({ properties: changed }, snapshot)).toBe(true);
        }
    });

    it('mudanca fora do conjunto de etiqueta NAO e acusada', () => {
        const snapshot = { ...LABEL_DEFAULT_PROPERTIES, fillColor: '#ff0000' };
        const changed = { ...snapshot, fillColor: '#00ff00' };
        expect(hasLabelChanged({ properties: changed }, snapshot)).toBe(false);
    });

    it('as duas ausentes contam como iguais (undefined === undefined)', () => {
        expect(hasLabelChanged({ properties: {} }, {})).toBe(false);
    });

    it('presente de um lado e ausente do outro acusa mudanca', () => {
        expect(hasLabelChanged({ properties: { labelText: 'a' } }, {})).toBe(true);
        expect(hasLabelChanged({ properties: {} }, { labelText: 'a' })).toBe(true);
    });

    // Strict `!==` over raw values: NaN is never equal to itself, so a NaN size on
    // both sides is reported as a change even though nothing was edited.
    it('labelSize NaN dos dois lados acusa mudanca (NaN !== NaN)', () => {
        expect(hasLabelChanged({ properties: { labelSize: NaN } }, { labelSize: NaN })).toBe(true);
    });

    // No coercion either: the string '14' and the number 14 differ.
    it("comparacao estrita: '14' e 14 sao diferentes", () => {
        expect(hasLabelChanged({ properties: { labelSize: '14' } }, { labelSize: 14 })).toBe(true);
    });
});

// ============================================================================
// LABEL_ZOOM_PROPERTIES
// ============================================================================

describe('LABEL_ZOOM_PROPERTIES', () => {
    // These three are the inputs of the recalculation above. A property that
    // changes the result but is missing from this set is an edit whose new size is
    // never computed, so the contents are pinned by name.
    it('contem exatamente as tres entradas do recalculo', () => {
        expect(LABEL_ZOOM_PROPERTIES instanceof Set).toBe(true);
        expect(LABEL_ZOOM_PROPERTIES.size).toBe(3);
        expect([...LABEL_ZOOM_PROPERTIES].sort())
            .toEqual(['labelCreatedAtZoom', 'labelSize', 'labelZoomCorrectionEnabled']);
    });

    it('toda entrada do conjunto e tambem uma chave do padrao de etiqueta', () => {
        expect(LABEL_ZOOM_PROPERTIES.size).toBe(3);
        for (const key of LABEL_ZOOM_PROPERTIES) {
            expect(Object.keys(LABEL_DEFAULT_PROPERTIES)).toContain(key);
        }
    });
});

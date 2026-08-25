// Path: tests/unit/pdf-export-constantes.test.js

/**
 * @fileoverview Pins `js/import_export/pdf-export.constants.js`, the module both
 * PDF engines share: `parseScaleDenom` (the only logic in the file) and the
 * arithmetic that ties the mosaic seam constants together.
 *
 * WHAT THIS SUITE PINS
 * - `parseScaleDenom` over the ELEVEN scale values the export panel actually
 *   offers, so a future edit that stores the pt-BR LABEL ("1:25.000") in the
 *   option value instead of the raw one turns red here;
 * - every way the function silently falls back to 25.000, and the one input it
 *   lets through unguarded (a negative denominator);
 * - the default-parameter behaviour of `getMosaicOverlapMm` for `undefined`
 *   versus `null` (only the first one restores the default);
 * - the relations among the mosaic constants: the warning threshold has to be
 *   reachable and strictly below the maximum page count.
 *
 * WHAT IT DOES NOT REACH
 * - The seam derivation `O = 2*(m + s)` and the centred cut, already pinned by
 *   `tests/unit/pdf-mosaic-geometry.test.js`; only its degenerate arguments are
 *   added here.
 * - `_drawScaleBar` / `_formatScaleText`, the consumers that would MISPRINT a
 *   pt-BR scale string: they are private to `pdf-cartographic-elements.js` and
 *   reachable only through `composeLayout`, which needs a real canvas.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    parseScaleDenom,
    getMosaicOverlapMm,
    GRID_MARGIN_MM,
    UTM_MAX_SCALE_DENOM,
    MOSAIC_MAX_DIM,
    MOSAIC_BORDER_MM,
    MOSAIC_PRINTER_MARGIN_MM,
    MOSAIC_CUT_SLACK_MM,
    MOSAIC_OVERLAP_MM,
    MOSAIC_WARN_TILES,
} from '../../src/js/import_export/pdf-export.constants.js';

// ============================================================================
// parseScaleDenom - the happy path is the panel's own option list
// ============================================================================

/** The `value` half of the eleven options built in `pdf-export.tab.js`. */
const PANEL_SCALES = [
    ['1:1000', 1000],
    ['1:5000', 5000],
    ['1:10000', 10000],
    ['1:25000', 25000],
    ['1:50000', 50000],
    ['1:100000', 100000],
    ['1:250000', 250000],
    ['1:500000', 500000],
    ['1:1000000', 1000000],
    ['1:2500000', 2500000],
    ['1:5000000', 5000000],
];

describe('parseScaleDenom - escalas oferecidas pelo painel', () => {
    it('as onze opcoes do painel devolvem o denominador exato', () => {
        expect(PANEL_SCALES).toHaveLength(11);
        for (const [scale, expected] of PANEL_SCALES) {
            expect(parseScaleDenom(scale)).toBe(expected);
        }
    });

    it('invariante (fast-check): "1:N" devolve N para todo inteiro positivo', () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 50000000 }), (n) => {
                expect(parseScaleDenom(`1:${n}`)).toBe(n);
            }),
            { numRuns: 200 },
        );
    });

    it('o numerador e ignorado: so o que vem depois do ":" conta', () => {
        expect(parseScaleDenom('9:25000')).toBe(25000);
        expect(parseScaleDenom(':25000')).toBe(25000);
    });

    it('so o PRIMEIRO ":" separa: o resto e descartado', () => {
        expect(parseScaleDenom('1:25000:9')).toBe(25000);
    });

    it('espaco e sufixo nao numerico sao tolerados por parseInt', () => {
        expect(parseScaleDenom('1:  25000')).toBe(25000);
        expect(parseScaleDenom('1:25000 ')).toBe(25000);
        expect(parseScaleDenom('1:25000mm')).toBe(25000);
        expect(parseScaleDenom('1:0025000')).toBe(25000);
    });
});

// ============================================================================
// parseScaleDenom - the silent fallbacks
// ============================================================================

describe('parseScaleDenom - recuos silenciosos para 25.000', () => {
    it('sem ":" nenhum, cai no padrao', () => {
        expect(parseScaleDenom('25000')).toBe(25000);
        expect(parseScaleDenom('')).toBe(25000);
        expect(parseScaleDenom('escala')).toBe(25000);
    });

    it('com ":" mas sem numero, cai no padrao', () => {
        expect(parseScaleDenom('1:')).toBe(25000);
        expect(parseScaleDenom('1:abc')).toBe(25000);
    });

    it('"1:0" cai no padrao: um denominador ZERO nao e escala', () => {
        expect(parseScaleDenom('1:0')).toBe(25000);
        expect(parseScaleDenom('1:00')).toBe(25000);
    });

    it('OBSERVADO: "1:25.000" (rotulo pt-BR) devolve 25, nao 25.000', () => {
        // `parseInt` stops at the dot. Today the panel keeps the dotted form in
        // the option LABEL and the raw form in the option VALUE, so this is not
        // reachable from the UI - which is exactly why the first assertion of
        // this suite (the eleven values) is the guard that matters.
        expect(parseScaleDenom('1:25.000')).toBe(25);
        expect(parseScaleDenom('1:1.000.000')).toBe(1);
    });

    it('OBSERVADO: notacao cientifica vira 1, sem avisar', () => {
        expect(parseScaleDenom('1:1e5')).toBe(1);
    });

    it('CONSERTADO: um denominador NEGATIVO cai no padrao, em vez de inverter os consumidores', () => {
        // `-5000` is truthy, so the `|| 25000` did not fire and the negative
        // reached every consumer (bar width, ground span, zoom), where it flipped
        // signs instead of falling back. The guard is `Number.isFinite(n) && n > 0`,
        // which is what the fallback always claimed to be.
        expect(parseScaleDenom('1:-5000')).toBe(25000);
        expect(parseScaleDenom('1:-1')).toBe(25000);
    });

    it('CONTROLE: um denominador positivo continua passando intacto', () => {
        // Sem este par o conserto acima seria indistinguivel de devolver sempre
        // o padrao.
        expect(parseScaleDenom('1:1')).toBe(1);
        expect(parseScaleDenom('1:5000')).toBe(5000);
        expect(parseScaleDenom('1:1000000')).toBe(1000000);
    });

    it('nao-string LANCA, porque a funcao chama .split direto', () => {
        expect(() => parseScaleDenom(25000)).toThrow(TypeError);
        expect(() => parseScaleDenom(null)).toThrow(TypeError);
        expect(() => parseScaleDenom(undefined)).toThrow(TypeError);
        // CONTROLE: the same call with a string does not throw.
        expect(() => parseScaleDenom('1:25000')).not.toThrow();
    });
});

// ============================================================================
// getMosaicOverlapMm - degenerate arguments
// ============================================================================

describe('getMosaicOverlapMm - argumentos degenerados', () => {
    it('margem zero deixa so a folga de corte dos dois lados', () => {
        expect(getMosaicOverlapMm(0)).toBe(2 * MOSAIC_CUT_SLACK_MM);
    });

    it('CONSERTADO: `undefined` E `null` restauram o padrao, os dois', () => {
        // A default parameter only fires for `undefined`. `null` coerced to 0 in
        // the arithmetic and yielded the slack-only overlap (4 mm onde a margem
        // fixa da 24), silently defeating the seam budget.
        // `getMosaicOverlapMm(config.margin)` com uma config anulada e o sitio
        // plausivel.
        expect(getMosaicOverlapMm(undefined)).toBe(MOSAIC_OVERLAP_MM);
        expect(getMosaicOverlapMm(null)).toBe(MOSAIC_OVERLAP_MM);
    });

    it('CONSERTADO: NaN e Infinity tambem caem no padrao, que `??` nao teria feito', () => {
        expect(getMosaicOverlapMm(NaN)).toBe(MOSAIC_OVERLAP_MM);
        expect(getMosaicOverlapMm(Infinity)).toBe(MOSAIC_OVERLAP_MM);
        expect(getMosaicOverlapMm('10')).toBe(MOSAIC_OVERLAP_MM);
    });

    it('CONTROLE: a margem ZERO continua sendo zero, e nao caiu no padrao junto', () => {
        expect(getMosaicOverlapMm(0)).toBe(2 * MOSAIC_CUT_SLACK_MM);
        expect(getMosaicOverlapMm(0)).not.toBe(MOSAIC_OVERLAP_MM);
    });

    it('e monotonica e estritamente crescente na margem', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 100, noNaN: true }),
                fc.double({ min: 0.01, max: 100, noNaN: true }),
                (m, d) => {
                    expect(getMosaicOverlapMm(m + d)).toBeGreaterThan(getMosaicOverlapMm(m));
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ============================================================================
// Relations among the mosaic constants
// ============================================================================

describe('relacoes entre as constantes do mosaico', () => {
    it('a sobreposicao publicada e a derivada da margem fixa', () => {
        expect(MOSAIC_OVERLAP_MM).toBe(2 * (MOSAIC_PRINTER_MARGIN_MM + MOSAIC_CUT_SLACK_MM));
        expect(MOSAIC_OVERLAP_MM).toBe(24);
    });

    it('o corte no meio da tira cobre a margem branca dos DOIS lados', () => {
        // O/2 >= m on each side is the whole point of the derivation; with the
        // old O > m budget this was false and every seam kept a white strip.
        expect(MOSAIC_OVERLAP_MM / 2).toBeGreaterThanOrEqual(MOSAIC_PRINTER_MARGIN_MM);
        expect(MOSAIC_OVERLAP_MM - MOSAIC_OVERLAP_MM / 2).toBeGreaterThanOrEqual(MOSAIC_PRINTER_MARGIN_MM);
    });

    it('o aviso de paginas e alcancavel e fica abaixo do maximo do seletor', () => {
        // 6x6 = 36 pages is the ceiling; a warning at or above it would never fire.
        expect(MOSAIC_MAX_DIM).toBe(6);
        expect(MOSAIC_WARN_TILES).toBeLessThan(MOSAIC_MAX_DIM * MOSAIC_MAX_DIM);
        expect(MOSAIC_WARN_TILES).toBeGreaterThan(1);
    });

    it('a faixa de coordenada do perimetro nao consome a sobreposicao inteira', () => {
        // The band is drawn INSIDE the sheet; if it were wider than the cut inset
        // the neat-line would fall in the strip the operator trims away.
        expect(MOSAIC_BORDER_MM).toBeLessThan(MOSAIC_OVERLAP_MM / 2);
    });

    it('a margem de grade da folha unica e positiva e menor que a faixa do mosaico', () => {
        expect(GRID_MARGIN_MM).toBeGreaterThan(0);
        expect(GRID_MARGIN_MM).toBeLessThan(MOSAIC_BORDER_MM);
    });

    it('o corte de escala do UTM e uma das escalas do painel', () => {
        // The cutoff is compared with `<`, so the option that equals it is the
        // first one WITHOUT a UTM grid; that only makes sense if it is offered.
        expect(PANEL_SCALES.map(([, d]) => d)).toContain(UTM_MAX_SCALE_DENOM);
        expect(parseScaleDenom(`1:${UTM_MAX_SCALE_DENOM}`)).toBe(UTM_MAX_SCALE_DENOM);
    });
});

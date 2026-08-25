// Path: tests/integration/rotulo-de-simbolo-nao-textual.repro.test.js

/**
 * @fileoverview Regression test for the two ways a non-string label broke symbol
 * rendering, one loud and one silent.
 *
 * ROOT CAUSE, coordination measure (`coordination_measure_generator.js`): three places
 * asked "is this text field filled in?" and two of them asked it differently.
 * `hasExternalText` and `calculateDynamicViewBox` tested `!== undefined/null/''`;
 * `addExternalTexts` tested `!value && value !== 0`.
 *
 * - The NUMBER 0 passed all three, and then `createTextElement` handed it to
 *   `escapeXml`, which calls `String.prototype.replace`: TypeError. It was thrown
 *   inside `generateSymbolBlob`, so the whole symbol failed to render, not just its
 *   label. A numeric label is not exotic: the field arrives as JSON from sync and
 *   from `.ebgeo` import, where a number stays a number.
 * - The boolean `false` split the guards the other way: the viewBox GREW to fit a
 *   label the drawing step then skipped, so the symbol silently gained empty margin.
 *
 * FIX: one shared `hasTextValue`, and `createTextElement` coerces with `String()`.
 *
 * ROOT CAUSE, Brazilian symbol (`brazilian_svg_postprocessing.js`): the module-private
 * `hexToRgb` sliced the string with no validation, so a colour that was not a 6-digit
 * hex produced NaN channels that were written into the SVG. '#fff' became
 * rgb(255,15,NaN) and 'vermelho' became rgb(NaN,NaN,14): the engagement bars lost
 * their fill, in an SVG that still parsed. FIX: validate and no-op, which is what the
 * coordination generator's namesake already did.
 *
 * Both halves live in one file because they are the same failure: a value that is not
 * the string the formatter assumed, reaching the formatter unchecked.
 */

import { describe, it, expect } from 'vitest';

import { CoordinationMeasureGenerator } from
    '@js/military_tools/coordination_measure_tool/coordination_measure_generator.js';
import { applyBrazilianModifications } from
    '@js/military_tools/military_symbol_tool/brazilian_svg_postprocessing.js';

const gen = new CoordinationMeasureGenerator();

const SVG = '<svg viewBox="0 0 40 40" width="40" height="40">'
    + '<rect fill="rgb(255,255,255)"/></svg>';

/** Catalog stub with one text field, placed OUTSIDE the base box so growth shows. */
const pointData = {
    textFields: {
        rotulo: { position: { x: 60, y: 20 }, anchor: 'middle', fontSize: 10 },
    },
};

/** Extension block that decodes to "no Brazilian extension" (country code != 076). */
const NO_EXTENSION = '1230000001';

/** SIDC 20 whose main icon is the catalogued 110200, plus the no-extension block. */
const SIDC30 = `1003100016${'110200'}0000${NO_EXTENSION}`;

/** SVG carrying the four engagement-bar colours the substitution targets. */
const BAR_SVG = '<svg>'
    + '<rect fill="rgb(128,224,255)"/>'
    + '<rect fill="rgb(255,255,128)"/>'
    + '<rect fill="rgb(170,255,170)"/>'
    + '<rect fill="rgb(255,128,128)"/>'
    + '</svg>';

describe('repro: rótulo numérico de medida de coordenação', () => {
    it('o número 0 é DESENHADO, em vez de derrubar a geração inteira', () => {
        expect(() => gen.addExternalTexts(SVG, { rotulo: 0 }, pointData)).not.toThrow();
        expect(gen.addExternalTexts(SVG, { rotulo: 0 }, pointData)).toContain('>0</text>');
    });

    it('número e string do mesmo rótulo produzem exatamente o mesmo SVG', () => {
        expect(gen.addExternalTexts(SVG, { rotulo: 107 }, pointData))
            .toBe(gen.addExternalTexts(SVG, { rotulo: '107' }, pointData));
    });

    it('crescer e desenhar não podem discordar para valor nenhum', () => {
        const base = gen.extractDimensions(SVG).width;
        const casos = [
            [{ rotulo: 'HA 107' }, true],
            [{ rotulo: 0 }, true],
            [{ rotulo: 107 }, true],
            [{ rotulo: false }, true],
            [{ rotulo: '' }, false],
            [{ rotulo: null }, false],
            [{}, false],
        ];
        expect(casos).toHaveLength(7);

        for (const [properties, presente] of casos) {
            const cresceu = gen.calculateDynamicViewBox(SVG, properties, pointData).width > base;
            const desenhou = gen.addExternalTexts(SVG, properties, pointData) !== SVG;

            expect(gen.hasExternalText(properties, pointData)).toBe(presente);
            expect(cresceu).toBe(presente);
            expect(desenhou).toBe(presente);
        }
    });

    it('número de concentração 0 não é reportado como ausente', () => {
        expect(gen.validate('240601', { numeroConcentracao: 0 })).toEqual([]);
        // Control: the genuinely empty value is still reported.
        expect(gen.validate('240601', { numeroConcentracao: '' })).toHaveLength(1);
    });
});

describe('repro: cor customizada inválida no símbolo brasileiro', () => {
    /**
     * @param {string} color - Value handed to the customColor argument
     * @returns {string} Resulting SVG
     */
    const colored = (color) => applyBrazilianModifications(BAR_SVG, SIDC30, '10', color);

    it('CONTROLE: um hex válido de 6 dígitos repinta as quatro barras', () => {
        const out = colored('#11FF00');

        expect(out.match(/rgb\(17,255,0\)/g)).toHaveLength(4);
        expect(out).not.toBe(BAR_SVG);
    });

    it('nenhuma cor inválida escreve NaN dentro do SVG', () => {
        const invalidas = ['#fff', 'fff', 'zzzzzz', 'vermelho', '#GGGGGG', '#ff000000', '#'];
        expect(invalidas).toHaveLength(7);

        for (const cor of invalidas) {
            expect(colored(cor)).not.toContain('NaN');
            expect(colored(cor)).toBe(BAR_SVG);
        }
    });
});

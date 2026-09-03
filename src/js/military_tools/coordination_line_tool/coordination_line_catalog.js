// Path: js/military_tools/coordination_line_tool/coordination_line_catalog.js

/**
 * @fileoverview The linear coordination symbols of the MD33 catalogue, as pure
 * data (no imports, node-testable).
 *
 * All of them are the same drawing problem: a polyline carrying a glyph repeated
 * at a regular spacing. They differ on exactly two axes, and those two axes are
 * what this table encodes:
 *
 *   `interrupts` — whether the glyph REPLACES a stretch of the line (the line
 *     runs into the glyph and out of it) or sits ON TOP of an unbroken line.
 *     A diamond interrupts; a wire-fence asterisk does not.
 *
 *   `glyph` — which shape to draw. The shape MATH lives in
 *     add_coordination_line_geometry.js, because it needs turf; this file stays free
 *     of imports so the attributes panel can read the names without pulling the
 *     geometry (and its turf global) into the panel's chunk.
 *
 * `spanRatio` is the glyph's along-line extent as a multiple of `symbol_size`.
 * An interrupting glyph spans exactly the gap it cuts, so it is 1; a glyph that
 * rides on an unbroken line cuts nothing and may be narrower.
 */

/** The linear symbols, keyed by their MD33 code. @constant */
export const LINEAR_SYMBOLS = Object.freeze({
    '290100': Object.freeze({
        code: '290100',
        name: 'Linha de obstáculos',
        glyph: 'peak',
        interrupts: true,
        spanRatio: 1,
    }),
    '290199': Object.freeze({
        code: '290199',
        name: 'Linha de barreiras',
        glyph: 'diamond',
        interrupts: true,
        spanRatio: 1,
    }),
    '290302': Object.freeze({
        code: '290302',
        name: 'Cerca de arame',
        glyph: 'asterisk',
        interrupts: false,
        spanRatio: 1,
    }),
    '290303': Object.freeze({
        code: '290303',
        name: 'Cerca de arame dupla',
        glyph: 'double-asterisk',
        interrupts: false,
        spanRatio: 1.6,
    }),
    '290307': Object.freeze({
        code: '290307',
        name: 'Concertina',
        glyph: 'coil',
        interrupts: false,
        spanRatio: 0.8,
    }),
});

/**
 * The symbol a line is born with, and the one every unknown code falls back to.
 * It is the barrier line because that is the symbol this tool shipped with, so a
 * feature drawn before the catalogue existed keeps drawing what it drew.
 * @constant {string}
 */
export const DEFAULT_SYMBOL_CODE = '290199';

/**
 * Resolve a symbol code to its entry, never returning undefined.
 *
 * The fallback is not politeness: the geometry runs on every zoom frame, and a
 * feature carrying a code from a newer catalogue (a pasted feature, an imported
 * `.ebgeo`, a hand-edited file) must still draw something rather than throw
 * inside a requestAnimationFrame callback where nothing would catch it.
 *
 * @param {string} [code] - Candidate MD33 code
 * @returns {{code: string, name: string, glyph: string, interrupts: boolean, spanRatio: number}} The symbol
 */
export function resolveSymbol(code) {
    return LINEAR_SYMBOLS[code] || LINEAR_SYMBOLS[DEFAULT_SYMBOL_CODE];
}

/**
 * The catalogue as a list, in catalogue order, for the panel's combobox.
 * @returns {Array<{value: string, label: string}>} Options
 */
export function symbolOptions() {
    return Object.values(LINEAR_SYMBOLS).map(symbol => ({
        value: symbol.code,
        label: `${symbol.name} (${symbol.code})`,
    }));
}

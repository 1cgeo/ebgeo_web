// Path: js/military_tools/coordination_line_tool/coordination_line_catalog.js

/**
 * @fileoverview The linear coordination symbols of the MD33 catalogue, as pure
 * data (no imports, node-testable).
 *
 * Most of them are the same drawing problem: a polyline carrying a glyph repeated
 * at a regular spacing. They differ on the axes below, and those axes are what
 * this table encodes:
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
 *   `rails` — how many CONTINUOUS lines run parallel to the spine, and
 *     `railGapRatio` how far off it they sit, as a multiple of `symbol_size`.
 *     The double and triple concertinas are two rails carrying loops; the rails
 *     are drawn once for the whole line, never per glyph, or the gaps between
 *     glyphs would break them into dashes.
 *
 *   `continuous` — the pattern fills the line END TO END and `symbol_spacing`
 *     does not apply, because the drawing IS the course of the line rather than
 *     a mark placed along it. The sap, the trench and the anti-tank ditch are
 *     the three, and for them `symbol_size` is the PERIOD of one tooth.
 *
 *   `filled` — the glyph is a SOLID area, and the geometry comes out as a
 *     MultiPolygon for the fill layer to paint. Only the anti-tank ditch, which
 *     the manual draws solid. The fill layer is filtered to these codes and to
 *     nothing else, because MapLibre's fill layer CLOSES and paints any line it
 *     is handed: measured in the browser on 2026-09-03, an unfiltered fill layer
 *     over this source painted the inside of the 290199 diamond, of every
 *     concertina loop, and even the area between an open bent spine and its
 *     chord. `FILLED_SYMBOL_CODES` below is what the filter reads.
 *
 * `spanRatio` is the glyph's along-line extent as a multiple of `symbol_size`.
 * An interrupting glyph spans exactly the gap it cuts, so it is 1; a glyph that
 * rides on an unbroken line cuts nothing and may be narrower.
 *
 * KEYED BY ID, NOT BY CODE. The two 290999 symbols (sap and trench) share a code
 * and differ only by the manual's `Extensão` field, so a table keyed by code
 * would silently drop one of them: the later literal wins in an object literal,
 * with no error anywhere. The id is the code for every symbol that has no
 * extension, which keeps every `symbol_code` written before this change
 * resolving to exactly what it resolved to.
 */

/** The linear symbols, keyed by their id (code, plus extension when the manual gives one). @constant */
export const LINEAR_SYMBOLS = Object.freeze({
    '290100': Object.freeze({
        id: '290100',
        code: '290100',
        name: 'Linha de obstáculos',
        glyph: 'peak',
        interrupts: true,
        spanRatio: 1,
    }),
    '290199': Object.freeze({
        id: '290199',
        code: '290199',
        name: 'Linha de barreiras',
        glyph: 'diamond',
        interrupts: true,
        spanRatio: 1,
    }),
    '290202': Object.freeze({
        id: '290202',
        code: '290202',
        name: 'Fosso anticarro',
        glyph: 'teeth',
        interrupts: true,
        continuous: true,
        filled: true,
        spanRatio: 1,
        depthRatio: 0.82,
    }),
    '290302': Object.freeze({
        id: '290302',
        code: '290302',
        name: 'Cerca de arame',
        glyph: 'asterisk',
        interrupts: false,
        spanRatio: 1,
    }),
    '290303': Object.freeze({
        id: '290303',
        code: '290303',
        name: 'Cerca de arame dupla',
        glyph: 'double-asterisk',
        interrupts: false,
        spanRatio: 1.6,
    }),
    '290307': Object.freeze({
        id: '290307',
        code: '290307',
        name: 'Concertina',
        glyph: 'coil',
        interrupts: false,
        spanRatio: 0.8,
    }),
    '290308': Object.freeze({
        id: '290308',
        code: '290308',
        name: 'Concertina dupla',
        glyph: 'coil-double',
        interrupts: false,
        spanRatio: 1,
        rails: 1,
        railGapRatio: 0.7,
    }),
    '290309': Object.freeze({
        id: '290309',
        code: '290309',
        name: 'Concertina tripla',
        glyph: 'coil-triple',
        interrupts: false,
        spanRatio: 1,
        rails: 1,
        railGapRatio: 1.35,
    }),
    '290999-01': Object.freeze({
        id: '290999-01',
        code: '290999',
        extension: '01',
        name: 'Sapa',
        glyph: 'zigzag',
        interrupts: true,
        continuous: true,
        spanRatio: 1,
        depthRatio: 0.6,
        flatRatio: 0,
    }),
    '290999-02': Object.freeze({
        id: '290999-02',
        code: '290999',
        extension: '02',
        name: 'Trincheira',
        glyph: 'zigzag',
        interrupts: true,
        continuous: true,
        spanRatio: 1,
        depthRatio: 0.7,
        flatRatio: 0.41,
    }),
});

/**
 * The ids whose geometry comes out as a MultiPolygon, for the fill layer's filter.
 *
 * Derived from the table rather than typed out: a hand-kept second list is a list
 * that goes stale, and here going stale means either a solid symbol that draws
 * hollow or a fill layer painting the inside of every closed glyph on the map.
 *
 * @constant {Array<string>}
 */
export const FILLED_SYMBOL_CODES = Object.freeze(
    Object.values(LINEAR_SYMBOLS).filter(symbol => symbol.filled).map(symbol => symbol.id),
);

/**
 * The symbol a line is born with, and the one every unknown code falls back to.
 * A feature whose code is missing or unreadable draws it rather than nothing.
 * @constant {string}
 */
export const DEFAULT_SYMBOL_CODE = '290199';

/**
 * Resolve a symbol id to its entry, never returning undefined.
 *
 * The fallback is not politeness: the geometry runs on every zoom frame, and a
 * feature carrying an id from a newer catalogue (a pasted feature, an imported
 * `.ebgeo`, a hand-edited file) must still draw something rather than throw
 * inside a requestAnimationFrame callback where nothing would catch it.
 *
 * @param {string} [code] - Candidate symbol id
 * @returns {{id: string, code: string, name: string, glyph: string, interrupts: boolean, spanRatio: number}} The symbol
 */
export function resolveSymbol(code) {
    return LINEAR_SYMBOLS[code] || LINEAR_SYMBOLS[DEFAULT_SYMBOL_CODE];
}

/**
 * The manual's own designation for a symbol: the code, and the extension when
 * there is one, which is the ONLY thing telling a sap from a trench.
 * @param {{code: string, extension?: string}} symbol - Catalogue entry
 * @returns {string} e.g. `290308` or `290999/01`
 */
export function symbolDesignation(symbol) {
    return symbol.extension ? `${symbol.code}/${symbol.extension}` : symbol.code;
}

/**
 * The catalogue as a list, in catalogue order, for the panel's combobox.
 * @returns {Array<{value: string, label: string}>} Options
 */
export function symbolOptions() {
    return Object.values(LINEAR_SYMBOLS).map(symbol => ({
        value: symbol.id,
        label: `${symbol.name} (${symbolDesignation(symbol)})`,
    }));
}

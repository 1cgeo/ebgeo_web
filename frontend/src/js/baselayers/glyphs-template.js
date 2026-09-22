// Path: js/baselayers/glyphs-template.js

/**
 * @fileoverview The `glyphs` template of a MapLibre style keeps its two tokens LITERAL.
 *
 * MAPLIBRE SUBSTITUTES BY TEXT. `GlyphManager._loadGlyphRange` runs
 * `this.url.replace('{fontstack}', ...).replace('{range}', ...)` on the style's `glyphs` exactly as
 * it received it (`setURL` stores it verbatim), BEFORE `transformRequest` and before the browser
 * resolves anything. A literal template is always substituted, relative, root-relative or
 * absolute; one whose braces were percent-encoded (`%7Bfontstack%7D`) never is, and the browser
 * then asks for the TEMPLATE itself and gets a 404. Measured in real Chromium with MapLibre 6.9.1
 * and 6.7 on 2026-09-22, and pinned against the shipped bundle by
 * `frontend/tests/unit/glifos-tokens-literais.test.js`.
 *
 * WHAT THE MEASUREMENT DID NOT FIND is who fetched the template on the test stack and in
 * production that day: MapLibre, fed the literal values the test server serves, never did, and
 * the `%7B` in the browser is only the wire form of a template fetch (the URL parser
 * percent-encodes `{` and `}` in a path). So this file is DEFENCE, not the fix of that report: it
 * matters only if an encoded value reaches the client (a style pasted from an address bar into
 * the catalog editor, a deployment's `MAPLIBRE_GLYPHS_URL`), which the main map would accept in
 * silence because it builds with `validateStyle: false` (`map_sig.js`), switching off the one
 * validator that refuses a `glyphs` without the literal token.
 *
 * NEVER ABSOLUTIZE the template through the URL parser: a relative template is resolved by the
 * browser on the main thread, where MapLibre fetches glyphs, and relative is what serves the same
 * build under `/ebgeo/` and under `/ebgeo_novo/`. Code that needs an absolute template has to
 * CONCATENATE the base and the template, never parse it.
 *
 * ZERO IMPORTS, so it is loadable in node and by any page without dragging the store along.
 */

/** A token of the glyph template, literal or percent-encoded, in any case. */
const TOKEN = /(?:\{|%7B)(fontstack|range)(?:\}|%7D)/gi;

/**
 * The template with `{fontstack}` and `{range}` literal, or the input itself when there is
 * nothing to restore (identity is how the callers tell "unchanged").
 * @param {*} glyphs - A style's `glyphs` value.
 * @returns {*}
 */
export function literalGlyphTokens(glyphs) {
    if (typeof glyphs !== 'string' || !/%7[BD]/i.test(glyphs)) return glyphs;
    const restored = glyphs.replace(TOKEN, (_, token) => `{${token.toLowerCase()}}`);
    return restored === glyphs ? glyphs : restored;
}

/**
 * The same style with a usable `glyphs` template: the input BY IDENTITY when it needs no change
 * (including a style URL string, whose document MapLibre fetches and the `transformStyle` hook
 * then sees), a shallow copy with `glyphs` restored otherwise. Never mutates the input, because
 * the published styles live in the shared `config` object.
 * @param {*} style
 * @returns {*}
 */
export function withLiteralGlyphTokens(style) {
    if (!style || typeof style !== 'object' || Array.isArray(style)) return style;
    const glyphs = literalGlyphTokens(style.glyphs);
    return glyphs === style.glyphs ? style : { ...style, glyphs };
}

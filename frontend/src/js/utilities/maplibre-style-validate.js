// Path: js/utilities/maplibre-style-validate.js

/**
 * @fileoverview Minimal MapLibre GL style validation, used by the admin basemap-style editor to
 * reject a malformed style BEFORE it is saved (a broken style would brick the map). This is a
 * lightweight structural check (not the full style spec): it pins the invariants the app relies on
 * — `version: 8`, a `sources` object, and a `layers` array. Pure + Node-testable.
 */

/**
 * Structurally validates a parsed MapLibre style object.
 * @param {*} style - A parsed style object.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateMapLibreStyle(style) {
    if (style === null || typeof style !== 'object' || Array.isArray(style)) {
        return { ok: false, errors: ['O estilo deve ser um objeto JSON.'] };
    }
    const errors = [];
    if (style.version !== 8) {
        errors.push('O estilo deve ter "version": 8.');
    }
    if (style.sources === null || typeof style.sources !== 'object' || Array.isArray(style.sources)) {
        errors.push('O estilo deve ter "sources" como objeto.');
    }
    if (!Array.isArray(style.layers)) {
        errors.push('O estilo deve ter "layers" como um array.');
    }
    return { ok: errors.length === 0, errors };
}

/**
 * Parses style JSON text and structurally validates it.
 * @param {string} text - JSON text.
 * @returns {{ ok: boolean, errors: string[], style: Object|null }}
 */
export function parseStyleJson(text) {
    let style;
    try {
        style = JSON.parse(text);
    } catch (e) {
        return { ok: false, errors: [`JSON inválido: ${e.message}`], style: null };
    }
    const result = validateMapLibreStyle(style);
    return { ok: result.ok, errors: result.errors, style: result.ok ? style : null };
}

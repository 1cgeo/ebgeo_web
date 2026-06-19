// Path: js/layers/layer-style/style-expression.model.js

/**
 * @fileoverview Pure model for reading and writing MapLibre data-driven paint
 * expressions used by catalog data/analysis layers.
 *
 * Catalog vector layers rarely use flat colors — their paint values are usually
 * data-driven expressions:
 *   - categorized: ["case", cond, out, ..., fallback] or ["match", input, v, out, ..., default]
 *   - graduated:   ["interpolate", interp, input, stop, out, ...] or ["step", input, base, stop, out, ...]
 *
 * The structured style editor parses these into editable models, lets the user
 * tweak the existing outputs/breaks, and serializes them back to equivalent
 * MapLibre expressions. The classification field and the number of
 * categories/stops are preserved (read-only) — only values are editable.
 *
 * This module is intentionally free of DOM and MapLibre dependencies so it can
 * be unit-tested under node.
 */

/**
 * @typedef {'constant'|'categorized'|'graduated'|'unsupported'} StyleValueKind
 */

/**
 * Classifies a MapLibre paint value into one of the editable kinds.
 * @param {*} value - A paint property value (scalar or expression array).
 * @returns {StyleValueKind}
 */
export function classifyStyleValue(value) {
    if (value === null || value === undefined) return 'unsupported';
    if (!Array.isArray(value)) return 'constant';

    const op = value[0];
    if (op === 'case' || op === 'match') {
        return parseCategorized(value) ? 'categorized' : 'unsupported';
    }
    if (op === 'interpolate' || op === 'interpolate-hcl' || op === 'interpolate-lab' || op === 'step') {
        return parseGraduated(value) ? 'graduated' : 'unsupported';
    }
    return 'unsupported';
}

// ===== CATEGORIZED (case / match) =====

/**
 * @typedef {Object} CategoryRow
 * @property {string} label - Human-readable category label (for display only).
 * @property {*} [condition] - Raw `case` condition expression (case op only).
 * @property {*} [value] - Raw `match` label value(s) (match op only).
 * @property {*} output - The output paint value for this category (editable).
 */

/**
 * @typedef {Object} CategorizedModel
 * @property {'case'|'match'} op
 * @property {string} fieldLabel - Display label of the classification field.
 * @property {*} [input] - Raw input expression (match op only).
 * @property {CategoryRow[]} categories
 * @property {*} fallback - Default / fallback output (editable).
 */

/**
 * Parses a `case` or `match` expression into a categorized model.
 * @param {*} expr
 * @returns {CategorizedModel|null} null when the shape is not recognized.
 */
export function parseCategorized(expr) {
    if (!Array.isArray(expr)) return null;
    if (expr[0] === 'case') return parseCaseExpr(expr);
    if (expr[0] === 'match') return parseMatchExpr(expr);
    return null;
}

/** @param {Array} expr @returns {CategorizedModel|null} */
function parseCaseExpr(expr) {
    // ["case", cond1, out1, cond2, out2, ..., fallback]
    const body = expr.slice(1);
    if (body.length < 3 || body.length % 2 === 0) return null; // need pairs + 1 fallback

    const fallback = body[body.length - 1];
    const categories = [];
    let fieldLabel = '';

    for (let i = 0; i < body.length - 1; i += 2) {
        const condition = body[i];
        const output = body[i + 1];
        const field = fieldFromCondition(condition);
        if (field && !fieldLabel) fieldLabel = field;
        categories.push({
            label: labelFromCondition(condition),
            condition,
            output
        });
    }

    return { op: 'case', fieldLabel, categories, fallback };
}

/** @param {Array} expr @returns {CategorizedModel|null} */
function parseMatchExpr(expr) {
    // ["match", input, label1, out1, label2, out2, ..., default]
    if (expr.length < 5) return null;
    const input = expr[1];
    const body = expr.slice(2);
    if (body.length < 3 || body.length % 2 === 0) return null; // pairs + 1 default

    const fallback = body[body.length - 1];
    const categories = [];

    for (let i = 0; i < body.length - 1; i += 2) {
        const value = body[i];
        const output = body[i + 1];
        categories.push({
            label: Array.isArray(value) ? value.join(', ') : String(value),
            value,
            output
        });
    }

    return { op: 'match', fieldLabel: describeInput(input), input, categories, fallback };
}

/**
 * Serializes a categorized model back into a MapLibre expression.
 * Only the outputs / fallback are taken from the (possibly edited) model;
 * conditions, the input, and label values are preserved verbatim.
 * @param {CategorizedModel} model
 * @returns {Array}
 */
export function serializeCategorized(model) {
    if (model.op === 'match') {
        const out = ['match', model.input];
        for (const cat of model.categories) {
            out.push(cat.value, cat.output);
        }
        out.push(model.fallback);
        return out;
    }
    // case
    const out = ['case'];
    for (const cat of model.categories) {
        out.push(cat.condition, cat.output);
    }
    out.push(model.fallback);
    return out;
}

// ===== GRADUATED (interpolate / step) =====

/**
 * @typedef {Object} StopRow
 * @property {number} stop - Break value (editable).
 * @property {*} output - Output paint value at/above this break (editable).
 */

/**
 * @typedef {Object} GraduatedModel
 * @property {'interpolate'|'step'} op
 * @property {string} interpOp - The actual interpolate operator name (interpolate / interpolate-hcl / ...).
 * @property {string} fieldLabel - Display label of the input field.
 * @property {*} input - Raw input expression (preserved).
 * @property {*} [interpolation] - Interpolation curve (interpolate op only), e.g. ["linear"].
 * @property {*} [base] - Output below the first stop (step op only; editable).
 * @property {StopRow[]} stops
 */

/**
 * Parses an `interpolate*` or `step` expression into a graduated model.
 * @param {*} expr
 * @returns {GraduatedModel|null}
 */
export function parseGraduated(expr) {
    if (!Array.isArray(expr)) return null;
    if (expr[0] === 'step') return parseStepExpr(expr);
    if (expr[0] === 'interpolate' || expr[0] === 'interpolate-hcl' || expr[0] === 'interpolate-lab') {
        return parseInterpolateExpr(expr);
    }
    return null;
}

/** @param {Array} expr @returns {GraduatedModel|null} */
function parseInterpolateExpr(expr) {
    // ["interpolate", interpolation, input, stop0, out0, stop1, out1, ...]
    if (expr.length < 5) return null;
    const interpOp = expr[0];
    const interpolation = expr[1];
    const input = expr[2];
    const body = expr.slice(3);
    if (body.length < 2 || body.length % 2 !== 0) return null; // stop/out pairs

    const stops = [];
    for (let i = 0; i < body.length; i += 2) {
        const stop = body[i];
        if (typeof stop !== 'number') return null;
        stops.push({ stop, output: body[i + 1] });
    }

    return { op: 'interpolate', interpOp, interpolation, input, fieldLabel: describeInput(input), stops };
}

/** @param {Array} expr @returns {GraduatedModel|null} */
function parseStepExpr(expr) {
    // ["step", input, base, stop1, out1, stop2, out2, ...]
    if (expr.length < 4) return null;
    const input = expr[1];
    const base = expr[2];
    const body = expr.slice(3);
    if (body.length < 2 || body.length % 2 !== 0) return null;

    const stops = [];
    for (let i = 0; i < body.length; i += 2) {
        const stop = body[i];
        if (typeof stop !== 'number') return null;
        stops.push({ stop, output: body[i + 1] });
    }

    return { op: 'step', interpOp: 'step', input, fieldLabel: describeInput(input), base, stops };
}

/**
 * Serializes a graduated model back into a MapLibre expression.
 * @param {GraduatedModel} model
 * @returns {Array}
 */
export function serializeGraduated(model) {
    if (model.op === 'step') {
        const out = ['step', model.input, model.base];
        for (const s of model.stops) {
            out.push(s.stop, s.output);
        }
        return out;
    }
    // interpolate*
    const out = [model.interpOp || 'interpolate', model.interpolation, model.input];
    for (const s of model.stops) {
        out.push(s.stop, s.output);
    }
    return out;
}

/**
 * Returns true when a graduated model's stop breaks are in strictly ascending
 * order — the precondition MapLibre enforces for interpolate/step input values.
 * A serialized expression that violates this throws on `setPaintProperty`, so
 * callers should gate apply/persist on this check.
 * @param {GraduatedModel} model
 * @returns {boolean}
 */
export function graduatedStopsAscending(model) {
    const stops = model?.stops || [];
    for (let i = 1; i < stops.length; i++) {
        if (!(stops[i].stop > stops[i - 1].stop)) return false;
    }
    return true;
}

// ===== INPUT / CONDITION HELPERS =====

/**
 * Extracts the field name from a `case` condition like ["==", ["get", f], v].
 * @param {*} condition
 * @returns {string} field name or '' when not derivable.
 */
function fieldFromCondition(condition) {
    if (!Array.isArray(condition)) return '';
    // Common shape: [op, inputExpr, value]
    const inputExpr = condition[1];
    return describeInput(inputExpr);
}

/**
 * Best-effort human label for a `case` condition (display only).
 * @param {*} condition
 * @returns {string}
 */
function labelFromCondition(condition) {
    if (!Array.isArray(condition)) return String(condition);
    const op = condition[0];
    const value = condition[condition.length - 1];
    if (op === '==') return String(value);
    if (op === '!=') return `≠ ${value}`;
    if (op === '>') return `> ${value}`;
    if (op === '>=') return `≥ ${value}`;
    if (op === '<') return `< ${value}`;
    if (op === '<=') return `≤ ${value}`;
    return `${op} ${value}`;
}

/**
 * Produces a short, readable label for an input expression.
 *   ["get", "field"]                -> "field"
 *   ["length", ["get", "field"]]    -> "length(field)"
 *   ["coalesce", ["get", "f"], 0]   -> "f"
 * @param {*} input
 * @returns {string}
 */
export function describeInput(input) {
    if (typeof input === 'string') return input;
    if (!Array.isArray(input)) return String(input);

    const op = input[0];
    if (op === 'get') return String(input[1]);
    if (op === 'coalesce') return describeInput(input[1]);
    if (op === 'to-number' || op === 'to-string') return describeInput(input[1]);
    if (op === 'length') return `length(${describeInput(input[1])})`;
    // Fallback: show the operator with its first argument.
    return `${op}(${input.slice(1).map(describeInput).join(', ')})`;
}

// ===== COLOR HELPERS =====

/**
 * @typedef {Object} Rgba
 * @property {number} r 0-255
 * @property {number} g 0-255
 * @property {number} b 0-255
 * @property {number} a 0-1
 */

/**
 * Parses a CSS color string into {r,g,b,a}. Handles hex (#rgb/#rgba/#rrggbb/
 * #rrggbbaa), rgb()/rgba(), and the `transparent` keyword. Returns null for
 * formats it cannot resolve (e.g. arbitrary named colors), so callers can keep
 * the original value untouched until the user explicitly changes it.
 * @param {*} value
 * @returns {Rgba|null}
 */
export function parseColor(value) {
    if (typeof value !== 'string') return null;
    const str = value.trim().toLowerCase();

    if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

    if (str.startsWith('#')) return parseHexColor(str);

    const m = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
    if (m) {
        const r = clampByte(Number(m[1]));
        const g = clampByte(Number(m[2]));
        const b = clampByte(Number(m[3]));
        const a = m[4] === undefined ? 1 : clamp01(Number(m[4]));
        if ([r, g, b, a].some(n => !Number.isFinite(n))) return null;
        return { r, g, b, a };
    }
    return null;
}

/** @param {string} str @returns {Rgba|null} */
function parseHexColor(str) {
    const hex = str.slice(1);
    let r;
    let g;
    let b;
    let a = 1;
    if (hex.length === 3 || hex.length === 4) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
        if (hex.length === 4) a = parseInt(hex[3] + hex[3], 16) / 255;
    } else if (hex.length === 6 || hex.length === 8) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
        if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
    } else {
        return null;
    }
    if ([r, g, b].some(n => !Number.isFinite(n))) return null;
    return { r, g, b, a: clamp01(a) };
}

/**
 * Formats an {r,g,b,a} object as a CSS color string. Emits `rgb()` when fully
 * opaque and `rgba()` otherwise, matching the config's prevailing style.
 * @param {Rgba} rgba
 * @returns {string}
 */
export function formatRgba({ r, g, b, a }) {
    const R = clampByte(Math.round(r));
    const G = clampByte(Math.round(g));
    const B = clampByte(Math.round(b));
    const A = clamp01(a);
    if (A >= 1) return `rgb(${R}, ${G}, ${B})`;
    // Trim to at most 2 decimals without trailing zeros.
    const alpha = String(Math.round(A * 100) / 100);
    return `rgba(${R}, ${G}, ${B}, ${alpha})`;
}

/**
 * Converts a color value to a 6-digit hex string for `<input type="color">`.
 * Falls back to '#000000' when the color cannot be parsed.
 * @param {*} value
 * @returns {string}
 */
export function toHex6(value) {
    const rgba = parseColor(value);
    if (!rgba) return '#000000';
    const h = (n) => clampByte(Math.round(n)).toString(16).padStart(2, '0');
    return `#${h(rgba.r)}${h(rgba.g)}${h(rgba.b)}`;
}

/** @param {number} n @returns {number} */
function clampByte(n) {
    if (!Number.isFinite(n)) return NaN;
    return Math.min(255, Math.max(0, n));
}

/** @param {number} n @returns {number} */
function clamp01(n) {
    if (!Number.isFinite(n)) return 1;
    return Math.min(1, Math.max(0, n));
}

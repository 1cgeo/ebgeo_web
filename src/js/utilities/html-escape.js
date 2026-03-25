// Path: js/utilities/html-escape.js
/**
 * @fileoverview HTML escape utility for XSS prevention.
 * Used when dynamic data (map names, feature names, imported data)
 * must be safely interpolated into innerHTML template literals.
 *
 * @module utilities/html-escape
 */

/**
 * Escapes HTML special characters in a string.
 * Uses the browser's native textContent -> innerHTML conversion
 * to properly escape &, <, >, ", and ' characters.
 *
 * Returns an empty string for null/undefined. Other non-string
 * values (numbers, booleans) are coerced via String().
 *
 * @param {string|number|null|undefined} str - Value to escape
 * @returns {string} HTML-escaped string safe for innerHTML interpolation
 *
 * @example
 * escapeHtml('<img src=x onerror=alert(1)>')
 * // Returns: '&lt;img src=x onerror=alert(1)&gt;'
 *
 * @example
 * element.innerHTML = `<span>${escapeHtml(userInput)}</span>`;
 */
export function escapeHtml(str) {
    if (str == null) return '';
    const text = typeof str === 'string' ? str : String(str);
    if (text === '') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

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
 * Uses the browser's native textContent → innerHTML conversion
 * to properly escape &, <, >, ", and ' characters.
 *
 * @param {string} str - String to escape
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
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

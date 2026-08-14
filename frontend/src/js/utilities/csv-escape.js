// Path: js/utilities/csv-escape.js

/**
 * @fileoverview CSV cell escaping, hardened against spreadsheet formula injection.
 *
 * Doubling quotes is a CSV *format* requirement, not a safety measure: a cell that
 * starts with `=`, `+`, `-`, `@`, TAB or CR is executed as a formula by Excel /
 * LibreOffice / Google Sheets when the file is opened. Feature names and attribute
 * values are free text authored by users and travel between collaborators through
 * sync, so an exported table can carry another user's payload.
 *
 * The numeric exception matters as much as the prefix: blindly prefixing `-`
 * would turn every negative number into text and break numeric columns.
 */

/** Leading characters a spreadsheet may interpret as the start of a formula. */
const DANGEROUS_PREFIX_RE = /^[=+\-@\t\r]/;

/** A plain (optionally negative, optionally fractional) number — never a formula. */
const NUMERIC_RE = /^-?\d+([.,]\d+)?$/;

/**
 * Escapes a single value as a quoted CSV cell, neutralizing formula injection.
 * @param {*} value - Raw cell value (null/undefined become an empty cell).
 * @returns {string} The quoted, escaped cell.
 */
export function escapeCsvCell(value) {
    const s = value == null ? '' : String(value);
    const dangerous = DANGEROUS_PREFIX_RE.test(s);
    const numeric = NUMERIC_RE.test(s.trim());
    const safe = (dangerous && !numeric) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
}

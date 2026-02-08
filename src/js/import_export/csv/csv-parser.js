// Path: js/import_export/csv/csv-parser.js

/**
 * @fileoverview Lightweight CSV parser with configurable separator.
 * Handles quoted fields (RFC 4180), mixed line endings, whitespace trimming.
 * No external dependencies.
 * @dependencies None
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const CSV_SEPARATORS = [
    { value: ',', label: 'Vírgula (,)' },
    { value: ';', label: 'Ponto e vírgula (;)' },
    { value: '\t', label: 'Tabulação (Tab)' },
];

const MAX_PREVIEW_ROWS = 5;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Parses CSV text into headers and row objects.
 * First row is treated as header.
 * @param {string} text - Raw CSV text
 * @param {string} separator - Column separator character
 * @returns {{ headers: string[], rows: Object[], totalRows: number }}
 */
export function parseCSV(text, separator) {
    const lines = _splitLines(text);
    if (lines.length === 0) {
        return { headers: [], rows: [], totalRows: 0 };
    }

    const headers = _parseLine(lines[0], separator).map(h => h.trim());
    if (headers.length === 0 || headers.every(h => h === '')) {
        return { headers: [], rows: [], totalRows: 0 };
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = _parseLine(lines[i], separator);
        if (values.length === 0 || values.every(v => v.trim() === '')) continue;

        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = j < values.length ? values[j].trim() : '';
        }
        rows.push(row);
    }

    return { headers, rows, totalRows: rows.length };
}

/**
 * Parses only headers + preview rows for the config panel.
 * @param {string} text - Raw CSV text
 * @param {string} separator - Column separator character
 * @returns {{ headers: string[], previewRows: string[][], totalRows: number }}
 */
export function parseCSVPreview(text, separator) {
    const lines = _splitLines(text);
    if (lines.length === 0) {
        return { headers: [], previewRows: [], totalRows: 0 };
    }

    const headers = _parseLine(lines[0], separator).map(h => h.trim());
    if (headers.length === 0 || headers.every(h => h === '')) {
        return { headers: [], previewRows: [], totalRows: 0 };
    }

    // Count non-empty data lines for totalRows
    let totalRows = 0;
    const previewRows = [];

    for (let i = 1; i < lines.length; i++) {
        const values = _parseLine(lines[i], separator);
        if (values.length === 0 || values.every(v => v.trim() === '')) continue;

        totalRows++;
        if (previewRows.length < MAX_PREVIEW_ROWS) {
            previewRows.push(values.map(v => v.trim()));
        }
    }

    return { headers, previewRows, totalRows };
}

/**
 * Auto-detects the most likely separator by counting occurrences in first lines.
 * @param {string} text - Raw CSV text
 * @returns {string} Best separator character
 */
export function detectSeparator(text) {
    const sampleLines = _splitLines(text).slice(0, 10);
    if (sampleLines.length === 0) return ',';

    const candidates = [',', ';', '\t'];
    let bestSeparator = ',';
    let bestScore = -1;

    for (const sep of candidates) {
        // Count occurrences per line, score = minimum across lines (consistency)
        const counts = sampleLines.map(line => {
            let count = 0;
            let inQuotes = false;
            for (const ch of line) {
                if (ch === '"') inQuotes = !inQuotes;
                else if (ch === sep && !inQuotes) count++;
            }
            return count;
        });

        const minCount = Math.min(...counts);
        // Prefer separators that appear consistently and frequently
        if (minCount > bestScore) {
            bestScore = minCount;
            bestSeparator = sep;
        }
    }

    return bestSeparator;
}

// ============================================================================
// PRIVATE
// ============================================================================

/**
 * Splits text into lines, handling mixed line endings.
 * Respects quoted fields that may contain newlines.
 * @param {string} text - Raw CSV text
 * @returns {string[]}
 */
function _splitLines(text) {
    const lines = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (ch === '"') {
            inQuotes = !inQuotes;
            current += ch;
        } else if (!inQuotes && (ch === '\r' || ch === '\n')) {
            // Handle \r\n as single line ending
            if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
                i++;
            }
            if (current.length > 0) {
                lines.push(current);
            }
            current = '';
        } else {
            current += ch;
        }
    }

    if (current.length > 0) {
        lines.push(current);
    }

    return lines;
}

/**
 * Parses a single CSV line into an array of field values.
 * Handles quoted fields and escaped quotes (RFC 4180).
 * @param {string} line - Single CSV line
 * @param {string} separator - Column separator
 * @returns {string[]}
 */
function _parseLine(line, separator) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
        const ch = line[i];

        if (inQuotes) {
            if (ch === '"') {
                // Check for escaped quote ""
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i += 2;
                } else {
                    inQuotes = false;
                    i++;
                }
            } else {
                current += ch;
                i++;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
                i++;
            } else if (ch === separator) {
                fields.push(current);
                current = '';
                i++;
            } else {
                current += ch;
                i++;
            }
        }
    }

    fields.push(current);
    return fields;
}

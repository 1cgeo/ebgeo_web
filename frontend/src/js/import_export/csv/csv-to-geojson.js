// Path: js/import_export/csv/csv-to-geojson.js

/**
 * @fileoverview Converts configured CSV data to GeoJSON FeatureCollection.
 * Combines csv-parser and csv-coordinate-converter to produce importable GeoJSON.
 *
 * There is NO row cap: the 1000-row limit was removed on 2026-09-02 at the
 * owner's request, together with the twin geometry cap in import.control.js.
 * Rows that fail coordinate conversion are still skipped (counted in
 * skippedCount), and an all-invalid file still throws.
 *
 * A TEMPORAL CELL THAT CANNOT BE READ USED TO DISAPPEAR TWICE. It did not become
 * a window, and because its column is RESERVED (consumed into the window) it did
 * not survive as a user attribute either, so the text the person had typed was
 * gone from the import with nothing on screen to say so. Now the raw text is kept
 * as an ordinary attribute under its own column name, and the two degradations a
 * temporal column can suffer are COUNTED into `temporalIssues`, so the panel can
 * name them.
 *
 * `temporalIssues` carries the SAME shape and the same field names the generic
 * importer's report uses (`naoLidas`, `invertidas`), and the sentences come from
 * `describeTemporalIssues` in `temporal/temporal-import.js`. Both were briefly
 * local to this file; they moved the moment the generic importer needed them, so
 * the same degradation cannot be named one way here and another way one tab over.
 * @dependencies csv-parser, csv-coordinate-converter
 */

import { parseCSV } from './csv-parser.js';
import { convertRowToLatLng } from './csv-coordinate-converter.js';
import { toEpoch } from '@js/temporal/temporal.utils.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Converts CSV text to GeoJSON FeatureCollection using user configuration.
 * @param {Object} config
 * @param {string} config.csvText - Raw CSV text
 * @param {string} config.separator - Column separator
 * @param {string} config.coordinateFormat - Format ID from CSV_COORDINATE_FORMATS
 * @param {Object} config.columnMapping - Maps format fields to CSV column names
 * @param {Object} [config.fixedValues] - Fixed values (e.g., { zone: '23S' })
 * @param {Object} [config.temporalMapping] - Optional { inicio?: columnName, fim?: columnName }
 *   mapping CSV columns to the temporal validity window (parsed via toEpoch).
 * @returns {{ geoJSON: Object, errors: Array<{row: number, message: string}>,
 *   skippedCount: number, temporalIssues: {naoLidas: number, invertidas: number} }}
 */
export function csvToGeoJSON(config) {
    const {
        csvText,
        separator,
        coordinateFormat,
        columnMapping,
        fixedValues = {},
        temporalMapping = {},
    } = config;

    const { headers, rows, totalRows } = parseCSV(csvText, separator);

    if (totalRows === 0) {
        throw new Error('Nenhuma linha de dados encontrada no arquivo CSV');
    }

    // Determine which columns hold coordinate data (exclude from attributes)
    const coordinateColumns = new Set(Object.values(columnMapping));

    // Temporal columns are consumed into temporalInicio/temporalFim and must
    // never also leak into the feature's user attributes.
    const temporalInicioCol = temporalMapping.inicio || null;
    const temporalFimCol = temporalMapping.fim || null;
    const reservedColumns = new Set(coordinateColumns);
    if (temporalInicioCol) reservedColumns.add(temporalInicioCol);
    if (temporalFimCol) reservedColumns.add(temporalFimCol);

    const features = [];
    const errors = [];
    let skippedCount = 0;
    // Same field names the generic importer's report uses, so the shared phrase
    // function reads this object without a translation step in between.
    const temporalIssues = { naoLidas: 0, invertidas: 0 };

    /**
     * Applies one mapped temporal column to a row. On a successful read the epoch
     * lands on `field`; on a failed read the RAW TEXT is kept as an attribute
     * under its own column name, so the cell is degraded rather than erased.
     * @returns {boolean} True when the cell was present but unreadable.
     */
    const applyTemporalColumn = (properties, row, column, field) => {
        const raw = row[column];
        const ms = toEpoch(raw);
        if (ms !== null) {
            properties[field] = ms;
            return false;
        }
        const text = raw === undefined || raw === null ? '' : String(raw).trim();
        if (text === '') return false;
        // A column doing double duty as a coordinate keeps its coordinate role.
        if (!coordinateColumns.has(column)) properties[column] = raw;
        return true;
    };

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2; // +2 because row 1 is header, data starts at row 2

        const result = convertRowToLatLng(row, coordinateFormat, columnMapping, fixedValues);

        if (!result) {
            errors.push({ row: rowNumber, message: 'Coordenada inválida' });
            skippedCount++;
            continue;
        }

        // Build properties from non-coordinate, non-temporal columns
        const properties = {};
        for (const header of headers) {
            if (!reservedColumns.has(header)) {
                const value = row[header];
                if (value !== undefined && value !== '') {
                    properties[header] = value;
                }
            }
        }

        // Apply temporal validity (epoch ms) from the mapped columns, if any.
        if (temporalInicioCol && applyTemporalColumn(properties, row, temporalInicioCol, 'temporalInicio')) {
            temporalIssues.naoLidas++;
        }
        if (temporalFimCol && applyTemporalColumn(properties, row, temporalFimCol, 'temporalFim')) {
            temporalIssues.naoLidas++;
        }

        // An end BEFORE the start makes the visibility predicate unsatisfiable:
        // the feature would be gone from the 3D, the 360 and the PDF legend for
        // good. Same rule as the GeoJSON/KML reader — keep the start, drop the
        // end, and let the raw text survive as an attribute so nothing is erased.
        if (Number.isFinite(properties.temporalInicio) && Number.isFinite(properties.temporalFim)
            && properties.temporalFim < properties.temporalInicio) {
            delete properties.temporalFim;
            if (temporalFimCol && !coordinateColumns.has(temporalFimCol)) {
                properties[temporalFimCol] = row[temporalFimCol];
            }
            temporalIssues.invertidas++;
        }

        features.push({
            type: 'Feature',
            properties,
            geometry: {
                type: 'Point',
                coordinates: [result.lng, result.lat],
            },
        });
    }

    if (features.length === 0) {
        throw new Error('Nenhuma coordenada válida encontrada no arquivo CSV');
    }

    const geoJSON = {
        type: 'FeatureCollection',
        features,
    };

    return { geoJSON, errors, skippedCount, temporalIssues };
}

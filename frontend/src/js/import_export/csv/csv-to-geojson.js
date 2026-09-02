// Path: js/import_export/csv/csv-to-geojson.js

/**
 * @fileoverview Converts configured CSV data to GeoJSON FeatureCollection.
 * Combines csv-parser and csv-coordinate-converter to produce importable GeoJSON.
 *
 * There is NO row cap: the 1000-row limit was removed on 2026-09-02 at the
 * owner's request, together with the twin geometry cap in import.control.js.
 * Rows that fail coordinate conversion are still skipped (counted in
 * skippedCount), and an all-invalid file still throws.
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
 * @returns {{ geoJSON: Object, errors: Array<{row: number, message: string}>, skippedCount: number }}
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
        if (temporalInicioCol) {
            const ms = toEpoch(row[temporalInicioCol]);
            if (ms !== null) properties.temporalInicio = ms;
        }
        if (temporalFimCol) {
            const ms = toEpoch(row[temporalFimCol]);
            if (ms !== null) properties.temporalFim = ms;
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

    return { geoJSON, errors, skippedCount };
}

// Path: js/import_export/csv/csv-to-geojson.js

/**
 * @fileoverview Converts configured CSV data to GeoJSON FeatureCollection.
 * Combines csv-parser and csv-coordinate-converter to produce importable GeoJSON.
 * @dependencies csv-parser, csv-coordinate-converter
 */

import { parseCSV } from './csv-parser.js';
import { convertRowToLatLng } from './csv-coordinate-converter.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_FEATURES = 1000;

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
 * @returns {{ geoJSON: Object, errors: Array<{row: number, message: string}>, skippedCount: number }}
 */
export function csvToGeoJSON(config) {
    const {
        csvText,
        separator,
        coordinateFormat,
        columnMapping,
        fixedValues = {},
    } = config;

    const { headers, rows, totalRows } = parseCSV(csvText, separator);

    if (totalRows === 0) {
        throw new Error('Nenhuma linha de dados encontrada no arquivo CSV');
    }

    if (totalRows > MAX_FEATURES) {
        throw new Error(`Muitas linhas (${totalRows}). Limite máximo: ${MAX_FEATURES}`);
    }

    // Determine which columns hold coordinate data (exclude from attributes)
    const coordinateColumns = new Set(Object.values(columnMapping));

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

        // Build properties from non-coordinate columns
        const properties = {};
        for (const header of headers) {
            if (!coordinateColumns.has(header)) {
                const value = row[header];
                if (value !== undefined && value !== '') {
                    properties[header] = value;
                }
            }
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

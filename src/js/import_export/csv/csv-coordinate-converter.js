// Path: js/import_export/csv/csv-coordinate-converter.js

/**
 * @fileoverview Converts individual CSV column values to lat/lng coordinates.
 * Handles DD, DMS, MGRS, and UTM formats from separate columns.
 * @dependencies mgrs, proj4
 */

import * as mgrs from 'mgrs';
import proj4 from 'proj4';

// ============================================================================
// CONSTANTS
// ============================================================================

export const CSV_COORDINATE_FORMATS = [
    {
        id: 'latlong_dd',
        label: 'Lat/Long (Grau Decimal)',
        requiredColumns: ['latitude', 'longitude'],
        columnLabels: { latitude: 'Latitude (DD)', longitude: 'Longitude (DD)' },
    },
    {
        id: 'latlong_dms',
        label: 'Lat/Long (GMS)',
        requiredColumns: ['latitude', 'longitude'],
        columnLabels: { latitude: 'Latitude (GMS)', longitude: 'Longitude (GMS)' },
    },
    {
        id: 'mgrs',
        label: 'MGRS',
        requiredColumns: ['mgrs'],
        columnLabels: { mgrs: 'MGRS' },
    },
    {
        id: 'utm',
        label: 'UTM',
        requiredColumns: ['easting', 'northing'],
        optionalColumns: ['zone'],
        columnLabels: {
            easting: 'Easting (E)',
            northing: 'Northing (N)',
            zone: 'Zona UTM',
        },
        hasFixedZone: true,
    },
];

/**
 * Header names commonly used for each coordinate role.
 * Used for auto-detection of column mappings.
 */
export const COLUMN_HINTS = {
    latitude: ['lat', 'latitude', 'latitud', 'y'],
    longitude: ['lon', 'lng', 'long', 'longitude', 'longitud', 'x'],
    mgrs: ['mgrs', 'grid', 'coordenada_mgrs'],
    easting: ['easting', 'e', 'este', 'leste', 'coord_e', 'utm_e'],
    northing: ['northing', 'n', 'norte', 'coord_n', 'utm_n'],
    zone: ['zone', 'zona', 'utm_zone', 'zona_utm', 'fuso'],
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Converts a single CSV row's coordinate columns to {lat, lng}.
 * @param {Object} row - CSV row as key-value pairs
 * @param {string} formatId - Coordinate format ID
 * @param {Object} columnMapping - Maps format fields to CSV column names
 * @param {Object} [fixedValues] - Fixed values not from columns (e.g. { zone: '23S' })
 * @returns {{ lat: number, lng: number } | null}
 */
export function convertRowToLatLng(row, formatId, columnMapping, fixedValues = {}) {
    switch (formatId) {
        case 'latlong_dd':
            return _parseDecimalDegrees(row, columnMapping);
        case 'latlong_dms':
            return _parseDMS(row, columnMapping);
        case 'mgrs':
            return _parseMGRS(row, columnMapping);
        case 'utm':
            return _parseUTM(row, columnMapping, fixedValues);
        default:
            return null;
    }
}

/**
 * Tries to auto-detect column mappings based on header names.
 * @param {string[]} headers - CSV column headers
 * @param {string} formatId - Coordinate format ID
 * @returns {Object} Column mapping (partial or complete)
 */
export function autoDetectColumnMapping(headers, formatId) {
    const format = CSV_COORDINATE_FORMATS.find(f => f.id === formatId);
    if (!format) return {};

    const mapping = {};
    const allColumns = [...format.requiredColumns, ...(format.optionalColumns || [])];

    for (const role of allColumns) {
        const hints = COLUMN_HINTS[role] || [];
        const match = headers.find(h => {
            const normalized = h.toLowerCase().trim();
            return hints.includes(normalized);
        });
        if (match) {
            mapping[role] = match;
        }
    }

    return mapping;
}

// ============================================================================
// PRIVATE - FORMAT-SPECIFIC PARSERS
// ============================================================================

/**
 * Parses decimal degree values from individual columns.
 * Accepts: -22.455921 or -22,455921 (comma as decimal separator)
 */
function _parseDecimalDegrees(row, mapping) {
    const latStr = row[mapping.latitude];
    const lngStr = row[mapping.longitude];
    if (!latStr || !lngStr) return null;

    const lat = _parseNumber(latStr);
    const lng = _parseNumber(lngStr);
    if (lat === null || lng === null) return null;

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
}

/**
 * Parses DMS values from individual columns.
 * Each column contains a single axis: "30°07'56.8" S" or "30 07 56.8 S"
 */
function _parseDMS(row, mapping) {
    const latStr = row[mapping.latitude];
    const lngStr = row[mapping.longitude];
    if (!latStr || !lngStr) return null;

    const lat = _parseSingleDMS(latStr, 'lat');
    const lng = _parseSingleDMS(lngStr, 'lng');
    if (lat === null || lng === null) return null;

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
}

/**
 * Parses MGRS coordinate from a single column.
 */
function _parseMGRS(row, mapping) {
    const mgrsStr = row[mapping.mgrs];
    if (!mgrsStr) return null;

    try {
        const cleaned = mgrsStr.replace(/\s+/g, '');
        const result = mgrs.toPoint(cleaned);
        return { lng: result[0], lat: result[1] };
    } catch {
        return null;
    }
}

/**
 * Parses UTM coordinates from easting/northing columns + zone.
 * Zone comes from a column or from fixedValues.
 */
function _parseUTM(row, mapping, fixedValues) {
    const eastingStr = row[mapping.easting];
    const northingStr = row[mapping.northing];
    if (!eastingStr || !northingStr) return null;

    const easting = _parseNumber(eastingStr);
    const northing = _parseNumber(northingStr);
    if (easting === null || northing === null) return null;

    // Get zone from column or fixed value
    const zoneStr = mapping.zone
        ? row[mapping.zone]
        : fixedValues.zone;
    if (!zoneStr) return null;

    const zoneInfo = _parseUTMZone(String(zoneStr).trim());
    if (!zoneInfo) return null;

    // Validate ranges
    if (easting < 160000 || easting > 840000 || northing < 0) return null;

    try {
        const utmProjection = `+proj=utm +zone=${zoneInfo.zone} ${zoneInfo.hemisphere === 'S' ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
        const wgs84 = '+proj=longlat +datum=WGS84 +no_defs';
        const result = proj4(utmProjection, wgs84, [easting, northing]);
        return { lng: result[0], lat: result[1] };
    } catch {
        return null;
    }
}

// ============================================================================
// PRIVATE - HELPERS
// ============================================================================

/**
 * Parses a numeric value, handling comma as decimal separator and optional
 * thousands separators (pt-BR "1.234,56" or en-US "1,234.56").
 * @param {string} value
 * @returns {number|null}
 */
function _parseNumber(value) {
    let cleaned = String(value).trim();
    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');

    if (hasComma && hasDot) {
        // The rightmost separator is the decimal mark; the other is grouping.
        if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
            // pt-BR: dot groups thousands, comma is the decimal mark.
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else {
            // en-US: comma groups thousands, dot is the decimal mark.
            cleaned = cleaned.replace(/,/g, '');
        }
    } else if (hasComma) {
        // Only commas present: treat comma as the decimal separator.
        cleaned = cleaned.replace(/,/g, '.');
    }

    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
}

/**
 * Parses a single DMS axis value (latitude or longitude).
 * Handles various notations:
 * - "30°07'56.8" S" or "30º07'56.8" S"
 * - "30 07 56.8 S"
 * - "-30.132222" (fallback to decimal)
 *
 * @param {string} value - DMS string for one axis
 * @param {'lat'|'lng'} axis - Which axis (determines valid directions)
 * @returns {number|null} Signed decimal degrees
 */
function _parseSingleDMS(value, axis) {
    const trimmed = String(value).trim();

    // DMS with degree/minute/second symbols
    const dmsPattern = /^(-?)(\d+)[º°]\s*(\d+)['′]\s*(\d+(?:[.,]\d+)?)["\u2033]?\s*([NSLOEW])?$/i;
    let match = trimmed.match(dmsPattern);
    if (match) {
        return _computeDMS(match[1], match[2], match[3], match[4], match[5]);
    }

    // DM (degrees + minutes, no seconds) with symbols
    const dmPattern = /^(-?)(\d+)[º°]\s*(\d+(?:[.,]\d+)?)['′]\s*([NSLOEW])?$/i;
    match = trimmed.match(dmPattern);
    if (match) {
        return _computeDMS(match[1], match[2], match[3], '0', match[4]);
    }

    // Space-separated: "30 07 56.8 S"
    const spacePattern = /^(-?)(\d+)\s+(\d+)\s+(\d+(?:[.,]\d+)?)\s*([NSLOEW])?$/i;
    match = trimmed.match(spacePattern);
    if (match) {
        return _computeDMS(match[1], match[2], match[3], match[4], match[5]);
    }

    // Fallback: try as plain decimal number
    const num = _parseNumber(trimmed);
    if (num !== null) {
        const limit = axis === 'lat' ? 90 : 180;
        if (num >= -limit && num <= limit) return num;
    }

    return null;
}

/**
 * Computes decimal degrees from DMS components.
 */
function _computeDMS(signStr, degStr, minStr, secStr, dirStr) {
    const deg = parseInt(degStr, 10);
    const min = parseFloat(String(minStr).replace(',', '.'));
    const sec = parseFloat(String(secStr).replace(',', '.')) || 0;

    if (isNaN(deg) || isNaN(min)) return null;
    if (min >= 60 || sec >= 60) return null;

    let result = deg + (min / 60) + (sec / 3600);

    // Apply sign from minus prefix
    if (signStr === '-') result = -result;

    // Apply direction
    if (dirStr) {
        const dir = dirStr.toUpperCase();
        if (dir === 'S' || dir === 'O' || dir === 'W') {
            result = -Math.abs(result);
        } else if (dir === 'N' || dir === 'L' || dir === 'E') {
            result = Math.abs(result);
        }
    }

    return result;
}

/**
 * Parses a UTM zone string like "23S", "23 S", "23K", or just "23".
 * @param {string} zoneStr
 * @returns {{ zone: number, hemisphere: string } | null}
 */
function _parseUTMZone(zoneStr) {
    // Pattern: zone number + optional letter (hemisphere or MGRS band)
    const match = zoneStr.match(/^(\d{1,2})\s*([A-Za-z])?$/);
    if (!match) return null;

    const zone = parseInt(match[1], 10);
    if (zone < 1 || zone > 60) return null;

    // Determine hemisphere from letter.
    // MGRS band letters: C-M = South, N-X = North.
    // Explicit 'S' is treated as South (band S is North, but user likely
    // means hemisphere in "23S" notation — Brazil-centric default).
    let hemisphere = 'S'; // Default to South (Brazil-centric)
    if (match[2]) {
        const letter = match[2].toUpperCase();
        if (letter === 'S') {
            hemisphere = 'S';
        } else if (letter >= 'N') {
            hemisphere = 'N';
        }
    }

    return { zone, hemisphere };
}

// Path: js/utilities/coordinate_converter.js
import * as mgrs from 'mgrs';
import proj4 from 'proj4';

/**
 * Centralized utility for coordinate format conversions.
 * Supports Lat/Long (Decimal and DMS), UTM WGS84, and MGRS.
 */

export const COORDINATE_FORMATS = [
    { id: 'latlong', label: 'Lat/Long (Decimal)' },
    { id: 'latlong_dms', label: 'Lat/Long (GMS)' },
    { id: 'utm_wgs84', label: 'UTM' },
    { id: 'mgrs', label: 'MGRS' }
];

// ============================================================================
// SHARED HELPERS
// ============================================================================

const WGS84_PROJ = '+proj=longlat +datum=WGS84 +no_defs';

/**
 * Builds a proj4 UTM projection string.
 * @param {number} zone - UTM zone number (1-60)
 * @param {string} hemisphere - 'N' or 'S'
 * @returns {string} proj4 projection string
 */
function buildUtmProjection(zone, hemisphere) {
    return `+proj=utm +zone=${zone} ${hemisphere === 'S' ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
}

/**
 * Computes the UTM zone number from a longitude value.
 *
 * The clamp is not cosmetic. Longitude exactly 180 (the antimeridian, a legal
 * value everywhere else in this module) computed zone 61, which does not exist:
 * the module then WROTE `61N ...` and `parseUTMWGS84` refused to read it back,
 * so a user copying the string the app had just shown got nothing.
 *
 * @param {number} lng - Longitude in decimal degrees
 * @returns {number} UTM zone (1-60)
 */
function getUtmZone(lng) {
    return Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1));
}

/**
 * Converts lat/lng to UTM easting/northing via proj4.
 * @param {number} lat
 * @param {number} lng
 * @returns {{ zone: number, hemisphere: string, easting: number, northing: number }}
 */
function toUtmCoords(lat, lng) {
    const zone = getUtmZone(lng);
    const hemisphere = lat >= 0 ? 'N' : 'S';
    const coords = proj4(WGS84_PROJ, buildUtmProjection(zone, hemisphere), [lng, lat]);
    return { zone, hemisphere, easting: coords[0], northing: coords[1] };
}

/**
 * Checks whether lat/lng are within valid ranges.
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean}
 */
function isValidLatLng(lat, lng) {
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Creates a latlong display format object (used as fallback in several places).
 * @param {number} lat
 * @param {number} lng
 * @returns {{ parts: Array<{ label: string, value: string }> }}
 */
function createLatLongDisplayParts(lat, lng) {
    return {
        parts: [
            { label: 'Lat', value: `${lat.toFixed(5)}°` },
            { label: 'Lon', value: `${lng.toFixed(5)}°` }
        ]
    };
}

/**
 * Returns cardinal direction letters for a lat/lng pair.
 * Uses Brazilian convention: L (Leste) for east, O (Oeste) for west.
 * @param {number} lat
 * @param {number} lng
 * @returns {{ latDir: string, lngDir: string }}
 */
function getDirections(lat, lng) {
    return {
        latDir: lat >= 0 ? 'N' : 'S',
        lngDir: lng >= 0 ? 'L' : 'O'
    };
}

/**
 * Decomposes an absolute decimal-degree value into degrees, minutes, seconds.
 * @param {number} absValue - Absolute value in decimal degrees
 * @returns {{ deg: number, min: number, sec: number }}
 */
function toDMSParts(absValue) {
    const deg = Math.floor(absValue);
    const minDecimal = (absValue - deg) * 60;
    const min = Math.floor(minDecimal);
    const sec = (minDecimal - min) * 60;
    return { deg, min, sec };
}

/**
 * Formats a DMS decomposition as a string like `30º07'56.8" S`.
 *
 * The carry lives HERE, not in `toDMSParts`, because the rounding that creates
 * the problem is the `toFixed(1)` of this function: the minute has already been
 * floored by then, so a seconds field that rounds up to 60.0 has nowhere to go
 * and the app printed `1º01'60.0" N` for what is `1º02'00.0" N`.
 *
 * @param {{ deg: number, min: number, sec: number }} parts
 * @param {string} direction - Cardinal direction letter (N, S, L, O)
 * @returns {string}
 */
function formatDMSString(parts, direction) {
    let { deg, min } = parts;
    let secStr = parts.sec.toFixed(1);

    if (Number.parseFloat(secStr) >= 60) {
        secStr = '0.0';
        min += 1;
    }
    if (min >= 60) {
        min -= 60;
        deg += 1;
    }

    const minStr = min.toString().padStart(2, '0');
    return `${deg}º${minStr}'${secStr.padStart(4, '0')}" ${direction}`;
}

/**
 * Converts a DMS regex match group into a decimal-degree value.
 * @param {string} degStr - Degrees capture group
 * @param {string} minStr - Minutes capture group
 * @param {string} secStr - Seconds capture group ('0' when absent)
 * @param {string} dirStr - Direction letter (N/S/L/O/E/W)
 * @returns {number} Decimal-degree value (negative for S/O/W)
 */
function dmsGroupToDecimal(degStr, minStr, secStr, dirStr) {
    const deg = parseInt(degStr, 10);
    const min = parseInt(minStr, 10);
    const sec = parseFloat(secStr);
    const dir = dirStr.toUpperCase();

    let value = deg + (min / 60) + (sec / 3600);
    if (dir === 'S' || dir === 'O' || dir === 'W') value = -value;
    return value;
}

// ============================================================================
// PLACEHOLDERS
// ============================================================================

/**
 * Gets placeholder text for a coordinate format.
 *
 * THE FOUR HINTS ARE THE SAME POINT, Resende (-22.455921, -44.449655), and each
 * one is exactly what `formatCoordinates` writes for it in that format. They were
 * three different places, and the UTM one did not even parse in its own format:
 * it advertised the MGRS band letter (`23K`) where `parseUTMWGS84` accepts only
 * N/S, so a user who copied the hint verbatim got nothing. When changing one,
 * change all four together, and keep them round-trippable.
 *
 * @param {string} formatId - Format identifier
 * @returns {string} Placeholder text
 */
export function getPlaceholderForFormat(formatId) {
    switch (formatId) {
        case 'latlong':
            return '-22.455921, -44.449655';
        case 'latlong_dms':
            return '22º27\'21.3" S 44º26\'58.8" O';
        case 'utm_wgs84':
            return '23S 556624 7516604';
        case 'mgrs':
            return '23K NR 56624 16603';
        default:
            return 'Entrar coordenadas';
    }
}

// ============================================================================
// PARSING
// ============================================================================

/**
 * Converts a coordinate string to {lat, lng} based on the specified format.
 * @param {string} input - Input coordinate string
 * @param {string} formatId - Format identifier
 * @returns {Object|null} {lat, lng} object or null if invalid
 */
export function parseCoordinates(input, formatId) {
    try {
        switch (formatId) {
            case 'latlong':
                return parseLatLong(input);
            case 'latlong_dms':
                return parseLatLongDMS(input);
            case 'utm_wgs84':
                return parseUTMWGS84(input);
            case 'mgrs':
                return parseMGRS(input);
            default:
                return null;
        }
    } catch (error) {
        console.error('Error parsing coordinates:', error);
        return null;
    }
}

/**
 * Converts {lat, lng} to a string in the specified format.
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} formatId - Format identifier
 * @returns {string} Formatted coordinate string
 */
export function formatCoordinates(lat, lng, formatId) {
    try {
        switch (formatId) {
            case 'latlong':
                return formatLatLong(lat, lng);
            case 'latlong_dms':
                return formatLatLongDMS(lat, lng);
            case 'utm_wgs84':
                return formatUTMWGS84(lat, lng);
            case 'mgrs':
                return formatMGRS(lat, lng);
            default:
                return formatLatLong(lat, lng);
        }
    } catch (error) {
        console.error('Error formatting coordinates:', error);
        return formatLatLong(lat, lng);
    }
}

/**
 * Gets a structured display format with labeled parts.
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} formatId - Format identifier
 * @returns {Object} Display format object with parts array
 */
export function getDisplayFormat(lat, lng, formatId) {
    try {
        switch (formatId) {
            case 'latlong':
                return createLatLongDisplayParts(lat, lng);
            case 'latlong_dms':
                return getDMSDisplayFormat(lat, lng);
            case 'utm_wgs84':
                return getUTMWGS84DisplayFormat(lat, lng);
            case 'mgrs':
                return getMGRSDisplayFormat(lat, lng);
            default:
                return createLatLongDisplayParts(lat, lng);
        }
    } catch (error) {
        console.error('Error getting display format:', error);
        return createLatLongDisplayParts(lat, lng);
    }
}

// ============================================================================
// FORMAT-SPECIFIC PARSERS
// ============================================================================

/**
 * Parses decimal lat/lng from a string.
 * Accepts: `-22.455921, -44.449655` or `-22.455921 -44.449655`
 * @param {string} input
 * @returns {{ lat: number, lng: number }|null}
 */
function parseLatLong(input) {
    const match = input.match(/^\s*(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)\s*$/);
    if (!match) return null;

    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);

    return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

// DMS regex patterns (compiled once at module level)
const DMS_FULL_PATTERN = /(\d+)[º°]\s*(\d+)['′]\s*(\d+(?:\.\d+)?)["\u2033]?\s*([NS])\s+(\d+)[º°]\s*(\d+)['′]\s*(\d+(?:\.\d+)?)["\u2033]?\s*([LOEW])/i;
const DMS_NO_SECONDS_PATTERN = /(\d+)[º°]\s*(\d+)['′]\s*([NS])\s+(\d+)[º°]\s*(\d+)['′]\s*([LOEW])/i;
const DMS_SPACE_PATTERN = /(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s*([NS])\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s*([LOEW])/i;

/**
 * Parses DMS (Degrees, Minutes, Seconds) coordinates.
 * Accepts multiple notations:
 * - 30º07'56.8" S 55º01'04.3" O
 * - 30°07'56.8" S 55°01'04.3" O
 * - 30 07 56.8 S 55 01 04.3 O
 * - 30º07' S 55º01' O (without seconds)
 * @param {string} input
 * @returns {{ lat: number, lng: number }|null}
 */
function parseLatLongDMS(input) {
    const normalized = input.trim();

    let match = normalized.match(DMS_FULL_PATTERN);
    if (match) return buildDMSResult(match, true);

    match = normalized.match(DMS_NO_SECONDS_PATTERN);
    if (match) return buildDMSResult(match, false);

    match = normalized.match(DMS_SPACE_PATTERN);
    if (match) return buildDMSResult(match, true);

    return null;
}

/**
 * Builds a lat/lng result from DMS regex match groups.
 * @param {RegExpMatchArray} match
 * @param {boolean} hasSeconds - Whether match includes seconds groups
 * @returns {{ lat: number, lng: number }|null}
 */
function buildDMSResult(match, hasSeconds) {
    // When hasSeconds is true, groups are: deg, min, sec, dir, deg, min, sec, dir (8 groups)
    // When false, groups are: deg, min, dir, deg, min, dir (6 groups)
    const latOffset = 1;
    const lngOffset = hasSeconds ? 5 : 4;

    const lat = dmsGroupToDecimal(
        match[latOffset], match[latOffset + 1],
        hasSeconds ? match[latOffset + 2] : '0',
        match[hasSeconds ? latOffset + 3 : latOffset + 2]
    );
    const lng = dmsGroupToDecimal(
        match[lngOffset], match[lngOffset + 1],
        hasSeconds ? match[lngOffset + 2] : '0',
        match[hasSeconds ? lngOffset + 3 : lngOffset + 2]
    );

    return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

/**
 * Parses UTM WGS84 coordinates.
 * @param {string} input - e.g. "23S 680834 7516602"
 * @returns {{ lat: number, lng: number }|null}
 */
function parseUTMWGS84(input) {
    const match = input.match(/^\s*(\d{1,2})([NS])?\s+(\d+)\s+(\d+)\s*$/i);
    if (!match) return null;

    const zone = parseInt(match[1], 10);
    const hemisphere = (match[2] || 'S').toUpperCase();
    const easting = parseInt(match[3], 10);
    const northing = parseInt(match[4], 10);

    if (zone < 1 || zone > 60) return null;
    if (hemisphere !== 'N' && hemisphere !== 'S') return null;
    if (easting < 160000 || easting > 840000 || northing < 0) return null;

    try {
        const result = proj4(buildUtmProjection(zone, hemisphere), WGS84_PROJ, [easting, northing]);
        return { lng: result[0], lat: result[1] };
    } catch (error) {
        console.error('Error converting UTM to lat/lng:', error);
        return null;
    }
}

/**
 * Parses MGRS coordinates.
 * @param {string} input - e.g. "23KTP8083416602" or "23K TP 80834 16602"
 * @returns {{ lat: number, lng: number }|null}
 */
function parseMGRS(input) {
    try {
        const result = mgrs.toPoint(input.replace(/\s+/g, ''));
        return { lng: result[0], lat: result[1] };
    } catch {
        return null;
    }
}

// ============================================================================
// FORMAT-SPECIFIC FORMATTERS
// ============================================================================

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
function formatLatLong(lat, lng) {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/**
 * Formats lat/lng as DMS: `30º07'56.8" S 55º01'04.3" O`
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
function formatLatLongDMS(lat, lng) {
    const { latDir, lngDir } = getDirections(lat, lng);
    const latParts = toDMSParts(Math.abs(lat));
    const lngParts = toDMSParts(Math.abs(lng));

    return `${formatDMSString(latParts, latDir)} ${formatDMSString(lngParts, lngDir)}`;
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
function formatUTMWGS84(lat, lng) {
    try {
        const { zone, hemisphere, easting, northing } = toUtmCoords(lat, lng);
        return `${zone}${hemisphere} ${Math.round(easting)} ${Math.round(northing)}`;
    } catch (error) {
        console.error('Error converting to UTM WGS84:', error);
        return formatLatLong(lat, lng);
    }
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
function formatMGRS(lat, lng) {
    try {
        return formatMGRSWithSpaces(mgrs.forward([lng, lat], 5));
    } catch (error) {
        console.error('Error converting to MGRS:', error);
        return formatLatLong(lat, lng);
    }
}

// ============================================================================
// DISPLAY FORMAT BUILDERS
// ============================================================================

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {{ parts: Array<{ label: string, value: string }> }}
 */
function getDMSDisplayFormat(lat, lng) {
    const { latDir, lngDir } = getDirections(lat, lng);
    const latParts = toDMSParts(Math.abs(lat));
    const lngParts = toDMSParts(Math.abs(lng));

    return {
        parts: [
            { label: 'Lat', value: formatDMSString(latParts, latDir) },
            { label: 'Lon', value: formatDMSString(lngParts, lngDir) }
        ]
    };
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {{ parts: Array<{ label: string, value: string }> }}
 */
function getUTMWGS84DisplayFormat(lat, lng) {
    try {
        const { zone, hemisphere, easting, northing } = toUtmCoords(lat, lng);

        return {
            parts: [
                { label: 'Zona', value: `${zone}${hemisphere}` },
                { label: 'E', value: `${easting.toFixed(2)}m` },
                { label: 'N', value: `${northing.toFixed(2)}m` }
            ]
        };
    } catch {
        return createLatLongDisplayParts(lat, lng);
    }
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {{ parts: Array<{ label: string, value: string }> }}
 */
function getMGRSDisplayFormat(lat, lng) {
    try {
        return {
            parts: [
                { label: 'MGRS', value: formatMGRSWithSpaces(mgrs.forward([lng, lat], 5)) }
            ]
        };
    } catch {
        return createLatLongDisplayParts(lat, lng);
    }
}

/**
 * Inserts spaces into a raw 15-character MGRS string for readability.
 * @param {string} mgrsString - e.g. "23KTP8083416602"
 * @returns {string} e.g. "23K TP 80834 16602"
 */
function formatMGRSWithSpaces(mgrsString) {
    if (mgrsString.length !== 15) return mgrsString;

    const zone = mgrsString.substring(0, 3);
    const square = mgrsString.substring(3, 5);
    const easting = mgrsString.substring(5, 10);
    const northing = mgrsString.substring(10, 15);

    return `${zone} ${square} ${easting} ${northing}`;
}

// ============================================================================
// AUTO-DETECTION
// ============================================================================

// Detection regex patterns (compiled once at module level)
const DETECT_MGRS = /^\d{1,2}[A-Z]\s*[A-Z]{2}\s*\d+\s*\d*$/i;
const DETECT_UTM = /^\s*\d{1,2}\s*[NS]?\s+\d+\s+\d+\s*$/i;
const DETECT_DMS = /[º°'"\s]+[NSLOEW]/i;
const DETECT_DECIMAL = /^-?\d+\.?\d*\s*[,\s]\s*-?\d+\.?\d*$/;

/**
 * Tries to auto-detect the coordinate format and parse the input.
 * Tests formats in order of specificity: MGRS, UTM, DMS, Decimal.
 * @param {string} input - Input coordinate string
 * @returns {{ lat: number, lng: number, format: string, formatLabel: string }|null}
 */
export function tryParseCoordinates(input) {
    if (!input || typeof input !== 'string') return null;

    const trimmed = input.trim();
    if (trimmed.length < 3) return null;

    // 1. MGRS (most specific): zone + letter + 2 letters + numbers
    if (DETECT_MGRS.test(trimmed.replace(/\s+/g, ' '))) {
        const result = parseMGRS(trimmed);
        if (result) return { ...result, format: 'mgrs', formatLabel: 'MGRS' };
    }

    // 2. UTM: zone + optional hemisphere + easting + northing
    if (DETECT_UTM.test(trimmed)) {
        const result = parseUTMWGS84(trimmed);
        if (result) return { ...result, format: 'utm_wgs84', formatLabel: 'UTM' };
    }

    // 3. DMS: degree/minute/second symbols with direction letters
    if (DETECT_DMS.test(trimmed)) {
        const result = parseLatLongDMS(trimmed);
        if (result) return { ...result, format: 'latlong_dms', formatLabel: 'Lat/Long (GMS)' };
    }

    // 4. Decimal lat/lng (most generic)
    if (DETECT_DECIMAL.test(trimmed)) {
        const result = parseLatLong(trimmed);
        if (result) return { ...result, format: 'latlong', formatLabel: 'Lat/Long (Decimal)' };
    }

    return null;
}

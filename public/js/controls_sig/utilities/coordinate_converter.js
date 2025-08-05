// Path: js\controls_sig\utilities\coordinate_converter.js

/**
 * Utilitário centralizado para conversão entre diferentes formatos de coordenadas
 * Suporta Lat/Long, UTM e MGRS
 */

export const COORDINATE_FORMATS = [
    { id: 'latlong', label: 'Lat/Long (graus)' },
    { id: 'utm', label: 'UTM (metros)' },
    { id: 'mgrs', label: 'MGRS' }
];

/**
 * Obter placeholder para cada formato
 */
export function getPlaceholderForFormat(formatId) {
    switch (formatId) {
        case 'latlong':
            return '-22.455921, -44.449655';
        case 'utm':
            return '23K 680834 7516602';
        case 'mgrs':
            return '23K TP 80834 16602';
        default:
            return 'Entrar coordenadas';
    }
}

/**
 * Converte coordenadas de string para objeto {lat, lng}
 */
export function parseCoordinates(input, formatId) {
    try {
        switch (formatId) {
            case 'latlong':
                return parseLatLong(input);
            case 'utm':
                return parseUTM(input);
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
 * Converte coordenadas {lat, lng} para string no formato especificado
 */
export function formatCoordinates(lat, lng, formatId) {
    try {
        switch (formatId) {
            case 'latlong':
                return formatLatLong(lat, lng);
            case 'utm':
                return formatUTM(lat, lng);
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
 * Obter formato para exibição (separado da conversão para cópia)
 */
export function getDisplayFormat(lat, lng, formatId) {
    try {
        switch (formatId) {
            case 'latlong':
                return {
                    parts: [
                        { label: 'Lat', value: `${lat.toFixed(5)}°` },
                        { label: 'Lon', value: `${lng.toFixed(5)}°` }
                    ]
                };
            case 'utm':
                return getUTMDisplayFormat(lat, lng);
            case 'mgrs':
                return getMGRSDisplayFormat(lat, lng);
            default:
                return {
                    parts: [
                        { label: 'Lat', value: `${lat.toFixed(5)}°` },
                        { label: 'Lon', value: `${lng.toFixed(5)}°` }
                    ]
                };
        }
    } catch (error) {
        console.error('Error getting display format:', error);
        return {
            parts: [
                { label: 'Lat', value: `${lat.toFixed(5)}°` },
                { label: 'Lon', value: `${lng.toFixed(5)}°` }
            ]
        };
    }
}

/**
 * Parse Lat/Long em vários formatos
 */
function parseLatLong(input) {
    const patterns = [
        /^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/,  // lat, lng
        /^\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*$/,      // lat lng
        /^\s*(-?\d+\.?\d*),(-?\d+\.?\d*)\s*$/         // lat,lng
    ];
    
    for (const pattern of patterns) {
        const match = input.match(pattern);
        if (match) {
            const lat = parseFloat(match[1]);
            const lng = parseFloat(match[2]);
            
            if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                return { lat, lng };
            }
        }
    }
    
    return null;
}

/**
 * Parse UTM
 */
function parseUTM(input) {
    if (typeof proj4 === 'undefined') {
        console.warn('UTM conversion requires proj4 library');
        return null;
    }
    
    const utmPattern = /^\s*(\d{1,2})([NS])?\s+(\d+)\s+(\d+)\s*$/i;
    const match = input.match(utmPattern);
    
    if (match) {
        const zone = parseInt(match[1], 10);
        const hemisphere = (match[2] || 'S').toUpperCase();
        const easting = parseInt(match[3], 10);
        const northing = parseInt(match[4], 10);
        
        if (zone >= 1 && zone <= 60 && 
            (hemisphere === 'N' || hemisphere === 'S') &&
            easting >= 160000 && easting <= 840000 &&
            northing >= 0) {
            
            const utmProjection = `+proj=utm +zone=${zone} ${hemisphere === 'S' ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
            const wgs84 = '+proj=longlat +datum=WGS84 +no_defs';
            
            const result = proj4(utmProjection, wgs84, [easting, northing]);
            return { lng: result[0], lat: result[1] };
        }
    }
    
    return null;
}

/**
 * Parse MGRS
 */
function parseMGRS(input) {
    if (typeof mgrs === 'undefined') {
        console.warn('MGRS conversion requires mgrs library');
        return null;
    }
    
    const mgrsString = input.replace(/\s+/g, '');
    
    try {
        const result = mgrs.toPoint(mgrsString);
        return { lng: result[0], lat: result[1] };
    } catch (e) {
        return null;
    }
}

/**
 * Format Lat/Long
 */
function formatLatLong(lat, lng) {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/**
 * Format UTM
 */
function formatUTM(lat, lng) {
    if (typeof proj4 === 'undefined') {
        return formatLatLong(lat, lng);
    }
    
    try {
        const zone = Math.floor((lng + 180) / 6) + 1;
        const hemisphere = lat >= 0 ? 'N' : 'S';
        
        const utmProjection = `+proj=utm +zone=${zone} ${hemisphere === 'S' ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
        const wgs84 = '+proj=longlat +datum=WGS84 +no_defs';
        const utmCoords = proj4(wgs84, utmProjection, [lng, lat]);
        
        return `${zone}${hemisphere} ${Math.round(utmCoords[0])} ${Math.round(utmCoords[1])}`;
    } catch (error) {
        console.error('Error converting to UTM:', error);
        return formatLatLong(lat, lng);
    }
}

/**
 * Format MGRS
 */
function formatMGRS(lat, lng) {
    if (typeof mgrs === 'undefined') {
        return formatLatLong(lat, lng);
    }
    
    try {
        const mgrsString = mgrs.forward([lng, lat], 5);
        return formatMGRSString(mgrsString);
    } catch (error) {
        console.error('Error converting to MGRS:', error);
        return formatLatLong(lat, lng);
    }
}

/**
 * Get UTM display format
 */
function getUTMDisplayFormat(lat, lng) {
    if (typeof proj4 === 'undefined') {
        return {
            parts: [
                { label: 'Lat', value: `${lat.toFixed(5)}°` },
                { label: 'Lon', value: `${lng.toFixed(5)}°` }
            ]
        };
    }
    
    try {
        const zone = Math.floor((lng + 180) / 6) + 1;
        const hemisphere = lat >= 0 ? 'N' : 'S';
        
        const utmProjection = `+proj=utm +zone=${zone} ${hemisphere === 'S' ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
        const wgs84 = '+proj=longlat +datum=WGS84 +no_defs';
        const utmCoords = proj4(wgs84, utmProjection, [lng, lat]);
        
        return {
            parts: [
                { label: 'Zona', value: `${zone}${hemisphere}` },
                { label: 'E', value: `${Math.round(utmCoords[0])}m` },
                { label: 'N', value: `${Math.round(utmCoords[1])}m` }
            ]
        };
    } catch (error) {
        return {
            parts: [
                { label: 'Lat', value: `${lat.toFixed(5)}°` },
                { label: 'Lon', value: `${lng.toFixed(5)}°` }
            ]
        };
    }
}

/**
 * Get MGRS display format
 */
function getMGRSDisplayFormat(lat, lng) {
    if (typeof mgrs === 'undefined') {
        return {
            parts: [
                { label: 'Lat', value: `${lat.toFixed(5)}°` },
                { label: 'Lon', value: `${lng.toFixed(5)}°` }
            ]
        };
    }
    
    try {
        const mgrsString = mgrs.forward([lng, lat], 5);
        const formattedMGRS = formatMGRSString(mgrsString);
        
        return {
            parts: [
                { label: 'MGRS', value: formattedMGRS }
            ]
        };
    } catch (error) {
        return {
            parts: [
                { label: 'Lat', value: `${lat.toFixed(5)}°` },
                { label: 'Lon', value: `${lng.toFixed(5)}°` }
            ]
        };
    }
}

/**
 * Format MGRS string with proper spacing
 */
function formatMGRSString(mgrsString) {
    if (mgrsString.length !== 15) {
        return mgrsString;
    }
    
    const zone = mgrsString.substring(0, 3);        // "23K"
    const square = mgrsString.substring(3, 5);      // "TP"
    const easting = mgrsString.substring(5, 10);    // "80834"
    const northing = mgrsString.substring(10, 15);  // "16602"
    
    return `${zone} ${square} ${easting} ${northing}`;
}
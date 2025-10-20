// Path: js\controls_sig\utilities\coordinate_converter.js

/**
 * Utilitário centralizado para conversão entre diferentes formatos de coordenadas
 * Suporta Lat/Long (Decimal e GMS), UTM WGS84 e MGRS
 */

export const COORDINATE_FORMATS = [
    { id: 'latlong', label: 'Lat/Long (Decimal)' },
    { id: 'latlong_dms', label: 'Lat/Long (GMS)' },
    { id: 'utm_wgs84', label: 'UTM' },
    { id: 'mgrs', label: 'MGRS' }
];

/**
 * Obter placeholder para cada formato
 */
export function getPlaceholderForFormat(formatId) {
    switch (formatId) {
        case 'latlong':
            return '-22.455921, -44.449655';
        case 'latlong_dms':
            return '30º07\'56.8" S 55º01\'04.3" O';
        case 'utm_wgs84':
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
 * Converte coordenadas {lat, lng} para string no formato especificado
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
            case 'latlong_dms':
                return getDMSDisplayFormat(lat, lng);
            case 'utm_wgs84':
                return getUTMWGS84DisplayFormat(lat, lng);
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
 * Parse Lat/Long GMS (Grau, Minuto, Segundo)
 * Aceita múltiplos formatos:
 * - 30º07'56.8" S 55º01'04.3" O
 * - 30°07'56.8" S 55°01'04.3" O
 * - 30 07 56.8 S 55 01 04.3 O
 * - 30º07'56" S 55º01'04" O (sem decimais)
 * - 30º07' S 55º01' O (sem segundos)
 */
function parseLatLongDMS(input) {
    // Remove espaços extras e normaliza
    const normalized = input.trim();
    
    // Padrão para capturar GMS completo com segundos decimais
    // Aceita º ou ° para graus, ' para minutos, " para segundos
    // Aceita direções: N/S para latitude, L/O/E/W para longitude
    const dmsPattern = /(\d+)[º°]\s*(\d+)['′]\s*(\d+(?:\.\d+)?)[\"″]?\s*([NS])\s+(\d+)[º°]\s*(\d+)['′]\s*(\d+(?:\.\d+)?)[\"″]?\s*([LOEW])/i;
    
    // Padrão sem segundos (apenas graus e minutos)
    const dmPattern = /(\d+)[º°]\s*(\d+)['′]\s*([NS])\s+(\d+)[º°]\s*(\d+)['′]\s*([LOEW])/i;
    
    // Padrão mais flexível com espaços
    const flexiblePattern = /(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s*([NS])\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s*([LOEW])/i;

    let match = normalized.match(dmsPattern);
    let hasSeconds = true;

    if (!match) {
        match = normalized.match(dmPattern);
        hasSeconds = false;
    }

    if (!match) {
        match = normalized.match(flexiblePattern);
        hasSeconds = true;
    }

    if (match) {
        try {
            let lat, lng;

            if (hasSeconds) {
                // Com segundos
                const latDeg = parseInt(match[1], 10);
                const latMin = parseInt(match[2], 10);
                const latSec = parseFloat(match[3]);
                const latDir = match[4].toUpperCase();

                const lngDeg = parseInt(match[5], 10);
                const lngMin = parseInt(match[6], 10);
                const lngSec = parseFloat(match[7]);
                const lngDir = match[8].toUpperCase();

                // Converter para decimal
                lat = latDeg + (latMin / 60) + (latSec / 3600);
                lng = lngDeg + (lngMin / 60) + (lngSec / 3600);

                // Aplicar sinal baseado na direção
                if (latDir === 'S') lat = -lat;
                if (lngDir === 'O' || lngDir === 'W') lng = -lng;
            } else {
                // Sem segundos
                const latDeg = parseInt(match[1], 10);
                const latMin = parseInt(match[2], 10);
                const latDir = match[3].toUpperCase();

                const lngDeg = parseInt(match[4], 10);
                const lngMin = parseInt(match[5], 10);
                const lngDir = match[6].toUpperCase();

                // Converter para decimal
                lat = latDeg + (latMin / 60);
                lng = lngDeg + (lngMin / 60);

                // Aplicar sinal baseado na direção
                if (latDir === 'S') lat = -lat;
                if (lngDir === 'O' || lngDir === 'W') lng = -lng;
            }

            // Validar ranges
            if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                return { lat, lng };
            }
        } catch (e) {
            console.error('Error parsing GMS:', e);
            return null;
        }
    }

    return null;
}

/**
 * Parse UTM WGS84
 */
function parseUTMWGS84(input) {
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
 * Format Lat/Long GMS
 * Formato: 30º07'56.8" S 55º01'04.3" O
 */
function formatLatLongDMS(lat, lng) {
    // Determinar direções
    const latDir = lat >= 0 ? 'N' : 'S';
    const lngDir = lng >= 0 ? 'L' : 'O';

    // Trabalhar com valores absolutos
    const absLat = Math.abs(lat);
    const absLng = Math.abs(lng);

    // Converter latitude
    const latDeg = Math.floor(absLat);
    const latMinDecimal = (absLat - latDeg) * 60;
    const latMin = Math.floor(latMinDecimal);
    const latSec = (latMinDecimal - latMin) * 60;

    // Converter longitude
    const lngDeg = Math.floor(absLng);
    const lngMinDecimal = (absLng - lngDeg) * 60;
    const lngMin = Math.floor(lngMinDecimal);
    const lngSec = (lngMinDecimal - lngMin) * 60;

    // Formatar com 1 casa decimal nos segundos
    const latStr = `${latDeg}º${latMin.toString().padStart(2, '0')}'${latSec.toFixed(1).padStart(4, '0')}" ${latDir}`;
    const lngStr = `${lngDeg}º${lngMin.toString().padStart(2, '0')}'${lngSec.toFixed(1).padStart(4, '0')}" ${lngDir}`;

    return `${latStr} ${lngStr}`;
}

/**
 * Format UTM WGS84
 */
function formatUTMWGS84(lat, lng) {
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
        console.error('Error converting to UTM WGS84:', error);
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
 * Get GMS display format
 */
function getDMSDisplayFormat(lat, lng) {
    // Determinar direções
    const latDir = lat >= 0 ? 'N' : 'S';
    const lngDir = lng >= 0 ? 'L' : 'O';

    // Trabalhar com valores absolutos
    const absLat = Math.abs(lat);
    const absLng = Math.abs(lng);

    // Converter latitude
    const latDeg = Math.floor(absLat);
    const latMinDecimal = (absLat - latDeg) * 60;
    const latMin = Math.floor(latMinDecimal);
    const latSec = (latMinDecimal - latMin) * 60;

    // Converter longitude
    const lngDeg = Math.floor(absLng);
    const lngMinDecimal = (absLng - lngDeg) * 60;
    const lngMin = Math.floor(lngMinDecimal);
    const lngSec = (lngMinDecimal - lngMin) * 60;

    // Formatar com 1 casa decimal nos segundos
    const latStr = `${latDeg}º${latMin.toString().padStart(2, '0')}'${latSec.toFixed(1).padStart(4, '0')}" ${latDir}`;
    const lngStr = `${lngDeg}º${lngMin.toString().padStart(2, '0')}'${lngSec.toFixed(1).padStart(4, '0')}" ${lngDir}`;

    return {
        parts: [
            { label: 'Lat', value: latStr },
            { label: 'Lon', value: lngStr }
        ]
    };
}

/**
 * Get UTM WGS84 display format
 */
function getUTMWGS84DisplayFormat(lat, lng) {
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
                { label: 'E', value: `${utmCoords[0].toFixed(2)}m` },
                { label: 'N', value: `${utmCoords[1].toFixed(2)}m` }
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
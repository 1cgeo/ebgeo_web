// Path: js/military_tools/azimuth_distance_tool/azimuth_distance_constants.js

/**
 * @fileoverview Constants and configuration for the Azimuth and Distance tool.
 * Implements military navigation standards (NATO 6400-mil system).
 *
 * @module military_tools/azimuth_distance_tool/azimuth_distance_constants
 */

// ============================================================================
// ANGULAR CONVERSION CONSTANTS
// ============================================================================

/** Brazilian military uses NATO 6400-mil system */
export const MILS_PER_CIRCLE = 6400;
export const DEGREES_PER_CIRCLE = 360;

/** Conversion factors */
export const MIL_TO_DEG = DEGREES_PER_CIRCLE / MILS_PER_CIRCLE; // ~0.05625
export const DEG_TO_MIL = MILS_PER_CIRCLE / DEGREES_PER_CIRCLE; // ~17.7778

// ============================================================================
// UNIT ENUMS
// ============================================================================

/**
 * Angular unit options
 * @enum {string}
 */
export const ANGULAR_UNIT = {
    DEGREES: 'degrees',
    MILS: 'mils'
};

/**
 * Distance unit options
 * @enum {string}
 */
export const DISTANCE_UNIT = {
    METERS: 'meters',
    KILOMETERS: 'kilometers'
};

/**
 * North reference options
 * - MAGNETIC: What the compass reads (requires declination correction)
 * - TRUE: Geographic north (what the map uses)
 * @enum {string}
 */
export const NORTH_REFERENCE = {
    MAGNETIC: 'magnetic',
    TRUE: 'true'
};

/**
 * Output geometry mode options
 * @enum {string}
 */
export const OUTPUT_MODE = {
    POINT: 'point',
    ROUTE: 'route',
    AREA: 'area'
};

// ============================================================================
// OUTPUT MODE METADATA
// ============================================================================

/**
 * Display information for output modes
 * @type {Object<string, {id: string, label: string, description: string, icon: string}>}
 */
export const OUTPUT_MODE_INFO = {
    [OUTPUT_MODE.POINT]: {
        id: OUTPUT_MODE.POINT,
        label: 'Ponto',
        description: 'Observação, alvo, referência',
        icon: 'point'
    },
    [OUTPUT_MODE.ROUTE]: {
        id: OUTPUT_MODE.ROUTE,
        label: 'Rota',
        description: 'Itinerário, patrulha, marcha',
        icon: 'route'
    },
    [OUTPUT_MODE.AREA]: {
        id: OUTPUT_MODE.AREA,
        label: 'Área',
        description: 'Setor, zona, perímetro',
        icon: 'area'
    }
};

// ============================================================================
// COMPASS PRESETS
// ============================================================================

/**
 * Cardinal and intercardinal directions for quick azimuth selection
 * @type {Array<{label: string, deg: number}>}
 */
export const COMPASS_PRESETS = [
    { label: 'N', deg: 0 },
    { label: 'NE', deg: 45 },
    { label: 'E', deg: 90 },
    { label: 'SE', deg: 135 },
    { label: 'S', deg: 180 },
    { label: 'SO', deg: 225 },
    { label: 'O', deg: 270 },
    { label: 'NO', deg: 315 }
];

// ============================================================================
// DEFAULT PROPERTIES
// ============================================================================

/**
 * Default properties for new azimuth/distance features
 * @type {Object}
 */
export const DEFAULT_PROPERTIES = {
    // Feature identification
    featureType: 'azimuth_distance',
    source: 'lines', // Will be updated based on outputMode
    geometryType: 'route',
    nome: '',
    descricao: '',
    visivel: true,
    bloqueado: false,

    // Polar construction data
    referencePoint: null, // [lng, lat]
    outputMode: OUTPUT_MODE.ROUTE,
    angularUnit: ANGULAR_UNIT.DEGREES,
    distanceUnit: DISTANCE_UNIT.METERS,
    northReference: NORTH_REFERENCE.MAGNETIC,
    magneticDeclination: 0, // In degrees, negative = West

    // Legs array (each leg: { azimuth, distance, observation })
    legs: [],

    // Style
    strokeColor: '#16a34a',
    strokeWidth: 2,
    strokeOpacity: 1,
    fillColor: '#16a34a',
    fillOpacity: 0.15
};

// ============================================================================
// VALIDATION CONSTANTS
// ============================================================================

/**
 * Validation limits
 */
export const VALIDATION = {
    MIN_AZIMUTH_DEG: 0,
    MAX_AZIMUTH_DEG: 360,
    MIN_AZIMUTH_MIL: 0,
    MAX_AZIMUTH_MIL: 6400,
    MIN_DISTANCE: 0,
    MAX_DISTANCE_M: 1000000, // 1000 km
    MAX_DECLINATION_DEG: 45,
    MIN_DECLINATION_DEG: -45,
    MAX_OBSERVATION_LENGTH: 12,
    MIN_LEGS_FOR_AREA: 3
};

// ============================================================================
// UI CONFIGURATION
// ============================================================================

/**
 * UI sizing and layout constants
 */
export const UI_CONFIG = {
    COMPASS_SIZE: 156,
    PREVIEW_WIDTH: 210,
    PREVIEW_HEIGHT: 210,
    PREVIEW_PADDING: 24,
    LEG_ROW_HEIGHT: 40,
    MAX_VISIBLE_LEGS: 5 // Before scrolling
};

// ============================================================================
// DESIGN TOKENS (matching EBGeo design system)
// ============================================================================

/**
 * Color tokens for the azimuth/distance panel
 * These match the EBGeo design tokens from design-tokens.css
 */
export const COLORS = {
    primary700: '#15803d',
    primary600: '#16a34a',
    primary100: '#dcfce7',
    primary50: '#f0fdf4',
    gray900: '#111827',
    gray700: '#374151',
    gray600: '#4b5563',
    gray500: '#6b7280',
    gray400: '#9ca3af',
    gray300: '#d1d5db',
    gray200: '#e5e7eb',
    gray100: '#f3f4f6',
    gray50: '#f9fafb',
    red600: '#dc2626',
    red100: '#fee2e2',
    red50: '#fef2f2',
    amber600: '#d97706',
    amber500: '#f59e0b',
    amber100: '#fef3c7',
    amber50: '#fffbeb',
    blue500: '#3b82f6',
    white: '#ffffff'
};

// ============================================================================
// SOURCE MAPPING
// ============================================================================

/**
 * Maps output mode to the appropriate MapLibre source
 * @type {Object<string, string>}
 */
export const MODE_TO_SOURCE = {
    [OUTPUT_MODE.POINT]: 'points',
    [OUTPUT_MODE.ROUTE]: 'lines',
    [OUTPUT_MODE.AREA]: 'polygons'
};

/**
 * Maps output mode to GeoJSON geometry type
 * @type {Object<string, string>}
 */
export const MODE_TO_GEOMETRY_TYPE = {
    [OUTPUT_MODE.POINT]: 'Point',
    [OUTPUT_MODE.ROUTE]: 'LineString',
    [OUTPUT_MODE.AREA]: 'Polygon'
};

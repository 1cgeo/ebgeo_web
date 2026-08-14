// Path: js/store/store.constants.js

/**
 * @fileoverview Store constants and feature type mappings.
 */

/** @constant {string} */
export const DEFAULT_MAP_NAME = 'Principal';

/**
 * Canonical list of all feature source types.
 * Order: drawing tools, military tools, analysis tools.
 * All lookup maps below follow this same order.
 * @constant {string[]}
 */
const SOURCE_TYPES = Object.freeze([
    'point', 'line', 'polygon', 'circle', 'ellipse', 'rectangle', 'sector',
    'text', 'image', 'brush',
    'arrow', 'boundary', 'occupied_front', 'military_symbol', 'coordination_measure',
    'los', 'visibility',
    'magnetic_declination',
]);

/**
 * Mapping of feature source types to their icon paths.
 * @constant {Object<string, string>}
 */
export const FEATURE_TYPE_ICONS = Object.freeze({
    point: './images/icon_point_black.svg',
    line: './images/icon_line_black.svg',
    polygon: './images/icon_polygon_black.svg',
    circle: './images/icon_circle_black.svg',
    ellipse: './images/icon_ellipse_black.svg',
    rectangle: './images/icon_rectangle_black.svg',
    sector: './images/icon_sector_black.svg',
    text: './images/icon_text_black.svg',
    image: './images/icon_photo_black.svg',
    brush: './images/icon_brush_black.svg',
    arrow: './images/icon_arrow_black.svg',
    boundary: './images/icon_boundary_black.svg',
    occupied_front: './images/icon_occupied_front_black.svg',
    military_symbol: './images/icon_military_black.svg',
    coordination_measure: './images/icon_coordination_black.svg',
    los: './images/icon_los_black.svg',
    visibility: './images/icon_visibility_black.svg',
    magnetic_declination: './images/icon_declination_black.svg',
});

/**
 * Mapping of source types (singular) to storage types (plural).
 * @constant {Object<string, string>}
 */
export const FEATURE_TYPE_MAPPINGS = Object.freeze({
    point: 'points',
    line: 'lines',
    polygon: 'polygons',
    circle: 'circles',
    ellipse: 'ellipses',
    rectangle: 'rectangles',
    sector: 'setores',
    text: 'texts',
    image: 'images',
    brush: 'brushes',
    arrow: 'arrows',
    boundary: 'boundarys',
    occupied_front: 'occupied_fronts',
    military_symbol: 'military_symbols',
    coordination_measure: 'coordination_measures',
    los: 'los',
    visibility: 'visibility',
    // Processing OUTPUT types: their store buckets are the source name verbatim (NOT
    // `source + 's'`). Without these, getStorageTypeFromSource fell back to
    // 'processed_loss'/'processed_visibilitys', so a synced processing result landed in
    // a phantom bucket on the receiving peer and never rendered.
    processed_los: 'processed_los',
    processed_visibility: 'processed_visibility',
    magnetic_declination: 'magnetic_declinations',
});

/**
 * Display names for feature types (in Portuguese).
 * @constant {Object<string, string>}
 */
export const FEATURE_DISPLAY_NAMES = Object.freeze({
    point: 'Ponto',
    line: 'Linha',
    polygon: 'Polígono',
    circle: 'Círculo',
    ellipse: 'Elipse',
    rectangle: 'Retângulo',
    sector: 'Setor',
    text: 'Texto',
    image: 'Imagem',
    brush: 'Pincel',
    arrow: 'Seta',
    boundary: 'Limite',
    occupied_front: 'Frente Ocupada',
    military_symbol: 'Símbolo Militar',
    coordination_measure: 'Medida de Coordenação',
    los: 'Linha de Visada',
    visibility: 'Visibilidade',
    magnetic_declination: 'Declinação Magnética',
});

/** @constant {string[]} */
export const UNCOPYABLE_FEATURE_TYPES = Object.freeze(['los', 'visibility']);

/** @constant {string[]} */
export const IMAGE_RESOURCE_FEATURE_TYPES = Object.freeze(['image', 'military_symbol', 'coordination_measure', 'magnetic_declination']);

// Pre-built reverse lookup: storage type -> source type
const STORAGE_TO_SOURCE = Object.freeze(
    Object.fromEntries(
        Object.entries(FEATURE_TYPE_MAPPINGS).map(([src, storage]) => [storage, src])
    )
);

const ALL_STORAGE_TYPES = Object.freeze(Object.values(FEATURE_TYPE_MAPPINGS));

// ===== UTILITY FUNCTIONS =====

/**
 * Gets the storage type (plural) for a feature source type.
 * @param {string} sourceType - e.g. 'point'
 * @returns {string} e.g. 'points'
 */
export function getStorageTypeFromSource(sourceType) {
    return FEATURE_TYPE_MAPPINGS[sourceType] || `${sourceType}s`;
}

/**
 * Gets the source type (singular) from a storage type.
 * @param {string} storageType - e.g. 'points'
 * @returns {string} e.g. 'point'
 */
export function getSourceTypeFromStorage(storageType) {
    return STORAGE_TO_SOURCE[storageType]
        || (storageType.endsWith('s') ? storageType.slice(0, -1) : storageType);
}

/** @param {string} sourceType @returns {string|undefined} */
export function getFeatureIcon(sourceType) {
    return FEATURE_TYPE_ICONS[sourceType];
}

/** @param {string} sourceType @returns {string} */
export function getFeatureDisplayName(sourceType) {
    return FEATURE_DISPLAY_NAMES[sourceType] || 'Feição';
}

/** @param {string} storageType @returns {string} */
export function getFeatureDisplayNameFromStorage(storageType) {
    return getFeatureDisplayName(getSourceTypeFromStorage(storageType));
}

/** @param {string} storageType @returns {string|undefined} */
export function getFeatureIconFromStorage(storageType) {
    return getFeatureIcon(getSourceTypeFromStorage(storageType));
}

/** @returns {string[]} */
export function getAllStorageTypes() {
    return ALL_STORAGE_TYPES;
}

/** @param {string} sourceType @returns {boolean} */
export function isUncopyableFeatureType(sourceType) {
    return UNCOPYABLE_FEATURE_TYPES.includes(sourceType);
}

/** @param {string} sourceType @returns {boolean} */
export function hasImageResource(sourceType) {
    return IMAGE_RESOURCE_FEATURE_TYPES.includes(sourceType);
}

/** @returns {Object} Selection control configuration for all feature types. */
export function getSelectionControlConfig() {
    const config = {};
    for (const sourceType of SOURCE_TYPES) {
        config[sourceType] = {
            sourceNames: [getStorageTypeFromSource(sourceType)]
        };
    }
    return config;
}

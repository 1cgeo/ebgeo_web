// Path: js/features_tab/features_tab.constants.js

/**
 * @fileoverview Constants for FeaturesTab module.
 */

/**
 * List of map feature source IDs.
 * @type {string[]}
 */
export const FEATURE_SOURCES = [
    'points',
    'lines',
    'polygons',
    'texts',
    'images',
    'circles',
    'rectangles',
    'ellipses',
    'brushes',
    'arrows',
    'boundarys',
    'occupied_fronts',
    'military_symbols',
    'coordination_measures',
    'los',
    'visibility',
];

/**
 * Debounce delay for refresh operations in milliseconds.
 * @type {number}
 */
export const REFRESH_DEBOUNCE_MS = 150;

/**
 * Display names for feature types (Portuguese).
 * @type {Object<string, string>}
 */
export const FEATURE_DISPLAY_NAMES = {
    points: 'Ponto',
    lines: 'Linha',
    polygons: 'Polígono',
    texts: 'Texto',
    images: 'Imagem',
    circles: 'Círculo',
    rectangles: 'Retângulo',
    ellipses: 'Elipse',
    brushes: 'Pincel',
    arrows: 'Seta',
    boundarys: 'Fronteira',
    occupied_fronts: 'Frente Ocupada',
    military_symbols: 'Símbolo Militar',
    coordination_measures: 'Medida de Coordenação',
    los: 'Linha de Visada',
    visibility: 'Visibilidade',
};

/**
 * Gets display name for a storage type.
 * @param {string} storageType - Storage type
 * @returns {string} Display name
 */
export function getFeatureDisplayName(storageType) {
    return FEATURE_DISPLAY_NAMES[storageType] || storageType;
}

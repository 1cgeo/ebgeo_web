// Path: js/store/store.constants.js

/**
 * @fileoverview Store constants and feature type mappings.
 */

/**
 * Mapping of feature source types to their icon paths.
 * @constant {Object<string, string>}
 */
export const FEATURE_TYPE_ICONS = {
    'point': './images/icon_point_black.svg',
    'line': './images/icon_line_black.svg',
    'polygon': './images/icon_polygon_black.svg',
    'text': './images/icon_text_black.svg',
    'image': './images/icon_photo_black.svg',
    'circle': './images/icon_circle_black.svg',
    'rectangle': './images/icon_rectangle_black.svg',
    'ellipse': './images/icon_ellipse_black.svg',
    'brush': './images/icon_brush_black.svg',
    'arrow': './images/icon_arrow_black.svg',
    'boundary': './images/icon_boundary_black.svg',
    'occupied_front': './images/icon_occupied_front_black.svg',
    'military_symbol': './images/icon_military_black.svg',
    'coordination_measure': './images/icon_coordination_black.svg',
    'los': './images/icon_los_black.svg',
    'visibility': './images/icon_visibility_black.svg'
};

/**
 * Mapping of feature source types to their MapLibre layer IDs.
 * @constant {Object<string, string>}
 */
export const FEATURE_TYPE_LAYERS = {
    'point': 'points-layer',
    'line': 'lines-layer',
    'polygon': 'polygons-layer',
    'text': 'texts-layer',
    'image': 'images-layer',
    'circle': 'circles-layer',
    'rectangle': 'rectangles-layer',
    'ellipse': 'ellipses-layer',
    'brush': 'brushes-layer',
    'arrow': 'arrows-layer',
    'boundary': 'boundarys-layer',
    'occupied_front': 'occupied-fronts-layer',
    'military_symbol': 'military-symbols-layer',
    'coordination_measure': 'coordination-measures-layer',
    'los': 'los-layer',
    'visibility': 'visibility-layer'
};

/**
 * Mapping of source types (singular) to storage types (plural).
 * @constant {Object<string, string>}
 */
export const FEATURE_TYPE_MAPPINGS = {
    'point': 'points',
    'line': 'lines',
    'polygon': 'polygons',
    'text': 'texts',
    'image': 'images',
    'circle': 'circles',
    'rectangle': 'rectangles',
    'ellipse': 'ellipses',
    'brush': 'brushes',
    'arrow': 'arrows',
    'boundary': 'boundarys',
    'occupied_front': 'occupied_fronts',
    'military_symbol': 'military_symbols',
    'coordination_measure': 'coordination_measures',
    'los': 'los',
    'visibility': 'visibility'
};

/**
 * Display names for feature types (in Portuguese).
 * @constant {Object<string, string>}
 */
export const FEATURE_DISPLAY_NAMES = {
    'point': 'Ponto',
    'line': 'Linha',
    'polygon': 'Polígono',
    'text': 'Texto',
    'image': 'Imagem',
    'circle': 'Círculo',
    'rectangle': 'Retângulo',
    'ellipse': 'Elipse',
    'brush': 'Pincel',
    'arrow': 'Seta',
    'boundary': 'Limite',
    'occupied_front': 'Frente Ocupada',
    'military_symbol': 'Símbolo Militar',
    'coordination_measure': 'Medida de Coordenação',
    'los': 'Linha de Visada',
    'visibility': 'Visibilidade'
};

/**
 * Feature types that cannot be copied.
 * @constant {string[]}
 */
export const UNCOPYABLE_FEATURE_TYPES = ['los', 'visibility'];

/**
 * Feature types that have associated image resources.
 * @constant {string[]}
 */
export const IMAGE_RESOURCE_FEATURE_TYPES = ['image', 'military_symbol', 'coordination_measure'];

// ===== UTILITY FUNCTIONS =====

/**
 * Gets the storage type (plural) for a feature source type.
 *
 * @param {string} sourceType - Feature source type (e.g., 'point')
 * @returns {string} Storage type (e.g., 'points')
 */
export const getStorageTypeFromSource = (sourceType) => {
    return FEATURE_TYPE_MAPPINGS[sourceType] || `${sourceType}s`;
};

/**
 * Gets the source type (singular) from a storage type.
 *
 * @param {string} storageType - Storage type (e.g., 'points')
 * @returns {string} Source type (e.g., 'point')
 */
export const getSourceTypeFromStorage = (storageType) => {
    for (const [sourceType, storage] of Object.entries(FEATURE_TYPE_MAPPINGS)) {
        if (storage === storageType) {
            return sourceType;
        }
    }
    return storageType.endsWith('s') ? storageType.slice(0, -1) : storageType;
};

/**
 * Gets the icon path for a feature source type.
 *
 * @param {string} sourceType - Feature source type
 * @returns {string|undefined} Icon path
 */
export const getFeatureIcon = (sourceType) => {
    return FEATURE_TYPE_ICONS[sourceType];
};

/**
 * Gets the MapLibre layer ID for a feature source type.
 *
 * @param {string} sourceType - Feature source type
 * @returns {string} Layer ID
 */
export const getFeatureLayer = (sourceType) => {
    return FEATURE_TYPE_LAYERS[sourceType] || `${sourceType}-layer`;
};

/**
 * Gets the display name for a feature source type.
 *
 * @param {string} sourceType - Feature source type
 * @returns {string} Display name
 */
export const getFeatureDisplayName = (sourceType) => {
    return FEATURE_DISPLAY_NAMES[sourceType] || 'Feição';
};

/**
 * Gets the display name from a storage type.
 *
 * @param {string} storageType - Storage type
 * @returns {string} Display name
 */
export const getFeatureDisplayNameFromStorage = (storageType) => {
    const sourceType = getSourceTypeFromStorage(storageType);
    return getFeatureDisplayName(sourceType);
};

/**
 * Gets the icon path from a storage type.
 *
 * @param {string} storageType - Storage type
 * @returns {string|undefined} Icon path
 */
export const getFeatureIconFromStorage = (storageType) => {
    const sourceType = getSourceTypeFromStorage(storageType);
    return getFeatureIcon(sourceType);
};

/**
 * Gets all source types.
 *
 * @returns {string[]} Array of all source types
 */
export const getAllSourceTypes = () => {
    return Object.keys(FEATURE_TYPE_MAPPINGS);
};

/**
 * Gets all storage types.
 *
 * @returns {string[]} Array of all storage types
 */
export const getAllStorageTypes = () => {
    return Object.values(FEATURE_TYPE_MAPPINGS);
};

/**
 * Checks if a source type is valid.
 *
 * @param {string} sourceType - Source type to check
 * @returns {boolean} True if valid
 */
export const isValidSourceType = (sourceType) => {
    return sourceType in FEATURE_TYPE_MAPPINGS;
};

/**
 * Checks if a storage type is valid.
 *
 * @param {string} storageType - Storage type to check
 * @returns {boolean} True if valid
 */
export const isValidStorageType = (storageType) => {
    return Object.values(FEATURE_TYPE_MAPPINGS).includes(storageType);
};

/**
 * Checks if a feature type cannot be copied.
 *
 * @param {string} sourceType - Feature source type
 * @returns {boolean} True if uncopyable
 */
export const isUncopyableFeatureType = (sourceType) => {
    return UNCOPYABLE_FEATURE_TYPES.includes(sourceType);
};

/**
 * Checks if a feature type has associated image resources.
 *
 * @param {string} sourceType - Feature source type
 * @returns {boolean} True if has image resources
 */
export const hasImageResource = (sourceType) => {
    return IMAGE_RESOURCE_FEATURE_TYPES.includes(sourceType);
};

/**
 * Gets selection control configuration for all feature types.
 *
 * @returns {Object} Configuration object
 */
export const getSelectionControlConfig = () => {
    const config = {};
    for (const sourceType of getAllSourceTypes()) {
        const storageType = getStorageTypeFromSource(sourceType);
        config[sourceType] = {
            sourceNames: [storageType]
        };
    }
    return config;
};

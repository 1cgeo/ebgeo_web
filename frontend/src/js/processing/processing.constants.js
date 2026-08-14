// Path: js/processing/processing.constants.js

/**
 * @fileoverview Registry for processing algorithms and shared constants.
 * @dependencies None - pure data module.
 */

// ============================================================================
// ALGORITHM REGISTRY
// ============================================================================

/** @type {Map<string, import('./algorithms/algorithm.interface.js').AlgorithmDefinition>} */
const ALGORITHM_REGISTRY = new Map();

/**
 * Registers a processing algorithm.
 * @param {import('./algorithms/algorithm.interface.js').AlgorithmDefinition} definition
 * @throws {Error} If the id is already registered
 */
export function registerAlgorithm(definition) {
    if (!definition?.id) {
        throw new Error('Algoritmo deve ter um id');
    }
    if (ALGORITHM_REGISTRY.has(definition.id)) {
        throw new Error(`Algoritmo "${definition.id}" já registrado`);
    }
    ALGORITHM_REGISTRY.set(definition.id, Object.freeze(definition));
}

/**
 * Returns an algorithm by id.
 * @param {string} id
 * @returns {import('./algorithms/algorithm.interface.js').AlgorithmDefinition|undefined}
 */
export function getAlgorithm(id) {
    return ALGORITHM_REGISTRY.get(id);
}

/**
 * Returns all registered algorithms.
 * @returns {import('./algorithms/algorithm.interface.js').AlgorithmDefinition[]}
 */
export function getAllAlgorithms() {
    return Array.from(ALGORITHM_REGISTRY.values());
}

// ============================================================================
// ICONS
// ============================================================================

/**
 * Icons used in the processing module.
 * @readonly
 */
export const PROCESSING_ICONS = Object.freeze({
    play: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,

    check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,

    alertCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,

    cpu: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
});

// ============================================================================
// CATEGORIES
// ============================================================================

// ============================================================================
// SHARED ALGORITHM CONSTANTS
// ============================================================================

/**
 * Default polygon properties for algorithm-generated features.
 * Follows the same pattern as AddPolygonControl.DEFAULT_PROPERTIES
 * and azimuth_distance_geometry.js (OUTPUT_MODE.AREA).
 * @readonly
 */
export const POLYGON_DEFAULTS = Object.freeze({
    fillColor: '#3f4fb5',
    lineColor: '#3f4fb5',
    lineWidth: 2,
    opacity: 0.5,
    lineStyle: 'solid',
    measure: false,
    hatchEnabled: false,
    hatchType: 'none',
    hatchColor: '#000000',
    hatchSpacing: 8,
    hatchLineWidth: 2,
});

/**
 * Geometry types supported by most processing algorithms.
 * Covers all feature types in the application.
 * @readonly
 */
export const SUPPORTED_GEOMETRY_TYPES = Object.freeze([
    // Basic geometries
    'point', 'line', 'polygon',
    // Derived shapes (stored as Polygon)
    'circle', 'rectangle', 'ellipse',
    // Point types (treated as Point by turf)
    'text', 'image', 'military_symbol', 'coordination_measure',
    // Line types (treated as LineString by turf)
    'brush', 'arrow', 'boundary', 'occupied_front',
]);

/**
 * Removes the closing point from a GeoJSON polygon ring if present,
 * producing baseCoordinates suitable for EBGeo storage.
 * @param {number[][]} coords - Ring coordinates from GeoJSON
 * @returns {number[][]} Coordinates without closing duplicate
 */
export function extractBaseCoordinates(coords) {
    if (!coords || coords.length <= 1) return coords;

    const first = coords[0];
    const last = coords[coords.length - 1];
    const isClosed = first[0] === last[0] && first[1] === last[1];

    return isClosed ? coords.slice(0, -1) : coords;
}

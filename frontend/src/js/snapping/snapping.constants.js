// Path: js/snapping/snapping.constants.js

/**
 * @fileoverview Snapping configuration constants.
 * Defines tolerance, visual indicator styles, and eligible layers.
 *
 * @module snapping/snapping.constants
 * @dependencies layers/layer.constants
 */

// ============================================================================
// SNAP BEHAVIOR
// ============================================================================

/** Snap detection radius in CSS pixels */
export const SNAP_TOLERANCE_PX = 18;

/** Bonus distance (px) that gives vertices priority over edges */
export const SNAP_VERTEX_BONUS_PX = 4;

/** Padding around cursor point for queryRenderedFeatures bbox */
export const SNAP_QUERY_PADDING_PX = 20;

// ============================================================================
// SNAP TYPES
// ============================================================================

/** @enum {string} */
export const SnapType = Object.freeze({
    VERTEX: 'vertex',
    EDGE: 'edge',
});

// ============================================================================
// ELIGIBLE LAYERS
// ============================================================================

/**
 * MapLibre layer IDs eligible for snapping.
 * Subset of FEATURE_LAYER_IDS — excludes text, image, boundaries (text-only),
 * military symbols, coordination measures, and analysis layers.
 * Only geometric shapes whose vertices/edges are meaningful snap targets.
 */
export const SNAPPABLE_LAYER_IDS = [
    'point-layer',
    'point-marker-layer',
    'line-layer',
    'polygon-fill-layer',
    'polygon-layer',
    'rectangle-fill-layer',
    'rectangle-layer',
    'circle-fill-layer',
    'circle-layer',
    'ellipse-fill-layer',
    'ellipse-layer',
    'arrow-fill-layer',
    'arrow-layer',
    'occupied-front-layer',
    'boundary-main-layer',
    'sector-fill-layer',
    'sectors-layer',
];

// ============================================================================
// VISUAL INDICATOR
// ============================================================================

/** Indicator source name on the map */
export const SNAP_INDICATOR_SOURCE = 'snap-indicator';

/** Indicator layer ID on the map */
export const SNAP_INDICATOR_LAYER = 'snap-indicator-layer';

/** Visual styles for the snap indicator */
export const SNAP_INDICATOR_STYLE = Object.freeze({
    vertex: {
        color: '#FF6600',
        radius: 6,
        strokeColor: '#FFFFFF',
        strokeWidth: 2,
        opacity: 0.95,
    },
    edge: {
        color: '#FF6600',
        radius: 5,
        strokeColor: '#FF6600',
        strokeWidth: 2,
        opacity: 0.7,
    },
});

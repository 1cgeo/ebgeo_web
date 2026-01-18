// Path: js/layers/layer.constants.js

/**
 * @fileoverview Layer constants and configuration for MapLibre layers.
 */

/**
 * MapLibre layer IDs that receive visibility filters by layerId.
 * @constant {string[]}
 */
export const FEATURE_LAYER_IDS = [
    'point-layer',
    'line-layer',
    'brush-layer',
    'polygon-fill-layer',
    'polygon-fill-pattern-layer',
    'polygon-layer',
    'rectangle-fill-layer',
    'rectangle-fill-pattern-layer',
    'rectangle-layer',
    'circle-fill-layer',
    'circle-fill-pattern-layer',
    'circle-layer',
    'ellipse-fill-layer',
    'ellipse-fill-pattern-layer',
    'ellipse-layer',
    'arrow-fill-layer',
    'arrow-layer',
    'text-layer',
    'text-background-fill-layer',
    'text-background-border-layer',
    'image-layer',
    'military-symbols-layer',
    'coordination-measures-layer',
    'boundary-main-layer',
    'boundary-circles-layer',
    'boundary-circles-stroke-layer',
    'boundary-text-layer',
    'occupied-front-layer',
    'processed-los-layer',
    'visibility-visible-layer',
    'visibility-obstructed-layer'
];

/**
 * Mapping of layer IDs to whether they use hatch pattern filter.
 * true = uses hatch pattern, false = uses solid fill
 * @constant {Object<string, boolean>}
 */
export const HATCH_PATTERN_LAYERS = {
    'polygon-fill-layer': false,
    'polygon-fill-pattern-layer': true,
    'rectangle-fill-layer': false,
    'rectangle-fill-pattern-layer': true,
    'circle-fill-layer': false,
    'circle-fill-pattern-layer': true,
    'ellipse-fill-layer': false,
    'ellipse-fill-pattern-layer': true
};

/**
 * Source names for features.
 * @constant {Object<string, string>}
 */
export const FEATURE_SOURCES = {
    POINTS: 'points',
    LINES: 'lines',
    POLYGONS: 'polygons',
    CIRCLES: 'circles',
    RECTANGLES: 'rectangles',
    ELLIPSES: 'ellipses',
    ARROWS: 'arrows',
    TEXTS: 'texts',
    IMAGES: 'images',
    BRUSHES: 'brushes',
    MILITARY_SYMBOLS: 'military_symbols',
    COORDINATION_MEASURES: 'coordination_measures',
    BOUNDARIES: 'boundarys',
    OCCUPIED_FRONTS: 'occupied_fronts',
    LOS: 'los',
    VISIBILITY: 'visibility'
};

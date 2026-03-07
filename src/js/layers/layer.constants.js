// Path: js/layers/layer.constants.js

/**
 * @fileoverview Layer constants and configuration for MapLibre layers.
 */

/** MapLibre layer IDs that receive visibility filters by layerId. */
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
    'sector-fill-layer',
    'sector-fill-pattern-layer',
    'sectors-layer',
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

/** Fill layer IDs mapped to whether they use hatch pattern (true) or solid fill (false). */
const FILL_SHAPES = ['polygon', 'rectangle', 'circle', 'ellipse', 'sector'];

export const HATCH_PATTERN_LAYERS = Object.fromEntries(
    FILL_SHAPES.flatMap(shape => [
        [`${shape}-fill-layer`, false],
        [`${shape}-fill-pattern-layer`, true]
    ])
);

/** Source names for features. */
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
    VISIBILITY: 'visibility',
    SECTORS: 'setores'
};

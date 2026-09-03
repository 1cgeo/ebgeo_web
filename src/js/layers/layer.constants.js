// Path: js/layers/layer.constants.js

/**
 * @fileoverview Layer constants and configuration for MapLibre layers.
 */

/** MapLibre layer IDs that receive visibility filters by layerId. */
export const FEATURE_LAYER_IDS = [
    'point-layer',
    'point-marker-layer',
    'point-label-layer',
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
    'polygon-label-layer',
    'circle-label-layer',
    'ellipse-label-layer',
    'rectangle-label-layer',
    'sector-label-layer',
    'arrow-fill-layer',
    'arrow-layer',
    'text-layer',
    'text-background-fill-layer',
    'text-background-border-layer',
    'image-layer',
    'military-symbols-layer',
    'coordination-measures-layer',
    'magnetic-declinations-layer',
    'boundary-main-layer',
    'boundary-circles-layer',
    'boundary-circles-stroke-layer',
    'boundary-text-layer',
    'occupied-front-layer',
    'barrier-line-layer',
    'processed-los-layer',
    'visibility-visible-layer',
    'visibility-obstructed-layer'
];

/**
 * Additional filter expressions per layer, merged with visibility filters
 * by updateAllLayerFilters(). Prevents visibility updates from overwriting
 * layer-specific filters (e.g. markerSymbol routing, label visibility).
 */
export const LAYER_ADDITIONAL_FILTERS = {
    'point-layer': [
        ['any', ['!', ['has', 'markerSymbol']], ['==', ['get', 'markerSymbol'], 'circle']],
    ],
    'point-marker-layer': [
        ['has', 'markerSymbol'],
        ['!=', ['get', 'markerSymbol'], 'circle'],
    ],
    'point-label-layer': [
        ['==', ['get', 'showLabel'], true],
        ['has', 'labelText'],
        ['!=', ['get', 'labelText'], ''],
    ],
};

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
    BARRIER_LINES: 'barrier_lines',
    LOS: 'los',
    VISIBILITY: 'visibility',
    SECTORS: 'setores'
};

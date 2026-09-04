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
    'coordination-line-layer',
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

/**
 * Live MapLibre GeoJSON source id for every persisted feature bucket.
 *
 * CONTRACT: one entry per bucket of `getEmptyMapData()` (store/repository.utils.js) that
 * has a live source, spelled EXACTLY as the style module registers it. The single
 * exception is `coordenadas`, which is an ephemeral readout with no source and no layer.
 *
 * Two spellings coexist here and normalizing them would be a bug, not a cleanup: the
 * store buckets are `processed_los` / `processed_visibility` with an UNDERSCORE, while
 * the sources those buckets render into are `processed-los` / `processed-visibility` with
 * a HYPHEN (layers/styles/tactical.layers.js). Note also that `los` / `visibility` are
 * NOT the same sources: they hold the analysis INPUT geometry, and the same style module
 * registers both pairs.
 *
 * This is a CLOSED list read by `shiftSourcesTemporal` (temporal/temporal-render.service.js)
 * against an OPEN one (the buckets). A bucket missing here keeps the pre-shift window in
 * the live source after "Reagendar", and the temporal filter reads that window FROM the
 * source, so the feature shows and hides at the wrong instant until a reload. Guarded by
 * tests/unit/reagendar-fonte-viva.repro.test.js.
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
    COORDINATION_LINES: 'coordination_lines',
    MAGNETIC_DECLINATIONS: 'magnetic_declinations',
    LOS: 'los',
    VISIBILITY: 'visibility',
    PROCESSED_LOS: 'processed-los',
    PROCESSED_VISIBILITY: 'processed-visibility',
    SECTORS: 'setores'
};

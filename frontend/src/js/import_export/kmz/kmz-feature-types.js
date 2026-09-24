// Path: js/import_export/kmz/kmz-feature-types.js

/**
 * @fileoverview Classifies EBGeo feature types into the KML shapes they map to.
 *
 * IMPORTANT: every name here is a SOURCE type (singular). The store keys its
 * feature collections by STORAGE type, which is plural and irregular
 * (`sector` -> `setores`, `boundary` -> `boundarys`), so callers must convert
 * with `getSourceTypeFromStorage()` before classifying. Comparing raw storage
 * keys against these sets silently falls through to the generic branch and
 * strips polygon fills, label text and symbol icons from the export.
 *
 * @module import_export/kmz/kmz-feature-types
 */

/**
 * Feature types drawn as filled areas (LineStyle + PolyStyle).
 *
 * `processed_visibility` is the derived output of a viewshed (the green and red halves). Absent
 * from every list it fell to the LINE default, and a KML Polygon without `<PolyStyle>` is filled
 * with the spec's default, opaque white: the analysed area came out as a white blot.
 */
export const AREA_TYPES = Object.freeze(new Set([
    'polygon', 'circle', 'ellipse', 'rectangle', 'sector', 'arrow', 'processed_visibility',
]));

/**
 * Types whose polygon parts the map fills from `color`/`opacity`, not `fillColor`: they get a
 * PolyStyle in that colour whenever the geometry has a polygon, since KML fills a polygon without
 * one in opaque white (tests/unit/kmz-viewshed-com-preenchimento.repro.test.js).
 */
export const FILL_FROM_COLOR_TYPES = Object.freeze(new Set(['processed_visibility', 'coordination_line']));

/** Feature types drawn as plain linework (LineStyle only). */
export const LINE_TYPES = Object.freeze(new Set([
    'line', 'brush', 'boundary', 'occupied_front', 'coordination_line', 'processed_los',
]));

/** Feature types rendered as a stored or generated symbol image. */
export const SYMBOL_TYPES = Object.freeze(new Set([
    'military_symbol', 'engineering_symbol', 'coordination_measure', 'magnetic_declination',
]));

/** The analysis INPUTS, not exported; their outputs (`processed_*`) are. */
export const SKIPPED_TYPES = Object.freeze(new Set(['los', 'visibility']));

/**
 * Categories a feature type can be exported as.
 * @enum {string}
 */
export const FeatureCategory = Object.freeze({
    AREA: 'area',
    LINE: 'line',
    POINT: 'point',
    TEXT: 'text',
    SYMBOL: 'symbol',
    IMAGE: 'image',
    SKIPPED: 'skipped',
});

/**
 * Classifies a source feature type into its KML export category.
 *
 * @param {string} sourceType - Singular feature type (e.g. 'polygon')
 * @returns {string} One of {@link FeatureCategory}; unknown types fall back to LINE
 */
export function classifyFeatureType(sourceType) {
    if (SKIPPED_TYPES.has(sourceType)) return FeatureCategory.SKIPPED;
    if (AREA_TYPES.has(sourceType)) return FeatureCategory.AREA;
    if (LINE_TYPES.has(sourceType)) return FeatureCategory.LINE;
    if (SYMBOL_TYPES.has(sourceType)) return FeatureCategory.SYMBOL;
    if (sourceType === 'point') return FeatureCategory.POINT;
    if (sourceType === 'text') return FeatureCategory.TEXT;
    if (sourceType === 'image') return FeatureCategory.IMAGE;
    return FeatureCategory.LINE;
}

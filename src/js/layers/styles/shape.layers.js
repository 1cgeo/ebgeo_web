// Path: js/layers/styles/shape.layers.js

/**
 * @fileoverview Shape layer styles (circle, rectangle, ellipse, sector).
 */

import { getHatchPatternGenerator } from '../../tool_manager';
import { syncLabelSource } from '../../tool_manager/helpers/label-tab.helpers.js';
import {

    setOrCreateSource,
    ensureSource,
    ensureLayer,
    LINE_STYLE_DASHARRAY,
    VISIBLE_FILTER,
    SOLID_FILL_FILTER,
    HATCH_FILL_FILTER,
    POINT_TYPE_FILTER,
} from './layer.helpers.js';
import { zoomScaledExpression } from './zoom-expression.js';
// Label sizes scale on the GPU (zoom-expression.js); the label pass of each tool
// only refreshes `labelCalculatedSize` at the end of a gesture.
const LABEL_SIZE = { base: ['coalesce', ['get', 'labelSize'], 14], anchor: 'labelCreatedAtZoom', disabledFlag: 'labelZoomCorrectionEnabled', maxValue: 255 };

// --- Edit-handle paint expressions -----------------------------------------------

const SIMPLE_HANDLE_PAINT = {
    'circle-radius': 8,
    'circle-color': '#ff0000',
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 2,
};

const TYPED_HANDLE_PAINT = {
    'circle-radius': 8,
    'circle-color': [
        'case',
        ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
        ['==', ['get', 'handleType'], 'eccentricity'], '#0066ff',
        '#ffffff',
    ],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 2,
};

// --- Core shape setup ---------------------------------------------------------------

/**
 * Shared logic for all shape types (circle, rectangle, ellipse, sector).
 * Creates sources + feedback/fill/outline/edit-handle layers for a shape.
 * @param {Object} map - MapLibre map instance
 * @param {Object} config - Shape-specific configuration
 * @param {string} config.sourceId - Main GeoJSON source ID
 * @param {string} config.prefix - Layer ID prefix (e.g. "circle", "rectangle")
 * @param {Array} config.features - Feature array for the main source
 * @param {Object} config.handlePaint - Paint expression for edit-handle layer
 * @param {string} [config.outlineLayerId] - Override for the outline layer ID
 * @param {string[]} [config.extraSources] - Additional empty sources to create
 */
function setupShapeType(map, config) {
    const {
        sourceId,
        prefix,
        features,
        handlePaint,
        outlineLayerId,
        extraSources,
    } = config;

    setOrCreateSource(map, sourceId, features);

    ensureSource(map, `${prefix}-feedback`);
    ensureSource(map, `${prefix}-edit-handles`);
    ensureSource(map, `${prefix}-labels`);

    if (extraSources) {
        for (const id of extraSources) {
            ensureSource(map, id);
        }
    }

    const hatch = getHatchPatternGenerator();
    hatch.loadPatternsToMap(map, features || []);

    ensureLayer(map, {
        id: `${prefix}-feedback-layer`,
        type: 'line',
        source: `${prefix}-feedback`,
        paint: {
            'line-color': '#ff0000',
            'line-width': 3,
            'line-dasharray': [2, 2],
            'line-opacity': 0.8,
        },
    });

    ensureLayer(map, {
        id: `${prefix}-fill-layer`,
        type: 'fill',
        source: sourceId,
        paint: {
            'fill-color': ['get', 'fillColor'],
            'fill-opacity': ['get', 'opacity'],
        },
        filter: SOLID_FILL_FILTER,
    });

    ensureLayer(map, {
        id: `${prefix}-fill-pattern-layer`,
        type: 'fill',
        source: sourceId,
        paint: {
            'fill-opacity': ['get', 'opacity'],
            'fill-pattern': ['get', 'hatchPatternId'],
        },
        filter: HATCH_FILL_FILTER,
    });

    ensureLayer(map, {
        id: outlineLayerId || `${prefix}-layer`,
        type: 'line',
        source: sourceId,
        paint: {
            'line-color': ['get', 'lineColor'],
            'line-width': ['get', 'lineWidth'],
            'line-opacity': 1,
            'line-dasharray': LINE_STYLE_DASHARRAY,
        },
        filter: VISIBLE_FILTER,
    });

    // Label layer (reads from separate point source to avoid tile duplication)
    ensureLayer(map, {
        id: `${prefix}-label-layer`,
        type: 'symbol',
        source: `${prefix}-labels`,
        filter: [
            'all',
            ['==', ['get', 'showLabel'], true],
            ['!=', ['get', 'visivel'], false],
            ['has', 'labelText'],
            ['!=', ['get', 'labelText'], ''],
        ],
        layout: {
            'text-field': ['get', 'labelText'],
            'text-size': zoomScaledExpression(LABEL_SIZE),
            'text-font': ['Noto Sans Bold'],
            'text-anchor': 'center',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        paint: {
            'text-color': ['coalesce', ['get', 'labelColor'], '#ffffff'],
            'text-halo-color': ['coalesce', ['get', 'labelOutlineColor'], '#000000'],
            'text-halo-width': ['coalesce', ['get', 'labelOutlineWidth'], 2],
            'text-opacity': 1,
        },
    });

    ensureLayer(map, {
        id: `${prefix}-edit-handles-layer`,
        type: 'circle',
        source: `${prefix}-edit-handles`,
        paint: handlePaint,
        filter: POINT_TYPE_FILTER,
    });

    // Populate label source with centroids from initial features
    syncLabelSource(map, `${prefix}-labels`, { type: 'FeatureCollection', features: features || [] });
}

// --- Public API -------------------------------------------------------------------

/**
 * Sets up circle layers on the map.
 * @param {Object} features - Feature collection with circles
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupCircleLayers(features, mapInstance) {
    setupShapeType(mapInstance, {
        sourceId: 'circles',
        prefix: 'circle',
        features: features.circles,
        handlePaint: SIMPLE_HANDLE_PAINT,
        extraSources: ['circle-x-marks'],
    });
}

/**
 * Sets up rectangle layers on the map.
 * @param {Object} features - Feature collection with rectangles
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupRectangleLayers(features, mapInstance) {
    setupShapeType(mapInstance, {
        sourceId: 'rectangles',
        prefix: 'rectangle',
        features: features.rectangles,
        handlePaint: TYPED_HANDLE_PAINT,
    });
}

/**
 * Sets up sector layers on the map.
 * @param {Object} features - Feature collection with sectors
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupSectorLayers(features, mapInstance) {
    setupShapeType(mapInstance, {
        sourceId: 'setores',
        prefix: 'sector',
        features: features.setores,
        handlePaint: TYPED_HANDLE_PAINT,
        outlineLayerId: 'sectors-layer',
    });
}

/**
 * Sets up ellipse layers on the map.
 * @param {Object} features - Feature collection with ellipses
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupEllipseLayers(features, mapInstance) {
    setupShapeType(mapInstance, {
        sourceId: 'ellipses',
        prefix: 'ellipse',
        features: features.ellipses,
        handlePaint: TYPED_HANDLE_PAINT,
    });
}

// Path: js/layers/styles/tactical.layers.js

/**
 * @fileoverview Tactical layer styles (boundary, occupied front, coordination line, LOS, visibility).
 */

import { getControl } from '../../store';
import {
    setOrCreateSource,
    ensureSource,
    ensureLayer,
    VISIBLE_FILTER,
    POINT_TYPE_FILTER,
} from './layer.helpers.js';
import {
    buildBoundaryLineWidthExpression,
    buildBoundaryTextSizeExpression,
    buildBoundaryCircleStrokeExpression,
} from '../../military_tools/boundary_tool/boundary-zoom.model.js';
import { buildCoordinationLineWidthExpression } from '../../military_tools/coordination_line_tool/coordination-line-zoom.model.js';
import { FILLED_SYMBOL_CODES } from '../../military_tools/coordination_line_tool/coordination_line_catalog.js';

/**
 * Sets up boundary layers on the map.
 * @param {Object} features - Feature collection with boundaries
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupBoundaryLayers(features, mapInstance) {
    if (!features.boundarys) return;

    // Re-anchor to the CURRENT zoom before the source is written, mirroring
    // setupMilitarySymbolsLayers: the stored `calculatedLineWidth` was computed at
    // whatever zoom the map was last at, and a boundary pinned to the screen also
    // has its geometry rebuilt, because its echelon size in km follows the zoom.
    const boundaryControl = getControl('AddBoundaryControl');
    const correctedBoundaries = boundaryControl
        ? boundaryControl.applyZoomCorrections(features.boundarys)
        : features.boundarys;

    setOrCreateSource(mapInstance, 'boundarys', correctedBoundaries);
    ensureSource(mapInstance, 'boundary-circles');
    ensureSource(mapInstance, 'boundary-texts');
    ensureSource(mapInstance, 'boundary-feedback');
    ensureSource(mapInstance, 'boundary-edit-handles');

    ensureLayer(mapInstance, {
        id: 'boundary-feedback-layer',
        type: 'line',
        source: 'boundary-feedback',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': '#ff0000',
            'line-width': 4,
            'line-dasharray': [3, 3],
            'line-opacity': 0.8,
        },
        filter: ['!=', ['get', 'user_isEditingHandle'], true],
    });

    ensureLayer(mapInstance, {
        id: 'boundary-main-layer',
        type: 'line',
        source: 'boundarys',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': buildBoundaryLineWidthExpression(),
            'line-opacity': ['get', 'opacity'],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'boundary-circles-layer',
        type: 'fill',
        source: 'boundary-circles',
        paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'opacity'],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'boundary-circles-stroke-layer',
        type: 'line',
        source: 'boundary-circles',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': buildBoundaryCircleStrokeExpression(),
            'line-opacity': ['get', 'opacity'],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'boundary-text-layer',
        type: 'symbol',
        source: 'boundary-texts',
        layout: {
            'text-field': ['get', 'text'],
            'text-size': buildBoundaryTextSizeExpression(),
            'text-rotate': ['get', 'rotation'],
            // `rotation` is a GROUND bearing (0 = map north, bearing +- 90 = glued
            // to the line). Without this the placement `point` default resolves to
            // 'viewport' and the label drifts off the line by the camera bearing.
            'text-rotation-alignment': 'map',
            // Required companion: with rotation aligned to the map, a pitched
            // camera would otherwise lay the glyphs flat on the ground.
            'text-pitch-alignment': 'viewport',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'symbol-spacing': 1,
        },
        paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': '#fff',
            'text-halo-width': 2,
            'text-opacity': ['coalesce', ['get', 'opacity'], 1],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'boundary-handles-layer',
        type: 'circle',
        source: 'boundary-edit-handles',
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'case',
                ['==', ['get', 'type'], 'vertex'], '#ff0000',
                ['==', ['get', 'type'], 'midpoint'], '#ffaa00',
                ['==', ['get', 'type'], 'symbol_handle'], '#0066ff',
                ['==', ['get', 'type'], 'size_handle'], '#28a745',
                ['==', ['get', 'type'], 'text_distance_handle'], '#9900cc',
                '#000000',
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-opacity': [
                'case',
                ['==', ['get', 'type'], 'midpoint'], 0.6,
                1.0,
            ],
        },
        filter: POINT_TYPE_FILTER,
    });
}

/**
 * Sets up occupied front layers on the map.
 * @param {Object} features - Feature collection with occupied fronts
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupOccupiedFrontLayers(features, mapInstance) {
    setOrCreateSource(mapInstance, 'occupied_fronts', features.occupied_fronts);
    ensureSource(mapInstance, 'occupied-front-feedback');
    ensureSource(mapInstance, 'occupied-front-edit-handles');

    ensureLayer(mapInstance, {
        id: 'occupied-front-feedback-layer',
        type: 'line',
        source: 'occupied-front-feedback',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': '#ff0000',
            'line-width': 4,
            'line-dasharray': [3, 3],
            'line-opacity': 0.8,
        },
    });

    ensureLayer(mapInstance, {
        id: 'occupied-front-layer',
        type: 'line',
        source: 'occupied_fronts',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'lineWidth'],
            'line-opacity': ['get', 'opacity'],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'occupied-front-edit-handles-layer',
        type: 'circle',
        source: 'occupied-front-edit-handles',
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'case',
                ['==', ['get', 'handleType'], 'center'], '#00ff00',
                ['==', ['get', 'handleType'], 'primary'], '#ff0000',
                ['==', ['get', 'handleType'], 'secondary'], '#0066ff',
                '#888888',
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-stroke-opacity': 1,
        },
        filter: POINT_TYPE_FILTER,
    });
}

/**
 * Sets up LOS (Line of Sight) layers on the map.
 * @param {Object} features - Feature collection with LOS features
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupLOSLayers(features, mapInstance) {
    setOrCreateSource(mapInstance, 'los', features.los);
    setOrCreateSource(mapInstance, 'processed-los', features.processed_los);
    ensureSource(mapInstance, 'los-feedback');

    ensureLayer(mapInstance, {
        id: 'los-layer',
        type: 'line',
        source: 'los',
        paint: {
            'line-color': '#D3D3D3',
            'line-opacity': 0,
            'line-width': ['get', 'width'],
        },
    });

    ensureLayer(mapInstance, {
        id: 'processed-los-layer',
        type: 'line',
        source: 'processed-los',
        paint: {
            'line-color': ['get', 'color'],
            'line-opacity': ['get', 'opacity'],
            'line-width': ['get', 'width'],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'los-feedback-layer',
        type: 'line',
        source: 'los-feedback',
        paint: {
            'line-color': '#ff0000',
            'line-width': 3,
            'line-dasharray': [2, 2],
            'line-opacity': 0.8,
        },
    });
}

/**
 * Sets up visibility analysis layers on the map.
 * @param {Object} features - Feature collection with visibility features
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupVisibilityLayers(features, mapInstance) {
    setOrCreateSource(mapInstance, 'visibility', features.visibility);
    setOrCreateSource(mapInstance, 'processed-visibility', features.processed_visibility);
    ensureSource(mapInstance, 'visibility-feedback');
    ensureSource(mapInstance, 'visibility-edit-handles');

    ensureLayer(mapInstance, {
        id: 'visibility-layer',
        type: 'fill',
        source: 'visibility',
        paint: {
            'fill-color': '#D3D3D3',
            'fill-opacity': 0,
        },
    });

    ensureLayer(mapInstance, {
        id: 'visibility-visible-layer',
        type: 'fill',
        source: 'processed-visibility',
        paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'opacity'],
        },
        filter: ['all', VISIBLE_FILTER, ['==', ['get', 'color'], '#00FF00']],
    });

    ensureLayer(mapInstance, {
        id: 'visibility-obstructed-layer',
        type: 'fill',
        source: 'processed-visibility',
        paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'opacity'],
        },
        filter: ['all', VISIBLE_FILTER, ['==', ['get', 'color'], '#FF0000']],
    });

    ensureLayer(mapInstance, {
        id: 'visibility-feedback-layer',
        type: 'fill',
        source: 'visibility-feedback',
        paint: {
            'fill-color': '#3f4fb5',
            'fill-opacity': 0.5,
            'fill-outline-color': '#3f4fb5',
        },
    });

    ensureLayer(mapInstance, {
        id: 'visibility-feedback-outline-layer',
        type: 'line',
        source: 'visibility-feedback',
        paint: {
            'line-color': '#3f4fb5',
            'line-width': 2,
            'line-dasharray': [4, 2],
            'line-opacity': 0.8,
        },
    });

    ensureLayer(mapInstance, {
        id: 'visibility-edit-handles-layer',
        type: 'circle',
        source: 'visibility-edit-handles',
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'case',
                ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                ['==', ['get', 'handleType'], 'eccentricity'], '#0066ff',
                ['==', ['get', 'handleType'], 'center'], '#00ff00',
                '#ffffff',
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
        },
        filter: POINT_TYPE_FILTER,
    });
}

/**
 * Sets up coordination line layers on the map.
 *
 * Three sources and three layers, and no more: the whole symbol (the surviving
 * line segments plus one closed ring per diamond) lives in ONE MultiLineString,
 * so a single `line` layer draws it and the diamonds read as hollow for free.
 * That is the difference from the boundary, which needs sibling sources for its
 * echelon circles and labels.
 *
 * @param {Object} features - Feature collection with coordination lines
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupCoordinationLineLayers(features, mapInstance) {
    // NO early return when the bucket is missing, unlike the boundary above.
    // The v2.3 migration gives every stored map its `coordination_lines`
    // collection, but this function also runs on data that never passed through
    // it (a freshly built map object, a test fixture). Bailing out here would
    // leave the source and the three layers uncreated, and the tool would
    // activate, accept clicks and draw NOTHING, because every write goes through
    // `getSource(...)?.setData` and the optional chaining swallows the absence.
    // An empty array is the right reading of "no coordination lines yet".
    const stored = Array.isArray(features?.coordination_lines) ? features.coordination_lines : [];

    // Correct before the first write: a line pinned to the SCREEN and reopened at
    // another zoom would otherwise draw its glyphs at the scale of the session
    // that saved it.
    const coordinationLineControl = getControl('AddCoordinationLineControl');
    const correctedLines = coordinationLineControl
        ? coordinationLineControl.applyZoomCorrections(stored)
        : stored;

    setOrCreateSource(mapInstance, 'coordination_lines', correctedLines);
    ensureSource(mapInstance, 'coordination-line-feedback');
    ensureSource(mapInstance, 'coordination-line-edit-handles');

    ensureLayer(mapInstance, {
        id: 'coordination-line-feedback-layer',
        type: 'line',
        source: 'coordination-line-feedback',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': '#ff0000',
            'line-width': 4,
            'line-dasharray': [3, 3],
            'line-opacity': 0.8,
        },
        filter: ['!=', ['get', 'user_isEditingHandle'], true],
    });

    // BEFORE the line layer, so the outline lands on top of its own fill.
    //
    // The `symbol_code` clause is the load-bearing part, and it is not tidiness.
    // Measured in the browser on 2026-09-03: MapLibre's fill layer CLOSES and
    // paints any geometry handed to it, so an unfiltered fill over this source
    // painted the inside of the 290199 diamond, the inside of every concertina
    // loop, and the area between an open bent spine and its chord. Only the codes
    // the catalogue marks `filled` emit polygons, and only they may be painted.
    // The filter below is only the BIRTH filter. `updateAllLayerFilters`
    // (`layers/visibility-filter.js`) rewrites the filter of every layer listed in
    // `FEATURE_LAYER_IDS` with layer membership and the temporal window; this id is
    // there, and the code clause travels through `LAYER_ADDITIONAL_FILTERS`, or the
    // rewrite would lose it. Until 2026-09-05 the id was outside the list, and hiding
    // the user's layer erased the outline while the band stayed on screen; pinned by
    // coordination-line-fill-filtro.test.js.
    ensureLayer(mapInstance, {
        id: 'coordination-line-fill-layer',
        type: 'fill',
        source: 'coordination_lines',
        paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'opacity'],
        },
        filter: ['all',
            VISIBLE_FILTER,
            ['in', ['get', 'symbol_code'], ['literal', [...FILLED_SYMBOL_CODES]]],
        ],
    });

    ensureLayer(mapInstance, {
        id: 'coordination-line-layer',
        type: 'line',
        source: 'coordination_lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': buildCoordinationLineWidthExpression(),
            'line-opacity': ['get', 'opacity'],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'coordination-line-edit-handles-layer',
        type: 'circle',
        source: 'coordination-line-edit-handles',
        paint: {
            'circle-radius': 8,
            // The handle kind travels in `type`, as it does for the boundary.
            'circle-color': [
                'case',
                ['==', ['get', 'type'], 'vertex'], '#ff0000',
                ['==', ['get', 'type'], 'midpoint'], '#ffaa00',
                '#000000',
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-opacity': [
                'case',
                ['==', ['get', 'type'], 'midpoint'], 0.6,
                1.0,
            ],
        },
        filter: POINT_TYPE_FILTER,
    });
}

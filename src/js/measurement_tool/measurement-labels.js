// Path: js/measurement_tool/measurement-labels.js

/**
 * @module measurement_tool/measurement-labels
 * @description Manages MapLibre GeoJSON sources for ephemeral measurement labels.
 * Labels are rendered as symbol layers for performance (no DOM markers).
 */

import { MEASUREMENT_SOURCES, MEASUREMENT_LAYERS, MEASUREMENT_STYLE } from './measurement.constants.js';

// ============================================================================
// EMPTY FEATURE COLLECTION
// ============================================================================

const EMPTY_FC = Object.freeze({ type: 'FeatureCollection', features: [] });

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Updates the label source with new label features.
 * Each label is a Point feature with a `text` property.
 * @param {Object} map - MapLibre map instance
 * @param {Array<{ coordinates: number[], text: string }>} labels - Label definitions
 */
export function updateLabels(map, labels) {
    const source = map.getSource(MEASUREMENT_SOURCES.LABELS);
    if (!source) return;

    const features = labels.map((label, i) => ({
        type: 'Feature',
        id: i,
        properties: { text: label.text },
        geometry: { type: 'Point', coordinates: label.coordinates },
    }));

    source.setData({ type: 'FeatureCollection', features });
}

/**
 * Updates the preview line source.
 * @param {Object} map - MapLibre map instance
 * @param {number[][]} coordinates - Array of [lng, lat] for the polyline
 */
export function updatePreviewLine(map, coordinates) {
    const source = map.getSource(MEASUREMENT_SOURCES.PREVIEW_LINE);
    if (!source) return;

    if (!coordinates || coordinates.length < 2) {
        source.setData(EMPTY_FC);
        return;
    }

    source.setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates },
        }],
    });
}

/**
 * Updates the preview fill source (for area measurement).
 * @param {Object} map - MapLibre map instance
 * @param {number[][]} coordinates - Polygon ring (first != last, will be closed)
 */
export function updatePreviewFill(map, coordinates) {
    const source = map.getSource(MEASUREMENT_SOURCES.PREVIEW_FILL);
    if (!source) return;

    if (!coordinates || coordinates.length < 3) {
        source.setData(EMPTY_FC);
        return;
    }

    const ring = [...coordinates, coordinates[0]];
    source.setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [ring] },
        }],
    });
}

/**
 * Updates the vertex markers source.
 * @param {Object} map - MapLibre map instance
 * @param {number[][]} coordinates - Array of [lng, lat] for vertex positions
 */
export function updateVertices(map, coordinates) {
    const source = map.getSource(MEASUREMENT_SOURCES.VERTICES);
    if (!source) return;

    const features = (coordinates || []).map((coord, i) => ({
        type: 'Feature',
        id: i,
        properties: {},
        geometry: { type: 'Point', coordinates: coord },
    }));

    source.setData({ type: 'FeatureCollection', features });
}

/**
 * Updates the angle arc source.
 * @param {Object} map - MapLibre map instance
 * @param {number[][]} arcCoordinates - Arc LineString coordinates
 */
export function updateAngleArc(map, arcCoordinates) {
    const source = map.getSource(MEASUREMENT_SOURCES.ANGLE_ARC);
    if (!source) return;

    if (!arcCoordinates || arcCoordinates.length < 2) {
        source.setData(EMPTY_FC);
        return;
    }

    source.setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: arcCoordinates },
        }],
    });
}

/**
 * Updates the angle rays source.
 * @param {Object} map - MapLibre map instance
 * @param {number[][][]} rayCoordinates - Array of LineString coordinate arrays
 */
export function updateAngleRays(map, rayCoordinates) {
    const source = map.getSource(MEASUREMENT_SOURCES.ANGLE_RAYS);
    if (!source) return;

    const features = (rayCoordinates || []).map((coords, i) => ({
        type: 'Feature',
        id: i,
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
    }));

    source.setData({ type: 'FeatureCollection', features });
}

/**
 * Clears all measurement sources (labels, preview, vertices, angle).
 * @param {Object} map - MapLibre map instance
 */
export function clearAllSources(map) {
    const sourceIds = Object.values(MEASUREMENT_SOURCES);
    for (const sourceId of sourceIds) {
        const source = map.getSource(sourceId);
        if (source) {
            source.setData(EMPTY_FC);
        }
    }
}

// ============================================================================
// LAYER SETUP (called from auxiliary.layers.js)
// ============================================================================

/**
 * Sets up all measurement-related sources and layers on the map.
 * Called once during map initialization.
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupMeasurementLayers(mapInstance) {
    // --- Sources ---
    const sources = [
        MEASUREMENT_SOURCES.PREVIEW_LINE,
        MEASUREMENT_SOURCES.PREVIEW_FILL,
        MEASUREMENT_SOURCES.VERTICES,
        MEASUREMENT_SOURCES.LABELS,
        MEASUREMENT_SOURCES.ANGLE_ARC,
        MEASUREMENT_SOURCES.ANGLE_RAYS,
    ];

    for (const sourceId of sources) {
        if (!mapInstance.getSource(sourceId)) {
            mapInstance.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
        }
    }

    // --- Preview fill (area) ---
    if (!mapInstance.getLayer(MEASUREMENT_LAYERS.PREVIEW_FILL)) {
        mapInstance.addLayer({
            id: MEASUREMENT_LAYERS.PREVIEW_FILL,
            type: 'fill',
            source: MEASUREMENT_SOURCES.PREVIEW_FILL,
            paint: {
                'fill-color': MEASUREMENT_STYLE.fillColor,
                'fill-opacity': MEASUREMENT_STYLE.fillOpacity,
            },
        });
    }

    // --- Preview line ---
    if (!mapInstance.getLayer(MEASUREMENT_LAYERS.PREVIEW_LINE)) {
        mapInstance.addLayer({
            id: MEASUREMENT_LAYERS.PREVIEW_LINE,
            type: 'line',
            source: MEASUREMENT_SOURCES.PREVIEW_LINE,
            paint: {
                'line-color': MEASUREMENT_STYLE.lineColor,
                'line-width': MEASUREMENT_STYLE.lineWidth,
                'line-dasharray': MEASUREMENT_STYLE.lineDasharray,
            },
        });
    }

    // --- Angle rays ---
    if (!mapInstance.getLayer(MEASUREMENT_LAYERS.ANGLE_RAYS)) {
        mapInstance.addLayer({
            id: MEASUREMENT_LAYERS.ANGLE_RAYS,
            type: 'line',
            source: MEASUREMENT_SOURCES.ANGLE_RAYS,
            paint: {
                'line-color': MEASUREMENT_STYLE.lineColor,
                'line-width': MEASUREMENT_STYLE.lineWidth,
            },
        });
    }

    // --- Angle arc ---
    if (!mapInstance.getLayer(MEASUREMENT_LAYERS.ANGLE_ARC)) {
        mapInstance.addLayer({
            id: MEASUREMENT_LAYERS.ANGLE_ARC,
            type: 'line',
            source: MEASUREMENT_SOURCES.ANGLE_ARC,
            paint: {
                'line-color': MEASUREMENT_STYLE.angleArcColor,
                'line-width': MEASUREMENT_STYLE.angleArcWidth,
                'line-dasharray': [4, 3],
            },
        });
    }

    // --- Vertices ---
    if (!mapInstance.getLayer(MEASUREMENT_LAYERS.VERTICES)) {
        mapInstance.addLayer({
            id: MEASUREMENT_LAYERS.VERTICES,
            type: 'circle',
            source: MEASUREMENT_SOURCES.VERTICES,
            paint: {
                'circle-radius': MEASUREMENT_STYLE.vertexRadius,
                'circle-color': MEASUREMENT_STYLE.vertexColor,
                'circle-stroke-color': MEASUREMENT_STYLE.vertexStrokeColor,
                'circle-stroke-width': MEASUREMENT_STYLE.vertexStrokeWidth,
            },
        });
    }

    // --- Labels (text) ---
    if (!mapInstance.getLayer(MEASUREMENT_LAYERS.LABELS)) {
        mapInstance.addLayer({
            id: MEASUREMENT_LAYERS.LABELS,
            type: 'symbol',
            source: MEASUREMENT_SOURCES.LABELS,
            layout: {
                'text-field': ['get', 'text'],
                'text-size': MEASUREMENT_STYLE.labelSize,
                'text-font': ['Noto Sans Bold'],
                'text-anchor': 'center',
                'text-allow-overlap': true,
                'text-ignore-placement': true,
            },
            paint: {
                'text-color': MEASUREMENT_STYLE.labelColor,
                'text-halo-color': MEASUREMENT_STYLE.labelHaloColor,
                'text-halo-width': MEASUREMENT_STYLE.labelHaloWidth,
            },
        });
    }
}

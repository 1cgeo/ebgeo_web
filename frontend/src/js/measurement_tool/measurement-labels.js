// Path: js/measurement_tool/measurement-labels.js

/**
 * @module measurement_tool/measurement-labels
 * @description Manages MapLibre GeoJSON sources for ephemeral measurement labels.
 * Labels are rendered as symbol layers for performance (no DOM markers).
 *
 * EVERY write here stays a whole-collection `setData`, and that is a decision, not an omission.
 * These six sources are NOT candidates for the diff dispatcher (`layers/geojson-dispatcher.js`),
 * for three independent reasons:
 * - the collections hold a handful of features, where `setData` already costs about nothing (the
 *   measured diff win starts in the thousands);
 * - they are rebuilt on every mousemove of a measurement, with no gap between writes, which is
 *   the exact regime where back-to-back `updateData` calls were measured applying 2 of 10, and a
 *   dropped frame in a rubber band is visible dragging;
 * - the features carry no stable identity at all: the id is the ARRAY INDEX, so a vertex inserted
 *   mid-line renumbers every one after it and the diff would have to remove and re-add the whole
 *   collection each frame, which is strictly more work than replacing it.
 * Their sources are created below without `promoteId` for the same reason.
 */

import { MEASUREMENT_SOURCES, MEASUREMENT_LAYERS, MEASUREMENT_STYLE } from './measurement.constants.js';

const EMPTY_FC = Object.freeze({ type: 'FeatureCollection', features: [] });

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
        properties: { text: label.text, labelType: label.labelType || 'segment' },
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
 * Clears all measurement sources.
 * @param {Object} map - MapLibre map instance
 */
export function clearAllSources(map) {
    for (const sourceId of Object.values(MEASUREMENT_SOURCES)) {
        const source = map.getSource(sourceId);
        if (source) {
            source.setData(EMPTY_FC);
        }
    }
}

/**
 * Sets up all measurement-related sources and layers on the map.
 * Called once during map initialization from auxiliary.layers.js.
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupMeasurementLayers(mapInstance) {
    const sources = Object.values(MEASUREMENT_SOURCES);

    for (const sourceId of sources) {
        if (!mapInstance.getSource(sourceId)) {
            mapInstance.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
        }
    }

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

    if (!mapInstance.getLayer(MEASUREMENT_LAYERS.LABELS)) {
        mapInstance.addLayer({
            id: MEASUREMENT_LAYERS.LABELS,
            type: 'symbol',
            source: MEASUREMENT_SOURCES.LABELS,
            layout: {
                'text-field': ['get', 'text'],
                'text-size': MEASUREMENT_STYLE.labelSize,
                'text-font': ['Noto Sans Bold'],
                'text-anchor': [
                    'case',
                    ['==', ['get', 'labelType'], 'total'],
                    'bottom-right',
                    'center'
                ],
                'text-offset': [
                    'case',
                    ['==', ['get', 'labelType'], 'total'],
                    ['literal', [-0.5, -0.5]],
                    ['literal', [0, 0]]
                ],
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

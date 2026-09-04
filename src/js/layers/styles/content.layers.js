// Path: js/layers/styles/content.layers.js

/**
 * @fileoverview Content layer styles (text, image, arrow).
 */

import { getControl } from '../../store';
import { zoomScaledExpression } from './zoom-expression.js';

// GPU-side zoom scaling (zoom-expression.js); `calculatedSize` is refreshed by
// the tools at the end of a gesture for the consumers that read it.
const TEXT_SIZE = { base: ['coalesce', ['get', 'size'], 16], anchor: 'createdAtZoom', disabledFlag: 'zoomCorrectionEnabled', maxValue: 255 };
const IMAGE_SIZE = { base: ['coalesce', ['get', 'size'], 1], anchor: 'createdAtZoom', disabledFlag: 'zoomCorrectionEnabled', maxValue: 10 };

const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };

/**
 * Creates a FeatureCollection from an array of features.
 * @param {Array} features
 * @returns {Object}
 */
function featureCollection(features) {
    return { type: 'FeatureCollection', features };
}

/**
 * Adds a new source or updates an existing one with the given features.
 * @param {Object} map - MapLibre map instance
 * @param {string} name - Source name
 * @param {Array} features - GeoJSON features
 */
function setSourceData(map, name, features) {
    const data = featureCollection(features);
    const source = map.getSource(name);
    if (source) {
        source.setData(data);
    } else {
        map.addSource(name, { type: 'geojson', data });
    }
}

/**
 * Adds an empty GeoJSON source if it does not already exist.
 * @param {Object} map - MapLibre map instance
 * @param {string} name - Source name
 */
function addEmptySource(map, name) {
    if (!map.getSource(name)) {
        map.addSource(name, { type: 'geojson', data: EMPTY_COLLECTION });
    }
}

/**
 * Adds a layer only if it does not already exist on the map.
 * @param {Object} map - MapLibre map instance
 * @param {Object} layerDef - Full layer definition including `id`
 */
function addLayerOnce(map, layerDef) {
    if (!map.getLayer(layerDef.id)) {
        map.addLayer(layerDef);
    }
}

/**
 * Extracts background polygon features from text features that have
 * `showBackground` enabled and a `selectionBox` geometry.
 * @param {Array} texts - Text GeoJSON features
 * @returns {Array}
 */
function toBackgroundFeatures(texts) {
    return texts
        .filter(f => f.properties.showBackground && f.properties.selectionBox)
        .map(f => ({
            type: 'Feature',
            properties: { ...f.properties, id: f.properties.id + '_bg' },
            geometry: f.properties.selectionBox
        }));
}

/**
 * Applies zoom corrections if a control is available, otherwise returns features unchanged.
 * @param {Object|undefined} control - Tool control instance
 * @param {Array} features - GeoJSON features
 * @returns {Array}
 */
function applyCorrections(control, features) {
    return control ? control.applyZoomCorrections(features) : features;
}

// -- Visibility filter reused across text background layers --
const TEXT_BG_FILTER = [
    'all',
    ['!=', ['get', 'visivel'], false],
    ['==', ['get', 'showBackground'], true]
];

const VISIBLE_FILTER = ['!=', ['get', 'visivel'], false];

/**
 * Sets up text layers on the map.
 * @param {Object} features - Feature collection with texts
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupTextLayers(features, mapInstance) {
    const textControl = getControl('AddTextControl');
    const correctedTexts = applyCorrections(textControl, features.texts);

    setSourceData(mapInstance, 'texts', correctedTexts);
    setSourceData(mapInstance, 'text-backgrounds', toBackgroundFeatures(correctedTexts));

    addLayerOnce(mapInstance, {
        id: 'text-background-fill-layer',
        type: 'fill',
        source: 'text-backgrounds',
        paint: {
            'fill-color': ['get', 'backgroundFillColor'],
            'fill-opacity': ['get', 'backgroundFillOpacity']
        },
        filter: TEXT_BG_FILTER
    });

    addLayerOnce(mapInstance, {
        id: 'text-background-border-layer',
        type: 'line',
        source: 'text-backgrounds',
        paint: {
            'line-color': ['get', 'backgroundBorderColor'],
            'line-width': ['get', 'backgroundBorderWidth'],
            'line-opacity': ['get', 'backgroundBorderOpacity']
        },
        filter: TEXT_BG_FILTER
    });

    addLayerOnce(mapInstance, {
        id: 'text-layer',
        type: 'symbol',
        source: 'texts',
        layout: {
            'text-field': ['get', 'text'],
            'text-size': zoomScaledExpression(TEXT_SIZE),
            'text-justify': ['get', 'justify'],
            'text-anchor': 'center',
            'text-rotate': ['get', 'rotation'],
            'text-ignore-placement': true,
            'text-allow-overlap': true
        },
        paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': ['get', 'backgroundColor'],
            'text-halo-width': ['get', 'textHaloWidth'],
            'text-opacity': 1
        },
        filter: VISIBLE_FILTER
    });

    addEmptySource(mapInstance, 'text-edit-handles');

    addLayerOnce(mapInstance, {
        id: 'text-edit-handles-layer',
        type: 'circle',
        source: 'text-edit-handles',
        paint: {
            'circle-radius': 8,
            'circle-color': '#0066ff',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2
        },
        filter: ['==', '$type', 'Point']
    });

    // Keep `text-backgrounds` in step with every write to `texts`. The mark lives
    // on the SOURCE, not on the control: a base-map switch that drops the source
    // creates a new one, and a mark on the control would leave it unpatched.
    // The backgrounds are derived from the collection just written, so there is
    // no worker round trip (`getData`) and no deferred timer here.
    const textsSource = textControl && mapInstance.getSource('texts');
    if (textsSource && !textsSource._ebgeoBackgroundsPatched) {
        const originalSetData = textsSource.setData.bind(textsSource);
        textsSource.setData = function (data) {
            originalSetData(data);
            const features = Array.isArray(data?.features) ? data.features : [];
            mapInstance.getSource('text-backgrounds')?.setData(
                featureCollection(toBackgroundFeatures(features))
            );
            return this;
        };
        textsSource._ebgeoBackgroundsPatched = true;
    }
}

/**
 * Sets up image layers on the map.
 * @param {Object} features - Feature collection with images
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupImageLayers(features, mapInstance) {
    const imageControl = getControl('AddImageControl');
    const correctedImages = applyCorrections(imageControl, features.images);

    setSourceData(mapInstance, 'images', correctedImages);

    addLayerOnce(mapInstance, {
        id: 'image-layer',
        type: 'symbol',
        source: 'images',
        paint: {
            'icon-opacity': ['get', 'opacity']
        },
        layout: {
            'icon-image': ['get', 'id'],
            'icon-size': zoomScaledExpression(IMAGE_SIZE),
            'icon-rotate': ['get', 'rotation'],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        },
        filter: VISIBLE_FILTER
    });
}

/**
 * Sets up arrow layers on the map.
 * @param {Object} features - Feature collection with arrows
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupArrowLayers(features, mapInstance) {
    setSourceData(mapInstance, 'arrows', features.arrows);
    addEmptySource(mapInstance, 'arrow-feedback');
    addEmptySource(mapInstance, 'arrow-edit-handles');

    addLayerOnce(mapInstance, {
        id: 'arrow-feedback-layer',
        type: 'line',
        source: 'arrow-feedback',
        paint: {
            'line-color': '#ff0000',
            'line-width': 4,
            'line-dasharray': [3, 3],
            'line-opacity': 0.8
        }
    });

    addLayerOnce(mapInstance, {
        id: 'arrow-fill-layer',
        type: 'fill',
        source: 'arrows',
        paint: {
            'fill-color': ['get', 'fillColor'],
            'fill-opacity': ['get', 'fillOpacity']
        },
        filter: VISIBLE_FILTER
    });

    addLayerOnce(mapInstance, {
        id: 'arrow-layer',
        type: 'line',
        source: 'arrows',
        paint: {
            'line-color': ['get', 'lineColor'],
            'line-width': ['get', 'lineWidth'],
            'line-opacity': ['get', 'lineOpacity']
        },
        filter: VISIBLE_FILTER
    });

    addLayerOnce(mapInstance, {
        id: 'arrow-edit-handles-layer',
        type: 'circle',
        source: 'arrow-edit-handles',
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'case',
                ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                ['==', ['get', 'handleType'], 'midpoint'], '#ffaa00',
                ['==', ['get', 'handleType'], 'width'], '#0066ff',
                ['==', ['get', 'handleType'], 'headLength'], '#00aa00',
                ['==', ['get', 'handleType'], 'airmobile'], '#aa00aa',
                '#000000'
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-opacity': [
                'case',
                ['==', ['get', 'handleType'], 'midpoint'], 0.6,
                1.0
            ]
        },
        filter: ['==', '$type', 'Point']
    });
}

// Path: js/layers/styles/content.layers.js

/**
 * @fileoverview Content layer styles (text, image, arrow).
 */

import { getControl } from '../../store';

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
            'text-size': ['get', 'calculatedSize'],
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

    // Mirror every write to the 'texts' source into 'text-backgrounds'. The "already patched" mark
    // lives on the SOURCE, not on the control: `setStyle()` (base-layer switch) destroys and
    // recreates every custom source, while the control is a session-long singleton — a mark on the
    // control would stay true and leave the brand-new source unpatched for the rest of the session.
    const textsSource = mapInstance.getSource('texts');
    if (textsSource && !textsSource.__ebgeoBgPatch) {
        const originalSetData = textsSource.setData.bind(textsSource);
        textsSource.setData = function (data) {
            originalSetData(data);
            setTimeout(async () => {
                const currentTexts = await textsSource.getData();
                mapInstance.getSource('text-backgrounds')?.setData(
                    featureCollection(toBackgroundFeatures(currentTexts.features))
                );
            }, 0);
        };
        textsSource.__ebgeoBgPatch = true;
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
            'icon-size': ['get', 'calculatedSize'],
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

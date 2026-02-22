// Path: js/layers/styles/content.layers.js

/**
 * @fileoverview Content layer styles (text, image, arrow).
 */

import { getControl } from '../../store';

/**
 * Sets up text layers on the map.
 * @param {Object} features - Feature collection with texts
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupTextLayers(features, mapInstance) {
    const textControl = getControl('AddTextControl');

    let correctedTexts = features.texts;
    if (textControl) {
        correctedTexts = textControl.applyZoomCorrections(features.texts);
    }

    if (!mapInstance.getSource('texts')) {
        mapInstance.addSource('texts', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: correctedTexts
            }
        });
    } else {
        mapInstance.getSource('texts').setData({
            type: 'FeatureCollection',
            features: correctedTexts
        });
    }

    const backgroundFeatures = correctedTexts
        .filter(feature => feature.properties.showBackground && feature.properties.selectionBox)
        .map(feature => ({
            type: 'Feature',
            properties: {
                ...feature.properties,
                id: feature.properties.id + '_bg'
            },
            geometry: feature.properties.selectionBox
        }));

    if (!mapInstance.getSource('text-backgrounds')) {
        mapInstance.addSource('text-backgrounds', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: backgroundFeatures
            }
        });
    } else {
        mapInstance.getSource('text-backgrounds').setData({
            type: 'FeatureCollection',
            features: backgroundFeatures
        });
    }

    if (!mapInstance.getLayer('text-background-fill-layer')) {
        mapInstance.addLayer({
            id: 'text-background-fill-layer',
            type: 'fill',
            source: 'text-backgrounds',
            paint: {
                'fill-color': ['get', 'backgroundFillColor'],
                'fill-opacity': ['get', 'backgroundFillOpacity']
            },
            filter: ['all',
                ['!=', ['get', 'visivel'], false],
                ['==', ['get', 'showBackground'], true]
            ]
        });
    }

    if (!mapInstance.getLayer('text-background-border-layer')) {
        mapInstance.addLayer({
            id: 'text-background-border-layer',
            type: 'line',
            source: 'text-backgrounds',
            paint: {
                'line-color': ['get', 'backgroundBorderColor'],
                'line-width': ['get', 'backgroundBorderWidth'],
                'line-opacity': ['get', 'backgroundBorderOpacity']
            },
            filter: ['all',
                ['!=', ['get', 'visivel'], false],
                ['==', ['get', 'showBackground'], true]
            ]
        });
    }

    if (!mapInstance.getLayer('text-layer')) {
        mapInstance.addLayer({
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
                'text-halo-width': ['get', 'textHaloWidth']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    // Edit handle source + layer for text rotation handle
    if (!mapInstance.getSource('text-edit-handles')) {
        mapInstance.addSource('text-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('text-edit-handles-layer')) {
        mapInstance.addLayer({
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
    }

    const updateBackgroundFeatures = async () => {
        const currentTexts = await mapInstance.getSource('texts').getData();
        const updatedBackgroundFeatures = currentTexts.features
            .filter(feature => feature.properties.showBackground && feature.properties.selectionBox)
            .map(feature => ({
                type: 'Feature',
                properties: {
                    ...feature.properties,
                    id: feature.properties.id + '_bg'
                },
                geometry: feature.properties.selectionBox
            }));

        mapInstance.getSource('text-backgrounds').setData({
            type: 'FeatureCollection',
            features: updatedBackgroundFeatures
        });
    };

    if (textControl && !textControl._backgroundUpdateListener) {
        const originalSetData = mapInstance.getSource('texts').setData.bind(mapInstance.getSource('texts'));
        mapInstance.getSource('texts').setData = function (data) {
            originalSetData(data);
            setTimeout(updateBackgroundFeatures, 0);
        };
        textControl._backgroundUpdateListener = true;
    }
}

/**
 * Sets up image layers on the map.
 * @param {Object} features - Feature collection with images
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupImageLayers(features, mapInstance) {
    const imageControl = getControl('AddImageControl');

    let correctedImages = features.images;
    if (imageControl) {
        correctedImages = imageControl.applyZoomCorrections(features.images);
    }

    if (!mapInstance.getSource('images')) {
        mapInstance.addSource('images', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: correctedImages
            }
        });
    } else {
        mapInstance.getSource('images').setData({
            type: 'FeatureCollection',
            features: correctedImages
        });
    }

    if (!mapInstance.getLayer('image-layer')) {
        mapInstance.addLayer({
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
            filter: ['!=', ['get', 'visivel'], false]
        });
    }
}

/**
 * Sets up arrow layers on the map.
 * @param {Object} features - Feature collection with arrows
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupArrowLayers(features, mapInstance) {
    if (!mapInstance.getSource('arrows')) {
        mapInstance.addSource('arrows', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.arrows
            }
        });
    } else {
        mapInstance.getSource('arrows').setData({
            type: 'FeatureCollection',
            features: features.arrows
        });
    }

    if (!mapInstance.getSource('arrow-feedback')) {
        mapInstance.addSource('arrow-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('arrow-edit-handles')) {
        mapInstance.addSource('arrow-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('arrow-feedback-layer')) {
        mapInstance.addLayer({
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
    }

    if (!mapInstance.getLayer('arrow-fill-layer')) {
        mapInstance.addLayer({
            id: 'arrow-fill-layer',
            type: 'fill',
            source: 'arrows',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'fillOpacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('arrow-layer')) {
        mapInstance.addLayer({
            id: 'arrow-layer',
            type: 'line',
            source: 'arrows',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': ['get', 'lineOpacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('arrow-edit-handles-layer')) {
        mapInstance.addLayer({
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
}

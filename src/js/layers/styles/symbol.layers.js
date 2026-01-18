// Path: js/layers/styles/symbol.layers.js

/**
 * @fileoverview Symbol layer styles (military symbols, coordination measures).
 */

/**
 * Sets up military symbol layers on the map.
 * @param {Object} features - Feature collection with military symbols
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupMilitarySymbolsLayers(features, mapInstance) {
    const militarySymbolControl = mapInstance._controls.find(control =>
        control._name === 'AddMilitarySymbolControl'
    );

    let correctedSymbols = features.military_symbols;
    if (militarySymbolControl) {
        correctedSymbols = militarySymbolControl.applyZoomCorrections(features.military_symbols);
    }

    if (!mapInstance.getSource('military_symbols')) {
        mapInstance.addSource('military_symbols', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: correctedSymbols
            }
        });
    } else {
        mapInstance.getSource('military_symbols').setData({
            type: 'FeatureCollection',
            features: correctedSymbols
        });
    }

    if (!mapInstance.getLayer('military-symbols-layer')) {
        mapInstance.addLayer({
            id: 'military-symbols-layer',
            type: 'symbol',
            source: 'military_symbols',
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
 * Sets up coordination measure layers on the map.
 * @param {Object} features - Feature collection with coordination measures
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupCoordinationMeasureLayers(features, mapInstance) {
    const coordinationMeasureControl = mapInstance._controls.find(control =>
        control._name === 'AddCoordinationMeasureControl'
    );

    let correctedSymbols = features.coordination_measures || [];
    if (coordinationMeasureControl && features.coordination_measures && features.coordination_measures.length > 0) {
        correctedSymbols = coordinationMeasureControl.applyZoomCorrections(features.coordination_measures);
    }

    if (!mapInstance.getSource('coordination_measures')) {
        mapInstance.addSource('coordination_measures', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: correctedSymbols
            }
        });
    } else {
        mapInstance.getSource('coordination_measures').setData({
            type: 'FeatureCollection',
            features: correctedSymbols
        });
    }

    if (!mapInstance.getLayer('coordination-measures-layer')) {
        mapInstance.addLayer({
            id: 'coordination-measures-layer',
            type: 'symbol',
            source: 'coordination_measures',
            paint: {
                'icon-opacity': ['get', 'opacity']
            },
            layout: {
                'icon-image': ['get', 'id'],
                'icon-size': ['get', 'calculatedSize'],
                'icon-rotate': ['get', 'rotation'],
                'icon-anchor': [
                    'coalesce',
                    ['get', 'anchor'],
                    'center'
                ],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }
}

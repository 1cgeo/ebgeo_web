// Path: js/layers/styles/symbol.layers.js

/**
 * @fileoverview Symbol layer styles (military symbols, coordination measures).
 */

import { getControl } from '../../store';
import { setOrCreateSource, ensureLayer, VISIBLE_FILTER } from './layer.helpers.js';

/**
 * Sets up military symbol layers on the map.
 * @param {Object} features - Feature collection with military symbols
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupMilitarySymbolsLayers(features, mapInstance) {
    const control = getControl('AddMilitarySymbolControl');
    const corrected = control
        ? control.applyZoomCorrections(features.military_symbols)
        : features.military_symbols;

    setOrCreateSource(mapInstance, 'military_symbols', corrected);

    ensureLayer(mapInstance, {
        id: 'military-symbols-layer',
        type: 'symbol',
        source: 'military_symbols',
        paint: {
            'icon-opacity': ['get', 'opacity'],
        },
        layout: {
            'icon-image': ['get', 'id'],
            'icon-size': ['get', 'calculatedSize'],
            'icon-rotate': ['get', 'rotation'],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
        filter: VISIBLE_FILTER,
    });
}

/**
 * Sets up coordination measure layers on the map.
 * @param {Object} features - Feature collection with coordination measures
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupCoordinationMeasureLayers(features, mapInstance) {
    const control = getControl('AddCoordinationMeasureControl');
    const raw = features.coordination_measures || [];
    const corrected = control && raw.length > 0
        ? control.applyZoomCorrections(raw)
        : raw;

    setOrCreateSource(mapInstance, 'coordination_measures', corrected);

    ensureLayer(mapInstance, {
        id: 'coordination-measures-layer',
        type: 'symbol',
        source: 'coordination_measures',
        paint: {
            'icon-opacity': ['get', 'opacity'],
        },
        layout: {
            'icon-image': ['get', 'id'],
            'icon-size': ['get', 'calculatedSize'],
            'icon-rotate': ['get', 'rotation'],
            'icon-anchor': [
                'coalesce',
                ['get', 'anchor'],
                'center',
            ],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
        filter: VISIBLE_FILTER,
    });
}

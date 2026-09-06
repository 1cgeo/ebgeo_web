// Path: js/layers/styles/symbol.layers.js

/**
 * @fileoverview Symbol layer styles (military symbols, coordination measures, declination diagrams).
 */

import { getControl } from '../../store';
import { zoomScaledExpression } from './zoom-expression.js';
import { ICON_OFFSET_EXPRESSION } from './icon-offset.expression.js';
import { setOrCreateSource, ensureLayer, VISIBLE_FILTER } from './layer.helpers.js';

// GPU-side zoom scaling (zoom-expression.js). Symbols and coordination measures
// default to size 1, the declination diagram to 0.6; all clamp at 10.
const SYMBOL_SIZE = { base: ['coalesce', ['get', 'size'], 1], anchor: 'createdAtZoom', disabledFlag: 'zoomCorrectionEnabled', maxValue: 10 };
const DECLINATION_SIZE = { base: ['coalesce', ['get', 'size'], 0.6], anchor: 'createdAtZoom', disabledFlag: 'zoomCorrectionEnabled', maxValue: 10 };

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
            'icon-size': zoomScaledExpression(SYMBOL_SIZE),
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
            'icon-size': zoomScaledExpression(SYMBOL_SIZE),
            'icon-rotate': ['get', 'rotation'],
            'icon-anchor': [
                'coalesce',
                ['get', 'anchor'],
                'center',
            ],
            // The bitmap is cropped to the drawing, whose centre is NOT the
            // point the measure anchors: the nucleus sits on its ELLIPSE
            // centre, with the echelon glyph and the identification text below
            // it. The generator writes that difference into `iconOffset`, in
            // icon pixels (`icon-size` 1, positive right/down).
            'icon-offset': ICON_OFFSET_EXPRESSION,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
        filter: VISIBLE_FILTER,
    });
}

/**
 * Sets up magnetic declination diagram layers on the map.
 * @param {Object} features - Feature collection with declination diagrams
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupDeclinationLayers(features, mapInstance) {
    const control = getControl('AddDeclinationControl');
    const raw = features.magnetic_declinations || [];
    const corrected = control && raw.length > 0
        ? control.applyZoomCorrections(raw)
        : raw;

    setOrCreateSource(mapInstance, 'magnetic_declinations', corrected);

    ensureLayer(mapInstance, {
        id: 'magnetic-declinations-layer',
        type: 'symbol',
        source: 'magnetic_declinations',
        paint: {
            'icon-opacity': ['get', 'opacity'],
        },
        layout: {
            'icon-image': ['get', 'id'],
            'icon-size': zoomScaledExpression(DECLINATION_SIZE),
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
        filter: VISIBLE_FILTER,
    });
}

// Path: js/azimuth_distance_tool/azimuth_distance_attributes_panel.js

/**
 * @fileoverview Attributes panel for editing existing azimuth/distance features.
 * Allows reconfiguration of polar construction parameters after creation.
 *
 * @module azimuth_distance_tool/azimuth_distance_attributes_panel
 */

import {
    createModernColorPicker,
    createModernSlider,
    createModernButtons,
    createSectionDivider
} from '@tools/helpers/index.js';

import {
    ANGULAR_UNIT,
    DISTANCE_UNIT,
    NORTH_REFERENCE,
    OUTPUT_MODE,
    OUTPUT_MODE_INFO
} from './azimuth_distance_constants.js';

import {
    formatTotalDistance,
    calculateTotalDistance
} from './azimuth_distance_geometry.js';

/** Same seed color the generated feature uses (azimuth_distance_geometry.js). */
const DEFAULT_STYLE_COLOR = '#16a34a';

// ============================================================================
// PANEL STATE (pure)
// ============================================================================

/**
 * Derives the style and polar state this panel renders from a feature's properties.
 *
 * Pure on purpose: it is the piece that has to agree with what the MapLibre paint actually reads
 * (`lineColor` / `lineWidth` / `opacity`, plus `fillColor` for the AREA polygon) and with where
 * `generateFeature` stores the polar construction data (`properties.azimuthDistanceData`, not the
 * top level). Both were wrong here — the panel wrote `stroke*` keys nothing paints and read the
 * polar fields off the top level, where they never live.
 *
 * @param {Object} props - Feature properties
 * @returns {{polar: Object, isArea: boolean, lineColor: string, lineWidth: number,
 *   opacity: number, fillColor: string}}
 */
export function getAzimuthDistanceStyleState(props) {
    const source = props || {};
    const polar = source.azimuthDistanceData || {};
    const isArea = polar.outputMode === OUTPUT_MODE.AREA;
    // Number.isFinite (not `??`) so a NaN/null width or opacity falls back instead of poisoning
    // the slider; 0 opacity is a legitimate value and must survive.
    return {
        polar,
        isArea,
        lineColor: source.lineColor || DEFAULT_STYLE_COLOR,
        lineWidth: Number.isFinite(source.lineWidth) ? source.lineWidth : (isArea ? 2 : 5),
        opacity: Number.isFinite(source.opacity) ? source.opacity : (isArea ? 0.5 : 0.7),
        fillColor: source.fillColor || DEFAULT_STYLE_COLOR,
    };
}

// ============================================================================
// ATTRIBUTES PANEL
// ============================================================================

/**
 * Add azimuth/distance attributes to panel.
 *
 * @param {HTMLElement} panel - Panel container
 * @param {Array<Object>} selectedFeatures - Selected features
 * @param {Object} control - Azimuth distance control instance
 * @param {Object} selectionManager - Selection manager
 * @param {Object} uiManager - UI manager
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.hideButtons=false] - Hide action buttons
 */
export function addAzimuthDistanceAttributesToPanel(
    panel,
    selectedFeatures,
    control,
    selectionManager,
    uiManager,
    options = {}
) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    const props = feature.properties;

    const initialPropertiesMap = new Map(
        selectedFeatures.map(f => [f.properties.id, { ...f.properties }])
    );

    const { polar, isArea, lineColor, lineWidth, opacity, fillColor } =
        getAzimuthDistanceStyleState(props);

    // Polar data and legs (single selection only)
    if (selectedFeatures.length === 1) {
        panel.appendChild(createSectionDivider('Dados Polares'));
        panel.appendChild(createPolarSummary(polar));

        if (polar.legs && polar.legs.length > 0) {
            panel.appendChild(createSectionDivider('Pernas'));
            panel.appendChild(createLegsReadOnly(polar));
        }
    }

    // Style section
    panel.appendChild(createSectionDivider('Estilo'));

    panel.appendChild(createModernColorPicker({
        label: 'Cor da Linha',
        value: lineColor,
        onChange: (color) => {
            control.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
        }
    }));

    panel.appendChild(createModernSlider({
        label: 'Espessura da Linha',
        min: 1,
        max: 10,
        step: 1,
        value: lineWidth,
        unit: 'px',
        onChange: (value) => {
            control.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
        }
    }));

    // Fill color for area mode. There is no `fillOpacity`: on the polygon layers `opacity` IS the
    // fill opacity (polygon.layers.js paints 'fill-opacity' from it), so the single slider below
    // covers both modes and only its label changes.
    if (isArea) {
        panel.appendChild(createModernColorPicker({
            label: 'Cor de Preenchimento',
            value: fillColor,
            onChange: (color) => {
                control.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
            }
        }));
    }

    panel.appendChild(createModernSlider({
        label: isArea ? 'Opacidade do Preenchimento' : 'Opacidade da Linha',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round(opacity * 100),
        unit: '%',
        onChange: (value) => {
            control.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: false,
        hidden: options.hideButtons
    }));
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

/**
 * Create polar data summary (read-only).
 *
 * @param {Object} props - Polar construction data (`properties.azimuthDistanceData`)
 * @returns {HTMLElement}
 */
function createPolarSummary(props) {
    const container = document.createElement('div');
    container.className = 'azd-polar-summary';

    if (props.referencePoint) {
        container.appendChild(createInfoRow(
            'Ponto de Refer\u00EAncia',
            `${props.referencePoint[1].toFixed(6)}, ${props.referencePoint[0].toFixed(6)}`
        ));
    }

    const modeInfo = OUTPUT_MODE_INFO[props.outputMode];
    if (modeInfo) {
        container.appendChild(createInfoRow('Modo', modeInfo.label));
    }

    const angUnit = props.angularUnit === ANGULAR_UNIT.MILS ? 'Mil\u00E9simos' : 'Graus';
    const distUnit = props.distanceUnit === DISTANCE_UNIT.KILOMETERS ? 'Quil\u00F4metros' : 'Metros';
    container.appendChild(createInfoRow('Unidades', `${angUnit} / ${distUnit}`));

    const northRef = props.northReference === NORTH_REFERENCE.MAGNETIC ? 'Norte Magn\u00E9tico' : 'Norte Verdadeiro';
    container.appendChild(createInfoRow('Norte', northRef));

    if (props.northReference === NORTH_REFERENCE.MAGNETIC) {
        const declSign = props.magneticDeclination >= 0 ? '+' : '';
        container.appendChild(createInfoRow('Declina\u00E7\u00E3o', `${declSign}${props.magneticDeclination}\u00B0`));
    }

    if (props.legs && props.legs.length > 0) {
        const total = calculateTotalDistance(props.legs);
        container.appendChild(createInfoRow('Dist\u00E2ncia Total', formatTotalDistance(total, props.distanceUnit)));
    }

    return container;
}

/**
 * Create info row for summary.
 *
 * @param {string} label - Label text
 * @param {string} value - Value text
 * @returns {HTMLElement}
 */
function createInfoRow(label, value) {
    const row = document.createElement('div');
    row.className = 'azd-info-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'azd-info-row__label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'azd-info-row__value';
    valueEl.textContent = value;

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
}

/**
 * Create read-only legs list.
 *
 * @param {Object} props - Polar construction data (`properties.azimuthDistanceData`)
 * @returns {HTMLElement}
 */
function createLegsReadOnly(props) {
    const container = document.createElement('div');
    container.className = 'azd-legs-readonly';

    const angLabel = props.angularUnit === ANGULAR_UNIT.MILS ? '\u20A5' : '\u00B0';
    const distLabel = props.distanceUnit === DISTANCE_UNIT.KILOMETERS ? 'km' : 'm';

    props.legs.forEach((leg, index) => {
        if (leg.azimuth === '' || leg.azimuth == null) return;

        const row = document.createElement('div');
        row.className = 'azd-legs-readonly__row';

        const badge = document.createElement('span');
        badge.className = 'azd-legs-readonly__badge';
        badge.textContent = index + 1;
        row.appendChild(badge);

        const azText = document.createElement('span');
        azText.className = 'azd-legs-readonly__text';
        azText.textContent = `Az: ${leg.azimuth}${angLabel}`;
        row.appendChild(azText);

        const distText = document.createElement('span');
        distText.className = 'azd-legs-readonly__text';
        distText.textContent = `Dist: ${leg.distance}${distLabel}`;
        row.appendChild(distText);

        if (leg.observation) {
            const obsText = document.createElement('span');
            obsText.className = 'azd-legs-readonly__obs';
            obsText.textContent = leg.observation;
            row.appendChild(obsText);
        }

        container.appendChild(row);
    });

    return container;
}

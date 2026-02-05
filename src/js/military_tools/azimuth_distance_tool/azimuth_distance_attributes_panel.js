// Path: js/military_tools/azimuth_distance_tool/azimuth_distance_attributes_panel.js

/**
 * @fileoverview Attributes panel for editing existing azimuth/distance features.
 * Allows reconfiguration of polar construction parameters after creation.
 *
 * @module military_tools/azimuth_distance_tool/azimuth_distance_attributes_panel
 */

import {
    createModernColorPicker,
    createModernSlider,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

import {
    ANGULAR_UNIT,
    DISTANCE_UNIT,
    NORTH_REFERENCE,
    OUTPUT_MODE,
    OUTPUT_MODE_INFO,
    COLORS
} from './azimuth_distance_constants.js';

import {
    convertAzimuth,
    convertDistance,
    calculateContraAzimuth,
    formatTotalDistance,
    calculateTotalDistance
} from './azimuth_distance_geometry.js';

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
 * @param {boolean} [options.hideHeader=false] - Hide header
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

    // Header
    if (!options.hideHeader) {
        if (selectedFeatures.length === 1) {
            const headerComponent = createFeatureHeaderWithOptions(
                props.nome || 'Azimute e Distância',
                (newName) => {
                    control.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                    uiManager.updateSelectionHighlight();
                },
                selectedFeatures,
                selectionManager,
                uiManager
            );
            panel.appendChild(headerComponent);
        } else {
            const multiSelectHeader = document.createElement('div');
            multiSelectHeader.className = 'feature-header-with-options';

            const infoText = document.createElement('div');
            infoText.className = 'feature-name-wrapper';
            infoText.style.cssText = 'font-size: 14px; color: #666; padding: 6px;';
            infoText.textContent = `${selectedFeatures.length} features selecionadas`;

            const optionsButton = createFeatureOptionsButton(
                selectedFeatures,
                selectionManager,
                uiManager
            );

            multiSelectHeader.appendChild(infoText);
            multiSelectHeader.appendChild(optionsButton);
            panel.appendChild(multiSelectHeader);
        }
    }

    // Only show full editor for single selection
    if (selectedFeatures.length === 1) {
        // Polar Data Section (read-only summary)
        panel.appendChild(createSectionDivider('Dados Polares'));
        panel.appendChild(createPolarSummary(props));

        // Legs summary
        if (props.legs && props.legs.length > 0) {
            panel.appendChild(createSectionDivider('Pernas'));
            panel.appendChild(createLegsReadOnly(props));
        }
    }

    // Style section
    panel.appendChild(createSectionDivider('Estilo'));

    // Stroke color
    panel.appendChild(createModernColorPicker({
        label: 'Cor da Linha',
        value: props.strokeColor || '#16a34a',
        onChange: (color) => {
            control.updateFeaturesProperty(selectedFeatures, 'strokeColor', color);
        }
    }));

    // Stroke width
    panel.appendChild(createModernSlider({
        label: 'Espessura da Linha',
        min: 1,
        max: 10,
        step: 1,
        value: props.strokeWidth || 2,
        unit: 'px',
        onChange: (value) => {
            control.updateFeaturesProperty(selectedFeatures, 'strokeWidth', value);
        }
    }));

    // Stroke opacity
    panel.appendChild(createModernSlider({
        label: 'Opacidade da Linha',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((props.strokeOpacity ?? 1) * 100),
        unit: '%',
        onChange: (value) => {
            control.updateFeaturesProperty(selectedFeatures, 'strokeOpacity', value / 100);
        }
    }));

    // Fill options for area mode
    if (props.outputMode === OUTPUT_MODE.AREA) {
        panel.appendChild(createModernColorPicker({
            label: 'Cor de Preenchimento',
            value: props.fillColor || '#16a34a',
            onChange: (color) => {
                control.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
            }
        }));

        panel.appendChild(createModernSlider({
            label: 'Opacidade do Preenchimento',
            min: 0,
            max: 100,
            step: 1,
            value: Math.round((props.fillOpacity ?? 0.15) * 100),
            unit: '%',
            onChange: (value) => {
                control.updateFeaturesProperty(selectedFeatures, 'fillOpacity', value / 100);
            }
        }));
    }

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
 * @param {Object} props - Feature properties
 * @returns {HTMLElement}
 */
function createPolarSummary(props) {
    const container = document.createElement('div');
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: ${COLORS.gray50};
        border-radius: 6px;
        font-size: 13px;
    `;

    // Reference point
    if (props.referencePoint) {
        const refRow = createInfoRow(
            'Ponto de Referência',
            `${props.referencePoint[1].toFixed(6)}, ${props.referencePoint[0].toFixed(6)}`
        );
        container.appendChild(refRow);
    }

    // Output mode
    const modeInfo = OUTPUT_MODE_INFO[props.outputMode];
    if (modeInfo) {
        container.appendChild(createInfoRow('Modo', modeInfo.label));
    }

    // Units
    const angUnit = props.angularUnit === ANGULAR_UNIT.MILS ? 'Milésimos' : 'Graus';
    const distUnit = props.distanceUnit === DISTANCE_UNIT.KILOMETERS ? 'Quilômetros' : 'Metros';
    container.appendChild(createInfoRow('Unidades', `${angUnit} / ${distUnit}`));

    // North reference
    const northRef = props.northReference === NORTH_REFERENCE.MAGNETIC ? 'Norte Magnético' : 'Norte Verdadeiro';
    container.appendChild(createInfoRow('Norte', northRef));

    // Declination
    if (props.northReference === NORTH_REFERENCE.MAGNETIC) {
        const declSign = props.magneticDeclination >= 0 ? '+' : '';
        container.appendChild(createInfoRow('Declinação', `${declSign}${props.magneticDeclination}°`));
    }

    // Total distance
    if (props.legs && props.legs.length > 0) {
        const total = calculateTotalDistance(props.legs, props.distanceUnit);
        container.appendChild(createInfoRow('Distância Total', formatTotalDistance(total, props.distanceUnit)));
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
    row.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

    const labelEl = document.createElement('span');
    labelEl.style.cssText = `color: ${COLORS.gray600}; font-weight: 500;`;
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.style.cssText = `color: ${COLORS.gray900}; font-weight: 600;`;
    valueEl.textContent = value;

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
}

/**
 * Create read-only legs list.
 *
 * @param {Object} props - Feature properties
 * @returns {HTMLElement}
 */
function createLegsReadOnly(props) {
    const container = document.createElement('div');
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 200px;
        overflow-y: auto;
    `;

    const angUnit = props.angularUnit;
    const distUnit = props.distanceUnit;
    const angLabel = angUnit === ANGULAR_UNIT.MILS ? '₥' : '°';
    const distLabel = distUnit === DISTANCE_UNIT.KILOMETERS ? 'km' : 'm';

    props.legs.forEach((leg, index) => {
        if (leg.azimuth === '' || leg.azimuth == null) return;

        const row = document.createElement('div');
        row.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: ${COLORS.gray50};
            border-radius: 6px;
            font-size: 13px;
        `;

        // Number badge
        const badge = document.createElement('span');
        badge.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            background: ${COLORS.primary600};
            color: white;
            border-radius: 50%;
            font-size: 11px;
            font-weight: 600;
            flex-shrink: 0;
        `;
        badge.textContent = index + 1;
        row.appendChild(badge);

        // Azimuth
        const azText = document.createElement('span');
        azText.style.cssText = `flex: 1; color: ${COLORS.gray700};`;
        azText.textContent = `Az: ${leg.azimuth}${angLabel}`;
        row.appendChild(azText);

        // Distance
        const distText = document.createElement('span');
        distText.style.cssText = `flex: 1; color: ${COLORS.gray700};`;
        distText.textContent = `Dist: ${leg.distance}${distLabel}`;
        row.appendChild(distText);

        // Observation
        if (leg.observation) {
            const obsText = document.createElement('span');
            obsText.style.cssText = `
                padding: 2px 6px;
                background: ${COLORS.amber100};
                color: ${COLORS.amber600};
                border-radius: 4px;
                font-size: 11px;
                font-weight: 500;
            `;
            obsText.textContent = leg.observation;
            row.appendChild(obsText);
        }

        container.appendChild(row);
    });

    return container;
}

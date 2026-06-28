// Path: js/analysis_tools/visibility_tool/visibility_attributes_panel.js

import {
    createModernSlider,
    createModernButtons,
    createSectionDivider
} from '@tools/helpers/index.js';

/**
 * Create visibility parameters panel content (for Parameters tab).
 * All sliders are terrain-dependent and trigger recalculation via control.updateFeaturesProperty().
 * @param {HTMLElement} container - Container to add parameters to
 * @param {Array} selectedFeatures - Selected visibility features
 * @param {Object} visibilityControl - Visibility control instance
 */
export function addVisibilityParametersToPanel(container, selectedFeatures, visibilityControl) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    const props = visibilityControl.geometry.normalizeFeatureProperties(feature.properties);
    const isTerrainAvailable = visibilityControl.geometry.isTerrainAvailable(visibilityControl.map);
    const disabledMessage = 'Ative o terreno para modificar este parâmetro';

    const terrainDependentSliders = [];

    container.appendChild(createSectionDivider('Geometria'));

    const radiusSlider = createModernSlider({
        label: 'Raio',
        min: 100,
        max: 100000,
        step: 100,
        value: props.radius || 5000,
        unit: 'm',
        disabled: !isTerrainAvailable,
        disabledMessage,
        onChange: (value) => {
            visibilityControl.updateFeaturesProperty(selectedFeatures, 'radius', value);
        }
    });
    terrainDependentSliders.push(radiusSlider);
    container.appendChild(radiusSlider);

    const apertureSlider = createModernSlider({
        label: 'Abertura',
        min: 1,
        max: 359,
        step: 1,
        value: props.aperture || 60,
        unit: '\u00B0',
        disabled: !isTerrainAvailable,
        disabledMessage,
        onChange: (value) => {
            visibilityControl.updateFeaturesProperty(selectedFeatures, 'aperture', value);
        }
    });
    terrainDependentSliders.push(apertureSlider);
    container.appendChild(apertureSlider);

    container.appendChild(createSectionDivider('Alturas'));

    const observerSlider = createModernSlider({
        label: 'Altura do Observador',
        min: 0,
        max: 50,
        step: 0.1,
        value: props.observerHeight ?? 2,
        unit: 'm',
        disabled: !isTerrainAvailable,
        disabledMessage,
        onChange: (value) => {
            visibilityControl.updateFeaturesProperty(selectedFeatures, 'observerHeight', value);
        }
    });
    terrainDependentSliders.push(observerSlider);
    container.appendChild(observerSlider);

    const targetSlider = createModernSlider({
        label: 'Altura do Alvo',
        min: 0,
        max: 50,
        step: 0.1,
        value: props.targetHeight ?? 0,
        unit: 'm',
        disabled: !isTerrainAvailable,
        disabledMessage,
        onChange: (value) => {
            visibilityControl.updateFeaturesProperty(selectedFeatures, 'targetHeight', value);
        }
    });
    terrainDependentSliders.push(targetSlider);
    container.appendChild(targetSlider);

    const onTerrainChange = () => {
        const terrainActive = visibilityControl.geometry.isTerrainAvailable(visibilityControl.map);
        for (const slider of terrainDependentSliders) {
            if (slider.setDisabled) {
                slider.setDisabled(!terrainActive, disabledMessage);
            }
        }
    };

    visibilityControl.map.on('terrain', onTerrainChange);

    const previousCleanup = container._parametersCleanup;
    container._parametersCleanup = () => {
        visibilityControl.map.off('terrain', onTerrainChange);
        if (previousCleanup) previousCleanup();
    };
}

/**
 * Create visibility attributes panel for selected visibility features (Style tab).
 * @param {HTMLElement} panel - Container element for attributes
 * @param {Array} selectedFeatures - Array of selected visibility features
 * @param {Object} visibilityControl - Visibility control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideButtons=false] - Whether to hide save/discard buttons
 */
export function addVisibilityAttributesToPanel(panel, selectedFeatures, visibilityControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity || 1) * 100),
        unit: '%',
        onChange: (value) => {
            visibilityControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: visibilityControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: false,
        onSetDefault: null,
        hidden: options.hideButtons
    }));
}

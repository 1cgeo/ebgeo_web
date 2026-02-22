// Path: js/analysis_tools/visibility_tool/visibility_attributes_panel.js

import {
    createModernSlider,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

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

    // Collect sliders for reactive terrain toggle
    const terrainDependentSliders = [];

    // --- Geometry section ---
    container.appendChild(createSectionDivider('Geometria'));

    // Radius slider
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

    // Aperture slider
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

    // --- Heights section ---
    container.appendChild(createSectionDivider('Alturas'));

    // Observer height slider
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

    // Target height slider
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

    // Reactively update slider disabled state when terrain is toggled
    const onTerrainChange = () => {
        const terrainActive = visibilityControl.geometry.isTerrainAvailable(visibilityControl.map);
        for (const slider of terrainDependentSliders) {
            if (slider.setDisabled) {
                slider.setDisabled(!terrainActive, disabledMessage);
            }
        }
    };

    visibilityControl.map.on('terrain', onTerrainChange);

    // Store cleanup on the container so it can be called when the panel is destroyed
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
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 * @param {boolean} [options.hideButtons=false] - Whether to hide save/discard buttons
 */
export function addVisibilityAttributesToPanel(panel, selectedFeatures, visibilityControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // Only show header if not hidden (for sidebar integration)
    if (!options.hideHeader) {
        if (selectedFeatures.length === 1) {
            const headerComponent = createFeatureHeaderWithOptions(
                feature.properties.nome,
                (newName) => {
                    visibilityControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                    uiManager.updateSelectionHighlight();
                },
                selectedFeatures,
                selectionManager,
                uiManager
            );
            panel.appendChild(headerComponent);
        } else if (selectedFeatures.length > 1) {
            const multiSelectHeader = document.createElement('div');
            multiSelectHeader.className = 'feature-header-with-options';

            const infoText = document.createElement('div');
            infoText.className = 'feature-name-wrapper';
            infoText.style.cssText = 'font-size: 14px; color: #666; padding: 6px;';
            infoText.textContent = `${selectedFeatures.length} áreas de visibilidade selecionadas`;

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

    // Opacity slider
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

    // Action buttons
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

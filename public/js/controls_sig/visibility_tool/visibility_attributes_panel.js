// Path: js/controls_sig/visibility_tool/visibility_attributes_panel.js

import {
    createSliderWithInput,
    createAttributeRow,
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

/**
 * Create visibility attributes panel for selected visibility features
 * @param {HTMLElement} panel - Container element for attributes
 * @param {Array} selectedFeatures - Array of selected visibility features
 * @param {Object} visibilityControl - Visibility control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 */
export function addVisibilityAttributesToPanel(panel, selectedFeatures, visibilityControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

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
        infoText.textContent = `${selectedFeatures.length} áreas de visibilidade selecionados`;

        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );

        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        panel.appendChild(multiSelectHeader);
    }

    let observerHeightDebounceTimer = null;

    const debouncedRecalculate = () => {
        clearTimeout(observerHeightDebounceTimer);
        observerHeightDebounceTimer = setTimeout(() => {
            visibilityControl.updateFeatures(selectedFeatures, false, false, true);
        }, 500);
    };

    const observerHeightControl = createSliderWithInput({
        min: 1,
        max: 20,
        step: 0.5,
        value: feature.properties.observerHeight || 2,
        onChange: (value) => {
            visibilityControl.updateFeaturesProperty(selectedFeatures, 'observerHeight', value);
            uiManager.updateSelectionHighlight();

            debouncedRecalculate();
        },
        onBlur: (value) => {
            clearTimeout(observerHeightDebounceTimer);
            visibilityControl.updateFeatures(selectedFeatures, false, false, true);
        }
    });

    panel.appendChild(createAttributeRow('Altura do Observador (m):', observerHeightControl));

    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round(feature.properties.opacity * 100), {
        onChange: (value) => {
            visibilityControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    panel.appendChild(createAttributeRow('Opacidade:', opacityControl));

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'attr-container-row';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        clearTimeout(observerHeightDebounceTimer);
        visibilityControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    discardButton.onclick = () => {
        clearTimeout(observerHeightDebounceTimer);
        visibilityControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    buttonContainer.appendChild(saveButton);
    buttonContainer.appendChild(discardButton);
    panel.appendChild(buttonContainer);
}

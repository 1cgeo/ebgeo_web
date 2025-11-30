// Path: src/js/controls_sig/brush_tool/brush_attributes_panel.js

import {
    createSliderWithInput,
    createColorPicker,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

/**
 * Create and populate brush attributes panel with controls
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected brush features
 * @param {Object} brushControl - Brush control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 */
export function addBrushAttributesToPanel(panel, selectedFeatures, brushControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                brushControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} pincéis selecionados`;

        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );

        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        panel.appendChild(multiSelectHeader);
    }

    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        brushControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor do pincel');

    panel.appendChild(createAttributeRow('Cor:', lineColorInput));
    const lineWidthControl = createSliderWithInput({
        min: 1,
        max: 50,
        step: 1,
        value: feature.properties.lineWidth || 10,
        onChange: (value) => {
            brushControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    });

    panel.appendChild(createAttributeRow('Largura (px):', lineWidthControl));

    const createdAtZoomControl = createSliderWithInput({
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round(feature.properties.createdAtZoom * 10) / 10,
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            brushControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
            uiManager.updateSelectionHighlight();
        }
    });

    panel.appendChild(createAttributeRow('Zoom de referência:', createdAtZoomControl));

    const buttons = createStandardButtons({
        selectedFeatures,
        control: brushControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => brushControl.setDefaultProperties(feature.properties)
    });

    panel.appendChild(buttons);
}

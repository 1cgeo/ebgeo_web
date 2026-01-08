// Path: js/controls_sig/arrow_tool/arrow_attributes_panel.js

import {
    createSliderWithInput,
    createNumericInput,
    createColorPicker,
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

/**
 * Create and populate arrow attributes panel with controls
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected arrow features
 * @param {Object} arrowControl - Arrow control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 */
export function addArrowAttributesToPanel(panel, selectedFeatures, arrowControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                arrowControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} setas selecionados`;

        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );

        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        panel.appendChild(multiSelectHeader);
    }

    const widthInput = createNumericInput({
        min: 10,
        max: 10000,
        step: 1,
        value: Math.round(feature.properties.width || 500),
        suffix: ' m',
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'width', value);
            uiManager.updateSelectionHighlight();
        }
    });

    panel.appendChild(createAttributeRow('Largura:', widthInput));

    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor de preenchimento da seta');

    panel.appendChild(createAttributeRow('Preenchimento:', fillColorInput));

    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da borda da seta');

    panel.appendChild(createAttributeRow('Borda:', lineColorInput));

    const setDefaultIfMissing = (value, defaultValue) => {
        return (value !== null && value !== undefined) ? value : defaultValue;
    };

    const fillOpacityControl = createSliderWithInput({
        min: 0,
        max: 100,
        step: 1,
        value: Math.round(setDefaultIfMissing(feature.properties.fillOpacity, 0.8) * 100),
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'fillOpacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    });

    panel.appendChild(createAttributeRow('Opacidade do preenchimento:', fillOpacityControl));

    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 3, {
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    panel.appendChild(createAttributeRow('Largura da borda (px):', lineWidthControl));

    const airmobileCheckbox = createCheckbox(feature.properties.airmobile || false, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'airmobile', e.target.checked);
        uiManager.updateSelectionHighlight();
    });

    panel.appendChild(createAttributeRow('Aeromóvel / Aeroterrestre:', airmobileCheckbox));

    const showArrowHeadCheckbox = createCheckbox(feature.properties.showArrowHead !== false, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'showArrowHead', e.target.checked);
        uiManager.updateSelectionHighlight();
    });

    panel.appendChild(createAttributeRow('Seta:', showArrowHeadCheckbox));

    const buttons = createStandardButtons({
        selectedFeatures,
        control: arrowControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => arrowControl.setDefaultProperties(feature.properties)
    });

    panel.appendChild(buttons);
}

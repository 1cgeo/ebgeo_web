// Path: src/js/controls_sig/draw_tools/line_attributes_panel.js

import {
    createSliderWithInput,
    createColorPicker,
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    createLineStyleSelect,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

/**
 * Add line attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected line features
 * @param {Object} lineControl - Line control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 */
export function addLineAttributesToPanel(panel, selectedFeatures, lineControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                lineControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} linhas selecionados`;

        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );

        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        panel.appendChild(multiSelectHeader);
    }

    const colorInput = createColorPicker(feature.properties.color, (e) => {
        lineControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    });
    panel.appendChild(createAttributeRow('Cor:', colorInput));

    const sizeSlider = createSliderWithInput({
        min: 1,
        max: 15,
        step: 1,
        value: feature.properties.size || 7,
        onChange: (newValue) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'size', newValue);
        }
    });
    panel.appendChild(createAttributeRow('Largura:', sizeSlider));

    const lineStyleSelect = createLineStyleSelect(
        feature.properties.lineStyle || 'solid',
        (newValue) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
        }
    );
    panel.appendChild(createAttributeRow('Estilo da linha:', lineStyleSelect));

    const opacitySlider = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.7) * 100), {
        onChange: (newValue) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
        }
    }));
    panel.appendChild(createAttributeRow('Opacidade:', opacitySlider));

    const measureCheckbox = createCheckbox(
        feature.properties.measure === true,
        (e) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'measure', e.target.checked);
        }
    );
    panel.appendChild(createAttributeRow('Medir:', measureCheckbox));

    if (selectedFeatures.length === 1) {
        const profileCheckbox = createCheckbox(
            feature.properties.profile === true,
            (e) => {
                lineControl.updateFeaturesProperty(selectedFeatures, 'profile', e.target.checked);
                if (e.target.checked) {
                    selectionManager.updateProfile();
                }
            }
        );
        panel.appendChild(createAttributeRow('Perfil do terreno:', profileCheckbox));
    }

    const buttons = createStandardButtons({
        selectedFeatures,
        control: lineControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => lineControl.setDefaultProperties(feature.properties)
    });

    panel.appendChild(buttons);
}

// Path: js/military_tools/occupied_front_tool/occupied_front_attributes_panel.js

import {
    createSliderWithInput,
    createColorPicker,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    getCommonConfig
} from '../../tool_manager/helpers/index.js';

export function addOccupiedFrontAttributesToPanel(panel, selectedFeatures, occupiedFrontControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));


    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                occupiedFrontControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} frentes ocupadas selecionados`;

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
        occupiedFrontControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da frente ocupada');

    panel.appendChild(createAttributeRow('Cor:', colorInput));

    // Espessura da linha
    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 4, {
        onChange: (value) => {
            occupiedFrontControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    panel.appendChild(createAttributeRow('Espessura (px):', lineWidthControl));

    // Opacity (0-100% with automatic conversion)
    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity || 1.0) * 100), {
        onChange: (value) => {
            // Convert from 0-100 range to 0-1 range for internal storage
            occupiedFrontControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    panel.appendChild(createAttributeRow('Opacidade:', opacityControl));

    const buttons = createStandardButtons({
        selectedFeatures,
        control: occupiedFrontControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => occupiedFrontControl.setDefaultProperties({
            color: feature.properties.color,
            lineWidth: feature.properties.lineWidth,
            opacity: feature.properties.opacity
        })
    });

    panel.appendChild(buttons);
}

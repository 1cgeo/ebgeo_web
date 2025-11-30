// Path: js/controls_sig/image_tool/image_attributes_panel.js

import {
    createSliderWithInput,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addImageAttributesToPanel(panel, selectedFeatures, imageControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));
    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                imageControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            },
            selectedFeatures,
            selectionManager,
            uiManager
        );
        $(panel).append(headerComponent);
    } else if (selectedFeatures.length > 1) {
        const multiSelectHeader = document.createElement('div');
        multiSelectHeader.className = 'feature-header-with-options';
        
        const infoText = document.createElement('div');
        infoText.className = 'feature-name-wrapper';
        infoText.style.cssText = 'font-size: 14px; color: #666; padding: 6px;';
        infoText.textContent = `${selectedFeatures.length} imagens selecionados`;
        
        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );
        
        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        $(panel).append(multiSelectHeader);
    }

    // ===== PROPRIEDADES ESPECÍFICAS DA IMAGEM =====

    // Size
    const sizeControl = createSliderWithInput(getCommonConfig('size',
        feature.properties.size, {
        onChange: (value) => {
            imageControl.updateFeaturesProperty(selectedFeatures, 'size', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Tamanho:', sizeControl));
    const createdAtZoomControl = createSliderWithInput({
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round(feature.properties.createdAtZoom * 10) / 10,
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            imageControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Zoom de referência:', createdAtZoomControl));
    const rotationControl = createSliderWithInput(getCommonConfig('rotation',
        feature.properties.rotation || 0, {
        onChange: (value) => {
            imageControl.updateFeaturesProperty(selectedFeatures, 'rotation', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Rotação:', rotationControl));

    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round(feature.properties.opacity * 100), {
        onChange: (value) => {
            imageControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    const buttons = createStandardButtons({
        selectedFeatures,
        control: imageControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: false,
        onSetDefault: null
    });

    $(panel).append(buttons);
}
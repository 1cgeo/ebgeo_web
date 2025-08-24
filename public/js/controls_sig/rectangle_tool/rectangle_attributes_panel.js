// Path: js\controls_sig\rectangle_tool\rectangle_attributes_panel.js

import {
    createSliderWithInput,
    createColorPicker,
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addRectangleAttributesToPanel(panel, selectedFeatures, rectangleControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                rectangleControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== PROPRIEDADES ESPECÍFICAS DO RETÂNGULO =====

    // Cor da linha
    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha do retângulo');

    $(panel).append(createAttributeRow('Linha:', lineColorInput));

    // Cor do preenchimento
    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        rectangleControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor do preenchimento do retângulo');

    $(panel).append(createAttributeRow('Preenchimento:', fillColorInput));

    // Opacidade (0-100% com conversão automática)
    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity || 0.7) * 100), {
        onChange: (value) => {
            // Convert from 0-100 range to 0-1 range for internal storage
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    // Largura da linha
    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 2, {
        onChange: (value) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Largura (px):', lineWidthControl));

    // Dimensões (somente informativo)
    const widthValue = document.createElement('span');
    widthValue.textContent = `${Math.round(feature.properties.width || 100)} m`;
    widthValue.style.cssText = 'font-size: 13px; color: #666; font-weight: 500; margin-right: 10px;';

    const heightValue = document.createElement('span');
    heightValue.textContent = `${Math.round(feature.properties.height || 100)} m`;
    heightValue.style.cssText = 'font-size: 13px; color: #666; font-weight: 500;';

    const dimensionsContainer = document.createElement('div');
    dimensionsContainer.appendChild(widthValue);
    dimensionsContainer.appendChild(heightValue);

    $(panel).append(createAttributeRow('Dimensões:', dimensionsContainer));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    const buttons = createStandardButtons({
        selectedFeatures,
        control: rectangleControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => rectangleControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}
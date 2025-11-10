// Path: js\controls_sig\circle_tool\circle_attributes_panel.js

import {
    createSliderWithInput,
    createColorPicker,
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addCircleAttributesToPanel(panel, selectedFeatures, circleControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                circleControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== PROPRIEDADES ESPECÍFICAS DO CÍRCULO =====

    // Cor da linha
    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        circleControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha do círculo');

    $(panel).append(createAttributeRow('Linha:', lineColorInput));

    // Cor do preenchimento
    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        circleControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor do preenchimento do círculo');

    $(panel).append(createAttributeRow('Preenchimento:', fillColorInput));

    // Opacidade (0-100% com conversão automática)
    const opacityControl = createSliderWithInput(getCommonConfig('complete_opacity',
        Math.round((feature.properties.opacity || 0.7) * 100), {
        onChange: (value) => {
            // Convert from 0-100 range to 0-1 range for internal storage
            circleControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    // Largura da linha
    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 2, {
        onChange: (value) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Largura (px):', lineWidthControl));

    // Raio (somente informativo)
    const radiusValue = document.createElement('span');
    radiusValue.textContent = `${Math.round(feature.properties.radius || 1000)} m`;
    radiusValue.style.cssText = 'font-size: 13px; color: #666; font-weight: 500;';

    $(panel).append(createAttributeRow('Raio:', radiusValue));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    const buttons = createStandardButtons({
        selectedFeatures,
        control: circleControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => circleControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}
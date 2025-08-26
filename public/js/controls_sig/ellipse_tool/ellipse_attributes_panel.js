// Path: js\controls_sig\ellipse_tool\ellipse_attributes_panel.js

import { 
    createSliderWithInput, 
    createColorPicker, 
    createAttributeRow, 
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addEllipseAttributesToPanel(panel, selectedFeatures, ellipseControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    
    // ✅ CORRECT: Capture initial properties at panel opening (before any user interaction)
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                ellipseControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== PROPRIEDADES ESPECÍFICAS DA ELIPSE =====

    // Cor da linha
    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        ellipseControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha da elipse');

    $(panel).append(createAttributeRow('Linha:', lineColorInput));

    // Cor do preenchimento
    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        ellipseControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor do preenchimento da elipse');

    $(panel).append(createAttributeRow('Preenchimento:', fillColorInput));

    // Opacidade (0-100% com conversão automática)
    const opacityControl = createSliderWithInput(getCommonConfig('complete_opacity',
        Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.7) * 100), {
        onChange: (value) => {
            // Convert from 0-100 range to 0-1 range for internal storage
            ellipseControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    // Largura da linha
    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 2, {
        onChange: (value) => {
            ellipseControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Largura (px):', lineWidthControl));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    // ✅ FIXED: Pass initialPropertiesMap captured at panel opening
    const buttons = createStandardButtons({
        selectedFeatures,
        control: ellipseControl,
        selectionManager,
        initialPropertiesMap, // ✅ PASS THE ORIGINAL STATE
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => ellipseControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}
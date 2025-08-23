// Path: js\controls_sig\image_tool\image_attributes_panel.js

import { 
    createSliderWithInput, 
    createAttributeRow, 
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addImageAttributesToPanel(panel, selectedFeatures, imageControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    
    // ✅ CORRECT: Capture initial properties at panel opening (before any user interaction)
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                imageControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== PROPRIEDADES ESPECÍFICAS DA IMAGEM =====

    // Tamanho
    const sizeControl = createSliderWithInput(getCommonConfig('size',
        feature.properties.size, {
        onChange: (value) => {
            imageControl.updateFeaturesProperty(selectedFeatures, 'size', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Tamanho:', sizeControl));

    // Rotação
    const rotationControl = createSliderWithInput(getCommonConfig('rotation',
        feature.properties.rotation || 0, {
        onChange: (value) => {
            imageControl.updateFeaturesProperty(selectedFeatures, 'rotation', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Rotação:', rotationControl));

    // Opacidade (0-100% com conversão automática)
    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round(feature.properties.opacity * 100), {
        onChange: (value) => {
            // Convert from 0-100 range to 0-1 range for internal storage
            imageControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    // ✅ FIXED: Pass initialPropertiesMap captured at panel opening
    // ⚠️ NOTE: Image tool doesn't have "Set Default" button (hasSetDefault: false)
    const buttons = createStandardButtons({
        selectedFeatures,
        control: imageControl,
        selectionManager,
        initialPropertiesMap, // ✅ PASS THE ORIGINAL STATE
        hasSetDefault: false, // ✅ Image tool doesn't have "Set Default" functionality
        onSetDefault: null
    });

    $(panel).append(buttons);
}
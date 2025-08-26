// Path: js\controls_sig\draw_tools\point_attributes_panel.js

import { 
    createSliderWithInput, 
    createColorPicker, 
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addPointAttributesToPanel(panel, selectedFeatures, pointControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form.
    
    // Capture initial properties at panel opening
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                pointControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== ATRIBUTOS ESPECÍFICOS DE PONTO =====
    
    // Cor
    const colorInput = createColorPicker(feature.properties.color, (e) => {
        pointControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    });
    $(panel).append(createAttributeRow('Cor:', colorInput));

    // Tamanho
    const sizeSlider = createSliderWithInput({
        min: 6,
        max: 20,
        step: 1,
        value: feature.properties.size || 10,
        onChange: (newValue) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'size', newValue);
        }
    });
    $(panel).append(createAttributeRow('Tamanho:', sizeSlider));

    // Opacidade
    const opacitySlider = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 1) * 100), {
        onChange: (newValue) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
        }
    }));
    $(panel).append(createAttributeRow('Opacidade:', opacitySlider));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    const buttons = createStandardButtons({
        selectedFeatures,
        control: pointControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => pointControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}
// Path: js/controls_sig/draw_tools/line_attributes_panel.js

import { 
    createSliderWithInput, 
    createColorPicker, 
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addLineAttributesToPanel(panel, selectedFeatures, lineControl, selectionManager, uiManager) {
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
                lineControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== ATRIBUTOS ESPECÍFICOS DE LINHA =====
    
    // Cor
    const colorInput = createColorPicker(feature.properties.color, (e) => {
        lineControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    });
    $(panel).append(createAttributeRow('Cor:', colorInput));

    // Largura
    const sizeSlider = createSliderWithInput({
        min: 1,
        max: 15,
        step: 1,
        value: feature.properties.size || 7,
        onChange: (newValue) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'size', newValue);
        }
    });
    $(panel).append(createAttributeRow('Largura:', sizeSlider));

    // Opacidade
    const opacitySlider = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.7) * 100), {
        onChange: (newValue) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
        }
    }));
    $(panel).append(createAttributeRow('Opacidade:', opacitySlider));

    // Medição
    const measureCheckbox = createCheckbox(
        feature.properties.measure === true, // default false
        (e) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'measure', e.target.checked);
        }
    );
    $(panel).append(createAttributeRow('Medir:', measureCheckbox));

    // Perfil do terreno (apenas para seleção única)
    if (selectedFeatures.length === 1) {
        const profileCheckbox = createCheckbox(
            feature.properties.profile === true, // default false
            (e) => {
                lineControl.updateFeaturesProperty(selectedFeatures, 'profile', e.target.checked);
                if (e.target.checked) {
                    selectionManager.updateProfile();
                }
            }
        );
        $(panel).append(createAttributeRow('Perfil do terreno:', profileCheckbox));
    }

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    const buttons = createStandardButtons({
        selectedFeatures,
        control: lineControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => lineControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}
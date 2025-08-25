// Path: js/controls_sig/draw_tools/polygon_attributes_panel.js

import { 
    createSliderWithInput, 
    createColorPicker, 
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addPolygonAttributesToPanel(panel, selectedFeatures, polygonControl, selectionManager, uiManager) {
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
                polygonControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== ATRIBUTOS ESPECÍFICOS DE POLÍGONO =====
    
    // Cor de preenchimento
    const fillColorInput = createColorPicker(feature.properties.color, (e) => {
        polygonControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    });
    $(panel).append(createAttributeRow('Cor de preenchimento:', fillColorInput));

    // Cor da borda
    const outlineColorInput = createColorPicker(feature.properties.outlinecolor, (e) => {
        polygonControl.updateFeaturesProperty(selectedFeatures, 'outlinecolor', e.target.value);
    });
    $(panel).append(createAttributeRow('Cor da borda:', outlineColorInput));

    // Opacidade do preenchimento
    const fillOpacitySlider = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.5) * 100), {
        onChange: (newValue) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
        }
    }));
    $(panel).append(createAttributeRow('Opacidade preenchimento:', fillOpacitySlider));

    // Largura da borda
    const borderSizeSlider = createSliderWithInput({
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.size || 3,
        onChange: (newValue) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'size', newValue);
        }
    });
    $(panel).append(createAttributeRow('Largura da borda:', borderSizeSlider));

    // Medição
    const measureCheckbox = createCheckbox(
        feature.properties.measure === true, // default false
        (e) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'measure', e.target.checked);
        }
    );
    $(panel).append(createAttributeRow('Medir:', measureCheckbox));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    const buttons = createStandardButtons({
        selectedFeatures,
        control: polygonControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => polygonControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}
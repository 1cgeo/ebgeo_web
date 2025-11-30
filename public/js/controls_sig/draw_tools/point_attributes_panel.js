// Path: js\controls_sig\draw_tools\point_attributes_panel.js

import { 
    createSliderWithInput, 
    createColorPicker, 
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    createCoordinateEditor,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addPointAttributesToPanel(panel, selectedFeatures, pointControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form.
    
    // Capture initial properties at panel opening
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== HEADER COM NOME EDITÁVEL + BOTÃO DE OPÇÕES =====
    if (selectedFeatures.length === 1) {
        // Usar novo componente que inclui nome + botão de opções
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                pointControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            },
            selectedFeatures,
            selectionManager,
            uiManager
        );
        $(panel).append(headerComponent);
    } else if (selectedFeatures.length > 1) {
        // Para seleção múltipla: mostrar info + botão de opções
        const multiSelectHeader = document.createElement('div');
        multiSelectHeader.className = 'feature-header-with-options';
        
        const infoText = document.createElement('div');
        infoText.className = 'feature-name-wrapper';
        infoText.style.cssText = 'font-size: 14px; color: #666; padding: 6px;';
        infoText.textContent = `${selectedFeatures.length} pontos selecionados`;
        
        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );
        
        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        $(panel).append(multiSelectHeader);
    }

    // ===== ATRIBUTOS ESPECÍFICOS DE PONTO =====
    
    // Cor
    const colorInput = createColorPicker(feature.properties.color, (e) => {
        pointControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    });
    $(panel).append(createAttributeRow('Cor:', colorInput));

    // Size
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

    // Opacity (0-100% with automatic conversion)
    const opacitySlider = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity !== undefined ?
            feature.properties.opacity : 1) * 100), {
        onChange: (value) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));
    $(panel).append(createAttributeRow('Opacidade:', opacitySlider));


    // Editor de coordenadas (apenas para seleção única)
    if (selectedFeatures.length === 1) {
        const coordinateEditor = createCoordinateEditor(
            feature,
            uiManager,
            async (lat, lng) => {
                const updatedFeature = {
                    ...feature,
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    }
                };
                
                await pointControl.updateFeatures([updatedFeature], true, false);
                
                uiManager.updateSelectionHighlight();
                
                if (coordinateEditor.updateCoordinates) {
                    coordinateEditor.updateCoordinates(lat, lng);
                }
            }
        );
        $(panel).append(coordinateEditor);
    }

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
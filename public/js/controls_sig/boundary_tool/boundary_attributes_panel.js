// Path: js\controls_sig\boundary_tool\boundary_attributes_panel.js

import { 
    createSliderWithInput, 
    createColorPicker, 
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addBoundaryAttributesToPanel(panel, selectedFeatures, boundaryControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    
    // ✅ CORRECT: Capture initial properties at panel opening (before any user interaction)
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                boundaryControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== DROPDOWN DE ESCALÃO (ESPECÍFICO) =====
    // ⚠️ MANTER: Lógica específica do dropdown de escalão
    const echelonLabel = document.createElement('label');
    echelonLabel.textContent = 'Escalão:';
    const echelonSelect = document.createElement('select');
    echelonSelect.style.cssText = 'width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px;';
    
    const echelonOptions = [
        { value: 'XXXXXX', text: 'XXXXXX' },
        { value: 'XXXXX', text: 'XXXXX' },
        { value: 'XXXX', text: 'XXXX' },
        { value: 'XXX', text: 'XXX' },
        { value: 'XX', text: 'XX' },
        { value: 'X', text: 'X' },
        { value: 'III', text: 'III' },
        { value: 'II', text: 'II' },
        { value: 'I', text: 'I' },
        { value: 'ooo', text: '•••' },
        { value: 'oo', text: '••' },
        { value: 'o', text: '•' }
    ];
    
    echelonOptions.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.text;
        if (option.value === feature.properties.echelon) opt.selected = true;
        echelonSelect.appendChild(opt);
    });
    
    echelonSelect.onchange = (e) => {
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'echelon', e.target.value);
        uiManager.updateSelectionHighlight();
    };

    $(panel).append(createAttributeRow('Escalão:', echelonSelect));

    // ===== INPUTS DE TEXTO ESPECÍFICOS =====
    // ⚠️ MANTER: Inputs específicos de texto1 e texto2

    // Texto 1
    const text1Label = document.createElement('label');
    text1Label.textContent = 'Texto 1:';
    const text1Input = document.createElement('input');
    text1Input.type = 'text';
    text1Input.value = feature.properties.text_top || '';
    text1Input.placeholder = 'Ex: 244';
    text1Input.style.cssText = 'width: 100% ; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px;';
    text1Input.oninput = (e) => {
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'text_top', e.target.value);
        uiManager.updateSelectionHighlight();
    };

    $(panel).append(createAttributeRow('Texto 1:', text1Input));

    // Texto 2
    const text2Label = document.createElement('label');
    text2Label.textContent = 'Texto 2:';
    const text2Input = document.createElement('input');
    text2Input.type = 'text';
    text2Input.value = feature.properties.text_bottom || '';
    text2Input.placeholder = 'Ex: 155';
    text2Input.style.cssText = 'width:  100%; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px;';
    text2Input.oninput = (e) => {
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'text_bottom', e.target.value);
        uiManager.updateSelectionHighlight();
    };

    $(panel).append(createAttributeRow('Texto 2:', text2Input));

    // ===== PROPRIEDADES DE ESTILO =====

    // Tamanho do Texto (slider específico)
    const textSizeControl = createSliderWithInput({
        min: 8,
        max: 100,
        step: 1,
        value: feature.properties.text_size || 35,
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'text_size', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Tamanho do Texto (px):', textSizeControl));

    // Cor da Linha
    const colorInput = createColorPicker(feature.properties.color, (e) => {
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha de divisão');

    $(panel).append(createAttributeRow('Cor:', colorInput));

    // Espessura da Linha
    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 4, {
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Espessura (px):', lineWidthControl));

    // Opacidade (0-100% com conversão automática)
    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity || 1) * 100), {
        onChange: (value) => {
            // Convert from 0-100 range to 0-1 range for internal storage
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    // ✅ FIXED: Pass initialPropertiesMap captured at panel opening
    const buttons = createStandardButtons({
        selectedFeatures,
        control: boundaryControl,
        selectionManager,
        initialPropertiesMap, // ✅ PASS THE ORIGINAL STATE
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => boundaryControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}
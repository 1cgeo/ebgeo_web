// Path: js\controls_sig\boundary_tool\boundary_attributes_panel.js

import { 
    createSliderWithInput, 
    createColorPicker, 
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addBoundaryAttributesToPanel(panel, selectedFeatures, boundaryControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    
    // ✅ CORRECT: Capture initial properties at panel opening (before any user interaction)
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                boundaryControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} limites selecionados`;
        
        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );
        
        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        $(panel).append(multiSelectHeader);
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

    // Line color
    const colorInput = createColorPicker(feature.properties.color, (e) => {
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha de limite');

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

    // Opacity (0-100% with automatic conversion)
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
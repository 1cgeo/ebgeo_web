// Path: js\controls_sig\arrow_tool\arrow_attributes_panel.js

import { 
    createSliderWithInput,
    createNumericInput,
    createColorPicker, 
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addArrowAttributesToPanel(panel, selectedFeatures, arrowControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    
    // ✅ CORRECT: Capture initial properties at panel opening (before any user interaction)
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                arrowControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== PROPRIEDADES ESPECÍFICAS DA SETA =====

    // Largura (metros) - MUDADO: agora é input numérico em vez de slider
    const widthInput = createNumericInput({
        min: 10,
        max: 10000,
        step: 1,
        value: Math.round(feature.properties.width || 500),
        suffix: ' m',
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'width', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Largura:', widthInput));

    // Cor de preenchimento
    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor de preenchimento da seta');

    $(panel).append(createAttributeRow('Preenchimento:', fillColorInput));

    // Cor da borda
    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da borda da seta');

    $(panel).append(createAttributeRow('Borda:', lineColorInput));

    const setDefaultIfMissing = (value, defaultValue) => {
        return (value !== null && value !== undefined) ? value : defaultValue;
    };

    // Opacidade do preenchimento (0-100% com conversão automática)
    const fillOpacityControl = createSliderWithInput({
        min: 0,
        max: 100,
        step: 1,
        value: Math.round(setDefaultIfMissing(feature.properties.fillOpacity, 0.8) * 100),
        onChange: (value) => {
            // Convert from 0-100 range to 0-1 range for internal storage
            arrowControl.updateFeaturesProperty(selectedFeatures, 'fillOpacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Opacidade do preenchimento:', fillOpacityControl));

    // Largura da borda
    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 3, {
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Largura da borda (px):', lineWidthControl));

    // ===== CHECKBOXES ESPECÍFICOS =====

    // Checkbox Aeromóvel / Aeroterrestre
    const airmobileCheckbox = createCheckbox(feature.properties.airmobile || false, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'airmobile', e.target.checked);
        uiManager.updateSelectionHighlight();
    });

    $(panel).append(createAttributeRow('Aeromóvel / Aeroterrestre:', airmobileCheckbox));

    // Checkbox "Seta" para mostrar/ocultar cabeça
    const showArrowHeadCheckbox = createCheckbox(feature.properties.showArrowHead !== false, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'showArrowHead', e.target.checked);
        uiManager.updateSelectionHighlight();
    });

    $(panel).append(createAttributeRow('Seta:', showArrowHeadCheckbox));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    // ✅ FIXED: Pass initialPropertiesMap captured at panel opening
    // ⚠️ MANTER: Custom onSetDefault logic (from original)
    const buttons = createStandardButtons({
        selectedFeatures,
        control: arrowControl,
        selectionManager,
        initialPropertiesMap, // ✅ PASS THE ORIGINAL STATE
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => arrowControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}
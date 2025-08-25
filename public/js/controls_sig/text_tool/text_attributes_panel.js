// Path: js\controls_sig\text_tool\text_attributes_panel.js

import { 
    createSliderWithInput, 
    createColorPicker, 
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addTextAttributesToPanel(panel, selectedFeatures, textControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    
    // ✅ CORRECT: Capture initial properties at panel opening (before any user interaction)
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                textControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== TEXTAREA ESPECÍFICA PARA TEXTO (APENAS SELEÇÃO ÚNICA) =====
    // ⚠️ MANTER: Lógica específica do text tool
    if (selectedFeatures.length === 1) {
        const textInput = document.createElement('textarea');
        textInput.id = 'text-area';
        textInput.value = feature.properties.text;
        textInput.rows = 3;
        textInput.oninput = (e) => {
            updateJustifyButtons(e.target.value);
            textControl.updateFeaturesProperty(selectedFeatures, 'text', e.target.value);
            uiManager.updateSelectionHighlight();
        };
        $(panel).append(
            $("<div>", { class: "attr-container-column" })
                .append($("<div>", { class: "attr-input-full" }).append(textInput))
        );
    }

    // ===== PROPRIEDADES ESPECÍFICAS DO TEXTO =====

    // Tamanho (usando configuração customizada para texto)
    const sizeControl = createSliderWithInput({
        min: 1,
        max: 72,
        step: 1,
        value: feature.properties.size,
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'size', parseInt(value, 10));
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Tamanho (px):', sizeControl));

    // Cor do texto
    const colorInput = createColorPicker(feature.properties.color, (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    }, 'Cor do texto');

    $(panel).append(createAttributeRow('Cor:', colorInput));

    // Cor da borda
    const backgroundColorInput = createColorPicker(feature.properties.backgroundColor, (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'backgroundColor', e.target.value);
    }, 'Cor da borda do texto');

    $(panel).append(createAttributeRow('Cor da borda:', backgroundColorInput));

    // Rotação
    const rotateControl = createSliderWithInput(getCommonConfig('rotation',
        feature.properties.rotation || 0, {
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'rotation', parseInt(value, 10));
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Rotação:', rotateControl));

    // ===== JUSTIFY BUTTONS (LÓGICA ESPECÍFICA MANTIDA) =====
    // ⚠️ MANTER: Lógica específica do justify buttons
    const justifyLabel = document.createElement('label');
    justifyLabel.textContent = 'Justificativa:';
    justifyLabel.className = 'justify-label';
    const justifyButtonsContainer = $("<div>", { class: "justify-buttons" });
    
    // Initialize button variables
    let justifyLeftButton, justifyCenterButton, justifyRightButton;
    const justifyOptions = ['left', 'center', 'right'];
    justifyOptions.forEach(option => {
        const button = document.createElement('button');
        button.innerHTML = option[0].toUpperCase();
        button.title = `Align ${option}`;
        button.onclick = () => {
            textControl.updateFeaturesProperty(selectedFeatures, 'justify', option);
        };
        justifyButtonsContainer.append(button);

        // Assign buttons to variables
        if (option === 'left') {
            justifyLeftButton = button;
        } else if (option === 'center') {
            justifyCenterButton = button;
        } else if (option === 'right') {
            justifyRightButton = button;
        }
    });
    
    $(panel).append(
        $("<div>", { class: "justify-container" })
            .append(justifyLabel)
            .append(justifyButtonsContainer)
    );

    // ⚠️ MANTER: Função específica updateJustifyButtons
    const updateJustifyButtons = (text) => {
        const lines = text.split('\n').length;
        const enabled = lines > 1;
        justifyLeftButton.disabled = !enabled;
        justifyCenterButton.disabled = !enabled;
        justifyRightButton.disabled = !enabled;
    };

    // Initialize justify buttons state
    updateJustifyButtons(feature.properties.text);

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    // ✅ FIXED: Pass initialPropertiesMap captured at panel opening
    const buttons = createStandardButtons({
        selectedFeatures,
        control: textControl,
        selectionManager,
        initialPropertiesMap, // ✅ PASS THE ORIGINAL STATE
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => textControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}
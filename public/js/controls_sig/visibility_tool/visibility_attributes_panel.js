// Path: js\controls_sig\visibility_tool\visibility_attributes_panel.js

import { 
    createSliderWithInput, 
    createAttributeRow,
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addVisibilityAttributesToPanel(panel, selectedFeatures, visibilityControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                visibilityControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} áreas de visibilidade selecionados`;
        
        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );
        
        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        $(panel).append(multiSelectHeader);
    }

    // ===== DEBOUNCE ESPECÍFICO PARA RECÁLCULO DE VISIBILIDADE =====
    // ⚠️ MANTER: Lógica específica de debounce para performance
    let observerHeightDebounceTimer = null;

    const debouncedRecalculate = () => {
        clearTimeout(observerHeightDebounceTimer);
        observerHeightDebounceTimer = setTimeout(() => {
            visibilityControl.updateFeatures(selectedFeatures, false, false, true);
        }, 500); // Aguarda 500ms após parar de mexer
    };

    // ===== ALTURA DO OBSERVADOR (ESPECÍFICO COM DEBOUNCE) =====
    // ⚠️ MANTER: Lógica específica de debounce + recálculo
    const observerHeightControl = createSliderWithInput({
        min: 1,
        max: 20,
        step: 0.5,
        value: feature.properties.observerHeight || 2,
        onChange: (value) => {
            // Apenas atualiza propriedade, sem recalcular imediatamente
            visibilityControl.updateFeaturesProperty(selectedFeatures, 'observerHeight', value);
            uiManager.updateSelectionHighlight();
            
            // Programa recálculo com debounce
            debouncedRecalculate();
        },
        onBlur: (value) => {
            // Força recálculo imediato no blur (quando sai do campo)
            clearTimeout(observerHeightDebounceTimer);
            visibilityControl.updateFeatures(selectedFeatures, false, false, true);
        }
    });

    $(panel).append(createAttributeRow('Altura do Observador (m):', observerHeightControl));

    // ===== OPACIDADE PADRÃO =====
    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round(feature.properties.opacity * 100), {
        onChange: (value) => {
            // Convert from 0-100 range to 0-1 range for internal storage
            visibilityControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS COM CLEANUP =====
    // ✅ FIXED: Pass initialPropertiesMap captured at panel opening
    // ⚠️ CUSTOM: Manual implementation to add debounce cleanup
    const buttonContainer = $("<div>", { class: "attr-container-row" });

    // Save Button with cleanup
    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        // ⚠️ SPECIFIC: Cancel debounce before saving
        clearTimeout(observerHeightDebounceTimer);
        visibilityControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    // Discard Button with cleanup  
    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    discardButton.onclick = () => {
        // ⚠️ SPECIFIC: Cancel debounce before discarding
        clearTimeout(observerHeightDebounceTimer);
        visibilityControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    buttonContainer.append(saveButton).append(discardButton);
    $(panel).append(buttonContainer);
}
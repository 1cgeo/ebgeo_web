// Path: js\controls_sig\visibility_tool\visibility_attributes_panel.js
export function addVisibilityAttributesToPanel(panel, selectedFeatures, visibilityControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    // ✅ NOVO: Debounce timer para altura do observador
    let observerHeightDebounceTimer = null;

    // ✅ NOVO: Função para recalcular com debounce
    const debouncedRecalculate = () => {
        clearTimeout(observerHeightDebounceTimer);
        observerHeightDebounceTimer = setTimeout(() => {
            visibilityControl.updateFeatures(selectedFeatures, false, false, true);
        }, 500); // Aguarda 1.5 segundos após parar de mexer
    };

    // ✅ NOVO: Observer Height with slider and numeric input
    const observerHeightLabel = document.createElement('label');
    observerHeightLabel.textContent = 'Altura do Observador:';
    
    const observerHeightContainer = document.createElement('div');
    observerHeightContainer.className = 'slider-numeric-container';
    observerHeightContainer.style.cssText = 'display: flex; gap: 8px; align-items: center; width: 100%;';
    
    const observerHeightSlider = document.createElement('input');
    observerHeightSlider.classList.add("slider");
    observerHeightSlider.type = 'range';
    observerHeightSlider.min = 1;
    observerHeightSlider.max = 20;
    observerHeightSlider.step = 0.5;
    observerHeightSlider.value = feature.properties.observerHeight || 2;
    observerHeightSlider.style.cssText = 'flex-grow: 1;';
    
    const observerHeightInput = document.createElement('input');
    observerHeightInput.type = 'number';
    observerHeightInput.min = 1;
    observerHeightInput.max = 20;
    observerHeightInput.step = 0.5;
    observerHeightInput.value = feature.properties.observerHeight || 2;
    observerHeightInput.placeholder = 'm';
    observerHeightInput.title = 'Altura em metros';
    observerHeightInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; text-align: center;';
    
    observerHeightSlider.oninput = (e) => {
        const value = parseFloat(e.target.value);
        observerHeightInput.value = value;
        
        // ✅ MODIFICADO: Apenas atualiza propriedade, sem recalcular imediatamente
        visibilityControl.updateFeaturesProperty(selectedFeatures, 'observerHeight', value);
        uiManager.updateSelectionHighlight();
        
        // ✅ NOVO: Programa recálculo com debounce
        debouncedRecalculate();
    };
    
    observerHeightInput.oninput = (e) => {
        let value = parseFloat(e.target.value);
        if (isNaN(value)) {
            value = 2; // Default value
        } else {
            value = Math.max(1, Math.min(20, value));
        }
        observerHeightSlider.value = value;
        observerHeightInput.value = value;
        
        // ✅ MODIFICADO: Apenas atualiza propriedade, sem recalcular imediatamente
        visibilityControl.updateFeaturesProperty(selectedFeatures, 'observerHeight', value);
        uiManager.updateSelectionHighlight();
        
        // ✅ NOVO: Programa recálculo com debounce
        debouncedRecalculate();
    };
    
    observerHeightInput.onblur = (e) => {
        let value = parseFloat(e.target.value);
        if (isNaN(value)) {
            value = 2; // Default value
        } else {
            value = Math.max(1, Math.min(20, value));
        }
        observerHeightInput.value = value;
        observerHeightSlider.value = value;
        
        // ✅ MODIFICADO: Apenas atualiza propriedade, sem recalcular imediatamente
        visibilityControl.updateFeaturesProperty(selectedFeatures, 'observerHeight', value);
        uiManager.updateSelectionHighlight();
        
        // ✅ NOVO: Força recálculo imediato no blur (quando sai do campo)
        clearTimeout(observerHeightDebounceTimer);
        visibilityControl.updateFeatures(selectedFeatures, false, false, true);
    };
    
    observerHeightContainer.appendChild(observerHeightSlider);
    observerHeightContainer.appendChild(observerHeightInput);
    
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(observerHeightLabel))
            .append($("<div>", { class: "attr-input" }).append(observerHeightContainer))
    );

    // Opacity with slider and numeric input
    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacidade:';
    
    const opacityContainer = document.createElement('div');
    opacityContainer.className = 'slider-numeric-container';
    opacityContainer.style.cssText = 'display: flex; gap: 8px; align-items: center; width: 100%;';
    
    const opacitySlider = document.createElement('input');
    opacitySlider.classList.add("slider");
    opacitySlider.type = 'range';
    opacitySlider.min = 0.1;
    opacitySlider.max = 1;
    opacitySlider.step = 0.1;
    opacitySlider.value = feature.properties.opacity;
    opacitySlider.style.cssText = 'flex-grow: 1;';
    
    const opacityInput = document.createElement('input');
    opacityInput.type = 'number';
    opacityInput.min = 0.1;
    opacityInput.max = 1;
    opacityInput.step = 0.1;
    opacityInput.value = feature.properties.opacity;
    opacityInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; text-align: center;';
    
    opacitySlider.oninput = (e) => {
        opacityInput.value = e.target.value;
        visibilityControl.updateFeaturesProperty(selectedFeatures, 'opacity', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    
    opacityInput.oninput = (e) => {
        let value = parseFloat(e.target.value);
        value = Math.max(0.1, Math.min(1, value));
        opacitySlider.value = value;
        opacityInput.value = value;
        visibilityControl.updateFeaturesProperty(selectedFeatures, 'opacity', value);
        uiManager.updateSelectionHighlight();
    };
    
    opacityContainer.appendChild(opacitySlider);
    opacityContainer.appendChild(opacityInput);
    
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(opacityLabel))
            .append($("<div>", { class: "attr-input" }).append(opacityContainer))
    );

    const saveButton = document.createElement('button');
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    saveButton.textContent = 'Salvar';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        // ✅ NOVO: Cancelar qualquer recálculo pendente antes de salvar
        clearTimeout(observerHeightDebounceTimer);
        visibilityControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    const discardButton = document.createElement('button');
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        // ✅ NOVO: Cancelar qualquer recálculo pendente antes de descartar
        clearTimeout(observerHeightDebounceTimer);
        visibilityControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append(saveButton)
            .append(discardButton)
    );

    document.body.appendChild(panel);
}
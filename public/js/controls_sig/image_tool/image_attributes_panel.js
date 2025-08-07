// Path: js\controls_sig\image_tool\image_attributes_panel.js

export function addImageAttributesToPanel(panel, selectedFeatures, imageControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    // Size with slider and numeric input
    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho:';
    
    const sizeContainer = document.createElement('div');
    sizeContainer.className = 'slider-numeric-container';
    sizeContainer.style.cssText = 'display: flex; gap: 8px; align-items: center; width: 100%;';
    
    const sizeSlider = document.createElement('input');
    sizeSlider.classList.add("slider");
    sizeSlider.type = 'range';
    sizeSlider.min = 0.1;
    sizeSlider.max = 5;
    sizeSlider.step = 0.1;
    sizeSlider.value = feature.properties.size;
    sizeSlider.style.cssText = 'flex-grow: 1;';
    
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.min = 0.1;
    sizeInput.max = 5;
    sizeInput.step = 0.1;
    sizeInput.value = feature.properties.size;
    sizeInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; text-align: center;';
    
    sizeSlider.oninput = (e) => {
        sizeInput.value = e.target.value;
        imageControl.updateFeaturesProperty(selectedFeatures, 'size', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    
    sizeInput.oninput = (e) => {
        let value = parseFloat(e.target.value);
        value = Math.max(0.1, Math.min(5, value));
        sizeSlider.value = value;
        sizeInput.value = value;
        imageControl.updateFeaturesProperty(selectedFeatures, 'size', value);
        uiManager.updateSelectionHighlight();
    };
    
    sizeContainer.appendChild(sizeSlider);
    sizeContainer.appendChild(sizeInput);
    
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(sizeLabel))
            .append($("<div>", { class: "attr-input" }).append(sizeContainer))
    );

    // Rotation with slider and numeric input
    const rotationLabel = document.createElement('label');
    rotationLabel.textContent = 'Rotação:';
    
    const rotationContainer = document.createElement('div');
    rotationContainer.className = 'slider-numeric-container';
    rotationContainer.style.cssText = 'display: flex; gap: 8px; align-items: center; width: 100%;';
    
    const rotationSlider = document.createElement('input');
    rotationSlider.classList.add("slider");
    rotationSlider.type = 'range';
    rotationSlider.min = -180;
    rotationSlider.max = 180;
    rotationSlider.step = 1;
    rotationSlider.value = feature.properties.rotation || 0;
    rotationSlider.style.cssText = 'flex-grow: 1;';
    
    const rotationInput = document.createElement('input');
    rotationInput.type = 'number';
    rotationInput.min = -180;
    rotationInput.max = 180;
    rotationInput.step = 1;
    rotationInput.value = feature.properties.rotation || 0;
    rotationInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; text-align: center;';
    
    rotationSlider.oninput = (e) => {
        rotationInput.value = e.target.value;
        imageControl.updateFeaturesProperty(selectedFeatures, 'rotation', parseInt(e.target.value, 10));
        uiManager.updateSelectionHighlight();
    };
    
    rotationInput.oninput = (e) => {
        let value = parseInt(e.target.value, 10);
        value = Math.max(-180, Math.min(180, value));
        rotationSlider.value = value;
        rotationInput.value = value;
        imageControl.updateFeaturesProperty(selectedFeatures, 'rotation', value);
        uiManager.updateSelectionHighlight();
    };
    
    rotationContainer.appendChild(rotationSlider);
    rotationContainer.appendChild(rotationInput);
    
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(rotationLabel))
            .append($("<div>", { class: "attr-input" }).append(rotationContainer))
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
        imageControl.updateFeaturesProperty(selectedFeatures, 'opacity', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    
    opacityInput.oninput = (e) => {
        let value = parseFloat(e.target.value);
        value = Math.max(0.1, Math.min(1, value));
        opacitySlider.value = value;
        opacityInput.value = value;
        imageControl.updateFeaturesProperty(selectedFeatures, 'opacity', value);
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
        imageControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    const discardButton = document.createElement('button');
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        imageControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append(saveButton)
            .append(discardButton)
    );

    document.body.appendChild(panel);
}
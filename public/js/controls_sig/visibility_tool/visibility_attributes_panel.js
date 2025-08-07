// Path: js\controls_sig\visibility_tool\visibility_attributes_panel.js
export function addVisibilityAttributesToPanel(panel, selectedFeatures, visibilityControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

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
        visibilityControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    const discardButton = document.createElement('button');
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
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
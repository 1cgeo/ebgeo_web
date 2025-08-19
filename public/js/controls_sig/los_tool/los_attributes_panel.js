// Path: js\controls_sig\los_tool\los_attributes_panel.js
export function addLOSAttributesToPanel(panel, selectedFeatures, losControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

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
        losControl.updateFeaturesProperty(selectedFeatures, 'opacity', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    
    opacityInput.oninput = (e) => {
        let value = parseFloat(e.target.value);
        value = Math.max(0.1, Math.min(1, value));
        opacitySlider.value = value;
        opacityInput.value = value;
        losControl.updateFeaturesProperty(selectedFeatures, 'opacity', value);
        uiManager.updateSelectionHighlight();
    };
    
    opacityContainer.appendChild(opacitySlider);
    opacityContainer.appendChild(opacityInput);
    
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(opacityLabel))
            .append($("<div>", { class: "attr-input" }).append(opacityContainer))
    );

    // Width with slider and numeric input
    const widthLabel = document.createElement('label');
    widthLabel.textContent = 'Largura:';
    
    const widthContainer = document.createElement('div');
    widthContainer.className = 'slider-numeric-container';
    widthContainer.style.cssText = 'display: flex; gap: 8px; align-items: center; width: 100%;';
    
    const widthSlider = document.createElement('input');
    widthSlider.classList.add("slider");
    widthSlider.type = 'range';
    widthSlider.min = 1;
    widthSlider.max = 30;
    widthSlider.step = 1;
    widthSlider.value = feature.properties.width;
    widthSlider.style.cssText = 'flex-grow: 1;';
    
    const widthInput = document.createElement('input');
    widthInput.type = 'number';
    widthInput.min = 1;
    widthInput.max = 30;
    widthInput.step = 1;
    widthInput.value = feature.properties.width;
    widthInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; text-align: center;';
    
    widthSlider.oninput = (e) => {
        widthInput.value = e.target.value;
        losControl.updateFeaturesProperty(selectedFeatures, 'width', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    
    widthInput.oninput = (e) => {
        let value = parseInt(e.target.value, 10);
        value = Math.max(1, Math.min(30, value));
        widthSlider.value = value;
        widthInput.value = value;
        losControl.updateFeaturesProperty(selectedFeatures, 'width', value);
        uiManager.updateSelectionHighlight();
    };
    
    widthContainer.appendChild(widthSlider);
    widthContainer.appendChild(widthInput);
    
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(widthLabel))
            .append($("<div>", { class: "attr-input" }).append(widthContainer))
    );

    const addAttributeRow = (labelText, inputElement) => {
        const container = $("<div>", { class: "attr-container-row" });
        const label = document.createElement('label');
        label.textContent = labelText;
        container.append($("<div>", { class: "attr-name" }).append(label));
        container.append($("<div>", { class: "attr-input" }).append(inputElement));
        $(panel).append(container);
    };

    const createCheckbox = (checked, onChange) => {
        const label = $("<label>", { class: "switch" });
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.classList.add("slider-check-input");
        label.append(input);
        label.append($("<div>", { class: "slider-check round" }));
        input.onchange = onChange;
        return label;
    };

    const mostrarTamanhoCheckbox = createCheckbox(feature.properties.measure || false, (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'measure', e.target.checked);
    });
    addAttributeRow('Mostrar tamanho:', mostrarTamanhoCheckbox);

    if (selectedFeatures.length === 1) {
        const mostrarPerfilCheckbox = createCheckbox(feature.properties.profile || false, (e) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'profile', e.target.checked);
            selectionManager.updateProfile();
        });
        addAttributeRow('Mostrar perfil:', mostrarPerfilCheckbox);
    }

    const saveButton = document.createElement('button');
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    saveButton.textContent = 'Salvar';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        losControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    const discardButton = document.createElement('button');
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        losControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append(saveButton)
            .append(discardButton)
    );

    document.body.appendChild(panel);
}
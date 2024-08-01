export function addImageAttributesToPanel(panel, selectedFeatures, imageControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho:';
    const sizeInput = document.createElement('input');
    sizeInput.classList.add("slider");
    sizeInput.type = 'range';
    sizeInput.step = 0.1;
    sizeInput.min = 0.1;
    sizeInput.max = 5;
    sizeInput.value = feature.properties.size;
    sizeInput.oninput = (e) => {
        imageControl.updateFeaturesProperty(selectedFeatures, 'size', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(sizeLabel))
            .append($("<div>", { class: "attr-input" }).append(sizeInput))
    )

    const rotationLabel = document.createElement('label');
    rotationLabel.textContent = 'Rotação:';
    const rotationInput = document.createElement('input');
    rotationInput.type = 'number';
    rotationInput.step = 1;
    rotationInput.min = -180;
    rotationInput.max = 180;
    rotationInput.value = feature.properties.rotation;
    rotationInput.oninput = (e) => {
        imageControl.updateFeaturesProperty(selectedFeatures, 'rotation', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(rotationLabel))
            .append($("<div>", { class: "attr-input" }).append(rotationInput))
    )

    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacidade:';
    const opacityInput = document.createElement('input');
    opacityInput.classList.add("slider");
    opacityInput.type = 'range';
    opacityInput.min = 0.1;
    opacityInput.max = 1;
    opacityInput.step = 0.1;
    opacityInput.value = feature.properties.opacity;
    opacityInput.oninput = (e) => {
        imageControl.updateFeaturesProperty(selectedFeatures, 'opacity', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(opacityLabel))
            .append($("<div>", { class: "attr-input" }).append(opacityInput))
    )

    const saveButton = document.createElement('button');
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    saveButton.textContent = 'Salvar';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        imageControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();
    };

    const discardButton = document.createElement('button');
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        imageControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append(saveButton)
            .append(discardButton)
    )

    document.body.appendChild(panel);
}

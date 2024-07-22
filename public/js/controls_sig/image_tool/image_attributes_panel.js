export function addImageAttributesToPanel(panel, selectedFeatures, imageControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho:';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.step = '0.1';
    sizeInput.min = '0.1';
    sizeInput.value = feature.properties.size;
    sizeInput.oninput = (e) => {
        imageControl.updateFeaturesProperty(selectedFeatures, 'size', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    panel.appendChild(sizeLabel);
    panel.appendChild(sizeInput);

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
    panel.appendChild(rotationLabel);
    panel.appendChild(rotationInput);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        imageControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();
    };
    panel.appendChild(saveButton);

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        imageControl.discartChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();
    };
    panel.appendChild(discardButton);

    document.body.appendChild(panel);
}

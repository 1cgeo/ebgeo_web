export function addVisibilityAttributesToPanel(panel, selectedFeatures, visibilityControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacidade:';
    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = 0;
    opacityInput.max = 1;
    opacityInput.step = 0.1;
    opacityInput.value = feature.properties.opacity;
    opacityInput.oninput = (e) => {
        visibilityControl.updateFeaturesProperty(selectedFeatures, 'opacity', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    panel.appendChild(opacityLabel);
    panel.appendChild(opacityInput);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        visibilityControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    panel.appendChild(saveButton);

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        visibilityControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    panel.appendChild(discardButton);
}
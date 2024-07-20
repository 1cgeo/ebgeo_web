export function createImageAttributesPanel(selectedFeatures, imageControl) {
    let panel = document.querySelector('.image-attributes-panel');
    if (panel) {
        panel.remove();
    }
    if (selectedFeatures.length == 0) {
        return;
    }

    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form.
    const initialPropertiesMap = new Map();
    selectedFeatures.forEach(f => {
        initialPropertiesMap.set(f.id, { ...f.properties });
    });

    panel = document.createElement('div');
    panel.className = 'image-attributes-panel';

    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho:';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.step = '0.1';
    sizeInput.min = '0.1';
    sizeInput.value = feature.properties.size;
    sizeInput.oninput = (e) => {
        imageControl.updateFeaturesProperty(selectedFeatures, 'size', parseFloat(e.target.value));
    };

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
    };

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.id = 'SalvarImg';
    saveButton.onclick = () => {
        imageControl.saveFeatures(selectedFeatures, initialPropertiesMap)
        panel.remove();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        imageControl.discartChangeFeatures(selectedFeatures, initialPropertiesMap)
        panel.remove();
    };

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Deletar';
    deleteButton.onclick = () => {
        imageControl.deleteFeatures(selectedFeatures)
        panel.remove();
    };

    panel.appendChild(sizeLabel);
    panel.appendChild(sizeInput);
    panel.appendChild(rotationLabel);
    panel.appendChild(rotationInput);
    panel.appendChild(saveButton);
    panel.appendChild(discardButton);
    panel.appendChild(deleteButton);

    document.body.appendChild(panel);
}
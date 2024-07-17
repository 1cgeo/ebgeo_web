export function addTextAttributesToPanel(panel, selectedFeatures, textControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    if (selectedFeatures.length === 1) {
        const textLabel = document.createElement('label');
        textLabel.textContent = 'Texto:';
        const textInput = document.createElement('textarea');
        textInput.value = feature.properties.text;
        textInput.rows = 3;
        textInput.cols = 50;
        textInput.oninput = (e) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'text', e.target.value);
            uiManager.updateSelectionHighlight();
        };
        panel.appendChild(textLabel);
        panel.appendChild(textInput);
    }

    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho:';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.step = 1;
    sizeInput.min = 1;
    sizeInput.value = feature.properties.size;
    sizeInput.oninput = (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'size', parseInt(e.target.value, 10));
        uiManager.updateSelectionHighlight();
    };
    panel.appendChild(sizeLabel);
    panel.appendChild(sizeInput);

    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Cor:';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = feature.properties.color;
    colorInput.oninput = (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    };
    panel.appendChild(colorLabel);
    panel.appendChild(colorInput);

    const backgroundColorLabel = document.createElement('label');
    backgroundColorLabel.textContent = 'Cor da borda:';
    const backgroundColorInput = document.createElement('input');
    backgroundColorInput.type = 'color';
    backgroundColorInput.value = feature.properties.backgroundColor;
    backgroundColorInput.oninput = (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'backgroundColor', e.target.value);
    };
    panel.appendChild(backgroundColorLabel);
    panel.appendChild(backgroundColorInput);

    const rotateLabel = document.createElement('label');
    rotateLabel.textContent = 'Rotação:';
    const rotateInput = document.createElement('input');
    rotateInput.type = 'number';
    rotateInput.value = feature.properties.rotation;
    rotateInput.oninput = (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'rotation', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    panel.appendChild(rotateLabel);
    panel.appendChild(rotateInput);

    const justifyLabel = document.createElement('label');
    justifyLabel.textContent = 'Justificativa:';
    panel.appendChild(justifyLabel);

    const justifyContainer = document.createElement('div');
    justifyContainer.style.display = 'flex';
    justifyContainer.style.justifyContent = 'space-between';

    const justifyOptions = ['left', 'center', 'right'];
    justifyOptions.forEach(option => {
        const button = document.createElement('button');
        button.innerHTML = option[0].toUpperCase();
        button.title = `Align ${option}`;
        button.onclick = () => {
            textControl.updateFeaturesProperty(selectedFeatures, 'justify', option);
        };
        justifyContainer.appendChild(button);
    });

    panel.appendChild(justifyContainer);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.id = 'SalvarTxt';
    saveButton.onclick = () => {
        updateFeature('texts', feature)
        panel.remove();
    };
    panel.appendChild(saveButton);

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        textControl.discartChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();
    };
    panel.appendChild(discardButton);
    panel.appendChild(deleteButton);
    panel.appendChild(setDefaultButton);

    document.body.appendChild(panel);
}

export function updateTextAttributesPanel(feature, map) {
    const data = JSON.parse(JSON.stringify(map.getSource('texts')._data));
    const featureIndex = data.features.findIndex(f => f.id === feature.id);
    if (featureIndex !== -1) {
        data.features[featureIndex].properties = feature.properties;
        map.getSource('texts').setData(data);
    }
}
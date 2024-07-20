export function createTextAttributesPanel(selectedFeatures, textControl) {
    let panel = document.querySelector('.text-attributes-panel');
    if (panel) {
        panel.remove();
    }
    if(selectedFeatures.length == 0){
        return
    }

    const feature = selectedFeatures[0]; // Usar a primeira feição selecionada para popular o formulário.
    const initialPropertiesMap = new Map();
    selectedFeatures.forEach(f => {
        initialPropertiesMap.set(f.id, { ...f.properties });
    });

    panel = document.createElement('div');
    panel.className = 'text-attributes-panel';

    if (selectedFeatures.length === 1) {
        const textLabel = document.createElement('label');
        textLabel.textContent = 'Texto:';
        const textInput = document.createElement('textarea');
        textInput.value = feature.properties.text;
        textInput.rows = 3;
        textInput.cols = 50;
        textInput.oninput = (e) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'text', e.target.value);
            updateJustifyButtons(e.target.value);

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
    };

    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Cor:';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = feature.properties.color;
    colorInput.oninput = (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    };

    const backgroundColorLabel = document.createElement('label');
    backgroundColorLabel.textContent = 'Cor da borda:';
    const backgroundColorInput = document.createElement('input');
    backgroundColorInput.type = 'color';
    backgroundColorInput.value = feature.properties.backgroundColor;
    backgroundColorInput.oninput = (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'backgroundColor', e.target.value);
    };

    const rotateLabel = document.createElement('label');
    rotateLabel.textContent = 'Rotação:';
    const rotateInput = document.createElement('input');
    rotateInput.type = 'number';
    rotateInput.value = feature.properties.rotation;
    rotateInput.oninput = (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'rotation', parseFloat(e.target.value));
    };

    const justifyLabel = document.createElement('label');
    justifyLabel.textContent = 'Justificativa:';

    const justifyContainer = document.createElement('div');
    justifyContainer.style.display = 'flex';
    justifyContainer.style.justifyContent = 'space-between';

    const justifyLeftButton = document.createElement('button');
    justifyLeftButton.innerHTML = 'L';
    justifyLeftButton.title = 'Alinhar à esquerda';
    justifyLeftButton.onclick = () => {
        textControl.updateFeaturesProperty(selectedFeatures, 'justify', 'left');
    };

    const justifyCenterButton = document.createElement('button');
    justifyCenterButton.innerHTML = 'C';
    justifyCenterButton.title = 'Centralizar';
    justifyCenterButton.onclick = () => {
        textControl.updateFeaturesProperty(selectedFeatures, 'justify', 'center');
    };

    const justifyRightButton = document.createElement('button');
    justifyRightButton.innerHTML = 'R';
    justifyRightButton.title = 'Alinhar à direita';
    justifyRightButton.onclick = () => {
        textControl.updateFeaturesProperty(selectedFeatures, 'justify', 'right');
    };

    justifyContainer.appendChild(justifyLeftButton);
    justifyContainer.appendChild(justifyCenterButton);
    justifyContainer.appendChild(justifyRightButton);

    const updateJustifyButtons = (text) => {
        const lines = text.split('\n').length;
        const enabled = lines > 1;
        justifyLeftButton.disabled = !enabled;
        justifyCenterButton.disabled = !enabled;
        justifyRightButton.disabled = !enabled;
    };

    updateJustifyButtons(feature.properties.text);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.id = 'SalvarTxt';
    saveButton.onclick = () => {
        textControl.saveFeatures(selectedFeatures, initialPropertiesMap)
        panel.remove();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        textControl.discartChangeFeatures(selectedFeatures, initialPropertiesMap)
        panel.remove();
    };

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Deletar';
    deleteButton.onclick = () => {
        textControl.deleteFeatures(selectedFeatures)
        panel.remove();
    };

    const setDefaultButton = document.createElement('button');
    setDefaultButton.textContent = 'Definir padrão';
    setDefaultButton.onclick = () => {
        textControl.setDefaultProperties(feature.properties);
    };

    panel.appendChild(sizeLabel);
    panel.appendChild(sizeInput);
    panel.appendChild(colorLabel);
    panel.appendChild(colorInput);
    panel.appendChild(backgroundColorLabel);
    panel.appendChild(backgroundColorInput);
    panel.appendChild(rotateLabel);
    panel.appendChild(rotateInput);
    panel.appendChild(justifyLabel);
    panel.appendChild(justifyContainer);
    panel.appendChild(saveButton);
    panel.appendChild(discardButton);
    panel.appendChild(deleteButton);
    panel.appendChild(setDefaultButton);

    document.body.appendChild(panel);
}

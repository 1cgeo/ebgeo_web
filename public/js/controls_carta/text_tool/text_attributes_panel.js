export function createTextAttributesPanel(feature, map, defaultTextProperties) {
    let panel = document.querySelector('.text-attributes-panel');
    if (panel) {
        panel.remove();
    }

    const initialProperties = { ...feature.properties };
    const initialCoordinates = [...feature.geometry.coordinates];

    panel = document.createElement('div');
    panel.className = 'text-attributes-panel';

    const textLabel = document.createElement('label');
    textLabel.textContent = 'Texto:';
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = feature.properties.text;
    textInput.oninput = (e) => {
        feature.properties.text = e.target.value;
        updateTextAttributesPanel(feature, map);
    };

    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho:';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.value = feature.properties.size;
    sizeInput.oninput = (e) => {
        feature.properties.size = parseInt(e.target.value, 10);
        updateTextAttributesPanel(feature, map);
    };

    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Cor:';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = feature.properties.color;
    colorInput.oninput = (e) => {
        feature.properties.color = e.target.value;
        updateTextAttributesPanel(feature, map);
    };

    const backgroundColorLabel = document.createElement('label');
    backgroundColorLabel.textContent = 'Cor da borda:';
    const backgroundColorInput = document.createElement('input');
    backgroundColorInput.type = 'color';
    backgroundColorInput.value = feature.properties.backgroundColor;
    backgroundColorInput.oninput = (e) => {
        feature.properties.backgroundColor = e.target.value;
        updateTextAttributesPanel(feature, map);
    };

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.onclick = () => {
        panel.remove();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.id = 'DescartarTxt';
    discardButton.onclick = () => {
        Object.assign(feature.properties, initialProperties);
        feature.geometry.coordinates = initialCoordinates;
        updateTextAttributesPanel(feature, map);
        panel.remove();
    };

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Deletar';
    deleteButton.onclick = () => {
        const data = map.getSource('texts')._data;
        data.features = data.features.filter(f => f.id !== feature.id);
        map.getSource('texts').setData(data);
        panel.remove();
    };

    const setDefaultButton = document.createElement('button');
    setDefaultButton.textContent = 'Definir padrão';
    setDefaultButton.onclick = () => {
        defaultTextProperties.color = feature.properties.color;
        defaultTextProperties.size = feature.properties.size;
        defaultTextProperties.backgroundColor = feature.properties.backgroundColor;
    };

    panel.appendChild(textLabel);
    panel.appendChild(textInput);
    panel.appendChild(sizeLabel);
    panel.appendChild(sizeInput);
    panel.appendChild(colorLabel);
    panel.appendChild(colorInput);
    panel.appendChild(backgroundColorLabel);
    panel.appendChild(backgroundColorInput);
    panel.appendChild(saveButton);
    panel.appendChild(discardButton);
    panel.appendChild(deleteButton);
    panel.appendChild(setDefaultButton);

    document.body.appendChild(panel);
}

export function updateTextAttributesPanel(feature, map) {
    const data = map.getSource('texts')._data;
    const featureIndex = data.features.findIndex(f => f.id === feature.id);
    if (featureIndex !== -1) {
        data.features[featureIndex].properties = feature.properties;
        map.getSource('texts').setData(data);
    }
}

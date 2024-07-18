import { updateFeature, removeFeature } from '../store.js';

export function createTextAttributesPanel(selectedFeatures, map, defaultTextProperties) {
    let panel = document.querySelector('.text-attributes-panel');
    if (panel) {
        panel.remove();
    }

    const isSingleFeature = selectedFeatures.length === 1;
    const feature = isSingleFeature ? selectedFeatures[0] : null;
    const initialProperties = isSingleFeature ? { ...feature.properties } : null;
    const initialCoordinates = isSingleFeature ? [...feature.geometry.coordinates] : null;

    panel = document.createElement('div');
    panel.className = 'text-attributes-panel';

    if (isSingleFeature) {
        const textLabel = document.createElement('label');
        textLabel.textContent = 'Texto:';
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = feature.properties.text;
        textInput.oninput = (e) => {
            feature.properties.text = e.target.value;
            updateTextAttributesPanel(feature, map);
        };
        panel.appendChild(textLabel);
        panel.appendChild(textInput);
    }

    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho:';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.value = isSingleFeature ? feature.properties.size : '';
    sizeInput.oninput = (e) => {
        selectedFeatures.forEach(f => f.properties.size = parseInt(e.target.value, 10));
        updateTextAttributesPanel(selectedFeatures, map);
    };

    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Cor:';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = isSingleFeature ? feature.properties.color : '';
    colorInput.oninput = (e) => {
        selectedFeatures.forEach(f => f.properties.color = e.target.value);
        updateTextAttributesPanel(selectedFeatures, map);
    };

    const backgroundColorLabel = document.createElement('label');
    backgroundColorLabel.textContent = 'Cor da borda:';
    const backgroundColorInput = document.createElement('input');
    backgroundColorInput.type = 'color';
    backgroundColorInput.value = isSingleFeature ? feature.properties.backgroundColor : '';
    backgroundColorInput.oninput = (e) => {
        selectedFeatures.forEach(f => f.properties.backgroundColor = e.target.value);
        updateTextAttributesPanel(selectedFeatures, map);
    };

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.id = 'SalvarTxt';
    saveButton.onclick = () => {
        selectedFeatures.forEach(f => updateFeature('texts', f));
        panel.remove();
        deselectAllFeatures(selectedFeatures, map);
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        if (isSingleFeature) {
            Object.assign(feature.properties, initialProperties);
            feature.geometry.coordinates = initialCoordinates;
        }
        updateTextAttributesPanel(selectedFeatures, map);
        panel.remove();
        deselectAllFeatures(selectedFeatures, map);
    };

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Deletar';
    deleteButton.onclick = () => {
        const data = JSON.parse(JSON.stringify(map.getSource('texts')._data));
        selectedFeatures.forEach(f => {
            data.features = data.features.filter(df => df.id !== f.id);
            removeFeature('texts', f.id);
        });
        map.getSource('texts').setData(data);
        panel.remove();
        deselectAllFeatures(selectedFeatures, map);
    };

    const setDefaultButton = document.createElement('button');
    setDefaultButton.textContent = 'Definir padrão';
    setDefaultButton.onclick = () => {
        if (isSingleFeature) {
            defaultTextProperties.color = feature.properties.color;
            defaultTextProperties.size = feature.properties.size;
            defaultTextProperties.backgroundColor = feature.properties.backgroundColor;
        }
    };

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

export function updateTextAttributesPanel(features, map) {
    const data = JSON.parse(JSON.stringify(map.getSource('texts')._data));
    features.forEach(feature => {
        const featureIndex = data.features.findIndex(f => f.id === feature.id);
        if (featureIndex !== -1) {
            data.features[featureIndex].properties = feature.properties;
        }
    });
    map.getSource('texts').setData(data);
}

export function deselectAllFeatures(features, map) {
    features.forEach(feature => {
        feature.properties.selected = false;
    });
    updateTextAttributesPanel(features, map);
}

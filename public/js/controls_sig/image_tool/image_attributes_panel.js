import { updateFeature, removeFeature } from '../store.js';

export function createImageAttributesPanel(feature, map) {
    let panel = document.querySelector('.image-attributes-panel');
    if (panel) {
        panel.remove();
    }

    const initialProperties = { ...feature.properties };
    const initialCoordinates = [...feature.geometry.coordinates];

    panel = document.createElement('div');
    panel.className = 'image-attributes-panel';

    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho:';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.step = '0.1';
    sizeInput.value = feature.properties.size;
    sizeInput.oninput = (e) => {
        feature.properties.size = parseFloat(e.target.value);
        updateImageAttributesPanel(feature, map);
    };

    const rotationLabel = document.createElement('label');
    rotationLabel.textContent = 'Rotação:';
    const rotationInput = document.createElement('input');
    rotationInput.type = 'number';
    rotationInput.value = feature.properties.rotation;
    rotationInput.oninput = (e) => {
        feature.properties.rotation = parseFloat(e.target.value);
        updateImageAttributesPanel(feature, map);
    };

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.id = 'SalvarImg';
    saveButton.onclick = () => {
        updateFeature('images', feature)
        panel.remove();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        Object.assign(feature.properties, initialProperties);
        feature.geometry.coordinates = initialCoordinates;
        updateImageAttributesPanel(feature, map);
        panel.remove();
    };

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Deletar';
    deleteButton.onclick = () => {
        const data = JSON.parse(JSON.stringify(map.getSource('images')._data));
        data.features = data.features.filter(f => f.id != feature.id);
        map.getSource('images').setData(data);
        panel.remove();
        removeFeature('images', feature)
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

export function updateImageAttributesPanel(feature, map) {
    const data = JSON.parse(JSON.stringify(map.getSource('images')._data));
    const featureIndex = data.features.findIndex(f => f.id === feature.id);
    if (featureIndex !== -1) {
        data.features[featureIndex].properties = feature.properties;
        map.getSource('images').setData(data);
    }
}

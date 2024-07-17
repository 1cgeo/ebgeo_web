import { updateFeature, removeFeature } from '../store.js';

export function createFeatureAttributesPanel(feature, map, defaultProperties) {
    let panel = document.querySelector('.feature-attributes-panel');
    if (panel) {
        panel.remove();
    }

    const initialProperties = { ...feature.properties };
    const initialCoordinates = [...feature.geometry.coordinates];

    panel = document.createElement('div');
    panel.className = 'feature-attributes-panel';

    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Cor:';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = feature.properties.color || '#000000';
    colorInput.oninput = (e) => {
        feature.properties.color = e.target.value;
        updateFeatureAttributesPanel(feature, map);
    };

    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacidade:';
    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = 0;
    opacityInput.max = 1;
    opacityInput.step = 0.1;
    opacityInput.value = feature.properties.opacity !== undefined ? feature.properties.opacity : 1;
    opacityInput.oninput = (e) => {
        feature.properties.opacity = parseFloat(e.target.value);
        updateFeatureAttributesPanel(feature, map);
    };

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.id = 'SalvarFeat';
    saveButton.onclick = () => {
        const type = feature.geometry.type.toLowerCase() + 's';
        updateFeature(type, feature);
        panel.remove();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        Object.assign(feature.properties, initialProperties);
        feature.geometry.coordinates = initialCoordinates;
        updateFeatureAttributesPanel(feature, map);
        panel.remove();
    };

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Deletar';
    deleteButton.onclick = () => {
        const draw = map._controls.find(control => control instanceof MapboxDraw);
        if (draw) {
            draw.delete(feature.id);
            const type = feature.geometry.type.toLowerCase() + 's';
            removeFeature(type, feature.id);
        }
        panel.remove();
    };

    const setDefaultButton = document.createElement('button');
    setDefaultButton.textContent = 'Definir padrão';
    setDefaultButton.onclick = () => {
        defaultProperties.color = feature.properties.color;
        defaultProperties.opacity = feature.properties.opacity;
    };

    panel.appendChild(colorLabel);
    panel.appendChild(colorInput);
    panel.appendChild(opacityLabel);
    panel.appendChild(opacityInput);
    panel.appendChild(saveButton);
    panel.appendChild(discardButton);
    panel.appendChild(deleteButton);
    panel.appendChild(setDefaultButton);

    document.body.appendChild(panel);
}

export function updateFeatureAttributesPanel(feature, map) {
    const draw = map._controls.find(control => control instanceof MapboxDraw);
    if (draw) {
        draw.setFeatureProperty(feature.id, 'color', feature.properties.color);
        draw.setFeatureProperty(feature.id, 'opacity', feature.properties.opacity);

        const feat = draw.get(feature.id);
        draw.add(feat);
    } else {
        console.error('Draw control not found on map');
    }
}

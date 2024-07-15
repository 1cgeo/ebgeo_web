// public/js/controls/feature_attributes_panel.js

export function createFeatureAttributesPanel(feature, map, defaultProperties) {
    let panel = document.querySelector('.feature-attributes-panel');
    if (panel) {
        panel.remove();
    }

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
    saveButton.onclick = () => {
        panel.remove();
    };

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Deletar';
    deleteButton.onclick = () => {
        const draw = map._controls.find(control => control instanceof MapboxDraw);
        if (draw) {
            draw.delete(feature.id);
        }
        panel.remove();
    };

    const setDefaultButton = document.createElement('button');
    setDefaultButton.textContent = 'Definir padrão';
    setDefaultButton.onclick = () => {
        defaultProperties.user_color = feature.properties.color;
        defaultProperties.user_opacity = feature.properties.opacity;
    };

    panel.appendChild(colorLabel);
    panel.appendChild(colorInput);
    panel.appendChild(opacityLabel);
    panel.appendChild(opacityInput);
    panel.appendChild(saveButton);
    panel.appendChild(deleteButton);
    panel.appendChild(setDefaultButton);

    document.body.appendChild(panel);
}

export function updateFeatureAttributesPanel(feature, map) {
    const draw = map._controls.find(control => control instanceof MapboxDraw);
    if (draw) {
        draw.setFeatureProperty(feature.id, 'color', feature.properties.color);
        draw.setFeatureProperty(feature.id, 'opacity', feature.properties.opacity);

        var feat = draw.get(feature.id);
        draw.add(feat);
    } else {
        console.error('Draw control not found on map');
    }
}

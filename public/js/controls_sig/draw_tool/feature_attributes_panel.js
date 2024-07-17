import { updateFeature, removeFeature } from '../store.js';

export function createFeatureAttributesPanel(features, map, defaultProperties) {
    let panel = document.querySelector('.feature-attributes-panel');
    if (panel) {
        panel.remove();
    }

    const initialProperties = features.map(feature => ({ ...feature.properties }));
    const initialCoordinates = features.map(feature => [...feature.geometry.coordinates]);

    panel = document.createElement('div');
    panel.className = 'feature-attributes-panel';

    const commonAttributes = findCommonAttributes(features);

    commonAttributes.forEach(attr => {
        const attrLabel = document.createElement('label');
        attrLabel.textContent = getLabel(attr, features);
        const attrInput = createInput(attr, features[0].properties[attr]);
        attrInput.oninput = (e) => {
            features.forEach(feature => {
                feature.properties[attr] = attrInput.type === 'range' || attrInput.type === 'number' ? parseFloat(e.target.value) : e.target.value;
            });
            updateFeatureAttributesPanel(features, map);
        };
        panel.appendChild(attrLabel);
        panel.appendChild(attrInput);
    });

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.id = 'SalvarFeat';
    saveButton.onclick = () => {
        features.forEach(feature => {
            const type = feature.geometry.type.toLowerCase() + 's';
            updateFeature(type, feature);
        });
        panel.remove();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        features.forEach((feature, index) => {
            Object.assign(feature.properties, initialProperties[index]);
            feature.geometry.coordinates = initialCoordinates[index];
        });
        updateFeatureAttributesPanel(features, map);
        panel.remove();
    };

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Deletar';
    deleteButton.onclick = () => {
        const draw = map._controls.find(control => control instanceof MapboxDraw);
        if (draw) {
            features.forEach(feature => {
                draw.delete(feature.id);
                const type = feature.geometry.type.toLowerCase() + 's';
                removeFeature(type, feature.id);
            });
        }
        panel.remove();
    };

    const setDefaultButton = document.createElement('button');
    setDefaultButton.textContent = 'Definir padrão';
    setDefaultButton.onclick = () => {
        commonAttributes.forEach(attr => {
            defaultProperties[attr] = features[0].properties[attr];
        });
    };

    panel.appendChild(saveButton);
    panel.appendChild(discardButton);
    panel.appendChild(deleteButton);
    panel.appendChild(setDefaultButton);

    document.body.appendChild(panel);
}

export function updateFeatureAttributesPanel(features, map) {
    const draw = map._controls.find(control => control instanceof MapboxDraw);
    if (draw) {
        features.forEach(feature => {
            Object.keys(feature.properties).forEach(key => {
                draw.setFeatureProperty(feature.id, key, feature.properties[key]);
            });
            const feat = draw.get(feature.id);
            draw.add(feat);
        });
    } else {
        console.error('Draw control not found on map');
    }
}

function findCommonAttributes(features) {
    const attributeSets = {
        Point: ['size', 'color', 'opacity'],
        LineString: ['size', 'color', 'opacity'],
        Polygon: ['color', 'opacity', 'outlinecolor', 'size']
    };

    const featureTypes = features.map(f => f.geometry.type);
    const allAttributes = featureTypes.map(type => attributeSets[type]);

    return allAttributes.reduce((common, attributes) => {
        return common.filter(attr => attributes.includes(attr));
    });
}
function getLabel(attr, features) {
    const labels = {
        size: 'Tamanho',
        color: 'Cor',
        opacity: 'Opacidade',
        outlinecolor: 'Cor da borda'
    };

    if (attr === 'size') {
        const hasPolygon = features.some(feature => feature.geometry.type === 'Polygon');
        if (hasPolygon) {
            return features.length === 1 ? 'Largura da borda' : 'Tamanho';
        }
    }

    return labels[attr] || attr;
}

function createInput(attr, value) {
    let input;
    if (attr === 'color' || attr === 'outlinecolor') {
        input = document.createElement('input');
        input.type = 'color';
        input.value = value || '#000000';
    } else if (attr === 'opacity') {
        input = document.createElement('input');
        input.type = 'range';
        input.min = 0;
        input.max = 1;
        input.step = 0.1;
        input.value = value !== undefined ? value : 1;
    } else {
        input = document.createElement('input');
        input.type = 'number';
        input.value = value !== undefined ? value : 1;
    }
    return input;
}
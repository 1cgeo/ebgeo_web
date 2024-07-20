export function createFeatureAttributesPanel(selectedFeatures, featureControl) {
    let panel = document.querySelector('.feature-attributes-panel');
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
    panel.className = 'feature-attributes-panel';

    const commonAttributes = findCommonAttributes(selectedFeatures);

    commonAttributes.forEach(attr => {
        const attrLabel = document.createElement('label');
        attrLabel.textContent = getLabel(attr, selectedFeatures);
        const attrInput = createInput(attr, selectedFeatures[0].properties[attr]);
        attrInput.oninput = (e) => {
            let value = attrInput.type === 'range' || attrInput.type === 'number' ? parseFloat(e.target.value) : e.target.value;
            featureControl.updateFeaturesProperty(selectedFeatures, attr, value);
        };
        panel.appendChild(attrLabel);
        panel.appendChild(attrInput);
    });

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.id = 'SalvarFeat';
    saveButton.onclick = () => {
        featureControl.saveFeatures(selectedFeatures, initialPropertiesMap)
        panel.remove();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        featureControl.discartChangeFeatures(selectedFeatures, initialPropertiesMap)
        panel.remove();
    };

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Deletar';
    deleteButton.onclick = () => {
        featureControl.deleteFeatures(selectedFeatures)
        panel.remove();
    };

    const setDefaultButton = document.createElement('button');
    setDefaultButton.textContent = 'Definir padrão';
    setDefaultButton.onclick = () => {
        featureControl.setDefaultProperties(feature.properties, commonAttributes);
    };

    panel.appendChild(saveButton);
    panel.appendChild(discardButton);
    panel.appendChild(deleteButton);
    panel.appendChild(setDefaultButton);

    document.body.appendChild(panel);
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
        input.min = 0.1;
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
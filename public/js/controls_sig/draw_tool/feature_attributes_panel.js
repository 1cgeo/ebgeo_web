export function addFeatureAttributesToPanel(panel, selectedFeatures, featureControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const initialProperties = { ...feature.properties };
    const initialCoordinates = [...feature.geometry.coordinates];

    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form.
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));
    
    const commonAttributes = findCommonAttributes(selectedFeatures);

    commonAttributes.forEach(attr => {
        const attrLabel = document.createElement('label');
        attrLabel.textContent = getLabel(attr, selectedFeatures);
        const attrInput = createInput(attr, selectedFeatures[0].properties[attr]);
        attrInput.oninput = (e) => {
            let value = attrInput.type === 'range' || attrInput.type === 'number' ? parseFloat(e.target.value) : e.target.value;
            value = attrInput.type === 'checkbox' ? e.target.checked : value;
            featureControl.updateFeaturesProperty(selectedFeatures, attr, value);
        };
        panel.appendChild(attrLabel);
        panel.appendChild(attrInput);
    });

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        featureControl.saveFeatures(selectedFeatures, initialPropertiesMap)
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();
    };
    panel.appendChild(saveButton);

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        featureControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap)
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();
    };
    panel.appendChild(discardButton);

    if (selectedFeatures.length === 1) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.textContent = 'Definir padrão';
        setDefaultButton.onclick = () => {
            featureControl.setDefaultProperties(feature.properties, commonAttributes);
            selectionManager.deselectAllFeatures();
            selectionManager.updateUI();
        };
        panel.appendChild(setDefaultButton);
    }
}

function findCommonAttributes(features) {
    const attributeSets = {
        Point: ['size', 'color', 'opacity'],
        LineString: ['size', 'color', 'opacity', 'measure'],
        Polygon: ['color', 'opacity', 'outlinecolor', 'size', 'measure']
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
        outlinecolor: 'Cor da borda',
        measure: 'Medir'
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
    } else if (attr === 'measure') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = value === true;
    } else {
        input = document.createElement('input');
        input.type = 'number';
        input.value = value !== undefined ? value : 1;
    }
    return input;
}
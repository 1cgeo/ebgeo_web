export function addFeatureAttributesToPanel(panel, selectedFeatures, featureControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form.
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    const commonAttributes = findCommonAttributes(selectedFeatures);

    commonAttributes.forEach(attr => {
        const container = $("<div>", { class: "attr-container-row" });
        const attrLabel = document.createElement('label');
        attrLabel.textContent = getLabel(attr, selectedFeatures);
        const elInput = createInput(
            attr,
            selectedFeatures[0].properties[attr],
            (input, e) => {
                if (attr === 'color' || attr === 'outlinecolor') {
                    featureControl.updateFeaturesProperty(selectedFeatures, attr, `#${e.toHex()}`)
                    return
                }
                let value = input.type === 'range' || input.type === 'number' ? parseFloat(e.target.value) : e.target.value;
                value = input.type === 'checkbox' ? e.target.checked : value;
                featureControl.updateFeaturesProperty(selectedFeatures, attr, value);
                if(attr === 'profile') {
                    selectionManager.updateProfile();
                }
            }
        );
        container.append($("<div>", { class: "attr-name" }).append(attrLabel))
        container.append($("<div>", { class: "attr-input" }).append(elInput))
        $(panel).append(container);

    });

    const container = $("<div>", { class: "attr-container-row" });
    const saveButton = document.createElement('button');
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    saveButton.textContent = 'Salvar';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        featureControl.saveFeatures(selectedFeatures, initialPropertiesMap)
        selectionManager.deselectAllFeatures(true);
    };
    container.append(saveButton)

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    discardButton.onclick = () => {
        featureControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap)
        selectionManager.deselectAllFeatures(true);
    };
    container.append(discardButton)

    if (selectedFeatures.length === 1) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.textContent = 'Definir padrão';
        setDefaultButton.classList.add('tool-button', 'pure-material-tool-button-contained')
        setDefaultButton.onclick = () => {
            featureControl.setDefaultProperties(feature.properties, commonAttributes);
            selectionManager.deselectAllFeatures(true);
        };
        container.append(setDefaultButton)

    }
    $(panel).append(container);
}

function findCommonAttributes(features) {
    const attributeSets = {
        Point: ['size', 'color', 'opacity'],
        LineString: ['size', 'color', 'opacity', 'measure', 'profile'],
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
        measure: 'Medir',
        profile: 'Perfil do terreno'
    };

    if (attr === 'size') {
        const hasPolygon = features.some(feature => feature.geometry.type === 'Polygon');
        if (hasPolygon) {
            return features.length === 1 ? 'Largura da borda' : 'Tamanho';
        }
    }

    return labels[attr] || attr;
}

function createInput(attr, value, inputCallback) {
    let input;
    if (attr === 'color' || attr === 'outlinecolor') {
        input = document.createElement('input');
        input.classList.add("picker-color");
        input.type = 'text';
        input.value = value || '#000000';
    } else if (attr === 'opacity') {
        input = document.createElement('input');
        input.classList.add("slider");
        input.type = 'range';
        input.min = 0.1;
        input.max = 1;
        input.step = 0.1;
        input.value = value !== undefined ? value : 1;
    } else if (attr === 'size') {
        input = document.createElement('input');
        input.classList.add("slider");
        input.type = 'range';
        input.min = 1
        input.max = 30;
        input.step = 1;
        input.value = value !== undefined ? value : 1;
    }
    else if (attr === 'measure' || attr === 'profile') {
        let label = $("<label>", { class: "switch" })
        input = document.createElement('input');
        input.classList.add("slider-check-input");
        input.type = 'checkbox';
        input.checked = value === true;
        label.append(input)
        label.append($("<div>", { class: "slider-check round" }))
        input.oninput = (e) => inputCallback(input, e)
        return label
    } else {
        input = document.createElement('input');
        input.type = 'number';
        input.value = value !== undefined ? value : 1;
    }
    input.oninput = (e) => inputCallback(input, e)
    return input;
}
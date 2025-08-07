// Path: js\controls_sig\draw_tool\feature_attributes_panel.js

export function addFeatureAttributesToPanel(panel, selectedFeatures, featureControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form.
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    const commonAttributes = findCommonAttributes(selectedFeatures);

    commonAttributes.forEach(attr => {
        if (attr === 'profile' && selectedFeatures.length !== 1) {
            return;
        }
        const container = $("<div>", { class: "attr-container-row" });
        const attrLabel = document.createElement('label');
        attrLabel.textContent = getLabel(attr, selectedFeatures);
        const elInput = createInput(
            attr,
            selectedFeatures[0].properties[attr],
            (input, e) => {
                let value = input.type === 'range' || input.type === 'number' ? parseFloat(e.target.value) : e.target.value;
                value = input.type === 'checkbox' ? e.target.checked : value;
                featureControl.updateFeaturesProperty(selectedFeatures, attr, value);
                if(attr === 'profile') {
                    selectionManager.updateProfile();
                }
            },
            feature.geometry.type
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
        const allPolygons = features.every(feature => feature.geometry.type === 'Polygon');
        if (allPolygons) {
            return 'Largura da borda';
        } else {
            return 'Tamanho';
        }
    }

    return labels[attr] || attr;
}

function createInput(attr, value, inputCallback, geometryType) {
    let input;
    if (attr === 'color' || attr === 'outlinecolor') {
        input = document.createElement('input');
        input.classList.add("picker-color");
        input.type = 'color';
        input.value = value || '#000000';
        input.oninput = (e) => inputCallback(input, e);
    } else if (attr === 'opacity') {
        // Use enhanced slider with numeric input for opacity
        const container = document.createElement('div');
        container.className = 'slider-numeric-container';
        container.style.cssText = 'display: flex; gap: 8px; align-items: center; width: 100%;';
        
        const slider = document.createElement('input');
        slider.classList.add("slider");
        slider.type = 'range';
        slider.min = 0.1;
        slider.max = 1;
        slider.step = 0.1;
        slider.value = value !== undefined ? value : 1;
        slider.style.cssText = 'flex-grow: 1;';
        
        const numericInput = document.createElement('input');
        numericInput.type = 'number';
        numericInput.min = 0.1;
        numericInput.max = 1;
        numericInput.step = 0.1;
        numericInput.value = value !== undefined ? value : 1;
        numericInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; text-align: center;';
        
        // Sync slider and input
        slider.oninput = (e) => {
            numericInput.value = e.target.value;
            inputCallback({ type: 'range' }, e);
        };
        
        numericInput.oninput = (e) => {
            let val = parseFloat(e.target.value);
            val = Math.max(0.1, Math.min(1, val));
            slider.value = val;
            numericInput.value = val;
            const fakeEvent = { target: { value: val } };
            inputCallback({ type: 'range' }, fakeEvent);
        };
        
        container.appendChild(slider);
        container.appendChild(numericInput);
        return container;
    } else if (attr === 'size') {
        // Use enhanced slider with numeric input for size
        const minValue = geometryType === 'Point' ? 6 : 2;
        const maxValue = geometryType === 'Point' ? 16 : 30;
        
        const container = document.createElement('div');
        container.className = 'slider-numeric-container';
        container.style.cssText = 'display: flex; gap: 8px; align-items: center; width: 100%;';
        
        const slider = document.createElement('input');
        slider.classList.add("slider");
        slider.type = 'range';
        slider.min = minValue;
        slider.max = maxValue;
        slider.step = 1;
        slider.value = value !== undefined ? value : 1;
        slider.style.cssText = 'flex-grow: 1;';
        
        const numericInput = document.createElement('input');
        numericInput.type = 'number';
        numericInput.min = minValue;
        numericInput.max = maxValue;
        numericInput.step = 1;
        numericInput.value = value !== undefined ? value : 1;
        numericInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; text-align: center;';
        
        // Sync slider and input
        slider.oninput = (e) => {
            numericInput.value = e.target.value;
            inputCallback({ type: 'range' }, e);
        };
        
        numericInput.oninput = (e) => {
            let val = parseFloat(e.target.value);
            val = Math.max(minValue, Math.min(maxValue, val));
            slider.value = val;
            numericInput.value = val;
            const fakeEvent = { target: { value: val } };
            inputCallback({ type: 'range' }, fakeEvent);
        };
        
        container.appendChild(slider);
        container.appendChild(numericInput);
        return container;
    } else if (attr === 'measure' || attr === 'profile') {
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
        input.oninput = (e) => inputCallback(input, e);
    }
    
    return input;
}
// Path: js\controls_sig\text_tool\text_attributes_panel.js

// Helper function to create slider with numeric input
function createSliderWithInput(config) {
    const container = document.createElement('div');
    container.className = 'slider-numeric-container';
    container.style.cssText = 'display: flex; gap: 8px; align-items: center; width: 100%;';
    
    // Create slider
    const slider = document.createElement('input');
    slider.classList.add("slider");
    slider.type = 'range';
    slider.min = config.min;
    slider.max = config.max;
    slider.step = config.step;
    slider.value = config.value;
    slider.style.cssText = 'flex-grow: 1;';
    
    // Create numeric input
    const numericInput = document.createElement('input');
    numericInput.type = 'number';
    numericInput.min = config.min;
    numericInput.max = config.max;
    numericInput.step = config.step;
    numericInput.value = config.value;
    numericInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; text-align: center;';
    
    // Add unit if provided
    if (config.unit) {
        numericInput.placeholder = config.unit;
        numericInput.title = `Valor em ${config.unit}`;
    }
    
    // Função para validar e clampar valores
    const clampValue = (value) => {
        return Math.max(config.min, Math.min(config.max, value));
    };
    
    // Sync slider -> input
    slider.oninput = (e) => {
        const value = parseFloat(e.target.value);
        numericInput.value = value;
        config.onChange(value);
    };
    
    // Sync input -> slider
    numericInput.oninput = (e) => {
        let value = parseFloat(e.target.value);
        
        // Handle NaN or empty values
        if (isNaN(value)) {
            value = config.value; // Reset to initial value
        } else {
            value = clampValue(value);
        }
        
        slider.value = value;
        numericInput.value = value;
        config.onChange(value);
    };
    
    // Handle blur to ensure valid value
    numericInput.onblur = (e) => {
        let value = parseFloat(e.target.value);
        if (isNaN(value)) {
            value = config.value;
        } else {
            value = clampValue(value);
        }
        numericInput.value = value;
        slider.value = value;
        config.onChange(value);
    };
    
    container.appendChild(slider);
    container.appendChild(numericInput);
    
    return container;
}

// Helper function to create color picker
function createColorPicker(value, onChange, title) {
    const colorInput = document.createElement('input');
    colorInput.classList.add("picker-color");
    colorInput.type = 'color';
    colorInput.value = value || '#000000';
    
    if (title) {
        colorInput.title = title;
    }
    
    colorInput.oninput = onChange;
    
    return colorInput;
}

export function addTextAttributesToPanel(panel, selectedFeatures, textControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    if (selectedFeatures.length === 1) {
        const textLabel = document.createElement('label');
        textLabel.textContent = 'Texto:';
        const textInput = document.createElement('textarea');
        textInput.value = feature.properties.text;
        textInput.rows = 3;
        textInput.oninput = (e) => {
            updateJustifyButtons(e.target.value);
            textControl.updateFeaturesProperty(selectedFeatures, 'text', e.target.value);
            uiManager.updateSelectionHighlight();
        };
        $(panel).append(
            $("<div>", { class: "attr-container-column" })
                .append($("<div>", { class: "attr-name" }).append(textLabel))
                .append($("<div>", { class: "attr-input" }).append(textInput))
        )
    }

    // Size with slider and numeric input
    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho:';
    const sizeControl = createSliderWithInput({
        min: 1,
        max: 72,
        step: 1,
        value: feature.properties.size,
        unit: 'px',
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'size', parseInt(value, 10));
            uiManager.updateSelectionHighlight();
        }
    });
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(sizeLabel))
            .append($("<div>", { class: "attr-input" }).append(sizeControl))
    );

    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Cor:';
    const colorInput = createColorPicker(feature.properties.color, (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    }, 'Cor do texto');
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(colorLabel))
            .append($("<div>", { class: "attr-input" }).append(colorInput))
    );

    const backgroundColorLabel = document.createElement('label');
    backgroundColorLabel.textContent = 'Cor da borda:';
    const backgroundColorInput = createColorPicker(feature.properties.backgroundColor, (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'backgroundColor', e.target.value);
    }, 'Cor da borda do texto');
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(backgroundColorLabel))
            .append($("<div>", { class: "attr-input" }).append(backgroundColorInput))
    );

    // Rotation with slider and numeric input
    const rotateLabel = document.createElement('label');
    rotateLabel.textContent = 'Rotação:';
    const rotateControl = createSliderWithInput({
        min: -180,
        max: 180,
        step: 1,
        value: feature.properties.rotation || 0,
        unit: '°',
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'rotation', parseInt(value, 10));
            uiManager.updateSelectionHighlight();
        }
    });
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(rotateLabel))
            .append($("<div>", { class: "attr-input" }).append(rotateControl))
    );

    const justifyLabel = document.createElement('label');
    justifyLabel.textContent = 'Justificativa:';
    const justifyContainer = $("<div>", { class: "attr-container-row" })
    // Initialize button variables
    let justifyLeftButton, justifyCenterButton, justifyRightButton;
    const justifyOptions = ['left', 'center', 'right'];
    justifyOptions.forEach(option => {
        const button = document.createElement('button');
        button.innerHTML = option[0].toUpperCase();
        button.title = `Align ${option}`;
        button.onclick = () => {
            textControl.updateFeaturesProperty(selectedFeatures, 'justify', option);
        };
        justifyContainer.append(button);

        // Assign buttons to variables
        if (option === 'left') {
            justifyLeftButton = button;
        } else if (option === 'center') {
            justifyCenterButton = button;
        } else if (option === 'right') {
            justifyRightButton = button;
        }
    });
    $(panel).append(
        $("<div>", { class: "attr-container-column" })
            .append($("<div>", { class: "attr-name" }).append(justifyLabel))
            .append($("<div>", { class: "attr-input" }).append(justifyContainer))
    );

    const updateJustifyButtons = (text) => {
        const lines = text.split('\n').length;
        const enabled = lines > 1;
        justifyLeftButton.disabled = !enabled;
        justifyCenterButton.disabled = !enabled;
        justifyRightButton.disabled = !enabled;
    };

    updateJustifyButtons(feature.properties.text);

    const buttonsContainer = $("<div>", { class: "attr-container-row" })
    $(panel).append(buttonsContainer)

    const saveButton = document.createElement('button');
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    saveButton.textContent = 'Salvar';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        textControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    buttonsContainer.append(saveButton);

    const discardButton = document.createElement('button');
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        textControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    buttonsContainer.append(discardButton);

    if (selectedFeatures.length === 1) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.classList.add('tool-button', 'pure-material-tool-button-contained')
        setDefaultButton.textContent = 'Definir padrão';
        setDefaultButton.onclick = () => {
            textControl.setDefaultProperties(feature.properties);
            selectionManager.deselectAllFeatures();
        };
        buttonsContainer.append(setDefaultButton);
    }
}
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

    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho:';
    const sizeInput = document.createElement('input');
    sizeInput.classList.add("slider");
    sizeInput.type = 'range';
    sizeInput.step = 1;
    sizeInput.min = 1;
    sizeInput.value = feature.properties.size;
    sizeInput.oninput = (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'size', parseInt(e.target.value, 10));
        uiManager.updateSelectionHighlight();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(sizeLabel))
            .append($("<div>", { class: "attr-input" }).append(sizeInput))
    )

    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Cor:';
    const colorInput = document.createElement('input');
    colorInput.classList.add("picker-color");
    colorInput.type = 'text';
    colorInput.value = feature.properties.color;
    colorInput.oninput = (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'color', `#${e.toHex()}`)
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(colorLabel))
            .append($("<div>", { class: "attr-input" }).append(colorInput))
    )

    const backgroundColorLabel = document.createElement('label');
    backgroundColorLabel.textContent = 'Cor da borda:';
    const backgroundColorInput = document.createElement('input');
    backgroundColorInput.classList.add("picker-color");
    backgroundColorInput.type = 'text';
    backgroundColorInput.value = feature.properties.backgroundColor;
    backgroundColorInput.oninput = (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'backgroundColor', `#${e.toHex()}`)
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(backgroundColorLabel))
            .append($("<div>", { class: "attr-input" }).append(backgroundColorInput))
    )

    const rotateLabel = document.createElement('label');
    rotateLabel.textContent = 'Rotação:';
    const rotateInput = document.createElement('input');
    rotateInput.type = 'number';
    rotateInput.value = feature.properties.rotation;
    rotateInput.oninput = (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'rotation', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(rotateLabel))
            .append($("<div>", { class: "attr-input" }).append(rotateInput))
    )

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
    )

    const updateJustifyButtons = (text) => {
        const lines = text.split('\n').length;
        const enabled = lines > 1;
        justifyLeftButton.disabled = !enabled;
        justifyCenterButton.disabled = !enabled;
        justifyRightButton.disabled = !enabled;
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(backgroundColorLabel))
            .append($("<div>", { class: "attr-input" }).append(backgroundColorInput))
    )

    updateJustifyButtons(feature.properties.text);


    const buttonsContainer = $("<div>", { class: "attr-container-row" })
    $(panel).append(buttonsContainer)

    const saveButton = document.createElement('button');
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    saveButton.textContent = 'Save';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        textControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();
    };
    buttonsContainer.append(saveButton);

    const discardButton = document.createElement('button');
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        textControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();
    };
    buttonsContainer.append(discardButton);

    if (selectedFeatures.length === 1) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.classList.add('tool-button', 'pure-material-tool-button-contained')
        setDefaultButton.textContent = 'Set as Default';
        setDefaultButton.onclick = () => {
            textControl.setDefaultProperties(feature.properties);
            selectionManager.deselectAllFeatures();
            selectionManager.updateUI();
        };
        buttonsContainer.append(setDefaultButton);
    }
}
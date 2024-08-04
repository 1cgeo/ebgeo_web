export function addLOSAttributesToPanel(panel, selectedFeatures, losControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacidade:';
    const opacityInput = document.createElement('input');
    opacityInput.classList.add("slider");
    opacityInput.type = 'range';
    opacityInput.min = 0.1;
    opacityInput.max = 1;
    opacityInput.step = 0.1;
    opacityInput.value = feature.properties.opacity;
    opacityInput.oninput = (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'opacity', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(opacityLabel))
            .append($("<div>", { class: "attr-input" }).append(opacityInput))
    )

    const widthLabel = document.createElement('label');
    widthLabel.textContent = 'Largura:';
    const widthInput = document.createElement('input');
    widthInput.classList.add("slider");
    widthInput.type = 'range';
    widthInput.min = 1;
    widthInput.max = 30;
    widthInput.step = 1;
    widthInput.value = feature.properties.width;
    widthInput.oninput = (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'width', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(widthLabel))
            .append($("<div>", { class: "attr-input" }).append(widthInput))
    )

    const addAttributeRow = (labelText, inputElement) => {
        const container = $("<div>", { class: "attr-container-row" });
        const label = document.createElement('label');
        label.textContent = labelText;
        container.append($("<div>", { class: "attr-name" }).append(label));
        container.append($("<div>", { class: "attr-input" }).append(inputElement));
        $(panel).append(container);
    };

    const createCheckbox = (checked, onChange) => {
        const label = $("<label>", { class: "switch" });
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.classList.add("slider-check-input");
        label.append(input);
        label.append($("<div>", { class: "slider-check round" }));
        input.onchange = onChange;
        return label;
    };

    const mostrarTamanhoCheckbox = createCheckbox(feature.properties.measure || false, (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'measure', e.target.checked);
    });
    addAttributeRow('Mostrar tamanho:', mostrarTamanhoCheckbox);

    const mostrarPerfilCheckbox = createCheckbox(feature.properties.profile || false, (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'profile', e.target.checked);
        selectionManager.updateProfile();
    });
    addAttributeRow('Mostrar perfil:', mostrarPerfilCheckbox);

    const saveButton = document.createElement('button');
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    saveButton.textContent = 'Salvar';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        losControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    const discardButton = document.createElement('button');
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        losControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append(saveButton)
            .append(discardButton)
    )

    document.body.appendChild(panel);
}

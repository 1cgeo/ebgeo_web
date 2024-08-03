export function addLOSAttributesToPanel(panel, selectedFeatures, losControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    const createInput = (type, value, min, max, step, onChange) => {
        const input = document.createElement('input');
        input.type = type;
        input.value = value;
        input.min = min;
        input.max = max;
        input.step = step;
        input.classList.add("slider");
        input.oninput = onChange;
        return input;
    };

    const addAttributeRow = (labelText, inputElement) => {
        const container = $("<div>", { class: "attr-container-row" });
        const label = document.createElement('label');
        label.textContent = labelText;
        container.append($("<div>", { class: "attr-name" }).append(label));
        container.append($("<div>", { class: "attr-input" }).append(inputElement));
        $(panel).append(container);
    };

    const opacityInput = createInput('range', feature.properties.opacity, 0, 1, 0.1, (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'opacity', parseFloat(e.target.value));
    });
    addAttributeRow('Opacidade:', opacityInput);

    const widthInput = createInput('range', feature.properties.width || 1, 1, 30, 1, (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'width', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    });
    addAttributeRow('Largura:', widthInput);

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
        selectionManager.updateUI();
    });
    addAttributeRow('Mostrar perfil:', mostrarPerfilCheckbox);

    const createButton = (text, onClick) => {
        const button = document.createElement('button');
        button.textContent = text;
        button.classList.add('tool-button', 'pure-material-tool-button-contained');
        button.onclick = onClick;
        return button;
    };

    const buttonContainer = $("<div>", { class: "attr-container-row" });

    const saveButton = createButton('Salvar', () => {
        losControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    });
    buttonContainer.append(saveButton);

    const discardButton = createButton('Descartar', () => {
        losControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    });
    buttonContainer.append(discardButton);

    $(panel).append(buttonContainer);
}

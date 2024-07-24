export function addLOSAttributesToPanel(panel, selectedFeatures, losControl, selectionManager, uiManager) {
    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacidade:';
    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = 0;
    opacityInput.max = 1;
    opacityInput.step = 0.1;
    opacityInput.value = feature.properties.opacity;
    opacityInput.oninput = (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'opacity', parseFloat(e.target.value));
        uiManager.updateSelectionHighlight();
    };
    panel.appendChild(opacityLabel);
    panel.appendChild(opacityInput);

    const mostrarTamanhoLabel = document.createElement('label');
    mostrarTamanhoLabel.textContent = 'Mostrar tamanho:';
    const mostrarTamanhoCheckbox = document.createElement('input');
    mostrarTamanhoCheckbox.type = 'checkbox';
    mostrarTamanhoCheckbox.checked = feature.properties.mostrarTamanho || false;
    mostrarTamanhoCheckbox.onchange = (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'measure', e.target.checked);
        uiManager.updateSelectionHighlight();
    };
    panel.appendChild(mostrarTamanhoLabel);
    panel.appendChild(mostrarTamanhoCheckbox);

    const mostrarPerfilLabel = document.createElement('label');
    mostrarPerfilLabel.textContent = 'Mostrar perfil:';
    const mostrarPerfilCheckbox = document.createElement('input');
    mostrarPerfilCheckbox.type = 'checkbox';
    mostrarPerfilCheckbox.checked = feature.properties.mostrarPerfil || false;
    mostrarPerfilCheckbox.onchange = (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'profile', e.target.checked);
        uiManager.updateSelectionHighlight();
    };
    panel.appendChild(mostrarPerfilLabel);
    panel.appendChild(mostrarPerfilCheckbox);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        losControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();
    };
    panel.appendChild(saveButton);

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        losControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();
    };
    panel.appendChild(discardButton);
}
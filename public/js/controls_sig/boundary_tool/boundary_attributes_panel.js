// js/controls_sig/boundary_tool/boundary_attributes_panel.js
export function addBoundaryAttributesToPanel(panel, selectedFeatures, boundaryControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    // ✅ Função auxiliar padronizada para color picker
    function createColorPicker(value, onChange, title) {
        const input = document.createElement('input');
        input.classList.add("picker-color");
        input.type = 'color';
        input.value = value || '#000000';
        input.title = title || '';
        input.style.cssText = 'width: 40px; height: 30px; border: none; border-radius: 4px; cursor: pointer;';
        input.oninput = onChange;
        return input;
    }

    // ========== PROPRIEDADES ESPECÍFICAS DA FERRAMENTA ==========
    
    // Dropdown de Escalão
    const echelonLabel = document.createElement('label');
    echelonLabel.textContent = 'Escalão:';
    const echelonSelect = document.createElement('select');
    echelonSelect.style.cssText = 'width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px;';
    
    const echelonOptions = [
        { value: 'XXXXXX', text: 'XXXXXX' },
        { value: 'XXXXX', text: 'XXXXX' },
        { value: 'XXXX', text: 'XXXX' },
        { value: 'XXX', text: 'XXX' },
        { value: 'XX', text: 'XX' },
        { value: 'X', text: 'X' },
        { value: 'III', text: 'III' },
        { value: 'II', text: 'II' },
        { value: 'I', text: 'I' },
        { value: 'ooo', text: '•••' },
        { value: 'oo', text: '••' },
        { value: 'o', text: '•' }
    ];
    
    echelonOptions.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.text;
        if (option.value === feature.properties.echelon) opt.selected = true;
        echelonSelect.appendChild(opt);
    });
    
    echelonSelect.onchange = (e) => {
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'echelon', e.target.value);
        uiManager.updateSelectionHighlight();
    };

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(echelonLabel))
            .append($("<div>", { class: "attr-input" }).append(echelonSelect))
    );

    // Texto Superior
    const textTopLabel = document.createElement('label');
    textTopLabel.textContent = 'Texto Superior:';
    const textTopInput = document.createElement('input');
    textTopInput.type = 'text';
    textTopInput.value = feature.properties.textTop || '';
    textTopInput.placeholder = 'Ex: 244';
    textTopInput.style.cssText = 'width: calc(100% - 10px); padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px;';
    textTopInput.oninput = (e) => {
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'textTop', e.target.value);
        uiManager.updateSelectionHighlight();
    };

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(textTopLabel))
            .append($("<div>", { class: "attr-input" }).append(textTopInput))
    );

    // Texto Inferior  
    const textBottomLabel = document.createElement('label');
    textBottomLabel.textContent = 'Texto Inferior:';
    const textBottomInput = document.createElement('input');
    textBottomInput.type = 'text';
    textBottomInput.value = feature.properties.textBottom || '';
    textBottomInput.placeholder = 'Ex: 155';
    textBottomInput.style.cssText = 'width: calc(100% - 10px); padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px;';
    textBottomInput.oninput = (e) => {
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'textBottom', e.target.value);
        uiManager.updateSelectionHighlight();
    };

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(textBottomLabel))
            .append($("<div>", { class: "attr-input" }).append(textBottomInput))
    );

    // Cor da Linha
    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Cor:';
    const colorInput = createColorPicker(feature.properties.color, (e) => {
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha de divisão');

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(colorLabel))
            .append($("<div>", { class: "attr-input" }).append(colorInput))
    );

    // Espessura da Linha
    const lineWidthLabel = document.createElement('label');
    lineWidthLabel.textContent = 'Espessura:';
    const lineWidthInput = document.createElement('input');
    lineWidthInput.type = 'number';
    lineWidthInput.min = '1';
    lineWidthInput.max = '10';
    lineWidthInput.step = '1';
    lineWidthInput.value = feature.properties.lineWidth || 4;
    lineWidthInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px;';
    lineWidthInput.oninput = (e) => {
        const value = parseInt(e.target.value, 10);
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
        uiManager.updateSelectionHighlight();
    };

    const lineWidthContainer = document.createElement('div');
    lineWidthContainer.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    lineWidthContainer.appendChild(lineWidthInput);

    const lineWidthUnit = document.createElement('span');
    lineWidthUnit.textContent = 'px';
    lineWidthUnit.style.cssText = 'font-size: 12px; color: #666;';
    lineWidthContainer.appendChild(lineWidthUnit);

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(lineWidthLabel))
            .append($("<div>", { class: "attr-input" }).append(lineWidthContainer))
    );

    // ========== BOTÕES DE AÇÃO PADRONIZADOS ==========
    
    const buttonContainer = $("<div>", { class: "attr-container-row" });

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        boundaryControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    discardButton.onclick = () => {
        boundaryControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    // Botão "Definir padrão" (apenas para seleção única)
    if (selectedFeatures.length === 1) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.textContent = 'Definir padrão';
        setDefaultButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        setDefaultButton.onclick = () => {
            boundaryControl.setDefaultProperties(feature.properties);
            selectionManager.deselectAllFeatures();
        };
        buttonContainer.append(setDefaultButton);
    }

    buttonContainer.append(saveButton).append(discardButton);
    $(panel).append(buttonContainer);
}
// js/controls_sig/boundary_tool/boundary_attributes_panel.js
export function addBoundaryAttributesToPanel(panel, selectedFeatures, boundaryControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    // ✅ Função auxiliar padronizada para slider com input numérico
    function createSliderWithInput(config) {
        const container = document.createElement('div');
        container.className = 'slider-numeric-container';
        container.style.cssText = 'display: flex; gap: 8px; align-items: center; width: 100%;';

        const slider = document.createElement('input');
        slider.classList.add("slider");
        slider.type = 'range';
        slider.min = config.min;
        slider.max = config.max;
        slider.step = config.step || 1;
        slider.value = config.value;
        slider.style.cssText = 'flex-grow: 1;';

        const numericInput = document.createElement('input');
        numericInput.type = 'number';
        numericInput.min = config.min;
        numericInput.max = config.max;
        numericInput.step = config.step || 1;
        numericInput.value = config.value;
        numericInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px;';

        // Validação e sincronização
        const clampValue = (value) => Math.max(config.min, Math.min(config.max, value));
        
        slider.oninput = (e) => {
            const value = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            numericInput.value = value;
            config.onChange(value);
        };

        numericInput.oninput = (e) => {
            let value = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            value = clampValue(value);
            slider.value = value;
            numericInput.value = value;
            config.onChange(value);
        };

        container.appendChild(slider);
        container.appendChild(numericInput);

        if (config.unit) {
            const unit = document.createElement('span');
            unit.textContent = config.unit;
            unit.style.cssText = 'font-size: 12px; color: #666; min-width: 20px;';
            container.appendChild(unit);
        }

        return container;
    }

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

    // Slider de Tamanho do Símbolo
    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho do Símbolo:';
    const sizeControl = createSliderWithInput({
        min: 50,
        max: 500,
        step: 10,
        value: feature.properties.symbolSize || 100,
        unit: 'm',
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'symbolSize', value);
            // Recalcular textScaleFactor baseado no novo tamanho
            const scaleFactor = value / 100; // 100 é o tamanho base
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'textScaleFactor', scaleFactor);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(sizeLabel))
            .append($("<div>", { class: "attr-input" }).append(sizeControl))
    );

    // Slider de Posição do Símbolo
    const positionLabel = document.createElement('label');
    positionLabel.textContent = 'Posição do Símbolo:';
    const positionControl = createSliderWithInput({
        min: 0.1,
        max: 0.9,
        step: 0.05,
        value: feature.properties.symbolPositionRatio || 0.5,
        unit: '',
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'symbolPositionRatio', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(positionLabel))
            .append($("<div>", { class: "attr-input" }).append(positionControl))
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
    const lineWidthControl = createSliderWithInput({
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.lineWidth || 4,
        unit: 'px',
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(lineWidthLabel))
            .append($("<div>", { class: "attr-input" }).append(lineWidthControl))
    );

    // Opacidade
    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacidade:';
    const opacityControl = createSliderWithInput({
        min: 0.1,
        max: 1,
        step: 0.1,
        value: feature.properties.opacity || 1,
        unit: '',
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'opacity', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(opacityLabel))
            .append($("<div>", { class: "attr-input" }).append(opacityControl))
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
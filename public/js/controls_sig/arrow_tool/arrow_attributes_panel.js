// Path: js\controls_sig\arrow_tool\arrow_attributes_panel.js
export function addArrowAttributesToPanel(panel, selectedFeatures, arrowControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // Função auxiliar para criar checkbox
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

    // Função auxiliar melhorada para slider com input numérico
    function createSliderWithInput(config) {
        const container = document.createElement('div');
        container.className = 'slider-numeric-container';
        container.style.cssText = 'display: flex; gap: 12px; align-items: center; width: 100%;';

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
        numericInput.style.cssText = 'width: 80px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; text-align: center;';

        // Função para arredondar valores
        const roundToStep = (value, step) => {
            return Math.round(value / step) * step;
        };

        // Função para validar e clampar valores
        const clampValue = (value) => Math.max(config.min, Math.min(config.max, value));
        
        // Debounce timer para input manual
        let debounceTimer = null;

        // Sync slider -> input (com arredondamento)
        slider.oninput = (e) => {
            const rawValue = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            const value = roundToStep(rawValue, config.step || 1);
            numericInput.value = value;
            config.onChange(value);
        };

        // Sync input -> slider (com debounce)
        numericInput.oninput = (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                let value = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
                
                if (isNaN(value)) {
                    value = config.value;
                } else {
                    value = roundToStep(clampValue(value), config.step || 1);
                }
                
                slider.value = value;
                numericInput.value = value;
                config.onChange(value);
            }, 300);
        };

        // Validação robusta ao sair do input
        numericInput.onblur = (e) => {
            clearTimeout(debounceTimer);
            let value = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            
            if (isNaN(value)) {
                value = config.value;
            } else {
                value = roundToStep(clampValue(value), config.step || 1);
            }
            
            numericInput.value = value;
            slider.value = value;
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

    // Função auxiliar padronizada para color picker
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

    // Função auxiliar para criar linha de atributo
    function createAttributeRow(labelText, inputElement) {
        const container = $("<div>", { class: "attr-container-row" });
        const label = document.createElement('label');
        label.textContent = labelText;
        
        container.append($("<div>", { class: "attr-name" }).append(label));
        container.append($("<div>", { class: "attr-input" }).append(inputElement));
        
        return container;
    }

    // ========== PROPRIEDADES ESPECÍFICAS DA SETA ==========
    
    // Checkbox "Seta" para mostrar/ocultar cabeça
    const showArrowHeadCheckbox = createCheckbox(feature.properties.showArrowHead !== false, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'showArrowHead', e.target.checked);
        uiManager.updateSelectionHighlight();
    });

    $(panel).append(createAttributeRow('Seta:', showArrowHeadCheckbox));

    // Slider de Largura (m) - com step de 1 metro
    const widthControl = createSliderWithInput({
        min: 10,
        max: 10000,
        step: 1,
        value: feature.properties.width || 500,
        unit: 'm',
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'width', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Largura:', widthControl));

    // Cor de preenchimento
    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor de preenchimento da seta');

    $(panel).append(createAttributeRow('Cor de preenchimento:', fillColorInput));

    // Cor da borda
    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da borda da seta');

    $(panel).append(createAttributeRow('Cor da borda:', lineColorInput));

    // Opacidade do preenchimento
    const fillOpacityControl = createSliderWithInput({
        min: 0.1,
        max: 1,
        step: 0.1,
        value: feature.properties.fillOpacity || 0.8,
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'fillOpacity', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Opacidade do preenchimento:', fillOpacityControl));

    // Largura da borda (não largura da seta)
    const lineWidthControl = createSliderWithInput({
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.lineWidth || 3,
        unit: 'px',
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Largura da borda:', lineWidthControl));

    // Checkbox Aeromóvel / Aeroterrestre
    const airmobileCheckbox = createCheckbox(feature.properties.airmobile || false, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'airmobile', e.target.checked);
        uiManager.updateSelectionHighlight();
    });

    $(panel).append(createAttributeRow('Aeromóvel / Aeroterrestre:', airmobileCheckbox));

    // ========== BOTÕES DE AÇÃO PADRONIZADOS ==========
    
    const buttonContainer = $("<div>", { class: "attr-container-row" });

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        arrowControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    discardButton.onclick = () => {
        arrowControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    // Botão "Definir padrão" (apenas para seleção única)
    if (selectedFeatures.length === 1) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.textContent = 'Definir padrão';
        setDefaultButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        setDefaultButton.onclick = () => {
            // Copiar propriedades para usar como padrão
            const defaultProps = {
                width: feature.properties.width,
                fillColor: feature.properties.fillColor,
                lineColor: feature.properties.lineColor,
                lineWidth: feature.properties.lineWidth,
                fillOpacity: feature.properties.fillOpacity,
                headLengthRatio: feature.properties.headLengthRatio || 1.5,
                showArrowHead: feature.properties.showArrowHead !== false,
                airmobile: feature.properties.airmobile || false,
                airmobilePosition: feature.properties.airmobilePosition || 0.7
            };
            arrowControl.setDefaultProperties(defaultProps);
            selectionManager.deselectAllFeatures();
        };
        buttonContainer.append(setDefaultButton);
    }

    buttonContainer.append(saveButton).append(discardButton);
    $(panel).append(buttonContainer);
}
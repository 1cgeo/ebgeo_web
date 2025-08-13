// js/controls_sig/arrow_tool/arrow_attributes_panel.js
export function addArrowAttributesToPanel(panel, selectedFeatures, arrowControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    // ✅ Função auxiliar para criar checkbox (fornecida pelo usuário)
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

    // ✅ Função auxiliar para criar linha de atributo
    function createAttributeRow(labelText, inputElement) {
        const container = $("<div>", { class: "attr-container-row" });
        const label = document.createElement('label');
        label.textContent = labelText;
        
        container.append($("<div>", { class: "attr-name" }).append(label));
        container.append($("<div>", { class: "attr-input" }).append(inputElement));
        
        return container;
    }

    // ========== PROPRIEDADES ESPECÍFICAS DA SETA ==========
    
    // ✅ Cor de preenchimento
    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor de preenchimento da seta');

    $(panel).append(createAttributeRow('Cor de preenchimento:', fillColorInput));

    // ✅ Cor da borda
    const lineColorInput = createColorPicker(feature.properties.lineColor || feature.properties.color, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        // Manter retrocompatibilidade
        arrowControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da borda da seta');

    $(panel).append(createAttributeRow('Cor da borda:', lineColorInput));

    // ✅ Opacidade do preenchimento
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

    // ✅ Largura da borda (não largura da seta)
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

    // ✅ NOVO: Checkbox Aeromóvel/Aeroterrestre
    const airmobileCheckbox = createCheckbox(feature.properties.airmobile || false, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'airmobile', e.target.checked);
        uiManager.updateSelectionHighlight();
    });

    $(panel).append(createAttributeRow('Aeromóvel / Aeroterrestre:', airmobileCheckbox));

    // ✅ Proporção da cabeça (somente informativo - não editável)
    const headRatioLabel = document.createElement('label');
    headRatioLabel.textContent = 'Proporção da cabeça:';
    const headRatioValue = document.createElement('span');
    const currentHeadRatio = feature.properties.headLengthRatio !== undefined ? 
        feature.properties.headLengthRatio : 1.5; // ✅ RETROCOMPATIBILIDADE
    headRatioValue.textContent = `${currentHeadRatio.toFixed(1)}x`;
    headRatioValue.style.cssText = 'font-size: 14px; color: #666; font-weight: 500;';

    // Adicionar texto explicativo
    const headRatioHelp = document.createElement('div');
    headRatioHelp.textContent = 'Use o handle verde na ponta para ajustar';
    headRatioHelp.style.cssText = 'font-size: 11px; color: #888; margin-top: 2px;';

    const headRatioContainer = document.createElement('div');
    headRatioContainer.appendChild(headRatioValue);
    headRatioContainer.appendChild(headRatioHelp);

    $(panel).append(createAttributeRow('Proporção da cabeça:', headRatioContainer));

    // ✅ NOVO: Posição do X (somente informativo - só aparece se aeromóvel estiver ativo)
    if (feature.properties.airmobile) {
        const xPositionLabel = document.createElement('label');
        xPositionLabel.textContent = 'Posição do X:';
        const xPositionValue = document.createElement('span');
        const currentXPosition = feature.properties.airmobilePosition !== undefined ? 
            feature.properties.airmobilePosition : 0.7;
        xPositionValue.textContent = `${(currentXPosition * 100).toFixed(0)}%`;
        xPositionValue.style.cssText = 'font-size: 14px; color: #666; font-weight: 500;';

        // Adicionar texto explicativo
        const xPositionHelp = document.createElement('div');
        xPositionHelp.textContent = 'Use o handle roxo na linha para ajustar';
        xPositionHelp.style.cssText = 'font-size: 11px; color: #888; margin-top: 2px;';

        const xPositionContainer = document.createElement('div');
        xPositionContainer.appendChild(xPositionValue);
        xPositionContainer.appendChild(xPositionHelp);

        $(panel).append(createAttributeRow('Posição do X:', xPositionContainer));
    }

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
            // Copiar propriedades para usar como padrão
            const defaultProps = {
                width: feature.properties.width,
                fillColor: feature.properties.fillColor,
                lineColor: feature.properties.lineColor,
                lineWidth: feature.properties.lineWidth,
                fillOpacity: feature.properties.fillOpacity,
                headLengthRatio: feature.properties.headLengthRatio !== undefined ? 
                    feature.properties.headLengthRatio : 1.5, // ✅ RETROCOMPATIBILIDADE
                airmobile: feature.properties.airmobile || false, // ✅ NOVA PROPRIEDADE
                airmobilePosition: feature.properties.airmobilePosition !== undefined ? 
                    feature.properties.airmobilePosition : 0.7 // ✅ NOVA PROPRIEDADE
            };
            arrowControl.setDefaultProperties(defaultProps);
            selectionManager.deselectAllFeatures();
        };
        buttonContainer.append(setDefaultButton);
    }

    buttonContainer.append(saveButton).append(discardButton);
    $(panel).append(buttonContainer);
}
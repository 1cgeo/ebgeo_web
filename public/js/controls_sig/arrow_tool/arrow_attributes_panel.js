// js/controls_sig/arrow_tool/arrow_attributes_panel.js
export function addArrowAttributesToPanel(panel, selectedFeatures, arrowControl, selectionManager, uiManager) {
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
        slider.value = Math.abs(config.value); // Sempre trabalhar com valor absoluto no slider
        slider.style.cssText = 'flex-grow: 1;';

        const numericInput = document.createElement('input');
        numericInput.type = 'number';
        numericInput.min = config.min;
        numericInput.max = config.max;
        numericInput.step = config.step || 1;
        numericInput.value = Math.abs(config.value); // Sempre trabalhar com valor absoluto no input
        numericInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px;';

        // Validação e sincronização
        const clampValue = (value) => Math.max(config.min, Math.min(config.max, value));
        
        slider.oninput = (e) => {
            const value = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            numericInput.value = value;
            // Manter o sinal original da largura
            const originalSign = Math.sign(config.value) || 1;
            config.onChange(value * originalSign);
        };

        numericInput.oninput = (e) => {
            let value = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            value = clampValue(value);
            slider.value = value;
            numericInput.value = value;
            // Manter o sinal original da largura
            const originalSign = Math.sign(config.value) || 1;
            config.onChange(value * originalSign);
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
    
    // Cor da seta
    const colorInput = createColorPicker(feature.properties.color, (e) => {
        arrowControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da seta');

    $(panel).append(createAttributeRow('Cor:', colorInput));

    // Largura da seta
    const widthControl = createSliderWithInput({
        min: 100,
        max: 5000,
        step: 50,
        value: feature.properties.width || 1000,
        unit: 'm',
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'width', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Largura:', widthControl));

    // Opacidade
    const opacityControl = createSliderWithInput({
        min: 0.1,
        max: 1,
        step: 0.1,
        value: feature.properties.opacity || 0.8,
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'opacity', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

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
                color: feature.properties.color,
                fillColor: feature.properties.fillColor,
                lineWidth: feature.properties.lineWidth,
                fillOpacity: feature.properties.fillOpacity,
                lineOpacity: feature.properties.lineOpacity
            };
            arrowControl.setDefaultProperties(defaultProps);
            selectionManager.deselectAllFeatures();
        };
        buttonContainer.append(setDefaultButton);
    }

    buttonContainer.append(saveButton).append(discardButton);
    $(panel).append(buttonContainer);
}
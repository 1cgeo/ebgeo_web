// Path: js\controls_sig\ellipse_tool\ellipse_attributes_panel.js

export function addEllipseAttributesToPanel(panel, selectedFeatures, ellipseControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    // Função auxiliar para criar slider com input numérico
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

        const unit = document.createElement('span');
        unit.textContent = config.unit || '';
        unit.style.cssText = 'font-size: 12px; color: #666; min-width: 20px;';

        slider.oninput = (e) => {
            const value = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            numericInput.value = value;
            config.onChange(value);
        };

        numericInput.oninput = (e) => {
            let value = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            value = Math.max(config.min, Math.min(config.max, value));
            slider.value = value;
            numericInput.value = value;
            config.onChange(value);
        };

        container.appendChild(slider);
        container.appendChild(numericInput);
        if (config.unit) container.appendChild(unit);

        return container;
    }

    // Função auxiliar para criar color picker
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

    // ===== PROPRIEDADES ESPECÍFICAS DA ELIPSE =====

    // Cor da linha
    const lineColorLabel = document.createElement('label');
    lineColorLabel.textContent = 'Cor da linha:';
    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        ellipseControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha da elipse');

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(lineColorLabel))
            .append($("<div>", { class: "attr-input" }).append(lineColorInput))
    );

    // Cor do preenchimento
    const fillColorLabel = document.createElement('label');
    fillColorLabel.textContent = 'Cor do preenchimento:';
    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        ellipseControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor do preenchimento da elipse');

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(fillColorLabel))
            .append($("<div>", { class: "attr-input" }).append(fillColorInput))
    );

    // Opacidade
    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Opacidade:';
    const opacityControl = createSliderWithInput({
        min: 0,
        max: 1,
        step: 0.1,
        value: feature.properties.opacity !== undefined ? feature.properties.opacity : 0.7,
        unit: '',
        onChange: (value) => {
            ellipseControl.updateFeaturesProperty(selectedFeatures, 'opacity', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(opacityLabel))
            .append($("<div>", { class: "attr-input" }).append(opacityControl))
    );

    // Largura da linha
    const lineWidthLabel = document.createElement('label');
    lineWidthLabel.textContent = 'Largura da linha:';
    const lineWidthControl = createSliderWithInput({
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.lineWidth || 2,
        unit: 'px',
        onChange: (value) => {
            ellipseControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(lineWidthLabel))
            .append($("<div>", { class: "attr-input" }).append(lineWidthControl))
    );

    // Eixo maior (somente informativo)
    const majorRadiusLabel = document.createElement('label');
    majorRadiusLabel.textContent = 'Eixo maior:';
    const majorRadiusValue = document.createElement('span');
    majorRadiusValue.textContent = `${Math.round(feature.properties.majorRadius || 1500)} m`;
    majorRadiusValue.style.cssText = 'font-size: 14px; color: #666; font-weight: 500;';

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(majorRadiusLabel))
            .append($("<div>", { class: "attr-input" }).append(majorRadiusValue))
    );

    // Eixo menor (somente informativo)
    const minorRadiusLabel = document.createElement('label');
    minorRadiusLabel.textContent = 'Eixo menor:';
    const minorRadiusValue = document.createElement('span');
    minorRadiusValue.textContent = `${Math.round(feature.properties.minorRadius || 800)} m`;
    minorRadiusValue.style.cssText = 'font-size: 14px; color: #666; font-weight: 500;';

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(minorRadiusLabel))
            .append($("<div>", { class: "attr-input" }).append(minorRadiusValue))
    );

    // Rotação/Orientação (somente informativo)
    const bearingLabel = document.createElement('label');
    bearingLabel.textContent = 'Orientação:';
    const bearingValue = document.createElement('span');
    bearingValue.textContent = `${Math.round(feature.properties.bearing || 0)}°`;
    bearingValue.style.cssText = 'font-size: 14px; color: #666; font-weight: 500;';

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(bearingLabel))
            .append($("<div>", { class: "attr-input" }).append(bearingValue))
    );

    // ===== INFORMAÇÕES ADICIONAIS =====
    
    // Área aproximada (somente leitura)
    const area = Math.PI * feature.properties.majorRadius * feature.properties.minorRadius;
    const areaLabel = document.createElement('label');
    areaLabel.textContent = 'Área aproximada:';
    const areaValue = document.createElement('span');
    areaValue.textContent = `${(area / 1000000).toFixed(2)} km²`;
    areaValue.style.cssText = 'font-size: 12px; color: #666; font-style: italic;';

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append(areaLabel))
            .append($("<div>", { class: "attr-input" }).append(areaValue))
    );

    // ===== BOTÕES DE AÇÃO =====
    const buttonContainer = $("<div>", { class: "attr-container-row" });

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        ellipseControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    discardButton.onclick = () => {
        ellipseControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    // Botão "Definir padrão" (apenas para seleção única)
    if (selectedFeatures.length === 1) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.textContent = 'Definir padrão';
        setDefaultButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        setDefaultButton.onclick = () => {
            ellipseControl.setDefaultProperties(feature.properties);
            selectionManager.deselectAllFeatures();
        };
        buttonContainer.append(setDefaultButton);
    }

    buttonContainer.append(saveButton).append(discardButton);
    $(panel).append(buttonContainer);
}
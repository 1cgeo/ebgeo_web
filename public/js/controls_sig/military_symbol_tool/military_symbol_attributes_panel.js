// Path: js\controls_sig\military_symbol_tool\military_symbol_attributes_panel.js

import { MILITARY_DATA } from './military_constants.js';

export function addMilitarySymbolAttributesToPanel(panel, selectedFeatures, militarySymbolControl, selectionManager, uiManager) {
    if (!selectedFeatures || selectedFeatures.length === 0) return;
    
    const feature = selectedFeatures[0];
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    // Slider com input numérico
    function createSliderWithInput(config) {
        const container = document.createElement('div');
        container.className = 'slider-numeric-container';
        container.style.cssText = 'display: flex; gap: 8px; align-items: center; width: 100%;';
        
        const slider = document.createElement('input');
        slider.classList.add("slider");
        slider.type = 'range';
        slider.min = config.min;
        slider.max = config.max;
        slider.step = config.step;
        slider.value = config.value;
        slider.style.cssText = 'flex-grow: 1;';
        
        const numericInput = document.createElement('input');
        numericInput.type = 'number';
        numericInput.min = config.min;
        numericInput.max = config.max;
        numericInput.step = config.step;
        numericInput.value = config.value;
        numericInput.style.cssText = 'width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; text-align: center;';
        
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

    // Botão para abrir modal do símbolo
    const symbolButton = document.createElement('button');
    symbolButton.classList.add('tool-button', 'pure-material-button-contained');
    symbolButton.textContent = 'Símbolo...';
    symbolButton.style.cssText = 'width: 100%; margin-bottom: 15px; padding: 10px;';
    symbolButton.onclick = () => openSymbolModal();
    
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append($("<label>").text('Configurar:')))
            .append($("<div>", { class: "attr-input" }).append(symbolButton))
    );

    // Controles de renderização
    const sizeControl = createSliderWithInput({
        min: 20,
        max: 200,
        step: 5,
        value: feature.properties.size || 35,
        unit: 'px',
        onChange: (value) => {
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'size', value);
            uiManager.updateSelectionHighlight();
        }
    });
    
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append($("<label>").text('Tamanho:')))
            .append($("<div>", { class: "attr-input" }).append(sizeControl))
    );

    const opacityControl = createSliderWithInput({
        min: 0.1,
        max: 1,
        step: 0.1,
        value: feature.properties.opacity || 1.0,
        onChange: (value) => {
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'opacity', value);
            uiManager.updateSelectionHighlight();
        }
    });
    
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append($("<label>").text('Opacidade:')))
            .append($("<div>", { class: "attr-input" }).append(opacityControl))
    );

    const rotationControl = createSliderWithInput({
        min: -180,
        max: 180,
        step: 15,
        value: feature.properties.rotation || 0,
        unit: '°',
        onChange: (value) => {
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'rotation', value);
            uiManager.updateSelectionHighlight();
        }
    });
    
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append($("<label>").text('Rotação:')))
            .append($("<div>", { class: "attr-input" }).append(rotationControl))
    );

    // Botões de ação
    const buttonsContainer = $("<div>", { class: "attr-container-row" });

    const saveButton = document.createElement('button');
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    saveButton.textContent = 'Salvar';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        militarySymbolControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    buttonsContainer.append(saveButton);

    const discardButton = document.createElement('button');
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        militarySymbolControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    buttonsContainer.append(discardButton);

    if (selectedFeatures.length === 1) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        setDefaultButton.textContent = 'Definir padrão';
        setDefaultButton.onclick = () => {
            militarySymbolControl.setDefaultProperties(feature.properties);
            selectionManager.deselectAllFeatures();
        };
        buttonsContainer.append(setDefaultButton);
    }

    $(panel).append(buttonsContainer);

    // Modal do símbolo
    function openSymbolModal() {
        const modalOverlay = document.createElement('div');
        modalOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 20px;
            max-width: 750px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        const modalTitle = document.createElement('h2');
        modalTitle.textContent = 'Configurar Símbolo Militar';
        modalTitle.style.cssText = 'margin-top: 0; margin-bottom: 20px; text-align: center;';
        modal.appendChild(modalTitle);

        const modalContent = document.createElement('div');
        modalContent.style.cssText = 'display: flex; gap: 20px;';

        const controlsColumn = document.createElement('div');
        controlsColumn.style.cssText = 'flex: 1; min-width: 320px;';

        const previewColumn = document.createElement('div');
        previewColumn.style.cssText = 'flex: 0 0 200px; text-align: center;';

        // Preview container
        const previewContainer = document.createElement('div');
        previewContainer.style.cssText = `
            border: 2px solid #ddd;
            border-radius: 8px;
            padding: 20px;
            background: #f9f9f9;
            min-height: 150px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const previewImage = document.createElement('img');
        previewImage.style.cssText = 'max-width: 100%; max-height: 150px;';
        previewContainer.appendChild(previewImage);

        const previewLabel = document.createElement('h4');
        previewLabel.textContent = 'Preview';
        previewLabel.style.cssText = 'margin-bottom: 10px;';

        // SIDC display
        const sidcLabel = document.createElement('div');
        sidcLabel.style.cssText = `
            margin-top: 10px;
            padding: 8px;
            background: #f8f9fa;
            border-radius: 4px;
            font-family: monospace;
            font-size: 12px;
            word-break: break-all;
            color: #495057;
        `;

        previewColumn.appendChild(previewLabel);
        previewColumn.appendChild(previewContainer);
        previewColumn.appendChild(sidcLabel);

        // Combobox para modal
        function createModalComboBox(options, currentValue, onChange, label) {
            const container = document.createElement('div');
            container.style.cssText = 'margin-bottom: 15px;';

            const labelElement = document.createElement('label');
            labelElement.textContent = label + ':';
            labelElement.style.cssText = 'display: block; margin-bottom: 5px; font-weight: bold;';

            const select = document.createElement('select');
            select.style.cssText = 'width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;';
            
            options.forEach(option => {
                const opt = document.createElement('option');
                opt.value = option.value;
                opt.textContent = option.label;
                if (option.value === currentValue) opt.selected = true;
                select.appendChild(opt);
            });
            
            select.onchange = (e) => onChange(e.target.value);

            container.appendChild(labelElement);
            container.appendChild(select);
            return container;
        }

        // Propriedades temporárias para o modal
        let tempProperties = { ...feature.properties };

        // Layout de duas colunas
        const comboboxesContainer = document.createElement('div');
        comboboxesContainer.style.cssText = 'display: flex; gap: 15px;';

        const column1 = document.createElement('div');
        column1.style.cssText = 'flex: 1;';

        const column2 = document.createElement('div');
        column2.style.cssText = 'flex: 1;';

        // Primeira coluna
        column1.appendChild(createModalComboBox(
            MILITARY_DATA.affiliations,
            tempProperties.affiliation || "03",
            (value) => { tempProperties.affiliation = value; updatePreview(); },
            'Hostilidade'
        ));

        column1.appendChild(createModalComboBox(
            MILITARY_DATA.dimensions,
            tempProperties.dimension || "10",
            (value) => { tempProperties.dimension = value; updatePreview(); },
            'Dimensão'
        ));

        column1.appendChild(createModalComboBox(
            MILITARY_DATA.echelons,
            tempProperties.echelon || "16",
            (value) => { tempProperties.echelon = value; updatePreview(); },
            'Escalão'
        ));

        column1.appendChild(createModalComboBox(
            MILITARY_DATA.mainIcons,
            tempProperties.mainIcon || "121100",
            (value) => { tempProperties.mainIcon = value; updatePreview(); },
            'Ícone Central'
        ));

        // Segunda coluna
        column2.appendChild(createModalComboBox(
            MILITARY_DATA.modifier1,
            tempProperties.modifier1 || "none",
            (value) => { tempProperties.modifier1 = value; updatePreview(); },
            'Modificador 1'
        ));

        column2.appendChild(createModalComboBox(
            MILITARY_DATA.modifier2,
            tempProperties.modifier2 || "00",
            (value) => { tempProperties.modifier2 = value; updatePreview(); },
            'Modificador 2'
        ));

        column2.appendChild(createModalComboBox(
            MILITARY_DATA.modifierTransversal,
            tempProperties.modifierTransversal || "none",
            (value) => { tempProperties.modifierTransversal = value; updatePreview(); },
            'Modificador Transversal'
        ));

        comboboxesContainer.appendChild(column1);
        comboboxesContainer.appendChild(column2);
        controlsColumn.appendChild(comboboxesContainer);

        // Função simplificada de preview (lógica agora está no generator)
        async function updatePreview() {
            try {
                // Construir SIDC usando o generator (que aplica toda a lógica)
                const sidc = militarySymbolControl.symbolGenerator.buildSIDC(tempProperties);
                tempProperties.sidc = sidc;

                // Mostrar SIDC na UI
                sidcLabel.textContent = `SIDC: ${sidc}`;

                // Renderizar símbolo
                const symbol = new ms.Symbol(sidc, {
                    size: 60,
                    frame: true,
                    fill: true,
                    strokeWidth: 2
                });

                previewImage.src = symbol.toDataURL();
                previewImage.style.display = 'block';

            } catch (error) {
                console.error('Erro ao gerar preview:', error);
                previewImage.style.display = 'none';
                sidcLabel.textContent = 'SIDC: Erro';
            }
        }

        // Botões do modal
        const modalButtons = document.createElement('div');
        modalButtons.style.cssText = 'margin-top: 20px; text-align: center; display: flex; gap: 10px; justify-content: center;';

        const applyButton = document.createElement('button');
        applyButton.textContent = 'Aplicar';
        applyButton.style.cssText = `
            padding: 10px 20px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        `;
        applyButton.onclick = async () => {
            // Aplicar mudanças às features selecionadas
            for (const [key, value] of Object.entries(tempProperties)) {
                if (key !== 'id' && key !== 'source') {
                    await militarySymbolControl.updateFeaturesProperty(selectedFeatures, key, value);
                }
            }
            uiManager.updateSelectionHighlight();
            document.body.removeChild(modalOverlay);
        };

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancelar';
        cancelButton.style.cssText = `
            padding: 10px 20px;
            background: #6c757d;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        `;
        cancelButton.onclick = () => document.body.removeChild(modalOverlay);

        modalButtons.appendChild(applyButton);
        modalButtons.appendChild(cancelButton);

        // Montar modal
        modalContent.appendChild(controlsColumn);
        modalContent.appendChild(previewColumn);
        modal.appendChild(modalContent);
        modal.appendChild(modalButtons);
        modalOverlay.appendChild(modal);

        // Fechar modal ao clicar no overlay
        modalOverlay.onclick = (e) => {
            if (e.target === modalOverlay) {
                document.body.removeChild(modalOverlay);
            }
        };

        // Adicionar ao DOM e gerar preview inicial
        document.body.appendChild(modalOverlay);
        updatePreview();
    }
}
// Path: js\controls_sig\military_symbol_tool\military_symbol_attributes_panel.js

import { MILITARY_DATA } from './military_constants.js';

export function addMilitarySymbolAttributesToPanel(panel, selectedFeatures, militarySymbolControl, selectionManager, uiManager) {
    if (!selectedFeatures || selectedFeatures.length === 0) return;
    
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

    // ========== BOTÃO SÍMBOLO ==========
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

    // ========== PROPRIEDADES DE RENDERIZAÇÃO ==========

    // Tamanho
    const sizeControl = createSliderWithInput({
        min: 20,
        max: 80,
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

    // Opacidade
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

    // Rotação
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

    // ========== BOTÕES DE AÇÃO ==========
    const buttonsContainer = $("<div>", { class: "attr-container-row" });

    // Botão Salvar
    const saveButton = document.createElement('button');
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    saveButton.textContent = 'Salvar';
    saveButton.onclick = () => {
        militarySymbolControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    buttonsContainer.append(saveButton);

    // Botão Descartar
    const discardButton = document.createElement('button');
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        militarySymbolControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    buttonsContainer.append(discardButton);

    // Botão Definir Padrão (apenas para seleção única)
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

    // ========== MODAL DE SÍMBOLO ==========
    function openSymbolModal() {
        // Criar overlay do modal
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

        // Criar modal
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

        // Título do modal
        const modalTitle = document.createElement('h2');
        modalTitle.textContent = 'Configurar Símbolo Militar';
        modalTitle.style.cssText = 'margin-top: 0; margin-bottom: 20px; text-align: center;';
        modal.appendChild(modalTitle);

        // Container principal do modal
        const modalContent = document.createElement('div');
        modalContent.style.cssText = 'display: flex; gap: 20px;';

        // Coluna esquerda - Controles
        const controlsColumn = document.createElement('div');
        controlsColumn.style.cssText = 'flex: 1; min-width: 320px;';

        // Coluna direita - Preview
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

        previewColumn.appendChild(previewLabel);
        previewColumn.appendChild(previewContainer);

        // Função auxiliar para criar combobox no modal
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
            
            select.onchange = (e) => {
                onChange(e.target.value);
            };

            container.appendChild(labelElement);
            container.appendChild(select);
            return container;
        }

        // Variáveis temporárias para o modal
        let tempProperties = { ...feature.properties };

        // Container para duas colunas de comboboxes
        const comboboxesContainer = document.createElement('div');
        comboboxesContainer.style.cssText = 'display: flex; gap: 15px;';

        // Primeira coluna de comboboxes
        const column1 = document.createElement('div');
        column1.style.cssText = 'flex: 1;';

        // Segunda coluna de comboboxes
        const column2 = document.createElement('div');
        column2.style.cssText = 'flex: 1;';

        // Adicionar controles à primeira coluna
        column1.appendChild(createModalComboBox(
            MILITARY_DATA.affiliations,
            tempProperties.affiliation || "03",
            (value) => { tempProperties.affiliation = value; updatePreview(); },
            'Hostilidade'
        ));

        column1.appendChild(createModalComboBox(
            MILITARY_DATA.dimensions,
            tempProperties.dimension || "01",
            (value) => { tempProperties.dimension = value; updatePreview(); },
            'Dimensão'
        ));

        column1.appendChild(createModalComboBox(
            MILITARY_DATA.echelons,
            tempProperties.echelon || "Btl",
            (value) => { tempProperties.echelon = value; updatePreview(); },
            'Escalão'
        ));

        column1.appendChild(createModalComboBox(
            MILITARY_DATA.mainIcons,
            tempProperties.mainIcon || "1211",
            (value) => { tempProperties.mainIcon = value; updatePreview(); },
            'Ícone Central'
        ));

        // Adicionar controles à segunda coluna
        column2.appendChild(createModalComboBox(
            MILITARY_DATA.modifier1,
            tempProperties.modifier1 || "00",
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
            tempProperties.modifierTransversal || "00",
            (value) => { tempProperties.modifierTransversal = value; updatePreview(); },
            'Modificador Transversal'
        ));

        // Montar container de comboboxes
        comboboxesContainer.appendChild(column1);
        comboboxesContainer.appendChild(column2);
        controlsColumn.appendChild(comboboxesContainer);

        // Função para atualizar preview
        async function updatePreview() {
            try {
                const sidc = militarySymbolControl.symbolGenerator.buildSIDC(tempProperties);
                tempProperties.sidc = sidc;

                // Gerar preview usando milsymbol
                const symbol = new ms.Symbol(sidc, {
                    size: 60,
                    frame: true,
                    fill: true,
                    strokeWidth: 2,
                    echelon: militarySymbolControl.symbolGenerator.mapEchelonToMilsymbol(tempProperties.echelon)
                });

                previewImage.src = symbol.toDataURL();
                previewImage.style.display = 'block';
            } catch (error) {
                console.error('Erro ao gerar preview:', error);
                previewImage.style.display = 'none';
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
            // Aplicar mudanças
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
        cancelButton.onclick = () => {
            document.body.removeChild(modalOverlay);
        };

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
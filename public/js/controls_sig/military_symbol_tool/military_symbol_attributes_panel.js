// Path: js\controls_sig\military_symbol_tool\military_symbol_attributes_panel.js

import { MILITARY_DATA } from './military_constants.js';

export function addMilitarySymbolAttributesToPanel(panel, selectedFeatures, militarySymbolControl, selectionManager, uiManager) {
    if (!selectedFeatures || selectedFeatures.length === 0) return;
    
    const feature = selectedFeatures[0];
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    // Variável global para rastrear dropdowns abertos
    const openDropdowns = [];
    
    // Função para fechar todos os dropdowns
    function closeAllDropdowns() {
        openDropdowns.forEach(dropdown => {
            if (dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
            }
        });
    }

    // Select com busca (estilo Select2)
    function createDigitalComboBox(options, currentValue, onChange, label) {
        const container = document.createElement('div');
        container.className = 'digital-combo-container';
        container.style.cssText = 'margin-bottom: 20px; position: relative;';

        const labelElement = document.createElement('label');
        labelElement.textContent = label + ':';
        labelElement.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 15px; color: #333;';

        const selectContainer = document.createElement('div');
        selectContainer.style.cssText = 'position: relative;';

        // Display do valor atual (estilo select) - Ajustado para múltiplas linhas
        const selectDisplay = document.createElement('div');
        selectDisplay.style.cssText = `
            width: 100%;
            padding: 15px 40px 15px 15px;
            border: 2px solid #ddd;
            border-radius: 8px;
            font-size: 15px;
            background: #fff;
            cursor: pointer;
            transition: border-color 0.2s;
            box-sizing: border-box;
            position: relative;
        `;

        // Container do texto com tooltip
        const textContainer = document.createElement('div');
        textContainer.style.cssText = `
            flex: 1;
            overflow: hidden;
            word-wrap: break-word;
            hyphens: auto;
        `;
        selectDisplay.appendChild(textContainer);

        // Ícone dropdown
        const dropdownIcon = document.createElement('span');
        dropdownIcon.innerHTML = '▼';
        dropdownIcon.style.cssText = `
            position: absolute;
            right: 12px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 15px;
            pointer-events: none;
            color: #000;
        `;
        selectDisplay.appendChild(dropdownIcon);

        // Dropdown container
        const dropdown = document.createElement('div');
        dropdown.style.cssText = `
            position: fixed;
            background: white;
            border: 2px solid #007bff;
            border-radius: 8px;
            max-height: 250px;
            overflow: hidden;
            z-index: 20000;
            display: none;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        `;

        // Campo de busca dentro do dropdown
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '🔍 Digite para buscar...';
        searchInput.style.cssText = `
            width: 100%;
            padding: 10px 15px;
            border: none;
            border-bottom: 2px solid #e9ecef;
            font-size: 14px;
            outline: none;
            box-sizing: border-box;
            background: #f8f9fa;
        `;

        // Lista de opções
        const optionsList = document.createElement('div');
        optionsList.style.cssText = 'max-height: 200px; overflow-y: auto;';

        dropdown.appendChild(searchInput);
        dropdown.appendChild(optionsList);

        // Adicionar dropdown à lista global para controle
        openDropdowns.push(dropdown);

        // Função para obter texto de exibição da opção (versão melhorada)
        function getOptionDisplayText(option) {
            if (option.entity_portugues) {
                // Se tiver subtype: "entity_type_portugues - entity_subtype_portugues"
                if (option.entity_subtype_portugues && option.entity_type_portugues) {
                    return option.entity_type_portugues + ' - ' + option.entity_subtype_portugues;
                }
                // Se não tiver subtype mas tiver type: "entity_portugues - entity_type_portugues"
                else if (option.entity_type_portugues) {
                    return option.entity_portugues + ' - ' + option.entity_type_portugues;
                }
                // Se não tiver type: apenas "entity_portugues"
                else {
                    return option.entity_portugues;
                }
            }
            return option.label;
        }

        // Função para obter tooltip completo
        function getOptionTooltipText(option) {
            if (option.entity_portugues) {
                const parts = [];
                if (option.entity_portugues) parts.push(option.entity_portugues);
                if (option.entity_type_portugues) parts.push(option.entity_type_portugues);
                if (option.entity_subtype_portugues) parts.push(option.entity_subtype_portugues);
                return parts.join(' → ');
            }
            return option.label;
        }

        // Função para obter texto de exibição hierárquico para dropdown
        function getDropdownDisplayText(option) {
            if (option.entity_portugues) {
                let text = option.entity_portugues;
                if (option.entity_type_portugues) {
                    text += ' → ' + option.entity_type_portugues;
                }
                if (option.entity_subtype_portugues) {
                    text += ' → ' + option.entity_subtype_portugues;
                }
                return text;
            }
            return option.label;
        }

        // Encontrar e exibir valor atual
        const currentOption = options.find(opt => opt.value == currentValue || opt.code == currentValue);
        if (currentOption) {
            const displayText = getOptionDisplayText(currentOption);
            const tooltipText = getOptionTooltipText(currentOption);
            
            textContainer.textContent = displayText;
            textContainer.title = tooltipText;
        }

        // Função para buscar opções
        function searchOptions(searchTerm) {
            if (!searchTerm.trim()) {
                return options;
            }
            
            const term = searchTerm.toLowerCase();
            return options.filter(option => {
                if (option.entity_portugues) {
                    const searchText = [
                        option.entity_portugues,
                        option.entity_type_portugues,
                        option.entity_subtype_portugues
                    ].filter(Boolean).join(' ').toLowerCase();
                    return searchText.includes(term);
                } else {
                    return option.label.toLowerCase().includes(term);
                }
            });
        }

        // Função para criar item do dropdown
        function createDropdownItem(option, isSelected = false) {
            const item = document.createElement('div');
            item.style.cssText = `
                padding: 8px 15px;
                cursor: pointer;
                border-bottom: 1px solid #ddd;
                transition: background-color 0.2s;
                ${isSelected ? 'background-color: #e3f2fd; font-weight: 600;' : ''}
            `;
            
            if (option.entity_portugues) {
                const hierarchy = document.createElement('div');
                
                const mainText = document.createElement('div');
                mainText.textContent = option.entity_portugues;
                mainText.style.cssText = `
                    font-weight: ${isSelected ? '700' : '600'}; 
                    font-size: 14px; 
                    color: #333; 
                    margin-bottom: 2px;
                `;
                hierarchy.appendChild(mainText);

                if (option.entity_type_portugues) {
                    const typeText = document.createElement('div');
                    typeText.textContent = '→ ' + option.entity_type_portugues;
                    typeText.style.cssText = `
                        font-size: 14px; 
                        color: #666; 
                        margin-bottom: 1px; 
                        font-weight: 500;
                        margin-left: 10px;
                    `;
                    hierarchy.appendChild(typeText);
                }

                if (option.entity_subtype_portugues) {
                    const subtypeText = document.createElement('div');
                    subtypeText.textContent = '→ ' + option.entity_subtype_portugues;
                    subtypeText.style.cssText = `
                        font-size: 13px; 
                        color: #888; 
                        font-weight: 400;
                        margin-left: 20px;
                    `;
                    hierarchy.appendChild(subtypeText);
                }
                
                item.appendChild(hierarchy);
            } else {
                item.textContent = option.label;
                item.style.fontSize = '14px';
                item.style.fontWeight = isSelected ? '600' : '500';
                item.style.color = '#333';
            }

            if (!isSelected) {
                item.onmouseenter = () => item.style.backgroundColor = '#f8f9fa';
                item.onmouseleave = () => item.style.backgroundColor = '';
            }
            
            item.onclick = () => {
                const value = option.value || option.code;
                const displayText = getOptionDisplayText(option);
                const tooltipText = getOptionTooltipText(option);
                
                textContainer.textContent = displayText;
                textContainer.title = tooltipText;
                closeDropdown();
                onChange(value);
            };

            return item;
        }

        // Função para mostrar opções no dropdown
        function showOptions(filteredOptions) {
            optionsList.innerHTML = '';
            
            if (filteredOptions.length === 0) {
                const noResults = document.createElement('div');
                noResults.textContent = 'Nenhum resultado encontrado';
                noResults.style.cssText = 'padding: 15px; color: #999; font-style: italic; font-size: 14px; text-align: center;';
                optionsList.appendChild(noResults);
            } else {
                filteredOptions.forEach(option => {
                    const isSelected = (option.value || option.code) === currentValue;
                    optionsList.appendChild(createDropdownItem(option, isSelected));
                });
            }
        }

        // Função para posicionar dropdown
        function positionDropdown() {
            const selectRect = selectDisplay.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;
            
            // Posição inicial (abaixo do select)
            let top = selectRect.bottom + 5;
            let left = selectRect.left;
            let width = selectRect.width;
            
            // Verificar se cabe na tela verticalmente
            if (top + 250 > viewportHeight) {
                // Se não cabe embaixo, colocar em cima
                top = selectRect.top - 255;
                
                // Se ainda não cabe em cima, ajustar altura
                if (top < 10) {
                    top = 10;
                    dropdown.style.maxHeight = (selectRect.top - 20) + 'px';
                }
            }
            
            // Verificar se cabe na tela horizontalmente
            if (left + width > viewportWidth) {
                left = viewportWidth - width - 20;
            }
            
            dropdown.style.top = top + 'px';
            dropdown.style.left = left + 'px';
            dropdown.style.width = width + 'px';
        }

        // Função para abrir dropdown
        function openDropdown() {
            // Fechar todos os outros dropdowns primeiro
            closeAllDropdowns();
            
            positionDropdown();
            showOptions(options);
            dropdown.style.display = 'block';
            searchInput.value = '';
            searchInput.focus();
        }

        // Função para fechar dropdown
        function closeDropdown() {
            dropdown.style.display = 'none';
        }

        // Event listeners
        selectDisplay.onclick = (e) => {
            e.stopPropagation();
            if (dropdown.style.display === 'block') {
                closeDropdown();
            } else {
                openDropdown();
            }
        };

        searchInput.oninput = () => {
            const filteredOptions = searchOptions(searchInput.value);
            showOptions(filteredOptions);
        };

        // Fechar ao clicar fora
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && !selectDisplay.contains(e.target)) {
                closeDropdown();
            }
        });

        selectContainer.appendChild(selectDisplay);
        document.body.appendChild(dropdown);
        
        container.appendChild(labelElement);
        container.appendChild(selectContainer);

        // Cleanup function
        container._cleanup = () => {
            // Remover da lista global
            const index = openDropdowns.indexOf(dropdown);
            if (index > -1) {
                openDropdowns.splice(index, 1);
            }
            
            if (dropdown.parentNode) {
                dropdown.parentNode.removeChild(dropdown);
            }
        };

        return container;
    }

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
    symbolButton.textContent = 'Configurar Símbolo...';
    symbolButton.style.cssText = 'width: 100%; margin-bottom: 15px; padding: 10px;';
    symbolButton.onclick = () => openSymbolModal();
    
    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append($("<label>").text('SIDC:')))
            .append($("<div>", { class: "attr-input" }).append(symbolButton))
    );

    // Controles de renderização
    const sizeControl = createSliderWithInput({
        min: 0.1,
        max: 5.0,
        step: 0.1,
        value: feature.properties.size || 1.0,
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
            border-radius: 12px;
            padding: 30px;
            width: 95%;
            max-width: 1200px;
            max-height: 95vh;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        `;

        const modalTitle = document.createElement('h2');
        modalTitle.textContent = 'Configurar Símbolo Militar';
        modalTitle.style.cssText = 'margin-top: 0; margin-bottom: 30px; text-align: center; font-size: 24px; color: #333;';
        modal.appendChild(modalTitle);

        const modalContent = document.createElement('div');
        modalContent.style.cssText = 'display: flex; gap: 30px;';

        const controlsColumn = document.createElement('div');
        controlsColumn.style.cssText = 'flex: 1;';

        const previewColumn = document.createElement('div');
        previewColumn.style.cssText = 'flex: 0 0 250px; text-align: center;';

        // Preview container
        const previewContainer = document.createElement('div');
        previewContainer.style.cssText = `
            border: 2px solid #ddd;
            border-radius: 12px;
            padding: 30px;
            background: #f9f9f9;
            min-height: 200px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const previewImage = document.createElement('img');
        previewImage.style.cssText = 'max-width: 100%; max-height: 180px;';
        previewContainer.appendChild(previewImage);

        const previewLabel = document.createElement('h4');
        previewLabel.textContent = 'Visualização';
        previewLabel.style.cssText = 'margin-bottom: 15px; font-size: 16px; color: #333;';

        // SIDC display
        const sidcLabel = document.createElement('div');
        sidcLabel.style.cssText = `
            margin-top: 15px;
            padding: 12px;
            background: #f8f9fa;
            border-radius: 8px;
            font-family: monospace;
            font-size: 12px;
            word-break: break-all;
            color: #495057;
            border: 1px solid #e9ecef;
        `;

        previewColumn.appendChild(previewLabel);
        previewColumn.appendChild(previewContainer);
        previewColumn.appendChild(sidcLabel);

        // Propriedades temporárias para o modal
        let tempProperties = { ...feature.properties };

        // Layout de 8 comboboxes organizados em 2 colunas
        const comboboxesContainer = document.createElement('div');
        comboboxesContainer.style.cssText = 'display: flex; gap: 30px;';

        const column1 = document.createElement('div');
        column1.style.cssText = 'flex: 1;';

        const column2 = document.createElement('div');
        column2.style.cssText = 'flex: 1;';

        // Primeira coluna
        column1.appendChild(createDigitalComboBox(
            MILITARY_DATA.context,
            tempProperties.context || "0",
            (value) => { tempProperties.context = value; updatePreview(); },
            'Contexto'
        ));

        column1.appendChild(createDigitalComboBox(
            MILITARY_DATA.standardIdentity,
            tempProperties.standardIdentity || "3",
            (value) => { tempProperties.standardIdentity = value; updatePreview(); },
            'Identidade Padrão'
        ));

        column1.appendChild(createDigitalComboBox(
            MILITARY_DATA.status,
            tempProperties.status || "0",
            (value) => { tempProperties.status = value; updatePreview(); },
            'Status'
        ));

        column1.appendChild(createDigitalComboBox(
            MILITARY_DATA.hqTfDummy,
            tempProperties.hqTfDummy || "0",
            (value) => { tempProperties.hqTfDummy = value; updatePreview(); },
            'QG/Força-Tarefa/Dummy'
        ));

        // Segunda coluna
        column2.appendChild(createDigitalComboBox(
            MILITARY_DATA.echelon,
            tempProperties.echelon || "16",
            (value) => { tempProperties.echelon = value; updatePreview(); },
            'Escalão'
        ));

        column2.appendChild(createDigitalComboBox(
            MILITARY_DATA.mainIcons,
            tempProperties.mainIcon || "121100",
            (value) => { tempProperties.mainIcon = value; updatePreview(); },
            'Ícone Principal'
        ));

        column2.appendChild(createDigitalComboBox(
            MILITARY_DATA.modifier1,
            tempProperties.modifier1 || "00",
            (value) => { tempProperties.modifier1 = value; updatePreview(); },
            'Modificador 1'
        ));

        column2.appendChild(createDigitalComboBox(
            MILITARY_DATA.modifier2,
            tempProperties.modifier2 || "00",
            (value) => { tempProperties.modifier2 = value; updatePreview(); },
            'Modificador 2'
        ));

        comboboxesContainer.appendChild(column1);
        comboboxesContainer.appendChild(column2);
        controlsColumn.appendChild(comboboxesContainer);

        // Função de preview - CORRIGIDA para usar o generator
        async function updatePreview() {
            try {
                // Construir SIDC usando o generator
                const sidc = militarySymbolControl.symbolGenerator.buildSIDC(tempProperties);
                tempProperties.sidc = sidc;

                // Validar SIDC
                const validation = militarySymbolControl.symbolGenerator.validateSIDC(sidc);
                
                sidcLabel.textContent = `SIDC: ${sidc}`;

                if (!validation.valid) {
                    sidcLabel.style.color = '#dc3545';
                    sidcLabel.innerHTML += `<div style="color: #dc3545;">ERRO: ${validation.error}</div>`;
                } else {
                    sidcLabel.style.color = '#495057';
                }

                // Usar a nova função generatePreviewDataURL que converte para PNG
                const previewDataURL = await militarySymbolControl.symbolGenerator.generatePreviewDataURL(sidc, 80);

                if (previewDataURL) {
                    previewImage.src = previewDataURL;
                    previewImage.style.display = 'block';
                } else {
                    previewImage.style.display = 'none';
                    console.warn('Falha ao gerar preview para SIDC:', sidc);
                }

            } catch (error) {
                console.error('Erro ao gerar preview:', error);
                previewImage.style.display = 'none';
                sidcLabel.innerHTML = `<div style="color: #dc3545;">SIDC: ${tempProperties.sidc || 'N/A'}<br>Erro de renderização</div>`;
            }
        }

        // Botões do modal
        const modalButtons = document.createElement('div');
        modalButtons.style.cssText = 'margin-top: 30px; text-align: center; display: flex; gap: 15px; justify-content: center;';

        const applyButton = document.createElement('button');
        applyButton.textContent = 'Aplicar';
        applyButton.style.cssText = `
            padding: 12px 30px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
            transition: background-color 0.2s;
        `;
        applyButton.onmouseenter = () => applyButton.style.backgroundColor = '#0056b3';
        applyButton.onmouseleave = () => applyButton.style.backgroundColor = '#007bff';
        applyButton.onclick = async () => {
            // Aplicar mudanças às features selecionadas
            for (const [key, value] of Object.entries(tempProperties)) {
                if (key !== 'id' && key !== 'source') {
                    await militarySymbolControl.updateFeaturesProperty(selectedFeatures, key, value);
                }
            }
            militarySymbolControl.saveFeatures(selectedFeatures, initialPropertiesMap);
            closeModal();
            selectionManager.deselectAllFeatures();
        };

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancelar';
        cancelButton.style.cssText = `
            padding: 12px 30px;
            background: #6c757d;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
            transition: background-color 0.2s;
        `;
        cancelButton.onmouseenter = () => cancelButton.style.backgroundColor = '#545b62';
        cancelButton.onmouseleave = () => cancelButton.style.backgroundColor = '#6c757d';
        cancelButton.onclick = () => closeModal();

        modalButtons.appendChild(applyButton);
        modalButtons.appendChild(cancelButton);

        // Função para fechar modal e fazer cleanup
        function closeModal() {
            // Cleanup dos dropdowns
            const comboBoxes = [column1, column2].flatMap(col => Array.from(col.children));
            comboBoxes.forEach(combo => {
                if (combo._cleanup) {
                    combo._cleanup();
                }
            });
            document.body.removeChild(modalOverlay);
        }

        // Montar modal
        modalContent.appendChild(controlsColumn);
        modalContent.appendChild(previewColumn);
        modal.appendChild(modalContent);
        modal.appendChild(modalButtons);
        modalOverlay.appendChild(modal);

        // Fechar modal ao clicar no overlay
        modalOverlay.onclick = (e) => {
            if (e.target === modalOverlay) {
                closeModal();
            }
        };

        // Adicionar ao DOM e gerar preview inicial
        document.body.appendChild(modalOverlay);
        updatePreview();
    }
}
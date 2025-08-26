// Path: js\controls_sig\military_symbol_tool\military_symbol_attributes_panel.js

import { MILITARY_DATA } from './military_constants.js';
import {
    createSliderWithInput,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addMilitarySymbolAttributesToPanel(panel, selectedFeatures, militarySymbolControl, selectionManager, uiManager) {
    if (!selectedFeatures || selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    // ✅ CORRECT: Capture initial properties at panel opening (before any user interaction)
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== CONFIGURAÇÃO DE SÍMBOLO ESPECÍFICA =====
    // ⚠️ MANTER: Modal específico do SIDC
    if (selectedFeatures.length === 1) {

        // Botão para abrir modal do símbolo
        const symbolButton = document.createElement('button');
        symbolButton.classList.add('tool-button', 'pure-material-button-contained');
        symbolButton.textContent = 'Configurar Símbolo...';
        symbolButton.style.cssText = 'width: 100%; margin-bottom: 15px; padding: 10px;';
        symbolButton.onclick = () => openSymbolModal();

        $(panel).append(createAttributeRow('SIDC:', symbolButton));
    }
    // ===== CONTROLES DE RENDERIZAÇÃO =====

    // Tamanho
    const sizeControl = createSliderWithInput(getCommonConfig('size',
        feature.properties.size || 1.0, {
        onChange: (value) => {
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'size', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Tamanho:', sizeControl));

    // Zoom de referência
    const createdAtZoomControl = createSliderWithInput({
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round(feature.properties.createdAtZoom * 10) / 10,
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Zoom de referência:', createdAtZoomControl));

    // Opacidade (0-100%)
    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity || 1.0) * 100), {
        onChange: (value) => {
            // Convert from 0-100 range to 0-1 range for internal storage
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    // Rotação (usando steps de 15 graus)
    const rotationControl = createSliderWithInput({
        min: -180,
        max: 180,
        step: 15,
        value: feature.properties.rotation || 0,
        onChange: (value) => {
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'rotation', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Rotação (°):', rotationControl));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    // ✅ FIXED: Pass initialPropertiesMap captured at panel opening
    const buttons = createStandardButtons({
        selectedFeatures,
        control: militarySymbolControl,
        selectionManager,
        initialPropertiesMap, // ✅ PASS THE ORIGINAL STATE
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => militarySymbolControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);

    // ===== MODAL DO SÍMBOLO (LÓGICA ESPECÍFICA MANTIDA) =====
    // ⚠️ MANTER: Modal complexo específico do military symbol

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

        // Add method to update programmatically
        container.updateValue = (newValue) => {
            currentValue = newValue;
            const newOption = options.find(opt => opt.value == newValue || opt.code == newValue);
            if (newOption) {
                const displayText = getOptionDisplayText(newOption);
                const tooltipText = getOptionTooltipText(newOption);
                textContainer.textContent = displayText;
                textContainer.title = tooltipText;
            }
        };

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

        // ✅ NEW: Editable SIDC field
        const sidcContainer = document.createElement('div');
        sidcContainer.style.cssText = 'margin-top: 15px;';

        const sidcInputLabel = document.createElement('label');
        sidcInputLabel.textContent = 'SIDC:';
        sidcInputLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px; color: #333;';

        const sidcInput = document.createElement('input');
        sidcInput.type = 'text';
        sidcInput.maxLength = 40;
        sidcInput.placeholder = '20 dígitos (ex: 10031000161211000000)';
        sidcInput.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            border: 2px solid #ddd;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            text-align: center;
            transition: border-color 0.2s;
            box-sizing: border-box;
        `;

        sidcContainer.appendChild(sidcInputLabel);
        sidcContainer.appendChild(sidcInput);

        previewColumn.appendChild(previewLabel);
        previewColumn.appendChild(previewContainer);
        previewColumn.appendChild(sidcContainer);

        // Propriedades temporárias para o modal
        let tempProperties = { ...feature.properties };
        let isUpdatingFromSIDC = false; // Flag to prevent infinite loops

        // Layout de 8 comboboxes organizados em 2 colunas
        const comboboxesContainer = document.createElement('div');
        comboboxesContainer.style.cssText = 'display: flex; gap: 30px;';

        const column1 = document.createElement('div');
        column1.style.cssText = 'flex: 1;';

        const column2 = document.createElement('div');
        column2.style.cssText = 'flex: 1;';

        // Store combobox references for programmatic updates
        const comboboxes = {};

        // Primeira coluna
        comboboxes.context = createDigitalComboBox(
            MILITARY_DATA.context,
            tempProperties.context || "0",
            (value) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.context = value;
                    updatePreviewFromComboboxes();
                }
            },
            'Contexto'
        );
        column1.appendChild(comboboxes.context);

        comboboxes.standardIdentity = createDigitalComboBox(
            MILITARY_DATA.standardIdentity,
            tempProperties.standardIdentity || "3",
            (value) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.standardIdentity = value;
                    updatePreviewFromComboboxes();
                }
            },
            'Identidade Padrão'
        );
        column1.appendChild(comboboxes.standardIdentity);

        comboboxes.status = createDigitalComboBox(
            MILITARY_DATA.status,
            tempProperties.status || "0",
            (value) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.status = value;
                    updatePreviewFromComboboxes();
                }
            },
            'Status'
        );
        column1.appendChild(comboboxes.status);

        comboboxes.hqTfDummy = createDigitalComboBox(
            MILITARY_DATA.hqTfDummy,
            tempProperties.hqTfDummy || "0",
            (value) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.hqTfDummy = value;
                    updatePreviewFromComboboxes();
                }
            },
            'QG/Força-Tarefa/Dummy'
        );
        column1.appendChild(comboboxes.hqTfDummy);

        // Segunda coluna
        comboboxes.echelon = createDigitalComboBox(
            MILITARY_DATA.echelon,
            tempProperties.echelon || "16",
            (value) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.echelon = value;
                    updatePreviewFromComboboxes();
                }
            },
            'Escalão'
        );
        column2.appendChild(comboboxes.echelon);

        comboboxes.mainIcon = createDigitalComboBox(
            MILITARY_DATA.mainIcons,
            tempProperties.mainIcon || "121100",
            (value) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.mainIcon = value;
                    updatePreviewFromComboboxes();
                }
            },
            'Ícone Principal'
        );
        column2.appendChild(comboboxes.mainIcon);

        comboboxes.modifier1 = createDigitalComboBox(
            MILITARY_DATA.modifier1,
            tempProperties.modifier1 || "00",
            (value) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.modifier1 = value;
                    updatePreviewFromComboboxes();
                }
            },
            'Modificador 1'
        );
        column2.appendChild(comboboxes.modifier1);

        comboboxes.modifier2 = createDigitalComboBox(
            MILITARY_DATA.modifier2,
            tempProperties.modifier2 || "00",
            (value) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.modifier2 = value;
                    updatePreviewFromComboboxes();
                }
            },
            'Modificador 2'
        );
        column2.appendChild(comboboxes.modifier2);

        comboboxesContainer.appendChild(column1);
        comboboxesContainer.appendChild(column2);
        controlsColumn.appendChild(comboboxesContainer);

        // ✅ NEW: Update preview when comboboxes change
        function updatePreviewFromComboboxes() {
            // Build SIDC from current tempProperties
            const sidc = militarySymbolControl.symbolGenerator.buildSIDC(tempProperties);
            tempProperties.sidc = sidc;

            // Update SIDC input field (without triggering its event)
            sidcInput.value = sidc;

            updatePreview();
        }

        // ✅ NEW: Update comboboxes when SIDC changes
        function updateComboboxesFromSIDC(sidc) {
            try {
                isUpdatingFromSIDC = true;

                const parseResult = militarySymbolControl.symbolGenerator.canParseSIDC(sidc);
                if (!parseResult.canParse) {
                    throw new Error(parseResult.error);
                }

                const parsed = parseResult.properties;

                // Update tempProperties
                tempProperties.context = parsed.context;
                tempProperties.standardIdentity = parsed.standardIdentity;
                tempProperties.status = parsed.status;
                tempProperties.hqTfDummy = parsed.hqTfDummy;
                tempProperties.echelon = parsed.echelon;
                tempProperties.mainIcon = parsed.mainIcon;
                tempProperties.modifier1 = parsed.modifier1;
                tempProperties.modifier2 = parsed.modifier2;
                tempProperties.sidc = sidc;

                // Update all comboboxes visually
                Object.keys(comboboxes).forEach(key => {
                    if (comboboxes[key].updateValue && tempProperties[key] !== undefined) {
                        comboboxes[key].updateValue(tempProperties[key]);
                    }
                });

                sidcInput.style.borderColor = '#28a745'; // Green for valid

            } catch (error) {
                sidcInput.style.borderColor = '#dc3545'; // Red for invalid
                console.warn('Invalid SIDC for parsing:', error.message);
            } finally {
                isUpdatingFromSIDC = false;
            }
        }

        sidcInput.addEventListener('input', (e) => {
            let cleanSIDC = e.target.value.replace(/\s/g, '').trim().substring(0, 20);

            // Update input field with cleaned value
            if (e.target.value !== cleanSIDC) {
                e.target.value = cleanSIDC;
            }

            // Reset border color
            sidcInput.style.borderColor = '#ddd';

            if (cleanSIDC.length === 20) {
                updateComboboxesFromSIDC(cleanSIDC);
                updatePreview();
            } else if (cleanSIDC.length > 0) {
                sidcInput.style.borderColor = '#ffc107'; // Yellow for incomplete
            }
        });

        sidcInput.addEventListener('paste', (e) => {
            setTimeout(() => {
                const cleanSIDC = sidcInput.value.replace(/\s/g, '').trim().substring(0, 20);
                sidcInput.value = cleanSIDC;

                if (cleanSIDC.length === 20) {
                    updateComboboxesFromSIDC(cleanSIDC);
                    updatePreview();
                }
            }, 10);
        });

        // Função de preview - CORRIGIDA para usar o generator
        async function updatePreview() {
            try {
                const sidc = tempProperties.sidc;

                // Validar SIDC
                const validation = militarySymbolControl.symbolGenerator.validateSIDC(sidc);

                if (!validation.valid) {
                    previewImage.style.display = 'none';
                    return;
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
            }
        }

        // Initialize SIDC input field
        sidcInput.value = tempProperties.sidc || militarySymbolControl.symbolGenerator.buildSIDC(tempProperties);

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
            // Apply changes to selected features
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
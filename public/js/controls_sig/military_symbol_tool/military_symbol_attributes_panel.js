// Path: js\controls_sig\military_symbol_tool\military_symbol_attributes_panel.js

import {
    normalizeSIDC,
    BrazilianSIDCExtension
} from './brazilian_sidc_extension.js';
import { checkCatalogWarnings } from './brazilian_svg_postprocessing.js';

import {
    MILITARY_DATA,
    getMainIcons,
    getModifier1,
    getModifier2,
    getEchelonData,
    getSpecialModifierData,
    isCommandApplicable,
    isModifier1Applicable,
    isModifier2Applicable,
    getTextModifiersConfig,
    isEngagementBarApplicable,
    getEngagementBarData
} from './military_constants.js';
import {
    createSliderWithInput,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    createCoordinateEditor,
    createColorPicker,
    createCheckbox,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addMilitarySymbolAttributesToPanel(panel, selectedFeatures, militarySymbolControl, selectionManager, uiManager) {
    if (!selectedFeatures || selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            },
            selectedFeatures,
            selectionManager,
            uiManager
        );
        $(panel).append(headerComponent);
    } else if (selectedFeatures.length > 1) {
        const multiSelectHeader = document.createElement('div');
        multiSelectHeader.className = 'feature-header-with-options';
        
        const infoText = document.createElement('div');
        infoText.className = 'feature-name-wrapper';
        infoText.style.cssText = 'font-size: 14px; color: #666; padding: 6px;';
        infoText.textContent = `${selectedFeatures.length} símbolos militares selecionados`;
        
        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );
        
        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        $(panel).append(multiSelectHeader);
    }

    // ===== CONFIGURAÇÃO DE SÍMBOLO ESPECÍFICA =====
    // ⚠️ MANTER: Modal específico do SIDC
    if (selectedFeatures.length === 1) {

        // Botão para abrir modal do símbolo
        const symbolButton = document.createElement('button');
        symbolButton.classList.add('tool-button', 'pure-material-button-contained');
        symbolButton.textContent = 'Configurar';
        symbolButton.style.cssText = 'width: 100%; margin-bottom: 15px; padding: 10px;';
        symbolButton.onclick = () => openSymbolModal();

        $(panel).append(createAttributeRow('Símbolo:', symbolButton));
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

    // ===== EDITOR DE COORDENADAS (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const coordEditor = createCoordinateEditor(
            feature,
            uiManager,
            async (lat, lng) => {
                const updatedFeature = {
                    ...feature,
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    }
                };
                
                // Update the feature with new coordinates (await to ensure it completes)
                await militarySymbolControl.updateFeatures([updatedFeature], true, false);
                
                uiManager.updateSelectionHighlight();
                
                setTimeout(() => uiManager.updatePanels(), 100);
            },
            false
        );
        $(panel).append(coordEditor);
    }
    const buttons = createStandardButtons({
        selectedFeatures,
        control: militarySymbolControl,
        selectionManager,
        initialPropertiesMap, // ✅ PASS THE ORIGINAL STATE
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => militarySymbolControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);

    // ===== MODAL DO SÍMBOLO =====

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

    function createDigitalComboBox(options, currentValue, onChange, label, simplifiedDisplay = false, displayMode = 'modifier', disableHoverPreview = false) {
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
            pointer-events: none;
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

        let filteredOptions = [...options];
        let highlightedIndex = -1;
        let optionElements = [];

        function getOptionDisplayText(option) {
            if (option.entity_portugues) {
                // For modifiers: show entity_portugues (the main information)
                // For mainIcon: show the most detailed level (deepest in hierarchy)
                if (displayMode === 'mainIcon') {
                    // Main Icon: show deepest level
                    if (option.entity_subtype_portugues) {
                        return option.entity_subtype_portugues;
                    }
                    else if (option.entity_type_portugues) {
                        return option.entity_type_portugues;
                    }
                    else {
                        return option.entity_portugues;
                    }
                } else {
                    // Modifiers: show entity_portugues only
                    return option.entity_portugues;
                }
            }
            return option.label;
        }

        function getOptionTooltipText(option) {
            if (option.entity_portugues) {
                // Always show only the most detailed level available (deepest in hierarchy)
                if (option.entity_subtype_portugues) {
                    return option.entity_subtype_portugues;
                }
                else if (option.entity_type_portugues) {
                    return option.entity_type_portugues;
                }
                else {
                    return option.entity_portugues;
                }
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

            highlightedIndex = options.findIndex(opt => opt.value == currentValue || opt.code == currentValue);
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

        function updateHighlight(index) {
            optionElements.forEach(el => {
                el.style.backgroundColor = '';
                el.style.fontWeight = '';
                el.classList.remove('highlighted');
            });

            if (index >= 0 && index < optionElements.length) {
                highlightedIndex = index;
                const highlightedElement = optionElements[index];

                highlightedElement.style.backgroundColor = '#e3f2fd';
                highlightedElement.style.fontWeight = '600';
                highlightedElement.classList.add('highlighted');

                highlightedElement.scrollIntoView({
                    behavior: 'auto',
                    block: 'nearest'
                });

                const highlightedOption = filteredOptions[index];
                if (highlightedOption) {
                    const value = highlightedOption.value || highlightedOption.code;

                    const displayText = getOptionDisplayText(highlightedOption);
                    const tooltipText = getOptionTooltipText(highlightedOption);
                    textContainer.textContent = displayText;
                    textContainer.title = tooltipText;

                    // Only call onChange if hover preview is enabled
                    if (!disableHoverPreview) {
                        onChange(value, highlightedOption);
                    }
                }
            }
        }

        function handleKeyDown(e) {
            if (dropdown.style.display !== 'block') return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    e.stopPropagation();
                    if (highlightedIndex < filteredOptions.length - 1) {
                        updateHighlight(highlightedIndex + 1);
                    }
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    e.stopPropagation();
                    if (highlightedIndex > 0) {
                        updateHighlight(highlightedIndex - 1);
                    }
                    break;

                case 'Enter':
                    e.preventDefault();
                    e.stopPropagation();
                    if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
                        selectOption(filteredOptions[highlightedIndex]);
                    }
                    break;

                case 'Escape':
                    e.preventDefault();
                    e.stopPropagation();
                    closeDropdown();
                    break;

                case 'Tab':
                    // Allow tab to close dropdown and move to next element
                    closeDropdown();
                    break;
            }
        }

        function selectOption(option) {
            const value = option.value || option.code;
            const displayText = getOptionDisplayText(option);
            const tooltipText = getOptionTooltipText(option);

            textContainer.textContent = displayText;
            textContainer.title = tooltipText;
            currentValue = value;
            closeDropdown();

            onChange(value, option);
        }

        function renderOptions() {
            optionsList.innerHTML = '';
            optionElements = [];

            filteredOptions.forEach((option, index) => {
                const optionElement = document.createElement('div');
                optionElement.style.cssText = `
                    padding: 12px 15px;
                    cursor: pointer;
                    font-size: 14px;
                    transition: background-color 0.1s;
                    color: #333;
                    user-select: none;
                `;

                const displayText = getOptionDisplayText(option);
                optionElement.textContent = displayText;

                // Highlight current value
                const value = option.value || option.code;
                if (value == currentValue) {
                    optionElement.style.backgroundColor = '#e3f2fd';
                    optionElement.style.fontWeight = '600';
                }

                optionElement.onmouseenter = () => {
                    updateHighlight(index);
                };

                optionElement.onclick = (e) => {
                    e.stopPropagation();
                    selectOption(option);
                };

                optionsList.appendChild(optionElement);
                optionElements.push(optionElement);
            });

            // If no options found
            if (filteredOptions.length === 0) {
                const noResultElement = document.createElement('div');
                noResultElement.textContent = 'Nenhuma opção encontrada';
                noResultElement.style.cssText = `
                    padding: 12px 15px;
                    font-size: 14px;
                    color: #999;
                    font-style: italic;
                    text-align: center;
                `;
                optionsList.appendChild(noResultElement);
            }
        }

        function openDropdown() {
            closeAllDropdowns();

            const rect = selectDisplay.getBoundingClientRect();
            dropdown.style.left = `${rect.left}px`;
            dropdown.style.top = `${rect.bottom + 5}px`;
            dropdown.style.width = `${rect.width}px`;
            dropdown.style.display = 'block';

            searchInput.value = '';
            filteredOptions = [...options];
            renderOptions();

            setTimeout(() => searchInput.focus(), 50);

            // Reset highlighted index to current value
            highlightedIndex = filteredOptions.findIndex(opt =>
                (opt.value || opt.code) == currentValue
            );
        }

        function closeDropdown() {
            dropdown.style.display = 'none';
        }

        selectDisplay.onclick = (e) => {
            e.stopPropagation();
            if (dropdown.style.display === 'block') {
                closeDropdown();
            } else {
                openDropdown();
            }
        };

        searchInput.oninput = (e) => {
            const searchTerm = e.target.value;
            filteredOptions = searchOptions(searchTerm);
            renderOptions();
            highlightedIndex = -1;
        };

        searchInput.onkeydown = handleKeyDown;

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target) && !dropdown.contains(e.target)) {
                closeDropdown();
            }
        });

        selectContainer.appendChild(selectDisplay);
        container.appendChild(labelElement);
        container.appendChild(selectContainer);

        // Adicionar dropdown ao body (não ao container)
        document.body.appendChild(dropdown);

        // Add cleanup method
        container._cleanup = () => {
            if (dropdown.parentNode) {
                dropdown.parentNode.removeChild(dropdown);
            }
        };

        // Add updateValue method for programmatic updates
        container.updateValue = (newValue) => {
            currentValue = newValue;
            const option = options.find(opt => (opt.value || opt.code) == newValue);
            if (option) {
                const displayText = getOptionDisplayText(option);
                const tooltipText = getOptionTooltipText(option);
                textContainer.textContent = displayText;
                textContainer.title = tooltipText;
            }
        };

        return container;
    }

    async function createSymbolGallery(onSymbolClick) {
        const galleryColumn = document.createElement('div');
        galleryColumn.style.cssText = 'flex: 0 0 160px; border-left: 2px solid #e9ecef; padding-left: 20px;';

        const galleryTitle = document.createElement('h4');
        galleryTitle.textContent = 'Símbolos do Mapa';
        galleryTitle.style.cssText = 'margin: 0 0 15px 0; font-size: 16px; color: #333; text-align: center;';

        const scrollContainer = document.createElement('div');
        scrollContainer.style.cssText = `
            max-height: 400px;
            overflow-y: auto;
            padding-right: 8px;
        `;

        const gallery = document.createElement('div');
        gallery.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            justify-items: center;
        `;

        // Get distinct symbols by usage
        const distinctSymbols = await militarySymbolControl.getDistinctSymbolsByUsage();

        if (distinctSymbols.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.textContent = 'Nenhum símbolo no mapa';
            emptyMessage.style.cssText = 'color: #999; font-style: italic; font-size: 14px; text-align: center; padding: 20px; grid-column: 1 / -1;';
            gallery.appendChild(emptyMessage);
        } else {
            // Load gallery symbols
            for (const feature of distinctSymbols) {
                try {
                    const sidc = feature.properties.sidc;
                    const dataURL = await militarySymbolControl.symbolGenerator.generatePreviewDataURL(sidc, 60);

                    if (dataURL) {
                        const item = createGalleryItem(feature, dataURL, onSymbolClick);
                        gallery.appendChild(item);
                    }
                } catch (error) {
                    console.warn(`Erro ao gerar símbolo ${feature.properties.id}:`, error);
                    // Skip símbolo com erro
                }
            }
        }

        scrollContainer.appendChild(gallery);
        galleryColumn.appendChild(galleryTitle);
        galleryColumn.appendChild(scrollContainer);

        return galleryColumn;
    }

    function createGalleryItem(feature, dataURL, onSymbolClick) {
        const item = document.createElement('div');
        item.style.cssText = `
            width: 60px;
            height: 60px;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            background: white;
        `;

        const img = document.createElement('img');
        img.src = dataURL;
        img.style.cssText = 'max-width: 50px; max-height: 50px;';
        img.title = `${feature.properties.nome || 'Símbolo'} (${feature.usageCount}x)`;

        // Click handler simples
        item.onclick = () => {
            onSymbolClick(feature.properties.sidc);
        };

        item.appendChild(img);
        return item;
    }

    // ===== NEW: COLOR CONTROL =====

    function createColorControl(currentValue, onChange, label) {
        const container = document.createElement('div');
        container.className = 'color-control-container';
        container.style.cssText = 'margin-bottom: 20px;';

        const labelElement = document.createElement('label');
        labelElement.textContent = label + ':';
        labelElement.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 15px; color: #333;';

        // Container do checkbox e label
        const checkboxContainer = document.createElement('div');
        checkboxContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 12px;';

        // Checkbox usando helper
        const checkbox = createCheckbox(
            !!currentValue, // true se tem cor, false se é padrão
            (e) => {
                const isEnabled = e.target.checked;
                if (isEnabled) {
                    // Habilitar cor personalizada - usar cor atual ou preta
                    const color = currentValue || '#11FF00';
                    onChange(color);
                    updateColorControlState(color);
                } else {
                    // Desabilitar cor personalizada - usar padrão
                    onChange(null);
                    updateColorControlState(null);
                }
            }
        );

        const checkboxLabel = document.createElement('span');
        checkboxLabel.textContent = 'Usar cor personalizada';
        checkboxLabel.style.cssText = 'font-size: 14px; color: #333; cursor: pointer;';

        // Clicar no label também alterna o checkbox
        checkboxLabel.onclick = () => {
            const checkboxInput = checkbox.find('input')[0];
            checkboxInput.click();
        };

        checkboxContainer.appendChild(checkbox[0]);
        checkboxContainer.appendChild(checkboxLabel);

        // Container dos controles de cor
        const controlsContainer = document.createElement('div');
        controlsContainer.style.cssText = 'display: flex; align-items: center; gap: 12px;';

        // Color picker usando helper
        const colorPicker = createColorPicker(
            currentValue || '#11FF00',
            (e) => {
                const color = e.target.value;
                onChange(color);
                updateColorControlState(color);
            },
            'Escolher cor personalizada',
            'current'
        );

        function updateColorControlState(color) {
            const isCustomColor = !!color;
            const checkboxInput = checkbox.find('input')[0];

            // Atualizar checkbox state
            checkboxInput.checked = isCustomColor;

            // Atualizar color picker
            colorPicker.disabled = !isCustomColor;
            colorPicker.style.opacity = isCustomColor ? '1' : '0.5';
            colorPicker.style.cursor = isCustomColor ? 'pointer' : 'not-allowed';

            // Atualizar valor do color picker
            if (isCustomColor) {
                colorPicker.value = color;
            }
        }

        // Estado inicial
        updateColorControlState(currentValue);

        controlsContainer.appendChild(colorPicker);

        container.appendChild(labelElement);
        container.appendChild(checkboxContainer);
        container.appendChild(controlsContainer);

        // Método para atualizar programaticamente
        container.updateValue = (newValue) => {
            updateColorControlState(newValue);
        };

        return container;
    }

    /**
     * Create tab button
     * @param {string} text - Button text
     * @param {boolean} active - Whether button is active
     * @returns {HTMLElement} Button element
     */
    function createTabButton(text, active = false) {
        const button = document.createElement('button');
        button.textContent = text;
        button.style.cssText = `
            flex: 1;
            padding: 12px 20px;
            border: none;
            border-radius: 8px 8px 0 0;
            font-size: 15px;
            font-weight: ${active ? 'bold' : 'normal'};
            cursor: pointer;
            transition: all 0.2s;
            background: ${active ? '#007bff' : '#f5f5f5'};
            color: ${active ? 'white' : '#333'};
        `;

        if (active) {
            button.classList.add('active');
        }

        return button;
    }

    /**
     * Create tabs container with Symbol and Text tabs
     * @returns {Object} Container with tab elements
     */
    function createTabsContainer() {
        const container = document.createElement('div');
        container.style.cssText = 'margin-bottom: 20px;';

        // Tab buttons
        const tabButtonsContainer = document.createElement('div');
        tabButtonsContainer.style.cssText = 'display: flex; gap: 5px; margin-bottom: 0;';

        const simboloButton = createTabButton('Símbolo', true);
        const textoButton = createTabButton('Texto', false);
        const engajamentoButton = createTabButton('Barra de Engajamento', false);

        tabButtonsContainer.appendChild(simboloButton);
        tabButtonsContainer.appendChild(textoButton);
        tabButtonsContainer.appendChild(engajamentoButton);

        // Tab content containers
        const simboloTab = document.createElement('div');
        simboloTab.id = 'simbolo-tab';
        simboloTab.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 40px; width: 100%;';

        const textoTab = document.createElement('div');
        textoTab.id = 'texto-tab';
        textoTab.style.cssText = 'display: none;';

        const engajamentoTab = document.createElement('div');
        engajamentoTab.id = 'engajamento-tab';
        engajamentoTab.style.cssText = 'display: none; padding: 20px;';

        container.appendChild(tabButtonsContainer);
        container.appendChild(simboloTab);
        container.appendChild(textoTab);
        container.appendChild(engajamentoTab);

        return {
            container,
            simboloTab,
            textoTab,
            engajamentoTab,
            tabButtons: { simbolo: simboloButton, texto: textoButton, engajamento: engajamentoButton }
        };
    }

    /**
     * Switch between tabs
     * @param {string} tabName - 'simbolo' or 'texto'
     * @param {Object} tabButtons - Tab button elements
     */
    function switchTab(tabName, tabButtons) {
        const simboloTab = document.getElementById('simbolo-tab');
        const textoTab = document.getElementById('texto-tab');
        const engajamentoTab = document.getElementById('engajamento-tab');
        const { simbolo: simboloButton, texto: textoButton, engajamento: engajamentoButton } = tabButtons;

        simboloTab.style.display = 'none';
        textoTab.style.display = 'none';
        engajamentoTab.style.display = 'none';

        simboloButton.style.background = '#f5f5f5';
        simboloButton.style.color = '#333';
        simboloButton.style.fontWeight = 'normal';
        simboloButton.classList.remove('active');

        textoButton.style.background = '#f5f5f5';
        textoButton.style.color = '#333';
        textoButton.style.fontWeight = 'normal';
        textoButton.classList.remove('active');

        engajamentoButton.style.background = '#f5f5f5';
        engajamentoButton.style.color = '#333';
        engajamentoButton.style.fontWeight = 'normal';
        engajamentoButton.classList.remove('active');

        if (tabName === 'simbolo') {
            simboloTab.style.display = 'grid';
            simboloButton.style.background = '#007bff';
            simboloButton.style.color = 'white';
            simboloButton.style.fontWeight = 'bold';
            simboloButton.classList.add('active');
        } else if (tabName === 'texto') {
            textoTab.style.display = 'block';
            textoButton.style.background = '#007bff';
            textoButton.style.color = 'white';
            textoButton.style.fontWeight = 'bold';
            textoButton.classList.add('active');
        } else if (tabName === 'engajamento') {
            engajamentoTab.style.display = 'block';
            engajamentoButton.style.background = '#007bff';
            engajamentoButton.style.color = 'white';
            engajamentoButton.style.fontWeight = 'bold';
            engajamentoButton.classList.add('active');
        }
    }

    /**
     * Create single text field with label (REFACTORED - removed code display)
     * @param {Object} fieldConfig - Field configuration from catalog
     * @param {string} currentValue - Current field value
     * @param {Function} onChange - Callback when value changes
     * @returns {HTMLElement} Field container element
     */
    function createTextField(fieldConfig, currentValue, onChange) {
        const container = document.createElement('div');
        container.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-bottom: 5px;';

        // Label without code
        const label = document.createElement('label');
        label.textContent = fieldConfig.label;
        label.style.cssText = 'font-size: 14px; font-weight: 600; color: #333;';
        label.title = fieldConfig.tooltip;

        // Input
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentValue || '';
        input.placeholder = fieldConfig.placeholder;
        input.style.cssText = `
            padding: 10px 12px;
            border: 2px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            transition: border-color 0.2s;
            font-family: inherit;
        `;

        // Focus/blur effects
        input.onfocus = () => {
            input.style.borderColor = '#007bff';
            input.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.1)';
        };
        input.onblur = () => {
            input.style.borderColor = '#ddd';
            input.style.boxShadow = 'none';
        };

        // Real-time update
        input.oninput = (e) => onChange(e.target.value);

        container.appendChild(label);
        container.appendChild(input);

        // Store input reference for programmatic updates
        container.inputElement = input;

        return container;
    }

    /**
     * Create text fields container dynamically based on symbol set (REFACTORED - 2 columns, no outer box)
     * @param {string} symbolSetCode - Symbol set code (e.g., "10", "15")
     * @param {Object} tempProperties - Temporary properties object
     * @param {Function} onUpdate - Callback when any field changes
     * @param {Function} getTextModifiersConfig - Function to get text modifiers config
     * @returns {HTMLElement} Container with all text fields
     */
    function createTextFieldsContainer(symbolSetCode, tempProperties, onUpdate, getTextModifiersConfig) {
        const container = document.createElement('div');
        container.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            padding: 20px;
        `;

        const config = getTextModifiersConfig(symbolSetCode);

        if (!config) {
            // Full-width message when not available
            const message = document.createElement('div');
            message.style.cssText = `
                grid-column: 1 / -1;
                padding: 30px;
                text-align: center;
                color: #666;
                background: white;
                border-radius: 8px;
            `;

            const icon = document.createElement('div');
            icon.textContent = 'ℹ️';
            icon.style.cssText = 'font-size: 48px; margin-bottom: 15px;';

            const text = document.createElement('p');
            text.textContent = 'Amplificadores textuais não disponíveis para esta dimensão.';
            text.style.cssText = 'margin: 0; font-size: 16px;';

            const subtext = document.createElement('p');
            subtext.textContent = 'Selecione "Unidades" ou "Equipamentos e Viaturas" na aba Símbolo.';
            subtext.style.cssText = 'margin: 10px 0 0 0; font-size: 14px; color: #999;';

            message.appendChild(icon);
            message.appendChild(text);
            message.appendChild(subtext);
            container.appendChild(message);
            return container;
        }

        // Create input for each text field
        config.fields.forEach((field) => {
            const fieldContainer = createTextField(
                field,
                tempProperties[field.id] || '',
                (value) => {
                    tempProperties[field.id] = value;
                    onUpdate();
                }
            );
            container.appendChild(fieldContainer);
        });

        return container;
    }
    function createEngagementBarContent(tempProperties, onUpdate) {
        const container = document.createElement('div');
        container.style.cssText = 'display: flex; flex-direction: column; gap: 20px; max-width: 600px;';

        const data = getEngagementBarData();

        const stageContainer = document.createElement('div');
        stageContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
        
        const stageLabel = document.createElement('label');
        stageLabel.textContent = 'Estágio do Engajamento:';
        stageLabel.style.cssText = 'font-weight: bold; font-size: 15px; color: #333;';
        
        const stageSelect = document.createElement('select');
        stageSelect.style.cssText = 'padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;';
        
        const stageDefaultOption = document.createElement('option');
        stageDefaultOption.value = '';
        stageDefaultOption.textContent = 'Não Aplicável';
        stageSelect.appendChild(stageDefaultOption);
        
        data.stages.forEach(stage => {
            const option = document.createElement('option');
            option.value = stage.value;
            option.textContent = `${stage.value} - ${stage.label}`;
            stageSelect.appendChild(option);
        });
        
        stageContainer.appendChild(stageLabel);
        stageContainer.appendChild(stageSelect);

        const weaponContainer = document.createElement('div');
        weaponContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
        
        const weaponLabel = document.createElement('label');
        weaponLabel.textContent = 'Armamento/Elemento:';
        weaponLabel.style.cssText = 'font-weight: bold; font-size: 15px; color: #333;';
        
        const weaponSelect = document.createElement('select');
        weaponSelect.style.cssText = 'padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;';
        
        const weaponDefaultOption = document.createElement('option');
        weaponDefaultOption.value = '';
        weaponDefaultOption.textContent = 'Não Aplicável';
        weaponSelect.appendChild(weaponDefaultOption);
        
        data.weapons.forEach(weapon => {
            const option = document.createElement('option');
            option.value = weapon.value;
            option.textContent = `${weapon.value} - ${weapon.label}`;
            weaponSelect.appendChild(option);
        });
        
        weaponContainer.appendChild(weaponLabel);
        weaponContainer.appendChild(weaponSelect);

        const remoteContainer = document.createElement('div');
        remoteContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';
        
        const remoteCheckbox = document.createElement('input');
        remoteCheckbox.type = 'checkbox';
        remoteCheckbox.id = 'engagement-remote';
        remoteCheckbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
        
        const remoteLabel = document.createElement('label');
        remoteLabel.htmlFor = 'engagement-remote';
        remoteLabel.textContent = 'Designação Remota';
        remoteLabel.style.cssText = 'font-size: 14px; color: #333; cursor: pointer;';
        
        remoteContainer.appendChild(remoteCheckbox);
        remoteContainer.appendChild(remoteLabel);

        function updateEngagementBar() {
            const stage = stageSelect.value;
            const weapon = weaponSelect.value;
            const remote = remoteCheckbox.checked;

            if (!stage && !weapon) {
                tempProperties.engagementBar = null;
            } else {
                const prefix = remote ? 'R:' : '';
                let text = '';
                
                if (stage && weapon) {
                    text = `${stage}-${weapon}`;
                } else if (stage) {
                    text = stage;
                } else {
                    text = weapon;
                }
                
                tempProperties.engagementBar = `${prefix}${text}`;
            }
            
            onUpdate();
        }

        stageSelect.addEventListener('change', updateEngagementBar);
        weaponSelect.addEventListener('change', updateEngagementBar);
        remoteCheckbox.addEventListener('change', updateEngagementBar);

        container.appendChild(stageContainer);
        container.appendChild(weaponContainer);
        container.appendChild(remoteContainer);

        container.updateFromProperties = (properties) => {
            const engagementBar = properties.engagementBar;
            if (engagementBar) {
                let processedBar = engagementBar;
                let isRemote = false;
                
                if (processedBar.startsWith('R:')) {
                    isRemote = true;
                    processedBar = processedBar.substring(2);
                }
                
                if (processedBar.includes('-')) {
                    const parts = processedBar.split('-');
                    stageSelect.value = parts[0] || '';
                    weaponSelect.value = parts[1] || '';
                } else {
                    const stageExists = data.stages.some(s => s.value === processedBar);
                    if (stageExists) {
                        stageSelect.value = processedBar;
                        weaponSelect.value = '';
                    } else {
                        stageSelect.value = '';
                        weaponSelect.value = processedBar;
                    }
                }
                remoteCheckbox.checked = isRemote;
            } else {
                stageSelect.value = '';
                weaponSelect.value = '';
                remoteCheckbox.checked = false;
            }
        };

        return container;
    }

    // Modal do símbolo - ATUALIZADO com galeria e controle de cor
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
            max-width: 1400px;
            max-height: 95vh;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        `;

        const modalTitle = document.createElement('h2');
        modalTitle.textContent = 'Configurar Símbolo Militar';
        modalTitle.style.cssText = 'margin-top: 0; margin-bottom: 30px; text-align: center; font-size: 24px; color: #333;';
        modal.appendChild(modalTitle);

        const modalContent = document.createElement('div');
        modalContent.style.cssText = 'display: flex; gap: 20px;'; // Reduzido gap para 3 colunas

        const controlsColumn = document.createElement('div');
        controlsColumn.style.cssText = 'flex: 1;';

        const previewColumn = document.createElement('div');
        previewColumn.style.cssText = 'flex: 0 0 240px; text-align: center;'; // Reduzido ligeiramente

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
        sidcInput.placeholder = '30 dígitos (ex: 10031000161211000000 0760000000)';
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

        const sidcStatusMessage = document.createElement('div');
        sidcStatusMessage.style.cssText = `
            margin-top: 5px;
            font-size: 11px;
            min-height: 16px;
            text-align: center;
        `;

        sidcContainer.appendChild(sidcInputLabel);
        sidcContainer.appendChild(sidcInput);
        sidcContainer.appendChild(sidcStatusMessage);

        previewColumn.appendChild(previewLabel);
        previewColumn.appendChild(previewContainer);
        previewColumn.appendChild(sidcContainer);

        // Propriedades temporárias para o modal
        let tempProperties = { ...feature.properties };
        let isUpdatingFromSIDC = false; // Flag to prevent infinite loops

        const column1 = document.createElement('div');
        column1.style.cssText = 'display: flex; flex-direction: column; gap: 0;';

        const column2 = document.createElement('div');
        column2.style.cssText = 'display: flex; flex-direction: column; gap: 0;';

        // Store combobox references for programmatic updates
        const comboboxes = {};


        // ===== FUNÇÃO DE RECARREGAMENTO DINÂMICO =====
        function reloadDependentComboboxes(symbolSetCode) {
            // ===== REMOVER TODOS OS COMBOS DINÂMICOS DE AMBAS AS COLUNAS =====

            // Column1: remover escalão/mobilidade/liderança se existir
            if (comboboxes.echelon && comboboxes.echelon.parentNode) {
                comboboxes.echelon.remove();
                comboboxes.echelon = null;
            }

            if (comboboxes.directionContainer && comboboxes.directionContainer.parentNode) {
                comboboxes.directionContainer.remove();
                comboboxes.directionContainer = null;
            }

            // Column2: remover todos os dinâmicos
            if (comboboxes.specialModifier && comboboxes.specialModifier.parentNode) {
                comboboxes.specialModifier.remove();
                comboboxes.specialModifier = null;
            }
            if (commandCheckboxContainer && commandCheckboxContainer.parentNode) {
                commandCheckboxContainer.remove();
            }
            if (comboboxes.mainIcon && comboboxes.mainIcon.parentNode) {
                comboboxes.mainIcon.remove();
                comboboxes.mainIcon = null;
            }
            if (comboboxes.modifier1 && comboboxes.modifier1.parentNode) {
                comboboxes.modifier1.remove();
                comboboxes.modifier1 = null;
            }
            if (comboboxes.modifier2 && comboboxes.modifier2.parentNode) {
                comboboxes.modifier2.remove();
                comboboxes.modifier2 = null;
            }
            if (comboboxes.colorControl && comboboxes.colorControl.parentNode) {
                comboboxes.colorControl.remove();
                comboboxes.colorControl = null;
            }

            // ===== COLUMN 1: ADICIONAR ESCALÃO/MOBILIDADE/LIDERANÇA (ÚLTIMA POSIÇÃO) =====
            const echelonData = getEchelonData(symbolSetCode);
            if (echelonData.applicable) {
                comboboxes.echelon = createDigitalComboBox(
                    echelonData.data,
                    tempProperties.echelon || "00",
                    (value) => {
                        if (!isUpdatingFromSIDC) {
                            tempProperties.echelon = value;
                            updatePreviewFromComboboxes();
                        }
                    },
                    echelonData.label
                );
                column1.appendChild(comboboxes.echelon);
            }

            const directionApplicable = !['20', '40'].includes(symbolSetCode);
            if (directionApplicable) {
                const directionContainer = document.createElement('div');
                directionContainer.style.cssText = 'margin-bottom: 20px;';
                
                const directionLabel = document.createElement('label');
                directionLabel.textContent = 'Direção:';
                directionLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 15px; color: #333;';
                
                const directionInput = document.createElement('input');
                directionInput.type = 'text';
                directionInput.placeholder = 'Azimute em graus';
                directionInput.value = tempProperties.direction || '';
                directionInput.style.cssText = `
                    width: 100%;
                    padding: 8px 12px;
                    border: 2px solid #ddd;
                    border-radius: 6px;
                    font-size: 14px;
                    transition: border-color 0.2s;
                    box-sizing: border-box;
                `;
                
                directionInput.addEventListener('input', (e) => {
                    let value = e.target.value;
                    value = value.replace(/[^0-9.]/g, '');
                    e.target.value = value;
                    
                    const numValue = parseFloat(value);
                    if (!isNaN(numValue)) {
                        if (numValue < 0 || numValue > 360) {
                            e.target.style.borderColor = '#dc3545';
                        } else {
                            e.target.style.borderColor = '#28a745';
                            if (!isUpdatingFromSIDC) {
                                tempProperties.direction = value;
                                updatePreviewFromComboboxes();
                            }
                        }
                    } else if (value === '') {
                        e.target.style.borderColor = '#ddd';
                        if (!isUpdatingFromSIDC) {
                            tempProperties.direction = '';
                            updatePreviewFromComboboxes();
                        }
                    }
                });
                
                directionContainer.appendChild(directionLabel);
                directionContainer.appendChild(directionInput);
                column1.appendChild(directionContainer);
                comboboxes.directionContainer = directionContainer;
            }

            // ===== COLUMN 2: RECRIAR TODOS OS COMBOS NA ORDEM CORRETA =====

            // 1. Modificador Transversal (se aplicável)
            const specialModData = getSpecialModifierData(symbolSetCode);
            if (specialModData.applicable) {
                comboboxes.specialModifier = createDigitalComboBox(
                    specialModData.data,
                    tempProperties.specialModifier || "0",
                    (value) => {
                        if (!isUpdatingFromSIDC) {
                            tempProperties.specialModifier = value;
                            updatePreviewFromComboboxes();
                        }
                    },
                    'Modificador Transversal'
                );
                column2.appendChild(comboboxes.specialModifier);
            }

            // 2. Elemento de Comando (checkbox) - Só para Unidades
            if (isCommandApplicable(symbolSetCode)) {
                column2.appendChild(commandCheckboxContainer);
            }

            // 3. Ícone Principal
            const mainIconsData = getMainIcons(symbolSetCode);
            comboboxes.mainIcon = createDigitalComboBox(
                mainIconsData,
                tempProperties.mainIcon || "000000",
                (value, selectedOption) => {
                    if (!isUpdatingFromSIDC) {
                        tempProperties.mainIcon = value;
                        tempProperties.mainIconExtension = selectedOption?.extension || 0;
                        updatePreviewFromComboboxes();
                    }
                },
                'Ícone Principal',
                false,
                'mainIcon'
            );
            column2.appendChild(comboboxes.mainIcon);

            // 4. Modificador 1 (se aplicável)
            if (isModifier1Applicable(symbolSetCode)) {
                const modifier1Data = getModifier1(symbolSetCode);
                comboboxes.modifier1 = createDigitalComboBox(
                    modifier1Data,
                    tempProperties.modifier1 || "00",
                    (value, selectedOption) => {
                        if (!isUpdatingFromSIDC) {
                            tempProperties.modifier1 = value;
                            tempProperties.modifier1Extension = selectedOption?.extension || 0;
                            updatePreviewFromComboboxes();
                        }
                    },
                    'Modificador 1',
                    true
                );
                column2.appendChild(comboboxes.modifier1);
            }

            // 5. Modificador 2 (se aplicável)
            if (isModifier2Applicable(symbolSetCode)) {
                const modifier2Data = getModifier2(symbolSetCode);
                comboboxes.modifier2 = createDigitalComboBox(
                    modifier2Data,
                    tempProperties.modifier2 || "00",
                    (value, selectedOption) => {
                        if (!isUpdatingFromSIDC) {
                            tempProperties.modifier2 = value;
                            tempProperties.modifier2Extension = selectedOption?.extension || 0;
                            updatePreviewFromComboboxes();
                        }
                    },
                    'Modificador 2',
                    true
                );
                column2.appendChild(comboboxes.modifier2);
            }

            // 6. Cor do Símbolo (sempre por último)
            comboboxes.colorControl = createColorControl(
                tempProperties.fillColor,
                (color) => {
                    tempProperties.fillColor = color;
                    updatePreviewFromComboboxes();
                },
                'Cor do Símbolo'
            );
            column2.appendChild(comboboxes.colorControl);
        }


        // Primeira coluna

        // ===== COMBOBOX DE SYMBOL SET (DIMENSÃO) =====
        comboboxes.symbolSet = createDigitalComboBox(
            MILITARY_DATA.symbolSets,
            tempProperties.symbolSet || "10",
            (value) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.symbolSet = value;

                    // Reset dependent fields quando mudar dimension
                    tempProperties.mainIcon = "000000";
                    tempProperties.modifier1 = "00";
                    tempProperties.modifier2 = "00";
                    tempProperties.echelon = "00";
                    tempProperties.specialModifier = "0";

                    tempProperties.mainIconExtension = null;
                    tempProperties.modifier1Extension = null;
                    tempProperties.modifier2Extension = null;

                    // Reset text modifiers when changing symbol set
                    tempProperties.uniqueDesignation = '';
                    tempProperties.higherFormation = '';
                    tempProperties.reinforcedReduced = '';
                    tempProperties.additionalInformation = '';
                    tempProperties.credibility = '';
                    tempProperties.location = '';
                    tempProperties.dateTimeGroup = '';
                    tempProperties.altitudeDepth = '';
                    tempProperties.speed = '';
                    tempProperties.specialHeadquarters = '';
                    tempProperties.type = '';
                    tempProperties.iffSif = '';
                    tempProperties.equipmentTeardownTime = '';
                    tempProperties.quantity = '';
                    tempProperties.direction = '';

                    // Recarregar comboboxes dependentes
                    reloadDependentComboboxes(value);

                    // Gerar preview com valores default
                    updatePreviewFromComboboxes();
                }
            },
            'Dimensão',
            false,
            'modifier',
            true // disableHoverPreview = true
        );
        column1.appendChild(comboboxes.symbolSet);

        comboboxes.standardIdentity = createDigitalComboBox(
            MILITARY_DATA.standardIdentity,
            tempProperties.standardIdentity || "3",
            (value) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.standardIdentity = value;
                    updatePreviewFromComboboxes();
                }
            },
            'Hostilidade'
            // simplifiedDisplay = false (default)
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
            'Situação e Condição Operacional'
            // simplifiedDisplay = false (default)
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
            'Força-Tarefa/Posto de Comando'
        );
        column1.appendChild(comboboxes.hqTfDummy);

        // ===== ESCALÃO/MOBILIDADE/LIDERANÇA (ÚLTIMA POSIÇÃO DA COLUMN 1) =====
        const initialSymbolSet = tempProperties.symbolSet || "10";
        const initialEchelonData = getEchelonData(initialSymbolSet);

        if (initialEchelonData.applicable) {
            comboboxes.echelon = createDigitalComboBox(
                initialEchelonData.data,
                tempProperties.echelon || "00",
                (value) => {
                    if (!isUpdatingFromSIDC) {
                        tempProperties.echelon = value;
                        updatePreviewFromComboboxes();
                    }
                },
                initialEchelonData.label
            );
            column1.appendChild(comboboxes.echelon);
        }

        const initialDirectionApplicable = !['20', '40'].includes(initialSymbolSet);
        if (initialDirectionApplicable) {
            const directionContainer = document.createElement('div');
            directionContainer.style.cssText = 'margin-bottom: 20px;';
            
            const directionLabel = document.createElement('label');
            directionLabel.textContent = 'Direção:';
            directionLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 15px; color: #333;';
            
            const directionInput = document.createElement('input');
            directionInput.type = 'text';
            directionInput.placeholder = 'Azimute em graus';
            directionInput.value = tempProperties.direction || '';
            directionInput.style.cssText = `
                width: 100%;
                padding: 8px 12px;
                border: 2px solid #ddd;
                border-radius: 6px;
                font-size: 14px;
                transition: border-color 0.2s;
                box-sizing: border-box;
            `;
            
            directionInput.addEventListener('input', (e) => {
                let value = e.target.value;
                value = value.replace(/[^0-9.]/g, '');
                e.target.value = value;
                
                const numValue = parseFloat(value);
                if (!isNaN(numValue)) {
                    if (numValue < 0 || numValue > 360) {
                        e.target.style.borderColor = '#dc3545';
                    } else {
                        e.target.style.borderColor = '#28a745';
                        if (!isUpdatingFromSIDC) {
                            tempProperties.direction = value;
                            updatePreviewFromComboboxes();
                        }
                    }
                } else if (value === '') {
                    e.target.style.borderColor = '#ddd';
                    if (!isUpdatingFromSIDC) {
                        tempProperties.direction = '';
                        updatePreviewFromComboboxes();
                    }
                }
            });
            
            directionContainer.appendChild(directionLabel);
            directionContainer.appendChild(directionInput);
            column1.appendChild(directionContainer);
            comboboxes.directionContainer = directionContainer;
        }

        // ===== SEGUNDA COLUNA (DINÂMICA) =====

        // 1. MODIFICADOR TRANSVERSAL (se aplicável)
        const initialSpecialModData = getSpecialModifierData(initialSymbolSet);

        if (initialSpecialModData.applicable) {
            comboboxes.specialModifier = createDigitalComboBox(
                initialSpecialModData.data,
                tempProperties.specialModifier || "0",
                (value) => {
                    if (!isUpdatingFromSIDC) {
                        tempProperties.specialModifier = value;
                        updatePreviewFromComboboxes();
                    }
                },
                'Modificador Transversal'
            );
            column2.appendChild(comboboxes.specialModifier);
        }

        // 2. ELEMENTO DE COMANDO (CHECKBOX) - Só para Unidades
        const commandCheckboxContainer = document.createElement('div');
        commandCheckboxContainer.style.cssText = 'margin-bottom: 20px;';

        const commandLabel = document.createElement('label');
        commandLabel.textContent = 'Elemento de Comando:';
        commandLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 15px; color: #333;';

        const commandCheckboxWrapper = document.createElement('div');
        commandCheckboxWrapper.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        const commandCheckbox = createCheckbox(
            tempProperties.isCommand || false,
            (e) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.isCommand = e.target.checked;
                    updatePreviewFromComboboxes();
                }
            }
        );

        const commandCheckboxLabel = document.createElement('span');
        commandCheckboxLabel.textContent = 'Esta unidade é um elemento de Comando';
        commandCheckboxLabel.style.cssText = 'font-size: 14px; color: #333; cursor: pointer;';

        commandCheckboxLabel.onclick = () => {
            const checkboxInput = commandCheckbox.find('input')[0];
            checkboxInput.click();
        };

        commandCheckboxWrapper.appendChild(commandCheckbox[0]);
        commandCheckboxWrapper.appendChild(commandCheckboxLabel);
        commandCheckboxContainer.appendChild(commandLabel);
        commandCheckboxContainer.appendChild(commandCheckboxWrapper);

        // Só adicionar se for Unidades
        if (isCommandApplicable(initialSymbolSet)) {
            column2.appendChild(commandCheckboxContainer);
        }

        // Store reference for updates
        comboboxes.isCommand = {
            updateValue: (newValue) => {
                const checkboxInput = commandCheckbox.find('input')[0];
                checkboxInput.checked = !!newValue;
            }
        };

        // 3. ÍCONE PRINCIPAL
        comboboxes.mainIcon = createDigitalComboBox(
            getMainIcons(initialSymbolSet),
            tempProperties.mainIcon || "000000",
            (value, selectedOption) => {
                if (!isUpdatingFromSIDC) {
                    tempProperties.mainIcon = value;
                    tempProperties.mainIconExtension = selectedOption?.extension || null;
                    updatePreviewFromComboboxes();
                }
            },
            'Ícone Principal',
            false,
            'mainIcon'
        );
        column2.appendChild(comboboxes.mainIcon);

        // 4. MODIFICADOR 1 (se aplicável)
        if (isModifier1Applicable(initialSymbolSet)) {
            comboboxes.modifier1 = createDigitalComboBox(
                getModifier1(initialSymbolSet),
                tempProperties.modifier1 || "00",
                (value, selectedOption) => {
                    if (!isUpdatingFromSIDC) {
                        tempProperties.modifier1 = value;
                        tempProperties.modifier1Extension = selectedOption?.extension || null;
                        updatePreviewFromComboboxes();
                    }
                },
                'Modificador 1',
                true
            );
            column2.appendChild(comboboxes.modifier1);
        }

        // 5. MODIFICADOR 2 (se aplicável)
        if (isModifier2Applicable(initialSymbolSet)) {
            comboboxes.modifier2 = createDigitalComboBox(
                getModifier2(initialSymbolSet),
                tempProperties.modifier2 || "00",
                (value, selectedOption) => {
                    if (!isUpdatingFromSIDC) {
                        tempProperties.modifier2 = value;
                        tempProperties.modifier2Extension = selectedOption?.extension || null;
                        updatePreviewFromComboboxes();
                    }
                },
                'Modificador 2',
                true
            );
            column2.appendChild(comboboxes.modifier2);
        }

        // 6. COR DO SÍMBOLO (sempre por último)
        comboboxes.colorControl = createColorControl(
            tempProperties.fillColor,
            (color) => {
                tempProperties.fillColor = color;
                updatePreviewFromComboboxes();
            },
            'Cor do Símbolo'
        );
        column2.appendChild(comboboxes.colorControl);

        // ========================================
        // CREATE TABS SYSTEM
        // ========================================

        // Create tabs container
        const tabsContainer = createTabsContainer();
        const { simboloTab, textoTab, engajamentoTab, tabButtons } = tabsContainer;

        // Add columns directly to Symbol tab
        simboloTab.appendChild(column1);
        simboloTab.appendChild(column2);

        // Create Text tab content
        let textFieldsContainer = createTextFieldsContainer(
            tempProperties.symbolSet || "10",
            tempProperties,
            updatePreviewFromComboboxes,
            getTextModifiersConfig
        );
        textoTab.appendChild(textFieldsContainer);

        // Create Engagement Bar tab content
        let engagementBarContainer = createEngagementBarContent(
            tempProperties,
            updatePreviewFromComboboxes
        );
        engajamentoTab.appendChild(engagementBarContainer);
        engagementBarContainer.updateFromProperties(tempProperties);

        // Update engagement bar visibility
        function updateEngagementBarVisibility() {
            const isApplicable = isEngagementBarApplicable(tempProperties.symbolSet || "10");
            tabButtons.engajamento.style.display = isApplicable ? '' : 'none';
            if (!isApplicable && engajamentoTab.style.display === 'block') {
                switchTab('simbolo', tabButtons);
            }
        }
        updateEngagementBarVisibility();

        // Configure tab switching
        tabButtons.simbolo.onclick = () => {
            switchTab('simbolo', tabButtons);
        };

        tabButtons.texto.onclick = () => {
            switchTab('texto', tabButtons);
        };

        tabButtons.engajamento.onclick = () => {
            switchTab('engajamento', tabButtons);
        };

        // Add tabs container to controls column
        controlsColumn.appendChild(tabsContainer.container);

        // Update text fields when symbol set changes
        const originalReloadFunction = reloadDependentComboboxes;
        reloadDependentComboboxes = (symbolSetCode) => {
            // Call original function
            originalReloadFunction(symbolSetCode);

            // Clear all text modifiers in tempProperties
            tempProperties.uniqueDesignation = '';
            tempProperties.higherFormation = '';
            tempProperties.reinforcedReduced = '';
            tempProperties.additionalInformation = '';
            tempProperties.credibility = '';
            tempProperties.location = '';
            tempProperties.dateTimeGroup = '';
            tempProperties.altitudeDepth = '';
            tempProperties.speed = '';
            tempProperties.specialHeadquarters = '';
            tempProperties.type = '';
            tempProperties.iffSif = '';
            tempProperties.equipmentTeardownTime = '';
            tempProperties.quantity = '';

            // Update text fields for new symbol set
            // Remove old text fields
            while (textoTab.firstChild) {
                textoTab.removeChild(textoTab.firstChild);
            }

            // Create new text fields (will show empty values)
            textFieldsContainer = createTextFieldsContainer(
                symbolSetCode,
                tempProperties,
                updatePreviewFromComboboxes,
                getTextModifiersConfig
            );
            textoTab.appendChild(textFieldsContainer);

            // Update engagement bar
            tempProperties.engagementBar = null;
            while (engajamentoTab.firstChild) {
                engajamentoTab.removeChild(engajamentoTab.firstChild);
            }
            engagementBarContainer = createEngagementBarContent(
                tempProperties,
                updatePreviewFromComboboxes
            );
            engajamentoTab.appendChild(engagementBarContainer);
            updateEngagementBarVisibility();
        };


        // ✅ NEW: Update preview when comboboxes change
        function updatePreviewFromComboboxes() {
            // Build SIDC from current tempProperties
            const sidc = militarySymbolControl.symbolGenerator.buildSIDC(tempProperties);
            tempProperties.sidc = sidc;

            // Update SIDC input field (without triggering its event)
            sidcInput.value = sidc;

            updatePreview();
        }

        // ✅ HELPER: Update all combobox visual values
        function updateAllComboboxValues() {
            // Update symbolSet
            if (comboboxes.symbolSet && comboboxes.symbolSet.updateValue) {
                comboboxes.symbolSet.updateValue(tempProperties.symbolSet);
            }

            // Update standardIdentity
            if (comboboxes.standardIdentity && comboboxes.standardIdentity.updateValue) {
                comboboxes.standardIdentity.updateValue(tempProperties.standardIdentity);
            }

            // Update status
            if (comboboxes.status && comboboxes.status.updateValue) {
                comboboxes.status.updateValue(tempProperties.status);
            }

            // Update hqTfDummy
            if (comboboxes.hqTfDummy && comboboxes.hqTfDummy.updateValue) {
                comboboxes.hqTfDummy.updateValue(tempProperties.hqTfDummy);
            }

            // Update echelon (if exists)
            if (comboboxes.echelon && comboboxes.echelon.updateValue) {
                comboboxes.echelon.updateValue(tempProperties.echelon);
            }

            // Update specialModifier (if exists)
            if (comboboxes.specialModifier && comboboxes.specialModifier.updateValue) {
                comboboxes.specialModifier.updateValue(tempProperties.specialModifier);
            }

            // Update isCommand
            if (comboboxes.isCommand && comboboxes.isCommand.updateValue) {
                comboboxes.isCommand.updateValue(tempProperties.isCommand);
            }

            // Update mainIcon
            if (comboboxes.mainIcon && comboboxes.mainIcon.updateValue) {
                comboboxes.mainIcon.updateValue(tempProperties.mainIcon);
            }

            // Update modifier1 (if exists)
            if (comboboxes.modifier1 && comboboxes.modifier1.updateValue) {
                comboboxes.modifier1.updateValue(tempProperties.modifier1);
            }

            // Update modifier2 (if exists)
            if (comboboxes.modifier2 && comboboxes.modifier2.updateValue) {
                comboboxes.modifier2.updateValue(tempProperties.modifier2);
            }

            // Update colorControl (if exists)
            if (comboboxes.colorControl && comboboxes.colorControl.updateValue) {
                comboboxes.colorControl.updateValue(tempProperties.fillColor);
            }
        }

        // ✅ CORRIGIDO: Atualiza comboboxes quando cola SIDC, recriando se dimensão mudar
        function updateComboboxesFromSIDC(sidc) {
            try {
                isUpdatingFromSIDC = true;

                let normalizedSIDC = sidc;
                if (sidc.length === 20) {
                    normalizedSIDC = normalizeSIDC(sidc);
                    sidcInput.value = normalizedSIDC; // Update input field
                }

                const parseResult = militarySymbolControl.symbolGenerator.canParseSIDC(normalizedSIDC);
                if (!parseResult.canParse) {
                    throw new Error(parseResult.error);
                }

                const parsed = parseResult.properties;

                const oldSymbolSet = tempProperties.symbolSet;
                const newSymbolSet = parsed.symbolSet;
                const dimensionChanged = oldSymbolSet !== newSymbolSet;

                tempProperties.standardIdentity = parsed.standardIdentity;
                tempProperties.symbolSet = parsed.symbolSet;
                tempProperties.status = parsed.status;
                tempProperties.hqTfDummy = parsed.hqTfDummy;
                tempProperties.echelon = parsed.echelon;
                tempProperties.mainIcon = parsed.mainIcon;
                tempProperties.modifier1 = parsed.modifier1;
                tempProperties.modifier2 = parsed.modifier2;
                tempProperties.specialModifier = parsed.specialModifier || "0";
                tempProperties.isCommand = parsed.isCommand || false;

                tempProperties.mainIconExtension = parsed.mainIconExtension || 0;
                tempProperties.modifier1Extension = parsed.modifier1Extension || 0;
                tempProperties.modifier2Extension = parsed.modifier2Extension || 0;

                tempProperties.sidc = normalizedSIDC; // ✅ Always 30 digits

                if (dimensionChanged) {
                    reloadDependentComboboxes(newSymbolSet);
                }

                // Atualizar valores visuais de todos os comboboxes
                updateAllComboboxValues();

                const extension = BrazilianSIDCExtension.decode(normalizedSIDC.substring(20));
                const sidc20 = normalizedSIDC.substring(0, 20);
                const warnings = checkCatalogWarnings(extension, tempProperties.symbolSet, sidc20);

                if (warnings.length > 0) {
                    sidcInput.style.borderColor = '#ffc107'; // Yellow for warnings
                    sidcStatusMessage.style.color = '#856404';
                    sidcStatusMessage.textContent = '⚠️ ' + warnings[0];
                    console.warn('Uncataloged extensions:', warnings);
                } else {
                    sidcInput.style.borderColor = '#28a745'; // Green for valid
                    sidcStatusMessage.style.color = '#155724';
                    sidcStatusMessage.textContent = '✓ SIDC válido';
                }

            } catch (error) {
                sidcInput.style.borderColor = '#dc3545'; // Red for invalid
                sidcStatusMessage.style.color = '#721c24';
                sidcStatusMessage.textContent = '✗ ' + error.message;
                console.warn('Invalid SIDC for parsing:', error.message);
            } finally {
                isUpdatingFromSIDC = false;
            }
        }

        sidcInput.addEventListener('input', (e) => {
            let cleanSIDC = e.target.value.replace(/\s/g, '').trim();

            // Limit to 30 digits AFTER cleaning spaces
            if (cleanSIDC.length > 30) {
                cleanSIDC = cleanSIDC.substring(0, 30);
            }

            // Update input field with cleaned value
            if (e.target.value !== cleanSIDC) {
                e.target.value = cleanSIDC;
            }

            // Reset border color and status
            sidcInput.style.borderColor = '#ddd';
            sidcStatusMessage.textContent = '';

            if (cleanSIDC.length === 20) {
                // Auto-normalize to 30 digits
                const normalized = normalizeSIDC(cleanSIDC);
                sidcInput.value = normalized;
                cleanSIDC = normalized;
                updateComboboxesFromSIDC(cleanSIDC);
                updatePreview();
            } else if (cleanSIDC.length === 30) {
                updateComboboxesFromSIDC(cleanSIDC);
                updatePreview();
            } else if (cleanSIDC.length > 0 && cleanSIDC.length < 20) {
                sidcInput.style.borderColor = '#ffc107'; // Yellow for incomplete
                sidcStatusMessage.style.color = '#856404';
                sidcStatusMessage.textContent = `⚠️ ${cleanSIDC.length}/20 dígitos (mínimo)`;
            } else if (cleanSIDC.length > 20 && cleanSIDC.length < 30) {
                sidcInput.style.borderColor = '#ffc107'; // Yellow for incomplete extension
                sidcStatusMessage.style.color = '#856404';
                sidcStatusMessage.textContent = `⚠️ ${cleanSIDC.length}/30 dígitos`;
            }
        });

        sidcInput.addEventListener('paste', (e) => {
            setTimeout(() => {
                let cleanSIDC = sidcInput.value.replace(/\s/g, '').trim();

                // Limit to 30 digits
                if (cleanSIDC.length > 30) {
                    cleanSIDC = cleanSIDC.substring(0, 30);
                }

                sidcInput.value = cleanSIDC;

                if (cleanSIDC.length === 20) {
                    const normalized = normalizeSIDC(cleanSIDC);
                    sidcInput.value = normalized;
                    updateComboboxesFromSIDC(normalized);
                    updatePreview();
                } else if (cleanSIDC.length === 30) {
                    updateComboboxesFromSIDC(cleanSIDC);
                    updatePreview();
                }
            }, 10);
        });

        sidcInput.value = normalizeSIDC(
            tempProperties.sidc ||
            militarySymbolControl.symbolGenerator.buildSIDC(tempProperties)
        );

        /**
         * Calculates correct sizeMultiplier to match standard preview size (80px)
         * @param {Object} properties - Complete properties object including text modifiers
         * @param {number} size - Target size in pixels (default 80)
         * @returns {Promise<string>} Data URL of the generated symbol with text
         */
        async function generatePreviewWithTextModifiers(properties, size = 80) {
            try {
                const result = await militarySymbolControl.symbolGenerator.generateSymbolBlob(
                    properties
                );

                // Convert blob to data URL (use result.blob)
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.readAsDataURL(result.blob);
                });
            } catch (error) {
                console.error('Error generating preview with text modifiers:', error);
                return null;
            }
        }

        // Função de preview - CORRIGIDA para incluir text modifiers
        async function updatePreview() {
            try {
                const sidc = tempProperties.sidc;

                // Validar SIDC
                const validation = militarySymbolControl.symbolGenerator.validateSIDC(sidc);

                if (!validation.valid) {
                    previewImage.style.display = 'none';
                    return;
                }

                // Generate preview with complete properties (including text modifiers)
                const previewDataURL = await generatePreviewWithTextModifiers(
                    tempProperties,
                    80
                );

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
            // ✅ BUG FIX #1: Update ALL properties first, then regenerate ONCE
            const propertiesToUpdate = [
                'standardIdentity', 'symbolSet', 'status', 'hqTfDummy', 'echelon',
                'mainIcon', 'modifier1', 'modifier2', 'specialModifier', 'isCommand',
                'mainIconExtension', 'modifier1Extension', 'modifier2Extension',
                'sidc', 'fillColor',
                // Text modifiers
                'uniqueDesignation', 'higherFormation', 'reinforcedReduced',
                'additionalInformation', 'credibility', 'location', 'dateTimeGroup',
                'altitudeDepth', 'speed', 'specialHeadquarters', 'type', 'iffSif',
                'equipmentTeardownTime', 'quantity', 'direction',
                'engagementBar'
            ];

            // Get source data ONCE
            const data = await militarySymbolControl.map.getSource("military_symbols").getData();
            let needsRegeneration = false;

            // Update all properties in the source
            for (const feature of selectedFeatures) {
                const sourceFeature = data.features.find(
                    (f) => f.properties.id == feature.properties.id
                );
                
                if (sourceFeature) {
                    // Update each property
                    for (const key of propertiesToUpdate) {
                        if (tempProperties.hasOwnProperty(key)) {
                            sourceFeature.properties[key] = tempProperties[key];
                            feature.properties[key] = tempProperties[key];
                            
                            // Check if regeneration is needed
                            if (militarySymbolControl.geometry.affectsSIDC(key) ||
                                militarySymbolControl.geometry.affectsTextModifiers(key) ||
                                key === 'fillColor') {
                                needsRegeneration = true;
                            }
                        }
                    }
                    
                    // Recalculate SIDC if necessary
                    if (needsRegeneration) {
                        const newSIDC30 = militarySymbolControl.symbolGenerator.buildSIDC(sourceFeature.properties);
                        sourceFeature.properties.sidc = newSIDC30;
                        feature.properties.sidc = newSIDC30;
                    }
                }
            }

            // Update source with ALL changes
            militarySymbolControl.map.getSource("military_symbols").setData(data);

            // Regenerate symbol ONCE if needed
            if (needsRegeneration && selectedFeatures.length > 0) {
                // Get UPDATED feature from source to ensure all properties are present
                const updatedData = await militarySymbolControl.map.getSource("military_symbols").getData();
                const updatedFeature = updatedData.features.find(
                    f => f.properties.id === selectedFeatures[0].properties.id
                );
                
                if (updatedFeature) {
                    // Regenerate symbol with ALL updated properties
                    await militarySymbolControl.updateSymbolImage(updatedFeature);
                    
                    // Update SelectionManager with updated feature
                    militarySymbolControl.updateSelectionManagerFeature(updatedFeature);
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
        cancelButton.onclick = closeModal;

        modalButtons.appendChild(applyButton);
        modalButtons.appendChild(cancelButton);

        function closeModal() {
            document.removeEventListener('keydown', handleModalKeyDown);

            // Cleanup dos dropdowns
            const comboBoxes = [column1, column2].flatMap(col => Array.from(col.children));
            comboBoxes.forEach(combo => {
                if (combo._cleanup) {
                    combo._cleanup();
                }
            });
            document.body.removeChild(modalOverlay);
        }

        function handleModalKeyDown(e) {
            if (e.key === 'Escape') {
                // Only close modal if no dropdown is open
                const hasOpenDropdown = openDropdowns.some(dropdown =>
                    dropdown.style.display === 'block'
                );

                if (!hasOpenDropdown) {
                    e.preventDefault();
                    closeModal();
                }
            }
        }

        // ✅ CORRIGIDO BUG #2: Async initialization with gallery
        async function initializeModal() {
            try {
                // Callback para click na galeria
                const onSymbolClick = (sidc) => {
                    updateComboboxesFromSIDC(sidc);

                    // Limpar todos os text modifiers (não devem ser restaurados da galeria)
                    tempProperties.uniqueDesignation = '';
                    tempProperties.higherFormation = '';
                    tempProperties.reinforcedReduced = '';
                    tempProperties.additionalInformation = '';
                    tempProperties.credibility = '';
                    tempProperties.location = '';
                    tempProperties.dateTimeGroup = '';
                    tempProperties.altitudeDepth = '';
                    tempProperties.speed = '';
                    tempProperties.specialHeadquarters = '';
                    tempProperties.type = '';
                    tempProperties.iffSif = '';
                    tempProperties.equipmentTeardownTime = '';
                    tempProperties.quantity = '';
                    tempProperties.direction = '';
                    tempProperties.engagementBar = null;

                    if (engagementBarContainer && engagementBarContainer.updateFromProperties) {
                        engagementBarContainer.updateFromProperties(tempProperties);
                    }

                    updatePreview();
                };

                // ✅ Criar galeria de forma assíncrona
                const galleryColumn = await createSymbolGallery(onSymbolClick);

                // ✅ Montar modal com 3 colunas (controles, preview, galeria)
                modalContent.appendChild(controlsColumn);
                modalContent.appendChild(previewColumn);
                modalContent.appendChild(galleryColumn);
                modal.appendChild(modalContent);
                modal.appendChild(modalButtons);
                modalOverlay.appendChild(modal);

                // Event listeners
                modalOverlay.onclick = (e) => {
                    if (e.target === modalOverlay) {
                        closeModal();
                    }
                };

                document.addEventListener('keydown', handleModalKeyDown);

                // Adicionar ao DOM e gerar preview inicial
                document.body.appendChild(modalOverlay);
                updatePreview();

            } catch (error) {
                console.error('Erro ao inicializar modal:', error);

                // ✅ Fallback: modal sem galeria (graceful degradation)
                modalContent.appendChild(controlsColumn);
                modalContent.appendChild(previewColumn);
                modal.appendChild(modalContent);
                modal.appendChild(modalButtons);
                modalOverlay.appendChild(modal);

                modalOverlay.onclick = (e) => {
                    if (e.target === modalOverlay) {
                        closeModal();
                    }
                };

                document.addEventListener('keydown', handleModalKeyDown);
                document.body.appendChild(modalOverlay);
                updatePreview();
            }
        }

        // ✅ Inicializar modal de forma assíncrona
        initializeModal();
    }
}
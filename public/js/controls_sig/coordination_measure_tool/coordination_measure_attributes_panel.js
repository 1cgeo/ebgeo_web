// Path: js\controls_sig\coordination_measure_tool\coordination_measure_attributes_panel.js

import {
    createSliderWithInput,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';
import { COORDINATION_POINTS_CATALOG } from './coordination_points_catalog.js';
import { UI_DATA, SUPPLY_CLASSES } from './coordination_measure_constants.js';

/**
 * Add Coordination Measure attributes to panel
 * Follows the same pattern as military symbol attributes panel with 3-column modal
 * 
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected coordination measure features
 * @param {Object} coordinationMeasureControl - Control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 */
export function addCoordinationMeasureAttributesToPanel(
    panel,
    selectedFeatures,
    coordinationMeasureControl,
    selectionManager,
    uiManager
) {
    if (!selectedFeatures || selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    // ✅ CORRECT: Capture initial properties at panel opening (before any user interaction)
    const initialPropertiesMap = new Map(
        selectedFeatures.map(f => [f.properties.id, { ...f.properties }])
    );

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== CONFIGURAÇÃO DE PONTO ESPECÍFICA =====
    if (selectedFeatures.length === 1) {
        // Botão para abrir modal do ponto
        const pointButton = document.createElement('button');
        pointButton.classList.add('tool-button', 'pure-material-button-contained');
        pointButton.textContent = 'Configurar Ponto...';
        pointButton.style.cssText = 'width: 100%; margin-bottom: 15px; padding: 10px;';
        pointButton.onclick = () => openPointModal();

        $(panel).append(createAttributeRow('Ponto:', pointButton));
    }

    // ===== CONTROLES DE RENDERIZAÇÃO =====

    // Tamanho
    const sizeControl = createSliderWithInput(getCommonConfig('size',
        feature.properties.size || 1.0, {
        onChange: (value) => {
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'size', value);
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
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Zoom de referência:', createdAtZoomControl));

    // Opacidade (0-100%)
    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity || 1.0) * 100), {
        onChange: (value) => {
            // Convert from 0-100 range to 0-1 range for internal storage
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
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
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'rotation', value);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Rotação (°):', rotationControl));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    const buttons = createStandardButtons({
        selectedFeatures,
        control: coordinationMeasureControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1, // ✅ ENABLED
        onSetDefault: () => coordinationMeasureControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);

    // ===== MODAL DO PONTO (3 COLUNAS - PADRÃO MILITARY SYMBOL) =====

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

    function openPointModal() {
        // Propriedades temporárias (serão aplicadas apenas ao clicar em "Aplicar")
        const tempProperties = { ...feature.properties };

        // Modal overlay
        const modalOverlay = document.createElement('div');
        modalOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // Modal content
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 30px;
            max-width: 1400px;
            width: 90%;
            max-height: 85vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        `;

        // Modal header
        const header = document.createElement('div');
        header.style.cssText = 'margin-bottom: 25px; padding-bottom: 15px; border-bottom: 2px solid #eee;';
        header.innerHTML = `
            <h2 style="margin: 0; font-size: 24px; color: #333;">📍 Configurar Medida de Coordenação</h2>
            <p style="margin: 5px 0 0 0; font-size: 14px; color: #666;">Tipo atual: ${getPointLabel(tempProperties.pointCode)}</p>
        `;

        // Modal content container (3 colunas)
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            display: grid;
            grid-template-columns: 35% 25% 40%;
            gap: 30px;
            margin-bottom: 25px;
        `;

        // ===== COLUNA 1: CONTROLES =====
        const controlsColumn = document.createElement('div');
        controlsColumn.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 20px;
            max-height: 65vh;
            overflow-y: auto;
            padding-right: 10px;
        `;

        // ===== COLUNA 2: PREVIEW =====
        const previewColumn = document.createElement('div');
        previewColumn.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
            border: 2px solid #dee2e6;
            position: sticky;
            top: 0;
            max-height: 65vh;
        `;

        const previewTitle = document.createElement('h3');
        previewTitle.textContent = 'Preview';
        previewTitle.style.cssText = `
            margin: 0 0 20px 0;
            font-size: 18px;
            color: #333;
            font-weight: 600;
        `;
        previewColumn.appendChild(previewTitle);

        const previewImageContainer = document.createElement('div');
        previewImageContainer.style.cssText = `
            min-height: 200px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 15px;
        `;

        const previewImage = document.createElement('img');
        previewImage.style.cssText = `
            max-width: 100%;
            max-height: 400px;
            object-fit: contain;
        `;
        previewImageContainer.appendChild(previewImage);
        previewColumn.appendChild(previewImageContainer);

        const dimensionsInfo = document.createElement('div');
        dimensionsInfo.style.cssText = `
            font-size: 12px;
            color: #666;
            text-align: center;
        `;
        previewColumn.appendChild(dimensionsInfo);

        // Update preview function
        let previewDebounceTimer = null;
        async function updatePreview() {
            try {
                // Validate pointCode
                if (!tempProperties.pointCode) {
                    previewImage.style.display = 'none';
                    dimensionsInfo.textContent = 'Nenhum ponto selecionado';
                    return;
                }

                // For ECHELON types, ensure echelonCode is set
                if (isEchelonPointCode(tempProperties.pointCode) && !tempProperties.echelonCode) {
                    previewImage.style.display = 'none';
                    dimensionsInfo.textContent = 'Selecione um escalão';
                    return;
                }

                // Generate preview
                const result = await coordinationMeasureControl.generator.generate(
                    tempProperties.pointCode,
                    tempProperties
                );

                if (result && result.dataUrl) {
                    previewImage.src = result.dataUrl;
                    previewImage.style.display = 'block';
                    dimensionsInfo.textContent = `${result.width} × ${result.height} px`;
                } else {
                    previewImage.style.display = 'none';
                    dimensionsInfo.textContent = 'Falha ao gerar preview';
                }
            } catch (error) {
                console.error('Erro ao gerar preview:', error);
                previewImage.style.display = 'none';
                dimensionsInfo.textContent = 'Erro ao gerar preview';
            }
        }

        function updatePreviewDebounced() {
            clearTimeout(previewDebounceTimer);
            previewDebounceTimer = setTimeout(() => {
                updatePreview();
            }, 200);
        }

        // ===== TIPO DE PONTO (COMBO BOX) =====
        const pointTypeCombo = createDigitalComboBox(
            getPointsGroupedOptions(),
            tempProperties.pointCode,
            (newValue) => {
                const wasEchelon = isEchelonPointCode(tempProperties.pointCode);
                const isEchelon = newValue === 'ECHELON' || newValue === 'ECHELON_FT';

                tempProperties.pointCode = newValue;

                // Clear echelon code if switching from echelon to regular point
                if (wasEchelon && !isEchelon) {
                    delete tempProperties.echelonCode;
                }

                // Set default echelon code if switching to echelon
                if (!wasEchelon && isEchelon) {
                    tempProperties.echelonCode = newValue === 'ECHELON_FT' ? 'ECHELON_FT_16' : 'ECHELON_16';
                }

                // Clear text modifiers when changing point type
                clearAllTextModifiers(tempProperties);

                // Show/hide subtype dropdown
                subtypeDropdown.style.display = isEchelon ? 'block' : 'none';

                // Rebuild text modifiers section
                rebuildTextModifiersSection(tempProperties.pointCode);

                updatePreviewDebounced();
            },
            'Tipo de Ponto'
        );

        controlsColumn.appendChild(pointTypeCombo);

        // ===== SUBTIPO DE ESCALÃO (CONDICIONAL) =====
        const subtypeDropdown = document.createElement('div');
        subtypeDropdown.style.display = isEchelonPointCode(tempProperties.pointCode) ? 'block' : 'none';

        function updateSubtypeCombo() {
            subtypeDropdown.innerHTML = '';
            
            if (!isEchelonPointCode(tempProperties.pointCode)) return;

            const isFT = tempProperties.pointCode === 'ECHELON_FT';
            const subtypeCombo = createDigitalComboBox(
                getEchelonSubtypeOptions(tempProperties.pointCode),
                tempProperties.echelonCode || (isFT ? 'ECHELON_FT_16' : 'ECHELON_16'),
                (newValue) => {
                    tempProperties.echelonCode = newValue;
                    updatePreviewDebounced();
                },
                isFT ? 'Escalão Força-Tarefa' : 'Escalão'
            );

            subtypeDropdown.appendChild(subtypeCombo);
        }

        updateSubtypeCombo();
        controlsColumn.appendChild(subtypeDropdown);

        // ===== AMPLIFICADORES TEXTUAIS =====
        const textModifiersSection = document.createElement('div');
        textModifiersSection.style.cssText = `
            margin-top: 25px;
            border-top: 2px solid #eee;
            padding-top: 15px;
        `;

        // Header com toggle
        const textModifiersHeader = document.createElement('div');
        textModifiersHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 8px;
            margin-bottom: 10px;
        `;

        const headerTitle = document.createElement('span');
        headerTitle.textContent = '📝 Amplificadores Textuais';
        headerTitle.style.cssText = 'font-weight: bold; font-size: 15px;';

        const toggleIcon = document.createElement('span');
        toggleIcon.textContent = '▼';
        toggleIcon.style.cssText = 'font-size: 12px; transition: transform 0.2s;';

        textModifiersHeader.appendChild(headerTitle);
        textModifiersHeader.appendChild(toggleIcon);

        // Content container (fields)
        const textModifiersContent = document.createElement('div');
        textModifiersContent.style.cssText = 'display: flex; flex-direction: column; gap: 15px;';
        textModifiersContent.style.display = 'none'; // Initially collapsed

        // Toggle functionality
        let isExpanded = false;
        textModifiersHeader.onclick = () => {
            isExpanded = !isExpanded;
            textModifiersContent.style.display = isExpanded ? 'flex' : 'none';
            toggleIcon.style.transform = isExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
        };

        textModifiersSection.appendChild(textModifiersHeader);
        textModifiersSection.appendChild(textModifiersContent);
        controlsColumn.appendChild(textModifiersSection);

        // Função para reconstruir os campos baseado no pointCode
        function rebuildTextModifiersSection(pointCode) {
            textModifiersContent.innerHTML = '';

            const applicableFields = getApplicableTextFields(pointCode);

            applicableFields.forEach(fieldName => {
                const fieldDef = UI_DATA.textFieldDefinitions[fieldName];
                if (!fieldDef) return;

                const fieldContainer = createTextModifierField(
                    fieldName,
                    fieldDef,
                    tempProperties[fieldName],
                    (newValue) => {
                        tempProperties[fieldName] = newValue;
                        updatePreviewDebounced();
                    }
                );

                textModifiersContent.appendChild(fieldContainer);
            });
        }

        // Chamar inicialmente
        rebuildTextModifiersSection(tempProperties.pointCode);

        // ===== COLUNA 3: GALERIA =====
        // Criar galeria de forma assíncrona
        createPointGallery((pointCode) => {
            // Callback quando clicar em ponto da galeria
            const wasEchelon = isEchelonPointCode(tempProperties.pointCode);
            const isEchelon = pointCode === 'ECHELON' || pointCode === 'ECHELON_FT';

            tempProperties.pointCode = pointCode;

            // Handle echelon logic
            if (!wasEchelon && isEchelon) {
                tempProperties.echelonCode = pointCode === 'ECHELON_FT' ? 'ECHELON_FT_16' : 'ECHELON_16';
            } else if (wasEchelon && !isEchelon) {
                delete tempProperties.echelonCode;
            }

            // Clear text modifiers
            clearAllTextModifiers(tempProperties);

            // Update UI
            subtypeDropdown.style.display = isEchelon ? 'block' : 'none';
            updateSubtypeCombo();
            rebuildTextModifiersSection(pointCode);

            // Update header
            header.querySelector('p').textContent = `Tipo atual: ${getPointLabel(pointCode)}`;

            updatePreviewDebounced();
        }).then(galleryColumn => {
            modalContent.appendChild(controlsColumn);
            modalContent.appendChild(previewColumn);
            modalContent.appendChild(galleryColumn);

            modal.appendChild(header);
            modal.appendChild(modalContent);

            // ===== BOTÕES DO MODAL =====
            const modalButtons = document.createElement('div');
            modalButtons.style.cssText = `
                margin-top: 30px;
                text-align: center;
                display: flex;
                gap: 15px;
                justify-content: center;
            `;

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
                // Apply all properties
                const propertiesToUpdate = [
                    'pointCode', 'echelonCode',
                    // Text modifiers
                    'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
                    'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
                ];

                for (const key of propertiesToUpdate) {
                    if (tempProperties.hasOwnProperty(key)) {
                        await coordinationMeasureControl.updateFeaturesProperty(
                            selectedFeatures, 
                            key, 
                            tempProperties[key]
                        );
                    }
                }

                coordinationMeasureControl.saveFeatures(selectedFeatures, initialPropertiesMap);
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
        });

        function closeModal() {
            document.removeEventListener('keydown', handleModalKeyDown);

            // Cleanup dos dropdowns
            const comboBoxes = [controlsColumn].flatMap(col => Array.from(col.children));
            comboBoxes.forEach(combo => {
                if (combo._cleanup) {
                    combo._cleanup();
                }
            });

            if (previewDebounceTimer) {
                clearTimeout(previewDebounceTimer);
            }

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
    }

    // ===== HELPER FUNCTIONS =====

    /**
     * Create digital combo box (similar to military symbol)
     */
    function createDigitalComboBox(options, currentValue, onChange, label) {
        const container = document.createElement('div');
        container.style.cssText = 'margin-bottom: 20px; position: relative;';

        const labelElement = document.createElement('label');
        labelElement.textContent = label + ':';
        labelElement.style.cssText = `
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
            font-size: 15px;
            color: #333;
        `;

        const selectContainer = document.createElement('div');
        selectContainer.style.cssText = 'position: relative;';

        // Display do valor atual
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
            min-height: 50px;
            display: flex;
            align-items: center;
        `;

        const textContainer = document.createElement('div');
        textContainer.style.cssText = `
            flex: 1;
            overflow: hidden;
            word-wrap: break-word;
            pointer-events: none;
        `;
        selectDisplay.appendChild(textContainer);

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
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            max-height: 300px;
            overflow-y: auto;
            background: white;
            border: 2px solid #ddd;
            border-top: none;
            border-radius: 0 0 8px 8px;
            z-index: 1000;
            display: none;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        `;

        // Register dropdown
        openDropdowns.push(dropdown);

        // Atualizar display
        function updateDisplay() {
            const selected = options.find(opt => opt.value === currentValue);
            textContainer.textContent = selected ? selected.label : 'Selecione...';
        }

        // Popular dropdown
        options.forEach(option => {
            const item = document.createElement('div');
            item.style.cssText = `
                padding: 12px 15px;
                cursor: pointer;
                font-size: 14px;
                transition: background-color 0.2s;
                border-bottom: 1px solid #f0f0f0;
            `;

            item.textContent = option.label;

            if (option.value === currentValue) {
                item.style.backgroundColor = '#e9ecef';
            }

            item.onmouseenter = () => item.style.backgroundColor = '#f8f9fa';
            item.onmouseleave = () => {
                item.style.backgroundColor = option.value === currentValue ? '#e9ecef' : 'white';
            };

            item.onclick = () => {
                currentValue = option.value;
                updateDisplay();
                closeAllDropdowns();
                onChange(option.value);
            };

            dropdown.appendChild(item);
        });

        // Toggle dropdown
        selectDisplay.onclick = (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display === 'block';
            closeAllDropdowns();
            dropdown.style.display = isOpen ? 'none' : 'block';
            selectDisplay.style.borderColor = isOpen ? '#ddd' : '#007bff';
        };

        // Fechar ao clicar fora
        const closeDropdown = () => {
            dropdown.style.display = 'none';
            selectDisplay.style.borderColor = '#ddd';
        };

        // Store cleanup function
        container._cleanup = () => {
            document.removeEventListener('click', closeDropdown);
            const index = openDropdowns.indexOf(dropdown);
            if (index > -1) {
                openDropdowns.splice(index, 1);
            }
        };

        document.addEventListener('click', closeDropdown);

        updateDisplay();

        container.appendChild(labelElement);
        selectContainer.appendChild(selectDisplay);
        selectContainer.appendChild(dropdown);
        container.appendChild(selectContainer);

        return container;
    }

    /**
     * Create text modifier field
     */
    function createTextModifierField(fieldName, fieldDef, currentValue, onChange) {
        const container = document.createElement('div');
        container.style.cssText = 'display: flex; flex-direction: column; gap: 5px;';

        // Label
        const label = document.createElement('label');
        label.textContent = fieldDef.label + (fieldDef.required ? ' *' : '');
        label.style.cssText = `
            font-size: 13px;
            font-weight: 600;
            color: ${fieldDef.required ? '#dc3545' : '#495057'};
        `;
        container.appendChild(label);

        // Input element
        let inputElement;

        if (fieldDef.type === 'select') {
            // Dropdown
            inputElement = document.createElement('select');
            inputElement.style.cssText = `
                padding: 8px;
                border: 2px solid #ddd;
                border-radius: 6px;
                font-size: 13px;
            `;

            // Add empty option
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = '-- Selecione --';
            inputElement.appendChild(emptyOption);

            // Add options
            fieldDef.options.forEach(optKey => {
                const option = document.createElement('option');
                option.value = optKey;

                if (fieldName === 'classeSuprimento') {
                    option.textContent = SUPPLY_CLASSES[optKey] || optKey;
                } else {
                    option.textContent = optKey;
                }

                inputElement.appendChild(option);
            });

            inputElement.value = currentValue || '';
            inputElement.onchange = (e) => onChange(e.target.value || null);

        } else {
            // Text or number input
            inputElement = document.createElement('input');
            inputElement.type = fieldDef.type;
            inputElement.placeholder = fieldDef.placeholder || '';
            inputElement.value = currentValue || '';
            inputElement.style.cssText = `
                padding: 8px;
                border: 2px solid #ddd;
                border-radius: 6px;
                font-size: 13px;
            `;

            inputElement.oninput = (e) => {
                const value = e.target.value.trim();
                onChange(value === '' ? null : value);
            };
        }

        container.appendChild(inputElement);

        // Help text
        if (fieldDef.help) {
            const helpText = document.createElement('div');
            helpText.textContent = fieldDef.help;
            helpText.style.cssText = 'font-size: 11px; color: #6c757d; font-style: italic;';
            container.appendChild(helpText);
        }

        return container;
    }

    /**
     * Create point gallery (column 3)
     */
    async function createPointGallery(onPointClick) {
        const galleryColumn = document.createElement('div');
        galleryColumn.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 20px;
            background: #ffffff;
            border-radius: 8px;
            border: 2px solid #dee2e6;
            max-height: 65vh;
            overflow-y: auto;
        `;

        // Header
        const galleryHeader = document.createElement('h3');
        galleryHeader.textContent = '📚 Galeria de Pontos';
        galleryHeader.style.cssText = `
            margin: 0 0 15px 0;
            font-size: 18px;
            color: #333;
            font-weight: 600;
        `;
        galleryColumn.appendChild(galleryHeader);

        // Search box (future enhancement)
        const searchBox = document.createElement('input');
        searchBox.type = 'text';
        searchBox.placeholder = '🔍 Buscar ponto...';
        searchBox.style.cssText = `
            width: 100%;
            padding: 10px;
            border: 2px solid #ddd;
            border-radius: 8px;
            font-size: 14px;
            margin-bottom: 15px;
            box-sizing: border-box;
        `;
        galleryColumn.appendChild(searchBox);

        // Categories
        const categories = [
            { name: 'Gerais', points: UI_DATA.pointsList.filter(p => p.category === 'Gerais') },
            { name: 'Movimento e Manobra', points: UI_DATA.pointsList.filter(p => p.category === 'Movimento e Manobra') },
            { name: 'Passagens', points: UI_DATA.pointsList.filter(p => p.category === 'Passagens') },
            { name: 'Fogos', points: UI_DATA.pointsList.filter(p => p.category === 'Fogos') },
            { name: 'Proteção - Obstáculos', points: UI_DATA.pointsList.filter(p => p.category === 'Proteção - Obstáculos') },
            { name: 'Proteção - Fortificação', points: UI_DATA.pointsList.filter(p => p.category === 'Proteção - Fortificação') },
            { name: 'Proteção - Minas', points: UI_DATA.pointsList.filter(p => p.category === 'Proteção - Minas') },
            { name: 'Proteção - QBRN', points: UI_DATA.pointsList.filter(p => p.category === 'Proteção - QBRN') },
            { name: 'Logística', points: UI_DATA.pointsList.filter(p => p.category === 'Logística') },
            { name: 'Controle Aéreo', points: UI_DATA.pointsList.filter(p => p.category === 'Controle Aéreo') },
            { name: 'Controle Marítimo', points: UI_DATA.pointsList.filter(p => p.category === 'Controle Marítimo') }
        ];

        // Add Escalões category
        categories.push({
            name: 'Escalões',
            points: [
                { code: 'ECHELON', label: 'Escalão', category: 'Escalões' },
                { code: 'ECHELON_FT', label: 'Escalão Força-Tarefa', category: 'Escalões' }
            ]
        });

        // Create category sections
        for (const category of categories) {
            if (category.points.length === 0) continue;

            const categorySection = document.createElement('div');
            categorySection.style.cssText = 'margin-bottom: 20px;';

            // Category header (collapsible)
            const categoryHeader = document.createElement('div');
            categoryHeader.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px;
                background: #e9ecef;
                border-radius: 8px;
                cursor: pointer;
                margin-bottom: 10px;
                font-weight: 600;
                font-size: 14px;
                color: #495057;
            `;

            const categoryTitle = document.createElement('span');
            categoryTitle.textContent = `📂 ${category.name} (${category.points.length})`;

            const categoryToggle = document.createElement('span');
            categoryToggle.textContent = '▼';
            categoryToggle.style.cssText = 'font-size: 10px; transition: transform 0.2s;';

            categoryHeader.appendChild(categoryTitle);
            categoryHeader.appendChild(categoryToggle);

            // Grid de pontos
            const pointsGrid = document.createElement('div');
            pointsGrid.style.cssText = `
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
                gap: 10px;
                padding: 5px;
                display: none;
            `;

            // Toggle category
            let isCategoryExpanded = false;
            categoryHeader.onclick = () => {
                isCategoryExpanded = !isCategoryExpanded;
                pointsGrid.style.display = isCategoryExpanded ? 'grid' : 'none';
                categoryToggle.style.transform = isCategoryExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
            };

            // Add point items (generate thumbnails on demand when category is expanded)
            const pointItems = [];
            category.points.forEach(point => {
                const pointItem = createPointThumbnailPlaceholder(point, onPointClick);
                pointsGrid.appendChild(pointItem);
                pointItems.push({ element: pointItem, point });
            });

            // Generate thumbnails when category is opened
            const originalToggle = categoryHeader.onclick;
            categoryHeader.onclick = async () => {
                originalToggle();
                
                if (isCategoryExpanded) {
                    // Generate thumbnails
                    for (const item of pointItems) {
                        if (!item.generated) {
                            await generateThumbnail(item.element, item.point);
                            item.generated = true;
                        }
                    }
                }
            };

            categorySection.appendChild(categoryHeader);
            categorySection.appendChild(pointsGrid);
            galleryColumn.appendChild(categorySection);
        }

        return galleryColumn;
    }

    /**
     * Create thumbnail placeholder (image loaded on demand)
     */
    function createPointThumbnailPlaceholder(point, onPointClick) {
        const container = document.createElement('div');
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 8px;
            border: 2px solid #dee2e6;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            background: white;
        `;

        container.onmouseenter = () => {
            container.style.borderColor = '#007bff';
            container.style.boxShadow = '0 2px 8px rgba(0,123,255,0.3)';
        };

        container.onmouseleave = () => {
            container.style.borderColor = '#dee2e6';
            container.style.boxShadow = 'none';
        };

        container.onclick = () => onPointClick(point.code);

        // Image placeholder
        const img = document.createElement('img');
        img.style.cssText = `
            width: 60px;
            height: 60px;
            object-fit: contain;
            margin-bottom: 5px;
            background: #f8f9fa;
        `;
        img.alt = '...';

        // Label
        const label = document.createElement('div');
        label.textContent = point.label;
        label.style.cssText = `
            font-size: 10px;
            text-align: center;
            color: #495057;
            word-wrap: break-word;
            max-width: 80px;
        `;

        container.appendChild(img);
        container.appendChild(label);

        return container;
    }

    /**
     * Generate thumbnail for point
     */
    async function generateThumbnail(container, point) {
        try {
            const img = container.querySelector('img');
            
            // For escalão types, use a default
            let pointCode = point.code;
            let properties = { pointCode };

            if (pointCode === 'ECHELON') {
                properties.echelonCode = 'ECHELON_16';
            } else if (pointCode === 'ECHELON_FT') {
                properties.echelonCode = 'ECHELON_FT_16';
            }

            const result = await coordinationMeasureControl.generator.generate(
                pointCode,
                properties
            );

            if (result && result.dataUrl) {
                img.src = result.dataUrl;
            }
        } catch (error) {
            console.warn(`Could not generate thumbnail for ${point.code}:`, error);
        }
    }

    /**
     * Get applicable text fields for a given point code
     */
    function getApplicableTextFields(pointCode) {
        if (!pointCode) return [];

        // Get point data from catalog
        const pointData = COORDINATION_POINTS_CATALOG[pointCode];

        if (pointData && pointData.textFields) {
            return pointData.textFields;
        }

        // Check if it's an echelon type
        if (isEchelonPointCode(pointCode)) {
            return ['identificacao', 'gdhIni', 'gdhFim'];
        }

        // Default fields for unknown points
        return ['tipo', 'identificacao', 'gdhIni', 'gdhFim'];
    }

    /**
     * Get points grouped options for combo box
     */
    function getPointsGroupedOptions() {
        const options = [];

        // Add regular points by category
        const grouped = {};
        UI_DATA.pointsList.forEach(point => {
            const category = point.category || 'Outros';
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(point);
        });

        // Category order
        const categoryOrder = [
            'Gerais',
            'Movimento e Manobra',
            'Passagens',
            'Fogos',
            'Proteção - Obstáculos',
            'Proteção - Fortificação',
            'Proteção - Minas',
            'Proteção - QBRN',
            'Logística',
            'Controle Aéreo',
            'Controle Marítimo'
        ];

        categoryOrder.forEach(category => {
            if (grouped[category]) {
                grouped[category].forEach(point => {
                    options.push({
                        value: point.code,
                        label: `${point.label} (${category})`
                    });
                });
            }
        });

        // Add special types (echelon)
        options.push({
            value: 'ECHELON',
            label: '⭐ Escalão (requer subtipo)'
        });
        options.push({
            value: 'ECHELON_FT',
            label: '⭐ Escalão Força-Tarefa (requer subtipo)'
        });

        return options;
    }

    /**
     * Get echelon subtype options
     */
    function getEchelonSubtypeOptions(echelonType) {
        const subtypes = echelonType === 'ECHELON_FT'
            ? UI_DATA.echelonFTSubtypes
            : UI_DATA.echelonSubtypes;

        return subtypes.map(st => ({
            value: st.code,
            label: st.label
        }));
    }

    /**
     * Check if point code is an echelon type
     */
    function isEchelonPointCode(pointCode) {
        if (!pointCode) return false;
        return pointCode === 'ECHELON' ||
            pointCode === 'ECHELON_FT' ||
            pointCode.startsWith('ECHELON_');
    }

    /**
     * Clear all text modifiers from properties
     */
    function clearAllTextModifiers(properties) {
        const modifiers = [
            'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
            'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
        ];

        modifiers.forEach(mod => {
            delete properties[mod];
        });
    }

    /**
     * Get point label from code
     */
    function getPointLabel(pointCode) {
        if (!pointCode) return 'Não definido';

        const pointData = COORDINATION_POINTS_CATALOG[pointCode];
        if (pointData) {
            return pointData.name || pointData.label || pointCode;
        }

        // Try to find in UI_DATA
        const uiPoint = UI_DATA.pointsList.find(p => p.code === pointCode);
        if (uiPoint) {
            return uiPoint.label;
        }

        // Check echelon types
        const echelon = UI_DATA.echelonSubtypes.find(e => e.code === pointCode);
        if (echelon) {
            return echelon.label;
        }

        const echelonFT = UI_DATA.echelonFTSubtypes.find(e => e.code === pointCode);
        if (echelonFT) {
            return echelonFT.label;
        }

        return pointCode;
    }
}

export default addCoordinationMeasureAttributesToPanel;
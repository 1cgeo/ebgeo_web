// Path: js\controls_sig\coordination_measure_tool\coordination_measure_attributes_panel.js

import {
    createSliderWithInput,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    createColorPicker,
    createCheckbox,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';
import { COORDINATION_POINTS_CATALOG, getAvailableTextFields } from './coordination_points_catalog.js';
import { UI_DATA, SUPPLY_CLASSES } from './coordination_measure_constants.js';

/**
 * Add Coordination Measure attributes to panel
 * Follows the same pattern as military symbol attributes panel with 2-column modal
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
        pointButton.textContent = 'Configurar';
        pointButton.style.cssText = 'width: 100%; margin-bottom: 15px; padding: 10px;';
        pointButton.onclick = () => openPointModal();

        $(panel).append(createAttributeRow('Símbolo:', pointButton));
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

    // ===== MODAL DO PONTO (2 COLUNAS) =====

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

    // ===== FUNÇÃO PARA CRIAR CONTROLE DE COR =====
    function createColorControl(currentValue, onChange, label) {
        const container = document.createElement('div');
        container.className = 'color-control-container';

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
                    // Habilitar cor personalizada - usar cor atual ou verde padrão
                    const color = currentValue || '#11FF00';
                    onChange(color);
                    updateColorControlState(color);
                } else {
                    // Desabilitar cor personalizada - usar padrão (branco)
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

        return container;
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
            max-width: 1200px;
            width: 90%;
            max-height: 85vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        `;

        // Modal header - ✅ MODIFICAÇÃO 1 e 2: Título centralizado e sem "tipo atual"
        const header = document.createElement('div');
        header.style.cssText = 'margin-bottom: 25px; padding-bottom: 15px; border-bottom: 2px solid #eee;';
        header.innerHTML = `
            <h2 style="margin: 0; font-size: 24px; color: #333; text-align: center;">Configurar Medida de Coordenação</h2>
        `;

        // Modal content container - ✅ MODIFICAÇÃO 6: Grid com 2 colunas
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            display: grid;
            grid-template-columns: 55% 45%;
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
        // ✅ MODIFICAÇÃO 5: "Visualização" fora do container
        const previewColumn = document.createElement('div');
        previewColumn.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            position: sticky;
            top: 0;
            max-height: 65vh;
        `;

        // Título fora do container (seguindo padrão do military_symbol)
        const previewTitle = document.createElement('h4');
        previewTitle.textContent = 'Visualização';
        previewTitle.style.cssText = `
            margin-bottom: 15px;
            font-size: 16px;
            color: #333;
        `;
        previewColumn.appendChild(previewTitle);

        // Container do preview com estilo
        const previewImageContainer = document.createElement('div');
        previewImageContainer.style.cssText = `
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
            border: 2px solid #dee2e6;
            min-height: 250px;
            min-width: 200px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const previewImage = document.createElement('img');
        previewImage.style.cssText = `
            max-width: 100%;
            max-height: 500px;
            object-fit: contain;
        `;
        previewImageContainer.appendChild(previewImage);
        previewColumn.appendChild(previewImageContainer);

        // ✅ MODIFICAÇÃO 4: Removido dimensionsInfo completamente

        // Update preview function
        let previewDebounceTimer = null;
        async function updatePreview() {
            try {
                // Validate pointCode
                if (!tempProperties.pointCode) {
                    previewImage.style.display = 'none';
                    return;
                }

                // For ECHELON placeholders, ensure echelonCode is set
                if (isEchelonPointCode(tempProperties.pointCode) && !tempProperties.echelonCode) {
                    previewImage.style.display = 'none';
                    return;
                }

                // Determine actual point code to use
                let actualPointCode = tempProperties.pointCode;
                
                // Handle echelon placeholders - use the actual echelon code
                if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
                    actualPointCode = tempProperties.echelonCode || 
                        (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
                }

                // Generate preview
                const result = await coordinationMeasureControl.symbolGenerator.generate(
                    actualPointCode,
                    tempProperties
                );

                if (result && result.dataUrl) {
                    previewImage.src = result.dataUrl;
                    previewImage.style.display = 'block';
                } else {
                    previewImage.style.display = 'none';
                }
            } catch (error) {
                console.error('Erro ao gerar preview:', error);
                previewImage.style.display = 'none';
            }
        }

        function updatePreviewDebounced() {
            clearTimeout(previewDebounceTimer);
            previewDebounceTimer = setTimeout(() => {
                updatePreview();
            }, 50);
        }

        // ===== TIPO DE PONTO (COMBO BOX COM PREVIEW) =====
        // ✅ MODIFICAÇÃO 7: Usando combo box com thumbnails
        const pointTypeCombo = createDigitalComboBoxWithThumbnails(
            getPointsGroupedOptions(),
            tempProperties.pointCode,
            (newValue) => {
                const wasEchelon = isEchelonPointCode(tempProperties.pointCode);
                const isEchelon = newValue === 'ECHELON' || newValue === 'ECHELON_FT';

                tempProperties.pointCode = newValue;

                // Clear echelon code if switching from echelon to regular point
                if (wasEchelon && !isEchelon) {
                    tempProperties.echelonCode = null; // ✅ Set to null instead of delete
                }

                // Set default echelon code when switching to any echelon type
                // (includes switching between ECHELON and ECHELON_FT)
                if (isEchelon) {
                    tempProperties.echelonCode = newValue === 'ECHELON_FT' ? 'ECHELON_FT_16' : 'ECHELON_16';
                }

                // Clear text modifiers when changing point type
                clearAllTextModifiers(tempProperties);

                // Show/hide and update subtype dropdown
                if (isEchelon) {
                    subtypeDropdown.style.display = 'block';
                    updateSubtypeCombo();
                } else {
                    subtypeDropdown.style.display = 'none';
                }

                // Rebuild text modifiers section
                rebuildTextModifiersSection(tempProperties.pointCode);

                updatePreviewDebounced();
            },
            'Tipo'
        );

        controlsColumn.appendChild(pointTypeCombo);

        // ===== SUBTIPO DE ESCALÃO (CONDICIONAL) =====
        const subtypeDropdown = document.createElement('div');
        subtypeDropdown.style.display = isEchelonPointCode(tempProperties.pointCode) ? 'block' : 'none';

        function updateSubtypeCombo() {
            subtypeDropdown.innerHTML = '';
            
            if (!isEchelonPointCode(tempProperties.pointCode)) return;

            const isFT = tempProperties.pointCode === 'ECHELON_FT';
            const subtypeCombo = createDigitalComboBoxWithThumbnails(
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

        // ===== COR PERSONALIZADA =====
        const colorControlModal = createColorControl(
            tempProperties.fillColor,
            (newColor) => {
                tempProperties.fillColor = newColor;
                updatePreviewDebounced();
            },
            'Cor do símbolo'
        );
        controlsColumn.appendChild(colorControlModal);

        // ===== AMPLIFICADORES TEXTUAIS =====
        const textModifiersSection = document.createElement('div');
        textModifiersSection.style.cssText = `
            padding-top: 15px;
        `;

        // Content container (sempre visível)
        const textModifiersContent = document.createElement('div');
        textModifiersContent.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 15px;';

        textModifiersSection.appendChild(textModifiersContent);
        controlsColumn.appendChild(textModifiersSection);

        // Função para reconstruir os campos baseado no pointCode
        function rebuildTextModifiersSection(pointCode) {
            textModifiersContent.innerHTML = '';

            const applicableFields = getAvailableTextFields(pointCode);

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

        // ✅ MODIFICAÇÃO 6: Galeria removida - montar modal diretamente
        modalContent.appendChild(controlsColumn);
        modalContent.appendChild(previewColumn);

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
            // Apply all properties at once to avoid race conditions
            const propertiesToUpdate = [
                'pointCode', 'echelonCode', 'fillColor',
                // Text modifiers
                'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
                'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
            ];

            // Get source data ONCE
            const data = await coordinationMeasureControl.map.getSource("coordination_measures").getData();
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
                            if (coordinationMeasureControl.geometry.affectsSIDC(key) ||
                                coordinationMeasureControl.geometry.affectsTextModifiers(key) ||
                                key === 'fillColor') {
                                needsRegeneration = true;
                            }
                        }
                    }
                }
            }

            // Update source with ALL changes
            coordinationMeasureControl.map.getSource("coordination_measures").setData(data);

            // Regenerate symbol ONCE if needed
            if (needsRegeneration && selectedFeatures.length > 0) {
                // Get UPDATED feature from source to ensure all properties are present
                const updatedData = await coordinationMeasureControl.map.getSource("coordination_measures").getData();
                const updatedFeature = updatedData.features.find(
                    f => f.properties.id === selectedFeatures[0].properties.id
                );
                
                if (updatedFeature) {
                    // Regenerate symbol with ALL updated properties
                    await coordinationMeasureControl.updateSymbolImage(updatedFeature);
                    
                    // Update SelectionManager with updated feature
                    coordinationMeasureControl.updateSelectionManagerFeature(updatedFeature);
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
     * Generate thumbnail for combo box options
     * ✅ MODIFICAÇÃO 7: Nova função para gerar thumbnails
     */
    async function generatePointThumbnailForCombo(pointCode, defaultEchelonCode) {
        try {
            // Handle echelon placeholders - use the actual echelon code
            if (pointCode === 'ECHELON' || pointCode === 'ECHELON_FT') {
                pointCode = defaultEchelonCode || 
                    (pointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
            }
            
            const result = await coordinationMeasureControl.symbolGenerator.generate(
                pointCode,
                {}  // Empty properties for thumbnail generation
            );
            
            return result?.dataUrl || null;
        } catch (error) {
            console.warn(`Erro ao gerar thumbnail para combo: ${pointCode}`, error);
            return null;
        }
    }


    /**
     * Create digital combo box with thumbnail previews
     * ✅ MODIFICAÇÃO 7: Nova função para combo box com thumbnails
     */
    function createDigitalComboBoxWithThumbnails(options, currentValue, onChange, label) {
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
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 50px;
        `;

        // Container para thumbnail e texto
        const displayContent = document.createElement('div');
        displayContent.style.cssText = 'display: flex; align-items: center; gap: 10px; flex: 1;';
        
        const displayThumbnail = document.createElement('img');
        displayThumbnail.style.cssText = `
            width: 30px;
            height: 30px;
            object-fit: contain;
            flex-shrink: 0;
        `;
        
        const displayText = document.createElement('span');
        displayText.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        
        displayContent.appendChild(displayThumbnail);
        displayContent.appendChild(displayText);
        selectDisplay.appendChild(displayContent);

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
            max-height: 400px;
            overflow-y: auto;
            background: white;
            border: 2px solid #ddd;
            border-radius: 8px;
            z-index: 10001;
            display: none;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            min-width: 300px;
        `;

        // Register dropdown
        openDropdowns.push(dropdown);

        // Atualizar display com thumbnail
        async function updateDisplay(value) {
            const selected = options.find(opt => opt.value === value);
            if (selected) {
                displayText.textContent = selected.label;
                
                // Generate thumbnail if iconCode exists
                if (selected.iconCode) {
                    const thumbnailUrl = await generatePointThumbnailForCombo(
                        selected.iconCode,
                        selected.defaultEchelonCode
                    );
                    
                    if (thumbnailUrl) {
                        displayThumbnail.src = thumbnailUrl;
                        displayThumbnail.style.display = 'block';
                    } else {
                        displayThumbnail.style.display = 'none';
                    }
                } else {
                    displayThumbnail.style.display = 'none';
                }
            } else {
                displayText.textContent = 'Selecione...';
                displayThumbnail.style.display = 'none';
            }
        }

        // Popular dropdown com thumbnails
        options.forEach(option => {
            const optionElement = document.createElement('div');
            optionElement.style.cssText = `
                padding: 12px 15px;
                cursor: pointer;
                font-size: 14px;
                transition: background-color 0.2s;
                border-bottom: 1px solid #f0f0f0;
                display: flex;
                align-items: center;
                gap: 10px;
            `;

            // Thumbnail na opção
            const optionThumbnail = document.createElement('img');
            optionThumbnail.style.cssText = `
                width: 25px;
                height: 25px;
                object-fit: contain;
                flex-shrink: 0;
            `;

            const optionText = document.createElement('span');
            optionText.textContent = option.label;
            optionText.style.cssText = 'flex: 1;';

            // Generate thumbnail if iconCode exists
            if (option.iconCode) {
                generatePointThumbnailForCombo(option.iconCode, option.defaultEchelonCode)
                    .then(thumbnailUrl => {
                        if (thumbnailUrl) {
                            optionThumbnail.src = thumbnailUrl;
                            optionElement.insertBefore(optionThumbnail, optionText);
                        }
                    });
            }
            
            optionElement.appendChild(optionText);

            if (option.value === currentValue) {
                optionElement.style.backgroundColor = '#e9ecef';
            }

            optionElement.onmouseenter = () => optionElement.style.backgroundColor = '#f8f9fa';
            optionElement.onmouseleave = () => {
                optionElement.style.backgroundColor = option.value === currentValue ? '#e9ecef' : 'transparent';
            };

            optionElement.onclick = () => {
                currentValue = option.value;
                updateDisplay(option.value);
                onChange(option.value);
                closeAllDropdowns();
                
                // Update selected state
                dropdown.querySelectorAll('div').forEach(div => {
                    div.style.backgroundColor = 'transparent';
                });
                optionElement.style.backgroundColor = '#e9ecef';
            };

            dropdown.appendChild(optionElement);
        });

        // Toggle dropdown
        selectDisplay.onclick = (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display === 'block';
            closeAllDropdowns();
            
            if (!isOpen) {
                // Calcular posição do dropdown
                const rect = selectDisplay.getBoundingClientRect();
                dropdown.style.top = (rect.bottom + 5) + 'px';
                dropdown.style.left = rect.left + 'px';
                dropdown.style.width = rect.width + 'px';
                dropdown.style.display = 'block';
                selectDisplay.style.borderColor = '#007bff';
            } else {
                dropdown.style.display = 'none';
                selectDisplay.style.borderColor = '#ddd';
            }
        };

        // Close on outside click
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
            // Remover dropdown do body
            if (dropdown.parentNode) {
                dropdown.parentNode.removeChild(dropdown);
            }
        };

        document.addEventListener('click', closeDropdown);

        selectContainer.appendChild(selectDisplay);
        // Adicionar dropdown ao body para position: fixed funcionar
        document.body.appendChild(dropdown);
        container.appendChild(labelElement);
        container.appendChild(selectContainer);

        // Initialize display
        updateDisplay(currentValue);

        return container;
    }

    /**
     * Create digital combo box (simple version without thumbnails)
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
            position: fixed;
            max-height: 300px;
            overflow-y: auto;
            background: white;
            border: 2px solid #ddd;
            border-radius: 8px;
            z-index: 10001;
            display: none;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            min-width: 200px;
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
            
            if (!isOpen) {
                // Calcular posição do dropdown
                const rect = selectDisplay.getBoundingClientRect();
                dropdown.style.top = (rect.bottom + 5) + 'px';
                dropdown.style.left = rect.left + 'px';
                dropdown.style.width = rect.width + 'px';
                dropdown.style.display = 'block';
                selectDisplay.style.borderColor = '#007bff';
            } else {
                dropdown.style.display = 'none';
                selectDisplay.style.borderColor = '#ddd';
            }
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
            // Remover dropdown do body
            if (dropdown.parentNode) {
                dropdown.parentNode.removeChild(dropdown);
            }
        };

        document.addEventListener('click', closeDropdown);

        updateDisplay();

        container.appendChild(labelElement);
        selectContainer.appendChild(selectDisplay);
        // Adicionar dropdown ao body para position: fixed funcionar
        document.body.appendChild(dropdown);
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
        label.textContent = fieldDef.label;
        label.style.cssText = `
            font-size: 13px;
            font-weight: 600;
            color: #495057;
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
     * Get points grouped options for combo box
     * ✅ MODIFICAÇÃO 7: Incluindo iconCode para thumbnails
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
                        label: `${point.label} (${category})`,
                        iconCode: point.code,  // ✅ NOVO: para gerar thumbnail
                        isEchelon: false
                    });
                });
            }
        });

        // Add special types (echelon)
        options.push({
            value: 'ECHELON',
            label: 'Escalão (requer subtipo)',
            iconCode: null,  // Sem preview para placeholder
            isEchelon: true,
            defaultEchelonCode: 'ECHELON_16'
        });
        options.push({
            value: 'ECHELON_FT',
            label: 'Escalão Força-Tarefa (requer subtipo)',
            iconCode: null,  // Sem preview para placeholder
            isEchelon: true,
            defaultEchelonCode: 'ECHELON_FT_16'
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
            label: st.label,
            iconCode: st.code  // Adicionar iconCode para gerar thumbnails
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
     * Sets to null instead of delete to ensure they are cleared when applied
     */
    function clearAllTextModifiers(properties) {
        const modifiers = [
            'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
            'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
        ];

        modifiers.forEach(mod => {
            properties[mod] = null; // ✅ Set to null instead of delete
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
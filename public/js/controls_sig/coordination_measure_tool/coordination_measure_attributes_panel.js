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
 * Simplified panel with modal for detailed configuration (similar to military symbol)
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

    // ✅ Capture initial properties at panel opening
    const initialPropertiesMap = new Map(
        selectedFeatures.map(f => [f.properties.id, { ...f.properties }])
    );

    // ===== NOME EDITÁVEL (APENAS SELEÇÃO ÚNICA) =====
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

    // ===== BOTÃO PARA CONFIGURAR PONTO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const configButton = document.createElement('button');
        configButton.classList.add('tool-button', 'pure-material-button-contained');
        configButton.textContent = 'Configurar Ponto...';
        configButton.style.cssText = 'width: 100%; margin-bottom: 15px; padding: 10px;';
        configButton.onclick = () => openConfigModal();

        $(panel).append(createAttributeRow('Ponto:', configButton));
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
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    const buttons = createStandardButtons({
        selectedFeatures,
        control: coordinationMeasureControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: false,
        onSetDefault: null
    });

    $(panel).append(buttons);

    // ===== MODAL DE CONFIGURAÇÃO DO PONTO =====

    function openConfigModal() {
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
            max-width: 900px;
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
        `;

        // Modal content container (2 colunas)
        const modalContent = document.createElement('div');
        modalContent.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 25px;';

        // Coluna 1: Controles
        const controlsColumn = document.createElement('div');
        controlsColumn.style.cssText = 'display: flex; flex-direction: column; gap: 20px;';

        // Coluna 2: Preview
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
        `;

        const previewTitle = document.createElement('h3');
        previewTitle.textContent = 'Preview';
        previewTitle.style.cssText = 'margin: 0 0 20px 0; font-size: 18px; color: #333;';
        previewColumn.appendChild(previewTitle);

        const previewImage = document.createElement('img');
        previewImage.style.cssText = 'max-width: 100%; max-height: 400px; object-fit: contain;';
        previewColumn.appendChild(previewImage);

        // ===== COMBO BOX DO TIPO DE PONTO =====
        const pointTypeCombo = createDigitalComboBox(
            getPontosGroupedOptions(),
            tempProperties.pointCode,
            (newValue) => {
                tempProperties.pointCode = newValue;
                updateDynamicFields();
                updatePreview();
            },
            'Tipo de Ponto'
        );

        controlsColumn.appendChild(pointTypeCombo);

        // Container para subtipo (escalão)
        const subtypeContainer = document.createElement('div');
        subtypeContainer.id = 'subtype-container';
        subtypeContainer.style.display = 'none';
        controlsColumn.appendChild(subtypeContainer);

        // Container para amplificadores textuais
        const textModifiersContainer = document.createElement('div');
        textModifiersContainer.id = 'text-modifiers-container';
        controlsColumn.appendChild(textModifiersContainer);

        // Montar modal
        modal.appendChild(header);
        modalContent.appendChild(controlsColumn);
        modalContent.appendChild(previewColumn);
        modal.appendChild(modalContent);

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
            await applyChanges();
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
            if (e.target === modalOverlay) closeModal();
        };

        document.addEventListener('keydown', handleEscape);

        document.body.appendChild(modalOverlay);

        // Inicializar campos e preview
        updateDynamicFields();
        updatePreview();

        // ===== FUNÇÕES AUXILIARES =====

        function handleEscape(e) {
            if (e.key === 'Escape') {
                closeModal();
            }
        }

        function closeModal() {
            document.removeEventListener('keydown', handleEscape);
            document.body.removeChild(modalOverlay);
        }

        async function applyChanges() {
            try {
                // Validar propriedades
                const errors = validateProperties(tempProperties);
                if (errors.length > 0) {
                    alert(errors.join('\n'));
                    return;
                }

                // Aplicar mudanças ao feature
                const propertiesToUpdate = [
                    'pointCode', 'tipo', 'identificacao', 'gdhIni', 'gdhFim',
                    'numero', 'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
                ];

                for (const key of propertiesToUpdate) {
                    if (tempProperties.hasOwnProperty(key)) {
                        await coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, key, tempProperties[key]);
                    }
                }

                // Regenerar símbolo
                await coordinationMeasureControl.regenerateSymbol(feature);

                // Salvar e fechar
                await coordinationMeasureControl.saveFeatures(selectedFeatures, initialPropertiesMap);
                closeModal();
                selectionManager.deselectAllFeatures();

            } catch (error) {
                console.error('Error applying changes:', error);
                alert('Erro ao aplicar mudanças: ' + error.message);
            }
        }

        function updateDynamicFields() {
            const pointCode = tempProperties.pointCode;

            // Limpar containers
            subtypeContainer.innerHTML = '';
            subtypeContainer.style.display = 'none';
            textModifiersContainer.innerHTML = '';

            if (!pointCode) return;

            // Verificar se é tipo escalão (precisa de subtipo)
            if (pointCode === 'ECHELON' || pointCode === 'ECHELON_FT') {
                subtypeContainer.style.display = 'block';

                const subtypeOptions = pointCode === 'ECHELON'
                    ? UI_DATA.echelonSubtypes.map(s => ({ value: s.code, label: s.label }))
                    : UI_DATA.echelonFTSubtypes.map(s => ({ value: s.code, label: s.label }));

                const subtypeCombo = createDigitalComboBox(
                    subtypeOptions,
                    tempProperties.echelonSubtype || null,
                    (newValue) => {
                        tempProperties.echelonSubtype = newValue;
                        // Atualizar pointCode com o subtipo selecionado
                        tempProperties.pointCode = newValue;
                        updateTextModifiersFields(newValue);
                        updatePreview();
                    },
                    'Escalão'
                );

                subtypeContainer.appendChild(subtypeCombo);
            } else {
                // Tipo normal, carregar text modifiers
                updateTextModifiersFields(pointCode);
            }
        }

        function updateTextModifiersFields(pointCode) {
            textModifiersContainer.innerHTML = '';

            const pointData = COORDINATION_POINTS_CATALOG[pointCode];
            if (!pointData || !pointData.textFields || pointData.textFields.length === 0) {
                return;
            }

            // Título
            const title = document.createElement('div');
            title.textContent = 'Amplificadores Textuais';
            title.style.cssText = 'font-weight: bold; font-size: 15px; color: #333; margin-bottom: 15px; padding-top: 15px; border-top: 1px solid #dee2e6;';
            textModifiersContainer.appendChild(title);

            // Criar campos
            pointData.textFields.forEach(fieldName => {
                const fieldDef = UI_DATA.textFieldDefinitions[fieldName];
                if (!fieldDef) return;

                const fieldContainer = document.createElement('div');
                fieldContainer.style.cssText = 'margin-bottom: 15px;';

                const label = document.createElement('label');
                label.textContent = fieldDef.label + ':';
                label.style.cssText = 'display: block; margin-bottom: 6px; font-weight: 500; font-size: 14px; color: #333;';
                if (fieldDef.required) {
                    label.style.color = '#dc3545';
                    label.textContent = fieldDef.label + ': *';
                }
                fieldContainer.appendChild(label);

                if (fieldDef.type === 'select') {
                    const select = createSelectField(fieldName, fieldDef, tempProperties);
                    fieldContainer.appendChild(select);
                } else {
                    const input = createInputField(fieldName, fieldDef, tempProperties);
                    fieldContainer.appendChild(input);
                }

                if (fieldDef.help) {
                    const help = document.createElement('div');
                    help.style.cssText = 'font-size: 11px; color: #6c757d; margin-top: 4px; font-style: italic;';
                    help.textContent = fieldDef.help;
                    fieldContainer.appendChild(help);
                }

                textModifiersContainer.appendChild(fieldContainer);
            });
        }

        function createSelectField(fieldName, fieldDef, properties) {
            const select = document.createElement('select');
            select.style.cssText = `
                width: 100%;
                padding: 10px;
                border: 2px solid #ddd;
                border-radius: 6px;
                font-size: 14px;
                background: white;
                cursor: pointer;
            `;

            const defaultOpt = document.createElement('option');
            defaultOpt.value = '';
            defaultOpt.textContent = 'Selecione...';
            select.appendChild(defaultOpt);

            const options = fieldName === 'classeSuprimento'
                ? Object.entries(SUPPLY_CLASSES).map(([k, v]) => ({ value: k, label: v }))
                : fieldDef.options.map(o => ({ value: o, label: o }));

            options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                select.appendChild(option);
            });

            select.value = properties[fieldName] || '';

            select.onchange = (e) => {
                properties[fieldName] = e.target.value;
                updatePreview();
            };

            return select;
        }

        function createInputField(fieldName, fieldDef, properties) {
            const input = document.createElement('input');
            input.type = fieldDef.type;
            input.placeholder = fieldDef.placeholder || '';
            input.style.cssText = `
                width: 100%;
                padding: 10px;
                border: 2px solid #ddd;
                border-radius: 6px;
                font-size: 14px;
                box-sizing: border-box;
            `;

            if (fieldDef.type === 'number') {
                input.min = '1';
            }

            input.value = properties[fieldName] || '';

            let debounceTimer = null;
            input.oninput = (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    let value = e.target.value.trim();
                    if (fieldDef.type === 'number') {
                        value = value ? parseInt(value, 10) : null;
                    }
                    properties[fieldName] = value;
                    updatePreview();
                }, 500);
            };

            return input;
        }

        async function updatePreview() {
            try {
                if (!tempProperties.pointCode) {
                    previewImage.style.display = 'none';
                    return;
                }

                // Gerar preview
                const result = await coordinationMeasureControl.generator.generate(
                    tempProperties.pointCode,
                    tempProperties
                );

                if (result && result.dataUrl) {
                    previewImage.src = result.dataUrl;
                    previewImage.style.display = 'block';
                } else {
                    previewImage.style.display = 'none';
                }

            } catch (error) {
                console.error('Error generating preview:', error);
                previewImage.style.display = 'none';
            }
        }

        function validateProperties(properties) {
            const errors = [];
            const pointData = COORDINATION_POINTS_CATALOG[properties.pointCode];

            if (!properties.pointCode) {
                errors.push('Selecione um tipo de ponto');
                return errors;
            }

            if (!pointData) {
                errors.push('Tipo de ponto inválido');
                return errors;
            }

            if (pointData.requiresNumber && !properties.numero) {
                errors.push('Este ponto requer um número');
            }

            if (pointData.hasSupplyIcon && !properties.classeSuprimento) {
                errors.push('Selecione a classe de suprimento');
            }

            return errors;
        }
    }

    // ===== FUNÇÃO PARA CRIAR DIGITAL COMBO BOX =====

    function createDigitalComboBox(options, currentValue, onChange, label) {
        const container = document.createElement('div');
        container.style.cssText = 'margin-bottom: 20px; position: relative;';

        const labelElement = document.createElement('label');
        labelElement.textContent = label + ':';
        labelElement.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 15px; color: #333;';

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
        textContainer.style.cssText = 'flex: 1; overflow: hidden; word-wrap: break-word;';
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

            item.onmouseenter = () => item.style.backgroundColor = '#f8f9fa';
            item.onmouseleave = () => item.style.backgroundColor = 'white';

            item.onclick = () => {
                currentValue = option.value;
                updateDisplay();
                dropdown.style.display = 'none';
                onChange(option.value);
            };

            dropdown.appendChild(item);
        });

        // Toggle dropdown
        selectDisplay.onclick = (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display === 'block';
            dropdown.style.display = isOpen ? 'none' : 'block';
            selectDisplay.style.borderColor = isOpen ? '#ddd' : '#007bff';
        };

        // Fechar ao clicar fora
        document.addEventListener('click', () => {
            dropdown.style.display = 'none';
            selectDisplay.style.borderColor = '#ddd';
        });

        updateDisplay();

        container.appendChild(labelElement);
        container.appendChild(selectDisplay);
        container.appendChild(dropdown);

        return container;
    }

    // ===== FUNÇÃO AUXILIAR PARA OPÇÕES AGRUPADAS =====

    function getPontosGroupedOptions() {
        const options = [];

        // Adicionar pontos normais por categoria
        const grouped = {};
        UI_DATA.pointsList.forEach(point => {
            const category = point.category || 'Outros';
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(point);
        });

        Object.keys(grouped).forEach(category => {
            grouped[category].forEach(point => {
                options.push({
                    value: point.code,
                    label: `${point.label} (${category})`
                });
            });
        });

        // Adicionar tipos especiais (escalão)
        options.push({ value: 'ECHELON', label: '⭐ Escalão (requer subtipo)' });
        options.push({ value: 'ECHELON_FT', label: '⭐ Escalão Força-Tarefa (requer subtipo)' });

        return options;
    }
}

export default addCoordinationMeasureAttributesToPanel;
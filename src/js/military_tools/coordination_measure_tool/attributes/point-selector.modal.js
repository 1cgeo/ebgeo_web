// Path: js/military_tools/coordination_measure_tool/attributes/point-selector.modal.js

/**
 * @fileoverview Point selector modal for coordination measure configuration.
 * Main orchestrator for the point configuration modal.
 */

import {
    createDigitalComboBoxWithThumbnails,
    isEchelonPointCode,
    getPointsGroupedOptions,
    getEchelonSubtypeOptions,
    clearAllTextModifiers,
    closeAllDropdowns as _closeAllDropdowns,
    createDropdownState
} from './ui-components.helpers.js';
import { createColorControlSection } from './color-control.section.js';
import { createTextModifierField } from './text-modifiers.section.js';
import { getAvailableTextFields } from '../coordination_points_catalog.js';
import { UI_DATA } from '../coordination_measure_constants.js';

/**
 * @typedef {Object} PointModalConfig
 * @property {Object} feature - Feature being edited
 * @property {Array} selectedFeatures - All selected features
 * @property {Object} coordinationMeasureControl - Control instance
 * @property {Object} selectionManager - Selection manager instance
 * @property {Map} initialPropertiesMap - Map of initial properties
 */

/**
 * Generate thumbnail for combo box options.
 * @param {Object} coordinationMeasureControl - Control instance
 * @param {string} pointCode - Point code
 * @param {string} defaultEchelonCode - Default echelon code
 * @returns {Promise<string|null>} Data URL or null
 */
async function generatePointThumbnailForCombo(coordinationMeasureControl, pointCode, defaultEchelonCode) {
    try {
        if (pointCode === 'ECHELON' || pointCode === 'ECHELON_FT') {
            pointCode = defaultEchelonCode ||
                (pointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
        }

        const result = await coordinationMeasureControl.symbolGenerator.generate(
            pointCode,
            {}
        );

        return result?.dataUrl || null;
    } catch (error) {
        console.warn(`Error generating combo thumbnail: ${pointCode}`, error);
        return null;
    }
}

/**
 * Opens the point configuration modal.
 * @param {PointModalConfig} config - Modal configuration
 */
export function openPointModal(config) {
    const {
        feature,
        selectedFeatures,
        coordinationMeasureControl,
        selectionManager,
        initialPropertiesMap
    } = config;

    const tempProperties = { ...feature.properties };
    const dropdownState = createDropdownState();
    let previewDebounceTimer = null;

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

    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 25px; padding-bottom: 15px; border-bottom: 2px solid #eee;';
    header.innerHTML = `
        <h2 style="margin: 0; font-size: 24px; color: #333; text-align: center;">Configurar Medida de Coordenacao</h2>
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        display: grid;
        grid-template-columns: 55% 45%;
        gap: 30px;
        margin-bottom: 25px;
    `;

    const controlsColumn = document.createElement('div');
    controlsColumn.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-height: 65vh;
        overflow-y: auto;
        padding-right: 10px;
    `;

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

    const previewTitle = document.createElement('h4');
    previewTitle.textContent = 'Visualizacao';
    previewTitle.style.cssText = `
        margin-bottom: 15px;
        font-size: 16px;
        color: #333;
    `;
    previewColumn.appendChild(previewTitle);

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

    /**
     * Updates the preview image.
     */
    async function updatePreview() {
        try {
            if (!tempProperties.pointCode) {
                previewImage.style.display = 'none';
                return;
            }

            if (isEchelonPointCode(tempProperties.pointCode) && !tempProperties.echelonCode) {
                previewImage.style.display = 'none';
                return;
            }

            let actualPointCode = tempProperties.pointCode;

            if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
                actualPointCode = tempProperties.echelonCode ||
                    (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
            }

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

    /**
     * Updates preview with debounce.
     */
    function updatePreviewDebounced() {
        clearTimeout(previewDebounceTimer);
        previewDebounceTimer = setTimeout(() => {
            updatePreview();
        }, 50);
    }

    /**
     * Thumbnail generator bound to control.
     */
    const generateThumbnail = (pointCode, defaultEchelonCode) => {
        return generatePointThumbnailForCombo(coordinationMeasureControl, pointCode, defaultEchelonCode);
    };

    const textModifiersContent = document.createElement('div');
    textModifiersContent.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 15px;';

    /**
     * Rebuilds text modifiers section.
     * @param {string} pointCode - Point code
     */
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

    const subtypeDropdown = document.createElement('div');
    subtypeDropdown.style.display = isEchelonPointCode(tempProperties.pointCode) ? 'block' : 'none';

    /**
     * Updates subtype combo box.
     */
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
            isFT ? 'Escalao Forca-Tarefa' : 'Escalao',
            generateThumbnail,
            dropdownState
        );

        subtypeDropdown.appendChild(subtypeCombo);
    }

    const pointTypeCombo = createDigitalComboBoxWithThumbnails(
        getPointsGroupedOptions(),
        tempProperties.pointCode,
        (newValue) => {
            const wasEchelon = isEchelonPointCode(tempProperties.pointCode);
            const isEchelon = newValue === 'ECHELON' || newValue === 'ECHELON_FT';

            tempProperties.pointCode = newValue;

            if (wasEchelon && !isEchelon) {
                tempProperties.echelonCode = null;
            }

            if (isEchelon) {
                tempProperties.echelonCode = newValue === 'ECHELON_FT' ? 'ECHELON_FT_16' : 'ECHELON_16';
            }

            clearAllTextModifiers(tempProperties);

            if (isEchelon) {
                subtypeDropdown.style.display = 'block';
                updateSubtypeCombo();
            } else {
                subtypeDropdown.style.display = 'none';
            }

            rebuildTextModifiersSection(tempProperties.pointCode);

            updatePreviewDebounced();
        },
        'Tipo',
        generateThumbnail,
        dropdownState
    );

    controlsColumn.appendChild(pointTypeCombo);

    updateSubtypeCombo();
    controlsColumn.appendChild(subtypeDropdown);

    const colorControlModal = createColorControlSection(
        tempProperties.fillColor,
        (newColor) => {
            tempProperties.fillColor = newColor;
            updatePreviewDebounced();
        },
        'Cor do simbolo'
    );
    controlsColumn.appendChild(colorControlModal);

    const textModifiersSection = document.createElement('div');
    textModifiersSection.style.cssText = 'padding-top: 15px;';
    textModifiersSection.appendChild(textModifiersContent);
    controlsColumn.appendChild(textModifiersSection);

    rebuildTextModifiersSection(tempProperties.pointCode);

    modalContent.appendChild(controlsColumn);
    modalContent.appendChild(previewColumn);

    modal.appendChild(header);
    modal.appendChild(modalContent);

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
    applyButton.onmouseenter = () => { applyButton.style.backgroundColor = '#0056b3'; };
    applyButton.onmouseleave = () => { applyButton.style.backgroundColor = '#007bff'; };
    applyButton.onclick = async () => {
        const propertiesToUpdate = [
            'pointCode', 'echelonCode', 'fillColor',
            'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
            'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
        ];

        const data = await coordinationMeasureControl.map.getSource("coordination_measures").getData();
        let needsRegeneration = false;

        for (const feat of selectedFeatures) {
            const sourceFeature = data.features.find(
                (f) => f.properties.id === feat.properties.id
            );

            if (sourceFeature) {
                for (const key of propertiesToUpdate) {
                    if (Object.prototype.hasOwnProperty.call(tempProperties, key)) {
                        sourceFeature.properties[key] = tempProperties[key];
                        feat.properties[key] = tempProperties[key];

                        if (coordinationMeasureControl.geometry.affectsSIDC(key) ||
                            coordinationMeasureControl.geometry.affectsTextModifiers(key) ||
                            key === 'fillColor') {
                            needsRegeneration = true;
                        }
                    }
                }
            }
        }

        coordinationMeasureControl.map.getSource("coordination_measures").setData(data);

        if (needsRegeneration && selectedFeatures.length > 0) {
            const updatedData = await coordinationMeasureControl.map.getSource("coordination_measures").getData();
            const updatedFeature = updatedData.features.find(
                f => f.properties.id === selectedFeatures[0].properties.id
            );

            if (updatedFeature) {
                await coordinationMeasureControl.updateSymbolImage(updatedFeature);
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
    cancelButton.onmouseenter = () => { cancelButton.style.backgroundColor = '#545b62'; };
    cancelButton.onmouseleave = () => { cancelButton.style.backgroundColor = '#6c757d'; };
    cancelButton.onclick = closeModal;

    modalButtons.appendChild(applyButton);
    modalButtons.appendChild(cancelButton);

    modal.appendChild(modalButtons);
    modalOverlay.appendChild(modal);

    modalOverlay.onclick = (e) => {
        if (e.target === modalOverlay) {
            closeModal();
        }
    };

    /**
     * Closes the modal and cleans up.
     */
    function closeModal() {
        document.removeEventListener('keydown', handleModalKeyDown);

        const comboBoxes = Array.from(controlsColumn.children);
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

    /**
     * Handles keyboard events for modal.
     * @param {KeyboardEvent} e - Keyboard event
     */
    function handleModalKeyDown(e) {
        if (e.key === 'Escape') {
            const hasOpenDropdown = dropdownState.openDropdowns.some(dropdown =>
                dropdown.style.display === 'block'
            );

            if (!hasOpenDropdown) {
                e.preventDefault();
                closeModal();
            }
        }
    }

    document.addEventListener('keydown', handleModalKeyDown);

    document.body.appendChild(modalOverlay);
    updatePreview();
}

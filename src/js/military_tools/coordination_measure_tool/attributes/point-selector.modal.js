// Path: js/military_tools/coordination_measure_tool/attributes/point-selector.modal.js

/**
 * @fileoverview Point selector modal for coordination measure configuration.
 * Main orchestrator for the point configuration modal.
 */

import { ModalBase } from '../../../modals/modal.base.js';
import { addDomListener } from '../../../utilities/event-cleanup.js';

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
 * Icons used in the modal.
 */
const ICONS = {
    coordinationMeasure: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>`
};

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
 * Point selector modal class.
 * @extends ModalBase
 */
export class PointSelectorModal extends ModalBase {
    /**
     * @param {PointModalConfig} config - Modal configuration
     */
    constructor(config) {
        super({
            id: 'point-selector-modal',
            title: 'Configurar Medida de Coordenação',
            icon: ICONS.coordinationMeasure
        });

        this._feature = config.feature;
        this._selectedFeatures = config.selectedFeatures;
        this._coordinationMeasureControl = config.coordinationMeasureControl;
        this._selectionManager = config.selectionManager;
        this._initialPropertiesMap = config.initialPropertiesMap;

        this._tempProperties = { ...config.feature.properties };
        this._dropdownState = createDropdownState();
        this._previewDebounceTimer = null;
        this._previewImage = null;
        this._subtypeDropdown = null;
        this._textModifiersContent = null;
    }

    /**
     * Renders the modal content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._container.classList.add('point-selector-modal-container');

        const body = this.getBody();
        body.innerHTML = '';
        body.appendChild(this._createBodyContent());

        this._setupListeners();
        this._updatePreview();

        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Creates the body content.
     * @private
     * @returns {HTMLElement}
     */
    _createBodyContent() {
        const content = document.createElement('div');
        content.className = 'point-selector-content';

        // Main layout: controls + preview
        const mainLayout = document.createElement('div');
        mainLayout.className = 'point-selector-main';

        // Controls column
        const controlsColumn = document.createElement('div');
        controlsColumn.className = 'point-selector-controls';
        this._controlsColumn = controlsColumn;

        // Point type combo
        const generateThumbnail = (pointCode, defaultEchelonCode) => {
            return generatePointThumbnailForCombo(this._coordinationMeasureControl, pointCode, defaultEchelonCode);
        };

        const pointTypeCombo = createDigitalComboBoxWithThumbnails(
            getPointsGroupedOptions(),
            this._tempProperties.pointCode,
            (newValue) => this._handlePointTypeChange(newValue),
            'Tipo',
            generateThumbnail,
            this._dropdownState
        );
        controlsColumn.appendChild(pointTypeCombo);

        // Subtype dropdown (for echelon types)
        this._subtypeDropdown = document.createElement('div');
        this._subtypeDropdown.className = 'point-selector-subtype';
        this._subtypeDropdown.style.display = isEchelonPointCode(this._tempProperties.pointCode) ? 'block' : 'none';
        this._updateSubtypeCombo();
        controlsColumn.appendChild(this._subtypeDropdown);

        // Color control
        const colorControl = createColorControlSection(
            this._tempProperties.fillColor,
            (newColor) => {
                this._tempProperties.fillColor = newColor;
                this._updatePreviewDebounced();
            },
            'Cor do simbolo'
        );
        controlsColumn.appendChild(colorControl);

        // Text modifiers section
        const textModifiersSection = document.createElement('div');
        textModifiersSection.className = 'point-selector-text-modifiers';

        this._textModifiersContent = document.createElement('div');
        this._textModifiersContent.className = 'point-selector-text-grid';
        this._rebuildTextModifiersSection(this._tempProperties.pointCode);
        textModifiersSection.appendChild(this._textModifiersContent);
        controlsColumn.appendChild(textModifiersSection);

        // Preview column
        const previewColumn = document.createElement('div');
        previewColumn.className = 'point-selector-preview';

        const previewLabel = document.createElement('h4');
        previewLabel.className = 'point-selector-preview-label';
        previewLabel.textContent = 'Visualização';
        previewColumn.appendChild(previewLabel);

        const previewContainer = document.createElement('div');
        previewContainer.className = 'point-selector-preview-container';

        this._previewImage = document.createElement('img');
        this._previewImage.className = 'point-selector-preview-image';
        previewContainer.appendChild(this._previewImage);
        previewColumn.appendChild(previewContainer);

        mainLayout.appendChild(controlsColumn);
        mainLayout.appendChild(previewColumn);

        content.appendChild(mainLayout);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'point-selector-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'point-selector-btn point-selector-btn-cancel';
        cancelBtn.textContent = 'Cancelar';
        this._cancelBtn = cancelBtn;

        const applyBtn = document.createElement('button');
        applyBtn.className = 'point-selector-btn point-selector-btn-apply';
        applyBtn.textContent = 'Aplicar';
        this._applyBtn = applyBtn;

        actions.appendChild(cancelBtn);
        actions.appendChild(applyBtn);
        content.appendChild(actions);

        return content;
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupListeners() {
        addDomListener(this, this._cancelBtn, 'click', () => this.hide());
        addDomListener(this, this._applyBtn, 'click', () => this._handleApply());
    }

    /**
     * Handles point type change.
     * @private
     * @param {string} newValue - New point code
     */
    _handlePointTypeChange(newValue) {
        const wasEchelon = isEchelonPointCode(this._tempProperties.pointCode);
        const isEchelon = newValue === 'ECHELON' || newValue === 'ECHELON_FT';

        this._tempProperties.pointCode = newValue;

        if (wasEchelon && !isEchelon) {
            this._tempProperties.echelonCode = null;
        }

        if (isEchelon) {
            this._tempProperties.echelonCode = newValue === 'ECHELON_FT' ? 'ECHELON_FT_16' : 'ECHELON_16';
        }

        clearAllTextModifiers(this._tempProperties);

        if (isEchelon) {
            this._subtypeDropdown.style.display = 'block';
            this._updateSubtypeCombo();
        } else {
            this._subtypeDropdown.style.display = 'none';
        }

        this._rebuildTextModifiersSection(this._tempProperties.pointCode);
        this._updatePreviewDebounced();
    }

    /**
     * Updates subtype combo box.
     * @private
     */
    _updateSubtypeCombo() {
        this._subtypeDropdown.innerHTML = '';

        if (!isEchelonPointCode(this._tempProperties.pointCode)) return;

        const generateThumbnail = (pointCode, defaultEchelonCode) => {
            return generatePointThumbnailForCombo(this._coordinationMeasureControl, pointCode, defaultEchelonCode);
        };

        const isFT = this._tempProperties.pointCode === 'ECHELON_FT';
        const subtypeCombo = createDigitalComboBoxWithThumbnails(
            getEchelonSubtypeOptions(this._tempProperties.pointCode),
            this._tempProperties.echelonCode || (isFT ? 'ECHELON_FT_16' : 'ECHELON_16'),
            (newValue) => {
                this._tempProperties.echelonCode = newValue;
                this._updatePreviewDebounced();
            },
            isFT ? 'Escalao Forca-Tarefa' : 'Escalao',
            generateThumbnail,
            this._dropdownState
        );

        this._subtypeDropdown.appendChild(subtypeCombo);
    }

    /**
     * Rebuilds text modifiers section.
     * @private
     * @param {string} pointCode - Point code
     */
    _rebuildTextModifiersSection(pointCode) {
        this._textModifiersContent.innerHTML = '';

        const applicableFields = getAvailableTextFields(pointCode);

        applicableFields.forEach(fieldName => {
            const fieldDef = UI_DATA.textFieldDefinitions[fieldName];
            if (!fieldDef) return;

            const fieldContainer = createTextModifierField(
                fieldName,
                fieldDef,
                this._tempProperties[fieldName],
                (newValue) => {
                    this._tempProperties[fieldName] = newValue;
                    this._updatePreviewDebounced();
                }
            );

            this._textModifiersContent.appendChild(fieldContainer);
        });
    }

    /**
     * Updates preview with debounce.
     * @private
     */
    _updatePreviewDebounced() {
        clearTimeout(this._previewDebounceTimer);
        this._previewDebounceTimer = setTimeout(() => {
            this._updatePreview();
        }, 50);
    }

    /**
     * Updates the preview image.
     * @private
     */
    async _updatePreview() {
        try {
            if (!this._tempProperties.pointCode) {
                this._previewImage.style.display = 'none';
                return;
            }

            if (isEchelonPointCode(this._tempProperties.pointCode) && !this._tempProperties.echelonCode) {
                this._previewImage.style.display = 'none';
                return;
            }

            let actualPointCode = this._tempProperties.pointCode;

            if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
                actualPointCode = this._tempProperties.echelonCode ||
                    (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
            }

            const result = await this._coordinationMeasureControl.symbolGenerator.generate(
                actualPointCode,
                this._tempProperties
            );

            if (result && result.dataUrl) {
                this._previewImage.src = result.dataUrl;
                this._previewImage.style.display = 'block';
            } else {
                this._previewImage.style.display = 'none';
            }
        } catch (error) {
            console.error('Erro ao gerar preview:', error);
            this._previewImage.style.display = 'none';
        }
    }

    /**
     * Handles apply button click.
     * @private
     */
    async _handleApply() {
        const propertiesToUpdate = [
            'pointCode', 'echelonCode', 'fillColor',
            'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
            'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
        ];

        const data = await this._coordinationMeasureControl.map.getSource("coordination_measures").getData();
        let needsRegeneration = false;

        for (const feat of this._selectedFeatures) {
            const sourceFeature = data.features.find(
                (f) => f.properties.id === feat.properties.id
            );

            if (sourceFeature) {
                for (const key of propertiesToUpdate) {
                    if (Object.prototype.hasOwnProperty.call(this._tempProperties, key)) {
                        sourceFeature.properties[key] = this._tempProperties[key];
                        feat.properties[key] = this._tempProperties[key];

                        if (this._coordinationMeasureControl.geometry.affectsSIDC(key) ||
                            this._coordinationMeasureControl.geometry.affectsTextModifiers(key) ||
                            key === 'fillColor') {
                            needsRegeneration = true;
                        }
                    }
                }
            }
        }

        this._coordinationMeasureControl.map.getSource("coordination_measures").setData(data);

        if (needsRegeneration && this._selectedFeatures.length > 0) {
            const updatedData = await this._coordinationMeasureControl.map.getSource("coordination_measures").getData();
            const updatedFeature = updatedData.features.find(
                f => f.properties.id === this._selectedFeatures[0].properties.id
            );

            if (updatedFeature) {
                await this._coordinationMeasureControl.updateSymbolImage(updatedFeature);
                this._coordinationMeasureControl.updateSelectionManagerFeature(updatedFeature);
            }
        }

        this._coordinationMeasureControl.saveFeatures(this._selectedFeatures, this._initialPropertiesMap);
        this.hide();
        this._selectionManager.deselectAllFeatures();
    }

    /**
     * Hides the modal.
     * @override
     */
    hide() {
        // Cleanup comboboxes
        if (this._controlsColumn) {
            const comboBoxes = Array.from(this._controlsColumn.children);
            comboBoxes.forEach(combo => {
                if (combo._cleanup) {
                    combo._cleanup();
                }
            });
        }

        if (this._previewDebounceTimer) {
            clearTimeout(this._previewDebounceTimer);
        }

        super.hide();
    }
}

/**
 * Opens the point configuration modal.
 * @param {PointModalConfig} config - Modal configuration
 */
export function openPointModal(config) {
    const modal = new PointSelectorModal(config);
    modal.render();
    modal.show();
    return modal;
}

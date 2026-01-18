// Path: js/military_tools/military_symbol_tool/attributes/symbol-selector.modal.js

/**
 * @fileoverview Symbol selection modal for military symbols.
 * Main orchestrator for the symbol configuration modal.
 */

import {
    normalizeSIDC,
    BrazilianSIDCExtension
} from '../brazilian_sidc_extension.js';
import { checkCatalogWarnings } from '../brazilian_svg_postprocessing.js';
import { isEngagementBarApplicable, getTextModifiersConfig } from '../military_constants.js';

import { createTabsContainer, switchTab, closeAllDropdowns } from './ui-components.helpers.js';
import { createSymbolGallery } from './symbol-gallery.section.js';
import { createTextFieldsContainer } from './text-modifiers.section.js';
import { createEngagementBarContent } from './engagement-bar.section.js';
import { createSymbolFormColumns } from './symbol-form.section.js';

/**
 * @typedef {Object} SymbolModalConfig
 * @property {Object} feature - Feature being edited
 * @property {Array} selectedFeatures - All selected features
 * @property {Object} militarySymbolControl - Military symbol control instance
 * @property {Object} selectionManager - Selection manager instance
 * @property {Map} initialPropertiesMap - Map of initial properties
 */

/**
 * Generates preview with text modifiers.
 *
 * @param {Object} militarySymbolControl - Control instance
 * @param {Object} properties - Symbol properties
 * @param {number} [size=80] - Preview size
 * @returns {Promise<string|null>} Data URL or null
 */
async function generatePreviewWithTextModifiers(militarySymbolControl, properties, size = 80) {
    try {
        const result = await militarySymbolControl.symbolGenerator.generateSymbolBlob(properties);

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

/**
 * Creates the SIDC input section.
 *
 * @param {Object} tempProperties - Temporary properties
 * @param {Object} militarySymbolControl - Control instance
 * @param {Function} updateComboboxesFromSIDC - SIDC update callback
 * @param {Function} updatePreview - Preview update callback
 * @returns {Object} SIDC container and input element
 */
function createSidcInput(tempProperties, militarySymbolControl, updateComboboxesFromSIDC, updatePreview) {
    const sidcContainer = document.createElement('div');
    sidcContainer.style.cssText = 'margin-top: 15px;';

    const sidcInputLabel = document.createElement('label');
    sidcInputLabel.textContent = 'SIDC:';
    sidcInputLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 14px; color: #333;';

    const sidcInput = document.createElement('input');
    sidcInput.type = 'text';
    sidcInput.placeholder = '30 digitos (ex: 10031000161211000000 0760000000)';
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

    sidcInput.addEventListener('input', (e) => {
        let cleanSIDC = e.target.value.replace(/\s/g, '').trim();

        if (cleanSIDC.length > 30) {
            cleanSIDC = cleanSIDC.substring(0, 30);
        }

        if (e.target.value !== cleanSIDC) {
            e.target.value = cleanSIDC;
        }

        sidcInput.style.borderColor = '#ddd';
        sidcStatusMessage.textContent = '';

        if (cleanSIDC.length === 20) {
            const normalized = normalizeSIDC(cleanSIDC);
            sidcInput.value = normalized;
            cleanSIDC = normalized;
            updateComboboxesFromSIDC(cleanSIDC);
            updatePreview();
        } else if (cleanSIDC.length === 30) {
            updateComboboxesFromSIDC(cleanSIDC);
            updatePreview();
        } else if (cleanSIDC.length > 0 && cleanSIDC.length < 20) {
            sidcInput.style.borderColor = '#ffc107';
            sidcStatusMessage.style.color = '#856404';
            sidcStatusMessage.textContent = `\u26A0\uFE0F ${cleanSIDC.length}/20 digitos (minimo)`;
        } else if (cleanSIDC.length > 20 && cleanSIDC.length < 30) {
            sidcInput.style.borderColor = '#ffc107';
            sidcStatusMessage.style.color = '#856404';
            sidcStatusMessage.textContent = `\u26A0\uFE0F ${cleanSIDC.length}/30 digitos`;
        }
    });

    sidcInput.addEventListener('paste', (e) => {
        setTimeout(() => {
            let cleanSIDC = sidcInput.value.replace(/\s/g, '').trim();

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

    return { sidcContainer, sidcInput, sidcStatusMessage };
}

/**
 * Opens the symbol configuration modal.
 *
 * @param {SymbolModalConfig} config - Modal configuration
 */
export function openSymbolModal(config) {
    const { feature, selectedFeatures, militarySymbolControl, selectionManager, initialPropertiesMap } = config;

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
    modalTitle.textContent = 'Configurar Simbolo Militar';
    modalTitle.style.cssText = 'margin-top: 0; margin-bottom: 30px; text-align: center; font-size: 24px; color: #333;';
    modal.appendChild(modalTitle);

    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'display: flex; gap: 20px;';

    const controlsColumn = document.createElement('div');
    controlsColumn.style.cssText = 'flex: 1;';

    const previewColumn = document.createElement('div');
    previewColumn.style.cssText = 'flex: 0 0 240px; text-align: center;';

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
    previewLabel.textContent = 'Visualizacao';
    previewLabel.style.cssText = 'margin-bottom: 15px; font-size: 16px; color: #333;';

    const tempProperties = { ...feature.properties };

    /**
     * Updates the preview image.
     */
    async function updatePreview() {
        try {
            const sidc = tempProperties.sidc;
            const validation = militarySymbolControl.symbolGenerator.validateSIDC(sidc);

            if (!validation.valid) {
                previewImage.style.display = 'none';
                return;
            }

            const previewDataURL = await generatePreviewWithTextModifiers(
                militarySymbolControl,
                tempProperties,
                80
            );

            if (previewDataURL) {
                previewImage.src = previewDataURL;
                previewImage.style.display = 'block';
            } else {
                previewImage.style.display = 'none';
                console.warn('Failed to generate preview for SIDC:', sidc);
            }

        } catch (error) {
            console.error('Error generating preview:', error);
            previewImage.style.display = 'none';
        }
    }

    /**
     * Updates preview from combobox changes.
     */
    function updatePreviewFromComboboxes() {
        const sidc = militarySymbolControl.symbolGenerator.buildSIDC(tempProperties);
        tempProperties.sidc = sidc;
        sidcInput.value = sidc;
        updatePreview();
    }

    const formColumns = createSymbolFormColumns({
        tempProperties,
        updatePreview: updatePreviewFromComboboxes
    });

    const { column1, column2, comboboxes, reloadDependentComboboxes, updateAllComboboxValues, dropdownState, setUpdatingFromSIDC } = formColumns;

    /**
     * Updates comboboxes from SIDC input.
     * @param {string} sidc - SIDC code
     */
    function updateComboboxesFromSIDC(sidc) {
        try {
            setUpdatingFromSIDC(true);

            let normalizedSIDC = sidc;
            if (sidc.length === 20) {
                normalizedSIDC = normalizeSIDC(sidc);
                sidcInput.value = normalizedSIDC;
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

            tempProperties.sidc = normalizedSIDC;

            if (dimensionChanged) {
                wrappedReloadDependentComboboxes(newSymbolSet);
            }

            updateAllComboboxValues();

            const extension = BrazilianSIDCExtension.decode(normalizedSIDC.substring(20));
            const sidc20 = normalizedSIDC.substring(0, 20);
            const warnings = checkCatalogWarnings(extension, tempProperties.symbolSet, sidc20);

            if (warnings.length > 0) {
                sidcInput.style.borderColor = '#ffc107';
                sidcStatusMessage.style.color = '#856404';
                sidcStatusMessage.textContent = '\u26A0\uFE0F ' + warnings[0];
                console.warn('Uncataloged extensions:', warnings);
            } else {
                sidcInput.style.borderColor = '#28a745';
                sidcStatusMessage.style.color = '#155724';
                sidcStatusMessage.textContent = '\u2713 SIDC valido';
            }

        } catch (error) {
            sidcInput.style.borderColor = '#dc3545';
            sidcStatusMessage.style.color = '#721c24';
            sidcStatusMessage.textContent = '\u2717 ' + error.message;
            console.warn('Invalid SIDC for parsing:', error.message);
        } finally {
            setUpdatingFromSIDC(false);
        }
    }

    const { sidcContainer, sidcInput, sidcStatusMessage } = createSidcInput(
        tempProperties,
        militarySymbolControl,
        updateComboboxesFromSIDC,
        updatePreview
    );

    previewColumn.appendChild(previewLabel);
    previewColumn.appendChild(previewContainer);
    previewColumn.appendChild(sidcContainer);

    const tabsContainer = createTabsContainer();
    const { simboloTab, textoTab, engajamentoTab, tabButtons } = tabsContainer;

    simboloTab.appendChild(column1);
    simboloTab.appendChild(column2);

    let textFieldsContainer = createTextFieldsContainer(
        tempProperties.symbolSet || "10",
        tempProperties,
        updatePreviewFromComboboxes
    );
    textoTab.appendChild(textFieldsContainer);

    let engagementBarContainer = createEngagementBarContent(
        tempProperties,
        updatePreviewFromComboboxes
    );
    engajamentoTab.appendChild(engagementBarContainer);
    engagementBarContainer.updateFromProperties(tempProperties);

    /**
     * Updates engagement bar visibility based on symbol set.
     */
    function updateEngagementBarVisibility() {
        const isApplicable = isEngagementBarApplicable(tempProperties.symbolSet || "10");
        tabButtons.engajamento.style.display = isApplicable ? '' : 'none';
        if (!isApplicable && engajamentoTab.style.display === 'block') {
            switchTab('simbolo', tabButtons);
        }
    }
    updateEngagementBarVisibility();

    tabButtons.simbolo.onclick = () => {
        switchTab('simbolo', tabButtons);
    };

    tabButtons.texto.onclick = () => {
        switchTab('texto', tabButtons);
    };

    tabButtons.engajamento.onclick = () => {
        switchTab('engajamento', tabButtons);
    };

    controlsColumn.appendChild(tabsContainer.container);

    /**
     * Extended reload function that also updates text and engagement tabs.
     * @param {string} symbolSetCode - Symbol set code
     */
    function wrappedReloadDependentComboboxes(symbolSetCode) {
        reloadDependentComboboxes(symbolSetCode);

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

        while (textoTab.firstChild) {
            textoTab.removeChild(textoTab.firstChild);
        }

        textFieldsContainer = createTextFieldsContainer(
            symbolSetCode,
            tempProperties,
            updatePreviewFromComboboxes
        );
        textoTab.appendChild(textFieldsContainer);

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
    }

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
        const propertiesToUpdate = [
            'standardIdentity', 'symbolSet', 'status', 'hqTfDummy', 'echelon',
            'mainIcon', 'modifier1', 'modifier2', 'specialModifier', 'isCommand',
            'mainIconExtension', 'modifier1Extension', 'modifier2Extension',
            'sidc', 'fillColor',
            'uniqueDesignation', 'higherFormation', 'reinforcedReduced',
            'additionalInformation', 'credibility', 'location', 'dateTimeGroup',
            'altitudeDepth', 'speed', 'specialHeadquarters', 'type', 'iffSif',
            'equipmentTeardownTime', 'quantity', 'direction',
            'engagementBar'
        ];

        const data = await militarySymbolControl.map.getSource("military_symbols").getData();
        let needsRegeneration = false;

        for (const feat of selectedFeatures) {
            const sourceFeature = data.features.find(
                (f) => f.properties.id == feat.properties.id
            );

            if (sourceFeature) {
                for (const key of propertiesToUpdate) {
                    if (tempProperties.hasOwnProperty(key)) {
                        sourceFeature.properties[key] = tempProperties[key];
                        feat.properties[key] = tempProperties[key];

                        if (militarySymbolControl.geometry.affectsSIDC(key) ||
                            militarySymbolControl.geometry.affectsTextModifiers(key) ||
                            key === 'fillColor') {
                            needsRegeneration = true;
                        }
                    }
                }

                if (needsRegeneration) {
                    const newSIDC30 = militarySymbolControl.symbolGenerator.buildSIDC(sourceFeature.properties);
                    sourceFeature.properties.sidc = newSIDC30;
                    feat.properties.sidc = newSIDC30;
                }
            }
        }

        militarySymbolControl.map.getSource("military_symbols").setData(data);

        if (needsRegeneration && selectedFeatures.length > 0) {
            const updatedData = await militarySymbolControl.map.getSource("military_symbols").getData();
            const updatedFeature = updatedData.features.find(
                f => f.properties.id === selectedFeatures[0].properties.id
            );

            if (updatedFeature) {
                await militarySymbolControl.updateSymbolImage(updatedFeature);
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

    /**
     * Closes the modal and cleans up.
     */
    function closeModal() {
        document.removeEventListener('keydown', handleModalKeyDown);

        const comboBoxes = [column1, column2].flatMap(col => Array.from(col.children));
        comboBoxes.forEach(combo => {
            if (combo._cleanup) {
                combo._cleanup();
            }
        });
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

    /**
     * Initializes the modal.
     */
    async function initializeModal() {
        try {
            const onSymbolClick = (sidc) => {
                updateComboboxesFromSIDC(sidc);

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

            const galleryColumn = await createSymbolGallery(militarySymbolControl, onSymbolClick);

            modalContent.appendChild(controlsColumn);
            modalContent.appendChild(previewColumn);
            modalContent.appendChild(galleryColumn);
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

        } catch (error) {
            console.error('Error initializing modal:', error);

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

    initializeModal();
}

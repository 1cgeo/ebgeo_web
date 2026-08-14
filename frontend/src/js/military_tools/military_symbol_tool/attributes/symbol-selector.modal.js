// Path: js/military_tools/military_symbol_tool/attributes/symbol-selector.modal.js

/**
 * @fileoverview Symbol selection modal for military symbols.
 * Main orchestrator for the symbol configuration modal.
 */

import { ModalBase } from '@modals/modal.base.js';
import { addDomListener } from '@utils/event-cleanup.js';

import {
    normalizeSIDC,
    BrazilianSIDCExtension
} from '../brazilian_sidc_extension.js';
import { checkCatalogWarnings } from '../brazilian_svg_postprocessing.js';
import { isEngagementBarApplicable } from '../military_constants.js';
import { loadSymbolSets } from '../symbol_sets.registry.js';

import { createTabsContainer, switchTab } from './ui-components.helpers.js';
import { createSymbolGallery } from './symbol-gallery.section.js';
import { createTextFieldsContainer } from './text-modifiers.section.js';
import { createEngagementBarContent } from './engagement-bar.section.js';
import { createSymbolFormColumns } from './symbol-form.section.js';

/**
 * Icons used in the modal.
 */
const ICONS = {
    militarySymbol: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
    </svg>`
};

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
 * @returns {Promise<string|null>} Data URL or null
 */
async function generatePreviewWithTextModifiers(militarySymbolControl, properties) {
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

/** Text modifier property keys to clear when changing symbols. */
const TEXT_MODIFIER_KEYS = [
    'uniqueDesignation', 'higherFormation', 'reinforcedReduced',
    'additionalInformation', 'credibility', 'location', 'dateTimeGroup',
    'altitudeDepth', 'speed', 'specialHeadquarters', 'type', 'iffSif',
    'equipmentTeardownTime', 'quantity', 'direction'
];

/** Properties to copy when applying changes. */
const PROPERTIES_TO_UPDATE = [
    'standardIdentity', 'symbolSet', 'status', 'hqTfDummy', 'echelon',
    'mainIcon', 'modifier1', 'modifier2', 'specialModifier', 'isCommand',
    'mainIconExtension', 'modifier1Extension', 'modifier2Extension',
    'sidc', 'fillColor',
    ...TEXT_MODIFIER_KEYS,
    'engagementBar'
];

/**
 * Symbol selector modal class.
 * @extends ModalBase
 */
export class SymbolSelectorModal extends ModalBase {
    /**
     * @param {SymbolModalConfig} config - Modal configuration
     */
    constructor(config) {
        super({
            id: 'symbol-selector-modal',
            title: 'Configurar Símbolo Militar',
            icon: ICONS.militarySymbol
        });

        this._feature = config.feature;
        this._selectedFeatures = config.selectedFeatures;
        this._militarySymbolControl = config.militarySymbolControl;
        this._selectionManager = config.selectionManager;
        this._initialPropertiesMap = config.initialPropertiesMap;

        this._tempProperties = { ...config.feature.properties };
        this._previewImage = null;
        this._sidcInput = null;
        this._sidcStatusMessage = null;
        this._formColumns = null;
        this._tabButtons = null;
        this._textoTab = null;
        this._engajamentoTab = null;
        this._textFieldsContainer = null;
        this._engagementBarContainer = null;
    }

    /**
     * Renders the modal content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._container.classList.add('symbol-selector-modal-container');

        const body = this.getBody();
        body.innerHTML = '';
        body.appendChild(this._createBodyContent());

        this._setupListeners();
        this._initializeAsync();

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
        content.className = 'symbol-selector-content';

        const mainLayout = document.createElement('div');
        mainLayout.className = 'symbol-selector-main';

        // Controls column
        const controlsColumn = document.createElement('div');
        controlsColumn.className = 'symbol-selector-controls';
        this._controlsColumn = controlsColumn;

        // Create tabs
        const tabsContainer = createTabsContainer();
        const { simboloTab, textoTab, engajamentoTab, tabButtons } = tabsContainer;
        this._tabButtons = tabButtons;
        this._textoTab = textoTab;
        this._engajamentoTab = engajamentoTab;

        // Create form columns
        this._formColumns = createSymbolFormColumns({
            tempProperties: this._tempProperties,
            updatePreview: () => this._updatePreviewFromComboboxes()
        });

        simboloTab.appendChild(this._formColumns.column1);
        simboloTab.appendChild(this._formColumns.column2);

        // Text modifiers tab
        this._textFieldsContainer = createTextFieldsContainer(
            this._tempProperties.symbolSet || "10",
            this._tempProperties,
            () => this._updatePreviewFromComboboxes()
        );
        textoTab.appendChild(this._textFieldsContainer);

        // Engagement bar tab
        this._engagementBarContainer = createEngagementBarContent(
            this._tempProperties,
            () => this._updatePreviewFromComboboxes()
        );
        engajamentoTab.appendChild(this._engagementBarContainer);
        this._engagementBarContainer.updateFromProperties(this._tempProperties);

        this._updateEngagementBarVisibility();

        controlsColumn.appendChild(tabsContainer.container);

        // Preview column
        const previewColumn = document.createElement('div');
        previewColumn.className = 'symbol-selector-preview';

        const previewLabel = document.createElement('h4');
        previewLabel.className = 'symbol-selector-preview-label';
        previewLabel.textContent = 'Visualização';
        previewColumn.appendChild(previewLabel);

        const previewContainer = document.createElement('div');
        previewContainer.className = 'symbol-selector-preview-container';

        this._previewImage = document.createElement('img');
        this._previewImage.className = 'symbol-selector-preview-image';
        previewContainer.appendChild(this._previewImage);
        previewColumn.appendChild(previewContainer);

        previewColumn.appendChild(this._createSidcInput());

        // Gallery column (placeholder, filled async)
        this._galleryColumn = document.createElement('div');
        this._galleryColumn.className = 'symbol-selector-gallery';

        mainLayout.appendChild(controlsColumn);
        mainLayout.appendChild(previewColumn);
        mainLayout.appendChild(this._galleryColumn);

        content.appendChild(mainLayout);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'symbol-selector-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'symbol-selector-btn symbol-selector-btn-cancel';
        cancelBtn.textContent = 'Cancelar';
        this._cancelBtn = cancelBtn;

        const applyBtn = document.createElement('button');
        applyBtn.className = 'symbol-selector-btn symbol-selector-btn-apply';
        applyBtn.textContent = 'Aplicar';
        this._applyBtn = applyBtn;

        actions.appendChild(cancelBtn);
        actions.appendChild(applyBtn);
        content.appendChild(actions);

        return content;
    }

    /**
     * Creates the SIDC input section.
     * @private
     * @returns {HTMLElement}
     */
    _createSidcInput() {
        const sidcContainer = document.createElement('div');
        sidcContainer.className = 'symbol-selector-sidc';

        const sidcInputLabel = document.createElement('label');
        sidcInputLabel.className = 'symbol-selector-sidc-label';
        sidcInputLabel.textContent = 'SIDC:';

        this._sidcInput = document.createElement('input');
        this._sidcInput.type = 'text';
        this._sidcInput.className = 'symbol-selector-sidc-input';
        this._sidcInput.placeholder = '30 dígitos (ex: 10031000161211000000 0760000000)';
        this._sidcInput.value = normalizeSIDC(
            this._tempProperties.sidc ||
            this._militarySymbolControl.symbolGenerator.buildSIDC(this._tempProperties)
        );

        this._sidcStatusMessage = document.createElement('div');
        this._sidcStatusMessage.className = 'symbol-selector-sidc-status';

        sidcContainer.appendChild(sidcInputLabel);
        sidcContainer.appendChild(this._sidcInput);
        sidcContainer.appendChild(this._sidcStatusMessage);

        return sidcContainer;
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupListeners() {
        addDomListener(this, this._tabButtons.simbolo, 'click', () => {
            switchTab('simbolo', this._tabButtons);
        });

        addDomListener(this, this._tabButtons.texto, 'click', () => {
            switchTab('texto', this._tabButtons);
        });

        addDomListener(this, this._tabButtons.engajamento, 'click', () => {
            switchTab('engajamento', this._tabButtons);
        });

        addDomListener(this, this._sidcInput, 'input', (e) => this._handleSidcInput(e));
        addDomListener(this, this._sidcInput, 'paste', () => this._handleSidcPaste());

        addDomListener(this, this._cancelBtn, 'click', () => this.hide());
        addDomListener(this, this._applyBtn, 'click', () => this._handleApply());
    }

    /**
     * Initializes async parts of the modal.
     * @private
     */
    async _initializeAsync() {
        try {
            const onSymbolClick = (sidc) => {
                this._updateComboboxesFromSIDC(sidc);
                this._clearTextModifiers();
                this._engagementBarContainer?.updateFromProperties?.(this._tempProperties);
                this._updatePreview();
            };

            const galleryColumn = await createSymbolGallery(this._militarySymbolControl, onSymbolClick);
            galleryColumn.className = 'symbol-selector-gallery';
            this._galleryColumn.replaceWith(galleryColumn);
            this._galleryColumn = galleryColumn;
        } catch (error) {
            console.error('Error initializing gallery:', error);
        }

        this._updatePreview();
    }

    /**
     * Clears text modifier properties.
     * @private
     */
    _clearTextModifiers() {
        for (const key of TEXT_MODIFIER_KEYS) {
            this._tempProperties[key] = '';
        }
        this._tempProperties.engagementBar = null;
    }

    /**
     * Handles SIDC input changes.
     * @private
     * @param {Event} e - Input event
     */
    _handleSidcInput(e) {
        let cleanSIDC = e.target.value.replace(/\s/g, '').trim();

        if (cleanSIDC.length > 30) {
            cleanSIDC = cleanSIDC.substring(0, 30);
        }

        if (e.target.value !== cleanSIDC) {
            e.target.value = cleanSIDC;
        }

        this._sidcInput.classList.remove('warning', 'success', 'error');
        this._sidcStatusMessage.textContent = '';
        this._sidcStatusMessage.className = 'symbol-selector-sidc-status';

        if (cleanSIDC.length === 20) {
            const normalized = normalizeSIDC(cleanSIDC);
            this._sidcInput.value = normalized;
            this._updateComboboxesFromSIDC(normalized);
            this._updatePreview();
        } else if (cleanSIDC.length === 30) {
            this._updateComboboxesFromSIDC(cleanSIDC);
            this._updatePreview();
        } else if (cleanSIDC.length > 0 && cleanSIDC.length < 20) {
            this._sidcInput.classList.add('warning');
            this._sidcStatusMessage.classList.add('warning');
            this._sidcStatusMessage.textContent = `\u26A0\uFE0F ${cleanSIDC.length}/20 dígitos (mínimo)`;
        } else if (cleanSIDC.length > 20 && cleanSIDC.length < 30) {
            this._sidcInput.classList.add('warning');
            this._sidcStatusMessage.classList.add('warning');
            this._sidcStatusMessage.textContent = `\u26A0\uFE0F ${cleanSIDC.length}/30 dígitos`;
        }
    }

    /**
     * Handles SIDC paste event.
     * @private
     */
    _handleSidcPaste() {
        setTimeout(() => {
            let cleanSIDC = this._sidcInput.value.replace(/\s/g, '').trim();

            if (cleanSIDC.length > 30) {
                cleanSIDC = cleanSIDC.substring(0, 30);
            }

            this._sidcInput.value = cleanSIDC;

            if (cleanSIDC.length === 20) {
                const normalized = normalizeSIDC(cleanSIDC);
                this._sidcInput.value = normalized;
                this._updateComboboxesFromSIDC(normalized);
                this._updatePreview();
            } else if (cleanSIDC.length === 30) {
                this._updateComboboxesFromSIDC(cleanSIDC);
                this._updatePreview();
            }
        }, 10);
    }

    /**
     * Updates comboboxes from SIDC input.
     * @private
     * @param {string} sidc - SIDC code
     */
    _updateComboboxesFromSIDC(sidc) {
        try {
            this._formColumns.setUpdatingFromSIDC(true);

            let normalizedSIDC = sidc;
            if (sidc.length === 20) {
                normalizedSIDC = normalizeSIDC(sidc);
                this._sidcInput.value = normalizedSIDC;
            }

            const parseResult = this._militarySymbolControl.symbolGenerator.canParseSIDC(normalizedSIDC);
            if (!parseResult.canParse) {
                throw new Error(parseResult.error);
            }

            const parsed = parseResult.properties;
            const dimensionChanged = this._tempProperties.symbolSet !== parsed.symbolSet;

            this._tempProperties.standardIdentity = parsed.standardIdentity;
            this._tempProperties.symbolSet = parsed.symbolSet;
            this._tempProperties.status = parsed.status;
            this._tempProperties.hqTfDummy = parsed.hqTfDummy;
            this._tempProperties.echelon = parsed.echelon;
            this._tempProperties.mainIcon = parsed.mainIcon;
            this._tempProperties.modifier1 = parsed.modifier1;
            this._tempProperties.modifier2 = parsed.modifier2;
            this._tempProperties.specialModifier = parsed.specialModifier || "0";
            this._tempProperties.isCommand = parsed.isCommand || false;

            this._tempProperties.mainIconExtension = parsed.mainIconExtension || 0;
            this._tempProperties.modifier1Extension = parsed.modifier1Extension || 0;
            this._tempProperties.modifier2Extension = parsed.modifier2Extension || 0;

            this._tempProperties.sidc = normalizedSIDC;

            if (dimensionChanged) {
                this._wrappedReloadDependentComboboxes(parsed.symbolSet);
            }

            this._formColumns.updateAllComboboxValues();

            const extension = BrazilianSIDCExtension.decode(normalizedSIDC.substring(20));
            const sidc20 = normalizedSIDC.substring(0, 20);
            const warnings = checkCatalogWarnings(extension, this._tempProperties.symbolSet, sidc20);

            this._sidcInput.classList.remove('warning', 'success', 'error');
            this._sidcStatusMessage.className = 'symbol-selector-sidc-status';

            if (warnings.length > 0) {
                this._sidcInput.classList.add('warning');
                this._sidcStatusMessage.classList.add('warning');
                this._sidcStatusMessage.textContent = '\u26A0\uFE0F ' + warnings[0];
                console.warn('Uncataloged extensions:', warnings);
            } else {
                this._sidcInput.classList.add('success');
                this._sidcStatusMessage.classList.add('success');
                this._sidcStatusMessage.textContent = '\u2713 SIDC válido';
            }

        } catch (error) {
            this._sidcInput.classList.remove('warning', 'success');
            this._sidcInput.classList.add('error');
            this._sidcStatusMessage.className = 'symbol-selector-sidc-status error';
            this._sidcStatusMessage.textContent = '\u2717 ' + error.message;
            console.warn('Invalid SIDC for parsing:', error.message);
        } finally {
            this._formColumns.setUpdatingFromSIDC(false);
        }
    }

    /**
     * Extended reload function that also updates text and engagement tabs.
     * @private
     * @param {string} symbolSetCode - Symbol set code
     */
    _wrappedReloadDependentComboboxes(symbolSetCode) {
        this._formColumns.reloadDependentComboboxes(symbolSetCode);

        this._clearTextModifiers();

        this._textoTab.replaceChildren();
        this._textFieldsContainer = createTextFieldsContainer(
            symbolSetCode,
            this._tempProperties,
            () => this._updatePreviewFromComboboxes()
        );
        this._textoTab.appendChild(this._textFieldsContainer);

        this._tempProperties.engagementBar = null;
        this._engajamentoTab.replaceChildren();
        this._engagementBarContainer = createEngagementBarContent(
            this._tempProperties,
            () => this._updatePreviewFromComboboxes()
        );
        this._engajamentoTab.appendChild(this._engagementBarContainer);
        this._updateEngagementBarVisibility();
    }

    /**
     * Updates engagement bar visibility based on symbol set.
     * @private
     */
    _updateEngagementBarVisibility() {
        const isApplicable = isEngagementBarApplicable(this._tempProperties.symbolSet || "10");
        this._tabButtons.engajamento.style.display = isApplicable ? '' : 'none';
        if (!isApplicable && this._engajamentoTab.style.display === 'block') {
            switchTab('simbolo', this._tabButtons);
        }
    }

    /**
     * Updates preview from combobox changes.
     * @private
     */
    _updatePreviewFromComboboxes() {
        const sidc = this._militarySymbolControl.symbolGenerator.buildSIDC(this._tempProperties);
        this._tempProperties.sidc = sidc;
        this._sidcInput.value = sidc;
        this._updatePreview();
    }

    /**
     * Updates the preview image.
     * @private
     */
    async _updatePreview() {
        try {
            const sidc = this._tempProperties.sidc;
            const validation = this._militarySymbolControl.symbolGenerator.validateSIDC(sidc);

            if (!validation.valid) {
                this._previewImage.style.display = 'none';
                return;
            }

            const previewDataURL = await generatePreviewWithTextModifiers(
                this._militarySymbolControl,
                this._tempProperties
            );

            if (previewDataURL) {
                this._previewImage.src = previewDataURL;
                this._previewImage.style.display = 'block';
            } else {
                this._previewImage.style.display = 'none';
                console.warn('Failed to generate preview for SIDC:', sidc);
            }

        } catch (error) {
            console.error('Error generating preview:', error);
            this._previewImage.style.display = 'none';
        }
    }

    /**
     * Handles apply button click.
     * @private
     */
    async _handleApply() {
        const data = await this._militarySymbolControl.map.getSource("military_symbols").getData();
        let needsRegeneration = false;

        for (const feat of this._selectedFeatures) {
            const sourceFeature = data.features.find(
                (f) => f.properties.id === feat.properties.id
            );

            if (sourceFeature) {
                for (const key of PROPERTIES_TO_UPDATE) {
                    if (Object.prototype.hasOwnProperty.call(this._tempProperties, key)) {
                        sourceFeature.properties[key] = this._tempProperties[key];
                        feat.properties[key] = this._tempProperties[key];

                        if (this._militarySymbolControl.geometry.affectsSIDC(key) ||
                            this._militarySymbolControl.geometry.affectsTextModifiers(key) ||
                            key === 'fillColor') {
                            needsRegeneration = true;
                        }
                    }
                }

                if (needsRegeneration) {
                    const newSIDC30 = this._militarySymbolControl.symbolGenerator.buildSIDC(sourceFeature.properties);
                    sourceFeature.properties.sidc = newSIDC30;
                    feat.properties.sidc = newSIDC30;
                }
            }
        }

        this._militarySymbolControl.map.getSource("military_symbols").setData(data);

        if (needsRegeneration && this._selectedFeatures.length > 0) {
            const updatedData = await this._militarySymbolControl.map.getSource("military_symbols").getData();
            const updatedFeature = updatedData.features.find(
                f => f.properties.id === this._selectedFeatures[0].properties.id
            );

            if (updatedFeature) {
                await this._militarySymbolControl.updateSymbolImage(updatedFeature);
                this._militarySymbolControl.updateSelectionManagerFeature(updatedFeature);
            }
        }

        await this._militarySymbolControl.saveFeatures(this._selectedFeatures, this._initialPropertiesMap);
        this.hide();
        this._selectionManager.deselectAllFeatures();
    }

    /**
     * Hides the modal.
     * @override
     */
    hide() {
        if (this._formColumns) {
            const { column1, column2 } = this._formColumns;
            for (const col of [column1, column2]) {
                for (const child of Array.from(col.children)) {
                    child._cleanup?.();
                }
            }
        }

        super.hide();
    }
}

/**
 * Opens the symbol configuration modal.
 *
 * Awaits the symbol-set tables first: they are the only piece of the modal that
 * is not already in memory (they load on demand, see `symbol_sets.registry.js`),
 * and `render()` builds every combobox in one synchronous pass.
 *
 * @param {SymbolModalConfig} config - Modal configuration
 * @returns {Promise<SymbolSelectorModal>} Modal instance
 */
export async function openSymbolModal(config) {
    await loadSymbolSets();

    const modal = new SymbolSelectorModal(config);
    modal.render();
    modal.show();
    return modal;
}

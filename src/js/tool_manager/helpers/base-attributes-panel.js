// Path: js/tool_manager/helpers/base-attributes-panel.js

/**
 * @fileoverview Base utilities for attribute panel creation.
 * Provides shared functions for panel headers, initial properties tracking,
 * and common panel patterns used across all tool attribute panels.
 *
 * @module tool_manager/helpers/base-attributes-panel
 */

import {
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from './feature-header.helpers.js';
import { createModernButtons } from './buttons.helpers.js';

// ============================================================================
// FEATURE TYPE DISPLAY NAMES
// ============================================================================

/**
 * Display names for feature types (Portuguese).
 * Used for multi-select headers.
 * @type {Object<string, {singular: string, plural: string}>}
 */
const FEATURE_TYPE_NAMES = {
    point: { singular: 'ponto', plural: 'pontos' },
    line: { singular: 'linha', plural: 'linhas' },
    polygon: { singular: 'polígono', plural: 'polígonos' },
    rectangle: { singular: 'retângulo', plural: 'retângulos' },
    circle: { singular: 'círculo', plural: 'círculos' },
    ellipse: { singular: 'elipse', plural: 'elipses' },
    text: { singular: 'texto', plural: 'textos' },
    image: { singular: 'imagem', plural: 'imagens' },
    brush: { singular: 'traço', plural: 'traços' },
    arrow: { singular: 'seta', plural: 'setas' },
    boundary: { singular: 'limite', plural: 'limites' },
    occupied_front: { singular: 'frente ocupada', plural: 'frentes ocupadas' },
    military_symbol: { singular: 'símbolo militar', plural: 'símbolos militares' },
    coordination_measure: { singular: 'medida de coordenação', plural: 'medidas de coordenação' },
    los: { singular: 'linha de visada', plural: 'linhas de visada' },
    visibility: { singular: 'análise de visibilidade', plural: 'análises de visibilidade' },
    azimuth_distance: { singular: 'azimute e distância', plural: 'azimutes e distâncias' }
};

// ============================================================================
// INITIAL PROPERTIES TRACKING
// ============================================================================

/**
 * Create a map of initial properties for change tracking.
 * Used to detect modifications and enable save/discard functionality.
 *
 * @param {Array<Object>} features - Array of features to track
 * @returns {Map<string, Object>} Map of feature ID to cloned properties
 *
 * @example
 * const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);
 * // Later: check if feature.properties differs from initialPropertiesMap.get(feature.properties.id)
 */
export function createInitialPropertiesMap(features) {
    return new Map(
        features.map(f => [f.properties.id, { ...f.properties }])
    );
}

// ============================================================================
// PANEL HEADER CREATION
// ============================================================================

/**
 * Create and append a panel header for single or multi-select scenarios.
 *
 * @param {Object} options - Header options
 * @param {HTMLElement} options.panel - Panel container to append header to
 * @param {Array<Object>} options.features - Selected features
 * @param {string} options.featureType - Feature type key (e.g., 'point', 'line')
 * @param {Object} options.control - Tool control instance
 * @param {Object} options.selectionManager - Selection manager instance
 * @param {Object} options.uiManager - UI manager instance
 * @param {boolean} [options.hideHeader=false] - Whether to skip header creation
 * @returns {void}
 *
 * @example
 * createPanelHeader({
 *     panel,
 *     features: selectedFeatures,
 *     featureType: 'point',
 *     control: pointControl,
 *     selectionManager,
 *     uiManager
 * });
 */
export function createPanelHeader({
    panel,
    features,
    featureType,
    control,
    selectionManager,
    uiManager,
    hideHeader = false
}) {
    if (hideHeader || features.length === 0) {
        return;
    }

    if (features.length === 1) {
        // Single feature: editable name header
        const feature = features[0];
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                control.updateFeaturesProperty(features, 'nome', newName);
                uiManager.updateSelectionHighlight();
            },
            features,
            selectionManager,
            uiManager
        );
        panel.appendChild(headerComponent);
    } else {
        // Multiple features: count header with options
        const multiSelectHeader = document.createElement('div');
        multiSelectHeader.className = 'feature-header-with-options';

        const infoText = document.createElement('div');
        infoText.className = 'feature-name-wrapper';


        // Get display name for feature type
        const typeNames = FEATURE_TYPE_NAMES[featureType] || { plural: 'itens' };
        infoText.textContent = `${features.length} ${typeNames.plural} selecionados`;

        const optionsButton = createFeatureOptionsButton(
            features,
            selectionManager,
            uiManager
        );

        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        panel.appendChild(multiSelectHeader);
    }
}

// ============================================================================
// ACTION BUTTONS
// ============================================================================

/**
 * Create and append action buttons (Save, Discard, Delete, Set Default).
 *
 * @param {Object} options - Button options
 * @param {HTMLElement} options.panel - Panel container to append buttons to
 * @param {Array<Object>} options.features - Selected features
 * @param {Object} options.control - Tool control instance
 * @param {Object} options.selectionManager - Selection manager instance
 * @param {Map<string, Object>} options.initialPropertiesMap - Initial properties for change detection
 * @param {boolean} [options.hideButtons=false] - Whether to hide buttons
 * @returns {void}
 *
 * @example
 * createActionButtons({
 *     panel,
 *     features: selectedFeatures,
 *     control: pointControl,
 *     selectionManager,
 *     initialPropertiesMap
 * });
 */
export function createActionButtons({
    panel,
    features,
    control,
    selectionManager,
    initialPropertiesMap,
    hideButtons = false
}) {
    if (hideButtons) {
        return;
    }

    const feature = features[0];

    panel.appendChild(createModernButtons({
        selectedFeatures: features,
        control,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: features.length === 1,
        onSetDefault: () => control.setDefaultProperties(feature.properties),
        hidden: hideButtons
    }));
}

// ============================================================================
// ATTRIBUTE PANEL BUILDER
// ============================================================================

/**
 * Builder class for creating attribute panels with consistent structure.
 * Provides a fluent API for common panel patterns.
 *
 * @example
 * new AttributePanelBuilder(panel, selectedFeatures, control, selectionManager, uiManager)
 *     .setFeatureType('point')
 *     .addHeader()
 *     .addColorPicker('fillColor', 'Cor')
 *     .addSizeSlider('size', 'Tamanho', { min: 6, max: 20 })
 *     .addOpacitySlider('opacity', 'Opacidade')
 *     .addActionButtons()
 *     .build();
 */
export class AttributePanelBuilder {
    /**
     * @param {HTMLElement} panel - Panel container
     * @param {Array<Object>} features - Selected features
     * @param {Object} control - Tool control instance
     * @param {Object} selectionManager - Selection manager instance
     * @param {Object} uiManager - UI manager instance
     */
    constructor(panel, features, control, selectionManager, uiManager) {
        this.panel = panel;
        this.features = features;
        this.control = control;
        this.selectionManager = selectionManager;
        this.uiManager = uiManager;
        this.featureType = null;
        this.hideHeader = false;
        this.hideButtons = false;
        this.initialPropertiesMap = createInitialPropertiesMap(features);
    }

    /**
     * Set the feature type for display names.
     * @param {string} featureType - Feature type key
     * @returns {AttributePanelBuilder}
     */
    setFeatureType(featureType) {
        this.featureType = featureType;
        return this;
    }

    /**
     * Configure header visibility.
     * @param {boolean} hide - Whether to hide the header
     * @returns {AttributePanelBuilder}
     */
    setHideHeader(hide) {
        this.hideHeader = hide;
        return this;
    }

    /**
     * Configure buttons visibility.
     * @param {boolean} hide - Whether to hide the buttons
     * @returns {AttributePanelBuilder}
     */
    setHideButtons(hide) {
        this.hideButtons = hide;
        return this;
    }

    /**
     * Add the panel header.
     * @returns {AttributePanelBuilder}
     */
    addHeader() {
        createPanelHeader({
            panel: this.panel,
            features: this.features,
            featureType: this.featureType,
            control: this.control,
            selectionManager: this.selectionManager,
            uiManager: this.uiManager,
            hideHeader: this.hideHeader
        });
        return this;
    }

    /**
     * Add action buttons at the end.
     * @returns {AttributePanelBuilder}
     */
    addActionButtons() {
        createActionButtons({
            panel: this.panel,
            features: this.features,
            control: this.control,
            selectionManager: this.selectionManager,
            initialPropertiesMap: this.initialPropertiesMap,
            hideButtons: this.hideButtons
        });
        return this;
    }

    /**
     * Get the initial properties map for external use.
     * @returns {Map<string, Object>}
     */
    getInitialPropertiesMap() {
        return this.initialPropertiesMap;
    }

    /**
     * Get the first feature for convenience.
     * @returns {Object|null}
     */
    getFirstFeature() {
        return this.features.length > 0 ? this.features[0] : null;
    }

    /**
     * Finalize the builder (no-op, for fluent API consistency).
     * @returns {AttributePanelBuilder}
     */
    build() {
        return this;
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get display name for a feature type.
 *
 * @param {string} featureType - Feature type key
 * @param {boolean} [plural=false] - Whether to return plural form
 * @returns {string} Display name
 */
export function getFeatureTypeDisplayName(featureType, plural = false) {
    const names = FEATURE_TYPE_NAMES[featureType];
    if (!names) {
        return plural ? 'itens' : 'item';
    }
    return plural ? names.plural : names.singular;
}

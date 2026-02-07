// Path: js/tool_manager/ui_manager.js

/**
 * @fileoverview UI manager facade coordinating selection, panels, and profiles.
 * Delegates to specialized managers for specific functionality.
 *
 * Refactored to use composition pattern with specialized managers:
 * - SelectionHighlightManager: Selection box rendering and caching
 * - ProfilePanelManager: Terrain profile charts with Chart.js
 *
 * @module tool_manager/ui_manager
 */

import { SelectionHighlightManager, ProfilePanelManager } from './managers';
import { cleanupFeatureDropdownListeners } from './helpers';
import { getStateManager, getEventBus } from '../store';
import { injectTabbedPanelStyles } from './tabbed_attribute_panel.js';
import { EventTypes } from '../events/event_types.js';
import { pixelsToDegrees } from '../utilities/geometry-utils.js';

// ============================================================================
// UI MANAGER CLASS
// ============================================================================

class UIManager {
    /**
     * @param {maplibregl.Map} map - MapLibre map instance
     * @param {Object} selectionManager - Selection manager instance
     * @param {Object} toolManager - Tool manager instance
     */
    constructor(map, selectionManager, toolManager) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.toolManager = toolManager;

        // Specialized managers (composition pattern)
        this._selectionHighlight = new SelectionHighlightManager(map, selectionManager);
        this._profilePanel = new ProfilePanelManager(selectionManager);

        // External control references
        this.featureSearchControl = null;
        this.mouseCoordinatesControl = null;

        /** @type {Array<Function>} Cleanup functions for subscriptions */
        this._unsubscribers = [];

        this._initSubscriptions();
        injectTabbedPanelStyles();
    }

    // ========================================================================
    // STATIC PROPERTIES (for backward compatibility)
    // ========================================================================

    /**
     * Slope threshold for cavalry mobility alerts.
     * @type {number}
     */
    static get SLOPE_THRESHOLD() {
        return ProfilePanelManager.SLOPE_THRESHOLD;
    }

    // ========================================================================
    // STATE MANAGER INTEGRATION
    // ========================================================================

    /**
     * Initialize StateManager subscriptions.
     * @private
     */
    _initSubscriptions() {
        try {
            const stateManager = getStateManager();

            // Subscribe to selection changes for selection box updates only.
            // Panel updates are handled explicitly by SelectionManager.updateUI()
            // to avoid unnecessary panel recreation during property edits.
            this._unsubscribers.push(
                stateManager.subscribe('selection.features', () => {
                    this.updateSelectionHighlight();
                })
            );
        } catch (_e) {
            // StateManager not available yet - will work without subscriptions
        }
    }

    /**
     * Get dragging state from StateManager.
     * @returns {boolean}
     */
    get isDragging() {
        try {
            return getStateManager().get('ui.isDragging') || false;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Set dragging state in StateManager.
     * @param {boolean} isDragging
     */
    setDragging(isDragging) {
        try {
            getStateManager().set('ui.isDragging', isDragging);
        } catch (_e) {
            // StateManager not available
        }
    }

    // ========================================================================
    // DELEGATION TO SELECTION HIGHLIGHT MANAGER
    // ========================================================================

    /**
     * Update selection highlight (selection boxes).
     */
    updateSelectionHighlight = () => {
        this._selectionHighlight.updateSelectionHighlight();
    }

    /**
     * Shift selection boxes during drag.
     * @param {number} dx - Delta longitude
     * @param {number} dy - Delta latitude
     * @param {boolean} [save=false] - Whether to persist
     */
    shiftSelectionBoxes(dx, dy, save = false) {
        this._selectionHighlight.shiftSelectionBoxes(dx, dy, save);
    }

    /**
     * Invalidate cache for specific feature.
     * @param {string} featureId
     */
    invalidateCache(featureId) {
        this._selectionHighlight.invalidateCache(featureId);
    }

    /**
     * Invalidate entire selection box cache.
     */
    invalidateAllCache() {
        this._selectionHighlight.invalidateAllCache();
    }

    /**
     * Notify geometry change for cache invalidation.
     * @param {string} featureId
     */
    notifyGeometryChange(featureId) {
        this._selectionHighlight.notifyGeometryChange(featureId);
    }

    /**
     * Expand bounding box with padding in pixels.
     * @param {Array<number>} bbox
     * @param {number} paddingPixels
     * @returns {Array<number>}
     */
    expandBboxWithPadding(bbox, paddingPixels) {
        return this._selectionHighlight.expandBboxWithPadding(bbox, paddingPixels);
    }

    /**
     * Calculate expanded dimensions after rotation.
     * @param {number} originalWidth
     * @param {number} originalHeight
     * @param {number} rotationDegrees
     * @returns {{width: number, height: number}}
     */
    calculateExpandedDimensions(originalWidth, originalHeight, rotationDegrees) {
        return this._selectionHighlight.calculateExpandedDimensions(originalWidth, originalHeight, rotationDegrees);
    }

    /**
     * Create selection box polygon.
     * @param {Array<number>} coordinates
     * @param {number} width
     * @param {number} height
     * @param {number} rotation
     * @returns {Object}
     */
    createSelectionBox(coordinates, width, height, rotation) {
        return this._selectionHighlight.createSelectionBox(coordinates, width, height, rotation);
    }

    /**
     * Calculate buffer around feature.
     * @param {Object} feature
     * @param {number} bufferSize
     * @returns {Object}
     */
    calculateBuffer(feature, bufferSize) {
        return this._selectionHighlight.calculateBuffer(feature, bufferSize);
    }

    /**
     * Get current selection boxes.
     * @returns {Array<Object>}
     */
    get selectionBoxes() {
        return this._selectionHighlight.selectionBoxes;
    }

    /**
     * Convert pixels to degrees at a given latitude and zoom level.
     * Used for calculating geographic dimensions from pixel measurements.
     * @param {number} pixels - Pixel measurement to convert
     * @param {number} latitude - Latitude where conversion is calculated
     * @param {number} zoom - Map zoom level
     * @returns {number} Equivalent measurement in degrees
     */
    pixelsToDegrees(pixels, latitude, zoom) {
        return pixelsToDegrees(pixels, latitude, zoom);
    }

    // ========================================================================
    // DELEGATION TO PROFILE PANEL MANAGER
    // ========================================================================

    /**
     * Show profile panel for selected features.
     * @param {Array<Object>} selectedFeatures
     */
    showProfilePanel(selectedFeatures) {
        this._profilePanel.showProfilePanel(selectedFeatures);
    }

    /**
     * Hide profile panel.
     */
    hideProfilePanel() {
        this._profilePanel.hideProfilePanel();
    }

    /**
     * Create profile panel with chart.
     * @param {string} profileData
     * @param {boolean} [linkFirstLast=false]
     * @param {Object} [feature=null]
     */
    createProfilePanel(profileData, linkFirstLast = false, feature = null) {
        this._profilePanel.createProfilePanel(profileData, linkFirstLast, feature);
    }

    // ========================================================================
    // SETTERS
    // ========================================================================

    /**
     * Set feature search control reference.
     * @param {Object} control
     */
    setFeatureSearchControl(control) {
        this.featureSearchControl = control;
    }

    /**
     * Set mouse coordinates control reference.
     * @param {Object} control
     */
    setMouseCoordinatesControl(control) {
        this.mouseCoordinatesControl = control;
    }

    // ========================================================================
    // PANEL COORDINATION
    // ========================================================================

    /**
     * Update attribute and profile panels based on selection.
     * Delegates to sidebar feature panel via StateManager.
     */
    updatePanels = () => {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (allSelectedFeatures.length > 0) {
            this.removeExistingPanel();
            this.showProfilePanel(allSelectedFeatures);
            this._notifyFeaturePanelOpened(allSelectedFeatures[0]);
        } else {
            this.saveChangesAndClosePanel();
        }
    }

    /**
     * Update only the profile panel.
     */
    updateProfile = () => {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (allSelectedFeatures.length > 0) {
            this.showProfilePanel(allSelectedFeatures);
        } else {
            this.saveChangesAndClosePanel();
        }
    }

    /**
     * Remove existing legacy floating panel and cleanup resources.
     */
    removeExistingPanel() {
        const existingPanel = document.querySelector('.unified-attributes-panel');
        if (existingPanel) {
            if (existingPanel._tabbedPanelCleanup) {
                existingPanel._tabbedPanelCleanup();
            }
            if (existingPanel._userDataCleanup) {
                existingPanel._userDataCleanup();
            }
            cleanupFeatureDropdownListeners(existingPanel);
            existingPanel.remove();
        }
    }

    /**
     * Add delete button to panel.
     * @param {HTMLElement} panel
     */
    addDeleteButton(panel) {
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('delete-button', 'pure-material-button-contained');
        deleteButton.textContent = 'Deletar';
        deleteButton.onclick = async () => this.selectionManager.deleteSelectedFeatures();
        panel.appendChild(deleteButton);
    }

    /**
     * Save changes and close all panels.
     */
    saveChangesAndClosePanel = () => {
        this.hideFeatureSearchPanel();
        this.hideProfilePanel();

        // Handle legacy floating panel if it exists
        const panel = document.querySelector('.unified-attributes-panel');
        if (panel) {
            const saveButton = panel.querySelector('button[type="submit"]');
            if (saveButton) {
                saveButton.click();
            }
            panel.remove();
            cleanupFeatureDropdownListeners();
        }

        // Handle sidebar feature panel - save before closing.
        // Use _saveOnly to avoid triggering deselectAllFeatures() from the button handler
        // (we're already deselecting from the caller).
        const sidebarSaveButton = document.querySelector('.feature-panel .attr-modern-btn-save');
        if (sidebarSaveButton?._saveOnly) {
            sidebarSaveButton._saveOnly();
        } else if (sidebarSaveButton) {
            sidebarSaveButton.click();
        }

        // Always notify StateManager to close feature panel in sidebar
        this._notifyFeaturePanelClosed();
    }

    /**
     * Close all panels without saving.
     * Used when caller already saved and just needs UI cleanup.
     */
    closePanelWithoutSave = () => {
        this.hideFeatureSearchPanel();
        this.hideProfilePanel();

        // Remove legacy floating panel without saving
        const panel = document.querySelector('.unified-attributes-panel');
        if (panel) {
            panel.remove();
            cleanupFeatureDropdownListeners();
        }

        // Close feature panel in sidebar without saving
        this._notifyFeaturePanelClosed();
    }

    // ========================================================================
    // FEATURE SEARCH PANEL
    // ========================================================================

    /**
     * Show feature search result panel.
     * @param {Object} feature - Search result feature
     */
    showFeatureSearchPanel(feature) {
        const panel = document.createElement('div');
        panel.className = 'unified-attributes-panel feature-search-panel';

        const title = document.createElement('h3');
        title.textContent = 'Resultado da busca';
        panel.appendChild(title);

        const infoList = document.createElement('ul');
        const infoItems = [
            { label: 'Nome', value: feature.nome },
            { label: 'Latitude', value: feature.latitude },
            { label: 'Longitude', value: feature.longitude },
            { label: 'Classe', value: feature.tipo },
            { label: 'Município', value: feature.municipio },
            { label: 'Estado', value: feature.estado }
        ];

        infoItems.forEach(item => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `<strong>${item.label}:</strong> ${item.value}`;
            infoList.appendChild(listItem);
        });

        panel.appendChild(infoList);

        const closeButton = document.createElement('button');
        closeButton.textContent = 'Fechar';
        closeButton.onclick = () => this.hideFeatureSearchPanel();
        panel.appendChild(closeButton);

        document.body.appendChild(panel);
    }

    /**
     * Hide feature search panel.
     */
    hideFeatureSearchPanel() {
        const panel = document.querySelector('.feature-search-panel');
        if (panel) {
            panel.remove();
            this.featureSearchControl?.removeMarker();
        }
    }

    // ========================================================================
    // VECTOR TILE INFO PANEL
    // ========================================================================

    /**
     * Show vector tile info panel.
     * Emits event for sidebar to handle display.
     * @param {Object} feature
     */
    showVectorTileInfoPanel(feature) {
        this.saveChangesAndClosePanel();

        const sourceName = this._getVectorTileTitle(feature);

        try {
            const eventBus = getEventBus();
            eventBus.emit(EventTypes.VECTOR_INFO_PANEL_OPENED, {
                feature,
                title: sourceName
            });
        } catch (_e) {
            // Fallback to legacy floating panel if event bus not available
            const panel = document.createElement('div');
            panel.className = 'vector-tile-info-panel unified-attributes-panel';
            this.addVectorTileInfoToPanel(panel, feature);
            document.body.appendChild(panel);
        }
    }

    /**
     * Get display title for vector tile layer.
     * @private
     * @param {Object} feature
     * @returns {string}
     */
    _getVectorTileTitle(feature) {
        const originalLayerName = feature.sourceLayer;

        if (originalLayerName.startsWith('situacao')) {
            return originalLayerName
                .replace('situacao', 'produtos')
                .replace(/_(10|25|50|100|250)k/, ' (1:$1.000)');
        }

        return originalLayerName
            .replace(/_10k|_25k|_50k|_100k|_250k/g, '')
            .replace('edgv_', '');
    }

    /**
     * Add vector tile info content to panel.
     * @param {HTMLElement} panel
     * @param {Object} feature
     */
    addVectorTileInfoToPanel(panel, feature) {
        const title = document.createElement('h3');
        title.textContent = `Atributos ${this._getVectorTileTitle(feature)}:`;
        panel.appendChild(title);

        const propertiesList = document.createElement('ul');
        const blacklist = ['fid', 'id', 'vector_type', 'tilequery', 'mapbox_clip_start', 'mapbox_clip_end', 'justificativa_txt_value', 'visivel_value', 'exibir_linha_rotulo_value', 'suprimir_bandeira_value', 'posicao_rotulo_value', 'direcao_fixada_value', 'exibir_ponta_simbologia_value', 'exibir_lado_simbologia_value', 'label_x', 'label_y', 'length_otf', 'texto_edicao', 'simb_rot', 'observacao'];
        const blacklistSuffixes = ['_code'];

        for (const [key, value] of Object.entries(feature.properties)) {
            if (blacklist.includes(key) || blacklistSuffixes.some(suffix => key.endsWith(suffix))) {
                continue;
            }

            let displayKey = key.endsWith('_value') ? key.slice(0, -6) : key;
            displayKey = displayKey.replace(/_/g, ' ');
            if (displayKey.startsWith('identificador')) {
                displayKey = displayKey.substring('identificador'.length);
            }

            let displayValue;
            if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
                const formattedString = value
                    .slice(1, -1)
                    .replace(/"/g, '')
                    .replace(/,/g, ', ');

                displayValue = formattedString || '-';
            } else {
                displayValue = value;
            }

            const listItem = document.createElement('li');
            listItem.innerHTML = `<strong>${displayKey}:</strong> ${displayValue}`;
            propertiesList.appendChild(listItem);
        }

        if (propertiesList.children.length > 0) {
            panel.appendChild(propertiesList);
        } else {
            const noPropertiesMsg = document.createElement('p');
            noPropertiesMsg.textContent = 'Feição sem atributos';
            panel.appendChild(noPropertiesMsg);
        }

        const closeButton = document.createElement('button');
        closeButton.textContent = 'Fechar';
        closeButton.onclick = () => {
            this.toolManager.deactivateCurrentTool();
            this.saveChangesAndClosePanel();
        };
        panel.appendChild(closeButton);
    }

    // ========================================================================
    // PRIVATE NOTIFICATIONS
    // ========================================================================

    /**
     * Notify StateManager that a feature panel should be opened.
     * @private
     * @param {Object} feature
     */
    _notifyFeaturePanelOpened(feature) {
        try {
            const stateManager = getStateManager();
            const featureId = feature?.properties?.id;
            const featureType = feature?.properties?.source;

            if (featureId && featureType) {
                stateManager.openFeaturePanel(featureId, featureType);
            }
        } catch (_e) {
            // StateManager not available - UI will work without layout coordination
        }
    }

    /**
     * Notify StateManager that a feature panel has been closed.
     * @private
     */
    _notifyFeaturePanelClosed() {
        try {
            getStateManager().closeFeaturePanel();
        } catch (_e) {
            // StateManager not available
        }
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    /**
     * Cleanup resources.
     * Call when component is destroyed.
     */
    destroy() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];

        this._selectionHighlight.destroy();
        this._profilePanel.destroy();
    }
}

export default UIManager;

// Path: js/tool_manager/selection_manager.js

/**
 * @fileoverview Selection manager for map features.
 * Delegates selection state to StateManager (single source of truth).
 * Handles click events, multi-select, group selection, and context menus.
 */

import {
    getFeatureGroup,
    getVisibleLayerIds,
    isFeatureEffectivelyLocked,
    getStateManager
} from '../store';
import { createTwoFingerTapHandler } from '../utilities/pointer-utils';

class SelectionManager {
    /**
     * @param {Object} map - MapLibre map instance
     */
    constructor(map) {
        this.map = map;
        this.uiManager = null;
        this.vectorTileInfoControl = null;
        this.rectangleSelectionControl = null;

        /** @type {Map<string, Object>} Tool controls registry */
        this.controls = new Map();

        // Context menu state (local, not in StateManager - ephemeral UI)
        this.contextMenu = null;
        this.pendingFeatures = null;
        this.pendingEvent = null;

        /** @type {Array<Function>} Cleanup functions for subscriptions */
        this._unsubscribers = [];

        /** @type {boolean} Flag to prevent re-entrancy in deselectAllFeatures */
        this._isDeselecting = false;

        /** @type {Function|null} Cleanup for two-finger tap handler */
        this._cleanupTwoFingerTap = null;

        /** @type {Function|null} Bound keydown handler for cleanup */
        this._handleKeydown = null;

        /** @type {Function|null} Bound movestart handler for cleanup */
        this._handleMoveStart = null;

        /** @type {Function|null} Bound zoomstart handler for cleanup */
        this._handleZoomStart = null;

        this._setupEventListeners();
    }

    // =========================================================================
    // SELECTION STATE (delegated to StateManager)
    // =========================================================================

    /**
     * Check if feature is selected.
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @returns {boolean}
     */
    isFeatureSelected(type, featureId) {
        try {
            return getStateManager().isFeatureSelected(type, String(featureId));
        } catch (_e) {
            // StateManager not initialized yet
            return false;
        }
    }

    /**
     * Get all selected features (GeoJSON objects only).
     * @returns {Array<Object>} Array of GeoJSON features
     */
    getAllSelectedFeatures() {
        try {
            return getStateManager().getSelectedFeatures().map(item => item.feature);
        } catch (_e) {
            return [];
        }
    }

    /**
     * Get selected features filtered by type.
     * @param {string} type - Feature type
     * @returns {Array<{type: string, id: string, feature: Object}>}
     */
    getSelectedFeaturesByType(type) {
        try {
            return getStateManager().getSelectedFeatures().filter(item => item.type === type);
        } catch (_e) {
            return [];
        }
    }

    /**
     * Get IDs of selected features by type.
     * @param {string} type - Feature type
     * @returns {Array<string>}
     */
    getSelectedFeatureIdsByType(type) {
        return this.getSelectedFeaturesByType(type).map(item => item.id);
    }

    /**
     * Get a specific selected feature.
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @returns {Object|null} GeoJSON feature or null
     */
    getSelectedFeature(type, featureId) {
        try {
            return getStateManager().getSelectedFeature(type, String(featureId));
        } catch (_e) {
            return null;
        }
    }

    /**
     * Check if any features are selected.
     * @returns {boolean}
     */
    hasSelectedFeatures() {
        try {
            return getStateManager().getSelectionCount() > 0;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Update a selected feature in place (after geometry/property changes).
     * Used by tool controls after drag or edit operations.
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @param {Object} feature - Updated GeoJSON feature
     */
    updateSelectedFeature(type, featureId, feature) {
        try {
            const stateManager = getStateManager();
            stateManager.updateSelectedFeature(type, String(featureId), feature);
        } catch (e) {
            console.warn('Could not update selected feature in StateManager:', e);
        }
    }

    // =========================================================================
    // SELECTION MUTATIONS
    // =========================================================================

    /**
     * Toggle feature selection state.
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @param {Object} feature - GeoJSON feature (may be incomplete from render)
     * @param {boolean} [forceDeselect=false] - If true, deselect even if not selected
     */
    async toggleFeatureSelection(type, featureId, feature, forceDeselect = false) {
        const featureIdStr = String(featureId);

        let stateManager;
        try {
            stateManager = getStateManager();
        } catch (_e) {
            console.warn('StateManager not available for selection');
            return;
        }

        const control = this.controls.get(type);
        const isSelected = stateManager.isFeatureSelected(type, featureIdStr);

        if (isSelected && forceDeselect) {
            // Deselect
            stateManager.removeFromSelection(type, featureIdStr);
            if (control?.onFeatureDeselected) {
                control.onFeatureDeselected(feature);
            }
        } else if (!isSelected) {
            // Select - get complete feature from source for full geometry
            const completeFeature = await this.getCompleteFeatureFromSource(type, featureId);
            const featureToStore = completeFeature || feature;

            stateManager.addToSelection(type, featureIdStr, featureToStore);

            if (control?.onFeatureSelected) {
                control.onFeatureSelected(featureToStore);
            }
        }
    }

    /**
     * Select a single feature (clears previous selection).
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @param {Object} [feature=null] - GeoJSON feature
     */
    async selectFeature(type, featureId, feature = null) {
        this.deselectAllFeatures();
        await this.toggleFeatureSelection(type, featureId, feature, false);
        this.updateUI();
    }

    /**
     * Deselect all features.
     * Saves any pending changes before deselecting.
     */
    deselectAllFeatures() {
        // Prevent re-entrancy (saveChangesAndClosePanel may trigger this again)
        if (this._isDeselecting) {
            return;
        }
        this._isDeselecting = true;

        try {
            // Save any pending changes before deselecting
            // This triggers the save button click if present in the feature panel
            this.uiManager?.saveChangesAndClosePanel();

            // Notify controls of global deselect
            this.controls.forEach((control) => {
                if (control.onGlobalDeselect) {
                    control.onGlobalDeselect();
                }
            });

            try {
                getStateManager().clearSelection();
            } catch (_e) {
                // StateManager not available
            }

            this.updateUI();
        } finally {
            this._isDeselecting = false;
        }
    }

    /**
     * Clear selections of a specific type only.
     * @param {string} type - Feature type to clear
     */
    clearSelectionsByType(type) {
        try {
            const stateManager = getStateManager();
            const features = stateManager.getSelectedFeatures();
            const toRemove = features.filter(f => f.type === type);

            stateManager.batchUpdate(() => {
                toRemove.forEach(f => stateManager.removeFromSelection(f.type, f.id));
            });
        } catch (_e) {
            // StateManager not available
        }
    }

    // =========================================================================
    // CONTROL REGISTRATION
    // =========================================================================

    /**
     * Register a tool control for selection handling.
     * @param {string} type - Tool type identifier
     * @param {Object} control - Tool control instance
     */
    registerControl(type, control) {
        this.controls.set(type, control);
    }

    /**
     * Set UI manager reference.
     * @param {Object} uiManager
     */
    setUIManager(uiManager) {
        this.uiManager = uiManager;
    }

    /**
     * Set vector tile info control reference.
     * @param {Object} vectorTileInfoControl
     */
    setvectorTileInfoControl(vectorTileInfoControl) {
        this.vectorTileInfoControl = vectorTileInfoControl;
    }

    /**
     * Set rectangle selection control reference.
     * @param {Object} rectangleSelectionControl
     */
    setRectangleSelectionControl(rectangleSelectionControl) {
        this.rectangleSelectionControl = rectangleSelectionControl;
    }

    // =========================================================================
    // EVENT HANDLING
    // =========================================================================

    /**
     * Setup map event listeners.
     * @private
     */
    _setupEventListeners() {
        this.map.on('click', this._handleMapClick);

        // Store bound handlers for cleanup
        this._handleKeydown = (e) => {
            if (e.key === 'Escape' && this.contextMenu) {
                this._hideFeatureSelectionMenu();
            }
        };
        document.addEventListener('keydown', this._handleKeydown);

        this._handleMoveStart = () => {
            if (this.contextMenu) this._hideFeatureSelectionMenu();
        };
        this.map.on('movestart', this._handleMoveStart);

        this._handleZoomStart = () => {
            if (this.contextMenu) this._hideFeatureSelectionMenu();
        };
        this.map.on('zoomstart', this._handleZoomStart);

        // Two-finger tap para multi-select em dispositivos touch
        this._setupTwoFingerTap();
    }

    /**
     * Setup two-finger tap for multi-select (equivalent to Shift+Click)
     * @private
     */
    _setupTwoFingerTap() {
        const canvas = this.map.getCanvasContainer();

        this._cleanupTwoFingerTap = createTwoFingerTapHandler(
            canvas,
            (e, midpoint) => {
                // Skip if special tools are active
                if (this.vectorTileInfoControl?.isActive) return;
                if (this.rectangleSelectionControl?.isActive) return;

                const activeTool = this.getActiveTool();
                if (activeTool) return;

                // Get canvas-relative coordinates
                const rect = canvas.getBoundingClientRect();
                const point = {
                    x: midpoint.x - rect.left,
                    y: midpoint.y - rect.top
                };

                // Query features at the midpoint
                const clickedFeatures = this.getAllClickedCustomFeatures([point.x, point.y]);

                if (clickedFeatures.length > 0) {
                    // Simulate shift+click event for multi-select
                    const fakeEvent = {
                        point,
                        lngLat: this.map.unproject([point.x, point.y]),
                        originalEvent: { shiftKey: true }
                    };

                    if (clickedFeatures.length === 1) {
                        this._handleFeatureClick(clickedFeatures[0], fakeEvent);
                    } else {
                        this._showFeatureSelectionMenu(clickedFeatures, fakeEvent);
                    }
                }
            },
            { maxDuration: 300, maxDistance: 20 }
        );
    }

    /**
     * Handle map click event.
     * @private
     */
    _handleMapClick = (e) => {
        // Skip if special tools are active
        if (this.vectorTileInfoControl?.isActive) return;
        if (this.rectangleSelectionControl?.isActive) return;

        // Skip if click is on viewer layers (3D Models, Street View)
        // These have their own click handlers and should not trigger feature selection
        const viewerLayers = [
            // 3D Models Viewer layers
            '3d-models-clusters', '3d-models-markers',
            // Street View PMTiles layers
            'street-view', 'street-view-lines',
            // Streetview Markers clustering layers
            'streetview-markers-clusters', 'streetview-markers-pins'
        ];

        const clickedLayers = this.map.queryRenderedFeatures(e.point)
            .map(f => f.layer?.id)
            .filter(Boolean);

        if (clickedLayers.some(layer => viewerLayers.includes(layer))) {
            return; // Let viewer handlers process the click
        }

        const activeTool = this.getActiveTool();
        if (activeTool) {
            activeTool.handleMapClick(e);
            return;
        }

        const clickedFeatures = this.getAllClickedCustomFeatures([e.point.x, e.point.y]);

        if (clickedFeatures.length > 0) {
            if (clickedFeatures.length === 1) {
                this._handleFeatureClick(clickedFeatures[0], e);
            } else {
                this._showFeatureSelectionMenu(clickedFeatures, e);
            }
        } else {
            this._hideFeatureSelectionMenu();
            if (!e.originalEvent.shiftKey && this.hasSelectedFeatures()) {
                this.uiManager?.saveChangesAndClosePanel();
                if (this.hasSelectedFeatures()) {
                    this.deselectAllFeatures();
                }
            }
        }
    }

    /**
     * Get all custom features at click point, filtered by visibility.
     * @param {Array<number>} point - [x, y] screen coordinates
     * @returns {Array<Object>} Clicked features with toolType added
     */
    getAllClickedCustomFeatures(point) {
        const features = this.map.queryRenderedFeatures(point);
        const clickedFeatures = [];
        const visibleLayerSet = new Set(getVisibleLayerIds());

        for (const [type, control] of this.controls) {
            const sourceNames = control.getSourceNames();
            for (const sourceName of sourceNames) {
                const matchingFeatures = features.filter(f =>
                    f.source === sourceName && f.properties.source === type
                );
                matchingFeatures.forEach(feature => {
                    if (isFeatureEffectivelyLocked(feature)) return;

                    const featureLayerId = feature.properties.layerId || 'default';
                    if (!visibleLayerSet.has(featureLayerId)) return;

                    clickedFeatures.push({ ...feature, toolType: type });
                });
            }
        }

        // Deduplicate by type:id
        const uniqueFeatures = [];
        const seenKeys = new Set();
        clickedFeatures.forEach(feature => {
            const key = `${feature.toolType}:${feature.properties.id}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueFeatures.push(feature);
            }
        });
        return uniqueFeatures;
    }

    /**
     * Get first clicked custom feature.
     * @param {Array<number>} point - [x, y] screen coordinates
     * @returns {Object|null}
     */
    getClickedCustomFeature(point) {
        const features = this.getAllClickedCustomFeatures(point);
        return features.length > 0 ? features[0] : null;
    }

    /**
     * Handle click on a specific feature.
     * @private
     */
    _handleFeatureClick = async (clickedFeature, e) => {
        if (isFeatureEffectivelyLocked(clickedFeature)) return;

        const type = clickedFeature.toolType;
        const featureId = clickedFeature.properties.id;
        const group = getFeatureGroup(type, featureId);

        if (group) {
            await this._handleGroupClick(group, clickedFeature, e);
        } else {
            await this._handleSingleFeatureClick(clickedFeature, e);
        }
    }

    /**
     * Handle click on grouped feature.
     * @private
     */
    _handleGroupClick = async (group, clickedFeature, e) => {
        const isShiftPressed = e.originalEvent.shiftKey;

        if (isShiftPressed) {
            const isGroupSelected = this._isGroupSelected(group);
            if (isGroupSelected) {
                await this._deselectGroup(group);
            } else {
                await this._selectGroup(group);
            }
        } else {
            this.deselectAllFeatures();
            await this._selectGroup(group);
        }

        this.updateUI();
    }

    /**
     * Handle click on individual (non-grouped) feature.
     * @private
     */
    _handleSingleFeatureClick = async (clickedFeature, e) => {
        const type = clickedFeature.toolType;
        const featureId = clickedFeature.properties.id;
        const isSelected = this.isFeatureSelected(type, featureId);

        if (isSelected && e.originalEvent.shiftKey) {
            // Shift+click on selected = deselect
            await this.toggleFeatureSelection(type, featureId, clickedFeature, true);
        } else if (!isSelected) {
            // Click on unselected
            if (!e.originalEvent.shiftKey) {
                this.deselectAllFeatures();
            }
            await this.toggleFeatureSelection(type, featureId, clickedFeature, false);
        }

        this.updateUI();
    }

    /**
     * Select all features in a group.
     * @private
     */
    _selectGroup = async (group) => {
        let stateManager;
        try {
            stateManager = getStateManager();
        } catch (_e) {
            return;
        }

        for (const featureRef of group.features) {
            const completeFeature = await this.getCompleteFeatureFromSource(featureRef.type, featureRef.id);
            if (completeFeature) {
                stateManager.addToSelection(featureRef.type, String(featureRef.id), completeFeature);
                const control = this.controls.get(featureRef.type);
                if (control?.onFeatureSelected) {
                    control.onFeatureSelected(completeFeature);
                }
            }
        }
    }

    /**
     * Deselect all features in a group.
     * @private
     */
    _deselectGroup = async (group) => {
        let stateManager;
        try {
            stateManager = getStateManager();
        } catch (_e) {
            return;
        }

        stateManager.batchUpdate(() => {
            for (const featureRef of group.features) {
                stateManager.removeFromSelection(featureRef.type, String(featureRef.id));
                const control = this.controls.get(featureRef.type);
                if (control?.onFeatureDeselected) {
                    control.onFeatureDeselected(null);
                }
            }
        });
    }

    /**
     * Check if all features in group are selected.
     * @private
     */
    _isGroupSelected(group) {
        return group.features.every(featureRef =>
            this.isFeatureSelected(featureRef.type, featureRef.id)
        );
    }

    // =========================================================================
    // CONTEXT MENU
    // =========================================================================

    /**
     * Show feature selection context menu.
     * @private
     */
    _showFeatureSelectionMenu(features, e) {
        this._hideFeatureSelectionMenu();

        const availableFeatures = features.filter(f => !isFeatureEffectivelyLocked(f));
        if (availableFeatures.length === 0) return;

        if (availableFeatures.length === 1) {
            this._handleFeatureClick(availableFeatures[0], e);
            return;
        }

        this.pendingFeatures = availableFeatures;
        this.pendingEvent = e;
        this.contextMenu = this._createContextMenuElement(availableFeatures, e);
        document.body.appendChild(this.contextMenu);
    }

    /**
     * Create context menu DOM element.
     * @private
     */
    _createContextMenuElement(features, e) {
        const menu = document.createElement('div');
        menu.className = 'feature-selection-menu';

        menu.style.cssText = `
            position: fixed !important;
            background: white !important;
            border: 1px solid #ccc !important;
            border-radius: 6px !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
            z-index: 999999 !important;
            min-width: 200px !important;
            max-height: 300px !important;
            overflow-y: auto !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            font-size: 14px !important;
            line-height: 1.4 !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            pointer-events: auto !important;
        `;

        const x = Math.min(e.originalEvent.clientX, window.innerWidth - 220);
        const y = Math.min(e.originalEvent.clientY, window.innerHeight - 50);
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        // Header
        const header = document.createElement('div');
        header.textContent = `Selecionar feição (${features.length})`;
        header.style.cssText = `
            padding: 8px 12px !important;
            background: #f5f5f5 !important;
            color: #666 !important;
            border-bottom: 1px solid #ddd !important;
            font-weight: bold !important;
            font-size: 12px !important;
            margin: 0 !important;
        `;
        menu.appendChild(header);

        // Feature items
        features.forEach((feature, index) => {
            const item = document.createElement('div');
            const featureName = this._getFeatureName(feature);
            item.textContent = featureName;
            item.style.cssText = `
                padding: 10px 12px !important;
                cursor: pointer !important;
                border-bottom: ${index < features.length - 1 ? '1px solid #eee' : 'none'} !important;
                transition: background-color 0.2s !important;
                background: white !important;
                color: black !important;
                font-size: 14px !important;
                margin: 0 !important;
            `;

            item.addEventListener('mouseenter', () => {
                item.style.backgroundColor = '#f0f8ff !important';
            });
            item.addEventListener('mouseleave', () => {
                item.style.backgroundColor = 'white !important';
            });

            item.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this._handleFeatureClick(feature, this.pendingEvent);
                this._hideFeatureSelectionMenu();
            });

            menu.appendChild(item);
        });

        // Separator
        const separator = document.createElement('div');
        separator.style.cssText = `
            height: 1px !important;
            background: #ddd !important;
            margin: 4px 0 !important;
        `;
        menu.appendChild(separator);

        // Select all option
        const selectAllItem = document.createElement('div');
        selectAllItem.textContent = 'Selecionar Todas';
        selectAllItem.style.cssText = `
            padding: 10px 12px !important;
            cursor: pointer !important;
            background: white !important;
            color: black !important;
            font-size: 14px !important;
            margin: 0 !important;
            transition: background-color 0.2s !important;
        `;

        selectAllItem.addEventListener('mouseenter', () => {
            selectAllItem.style.backgroundColor = '#f0f8ff !important';
        });
        selectAllItem.addEventListener('mouseleave', () => {
            selectAllItem.style.backgroundColor = 'white !important';
        });

        selectAllItem.addEventListener('click', (evt) => {
            evt.stopPropagation();
            this._selectAllPendingFeatures();
            this._hideFeatureSelectionMenu();
        });

        menu.appendChild(selectAllItem);

        return menu;
    }

    /**
     * Select all features from pending context menu.
     * @private
     */
    _selectAllPendingFeatures = async () => {
        if (!this.pendingFeatures || !this.pendingEvent) return;

        if (!this.pendingEvent.originalEvent.shiftKey) {
            this.deselectAllFeatures();
        }

        for (const feature of this.pendingFeatures) {
            const type = feature.toolType;
            const featureId = feature.properties.id;

            if (!this.isFeatureSelected(type, featureId)) {
                await this.toggleFeatureSelection(type, featureId, feature, false);
            }
        }

        this.updateUI();
    }

    /**
     * Get display name for feature.
     * @private
     */
    _getFeatureName(feature) {
        const nome = feature.properties.nome;
        if (nome && nome.trim()) {
            return nome;
        }
        return `ID: ${feature.properties.id}`;
    }

    /**
     * Hide context menu.
     * @private
     */
    _hideFeatureSelectionMenu() {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
            this.pendingFeatures = null;
            this.pendingEvent = null;
        }
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    /**
     * Check if click is on an edit handle.
     * @param {Array<number>} point - [x, y] screen coordinates
     * @returns {boolean}
     */
    isClickOnEditHandle(point) {
        const features = this.map.queryRenderedFeatures(point);

        for (const control of this.controls.values()) {
            const editHandleSource = control.getEditHandleSource();
            if (editHandleSource) {
                const hasHandle = features.some(f =>
                    f.source === editHandleSource && f.properties.user_isEditingHandle
                );
                if (hasHandle) return true;
            }
        }

        return false;
    }

    /**
     * Get complete feature from map source (with full geometry).
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @returns {Promise<Object|null>} Complete GeoJSON feature or null
     */
    async getCompleteFeatureFromSource(type, featureId) {
        const control = this.controls.get(type);
        if (!control) {
            console.warn(`Control not found for type: ${type}`);
            return null;
        }

        const sourceNames = control.getSourceNames();
        if (!sourceNames?.length) {
            console.warn(`Source names not found for type: ${type}`);
            return null;
        }

        const sourceName = sourceNames[0];
        const mapSource = this.map.getSource(sourceName);
        if (!mapSource) return null;

        const data = await mapSource.getData();
        if (!data) return null;

        return data.features.find(f => f.properties.id === featureId);
    }

    /**
     * Notify UI of geometry change (for cache invalidation).
     * @param {string} featureId
     */
    notifyGeometryChange(featureId) {
        this.uiManager?.notifyGeometryChange(featureId);
    }

    /**
     * Notify UI of multiple geometry changes.
     * @param {Array<string>} featureIds
     */
    notifyMultipleGeometryChanges(featureIds) {
        featureIds.forEach(id => this.notifyGeometryChange(id));
    }

    /**
     * Update UI after selection changes.
     */
    updateUI() {
        this.uiManager?.updateSelectionHighlight();
        this.uiManager?.updatePanels();
    }

    /**
     * Update elevation profile display.
     */
    updateProfile() {
        this.uiManager?.updateProfile();
    }

    /**
     * Get currently active tool.
     * @returns {Object|null}
     */
    getActiveTool() {
        if (this.vectorTileInfoControl?.isActive) return this.vectorTileInfoControl;
        if (this.rectangleSelectionControl?.isActive) return this.rectangleSelectionControl;

        for (const control of this.controls.values()) {
            if (control.isActive) return control;
        }

        return null;
    }

    /**
     * Delete all selected features.
     */
    deleteSelectedFeatures() {
        const featuresByType = new Map();
        const selectedFeatures = this.getAllSelectedFeatures();

        for (const feature of selectedFeatures) {
            const type = feature.properties.source;
            if (!featuresByType.has(type)) {
                featuresByType.set(type, []);
            }
            featuresByType.get(type).push(feature);
        }

        featuresByType.forEach((features, type) => {
            const control = this.controls.get(type);
            control?.deleteFeatures?.(features);
        });

        this.deselectAllFeatures();
    }

    /**
     * Update all selected features (after batch property change).
     */
    async updateSelectedFeatures() {
        const selectedFeatures = this.getAllSelectedFeatures();
        const featuresByType = new Map();
        const allFeatureIds = [];

        for (const feature of selectedFeatures) {
            const type = feature.properties.source;
            if (!featuresByType.has(type)) {
                featuresByType.set(type, []);
            }
            featuresByType.get(type).push(feature);

            if (feature.properties?.id) {
                allFeatureIds.push(feature.properties.id);
            }
        }

        this.notifyMultipleGeometryChanges(allFeatureIds);

        for (const [type, features] of featuresByType) {
            const control = this.controls.get(type);
            await control?.updateFeatures?.(features, true);
        }
    }

    /**
     * Cleanup resources.
     * Call when component is destroyed.
     */
    destroy() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        this._hideFeatureSelectionMenu();

        // Cleanup map event listeners
        this.map.off('click', this._handleMapClick);

        if (this._handleMoveStart) {
            this.map.off('movestart', this._handleMoveStart);
            this._handleMoveStart = null;
        }

        if (this._handleZoomStart) {
            this.map.off('zoomstart', this._handleZoomStart);
            this._handleZoomStart = null;
        }

        // Cleanup document event listener
        if (this._handleKeydown) {
            document.removeEventListener('keydown', this._handleKeydown);
            this._handleKeydown = null;
        }

        // Cleanup two-finger tap handler
        if (this._cleanupTwoFingerTap) {
            this._cleanupTwoFingerTap();
            this._cleanupTwoFingerTap = null;
        }
    }
}

export default SelectionManager;

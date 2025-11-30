// Path: js/controls_sig/tool_manager/selection_manager.js

import {
    getFeatureGroup,
    getVisibleLayerIds,
    isFeatureEffectivelyLocked,
} from '../store/store.js';

class SelectionManager {
    constructor(map) {
        this.map = map;
        this.uiManager = null;
        this.vectorTileInfoControl = null;
        this.rectangleSelectionControl = null;

        this.controls = new Map();
        this.selectedFeatures = new Map();

        this.contextMenu = null;
        this.pendingFeatures = null;
        this.pendingEvent = null;
        this.setupEventListeners();
    }

    /**
     * Register a control with the selection manager
     */
    registerControl(type, control) {
        this.controls.set(type, control);
    }

    setUIManager(uiManager) {
        this.uiManager = uiManager;
    }

    setvectorTileInfoControl(vectorTileInfoControl) {
        this.vectorTileInfoControl = vectorTileInfoControl;
    }

    setRectangleSelectionControl(rectangleSelectionControl) {
        this.rectangleSelectionControl = rectangleSelectionControl;
    }

    setupEventListeners = () => {
        this.map.on('click', this.handleMapClick);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.contextMenu) {
                this._hideFeatureSelectionMenu();
            }
        });

        this.map.on('movestart', () => {
            if (this.contextMenu) {
                this._hideFeatureSelectionMenu();
            }
        });

        this.map.on('zoomstart', () => {
            if (this.contextMenu) {
                this._hideFeatureSelectionMenu();
            }
        });
    }

    handleMapClick = (e) => {
        if (this.vectorTileInfoControl && this.vectorTileInfoControl.isActive) return;
        if (this.rectangleSelectionControl && this.rectangleSelectionControl.isActive) return;

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
                this.uiManager.saveChangesAndClosePanel();
                if (this.hasSelectedFeatures()) {
                    this.deselectAllFeatures();
                }
            }
        }
    }

    /**
     * Get all clicked custom features at a point, filtered by visible layers
     */
    getAllClickedCustomFeatures = (point) => {
        const features = this.map.queryRenderedFeatures(point);
        const clickedFeatures = [];

        const visibleLayerIds = getVisibleLayerIds();
        const visibleLayerSet = new Set(visibleLayerIds);

        for (const [type, control] of this.controls) {
            const layerIds = control.getLayerIds();
            const sourceNames = control.getSourceNames();
            for (const sourceName of sourceNames) {
                const matchingFeatures = features.filter(f =>
                    f.source === sourceName && f.properties.source === type
                );
                matchingFeatures.forEach(feature => {
                    if (isFeatureEffectivelyLocked(feature)) {
                        return;
                    }

                    const featureLayerId = feature.properties.layerId || 'default';
                    if (!visibleLayerSet.has(featureLayerId)) {
                        return;
                    }
                    clickedFeatures.push({ ...feature, toolType: type });
                });
            }
        }

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
     * Get first clicked custom feature (for compatibility)
     */
    getClickedCustomFeature = (point) => {
        const features = this.getAllClickedCustomFeatures(point);
        return features.length > 0 ? features[0] : null;
    }

    /**
     * Handle click on a specific feature
     */
    _handleFeatureClick = async (clickedFeature, e) => {
        if (isFeatureEffectivelyLocked(clickedFeature)) {
            return;
        }

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
     * Handle click on feature that is part of a group
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
     * Handle click on individual feature (not grouped)
     */
    _handleSingleFeatureClick = async (clickedFeature, e) => {
        const type = clickedFeature.toolType;
        const featureId = clickedFeature.properties.id;
        const isFeatureSelected = this.isFeatureSelected(type, featureId);

        if (isFeatureSelected && e.originalEvent.shiftKey) {
            await this.toggleFeatureSelection(type, featureId, clickedFeature, true);
        } else if (!isFeatureSelected) {
            if (!e.originalEvent.shiftKey) {
                this.deselectAllFeatures();
            }
            await this.toggleFeatureSelection(type, featureId, clickedFeature, false);
        }

        this.updateUI();
    }

    /**
     * Select all features in a group
     */
    _selectGroup = async (group) => {
        for (const featureRef of group.features) {
            const completeFeature = await this.getCompleteFeatureFromSource(featureRef.type, featureRef.id);
            if (completeFeature) {
                await this.toggleFeatureSelection(featureRef.type, featureRef.id, completeFeature, false);
            }
        }
    }

    /**
     * Deselect all features in a group
     */
    _deselectGroup = async (group) => {
        for (const featureRef of group.features) {
            await this.toggleFeatureSelection(featureRef.type, featureRef.id, null, true);
        }
    }

    /**
     * Check if a group is selected (all features)
     */
    _isGroupSelected = (group) => {
        return group.features.every(featureRef =>
            this.isFeatureSelected(featureRef.type, featureRef.id)
        );
    }

    /**
     * Show context menu for multiple features
     */
    _showFeatureSelectionMenu = (features, e) => {
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
     * Create HTML element for context menu
     */
    _createContextMenuElement = (features, e) => {
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

        const separator = document.createElement('div');
        separator.style.cssText = `
    height: 1px !important;
    background: #ddd !important;
    margin: 4px 0 !important;
`;
        menu.appendChild(separator);

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
     * Select all features from the pending context menu
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
     * Get display name for feature
     */
    _getFeatureName = (feature) => {
        const type = feature.toolType;
        const nome = feature.properties.nome;

        if (nome && nome.trim()) {
            return `${nome}`;
        }

        return `ID: ${feature.properties.id}`;
    }

    /**
     * Hide context menu
     */
    _hideFeatureSelectionMenu = () => {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
            this.pendingFeatures = null;
            this.pendingEvent = null;
        }
    }

    isFeatureSelected = (type, featureId) => {
        const key = `${type}:${featureId}`;
        return this.selectedFeatures.has(key);
    }

    isClickOnEditHandle = (point) => {
        const features = this.map.queryRenderedFeatures(point);

        for (const control of this.controls.values()) {
            const editHandleSource = control.getEditHandleSource();
            if (editHandleSource) {
                const hasHandle = features.some(f =>
                    f.source === editHandleSource &&
                    f.properties.user_isEditingHandle
                );
                if (hasHandle) return true;
            }
        }

        return false;
    }

    toggleFeatureSelection = async (type, featureId, feature, forceToggle = false) => {
        const key = `${type}:${featureId}`;
        const control = this.controls.get(type);

        if (this.selectedFeatures.has(key) && forceToggle) {
            this.selectedFeatures.delete(key);
            if (control && control.onFeatureDeselected) {
                control.onFeatureDeselected(feature);
            }
        } else if (!this.selectedFeatures.has(key)) {
            const completeFeature = await this.getCompleteFeatureFromSource(type, featureId);
            const featureToStore = completeFeature || feature;
            this.selectedFeatures.set(key, { type, feature: featureToStore });
            if (control && control.onFeatureSelected) {
                control.onFeatureSelected(featureToStore);
            }
        }
    }

    getCompleteFeatureFromSource = async (type, featureId) => {
        const control = this.controls.get(type);
        if (!control) {
            console.warn(`Control não encontrado para tipo: ${type}`);
            return null;
        }

        const sourceNames = control.getSourceNames();
        if (!sourceNames || !sourceNames.length) {
            console.warn(`Source names não encontrados para tipo: ${type}`);
            return null;
        }

        const sourceName = sourceNames[0];
        const mapSource = this.map.getSource(sourceName);
        if (!mapSource) return null;

        const data = await mapSource.getData();
        if (!data) return null;

        return data.features.find(f => f.properties.id == featureId);
    }

    /**
     * Convenience method to select a specific feature
     */
    selectFeature = async (type, featureId, feature = null) => {
        this.deselectAllFeatures();

        await this.toggleFeatureSelection(type, featureId, feature, false);
        this.updateUI();
    }

    deselectAllFeatures = () => {
        this.controls.forEach((control, type) => {
            if (control.onGlobalDeselect) {
                control.onGlobalDeselect();
            }
        });

        this.selectedFeatures.clear();
        this.updateUI();
    }

    /**
     * Get all selected features
     */
    getAllSelectedFeatures() {
        return Array.from(this.selectedFeatures.values()).map(item => item.feature);
    }

    /**
     * Get selected features by type
     */
    getSelectedFeaturesByType(type) {
        return Array.from(this.selectedFeatures.values()).filter(item => item.type === type);
    }

    /**
     * Helper method to get IDs of selected features by type
     */
    getSelectedFeatureIdsByType(type) {
        return this.getSelectedFeaturesByType(type).map(item => item.feature.properties.id);
    }

    /**
     * Get a specific selected feature
     */
    getSelectedFeature(type, featureId) {
        const key = `${type}:${featureId}`;
        const item = this.selectedFeatures.get(key);
        return item ? item.feature : null;
    }

    /**
     * Clear selections of a specific type
     */
    clearSelectionsByType(type) {
        const keysToDelete = [];
        for (const [key, item] of this.selectedFeatures) {
            if (item.type === type) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.selectedFeatures.delete(key));
    }

    // ===== CACHE INTEGRATION =====

    /**
     * Notify geometry change to invalidate cache in UIManager
     */
    notifyGeometryChange(featureId) {
        if (this.uiManager && this.uiManager.notifyGeometryChange) {
            this.uiManager.notifyGeometryChange(featureId);
        }
    }

    /**
     * Notify multiple geometry changes
     */
    notifyMultipleGeometryChanges(featureIds) {
        if (this.uiManager && this.uiManager.notifyGeometryChange) {
            featureIds.forEach(featureId => {
                this.uiManager.notifyGeometryChange(featureId);
            });
        }
    }

    updateUI = () => {
        this.uiManager.updateSelectionHighlight();
        this.uiManager.updatePanels();
    }

    updateProfile = () => {
        this.uiManager.updateProfile();
    }

    getActiveTool = () => {
        if (this.vectorTileInfoControl && this.vectorTileInfoControl.isActive) {
            return this.vectorTileInfoControl;
        }

        if (this.rectangleSelectionControl && this.rectangleSelectionControl.isActive) {
            return this.rectangleSelectionControl;
        }

        for (const control of this.controls.values()) {
            if (control.isActive) {
                return control;
            }
        }

        return null;
    }

    deleteSelectedFeatures = () => {
        const featuresByType = new Map();
        for (const item of this.selectedFeatures.values()) {
            if (!featuresByType.has(item.type)) {
                featuresByType.set(item.type, []);
            }
            featuresByType.get(item.type).push(item.feature);
        }

        featuresByType.forEach((features, type) => {
            const control = this.controls.get(type);
            if (control && control.deleteFeatures) {
                control.deleteFeatures(features);
            }
        });

        this.deselectAllFeatures();
    }

    updateSelectedFeatures = async () => {
        const featuresByType = new Map();
        const allFeatureIds = [];
        for (const item of this.selectedFeatures.values()) {
            if (!featuresByType.has(item.type)) {
                featuresByType.set(item.type, []);
            }
            featuresByType.get(item.type).push(item.feature);

            if (item.feature.properties && item.feature.properties.id) {
                allFeatureIds.push(item.feature.properties.id);
            }
        }

        this.notifyMultipleGeometryChanges(allFeatureIds);

        for (const [type, features] of featuresByType) {
            const control = this.controls.get(type);
            if (control && control.updateFeatures) {
                await control.updateFeatures(features, true);
            }
        }
    }

    hasSelectedFeatures() {
        return this.selectedFeatures.size > 0;
    }
}

export default SelectionManager;

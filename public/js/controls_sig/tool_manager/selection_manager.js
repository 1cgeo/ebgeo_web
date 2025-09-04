// Path: js\controls_sig\tool_manager\selection_manager.js

class SelectionManager {
    constructor(map) {
        this.map = map;
        this.uiManager = null;
        this.vectorTileInfoControl = null;
        this.rectangleSelectionControl = null;

        // Control registry - unified storage for all controls
        this.controls = new Map();

        // Unified selection storage - one map instead of 11+
        this.selectedFeatures = new Map(); // featureId -> { type, feature }

        // Context menu for multiple feature selection
        this.contextMenu = null;
        this.pendingFeatures = null;
        this.pendingEvent = null;

        this.setupEventListeners();
    }

    /**
     * Register a control with the selection manager
     * This replaces all the individual setXXXControl methods
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

        // Close context menu with ESC key (mantido - funciona bem)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.contextMenu) {
                this._hideFeatureSelectionMenu();
            }
        });

        // Close menu on map move/zoom
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
        // Early returns for special states
        if (this.vectorTileInfoControl && this.vectorTileInfoControl.isActive) return;
        if (this.rectangleSelectionControl && this.rectangleSelectionControl.isActive) return;

        const activeTool = this.getActiveTool();
        if (activeTool) {
            activeTool.handleMapClick(e);
            return;
        }

        // Detect ALL clicked features (not just the first one)
        const clickedFeatures = this.getAllClickedCustomFeatures([e.point.x, e.point.y]);

        if (clickedFeatures.length > 0) {
            if (clickedFeatures.length === 1) {
                // Single feature: process directly
                this._handleFeatureClick(clickedFeatures[0], e);
            } else {
                // Multiple features: show context menu
                this._showFeatureSelectionMenu(clickedFeatures, e);
            }
        } else {
            // Click on empty area
            this._hideFeatureSelectionMenu(); // close menu if open
            if (!e.originalEvent.shiftKey && this.hasSelectedFeatures()) {
                this.uiManager.saveChangesAndClosePanel();
                if (this.hasSelectedFeatures()) {
                    this.deselectAllFeatures();
                }
            }
        }
    }

    /**
     * Get ALL clicked custom features at a point
     */
    getAllClickedCustomFeatures = (point) => {
        const features = this.map.queryRenderedFeatures(point);
        const clickedFeatures = [];

        // Search through each configured control type
        for (const [type, control] of this.controls) {
            const layerIds = control.getLayerIds();
            const sourceNames = control.getSourceNames();

            for (const sourceName of sourceNames) {
                const matchingFeatures = features.filter(f =>
                    f.source === sourceName && f.properties.source === type
                );

                matchingFeatures.forEach(feature => {
                    if (feature.properties.bloqueado === true) {
                        return;
                    }
                    clickedFeatures.push({ ...feature, toolType: type });
                });
            }
        }
        // Remove duplicates based on type + id
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
    _handleFeatureClick = (clickedFeature, e) => {
        // Check if feature is blocked
        if (clickedFeature.properties.bloqueado === true) {
            return;
        }

        const type = clickedFeature.toolType;
        const featureId = clickedFeature.properties.id;
        const isFeatureSelected = this.isFeatureSelected(type, featureId);

        if (isFeatureSelected && e.originalEvent.shiftKey) {
            // Deselect if Shift + already selected
            this.toggleFeatureSelection(type, featureId, clickedFeature, true);
        } else if (!isFeatureSelected) {
            // Select new feature
            if (!e.originalEvent.shiftKey) {
                this.deselectAllFeatures();
            }
            this.toggleFeatureSelection(type, featureId, clickedFeature, false);
        }

        this.updateUI();
    }

    /**
     * Show context menu for multiple features
     */
    _showFeatureSelectionMenu = (features, e) => {
        // Close previous menu if exists
        this._hideFeatureSelectionMenu();

        // Filter out blocked features
        const availableFeatures = features.filter(f => f.properties.bloqueado !== true);

        if (availableFeatures.length === 0) return;
        if (availableFeatures.length === 1) {
            // If only one remains after filtering, select directly
            this._handleFeatureClick(availableFeatures[0], e);
            return;
        }

        // Store references for later use
        this.pendingFeatures = availableFeatures;
        this.pendingEvent = e;

        // Create and show menu
        this.contextMenu = this._createContextMenuElement(availableFeatures, e);
        document.body.appendChild(this.contextMenu);
    }

    /**
     * Create HTML element for context menu
     */
    _createContextMenuElement = (features, e) => {
        const menu = document.createElement('div');
        menu.className = 'feature-selection-menu';

        // Clean production styles
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

        // Position menu near click point
        const x = Math.min(e.originalEvent.clientX, window.innerWidth - 220);
        const y = Math.min(e.originalEvent.clientY, window.innerHeight - 50);
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        // Create menu header
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

        // Create item for each feature
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

            // Hover effects
            item.addEventListener('mouseenter', () => {
                item.style.backgroundColor = '#f0f8ff !important';
            });
            item.addEventListener('mouseleave', () => {
                item.style.backgroundColor = 'white !important';
            });

            // Click handler
            item.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this._handleFeatureClick(feature, this.pendingEvent);
                this._hideFeatureSelectionMenu();
            });

            menu.appendChild(item);
        });

        // Linha divisória
        const separator = document.createElement('div');
        separator.style.cssText = `
    height: 1px !important;
    background: #ddd !important;
    margin: 4px 0 !important;
`;
        menu.appendChild(separator);

        // Opção "Selecionar Todas"
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

        // Hover effects para "Selecionar Todas"
        selectAllItem.addEventListener('mouseenter', () => {
            selectAllItem.style.backgroundColor = '#f0f8ff !important';
        });
        selectAllItem.addEventListener('mouseleave', () => {
            selectAllItem.style.backgroundColor = 'white !important';
        });

        // Click handler para "Selecionar Todas"
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
    _selectAllPendingFeatures = () => {
        if (!this.pendingFeatures || !this.pendingEvent) return;

        // Check if Shift is pressed - if not, clear existing selections
        if (!this.pendingEvent.originalEvent.shiftKey) {
            this.deselectAllFeatures();
        }

        // Select each pending feature
        this.pendingFeatures.forEach(feature => {
            const type = feature.toolType;
            const featureId = feature.properties.id;

            // Only select if not already selected (avoid duplicate selections)
            if (!this.isFeatureSelected(type, featureId)) {
                this.toggleFeatureSelection(type, featureId, feature, false);
            }
        });

        this.updateUI();
    }

    /**
     * Get display name for feature (simplified to always use properties.nome)
     */
    _getFeatureName = (feature) => {
        const type = feature.toolType;
        const nome = feature.properties.nome;

        if (nome && nome.trim()) {
            return `${nome}`;
        }

        // Fallback: type + ID
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

        // Query each tool for its edit handle sources
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

    toggleFeatureSelection(type, featureId, feature, forceToggle = false) {
        const key = `${type}:${featureId}`;
        const control = this.controls.get(type);

        if (this.selectedFeatures.has(key) && forceToggle) {
            // Deselect feature
            this.selectedFeatures.delete(key);

            if (control && control.onFeatureDeselected) {
                control.onFeatureDeselected(feature);
            }
        } else if (!this.selectedFeatures.has(key)) {
            // Select feature - always use complete feature from source
            const completeFeature = this.getCompleteFeatureFromSource(type, featureId);
            const featureToStore = completeFeature || feature; // fallback to original if not found

            this.selectedFeatures.set(key, { type, feature: featureToStore });

            if (control && control.onFeatureSelected) {
                control.onFeatureSelected(featureToStore);
            }
        }
    }

    getCompleteFeatureFromSource(type, featureId) {
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
        if (!mapSource || !mapSource._data) return null;

        return mapSource._data.features.find(f => f.properties.id == featureId);
    }

    /**
     * Método de conveniência para selecionar uma feature específica
     */
    selectFeature(type, featureId, feature = null) {
        // Limpar seleções existentes primeiro
        this.deselectAllFeatures();

        // Selecionar a nova feature
        this.toggleFeatureSelection(type, featureId, feature, false);
        this.updateUI();
    }

    deselectAllFeatures = () => {
        this.controls.forEach((control, type) => {
            if (control.onGlobalDeselect) {
                control.onGlobalDeselect();
            }
        });

        // Clear all selections
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
     * Helper method para obter IDs das features selecionadas por tipo
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
     * Notifica mudança de geometria para invalidar cache no UIManager
     */
    notifyGeometryChange(featureId) {
        if (this.uiManager && this.uiManager.notifyGeometryChange) {
            this.uiManager.notifyGeometryChange(featureId);
        }
    }

    /**
     * Notifica mudanças de múltiplas geometrias
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
        // Check vector tile info control first (special case)
        if (this.vectorTileInfoControl && this.vectorTileInfoControl.isActive) {
            return this.vectorTileInfoControl;
        }

        if (this.rectangleSelectionControl && this.rectangleSelectionControl.isActive) {
            return this.rectangleSelectionControl;
        }

        // Check all registered controls
        for (const control of this.controls.values()) {
            if (control.isActive) {
                return control;
            }
        }

        return null;
    }

    deleteSelectedFeatures = () => {
        // Group features by type for efficient deletion
        const featuresByType = new Map();

        for (const item of this.selectedFeatures.values()) {
            if (!featuresByType.has(item.type)) {
                featuresByType.set(item.type, []);
            }
            featuresByType.get(item.type).push(item.feature);
        }

        // Delete features from each control
        featuresByType.forEach((features, type) => {
            const control = this.controls.get(type);
            if (control && control.deleteFeatures) {
                control.deleteFeatures(features);
            }
        });

        this.deselectAllFeatures();
    }

    updateSelectedFeatures = async () => {
        // Group features by type for efficient updates
        const featuresByType = new Map();
        const allFeatureIds = [];

        for (const item of this.selectedFeatures.values()) {
            if (!featuresByType.has(item.type)) {
                featuresByType.set(item.type, []);
            }
            featuresByType.get(item.type).push(item.feature);

            // Coletar IDs das features para invalidar cache
            if (item.feature.properties && item.feature.properties.id) {
                allFeatureIds.push(item.feature.properties.id);
            }
        }

        // Invalidar cache para todas as features que foram atualizadas
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
// Path: js\controls_sig\tool_manager\selection_manager.js

/**
 * Configuration for all control types
 * Adding a new control type is as simple as adding an entry here
 */
const CONTROL_CONFIG = {
    point: {
        layerIds: ['point-layer'],
        sourceNames: ['points']
    },
    line: {
        layerIds: [
            'line-layer',           // solid (main/default)
            'line-layer-dashed',    // dashed style
            'line-layer-dotted',    // dotted style
            'line-layer-dash-dot',  // dash-dot style
        ],
        sourceNames: ['lines'],
        editHandleSource: 'line-edit-handles'
    },
    polygon: {
        layerIds: [
            'polygon-fill-layer',       // fill layer
            'polygon-layer',            // solid stroke (main/default)
            'polygon-layer-dashed',     // dashed stroke
            'polygon-layer-dotted',     // dotted stroke
            'polygon-layer-dash-dot',   // dash-dot stroke
        ],
        sourceNames: ['polygons'],
        editHandleSource: 'polygon-edit-handles'
    },
    text: {
        layerIds: ['text-layer'],
        sourceNames: ['texts']
    },
    image: {
        layerIds: ['image-layer'],
        sourceNames: ['images']
    },
    los: {
        layerIds: ['los-layer'],
        sourceNames: ['los']
    },
    visibility: {
        layerIds: ['visibility-layer'],
        sourceNames: ['visibility']
    },
    rectangle: {
        layerIds: ['rectangle-fill-layer', 'rectangle-layer'],
        sourceNames: ['rectangles'],
        editHandleSource: 'rectangle-edit-handles'
    },
    circle: {
        layerIds: ['circle-fill-layer', 'circle-layer'],
        sourceNames: ['circles'],
        editHandleSource: 'circle-edit-handles'
    },
    ellipse: {
        layerIds: ['ellipse-layer', 'ellipse-fill-layer'],
        sourceNames: ['ellipses'],
        editHandleSource: 'ellipse-edit-handles'
    },
    brush: {
        layerIds: ['brush-layer'],
        sourceNames: ['brushes']
    },
    arrow: {
        layerIds: ['arrow-layer', 'arrow-fill-layer'],
        sourceNames: ['arrows'],
        editHandleSource: 'arrow-edit-handles'
    },
    boundary: {
        layerIds: ['boundary-main-layer'],
        sourceNames: ['boundarys'],
        editHandleSource: 'boundary-edit-handles'
    },
    occupied_front: {
        layerIds: ['occupied-front-layer'],
        sourceNames: ['occupied_fronts'],
        editHandleSource: 'occupied_front-edit-handles'
    },
    military_symbol: {
        layerIds: ['military-symbols-layer'],
        sourceNames: ['military_symbols']
    }
};

class SelectionManager {
    constructor(map) {
        this.map = map;
        this.uiManager = null;
        this.vectorTileInfoControl = null;

        // Control registry - unified storage for all controls
        this.controls = new Map();

        // Unified selection storage - one map instead of 11+
        this.selectedFeatures = new Map(); // featureId -> { type, feature }

        this.setupEventListeners();
    }

    /**
     * Register a control with the selection manager
     * This replaces all the individual setXXXControl methods
     */
    registerControl(type, control) {
        if (!CONTROL_CONFIG[type]) {
            throw new Error(`Unknown control type: ${type}`);
        }

        this.controls.set(type, control);

        // Setup layer click listeners for this control type
        this._setupControlEventListeners(type);
    }

    setUIManager(uiManager) {
        this.uiManager = uiManager;
    }

    setvectorTileInfoControl(vectorTileInfoControl) {
        this.vectorTileInfoControl = vectorTileInfoControl;
    }

    /**
     * Setup event listeners for a specific control type
     */
    _setupControlEventListeners(type) {
        const config = CONTROL_CONFIG[type];

        // Setup click listeners for each layer
        config.layerIds.forEach(layerId => {
            this.map.on('click', layerId, this.handleElementClick);
        });
    }

    setupEventListeners = () => {
        this.map.on('click', this.handleMapClick);
    }

    handleMapClick = (e) => {
        if (e.defaultPrevented) return;

        const activeTool = this.getActiveTool();
        if (activeTool) {
            activeTool.handleMapClick(e);
        } else {
            if (!e.originalEvent.shiftKey && this.hasSelectedFeatures()) {
                this.uiManager.saveChangesAndClosePanel();
                if (this.hasSelectedFeatures()) {
                    this.deselectAllFeatures();
                }
            }
        }
    }

    getClickedCustomFeature = (point) => {
        const features = this.map.queryRenderedFeatures(point);

        // Check each control type configuration
        for (const [type, config] of Object.entries(CONTROL_CONFIG)) {

            for (const sourceName of config.sourceNames) {
                const feature = features.find(f =>
                    (f.source === sourceName || config.layerIds.includes(f.layer?.id)) &&
                    f.properties.source === type
                );

                if (feature) {
                    return { ...feature, toolType: type };
                }
            }
        }

        return null;
    }

    isFeatureSelected = (type, featureId) => {
        const key = `${type}:${featureId}`;
        return this.selectedFeatures.has(key);
    }
    isClickOnEditHandle = (point) => {
        const features = this.map.queryRenderedFeatures(point);

        const editHandleSources = [];
        for (const [type, config] of Object.entries(CONTROL_CONFIG)) {
            if (config.editHandleSource) {
                editHandleSources.push(config.editHandleSource);
            }
        }

        return features.some(f =>
            customHandleSources.includes(f.source) &&
            f.properties.user_isEditingHandle
        );
    }

    handleElementClick = (e) => {
        if (this.vectorTileInfoControl && this.vectorTileInfoControl.isActive) return;
        if (this.getActiveTool()) return;
        e.preventDefault();

        const feature = e.features[0];
        if (feature.properties.bloqueado === true) {
            return;
        }

        const type = feature.properties.source;
        const featureId = feature.properties.id;

        // Check if feature is already selected
        const isFeatureSelected = this.isFeatureSelected(type, featureId);

        if (isFeatureSelected && e.originalEvent.shiftKey) {
            // Only deselect if holding shift and feature is already selected
            this.toggleFeatureSelection(type, featureId, feature, true); // force toggle
        } else if (!isFeatureSelected) {
            // Select new feature
            if (!e.originalEvent.shiftKey) {
                this.deselectAllFeatures();
            }
            this.toggleFeatureSelection(type, featureId, feature, false); // don't force toggle
        }
        this.updateUI();
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
        const config = CONTROL_CONFIG[type];

        // Verificação de segurança para tipo inválido
        if (!config || !config.sourceNames || !config.sourceNames.length) {
            console.warn(`Tipo de feature não encontrado ou inválido: ${type}`);
            return null;
        }

        const sourceName = config.sourceNames[0];
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
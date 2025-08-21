// Path: js\controls_sig\tool_manager\selection_manager.js

/**
 * Configuration for all control types
 * Adding a new control type is as simple as adding an entry here
 */
const CONTROL_CONFIG = {
    draw: {
        layerIds: [], // Will be handled by maplibredraw
        sourceNames: ['mapbox-gl-draw-cold', 'mapbox-gl-draw-hot'],
        criticalProps: [],
        hasEditingMode: true,
        hasSpecialSelectionHandling: true
    },
    text: {
        layerIds: ['text-layer'],
        sourceNames: ['texts'],
        criticalProps: [],
        hasEditingMode: false,
        hasSpecialSelectionHandling: false
    },
    image: {
        layerIds: ['image-layer'],
        sourceNames: ['images'],
        criticalProps: [],
        hasEditingMode: false,
        hasSpecialSelectionHandling: false
    },
    los: {
        layerIds: ['los-layer'],
        sourceNames: ['los'],
        criticalProps: [],
        hasEditingMode: false,
        hasSpecialSelectionHandling: false
    },
    visibility: {
        layerIds: ['visibility-layer'],
        sourceNames: ['visibility'],
        criticalProps: [],
        hasEditingMode: false,
        hasSpecialSelectionHandling: false
    },
    circle: {
        layerIds: ['circle-fill-layer', 'circle-layer'],
        sourceNames: ['circles'],
        criticalProps: ['center', 'radius'],
        hasEditingMode: true,
        hasSpecialSelectionHandling: true,
        editHandleSource: 'circle-edit-handles'
    },
    ellipse: {
        layerIds: ['ellipse-layer', 'ellipse-fill-layer'],
        sourceNames: ['ellipses'],
        criticalProps: ['center', 'majorRadius', 'minorRadius', 'bearing'],
        hasEditingMode: true,
        hasSpecialSelectionHandling: true,
        editHandleSource: 'ellipse-edit-handles'
    },
    arrow: {
        layerIds: ['arrow-layer', 'arrow-fill-layer'],
        sourceNames: ['arrows'],
        criticalProps: ['baseCoordinates'],
        hasEditingMode: true,
        hasSpecialSelectionHandling: true,
        editHandleSource: 'arrow-edit-handles'
    },
    boundary: {
        layerIds: ['boundary-main-layer'],
        sourceNames: ['boundarys'],
        criticalProps: ['center'],
        hasEditingMode: true,
        hasSpecialSelectionHandling: true,
        editHandleSource: 'boundary-edit-handles'
    },
    occupied_front: {
        layerIds: ['occupied-front-layer'],
        sourceNames: ['occupied_fronts'],
        criticalProps: ['baseCoordinates'],
        hasEditingMode: true,
        hasSpecialSelectionHandling: true,
        editHandleSource: 'occupied_front-edit-handles'
    },
    military_symbol: {
        layerIds: ['military-symbols-layer'],
        sourceNames: ['military_symbols'],
        criticalProps: ['sidc', 'affiliation', 'dimension', 'mainIcon', 'echelon'],
        hasEditingMode: false,
        hasSpecialSelectionHandling: false
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
        this.map.on('draw.selectionchange', this.handleDrawSelectionChange);
    }

    handleMapClick = (e) => {
        if (e.defaultPrevented) return;

        const activeTool = this.getActiveTool();
        if (activeTool) {
            activeTool.handleMapClick(e);
        } else {
            // Check for maplibredraw features
            const clickedDrawFeature = this.getClickedDrawFeature(e.point);

            // Check for custom tool features
            const clickedCustomFeature = this.getClickedCustomFeature(e.point);

            // Check if we clicked on an edit handle
            if (this.isClickOnEditHandle(e.point)) {
                return; // Don't deselect if clicking on edit handles
            }

            // Handle maplibredraw features
            if (clickedDrawFeature) {
                if (this.isFeatureSelected('draw', clickedDrawFeature.properties.id) &&
                    clickedDrawFeature.geometry.type !== 'Point') {
                    this.controls.get('draw').draw.changeMode('direct_select', {
                        featureId: clickedDrawFeature.properties.id
                    });
                } else {
                    if (!e.originalEvent.shiftKey) {
                        this.deselectAllFeatures();
                    }
                }
                this.updateUI();
                return;
            }

            // Handle custom tool features
            if (clickedCustomFeature) {
                const isAlreadySelected = this.isFeatureSelected(
                    clickedCustomFeature.toolType,
                    clickedCustomFeature.properties.id
                );

                if (isAlreadySelected) {
                    // Feature is already selected - transition to editing mode
                    this.transitionToEditingMode(clickedCustomFeature);
                } else {
                    // New feature selection
                    if (!e.originalEvent.shiftKey) {
                        this.deselectAllFeatures();
                    }
                    // The actual selection will be handled by handleElementClick
                }
                this.updateUI();
                return;
            }

            // No feature clicked - deselect all if not holding shift
            if (!e.originalEvent.shiftKey) {
                this.uiManager.saveChangesAndClosePanel();
                this.deselectAllFeatures();
            }
            this.updateUI();
        }
    }

    getClickedCustomFeature = (point) => {
        const features = this.map.queryRenderedFeatures(point);

        // Check each control type configuration
        for (const [type, config] of Object.entries(CONTROL_CONFIG)) {
            if (type === 'draw') continue; // Special handling for draw

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

    transitionToEditingMode = (feature) => {
        const type = feature.toolType || feature.properties.source;
        const featureId = feature.properties.id;

        if (!this.isFeatureSelected(type, featureId)) return;

        const control = this.controls.get(type);
        const selectedFeature = this.getSelectedFeature(type, featureId);

        if (control && selectedFeature && control.onFeatureSelected) {
            control.onFeatureSelected(selectedFeature);
        }
    }

    isClickOnEditHandle = (point) => {
        const features = this.map.queryRenderedFeatures(point);

        // Check for maplibredraw edit handles
        const hasMaplibreDrawEditHandles = features.some(feature =>
            feature.properties.mode === 'direct_select' ||
            feature.properties.meta === 'midpoint' ||
            feature.properties.meta === 'vertex'
        );
        if (hasMaplibreDrawEditHandles) return true;

        // Check for custom control edit handles
        for (const [type, config] of Object.entries(CONTROL_CONFIG)) {
            if (!config.hasEditingMode || !config.editHandleSource) continue;

            const control = this.controls.get(type);
            if (control && control.isEditingMode && control.isEditingMode()) {
                const handleFeatures = features.filter(f =>
                    f.source === config.editHandleSource &&
                    (f.properties.meta === 'vertex' || f.properties.user_isEditingHandle)
                );
                if (handleFeatures.length > 0) return true;
            }
        }

        return false;
    }

    getClickedDrawFeature(point) {
        const features = this.map.queryRenderedFeatures(point);
        return features.find(f =>
            f.source === 'mapbox-gl-draw-cold' ||
            f.source === 'mapbox-gl-draw-hot' ||
            f.source?.includes('draw')
        );
    }

    handleElementClick = (e) => {
        e.preventDefault();

        const feature = e.features[0];

        // Melhorar detecção se é feature do draw
        const isDrawFeature = feature.source === 'mapbox-gl-draw-cold' ||
            feature.source === 'mapbox-gl-draw-hot' ||
            !feature.properties.source; // draw features podem não ter .source

        const type = isDrawFeature ? 'draw' : feature.properties.source;
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
        // If feature is selected and not holding shift, don't deselect (will transition to editing in handleMapClick)

        // SEMPRE atualizar draw selections para manter seleção múltipla funcionando
        if (this.controls.has('draw')) {
            const drawFeatureIds = this.getSelectedFeatureIdsByType('draw');
            this.controls.get('draw').draw.changeMode('simple_select', { featureIds: drawFeatureIds });
        }

        this.updateUI();
    }

    toggleFeatureSelection(type, featureId, feature, forceToggle = false) {
        const key = `${type}:${featureId}`;
        const control = this.controls.get(type);
        const config = CONTROL_CONFIG[type];

        if (this.selectedFeatures.has(key) && forceToggle) {
            // Deselect feature
            this.selectedFeatures.delete(key);

            if (control && control.onFeatureDeselected) {
                control.onFeatureDeselected(feature);
            }
        } else if (!this.selectedFeatures.has(key)) {
            // Select feature
            let featureToStore = feature;

            // For problematic features, create optimized hybrid feature
            if (config.criticalProps.length > 0) {
                const completeFeature = this.getCompleteFeatureFromSource(type, featureId);
                if (completeFeature) {
                    featureToStore = this.createOptimalFeatureForDrag(feature, completeFeature, type, config);
                }
            }

            this.selectedFeatures.set(key, { type, feature: featureToStore });

            if (control && control.onFeatureSelected) {
                control.onFeatureSelected(featureToStore);
            }
        }
    }

    getCompleteFeatureFromSource(type, featureId) {
        const config = CONTROL_CONFIG[type];
        if (!config.sourceNames.length) return null;

        const sourceName = config.sourceNames[0];
        const mapSource = this.map.getSource(sourceName);
        if (!mapSource || !mapSource._data) return null;

        return mapSource._data.features.find(f => f.properties.id == featureId);
    }

    createOptimalFeatureForDrag(queryFeature, completeFeature, type, config) {
        if (!completeFeature) return queryFeature;

        // Start with query feature (has correct render properties)
        const hybridFeature = {
            ...queryFeature,
            // Ensure consistent ID (use string like complete feature)
            id: completeFeature.properties.id,
            // Use geometry from complete feature (more reliable)
            geometry: completeFeature.geometry,
            properties: {
                ...queryFeature.properties,
                // Override with critical properties from complete feature
                ...Object.fromEntries(
                    config.criticalProps
                        .filter(prop => completeFeature.properties[prop] !== undefined)
                        .map(prop => [prop, completeFeature.properties[prop]])
                )
            }
        };

        return hybridFeature;
    }

    handleDrawSelectionChange = (e) => {
        // Obter features selecionadas do draw
        const selectedFeatures = this.controls.get('draw').draw.getSelected().features;

        // Limpar seleções draw existentes
        this.clearSelectionsByType('draw');

        // Adicionar novas seleções
        selectedFeatures.forEach(f => {
            const key = `draw:${f.properties.id}`;
            this.selectedFeatures.set(key, { type: 'draw', feature: f });
        });

        this.updateUI();
    }
    
    deselectAllFeatures = (forceDraw = false) => {
        // Notify controls before clearing
        this.notifyControlsOfGlobalDeselect();

        // Clear all selections
        this.selectedFeatures.clear();

        if (forceDraw && this.controls.has('draw') && !this.controls.get('draw').isActive) {
            this.controls.get('draw').draw.changeMode('simple_select', { featureIds: [] });
        }

        this.updateUI();
    }

    notifyControlsOfGlobalDeselect = () => {
        this.controls.forEach((control, type) => {
            if (control.onGlobalDeselect) {
                control.onGlobalDeselect();
            }
        });
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

        this.deselectAllFeatures(true);
    }

    updateSelectedFeatures() {
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

        // Update features in each control
        featuresByType.forEach((features, type) => {
            const control = this.controls.get(type);
            if (control && control.updateFeatures) {
                control.updateFeatures(features, true);
            }
        });
    }
}

export default SelectionManager;
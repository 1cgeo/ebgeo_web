// Path: js\controls_sig\tool_manager\move_handler.js

// ===== CONFIGURATION =====

/**
 * Configuration for edit handles detection
 * Adding new edit handle types requires only adding an entry here
 */
const EDIT_HANDLE_CONFIG = {
    'circle': {
        source: 'circle-edit-handles',
        editModeProperty: 'circle_editing',
        controlKey: 'circle'
    },
    'ellipse': {
        source: 'ellipse-edit-handles', 
        editModeProperty: 'ellipse_editing',
        controlKey: 'ellipse'
    },
    'arrow': {
        source: 'arrow-edit-handles',
        editModeProperty: 'arrow_editing', 
        controlKey: 'arrow'
    },
    'boundary': {
        source: 'boundary-edit-handles',
        editModeProperty: 'boundary_editing',
        controlKey: 'boundary'
    },
    'occupied_front': {
        source: 'occupied-front-edit-handles',
        editModeProperty: 'occupied_front_editing',
        controlKey: 'occupied_front'
    }
};

/**
 * Controls that support editing mode
 */
const CONTROLS_WITH_EDIT_MODE = ['circle', 'ellipse', 'arrow', 'boundary', 'occupied_front'];

/**
 * Valid sources for drag operations
 */
const VALID_DRAG_SOURCES = [
    'los', 'visibility', 'mapbox-gl-draw-cold', 'mapbox-gl-draw-hot', 
    'texts', 'images', 'circles', 'ellipses', 'arrows', 'boundarys', 
    'occupied_fronts', 'military_symbols'
];

class MoveHandler {
    constructor(map, selectionManager, uiManager) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.uiManager = uiManager;

        // Core state
        this.isDragging = false;
        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;

        // Performance optimization properties
        this.rafId = null;
        this.pendingUpdate = false;
        this.mouseMoveHandler = null;
        this.mouseUpHandler = null;

        // Coordinate caching and pooling
        this.cachedPosition = { lng: 0, lat: 0 };
        this.cachedDelta = { dx: 0, dy: 0 };
        this.coordsPool = { lng: 0, lat: 0 };
        this.tempCoords = { lng: 0, lat: 0 };

        // Feature type strategies lookup
        this.featureUpdateStrategies = this.initializeFeatureStrategies();

        this.setupEventListeners();
    }

    // ===== HELPER METHODS =====

    /**
     * Helper to extract ID from any type of feature
     */
    getFeatureId(feature) {
        // Para features customizadas e features do MapLibreDraw do SelectionManager
        if (feature.properties && feature.properties.id !== undefined) {
            return feature.properties.id;
        }
        // Para features do MapLibreDraw retornadas por queryRenderedFeatures
        if (feature.id !== undefined) {
            return feature.id;
        }
        console.warn('Feature without valid ID:', feature);
        return null;
    }

    /**
     * Helper to check if feature is from MapLibreDraw
     */
    isMapLibreDrawFeature(feature) {
        return feature.source === 'mapbox-gl-draw-cold' || 
               feature.source === 'mapbox-gl-draw-hot' ||
               (feature.properties && feature.properties.source === 'draw');
    }

    /**
     * Generic method to get control by type - compatible with refactored SelectionManager
     */
    getControl(type) {
        return this.selectionManager.controls.get(type);
    }

    /**
     * Generic method to check if control is in editing mode
     */
    isControlInEditingMode(type) {
        const control = this.getControl(type);
        return control && control.isEditingMode && control.isEditingMode();
    }

    /**
     * Generic method to check for edit handles of specific type
     */
    hasEditHandlesOfType(clickedFeatures, type) {
        const config = EDIT_HANDLE_CONFIG[type];
        if (!config) return false;
        
        return clickedFeatures.some(feature =>
            feature.source === config.source &&
            feature.properties && (
                feature.properties.user_isEditingHandle ||
                feature.properties.meta === 'vertex' ||
                feature.properties.mode === config.editModeProperty ||
                // Special case for boundary handles
                (type === 'boundary' && (
                    feature.properties.handleType === 'vertex' ||
                    feature.properties.handleType === 'midpoint' ||
                    feature.properties.handleType === 'symbol' ||
                    feature.properties.handleType === 'size'
                ))
            )
        );
    }

    // ===== INITIALIZATION =====

    initializeFeatureStrategies() {
        return {
            'draw': this.updateDrawFeature.bind(this),
            'los': this.updateDrawFeature.bind(this),
            'visibility': this.updateVisibilityFeature.bind(this),
            'text': this.updatePointFeature.bind(this),
            'image': this.updatePointFeature.bind(this),
            'circle': this.updateCircleFeature.bind(this),
            'ellipse': this.updateEllipseFeature.bind(this),
            'arrow': this.updateArrowFeature.bind(this),
            'boundary': this.updateBoundaryFeature.bind(this),
            'occupied_front': this.updateOccupiedFrontFeature.bind(this),
            'military_symbol': this.updateMilitarySymbolFeature.bind(this)
        };
    }

    setupEventListeners() {
        this.map.on('mousedown', this.onMouseDown.bind(this));
    }

    // ===== EVENT HANDLING =====

    onMouseDown(e) {
        this.startDrag(e);

        // Setup drag event listeners - clean previous ones if any
        this.cleanupDragListeners();

        // Create bound handlers for proper cleanup
        this.mouseMoveHandler = this.onMouseMove.bind(this);
        this.mouseUpHandler = this.onMouseUp.bind(this);

        this.map.on('mousemove', this.mouseMoveHandler);
        this.map.once('mouseup', this.mouseUpHandler);
    }

    cleanupDragListeners() {
        if (this.mouseMoveHandler) {
            this.map.off('mousemove', this.mouseMoveHandler);
            this.mouseMoveHandler = null;
        }
        if (this.mouseUpHandler) {
            this.map.off('mouseup', this.mouseUpHandler);
            this.mouseUpHandler = null;
        }
    }

    startDrag(e) {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();
        if (allSelectedFeatures.length === 0) return;

        const clickedFeatures = this.map.queryRenderedFeatures(e.point);
        const filteredFeatures = clickedFeatures.filter(feature => 
            VALID_DRAG_SOURCES.includes(feature.source)
        );

        // Check for edit handles (maplibredraw midpoint/vertex handles)
        const hasMaplibreDrawEditHandles = filteredFeatures.some(feature =>
            feature.properties && (
                feature.properties.mode === 'direct_select' ||
                feature.properties.meta === 'midpoint' ||
                feature.properties.meta === 'vertex'
            )
        );

        // Check for custom tool edit handles using unified method
        const hasCustomToolEditHandles = this.hasCustomEditHandles(clickedFeatures);

        if (filteredFeatures.length === 0 || hasMaplibreDrawEditHandles || hasCustomToolEditHandles) {
            return;
        }

        // Check if any selected feature is in editing mode using unified method
        const hasFeatureInEditingMode = this.hasSelectedFeatureInEditingMode(allSelectedFeatures);
        if (hasFeatureInEditingMode) {
            return;
        }

        // Check if clicked feature is selected
        const isFeatureSelected = filteredFeatures.some(clickedFeature => {
            const clickedFeatureId = this.getFeatureId(clickedFeature);
            
            if (clickedFeatureId === null) {
                return false;
            }

            return allSelectedFeatures.some(selectedFeature => {
                const selectedFeatureId = this.getFeatureId(selectedFeature);
                return selectedFeatureId == clickedFeatureId; // Use loose equality for type coercion
            });
        });

        if (!isFeatureSelected) return;

        // Initialize drag state
        this.isDragging = true;
        this.map.dragPan.disable();
        this.uiManager.setDragging(true);
        this.setCursorStyle('grabbing');

        // Cache initial coordinates
        this.initialCoordinates = e.lngLat;
        this.cachedPosition.lng = e.lngLat.lng;
        this.cachedPosition.lat = e.lngLat.lat;
        this.cachedDelta.dx = 0;
        this.cachedDelta.dy = 0;

        // Cache selected features and calculate offsets
        this.selectedFeatures = allSelectedFeatures;
        this.offsets = this.calculateOffsetsOptimized(allSelectedFeatures, this.initialCoordinates);
    }

    /**
     * UNIFIED: Check for custom tool edit handles - replaces 5+ redundant methods
     */
    hasCustomEditHandles(clickedFeatures) {
        return Object.keys(EDIT_HANDLE_CONFIG).some(type =>
            this.hasEditHandlesOfType(clickedFeatures, type)
        );
    }

    /**
     * UNIFIED: Check if any selected feature is in editing mode - replaces 5+ redundant blocks
     */
    hasSelectedFeatureInEditingMode(selectedFeatures) {
        return selectedFeatures.some(feature => {
            const type = feature.properties?.source;
            
            // Check controls with editing mode using unified method
            if (CONTROLS_WITH_EDIT_MODE.includes(type)) {
                return this.isControlInEditingMode(type);
            }
            
            // Check feature properties for editing mode
            return feature.properties?.mode &&
                   (feature.properties.mode.includes('editing') ||
                    feature.properties.mode === 'direct_select');
        });
    }

    onMouseMove(e) {
        if (!this.isDragging) return;

        // Update cached position and delta
        this.cachedPosition.lng = e.lngLat.lng;
        this.cachedPosition.lat = e.lngLat.lat;
        this.cachedDelta.dx = this.cachedPosition.lng - this.initialCoordinates.lng;
        this.cachedDelta.dy = this.cachedPosition.lat - this.initialCoordinates.lat;

        // Use requestAnimationFrame for smooth updates
        if (!this.pendingUpdate) {
            this.pendingUpdate = true;
            this.rafId = requestAnimationFrame(this.performDragUpdate.bind(this));
        }
    }

    performDragUpdate() {
        if (!this.isDragging) {
            this.pendingUpdate = false;
            return;
        }

        // Perform the actual UI update
        this.uiManager.shiftSelectionBoxes(this.cachedDelta.dx, this.cachedDelta.dy);

        this.pendingUpdate = false;
    }

    onMouseUp(e) {
        if (!this.isDragging) return;

        // Cancel any pending RAF updates
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingUpdate = false;

        // Reset drag state
        this.isDragging = false;
        this.map.dragPan.enable();
        this.uiManager.setDragging(false);
        this.setCursorStyle('');

        // Clean up event listeners
        this.cleanupDragListeners();

        // Calculate final position using cached values
        const dx = this.cachedDelta.dx;
        const dy = this.cachedDelta.dy;
        const distanceMoved = Math.sqrt(dx * dx + dy * dy);
        const tolerance = 2 / Math.pow(2, this.map.getZoom());

        if (distanceMoved > tolerance) {
            // Reuse coordinate object
            this.tempCoords.lng = e.lngLat.lng;
            this.tempCoords.lat = e.lngLat.lat;

            // Batch update features
            const updatedFeatures = this.batchUpdateFeatures(this.selectedFeatures, dx, dy, this.tempCoords);

            // Final UI update
            this.uiManager.shiftSelectionBoxes(dx, dy, true);

            // UPDATED: Use new SelectionManager API
            this.updateSelectionManagerFeatures(updatedFeatures);

            //INVALIDAR CACHE
            const movedFeatureIds = updatedFeatures
                .map(feature => this.getFeatureId(feature))
                .filter(id => id !== null);
            
            this.selectionManager.notifyMultipleGeometryChanges(movedFeatureIds);

            // Trigger final update
            this.selectionManager.updateSelectedFeatures();
        }

        // Reset state
        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;
    }

    // ===== FEATURE CALCULATION =====

    calculateOffsetsOptimized(features, referencePoint) {
        const offsets = new Map();

        for (const feature of features) {
            const featureId = this.getFeatureId(feature);
            if (featureId !== null) {
                const offset = this.calculateOffsetForFeature(feature, referencePoint);
                offsets.set(featureId, {
                    feature: feature,
                    source: feature.properties ? feature.properties.source : 'draw',
                    offset: offset
                });
            }
        }

        return offsets;
    }

    calculateOffsetForFeature(feature, referencePoint) {
        const source = feature.properties ? feature.properties.source : 'draw';
        const coords = feature.geometry.coordinates;

        // Handle special cases first
        if (source === 'circle' || source === 'ellipse') {
            let center = feature.properties.center;
            if (typeof center === 'string') {
                center = JSON.parse(center);
            }
            return [
                center[0] - referencePoint.lng,
                center[1] - referencePoint.lat
            ];
        }

        // Handle geometry types efficiently
        switch (feature.geometry.type) {
            case "Point":
                return [
                    coords[0] - referencePoint.lng,
                    coords[1] - referencePoint.lat
                ];

            case "LineString":
                return [
                    coords[0][0] - referencePoint.lng,
                    coords[0][1] - referencePoint.lat
                ];

            case "Polygon":
                return [
                    coords[0][0][0] - referencePoint.lng,
                    coords[0][0][1] - referencePoint.lat
                ];

            case "MultiLineString":
                return [
                    coords[0][0][0] - referencePoint.lng,
                    coords[0][0][1] - referencePoint.lat
                ];

            case "MultiPolygon":
                return [
                    coords[0][0][0][0] - referencePoint.lng,
                    coords[0][0][0][1] - referencePoint.lat
                ];

            default:
                console.error("Unsupported geometry type:", feature.geometry.type);
                return [0, 0];
        }
    }

    batchUpdateFeatures(features, dx, dy, newPos) {
        const updatedFeatures = new Array(features.length);

        for (let i = 0; i < features.length; i++) {
            const feature = features[i];
            const featureId = this.getFeatureId(feature);
            
            if (featureId !== null && this.offsets.has(featureId)) {
                const { offset } = this.offsets.get(featureId);

                // Reuse coordinate object
                this.coordsPool.lng = newPos.lng + offset[0];
                this.coordsPool.lat = newPos.lat + offset[1];

                updatedFeatures[i] = this.calculateUpdatedFeatureOptimized(feature, dx, dy, this.coordsPool);
            } else {
                updatedFeatures[i] = feature; // Keep original if no offset found
            }
        }

        return updatedFeatures;
    }

    calculateUpdatedFeatureOptimized(feature, dx, dy, newCoords) {
        const source = feature.properties ? feature.properties.source : 'draw';
        const strategy = this.featureUpdateStrategies[source];

        if (!strategy) {
            console.error('Unknown source type:', source);
            return feature;
        }

        const updatedFeature = strategy(feature, dx, dy, newCoords);
        return { ...updatedFeature, source };
    }

    /**
     * UPDATED: Compatible with refactored SelectionManager
     * Replaces the obsolete updateSelectionManagerFeaturesOptimized method
     */
    updateSelectionManagerFeatures(updatedFeatures) {
        // Clear existing selections using new API
        this.selectionManager.selectedFeatures.clear();
        
        // Add updated features using new API
        for (const feature of updatedFeatures) {
            const type = feature.properties?.source || 'draw';
            const featureId = this.getFeatureId(feature);
            if (featureId) {
                const key = `${type}:${featureId}`;
                this.selectionManager.selectedFeatures.set(key, { type, feature });
            }
        }
    }

    // ===== FEATURE UPDATE STRATEGIES =====

    updateDrawFeature(feature, dx, dy, newCoords) {
        return this.uiManager.translateFeature(feature, dx, dy);
    }

    updatePointFeature(feature, dx, dy, newCoords) {
        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: [newCoords.lng, newCoords.lat]
            }
        };
    }

    updateVisibilityFeature(feature, dx, dy, newCoords) {
        // Calcular novo centro baseado no movimento
        let oldCenter = feature.properties.center || [
            feature.geometry.coordinates[0][0][0][0],
            feature.geometry.coordinates[0][0][0][1]
        ];
        if (typeof oldCenter === 'string') {
                oldCenter = JSON.parse(oldCenter);
        }

        const newCenter = [oldCenter[0]+dx, oldCenter[1]+dy];

        // Preservar propriedades originais
        const updatedProperties = {
            ...feature.properties,
            center: newCenter
        };

        // Para drag, apenas atualizar propriedades sem recalcular geometria
        // A geometria será recalculada quando o drag terminar
        const updatedFeature = {
            ...feature,
            properties: updatedProperties
        };

        return updatedFeature;
    }

    updateMilitarySymbolFeature(feature, dx, dy, newCoords) {
        // Military symbols are point features, so just update the coordinates
        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: [newCoords.lng, newCoords.lat]
            }
        };
    }

    updateCircleFeature(feature, dx, dy, newCoords) {
        const newCenter = [newCoords.lng, newCoords.lat];
        const circleControl = this.getControl('circle');

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: circleControl.generateCircleGeometry(
                newCenter,
                feature.properties.radius
            )
        };

        // Atualizar X marks se disponível
        if (circleControl && typeof circleControl.updateXMarks === 'function') {
            circleControl.updateXMarks();
        }

        return updatedFeature;
    }

    updateEllipseFeature(feature, dx, dy, newCoords) {
        const newCenter = [newCoords.lng, newCoords.lat];
        const ellipseControl = this.getControl('ellipse');

        return {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: ellipseControl.generateEllipseGeometry(
                newCenter,
                feature.properties.majorRadius,
                feature.properties.minorRadius,
                feature.properties.bearing
            )
        };
    }

    /**
     * STANDARDIZED: Updated signature to match other update methods
     */
    updateOccupiedFrontFeature(feature, dx, dy, newCoords) {
        // Atualizar pontos de controle base
        if (feature.properties.baseCoordinates && Array.isArray(feature.properties.baseCoordinates)) {
            const newBaseCoords = feature.properties.baseCoordinates.map(coord => [
                coord[0] + dx,
                coord[1] + dy
            ]);

            feature.properties.baseCoordinates = newBaseCoords;

            // Recalcular geometria usando o método do controle
            const occupiedFrontControl = this.getControl('occupied_front');
            if (occupiedFrontControl) {
                feature.geometry = occupiedFrontControl.createOccupiedFrontGeometry(newBaseCoords);
            }
        }

        return feature;
    }

    updateArrowFeature(feature, dx, dy, newCoords) {
        // Garantir que baseCoordinates é um array
        let baseCoordinates = feature.properties.baseCoordinates;

        if (typeof baseCoordinates === 'string') {
            try {
                baseCoordinates = JSON.parse(baseCoordinates);
            } catch (e) {
                console.error('Erro ao parsear baseCoordinates:', e);
                return feature;
            }
        }

        if (!Array.isArray(baseCoordinates)) {
            console.error('baseCoordinates não é um array válido:', baseCoordinates);
            return feature;
        }

        // Converter delta de coordenadas para coordenadas geográficas
        const newBaseCoordinates = baseCoordinates.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        const updatedProperties = {
            ...feature.properties,
            baseCoordinates: newBaseCoordinates
        };

        const arrowControl = this.getControl('arrow');
        return {
            ...feature,
            properties: updatedProperties,
            geometry: arrowControl.generateArrowGeometry(updatedProperties)
        };
    }

    updateBoundaryFeature(feature, dx, dy, newCoords) {
        // Garantir que baseCoordinates é um array
        let baseCoordinates = feature.properties.baseCoordinates;

        if (typeof baseCoordinates === 'string') {
            try {
                baseCoordinates = JSON.parse(baseCoordinates);
            } catch (e) {
                console.error('Erro ao parsear baseCoordinates:', e);
                return feature;
            }
        }

        if (!Array.isArray(baseCoordinates)) {
            console.error('baseCoordinates não é um array válido:', baseCoordinates);
            return feature;
        }

        // Converter delta de coordenadas para coordenadas geográficas
        const newBaseCoordinates = baseCoordinates.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        const updatedProperties = {
            ...feature.properties,
            baseCoordinates: newBaseCoordinates
        };

        const boundaryControl = this.getControl('boundary');
        const updatedFeature = {
            ...feature,
            properties: updatedProperties,
            geometry: boundaryControl.generateBoundaryGeometry(updatedProperties)
        };

        // Atualizar features dependentes também
        if (boundaryControl && typeof boundaryControl.updateDependentFeatures === 'function') {
            // Atualizar círculos e textos
            requestAnimationFrame(() => {
                boundaryControl.updateDependentFeatures(updatedFeature);
            });
        }

        return updatedFeature;
    }

    // ===== UTILITY METHODS =====

    setCursorStyle(style) {
        this.map.getCanvas().style.cursor = style;
    }

    // Cleanup method for proper disposal
    destroy() {
        this.cleanupDragListeners();

        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        // Clear references
        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;
        this.featureUpdateStrategies = null;
    }
}

export default MoveHandler;
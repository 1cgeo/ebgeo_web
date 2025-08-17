// Path: js\controls_sig\tool_manager\move_handler.js
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
        this.featureManagersMap = this.initializeFeatureManagers();

        this.setupEventListeners();
    }

    initializeFeatureStrategies() {
        return {
            'draw': this.updateDrawFeature.bind(this),
            'los': this.updateDrawFeature.bind(this),
            'visibility': this.updateDrawFeature.bind(this),
            'text': this.updatePointFeature.bind(this),
            'image': this.updatePointFeature.bind(this),
            'circle': this.updateCircleFeature.bind(this),
            'ellipse': this.updateEllipseFeature.bind(this),
            'arrow': this.updateArrowFeature.bind(this),
            'boundary': this.updateBoundaryFeature.bind(this),
            'occupied_front': this.updateOccupiedFrontFeature.bind(this),
            'military_symbols': this.updateMilitarySymbolFeature.bind(this)
        };
    }

    initializeFeatureManagers() {
        return {
            'draw': 'selectedDrawFeatures',
            'text': 'selectedTextFeatures',
            'image': 'selectedImageFeatures',
            'los': 'selectedLOSFeatures',
            'visibility': 'selectedVisibilityFeatures',
            'circle': 'selectedCircleFeatures',
            'ellipse': 'selectedEllipseFeatures',
            'arrow': 'selectedArrowFeatures',
            'boundary': 'selectedBoundaryFeatures',
            'occupied_front': 'selectedOccupiedFrontFeatures',
            'military_symbols': 'selectedMilitarySymbolFeatures'
        };
    }

    setupEventListeners() {
        this.map.on('mousedown', this.onMouseDown.bind(this));
    }

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
        const validSources = ['los', 'visibility', 'mapbox-gl-draw-cold', 'mapbox-gl-draw-hot', 'texts', 'images', 'circles', 'ellipses', 'arrows', 'boundarys', 'occupied_fronts', 'military_symbols'];
        const filteredFeatures = clickedFeatures.filter(feature => validSources.includes(feature.source));

        // Check for edit handles (maplibredraw midpoint/vertex handles)
        const hasMaplibreDrawEditHandles = filteredFeatures.some(feature =>
            feature.properties.mode === 'direct_select' ||
            feature.properties.meta === 'midpoint' ||
            feature.properties.meta === 'vertex'
        );

        // Check for custom tool edit handles (circle, ellipse, etc.)
        const hasCustomToolEditHandles = this.hasCustomEditHandles(clickedFeatures);

        if (filteredFeatures.length === 0 || hasMaplibreDrawEditHandles || hasCustomToolEditHandles) {
            return;
        }

        // Check if any selected feature is in editing mode (should not be draggable)
        const hasFeatureInEditingMode = this.hasSelectedFeatureInEditingMode(allSelectedFeatures);
        if (hasFeatureInEditingMode) {
            return;
        }

        // Check if clicked feature is selected (using loose equality for type coercion)
        const isFeatureSelected = filteredFeatures.some(clickedFeature => {
            clickedFeature.id = clickedFeature.id || clickedFeature.properties.id;
            return allSelectedFeatures.some(f => f.id == clickedFeature.id);
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

    // Check for custom tool edit handles (circle, ellipse, etc.)
    hasCustomEditHandles(clickedFeatures) {
        // Check for circle edit handles
        const hasCircleEditHandles = clickedFeatures.some(feature =>
            feature.source === 'circle-edit-handles' &&
            (feature.properties.user_isEditingHandle ||
                feature.properties.meta === 'vertex' ||
                feature.properties.mode === 'circle_editing')
        );

        // Check for ellipse edit handles (similar pattern)
        const hasEllipseEditHandles = clickedFeatures.some(feature =>
            feature.source === 'ellipse-edit-handles' &&
            (feature.properties.user_isEditingHandle ||
                feature.properties.meta === 'vertex' ||
                feature.properties.mode === 'ellipse_editing')
        );

        const hasArrowEditHandles = clickedFeatures.some(feature =>
            feature.source === 'arrow-edit-handles' &&
            (feature.properties.user_isEditingHandle ||
                feature.properties.meta === 'vertex' ||
                feature.properties.mode === 'arrow_editing')
        );

        const hasBoundaryEditHandles = clickedFeatures.some(feature =>
            feature.source === 'boundary-edit-handles' &&
            (feature.properties.handleType === 'vertex' ||
                feature.properties.handleType === 'midpoint' ||
                feature.properties.handleType === 'symbol' ||
                feature.properties.handleType === 'size' ||
                feature.properties.mode === 'boundary_editing')
        );

        const hasOccupiedFrontEditHandles = clickedFeatures.some(feature =>
            feature.source === 'occupied-front-edit-handles' &&
            (feature.properties.user_isEditingHandle ||
                feature.properties.meta === 'vertex' ||
                feature.properties.mode === 'occupied_front_editing')
        );

        return hasCircleEditHandles || hasEllipseEditHandles || hasArrowEditHandles || hasBoundaryEditHandles || hasOccupiedFrontEditHandles;
    }

    // Check if any selected feature is in editing mode
    hasSelectedFeatureInEditingMode(selectedFeatures) {
        for (const feature of selectedFeatures) {
            const source = feature.properties.source;

            // Check circle editing mode
            if (source === 'circle' &&
                this.selectionManager.circleControl &&
                this.selectionManager.circleControl.isEditingMode &&
                this.selectionManager.circleControl.isEditingMode()) {
                return true;
            }

            // Check ellipse editing mode
            if (source === 'ellipse' &&
                this.selectionManager.ellipseControl &&
                this.selectionManager.ellipseControl.isEditingMode &&
                this.selectionManager.ellipseControl.isEditingMode()) {
                return true;
            }

            if (source === 'arrow' &&
                this.selectionManager.arrowControl &&
                this.selectionManager.arrowControl.isEditingMode &&
                this.selectionManager.arrowControl.isEditingMode()) {
                return true;
            }

            if (source === 'boundary' &&
                this.selectionManager.boundaryControl &&
                this.selectionManager.boundaryControl.isEditingMode &&
                this.selectionManager.boundaryControl.isEditingMode()) {
                return true;
            }

            if (source === 'occupied_front' &&
                this.selectionManager.occupiedFrontControl &&
                this.selectionManager.occupiedFrontControl.isEditingMode &&
                this.selectionManager.occupiedFrontControl.isEditingMode()) {
                return true;
            }

            // Military symbols don't have editing mode, so no check needed

            // Check if feature has editing mode properties
            if (feature.properties.mode &&
                (feature.properties.mode.includes('editing') ||
                    feature.properties.mode === 'direct_select')) {
                return true;
            }
        }

        return false;
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

            // Update selection manager efficiently
            this.updateSelectionManagerFeaturesOptimized(updatedFeatures);

            // Trigger final update
            this.selectionManager.updateSelectedFeatures();
        }

        // Reset state
        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;
    }

    calculateOffsetsOptimized(features, referencePoint) {
        const offsets = new Map();

        for (const feature of features) {
            const offset = this.calculateOffsetForFeature(feature, referencePoint);
            offsets.set(feature.id, {
                feature: feature,
                source: feature.properties.source,
                offset: offset
            });
        }

        return offsets;
    }

    calculateOffsetForFeature(feature, referencePoint) {
        const source = feature.properties.source;
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
            const { offset } = this.offsets.get(feature.id);

            // Reuse coordinate object
            this.coordsPool.lng = newPos.lng + offset[0];
            this.coordsPool.lat = newPos.lat + offset[1];

            updatedFeatures[i] = this.calculateUpdatedFeatureOptimized(feature, dx, dy, this.coordsPool);
        }

        return updatedFeatures;
    }

    calculateUpdatedFeatureOptimized(feature, dx, dy, newCoords) {
        const source = feature.properties.source;
        const strategy = this.featureUpdateStrategies[source];

        if (!strategy) {
            console.error('Unknown source type:', source);
            return feature;
        }

        const updatedFeature = strategy(feature, dx, dy, newCoords);
        return { ...updatedFeature, source };
    }

    // Feature update strategies
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

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: this.selectionManager.circleControl.generateCircleGeometry(
                newCenter,
                feature.properties.radius
            )
        };

        // Atualizar X marks se disponível
        if (this.selectionManager.circleControl &&
            typeof this.selectionManager.circleControl.updateXMarks === 'function') {
            this.selectionManager.circleControl.updateXMarks();
        }

        return updatedFeature;
    }

    updateEllipseFeature(feature, dx, dy, newCoords) {
        const newCenter = [newCoords.lng, newCoords.lat];
        return {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: this.selectionManager.ellipseControl.generateEllipseGeometry(
                newCenter,
                feature.properties.majorRadius,
                feature.properties.minorRadius,
                feature.properties.bearing
            )
        };
    }

    updateOccupiedFrontFeature = (feature, deltaLng, deltaLat) => {
        // Atualizar pontos de controle base
        if (feature.properties.baseCoordinates && Array.isArray(feature.properties.baseCoordinates)) {
            const newBaseCoords = feature.properties.baseCoordinates.map(coord => [
                coord[0] + deltaLng,
                coord[1] + deltaLat
            ]);

            feature.properties.baseCoordinates = newBaseCoords;

            // Recalcular geometria usando o método do controle
            if (this.selectionManager.occupiedFrontControl) {
                feature.geometry = this.selectionManager.occupiedFrontControl.createOccupiedFrontGeometry(newBaseCoords);
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

        return {
            ...feature,
            properties: updatedProperties,
            geometry: this.selectionManager.arrowControl.generateArrowGeometry(updatedProperties)
        };
    }

    updateBoundaryFeature = (feature, dx, dy, newCoords) => {
    // ✅ NOVO: Seguindo padrão da arrow tool
    
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

    const updatedFeature = {
        ...feature,
        properties: updatedProperties,
        geometry: this.selectionManager.boundaryControl.generateBoundaryGeometry(updatedProperties)
    };

    // ✅ NOVO: Atualizar features dependentes também
    if (this.selectionManager.boundaryControl && 
        typeof this.selectionManager.boundaryControl.updateDependentFeatures === 'function') {
        
        // Atualizar círculos e textos
        requestAnimationFrame(() => {
            this.selectionManager.boundaryControl.updateDependentFeatures(updatedFeature);
        });
    }

    return updatedFeature;
}
    updateSelectionManagerFeaturesOptimized(updatedFeatures) {
        // Initialize all maps at once
        const featureMaps = {
            selectedDrawFeatures: new Map(),
            selectedTextFeatures: new Map(),
            selectedImageFeatures: new Map(),
            selectedLOSFeatures: new Map(),
            selectedVisibilityFeatures: new Map(),
            selectedCircleFeatures: new Map(),
            selectedEllipseFeatures: new Map(),
            selectedArrowFeatures: new Map(),
            selectedBoundaryFeatures: new Map(),
            selectedOccupiedFrontFeatures: new Map(),
            selectedMilitarySymbolFeatures: new Map()
        };

        // Batch process all features
        for (const feature of updatedFeatures) {
            const source = feature.properties.source;
            const mapKey = this.featureManagersMap[source];

            if (mapKey) {
                featureMaps[mapKey].set(feature.id, feature);
            }
        }

        // Update selection manager in one batch
        Object.assign(this.selectionManager, featureMaps);
    }

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
        this.featureManagersMap = null;
    }
}

export default MoveHandler;
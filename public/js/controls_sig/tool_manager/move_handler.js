// Path: js\controls_sig\tool_manager\move_handler.js

// ===== CONFIGURATION =====

/**
 * Valid sources for drag operations
 */
const VALID_DRAG_SOURCES = [
    'los', 'visibility', 'points', 'lines', 'polygons',
    'texts', 'images', 'circles', 'ellipses', 'arrows', 'boundarys',
    'occupied_fronts', 'military_symbols', 'rectangles', 'brushes'
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
     * Generic method to get control by type - compatible with refactored SelectionManager
     */
    getControl(type) {
        return this.selectionManager.controls.get(type);
    }

    // ===== INITIALIZATION =====

    initializeFeatureStrategies() {
        return {
            'point': this.updatePointFeature.bind(this),
            'line': this.updateLineFeature.bind(this),
            'polygon': this.updatePolygonFeature.bind(this),
            'los': this.updateLOSFeature.bind(this),
            'visibility': this.updateVisibilityFeature.bind(this),
            'text': this.updateTextFeature.bind(this),
            'image': this.updateImageFeature.bind(this),
            'rectangle': this.updateRectangleFeature.bind(this),
            'circle': this.updateCircleFeature.bind(this),
            'ellipse': this.updateEllipseFeature.bind(this),
            'arrow': this.updateArrowFeature.bind(this),
            'brush': this.updateBrushFeature.bind(this),
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

        // Early exit if clicking on ANY edit handle
        if (filteredFeatures.length === 0 || this.isClickOnEditHandle(e.point)) {
            return; // Let edit handlers take control
        }

        // Check if clicked feature is selected
        const isFeatureSelected = filteredFeatures.some(clickedFeature => {
            const clickedFeatureId = clickedFeature.properties.id;

            if (clickedFeatureId === null) {
                return false;
            }

            return allSelectedFeatures.some(selectedFeature => {
                const selectedFeatureId = selectedFeature.properties.id;
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

    //Single method to check edit handles
    isClickOnEditHandle = (point) => {
        const features = this.map.queryRenderedFeatures(point);

        const customHandleSources = [
            'line-edit-handles', 'polygon-edit-handles',
            'circle-edit-handles', 'ellipse-edit-handles',
            'arrow-edit-handles', 'boundary-edit-handles',
            'occupied-front-edit-handles', 'rectangle-edit-handles'
        ];

        return features.some(f =>
            customHandleSources.includes(f.source) &&
            f.properties.user_isEditingHandle
        );
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

    onMouseUp = async (e) => {
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

            await this.selectionManager.updateSelectedFeatures();

            this.selectionManager.updateProfile();
            this.syncEditHandlesForMovedFeatures(updatedFeatures);

            // ✅ FIXED: Update measurements after drag
            this.updateMeasurementsForMovedFeatures(updatedFeatures);
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
            const featureId = feature.properties.id;
            if (featureId !== null) {
                const offset = this.calculateOffsetForFeature(feature, referencePoint);
                offsets.set(featureId, {
                    feature: feature,
                    source: feature.properties.source,
                    offset: offset
                });
            }
        }

        return offsets;
    }

    calculateOffsetForFeature(feature, referencePoint) {
        const source = feature.properties.source;
        const coords = feature.geometry.coordinates;

        // Handle special cases first
        if (source === 'circle' || source === 'ellipse' || source === 'rectangle') {
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
            const featureId = feature.properties.id;

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
        const source = feature.properties.source;
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
            const type = feature.properties.source;
            const featureId = feature.properties.id;
            if (featureId) {
                const key = `${type}:${featureId}`;
                this.selectionManager.selectedFeatures.set(key, { type, feature });
            }
        }
    }

    /**
     * ✅ NEW: Update measurements for moved features
     */
    updateMeasurementsForMovedFeatures = (updatedFeatures) => {
        for (const feature of updatedFeatures) {
            const type = feature.properties.source;

            // Update line measurements
            if (type === 'line' && feature.properties.measure) {
                const lineControl = this.getControl('line');
                if (lineControl && lineControl.updateFeatureMeasurement) {
                    lineControl.updateFeatureMeasurement(feature);
                }
            }

            // Update polygon measurements  
            else if (type === 'polygon' && feature.properties.measure) {
                const polygonControl = this.getControl('polygon');
                if (polygonControl && polygonControl.updateFeatureMeasurement) {
                    polygonControl.updateFeatureMeasurement(feature);
                }
            }

            // Update LOS measurements (if they have measure property)
            else if (type === 'los' && feature.properties.measure) {
                const losControl = this.getControl('los');
                if (losControl && losControl.updateFeatureMeasurement) {
                    losControl.updateFeatureMeasurement(feature);
                }
            }
        }
    }

    /**
     * Identifica controls que podem ter features selecionadas que foram movidas
     */
    syncEditHandlesForMovedFeatures = (updatedFeatures) => {
        // Identificar quais controls podem ter features selecionadas que foram movidas
        const controlsToSync = ['circle', 'ellipse', 'arrow', 'boundary', 'occupied_front', 'los', 'rectangle', 'line', 'polygon'];

        controlsToSync.forEach(controlType => {
            const control = this.getControl(controlType);

            // Verificar se control existe e tem método de sincronização
            if (control && typeof control.syncEditHandlesAfterDrag === 'function') {
                // Verificar se alguma feature movida pertence a este control
                const movedFeatures = updatedFeatures.filter(feature =>
                    feature.properties?.source === controlType
                );

                if (movedFeatures.length > 0) {
                    control.syncEditHandlesAfterDrag(movedFeatures);
                }
            }
        });
    }

    // ===== FEATURE UPDATE STRATEGIES =====

    updateLOSFeature(feature, dx, dy, newCoords) {
        return this.uiManager.translateFeature(feature, dx, dy);
    }

    updateTextFeature(feature, dx, dy, newCoords) {
        const updatedFeature = {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: [newCoords.lng, newCoords.lat]
            }
        };

        const textControl = this.getControl('text');
        if (textControl && textControl.calculateSelectionBoxGeometry) {
            updatedFeature.properties.selectionBox = textControl.calculateSelectionBoxGeometry(
                updatedFeature.geometry.coordinates,
                updatedFeature.properties.text,
                updatedFeature.properties.size,
                updatedFeature.properties.rotation,
                updatedFeature.properties.createdAtZoom
            );
        }

        return updatedFeature;
    }

    updateImageFeature(feature, dx, dy, newCoords) {
        const updatedFeature = {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: [newCoords.lng, newCoords.lat]
            }
        };

        // Recalcular selectionBox usando createdAtZoom
        const imageControl = this.getControl('image');
        if (imageControl && imageControl.calculateSelectionBoxGeometry) {
            updatedFeature.properties.selectionBox = imageControl.calculateSelectionBoxGeometry(
                updatedFeature.geometry.coordinates,
                updatedFeature.properties.width,
                updatedFeature.properties.height,
                updatedFeature.properties.size,
                updatedFeature.properties.rotation,
                updatedFeature.properties.createdAtZoom
            );
        }

        return updatedFeature;
    }

    // NOVO - Método específico para Military Symbol  
    updateMilitarySymbolFeature(feature, dx, dy, newCoords) {
        const updatedFeature = {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: [newCoords.lng, newCoords.lat]
            }
        };

        // Recalcular selectionBox usando createdAtZoom
        const militaryControl = this.getControl('military_symbol');
        if (militaryControl && militaryControl.calculateSelectionBoxGeometry) {
            updatedFeature.properties.selectionBox = militaryControl.calculateSelectionBoxGeometry(
                updatedFeature.geometry.coordinates,
                updatedFeature.properties.width,
                updatedFeature.properties.height,
                updatedFeature.properties.size,
                updatedFeature.properties.rotation,
                updatedFeature.properties.createdAtZoom
            );
        }

        return updatedFeature;
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

    updateLineFeature(feature, dx, dy, newCoords) {
        // Move all points in the LineString by the same delta
        let baseCoordinates = feature.properties.baseCoordinates || feature.geometry.coordinates;

        if (typeof baseCoordinates === 'string') {
            try {
                baseCoordinates = JSON.parse(baseCoordinates);
            } catch (e) {
                baseCoordinates = feature.geometry.coordinates;
            }
        }

        const newBaseCoordinates = baseCoordinates.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        return {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newBaseCoordinates
            },
            geometry: {
                type: 'LineString',
                coordinates: newBaseCoordinates
            }
        };
    }

    updatePolygonFeature(feature, dx, dy, newCoords) {
        // Move all points in the polygon by the same delta
        let baseCoordinates = feature.properties.baseCoordinates;

        if (typeof baseCoordinates === 'string') {
            try {
                baseCoordinates = JSON.parse(baseCoordinates);
            } catch (e) {
                // Fallback: use geometry coordinates without closing point
                const coords = feature.geometry.coordinates[0];
                baseCoordinates = coords.slice(0, -1); // Remove closing point
            }
        }

        if (!Array.isArray(baseCoordinates)) {
            // Another fallback
            const coords = feature.geometry.coordinates[0];
            baseCoordinates = coords.slice(0, -1); // Remove closing point
        }

        const newBaseCoordinates = baseCoordinates.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        // Create closed coordinates for geometry
        const closedCoordinates = [...newBaseCoordinates, newBaseCoordinates[0]];

        return {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newBaseCoordinates
            },
            geometry: {
                type: 'Polygon',
                coordinates: [closedCoordinates]
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

        const newCenter = [oldCenter[0] + dx, oldCenter[1] + dy];

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

    updateRectangleFeature(feature, dx, dy, newCoords) {
        // ✅ newCoords é a NOVA POSIÇÃO DO CENTER, não delta!
        const newCenter = [newCoords.lng, newCoords.lat];

        // ✅ Manter dimensões, mas recalcular corners baseado no novo center
        const width = feature.properties.width;
        const height = feature.properties.height;

        // ✅ Recalcular corners baseado no novo center + dimensões preservadas
        const halfWidthDeg = (width / 2) / 111320 / Math.cos(newCenter[1] * Math.PI / 180);
        const halfHeightDeg = (height / 2) / 111320;

        const newCorner1 = [newCenter[0] - halfWidthDeg, newCenter[1] + halfHeightDeg];
        const newCorner2 = [newCenter[0] + halfWidthDeg, newCenter[1] - halfHeightDeg];

        const rectangleControl = this.getControl('rectangle');

        return {
            ...feature,
            properties: {
                ...feature.properties,
                corner1: newCorner1,    // ✅ Atualizar corners baseado no novo center
                corner2: newCorner2,    // ✅ Atualizar corners baseado no novo center
                center: newCenter,      // ✅ Centro vem do drag
                width: width,           // ✅ Preservar dimensões
                height: height          // ✅ Preservar dimensões
            },
            geometry: rectangleControl.generateRectangleGeometry(newCorner1, newCorner2)
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

    updateBrushFeature(feature, dx, dy, newCoords) {
        // Move all points in the LineString by the same delta
        const movedCoordinates = feature.geometry.coordinates.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: movedCoordinates
            }
        };
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
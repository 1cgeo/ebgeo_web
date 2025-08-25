// Path: js/controls_sig/draw_tools/add_polygon_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { IDUtils } from '../id_utils.js';

class AddPolygonControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;

        // Core state
        this.isActive = false;
        this.selectedFeature = null;
        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;

        // RAF system
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;
        this.geometryDebounceTimer = null;
    }

    static DEFAULT_PROPERTIES = {
        color: '#fbb03b',
        opacity: 0.5,
        size: 3,
        outlinecolor: '#fbb03b',
        measure: false,
        source: 'polygon',
        baseCoordinates: [],
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl polygon-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "polygon-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_polygon_black.svg" alt="POLYGON" />';
        button.title = 'Adicionar polígono (A)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupBaseEventListeners();
        this.updateButtonAppearance();

        return this.container;
    }

    onRemove = () => {
        try {
            if (this.selectionManager && this.selectionManager.uiManager) {
                this.selectionManager.uiManager.removeControl(this.container);
            }
            this.deactivate();
            this.removeAllEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddPolygonControl:', error);
            throw error;
        }
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
    }

    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.clearPreview();
        this.deselectFeature();
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_polygon_red.svg' :
            './images/icon_polygon_black.svg';
        $(`#polygon-tool`).html(`<img class="icon-sig-tool" src="${iconSrc}" alt="POLYGON" />`);
    }

    // ===== SIMPLIFIED STATE MANAGEMENT =====

    selectFeature = (feature) => {
        this.selectedFeature = feature;
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupHoverListeners();
    }

    deselectFeature = () => {
        this.selectedFeature = null;
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;
        this.activeHandle = null;
        this.activeHandleType = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    // ===== HOVER SYSTEM FOR DYNAMIC CURSOR =====

    setupHoverListeners = () => {
        this.map.on('mousemove', this.onHoverMove);
    }

    removeHoverListeners = () => {
        this.map.off('mousemove', this.onHoverMove);
    }

    onHoverMove = (e) => {
        if (!this.selectedFeature) return;

        const features = this.map.queryRenderedFeatures(e.point);
        const hasHandle = this.hasHandleAtPoint(features);
        const hasFeature = this.hasSelectedFeatureAtPoint(features);

        if (hasHandle) {
            this.map.getCanvas().style.cursor = 'crosshair';
        } else if (hasFeature) {
            this.map.getCanvas().style.cursor = 'move';
        } else {
            this.map.getCanvas().style.cursor = '';
        }
    }

    hasHandleAtPoint = (features) => {
        return features.some(f =>
            f.source === 'polygon-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        if (!this.selectedFeature) return false;
        return features.some(f =>
            f.source === 'polygons' &&
            f.properties.id === this.selectedFeature.properties.id
        );
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        this.selectFeature(feature);
    }

    onFeatureDeselected = (feature) => {
        const featureId = feature.properties.id;
        if (this.selectedFeature && this.selectedFeature.properties.id === featureId) {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        if (this.selectedFeature) {
            this.deselectFeature();
        }
    }

    // Interface for move_handler integration
    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (featureId) => {
        return this.selectedFeature && this.selectedFeature.properties.id === featureId;
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        if (this.selectedFeature && !this.isDraggingHandle) {
            const updatedFeature = movedFeatures.find(f =>
                f.properties.id === this.selectedFeature.properties.id
            );
            if (updatedFeature) {
                this.selectedFeature = updatedFeature;
                this.createEditHandles(updatedFeature);
            }
        }
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Coordenadas inválidas para polígono');
            return;
        }

        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);

        if (this.drawPoints.length === 1) {
            this.map.on('mousemove', this.handlePreviewMouseMove);
        }
    }

    handleDoubleClick = (e) => {
        if (!this.isActive) return;

        if (this.drawPoints.length > 0) {
            this.drawPoints.pop();
        }

        if (this.drawPoints.length >= 3) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            this.createFeature();
            this.toolManager.deactivateCurrentTool();
        } else {
            this.stopDrawing();
        }
        e.preventDefault();
    }

    // RAF-based preview
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];
            this.lastPreviewPoints = [...this.drawPoints, this.lastPreviewPosition];

            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
            }
        }
    }

    performPreviewUpdate = () => {
        if (!this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        // Edit mode - updating polygon geometry via handle drag
        if (this.isDraggingHandle && this.selectedFeature && this.activeHandleType) {
            this.updateGeometryFromHandle(this.activeHandleType, this.lastPreviewPosition);
        }
        else if (this.lastPreviewPoints && this.lastPreviewPoints.length >= 1) {
            const debounceTime = 8; // 8ms for polygon preview

            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                let previewGeometry;

                if (this.lastPreviewPoints.length === 1) {
                    // ✅ NEW: Show first point as a point feature
                    previewGeometry = {
                        type: 'Point',
                        coordinates: this.lastPreviewPoints[0]
                    };
                } else if (this.lastPreviewPoints.length === 2) {
                    // ✅ NEW: Show line between first two points
                    previewGeometry = {
                        type: 'LineString',
                        coordinates: this.lastPreviewPoints
                    };
                } else {
                    // ✅ EXISTING: Show polygon preview (3+ points)
                    // Auto-close polygon for preview
                    const closedCoords = [...this.lastPreviewPoints, this.lastPreviewPoints[0]];
                    
                    previewGeometry = {
                        type: 'Polygon',
                        coordinates: [closedCoords]
                    };
                }

                this.showPreview(previewGeometry);
            }, debounceTime);
        }

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('polygon-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {}
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('polygon-feedback')) {
            this.map.getSource('polygon-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    stopDrawing = () => {
        this.drawPoints = [];
        this.clearPreview();
        this.toolManager.deactivateCurrentTool();
    }

    createFeature = async () => {
        if (this.drawPoints.length < 3) {
            this.showValidationError('Polígono deve ter pelo menos 3 pontos');
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('polygon', this.map);

        // Auto-close the polygon
        const closedCoords = [...this.drawPoints, this.drawPoints[0]];

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddPolygonControl.DEFAULT_PROPERTIES,
                baseCoordinates: [...this.drawPoints], // Store without closing point
                id: featureId,
                nome: featureName
            },
            geometry: {
                type: 'Polygon',
                coordinates: [closedCoords] // Geometry with closing point
            }
        };

        try {
            await addFeature('polygons', feature);

            const data = JSON.parse(JSON.stringify(this.map.getSource('polygons')._data));
            data.features.push(feature);
            this.map.getSource('polygons').setData(data);

            this.drawPoints = [];
            this.toolManager.setActiveTool(null);

            this.selectionManager.toggleFeatureSelection('polygon', feature.properties.id, feature);
            this.selectionManager.updateUI();

            this.updateFeatureMeasurement(feature);
        } catch (error) {
            console.error('Erro ao criar polígono:', error);
        }
    }

    showValidationError = (message) => {
        alert(message);
        this.drawPoints = [];
        this.clearPreview();
    }

    // ===== MEASUREMENT SYSTEM =====

    updateFeatureMeasurement = (feature) => {
        this.removeFeatureMeasurement(feature.properties.id);

        if (feature.properties.measure) {
            const polygon = turf.polygon(feature.geometry.coordinates);
            const areaInSquareMeters = turf.area(polygon);
            const areaFormatted = areaInSquareMeters >= 100000
                ? `${(areaInSquareMeters / 1000000).toFixed(2)} km²`
                : `${areaInSquareMeters.toFixed(2)} m²`;
            const centroid = turf.centroid(polygon);
            this.displayMeasurement(centroid.geometry.coordinates, areaFormatted, feature.properties.id);
        }
    }

    removeFeatureMeasurement = (featureId) => {
        const measurementLabel = document.querySelector(`.measurement-label[data-feature-id="${featureId}"]`);
        if (measurementLabel) {
            measurementLabel.remove();
        }
    }

    displayMeasurement = (coordinates, measurement, featureId) => {
        const markerElement = this.createMeasurementLabel(measurement, featureId);
        new maplibregl.Marker({ element: markerElement })
            .setLngLat(coordinates)
            .addTo(this.map);
    }

    createMeasurementLabel = (measurement, featureId) => {
        const label = document.createElement('div');
        label.className = 'measurement-label';
        label.innerText = measurement;
        label.dataset.featureId = featureId;

        label.style.cssText = `
            background-color: rgba(255, 255, 255, 0.9);
            border: 2px solid #508D4E;
            border-radius: 6px;
            padding: 6px 10px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 12px;
            font-weight: bold;
            color: #333;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            white-space: nowrap;
            pointer-events: none;
            user-select: none;
            transform: translate(-50%, -50%);
            z-index: 1000;
        `;

        return label;
    }

    // ===== EDITING MODE: HANDLE SYSTEM =====

    createEditHandles = (feature) => {
        if (!feature || !feature.properties) {
            console.warn('Feature inválida para criar handles:', feature);
            return;
        }

        // Show selected feature
        this.map.getSource('polygon-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {}
        });

        // Create handles
        this.createEditHandlesOnly(feature);
    }

    clearEditHandles = () => {
        this.map.getSource('polygon-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });

        this.map.getSource('polygon-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    createEditHandlesOnly = (feature) => {
        const handles = [];
        const coords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);

        if (coords.length < 3) {
            console.warn('Coordenadas insuficientes para criar handles:', coords);
            return;
        }

        // Vertex handles (red) - use baseCoordinates without closing point
        coords.forEach((coord, index) => {
            const handleId = `polygon-handle-${feature.properties.id}-vertex-${index}`;

            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: { type: 'Point', coordinates: coord },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: `vertex-${index}`,
                    index: index,
                    featureId: feature.properties.id,
                    mode: 'polygon_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        // Midpoint handles (orange) - including between last and first point
        for (let i = 0; i < coords.length; i++) {
            const nextIndex = (i + 1) % coords.length;
            const midpoint = turf.midpoint(turf.point(coords[i]), turf.point(coords[nextIndex]));
            const handleId = `polygon-handle-${feature.properties.id}-midpoint-${i}`;

            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: midpoint.geometry,
                properties: {
                    role: 'handle',
                    handleType: 'midpoint',
                    handleId: `midpoint-${i}`,
                    insertIndex: nextIndex,
                    featureId: feature.properties.id,
                    mode: 'polygon_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        this.map.getSource('polygon-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    // ===== EDITING MODE: HANDLE INTERACTION =====

    setupEditEventListeners = () => {
        this.map.on('mousedown', this.onEditMouseDown);
        this.map.on('mousemove', this.onEditMouseMove);
        this.map.on('mouseup', this.onEditMouseUp);
    }

    removeEditEventListeners = () => {
        this.map.off('mousedown', this.onEditMouseDown);
        this.map.off('mousemove', this.onEditMouseMove);
        this.map.off('mouseup', this.onEditMouseUp);
    }

    onEditMouseDown = (e) => {
        if (!this.selectedFeature) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['polygon-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandle = handle;
            this.activeHandleType = handle.properties.handleId;
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
            e.preventDefault();
        }
    }

    onEditMouseMove = (e) => {
        if (!this.isDraggingHandle || !this.selectedFeature) return;

        this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    onEditMouseUp = () => {
        if (this.isDraggingHandle && this.selectedFeature && this.activeHandleType) {
            // Apply changes to selected feature
            this.updateGeometryFromHandle(this.activeHandleType, this.lastPreviewPosition);

            // Update final feature geometry with auto-closing
            const closedCoords = [...this.selectedFeature.properties.baseCoordinates, this.selectedFeature.properties.baseCoordinates[0]];
            this.selectedFeature.geometry = {
                type: 'Polygon',
                coordinates: [closedCoords]
            };

            this.forceUpdateMainSource(this.selectedFeature);
            this.createEditHandles(this.selectedFeature);
            this.updateSelectionAfterEdit();
            this.updateUIAfterEdit();
            this.saveFeatureChanges(this.selectedFeature);
            this.updateFeatureMeasurement(this.selectedFeature);
        }

        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateGeometryFromHandle = (handleId, newPosition) => {
        if (!this.selectedFeature) return;

        let coords = this.normalizeBaseCoordinates(this.selectedFeature.properties.baseCoordinates);

        if (coords.length < 3) {
            console.warn('Coordenadas insuficientes para atualizar geometria:', coords);
            return;
        }

        coords = [...coords]; // Create copy

        const debounceTime = 8; // 8ms for polygon

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            if (handleId.startsWith('vertex-')) {
                // Move existing vertex
                const index = parseInt(handleId.split('-')[1]);
                coords[index] = newPosition;
                this.selectedFeature.properties.baseCoordinates = coords;
            } else if (handleId.startsWith('midpoint-')) {
                // Add new vertex
                const insertIndex = parseInt(handleId.split('-')[1]) + 1;
                if (insertIndex >= coords.length) {
                    coords.push(newPosition); // Insert at end for closing edge
                } else {
                    coords.splice(insertIndex, 0, newPosition);
                }
                this.selectedFeature.properties.baseCoordinates = coords;

                // Convert handle from midpoint → vertex
                if (this.activeHandle && this.activeHandle.properties) {
                    this.activeHandle.properties.handleType = 'vertex';
                    this.activeHandle.properties.handleId = `vertex-${insertIndex >= coords.length ? coords.length - 1 : insertIndex}`;
                    this.activeHandleType = this.activeHandle.properties.handleId;
                }
            }

            // Show preview with auto-closing
            const closedCoords = [...this.selectedFeature.properties.baseCoordinates, this.selectedFeature.properties.baseCoordinates[0]];
            const previewGeometry = {
                type: 'Polygon',
                coordinates: [closedCoords]
            };
            this.showEditPreview(previewGeometry);
        }, debounceTime);
    }

    showEditPreview = (geometry) => {
        this.map.getSource('polygon-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {}
        });

        this.createEditHandlesOnly(this.selectedFeature);
    }

    // ===== EVENT LISTENER MANAGEMENT =====

    setupBaseEventListeners = () => {
        this.map.on('dblclick', this.handleDoubleClick);
    }

    removeAllEventListeners = () => {
        this.map.off('dblclick', this.handleDoubleClick);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
    }

    // ===== UTILITY METHODS =====

    normalizeBaseCoordinates = (baseCoordinates) => {
        if (typeof baseCoordinates === 'string') {
            try {
                return JSON.parse(baseCoordinates);
            } catch (e) {
                console.error('Erro ao parsear baseCoordinates:', e);
                return [];
            }
        }

        if (!Array.isArray(baseCoordinates)) {
            console.warn('baseCoordinates não é um array:', baseCoordinates);
            return [];
        }

        return baseCoordinates;
    }

    forceUpdateMainSource = (feature) => {
        if (!feature || !this.map) {
            console.warn('forceUpdateMainSource: feature ou map inválido');
            return;
        }

        const source = this.map.getSource('polygons');
        if (!source) {
            console.warn('forceUpdateMainSource: source polygons não encontrado');
            return;
        }

        try {
            const data = JSON.parse(JSON.stringify(source._data));
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);

            if (sourceFeature) {
                sourceFeature.properties = { ...feature.properties };
                sourceFeature.geometry = { ...feature.geometry };
                source.setData(data);
            }
        } catch (error) {
            console.error('Erro em forceUpdateMainSource:', error);
        }
    }

    updateSelectionAfterEdit = () => {
        const featureId = this.selectedFeature.properties.id;
        const type = this.selectedFeature.properties.source;
        const key = `${type}:${featureId}`;

        this.selectionManager.selectedFeatures.set(key, {
            type,
            feature: this.selectedFeature
        });
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('polygons', feature);
        } catch (error) {
            console.error('Erro ao salvar alterações do polígono:', error);
        }
    }

    // ===== SELECTION SYSTEM INTERFACE METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('polygons')._data));

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // If changing geometry properties, recalculate geometry
                if (['baseCoordinates'].includes(property)) {
                    const closedCoords = [...sourceFeature.properties.baseCoordinates, sourceFeature.properties.baseCoordinates[0]];
                    sourceFeature.geometry = {
                        type: 'Polygon',
                        coordinates: [closedCoords]
                    };
                    feature.geometry = sourceFeature.geometry;
                }
            }
        }

        this.map.getSource('polygons').setData(data);

        // Update measurement if property changed
        if (property === 'measure') {
            features.forEach(f => {
                if (value) {
                    this.updateFeatureMeasurement(f);
                } else {
                    this.removeFeatureMeasurement(f.properties.id);
                }
            });
        }

        // Update handles if in editing mode
        if (this.selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(this.selectedFeature);
        }
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('polygons')._data));

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('polygons', featureToUpdate);
                    }
                }
            }

            this.map.getSource('polygons').setData(data);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('polygons')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('polygons', featureToSave);
                }
            }
        }
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.outlinecolor !== initialProperties.outlinecolor ||
            feature.properties.measure !== initialProperties.measure ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            const closedCoords = [...f.properties.baseCoordinates, f.properties.baseCoordinates[0]];
            f.geometry = {
                type: 'Polygon',
                coordinates: [closedCoords]
            };
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                this.removeFeatureMeasurement(featureId);
                await removeFeature('polygons', featureId);
            } catch (error) {
                console.error(`Error removing polygon ${featureId}:`, error);
            }
        }

        // Remove from map source (visual)
        const data = JSON.parse(JSON.stringify(this.map.getSource('polygons')._data));
        const idsToDelete = new Set(features.map(f => String(f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
        this.map.getSource('polygons').setData(data);
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddPolygonControl.DEFAULT_PROPERTIES, properties);
    }
}

export default AddPolygonControl;
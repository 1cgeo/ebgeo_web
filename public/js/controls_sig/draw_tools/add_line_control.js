// Path: js/controls_sig/draw_tools/add_line_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { getTerrainElevation } from '../terrain_control.js';
import { IDUtils } from '../id_utils.js';

class AddLineControl {
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
        opacity: 0.7,
        size: 7,
        lineStyle: 'solid',
        measure: false,
        profile: false,
        profileData: null,
        source: 'line',
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
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl line-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "line-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_line_black.svg" alt="LINE" />';
        button.title = 'Adicionar linha (L)';
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
            console.error('Error removing AddLineControl:', error);
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
            './images/icon_line_red.svg' :
            './images/icon_line_black.svg';
        $(`#line-tool`).html(`<img class="icon-sig-tool" src="${iconSrc}" alt="LINE" />`);
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
            f.source === 'line-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        if (!this.selectedFeature) return false;
        return features.some(f =>
            f.source === 'lines' &&
            f.properties.id === this.selectedFeature.properties.id
        );
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        if (feature?.properties?.baseCoordinates) {
            const normalizedCoords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
            if (normalizedCoords && normalizedCoords.length >= 2) {
                feature.properties.baseCoordinates = normalizedCoords;
                this.selectFeature(feature);
            } else {
                console.warn('Cannot select line feature - invalid coordinates:', feature.properties.baseCoordinates);
                return;
            }
        } else {
            this.selectFeature(feature);
        }
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

    // ✅ CORREÇÃO 3: Validação defensiva no syncEditHandlesAfterDrag
    syncEditHandlesAfterDrag = (movedFeatures) => {
        if (this.selectedFeature && !this.isDraggingHandle) {
            const updatedFeature = movedFeatures.find(f =>
                f.properties.id === this.selectedFeature.properties.id
            );
            if (updatedFeature) {
                const normalizedCoords = this.normalizeBaseCoordinates(updatedFeature.properties.baseCoordinates);
                if (normalizedCoords && normalizedCoords.length >= 2) {
                    updatedFeature.properties.baseCoordinates = normalizedCoords;
                    this.selectedFeature = updatedFeature;
                    this.createEditHandles(updatedFeature);
                } else {
                    console.warn('Invalid coordinates in moved feature, keeping current selection');
                }
            }
        }
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Coordenadas inválidas para linha');
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

        if (this.drawPoints.length >= 2) {
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

    // CONSOLIDATED RAF
    performPreviewUpdate = () => {
        if (!this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        // Edit mode - updating line geometry via handle drag
        if (this.isDraggingHandle && this.selectedFeature && this.activeHandleType) {
            this.updateGeometryFromHandle(this.activeHandleType, this.lastPreviewPosition);
        }
        // Drawing mode - showing line preview
        else if (this.lastPreviewPoints && this.lastPreviewPoints.length >= 2) {
            const debounceTime = 8; // 8ms for line preview

            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                const previewGeometry = {
                    type: 'LineString',
                    coordinates: this.lastPreviewPoints
                };

                this.showPreview(previewGeometry);
            }, debounceTime);
        }

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('line-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {}
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('line-feedback')) {
            this.map.getSource('line-feedback').setData({
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
        if (this.drawPoints.length < 2) {
            this.showValidationError('Linha deve ter pelo menos 2 pontos');
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('line', this.map);
        let coord = [...this.drawPoints]
        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddLineControl.DEFAULT_PROPERTIES,
                baseCoordinates: coord,
                id: featureId,
                nome: featureName,
                profileData: JSON.stringify(await this.calculateProfile(coord))
            },
            geometry: {
                type: 'LineString',
                coordinates: coord
            }
        };

        try {
            await addFeature('lines', feature);

            const data = JSON.parse(JSON.stringify(this.map.getSource('lines')._data));
            data.features.push(feature);
            this.map.getSource('lines').setData(data);

            this.drawPoints = [];
            this.toolManager.setActiveTool(null);

            this.selectionManager.toggleFeatureSelection('line', feature.properties.id, feature);
            this.selectionManager.updateUI();

            this.updateFeatureMeasurement(feature);
        } catch (error) {
            console.error('Erro ao criar linha:', error);
        }
    }

    showValidationError = (message) => {
        alert(message);
        this.drawPoints = [];
        this.clearPreview();
    }

    // ===== PROFILE CALCULATION =====

    async calculateProfile(coordinates) {
        const line = turf.lineString(coordinates);
        const length = turf.length(line, { units: 'meters' });
        const steps = 25;
        const stepLength = length / steps;

        let profileData = [];

        for (let i = 0; i <= steps; i++) {
            const point = turf.along(line, i * stepLength, { units: 'meters' });
            const elevation = await getTerrainElevation(this.map, point.geometry.coordinates);
            profileData.push({
                distance: i * stepLength,
                elevation: elevation
            });
        }

        return profileData;
    }

    // ===== MEASUREMENT SYSTEM =====

    updateFeatureMeasurement = (feature) => {
        this.removeFeatureMeasurement(feature.properties.id);

        if (feature.properties.measure) {
            const line = turf.lineString(feature.geometry.coordinates);
            const lengthInMeters = turf.length(line, { units: 'meters' });
            const lengthFormatted = lengthInMeters >= 1000
                ? `${(lengthInMeters / 1000).toFixed(2)} km`
                : `${lengthInMeters.toFixed(2)} m`;
            const midpoint = turf.along(line, lengthInMeters / 2, { units: 'meters' });
            this.displayMeasurement(midpoint.geometry.coordinates, lengthFormatted, feature.properties.id);
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
        this.map.getSource('line-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {}
        });

        // Create handles
        this.createEditHandlesOnly(feature);
    }

    clearEditHandles = () => {
        this.map.getSource('line-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });

        this.map.getSource('line-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    createEditHandlesOnly = (feature) => {
        const handles = [];
        const coords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);

        if (!coords || coords.length < 2) {
            console.warn('Coordenadas insuficientes para criar handles:', coords);
            return;
        }

        // Vertex handles (red)
        coords.forEach((coord, index) => {
            const handleId = `line-handle-${feature.properties.id}-vertex-${index}`;

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
                    mode: 'line_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        // Midpoint handles (orange)
        for (let i = 0; i < coords.length - 1; i++) {
            const midpoint = turf.midpoint(turf.point(coords[i]), turf.point(coords[i + 1]));
            const handleId = `line-handle-${feature.properties.id}-midpoint-${i}`;

            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: midpoint.geometry,
                properties: {
                    role: 'handle',
                    handleType: 'midpoint',
                    handleId: `midpoint-${i}`,
                    insertIndex: i + 1,
                    featureId: feature.properties.id,
                    mode: 'line_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        this.map.getSource('line-edit-handles').setData({
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
            layers: ['line-edit-handles-layer']
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

            // Update final feature
            this.selectedFeature.geometry = {
                type: 'LineString',
                coordinates: this.selectedFeature.properties.baseCoordinates
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

        if (!coords || coords.length < 2) {
            console.warn('Coordenadas insuficientes para atualizar geometria:', coords);
            return;
        }

        coords = [...coords]; // Create copy

        const debounceTime = 8; // 8ms for line

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
                coords.splice(insertIndex, 0, newPosition);
                this.selectedFeature.properties.baseCoordinates = coords;

                // Convert handle from midpoint → vertex
                if (this.activeHandle && this.activeHandle.properties) {
                    this.activeHandle.properties.handleType = 'vertex';
                    this.activeHandle.properties.handleId = `vertex-${insertIndex}`;
                    this.activeHandleType = `vertex-${insertIndex}`;
                }
            }

            // Show preview
            const previewGeometry = {
                type: 'LineString',
                coordinates: this.selectedFeature.properties.baseCoordinates
            };
            this.showEditPreview(previewGeometry);
        }, debounceTime);
    }

    showEditPreview = (geometry) => {
        this.map.getSource('line-feedback').setData({
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

    normalizeBaseCoordinates = (coords) => {
        // ✅ NORMALIZAÇÃO ROBUSTA - Handle múltiplos formatos
        if (!coords) {
            console.warn('baseCoordinates is null or undefined');
            return null;
        }

        // Se já é um array válido, retornar
        if (Array.isArray(coords)) {
            // Validar que é realmente um array de coordenadas válidas
            const isValidArray = coords.every(coord =>
                Array.isArray(coord) &&
                coord.length >= 2 &&
                typeof coord[0] === 'number' &&
                typeof coord[1] === 'number' &&
                !isNaN(coord[0]) &&
                !isNaN(coord[1])
            );
            
            if (isValidArray) {
                return coords;
            } else {
                console.warn('baseCoordinates array contains invalid coordinates:', coords);
                return null;
            }
        }

        // Se é string, tentar fazer parse
        if (typeof coords === 'string') {
            try {
                const parsed = JSON.parse(coords);
                if (Array.isArray(parsed)) {
                    // Recursão para validar o resultado parseado
                    return this.normalizeBaseCoordinates(parsed);
                } else {
                    console.warn('Parsed baseCoordinates is not an array:', parsed);
                    return null;
                }
            } catch (e) {
                console.error('Erro ao parsear baseCoordinates string:', coords, e);
                return null;
            }
        }

        console.warn('baseCoordinates is neither array nor string:', typeof coords, coords);
        return null;
    }

    forceUpdateMainSource = (feature) => {
        if (!feature || !this.map) {
            console.warn('forceUpdateMainSource: feature ou map inválido');
            return;
        }

        const source = this.map.getSource('lines');
        if (!source) {
            console.warn('forceUpdateMainSource: source lines não encontrado');
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
            await updateFeature('lines', feature);
        } catch (error) {
            console.error('Erro ao salvar alterações da linha:', error);
        }
    }

    // ===== SELECTION SYSTEM INTERFACE METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('lines')._data));

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // If changing geometry properties, recalculate geometry
                if (['baseCoordinates'].includes(property)) {
                    sourceFeature.geometry = {
                        type: 'LineString',
                        coordinates: sourceFeature.properties.baseCoordinates
                    };
                    feature.geometry = sourceFeature.geometry;
                }
            }
        }

        this.map.getSource('lines').setData(data);

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

        // Update profile if needed
        if (property === 'profile' && this.selectionManager) {
            this.selectionManager.updateProfile();
        }

        // Update handles if in editing mode
        if (this.selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(this.selectedFeature);
        }
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('lines')._data));

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
                        
                        // Update profile if geometry changed
                        if (!onlyUpdateProperties && feature.geometry.type === 'LineString') {
                            featureToUpdate.properties.profileData = JSON.stringify(
                                await this.calculateProfile(feature.geometry.coordinates)
                            );
                        }
                        
                        await updateFeature('lines', featureToUpdate);
                    }
                }
            }

            this.map.getSource('lines').setData(data);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('lines')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('lines', featureToSave);
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
            feature.properties.lineStyle !== initialProperties.lineStyle ||
            feature.properties.measure !== initialProperties.measure ||
            feature.properties.profile !== initialProperties.profile ||
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
            f.geometry = {
                type: 'LineString',
                coordinates: f.properties.baseCoordinates
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
                await removeFeature('lines', featureId);
            } catch (error) {
                console.error(`Error removing line ${featureId}:`, error);
            }
        }

        // Remove from map source (visual)
        const data = JSON.parse(JSON.stringify(this.map.getSource('lines')._data));
        const idsToDelete = new Set(features.map(f => String(f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
        this.map.getSource('lines').setData(data);
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddLineControl.DEFAULT_PROPERTIES, properties);
    }
}

export default AddLineControl;
// Path: js\controls_sig\rectangle_tool\add_rectangle_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { IDUtils } from '../id_utils.js';

class AddRectangleControl {
    constructor(toolManager) {
        this.map = toolManager.map;
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;

        this.isActive = false;
        this.drawPoints = [];
        this.selectedFeature = null;
        this.isDraggingHandle = false;
        this.activeHandleType = null;

        // RAF optimization
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        fillColor: '#3f4fb5',
        lineWidth: 2,
        opacity: 0.5,
        source: 'rectangle',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl rectangle-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "rectangle-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_rectangle_black.svg" alt="RECTANGLE" />';
        button.title = 'Adicionar retângulo (R)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupBaseEventListeners();
        this.updateButtonAppearance();

        return this.container;
    }

    onRemove = () => {
        try {
            this.selectionManager.uiManager.removeControl(this.container);
            this.deactivate();
            this.removeAllEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddRectangleControl:', error);
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
            './images/icon_rectangle_red.svg' :
            './images/icon_rectangle_black.svg';
        $("#rectangle-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="RECTANGLE" />`);
    }

    // ===== STATE MANAGEMENT =====

    selectFeature = (feature) => {
        this.selectedFeature = feature;
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupHoverListeners();
    }

    deselectFeature = () => {
        this.selectedFeature = null;
        this.isDraggingHandle = false;
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
        this.lastPreviewCenter = null;
        this.activeHandleType = null;
        
        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    // ===== HOVER SYSTEM =====

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
            f.source === 'rectangle-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        if (!this.selectedFeature) return false;
        return features.some(f =>
            f.source === 'rectangles' &&
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
            console.warn('Coordenadas inválidas para retângulo');
            return;
        }

        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);

        if (this.drawPoints.length === 1) {
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length === 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            this.lastPreviewCenter = this.drawPoints[0];
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

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

        // Edit mode
        if (this.isDraggingHandle && this.selectedFeature) {
            this.updateRectanglePreview(this.lastPreviewPosition);
        }
        // Drawing mode
        else if (this.drawPoints.length === 1 && this.lastPreviewCenter) {
            const corner1 = this.lastPreviewCenter;
            const corner2 = this.lastPreviewPosition;
            
            const { center, width, height } = this.calculateDimensionsFromCorners(corner1, corner2);
            
            if (width >= 10 && height >= 10) { // Minimum 10 meters
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const previewGeometry = this.generateRectangleGeometry(corner1, corner2);
                    this.showPreview(previewGeometry);
                }, 8);
            }
        }

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('rectangle-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                lineColor: AddRectangleControl.DEFAULT_PROPERTIES.lineColor,
                fillColor: AddRectangleControl.DEFAULT_PROPERTIES.fillColor,
                opacity: 0.5
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        this.map.getSource('rectangle-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    createFeature = async () => {
        const corner1 = this.drawPoints[0];
        const corner2 = this.drawPoints[1];

        const { center, width, height } = this.calculateDimensionsFromCorners(corner1, corner2);

        if (width < 10 || height < 10) {
            alert('Dimensões mínimas: 10 metros');
            this.drawPoints = [];
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('rectangle', this.map);

        // ✅ COORDINATE TRACKING - Store corners as primary data
        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddRectangleControl.DEFAULT_PROPERTIES,
                corner1: corner1,           // Primary data - exact corner coordinates
                corner2: corner2,           // Primary data - exact corner coordinates  
                center: center,             // Derived data - calculated from corners
                width: width,               // Derived data - calculated from corners
                height: height,             // Derived data - calculated from corners
                id: featureId,
                nome: featureName
            },
            geometry: this.generateRectangleGeometry(corner1, corner2)
        };

        try {
            await addFeature('rectangles', feature);

            const data = JSON.parse(JSON.stringify(this.map.getSource('rectangles')._data));
            data.features.push(feature);
            this.map.getSource('rectangles').setData(data);

            this.drawPoints = [];
            this.toolManager.setActiveTool(null);
            this.selectionManager.toggleFeatureSelection('rectangle', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Erro ao criar retângulo:', error);
        }
    }

    // ===== EDIT HANDLES =====

    createEditHandles = (feature) => {
        const corner1 = this.normalizeCorner(feature.properties.corner1);
        const corner2 = this.normalizeCorner(feature.properties.corner2);
        
        if (!corner1 || !corner2) {
            console.error('Não foi possível criar handles - corners inválidos');
            return;
        }

        // ✅ DIRECT MAPPING - Handle positions = exact corner coordinates
        const handles = [
            {
                type: 'Feature',
                id: `rectangle-handle-${feature.properties.id}-corner1`,
                geometry: {
                    type: 'Point',
                    coordinates: corner1
                },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: 'corner1',           // Maps directly to properties.corner1
                    featureId: feature.properties.id,
                    mode: 'rectangle_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            },
            {
                type: 'Feature',
                id: `rectangle-handle-${feature.properties.id}-corner2`,
                geometry: {
                    type: 'Point',
                    coordinates: corner2
                },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: 'corner2',           // Maps directly to properties.corner2
                    featureId: feature.properties.id,
                    mode: 'rectangle_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            }
        ];

        // Show selection feedback
        this.map.getSource('rectangle-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        // Show handles
        this.map.getSource('rectangle-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('rectangle-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('rectangle-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    // ===== EDIT INTERACTION =====

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
            layers: ['rectangle-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandleType = handle.properties.handleId; // 'corner1' or 'corner2'
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

    onEditMouseUp = (e) => {
        if (this.isDraggingHandle && this.selectedFeature) {
            if (this.lastPreviewPosition && this.activeHandleType) {
                // ✅ DIRECT CORNER UPDATE - No complex calculations
                const newCorner1 = this.activeHandleType === 'corner1' ? 
                    this.lastPreviewPosition : 
                    this.normalizeCorner(this.selectedFeature.properties.corner1);

                const newCorner2 = this.activeHandleType === 'corner2' ? 
                    this.lastPreviewPosition : 
                    this.normalizeCorner(this.selectedFeature.properties.corner2);

                // Validate minimum dimensions
                const { width, height } = this.calculateDimensionsFromCorners(newCorner1, newCorner2);

                if (width > 10 && height > 10) {
                    // Update properties with new corners
                    this.selectedFeature.properties.corner1 = newCorner1;
                    this.selectedFeature.properties.corner2 = newCorner2;
                    
                    // Update derived properties
                    const { center } = this.calculateDimensionsFromCorners(newCorner1, newCorner2);
                    this.selectedFeature.properties.center = center;
                    this.selectedFeature.properties.width = width;
                    this.selectedFeature.properties.height = height;

                    // Regenerate geometry
                    this.selectedFeature.geometry = this.generateRectangleGeometry(newCorner1, newCorner2);

                    this.forceUpdateMainSource(this.selectedFeature);
                    this.createEditHandles(this.selectedFeature);
                    this.updateSelectionAfterEdit();
                    this.updateUIAfterEdit();
                    this.saveFeatureChanges(this.selectedFeature);
                }
            }
        }

        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateRectanglePreview = (newPosition) => {
        if (!this.selectedFeature || !this.activeHandleType) return;

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            // ✅ SIMPLE PREVIEW - Direct corner substitution
            const corner1 = this.activeHandleType === 'corner1' ? 
                newPosition : 
                this.normalizeCorner(this.selectedFeature.properties.corner1);

            const corner2 = this.activeHandleType === 'corner2' ? 
                newPosition : 
                this.normalizeCorner(this.selectedFeature.properties.corner2);

            const { width, height } = this.calculateDimensionsFromCorners(corner1, corner2);

            if (width > 10 && height > 10) {
                const previewGeometry = this.generateRectangleGeometry(corner1, corner2);
                this.showEditPreview(previewGeometry, corner1, corner2);
            }
        }, 8);
    }

    showEditPreview = (geometry, corner1, corner2) => {
        // Show updated selection feedback
        this.map.getSource('rectangle-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                ...this.selectedFeature.properties,
                isSelected: true
            }
        });

        // ✅ ACCURATE HANDLES - Exact corner positions
        const handles = [
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: corner1 },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: 'corner1',
                    user_isEditingHandle: true
                }
            },
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: corner2 },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: 'corner2',
                    user_isEditingHandle: true
                }
            }
        ];

        this.map.getSource('rectangle-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    // ===== GEOMETRY CALCULATIONS (CORNER-BASED) =====

    // ✅ SIMPLIFIED - Direct corner-to-geometry conversion
    generateRectangleGeometry = (corner1, corner2) => {
        // Create rectangle from any two opposite corners
        const minLng = Math.min(corner1[0], corner2[0]);
        const maxLng = Math.max(corner1[0], corner2[0]);
        const minLat = Math.min(corner1[1], corner2[1]);
        const maxLat = Math.max(corner1[1], corner2[1]);
        
        return {
            type: 'Polygon',
            coordinates: [[
                [minLng, maxLat], // top-left
                [maxLng, maxLat], // top-right
                [maxLng, minLat], // bottom-right
                [minLng, minLat], // bottom-left
                [minLng, maxLat]  // close polygon
            ]]
        };
    }

    // ✅ UTILITY - Calculate dimensions from any two corners
    calculateDimensionsFromCorners = (corner1, corner2) => {
        // Calculate center
        const center = [
            (corner1[0] + corner2[0]) / 2,
            (corner1[1] + corner2[1]) / 2
        ];
        
        // Calculate dimensions in meters using same method as circle
        const width = this.calculateDistance([corner1[0], center[1]], [corner2[0], center[1]]);
        const height = this.calculateDistance([center[0], corner1[1]], [center[0], corner2[1]]);
        
        return { center, width, height };
    }

    // ✅ KEEP - Same distance calculation as circle (tested)
    calculateDistance = (point1, point2) => {
        const R = 6371000; // Earth radius in meters
        const lat1Rad = point1[1] * Math.PI / 180;
        const lat2Rad = point2[1] * Math.PI / 180;
        const deltaLatRad = (point2[1] - point1[1]) * Math.PI / 180;
        const deltaLngRad = (point2[0] - point1[0]) * Math.PI / 180;

        const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    // ===== UTILITY METHODS =====

    normalizeCorner(corner) {
        if (typeof corner === 'string') {
            try {
                corner = JSON.parse(corner);
            } catch (e) {
                console.error('Erro ao parsear corner:', corner, e);
                return null;
            }
        }

        if (!Array.isArray(corner) || corner.length < 2) {
            console.error('Corner inválido:', corner);
            return null;
        }

        return corner;
    }

    // ✅ BACKWARD COMPATIBILITY - For center-based operations (drag)
    normalizeCenter(center) {
        if (typeof center === 'string') {
            try {
                center = JSON.parse(center);
            } catch (e) {
                console.error('Erro ao parsear center:', center, e);
                return null;
            }
        }

        if (!Array.isArray(center) || center.length < 2) {
            console.error('Center inválido:', center);
            return null;
        }

        return center;
    }

    setupBaseEventListeners = () => {
        // Base listeners setup if needed
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
    }

    forceUpdateMainSource = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('rectangles')._data));
        const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('rectangles').setData(data);
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
            await updateFeature('rectangles', feature);
        } catch (error) {
            console.error('Erro ao salvar mudanças:', error);
        }
    }

    // ===== SELECTION SYSTEM INTERFACE =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('rectangles')._data));

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // ✅ CORNER-BASED RECALCULATION - Only if corners change
                if (['corner1', 'corner2'].includes(property)) {
                    const corner1 = sourceFeature.properties.corner1;
                    const corner2 = sourceFeature.properties.corner2;
                    
                    // Recalculate derived properties
                    const { center, width, height } = this.calculateDimensionsFromCorners(corner1, corner2);
                    sourceFeature.properties.center = center;
                    sourceFeature.properties.width = width;
                    sourceFeature.properties.height = height;
                    feature.properties.center = center;
                    feature.properties.width = width;
                    feature.properties.height = height;

                    // Regenerate geometry
                    const newGeometry = this.generateRectangleGeometry(corner1, corner2);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        this.map.getSource('rectangles').setData(data);

        if (this.selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(this.selectedFeature);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('rectangles')._data;
        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('rectangles', featureToSave);
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            const initialProps = initialPropertiesMap.get(f.properties.id);
            Object.assign(f.properties, initialProps);
            f.geometry = this.generateRectangleGeometry(
                initialProps.corner1,
                initialProps.corner2
            );
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('rectangles', featureId);
                const data = JSON.parse(JSON.stringify(this.map.getSource('rectangles')._data));
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('rectangles').setData(data);
            } catch (error) {
                console.error(`Error removing rectangle ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddRectangleControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.width !== initialProperties.width ||
            feature.properties.height !== initialProperties.height ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.corner1) !== JSON.stringify(initialProperties.corner1) ||
            JSON.stringify(feature.properties.corner2) !== JSON.stringify(initialProperties.corner2)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('rectangles')._data));
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
                        await updateFeature('rectangles', featureToUpdate);
                    }
                }
            }

            this.map.getSource('rectangles').setData(data);
        }
    }
}

export default AddRectangleControl;
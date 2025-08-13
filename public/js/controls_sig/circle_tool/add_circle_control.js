// Path: js\controls_sig\circle_tool\add_circle_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddCircleControl {
    constructor(toolManager) {
        this.map = toolManager.map;
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;
        
        // Drawing state
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];
        
        // 3-STATE SYSTEM (template for other tools)
        // 1. deselected: Default state, no special interaction
        // 2. selected: Feature can be dragged via MoveHandler
        // 3. editing: Handle-based editing, feature drag disabled
        this.currentState = 'deselected';
        this.selectedFeature = null;
        
        // Edit mode variables
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
        this.previewFeature = null;
        this.editHandleIds = new Set();
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        fillColor: '#3f4fb5',
        lineWidth: 2,
        opacity: 0.5,
        source: 'circle',
        coordinationPoint: false
    };

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl circle-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "circle-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_circle_black.svg" alt="CIRCLE" />';
        button.title = 'Adicionar círculo (C)';
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
            console.error('Error removing AddCircleControl:', error);
            throw error;
        }
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.drawingMode = 'circle';
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
    }

    deactivate = () => {
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.clearPreview();
        this.forceTransitionToDeselected();
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ? 
            './images/icon_circle_red.svg' : 
            './images/icon_circle_black.svg';
        $("#circle-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="CIRCLE" />`);
    }

    // ===== STATE MANAGEMENT SYSTEM (Template for other tools) =====

    transitionToState = (newState, feature = null) => {
        this.exitCurrentState();
        this.currentState = newState;
        this.selectedFeature = feature;
        
        switch (newState) {
            case 'deselected':
                this.enterDeselectedState();
                break;
            case 'selected':
                this.enterSelectedState(feature);
                break;
            case 'editing':
                this.enterEditingState(feature);
                break;
        }
    }

    exitCurrentState = () => {
        switch (this.currentState) {
            case 'selected':
                this.exitSelectedState();
                break;
            case 'editing':
                this.exitEditingState();
                break;
        }
    }

    forceTransitionToDeselected = () => {
        this.exitCurrentState();
        this.currentState = 'deselected';
        this.selectedFeature = null;
        this.enterDeselectedState();
    }

    // State 1: DESELECTED
    enterDeselectedState = () => {
        this.selectedFeature = null;
    }

    // State 2: SELECTED (uses MoveHandler for drag)
    enterSelectedState = (feature) => {
        this.selectedFeature = feature;
    }

    exitSelectedState = () => {}

    // State 3: EDITING (handle-based editing)
    enterEditingState = (feature) => {
        this.selectedFeature = feature;
        this.createEditHandles(feature);
        this.setupEditEventListeners();
    }

    exitEditingState = () => {
        this.clearEditHandles();
        this.clearEditPreview();
        this.removeEditEventListeners();
        this.resetEditVariables();
    }

    resetEditVariables = () => {
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
        this.previewFeature = null;
        this.editHandleIds.clear();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
        this.clearEditPreview();
    }

    // ===== SELECTION SYSTEM INTEGRATION (Template) =====

    onFeatureSelected = (feature) => {
        const featureId = feature.id || feature.properties.id;
        const isSameFeature = this.selectedFeature && this.selectedFeature.id === featureId;
        
        if (isSameFeature && this.currentState === 'selected') {
            // Same feature selected again: SELECTED → EDITING
            this.transitionToState('editing', feature);
        } else {
            // New feature or first selection: → SELECTED
            this.transitionToState('selected', feature);
        }
    }

    onFeatureDeselected = (feature) => {
        const featureId = feature.id || feature.properties.id;
        
        if (this.selectedFeature && this.selectedFeature.id === featureId) {
            this.transitionToState('deselected');
        }
    }

    onGlobalDeselect = () => {
        if (this.currentState !== 'deselected') {
            this.forceTransitionToDeselected();
        }
    }

    // Interface for move_handler integration
    isEditingMode = () => {
        return this.currentState === 'editing';
    }
    
    hasEditHandle = (featureId) => {
        return this.editHandleIds.has(featureId);
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive) return;
        
        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Coordenadas inválidas para círculo');
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
            const center = this.drawPoints[0];
            const currentPoint = [e.lngLat.lng, e.lngLat.lat];
            const radius = this.calculateDistance(center, currentPoint);
            
            if (radius >= 10) {
                const previewGeometry = this.generateCircleGeometry(center, radius);
                this.showPreview(previewGeometry);
            }
        }
    }

    showPreview = (geometry) => {
        this.map.getSource('circle-preview').setData({
            type: 'Feature',
            geometry: geometry,
            properties: { 
                preview: true,
                lineColor: AddCircleControl.DEFAULT_PROPERTIES.lineColor,
                fillColor: AddCircleControl.DEFAULT_PROPERTIES.fillColor,
                opacity: 0.5
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.map.getSource('circle-preview').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    createFeature = async () => {
        const center = this.drawPoints[0];
        const endPoint = this.drawPoints[1];
        const radius = this.calculateDistance(center, endPoint);

        if (radius < 10) {
            alert('Raio mínimo: 10 metros');
            this.drawPoints = [];
            return;
        }

        const featureId = Date.now().toString();
        const feature = {
            type: 'Feature',
            id: featureId,
            properties: {
                ...AddCircleControl.DEFAULT_PROPERTIES,
                center: center,
                radius: radius,
                id: featureId
            },
            geometry: this.generateCircleGeometry(center, radius)
        };

        try {
            await addFeature('circles', feature);
            
            const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
            data.features.push(feature);
            this.map.getSource('circles').setData(data);
            
            this.updateXMarks();
            
            this.drawPoints = [];
            this.toolManager.setActiveTool(null);
        } catch (error) {
            console.error('Erro ao criar círculo:', error);
        }
    }

    // ===== COORDINATION POINT (X) SYSTEM =====

    /**
     * Gera geometria do X baseada no centro e raio do círculo
     */
    generateXGeometry = (center, radius) => {
        const radiusInDegrees = radius / 111320;
        const cosLat = Math.cos(center[1] * Math.PI / 180);
        
        // Linha diagonal 1: top-left para bottom-right
        const diagonal1 = {
            type: 'LineString',
            coordinates: [
                [
                    center[0] - (radiusInDegrees / cosLat) * Math.cos(Math.PI / 4),
                    center[1] + radiusInDegrees * Math.sin(Math.PI / 4)
                ],
                [
                    center[0] + (radiusInDegrees / cosLat) * Math.cos(Math.PI / 4),
                    center[1] - radiusInDegrees * Math.sin(Math.PI / 4)
                ]
            ]
        };

        // Linha diagonal 2: top-right para bottom-left
        const diagonal2 = {
            type: 'LineString',
            coordinates: [
                [
                    center[0] + (radiusInDegrees / cosLat) * Math.cos(Math.PI / 4),
                    center[1] + radiusInDegrees * Math.sin(Math.PI / 4)
                ],
                [
                    center[0] - (radiusInDegrees / cosLat) * Math.cos(Math.PI / 4),
                    center[1] - radiusInDegrees * Math.sin(Math.PI / 4)
                ]
            ]
        };

        return [diagonal1, diagonal2];
    }

    /**
     * Atualiza todas as marcas X no mapa
     */
    updateXMarks = () => {
        const circleData = this.map.getSource('circles')._data;
        const xFeatures = [];

        circleData.features.forEach(feature => {
            if (feature.properties.coordinationPoint) {
                const center = this.normalizeCenter(feature.properties.center);
                if (center) {
                    const xGeometries = this.generateXGeometry(center, feature.properties.radius);
                    
                    xGeometries.forEach((geometry, index) => {
                        xFeatures.push({
                            type: 'Feature',
                            id: `x-mark-${feature.id}-${index}`,
                            geometry: geometry,
                            properties: {
                                parentId: feature.id,
                                lineColor: feature.properties.lineColor,
                                lineWidth: feature.properties.lineWidth,
                                source: 'circle-x'
                            }
                        });
                    });
                }
            }
        });

        this.map.getSource('circle-x-marks').setData({
            type: 'FeatureCollection',
            features: xFeatures
        });
    }

    // ===== EDITING MODE: HANDLE SYSTEM =====

    createEditHandles = (feature) => {
        const handles = [];
        const center = this.normalizeCenter(feature.properties.center);
        
        if (!center) {
            console.error('Não foi possível criar handles - center inválido');
            return;
        }
        
        const radius = feature.properties.radius;
        const radiusInDegrees = radius / 111320;
        
        // Create radius handle
        const handlePoint = [
            center[0] + (radiusInDegrees / Math.cos(center[1] * Math.PI / 180)),
            center[1]
        ];
        
        const handleId = `circle-handle-${feature.id}-radius`;
        this.editHandleIds.add(handleId);
        
        handles.push({
            type: 'Feature',
            id: handleId,
            geometry: {
                type: 'Point',
                coordinates: handlePoint
            },
            properties: {
                role: 'handle',
                handleType: 'radius',
                handleId: 'radius-main',
                featureId: feature.id,
                mode: 'circle_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Add highlighted feature for editing mode visual
        handles.push({
            ...feature,
            properties: {
                ...feature.properties,
                role: 'selected-feature',
                mode: 'circle_editing'
            }
        });

        this.map.getSource('circle-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.editHandleIds.clear();
        this.map.getSource('circle-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    // Preview system for editing mode
    showEditPreview = (feature, handlePosition) => {
        const handles = [];
        
        // Handle at current position
        const handleId = `circle-handle-${feature.id}-radius`;
        handles.push({
            type: 'Feature',
            id: handleId,
            geometry: {
                type: 'Point',
                coordinates: handlePosition
            },
            properties: {
                role: 'handle',
                handleType: 'radius',
                handleId: 'radius-main',
                featureId: feature.id,
                mode: 'circle_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Preview feature
        handles.push({
            ...feature,
            properties: {
                ...feature.properties,
                role: 'selected-feature',
                mode: 'circle_editing'
            }
        });

        this.map.getSource('circle-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditPreview = () => {
        this.map.getSource('circle-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
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
        if (this.currentState !== 'editing') return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['circle-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            
            if (handle.properties.handleType === 'radius') {
                this.isDraggingHandle = true;
                this.activeHandle = handle;
                this.initialHandlePosition = [e.lngLat.lng, e.lngLat.lat];
                this.map.dragPan.disable();
                this.map.getCanvas().style.cursor = 'grabbing';
                
                this.previewFeature = JSON.parse(JSON.stringify(this.selectedFeature));
                e.preventDefault();
            }
        }
    }

    onEditMouseMove = (e) => {
        if (!this.isDraggingHandle || !this.activeHandle || !this.selectedFeature) return;
        
        if (this.activeHandle.properties.handleType === 'radius') {
            const currentPosition = [e.lngLat.lng, e.lngLat.lat];
            this.updateRadiusPreview(currentPosition);
        }
    }

    onEditMouseUp = () => {
        if (this.isDraggingHandle && this.previewFeature) {
            // Apply preview changes to actual feature
            this.selectedFeature.properties.radius = this.previewFeature.properties.radius;
            this.selectedFeature.geometry = this.previewFeature.geometry;
            
            // Reset drag state first
            this.isDraggingHandle = false;
            this.activeHandle = null;
            this.initialHandlePosition = null;
            const finalFeature = this.selectedFeature;
            this.previewFeature = null;
            this.map.dragPan.enable();
            this.map.getCanvas().style.cursor = '';
            
            this.clearEditPreview();
            this.forceUpdateMainSource(finalFeature);
            this.createEditHandles(finalFeature);
            this.updateSelectionAfterEdit();
            this.updateUIAfterEdit();
            this.saveFeatureChanges(finalFeature);
            
            this.updateXMarks();
        }
    }

    updateRadiusPreview = (newPosition) => {
        if (!this.previewFeature) return;
        
        const center = this.normalizeCenter(this.previewFeature.properties.center);
        
        if (!center) {
            console.error('Center inválido, não é possível atualizar preview');
            return;
        }

        const newRadius = this.calculateDistance(center, newPosition);
        
        if (newRadius > 10) {
            this.previewFeature.properties.radius = newRadius;
            this.previewFeature.geometry = this.generateCircleGeometry(center, newRadius);
            this.showEditPreview(this.previewFeature, newPosition);
        }
    }

    // ===== EVENT LISTENER MANAGEMENT =====

    setupBaseEventListeners = () => {
        this.map.on('mouseenter', 'circle-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'circle-layer', this.handleMouseLeave);
        this.map.on('mouseenter', 'circle-fill-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'circle-fill-layer', this.handleMouseLeave);
    }

    removeAllEventListeners = () => {
        this.map.off('mouseenter', 'circle-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'circle-layer', this.handleMouseLeave);
        this.map.off('mouseenter', 'circle-fill-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'circle-fill-layer', this.handleMouseLeave);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
    }

    handleMouseEnter = () => {
        if (this.currentState === 'deselected') {
            this.map.getCanvas().style.cursor = 'pointer';
        }
    }

    handleMouseLeave = () => {
        if (this.currentState === 'deselected') {
            this.map.getCanvas().style.cursor = '';
        }
    }

    // ===== UTILITY METHODS =====

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

    generateCircleGeometry = (center, radius) => {
        const points = 64;
        const coords = [];
        
        for (let i = 0; i <= points; i++) {
            const angle = (i * 360 / points) * Math.PI / 180;
            const dx = radius * Math.cos(angle);
            const dy = radius * Math.sin(angle);
            
            const lng = center[0] + (dx / 111320) / Math.cos(center[1] * Math.PI / 180);
            const lat = center[1] + (dy / 111320);
            
            coords.push([lng, lat]);
        }

        return {
            type: 'Polygon',
            coordinates: [coords]
        };
    }

    calculateDistance = (point1, point2) => {
        const R = 6371000;
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

    forceUpdateMainSource = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
        const sourceFeature = data.features.find(f => f.id == feature.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('circles').setData(data);
        } else {
            console.error(`Feature ${feature.id} not found in circles source for forced update`);
        }
    }

    updateSelectionAfterEdit = () => {
        this.selectionManager.selectedCircleFeatures.set(this.selectedFeature.id, this.selectedFeature);
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('circles', feature);
        } catch (error) {
            console.error('Erro ao salvar mudanças:', error);
        }
    }

    // ===== SELECTION SYSTEM INTERFACE METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
        
        for (const feature of features) {
            feature.id = feature.id || feature.properties.id;
            
            const sourceFeature = data.features.find(f => f.id == feature.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;
                
                if (property === 'radius' || property === 'center') {
                    const newGeometry = this.generateCircleGeometry(
                        sourceFeature.properties.center, 
                        sourceFeature.properties.radius
                    );
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }
        
        this.map.getSource('circles').setData(data);
        
        if (property === 'coordinationPoint' || property === 'lineColor' || 
            property === 'lineWidth' || property === 'radius' || property === 'center') {
            this.updateXMarks();
        }
        
        if (this.currentState === 'editing' && this.selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(this.selectedFeature);
        }
    }

    hasUnsavedChanges = (features, initialPropertiesMap) => {
        return features.some(feature => {
            const initialProperties = initialPropertiesMap.get(feature.id);
            if (!initialProperties) return false;
            
            return (
                feature.properties.lineColor !== initialProperties.lineColor ||
                feature.properties.fillColor !== initialProperties.fillColor ||
                feature.properties.lineWidth !== initialProperties.lineWidth ||
                feature.properties.opacity !== initialProperties.opacity ||
                feature.properties.radius !== initialProperties.radius ||
                feature.properties.coordinationPoint !== initialProperties.coordinationPoint ||
                JSON.stringify(feature.properties.center) !== JSON.stringify(initialProperties.center)
            );
        });
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            await updateFeature('circles', feature);
        }
        this.updateMapSource();
        this.updateXMarks();
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                feature.properties = { ...originalProps };
                
                feature.geometry = this.generateCircleGeometry(
                    feature.properties.center,
                    feature.properties.radius
                );
                
                await updateFeature('circles', feature);
            }
        }
        this.updateMapSource();
        this.updateXMarks();
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;
        
        // Simple and clean: let the robust store handle verification/retry
        for (const feature of features) {
            try {
                const featureId = feature.id || feature.properties.id;
                await removeFeature('circles', featureId);
                // Remove from map source (visual)
                const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
                const idsToDelete = new Set(features.map(f => String(f.id || f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.id)));
                this.map.getSource('circles').setData(data);
            } catch (error) {
                console.error(`Error removing circle ${featureId}:`, error);
            }
        }
        this.updateXMarks();
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddCircleControl.DEFAULT_PROPERTIES, properties);
    }

    updateMapSource = () => {
        const currentData = this.map.getSource('circles')._data;
        this.map.getSource('circles').setData(currentData);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.radius !== initialProperties.radius ||
            feature.properties.coordinationPoint !== initialProperties.coordinationPoint ||
            JSON.stringify(feature.properties.center) !== JSON.stringify(initialProperties.center)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
            
            for (const feature of features) {
                feature.id = feature.id || feature.properties.id;
                
                const featureIndex = data.features.findIndex(f => f.id == feature.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }
                    
                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ? 
                            data.features[featureIndex] : feature;
                        await updateFeature('circles', featureToUpdate);
                    }
                }
            }
            
            this.map.getSource('circles').setData(data);
            this.updateXMarks();
        }
    }
}

export default AddCircleControl;
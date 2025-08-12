// Path: js\controls_sig\ellipse_tool\add_ellipse_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddEllipseControl {
    constructor(toolManager) {
        this.map = toolManager.map;
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;
        
        // Drawing state
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];
        
        // 3-STATE SYSTEM (same as circle)
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
        source: 'ellipse'
    };

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl ellipse-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "ellipse-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_ellipse_black.svg" alt="ELLIPSE" />';
        button.title = 'Adicionar elipse (E)';
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
            console.error('Error removing AddEllipseControl:', error);
            throw error;
        }
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.drawingMode = 'ellipse';
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
            './images/icon_ellipse_red.svg' : 
            './images/icon_ellipse_black.svg';
        $("#ellipse-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="ELLIPSE" />`);
    }

    // ===== STATE MANAGEMENT SYSTEM (Same as circle) =====

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

    // ===== SELECTION SYSTEM INTEGRATION =====

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
            console.warn('Coordenadas inválidas para elipse');
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
            const majorRadius = this.calculateDistance(center, currentPoint);
            const bearing = this.calculateBearing(center, currentPoint);
            
            if (majorRadius >= 10) {
                const previewGeometry = this.generateEllipseGeometry(
                    center, 
                    majorRadius, 
                    majorRadius * 0.6, // Initial minor radius
                    bearing
                );
                this.showPreview(previewGeometry);
            }
        }
    }

    showPreview = (geometry) => {
        this.map.getSource('ellipse-preview').setData({
            type: 'Feature',
            geometry: geometry,
            properties: { 
                preview: true,
                lineColor: AddEllipseControl.DEFAULT_PROPERTIES.lineColor,
                fillColor: AddEllipseControl.DEFAULT_PROPERTIES.fillColor,
                opacity: 0.5
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.map.getSource('ellipse-preview').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    createFeature = async () => {
        const center = this.drawPoints[0];
        const majorAxisEnd = this.drawPoints[1];
        const majorRadius = this.calculateDistance(center, majorAxisEnd);
        const bearing = this.calculateBearing(center, majorAxisEnd);

        if (majorRadius < 10) {
            alert('Raio mínimo: 10 metros');
            this.drawPoints = [];
            return;
        }

        const featureId = Date.now().toString();
        const feature = {
            type: 'Feature',
            id: featureId,
            properties: {
                ...AddEllipseControl.DEFAULT_PROPERTIES,
                center: center,
                majorRadius: majorRadius,
                minorRadius: majorRadius * 0.6, // Initial minor radius
                bearing: bearing,
                id: featureId
            },
            geometry: this.generateEllipseGeometry(center, majorRadius, majorRadius * 0.6, bearing)
        };

        try {
            await addFeature('ellipses', feature);
            
            const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
            data.features.push(feature);
            this.map.getSource('ellipses').setData(data);
            
            this.drawPoints = [];
            this.toolManager.setActiveTool(null);
        } catch (error) {
            console.error('Erro ao criar elipse:', error);
        }
    }

    // ===== EDITING MODE: HANDLE SYSTEM =====

    createEditHandles = (feature) => {
        const handles = [];
        const center = this.normalizeCenter(feature.properties.center);
        
        if (!center) {
            console.error('Não foi possível criar handles - center inválido');
            return;
        }
        
        const majorRadius = feature.properties.majorRadius;
        const minorRadius = feature.properties.minorRadius;
        const bearing = feature.properties.bearing;

        console.log(`🔧 Creating ellipse handles - majorRadius: ${majorRadius}m, minorRadius: ${minorRadius}m, bearing: ${bearing}°`); // Debug

        // CORRECTED: Major axis handle (red) - same bearing adjustment as geometry
        const adjustedBearing = bearing - 90;
        const bearingRad = adjustedBearing * Math.PI / 180;
        
        // Major axis handle position
        const majorAxisEnd = [
            center[0] + (majorRadius / 111320) * Math.cos(bearingRad + Math.PI/2) / Math.cos(center[1] * Math.PI / 180),
            center[1] + (majorRadius / 111320) * Math.sin(bearingRad + Math.PI/2)
        ];
        
        const majorHandleId = `ellipse-handle-${feature.id}-major`;
        this.editHandleIds.add(majorHandleId);
        
        handles.push({
            type: 'Feature',
            id: majorHandleId,
            geometry: {
                type: 'Point',
                coordinates: majorAxisEnd
            },
            properties: {
                role: 'handle',
                handleType: 'vertex',
                handleId: 'vertex',
                featureId: feature.id,
                mode: 'ellipse_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // CORRECTED: Minor axis handle (blue) - perpendicular to major axis
        const minorAxisEnd = [
            center[0] + (minorRadius / 111320) * Math.cos(bearingRad) / Math.cos(center[1] * Math.PI / 180),
            center[1] + (minorRadius / 111320) * Math.sin(bearingRad)
        ];
        
        const minorHandleId = `ellipse-handle-${feature.id}-minor`;
        this.editHandleIds.add(minorHandleId);
        
        handles.push({
            type: 'Feature',
            id: minorHandleId,
            geometry: {
                type: 'Point',
                coordinates: minorAxisEnd
            },
            properties: {
                role: 'handle',
                handleType: 'eccentricity',
                handleId: 'eccentricity',
                featureId: feature.id,
                mode: 'ellipse_editing',
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
                mode: 'ellipse_editing'
            }
        });

        console.log(`✅ Created ${handles.length} handles for ellipse ${feature.id}`); // Debug

        this.map.getSource('ellipse-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.editHandleIds.clear();
        this.map.getSource('ellipse-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    // Preview system for editing mode
    showEditPreview = (feature, majorHandlePosition, minorHandlePosition) => {
        const handles = [];
        
        // Major handle at current position
        if (majorHandlePosition) {
            const majorHandleId = `ellipse-handle-${feature.id}-major`;
            handles.push({
                type: 'Feature',
                id: majorHandleId,
                geometry: {
                    type: 'Point',
                    coordinates: majorHandlePosition
                },
                properties: {
                    role: 'handle',
                    handleType: 'major-axis',
                    handleId: 'major-axis',
                    featureId: feature.id,
                    mode: 'ellipse_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        // Minor handle at current position
        if (minorHandlePosition) {
            const minorHandleId = `ellipse-handle-${feature.id}-minor`;
            handles.push({
                type: 'Feature',
                id: minorHandleId,
                geometry: {
                    type: 'Point',
                    coordinates: minorHandlePosition
                },
                properties: {
                    role: 'handle',
                    handleType: 'minor-axis',
                    handleId: 'minor-axis',
                    featureId: feature.id,
                    mode: 'ellipse_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        // Preview feature
        handles.push({
            ...feature,
            properties: {
                ...feature.properties,
                role: 'selected-feature',
                mode: 'ellipse_editing'
            }
        });

        this.map.getSource('ellipse-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditPreview = () => {
        this.map.getSource('ellipse-edit-handles').setData({
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
            layers: ['ellipse-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            
            if (handle.properties.handleType === 'major-axis' || handle.properties.handleType === 'minor-axis') {
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
        
        const currentPosition = [e.lngLat.lng, e.lngLat.lat];
        
        if (this.activeHandle.properties.handleType === 'major-axis') {
            this.updateMajorAxisPreview(currentPosition);
        } else if (this.activeHandle.properties.handleType === 'minor-axis') {
            this.updateMinorAxisPreview(currentPosition);
        }
    }

    onEditMouseUp = () => {
        if (this.isDraggingHandle && this.previewFeature) {
            console.log('✅ Finishing handle drag and applying changes'); // Debug
            
            // Apply preview changes to actual feature
            this.selectedFeature.properties.majorRadius = this.previewFeature.properties.majorRadius;
            this.selectedFeature.properties.minorRadius = this.previewFeature.properties.minorRadius;
            this.selectedFeature.properties.bearing = this.previewFeature.properties.bearing;
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
            
            console.log('🎉 Ellipse edit completed successfully'); // Debug
        } else if (this.isDraggingHandle) {
            console.log('❌ Was dragging but no preview feature'); // Debug
        }
    }

    updateMajorAxisPreview = (newPosition) => {
        if (!this.previewFeature) return;
        
        const center = this.normalizeCenter(this.previewFeature.properties.center);
        
        if (!center) {
            console.error('Center inválido, não é possível atualizar preview');
            return;
        }

        const newMajorRadius = this.calculateDistance(center, newPosition);
        const newBearing = this.calculateBearing(center, newPosition);
        
        if (newMajorRadius > 10) {
            this.previewFeature.properties.majorRadius = newMajorRadius;
            this.previewFeature.properties.bearing = newBearing;
            this.previewFeature.geometry = this.generateEllipseGeometry(
                center, 
                newMajorRadius, 
                this.previewFeature.properties.minorRadius, 
                newBearing
            );
            
            // Calculate minor handle position for preview
            const perpendicularBearing = (newBearing + 90) % 360;
            const perpendicularBearingRad = perpendicularBearing * Math.PI / 180;
            const minorRadius = this.previewFeature.properties.minorRadius;
            const minorRadiusInDegrees = minorRadius / (111320 * Math.cos(center[1] * Math.PI / 180));
            const minorHandlePosition = [
                center[0] + minorRadiusInDegrees * Math.cos(perpendicularBearingRad),
                center[1] + (minorRadius / 111320) * Math.sin(perpendicularBearingRad)
            ];
            
            this.showEditPreview(this.previewFeature, newPosition, minorHandlePosition);
        }
    }

    updateMinorAxisPreview = (newPosition) => {
        if (!this.previewFeature) return;
        
        const center = this.normalizeCenter(this.previewFeature.properties.center);
        
        if (!center) {
            console.error('Center inválido, não é possível atualizar preview');
            return;
        }

        const newMinorRadius = this.calculateDistance(center, newPosition);
        
        if (newMinorRadius > 10) {
            this.previewFeature.properties.minorRadius = newMinorRadius;
            this.previewFeature.geometry = this.generateEllipseGeometry(
                center, 
                this.previewFeature.properties.majorRadius, 
                newMinorRadius, 
                this.previewFeature.properties.bearing
            );
            
            // Calculate major handle position for preview
            const bearing = this.previewFeature.properties.bearing;
            const bearingRad = bearing * Math.PI / 180;
            const majorRadius = this.previewFeature.properties.majorRadius;
            const majorRadiusInDegrees = majorRadius / (111320 * Math.cos(center[1] * Math.PI / 180));
            const majorHandlePosition = [
                center[0] + majorRadiusInDegrees * Math.cos(bearingRad),
                center[1] + (majorRadius / 111320) * Math.sin(bearingRad)
            ];
            
            this.showEditPreview(this.previewFeature, majorHandlePosition, newPosition);
        }
    }

    // ===== EVENT LISTENER MANAGEMENT =====

    setupBaseEventListeners = () => {
        // CRITICAL: Add both fill and line layers for proper click detection
        this.map.on('mouseenter', 'ellipse-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'ellipse-layer', this.handleMouseLeave);
        this.map.on('mouseenter', 'ellipse-fill-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'ellipse-fill-layer', this.handleMouseLeave);
    }

    removeAllEventListeners = () => {
        this.map.off('mouseenter', 'ellipse-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'ellipse-layer', this.handleMouseLeave);
        this.map.off('mouseenter', 'ellipse-fill-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'ellipse-fill-layer', this.handleMouseLeave);
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

    generateEllipseGeometry = (center, majorRadius, minorRadius, bearing) => {
        // CORRECTED: Use the same approach as reference code
        // Reference uses: turf.ellipse(center, majorRadius, minorRadius, { angle: bearing - 90 })
        
        const points = 64;
        const coordinates = [[]];
        
        // CRITICAL: Use bearing - 90 like in reference code
        const adjustedBearing = bearing - 90;
        const bearingRad = adjustedBearing * Math.PI / 180;
        
        for (let i = 0; i <= points; i++) {
            const angle = (i * 360 / points) * Math.PI / 180;
            
            // Standard ellipse equation in local coordinates
            const localX = majorRadius * Math.cos(angle);
            const localY = minorRadius * Math.sin(angle);
            
            // Apply rotation (bearing)
            const rotatedX = localX * Math.cos(bearingRad) - localY * Math.sin(bearingRad);
            const rotatedY = localX * Math.sin(bearingRad) + localY * Math.cos(bearingRad);
            
            // Convert to geographic coordinates (meters to degrees)
            const lng = center[0] + (rotatedX / 111320) / Math.cos(center[1] * Math.PI / 180);
            const lat = center[1] + (rotatedY / 111320);
            
            coordinates[0].push([lng, lat]);
        }

        return {
            type: 'Polygon',
            coordinates: coordinates
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

    calculateBearing = (start, end) => {
        const startLat = start[1] * Math.PI / 180;
        const startLng = start[0] * Math.PI / 180;
        const endLat = end[1] * Math.PI / 180;
        const endLng = end[0] * Math.PI / 180;

        const dLng = endLng - startLng;

        const y = Math.sin(dLng) * Math.cos(endLat);
        const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);

        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360;
    }

    forceUpdateMainSource = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
        const sourceFeature = data.features.find(f => f.id == feature.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('ellipses').setData(data);
        } else {
            console.error(`Feature ${feature.id} not found in ellipses source for forced update`);
        }
    }

    updateSelectionAfterEdit = () => {
        this.selectionManager.selectedEllipseFeatures.set(this.selectedFeature.id, this.selectedFeature);
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('ellipses', feature);
        } catch (error) {
            console.error('Erro ao salvar mudanças:', error);
        }
    }

    // ===== SELECTION SYSTEM INTERFACE METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
        
        for (const feature of features) {
            feature.id = feature.id || feature.properties.id;
            
            const sourceFeature = data.features.find(f => f.id == feature.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;
                
                if (['majorRadius', 'minorRadius', 'bearing', 'center'].includes(property)) {
                    const newGeometry = this.generateEllipseGeometry(
                        sourceFeature.properties.center,
                        sourceFeature.properties.majorRadius,
                        sourceFeature.properties.minorRadius,
                        sourceFeature.properties.bearing
                    );
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }
        
        this.map.getSource('ellipses').setData(data);
        
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
                feature.properties.majorRadius !== initialProperties.majorRadius ||
                feature.properties.minorRadius !== initialProperties.minorRadius ||
                feature.properties.bearing !== initialProperties.bearing ||
                JSON.stringify(feature.properties.center) !== JSON.stringify(initialProperties.center)
            );
        });
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            await updateFeature('ellipses', feature);
        }
        this.updateMapSource();
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                feature.properties = { ...originalProps };
                
                feature.geometry = this.generateEllipseGeometry(
                    feature.properties.center,
                    feature.properties.majorRadius,
                    feature.properties.minorRadius,
                    feature.properties.bearing
                );
                
                await updateFeature('ellipses', feature);
            }
        }
        this.updateMapSource();
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;
        
        // Simple and clean: let the robust store handle verification/retry
        for (const feature of features) {
            try {
                const featureId = feature.id || feature.properties.id;
                await removeFeature('ellipses', featureId);
            } catch (error) {
                console.error(`Error removing ellipse ${featureId}:`, error);
            }
        }
        
        // Remove from map source (visual)
        const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
        const idsToDelete = new Set(features.map(f => String(f.id || f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(String(f.id)));
        this.map.getSource('ellipses').setData(data);
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddEllipseControl.DEFAULT_PROPERTIES, properties);
    }

    updateMapSource = () => {
        const currentData = this.map.getSource('ellipses')._data;
        this.map.getSource('ellipses').setData(currentData);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.majorRadius !== initialProperties.majorRadius ||
            feature.properties.minorRadius !== initialProperties.minorRadius ||
            feature.properties.bearing !== initialProperties.bearing ||
            JSON.stringify(feature.properties.center) !== JSON.stringify(initialProperties.center)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
            
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
                        await updateFeature('ellipses', featureToUpdate);
                    }
                }
            }
            
            this.map.getSource('ellipses').setData(data);
        }
    }
}

export default AddEllipseControl;
// Path: js\controls_sig\ellipse_tool\add_ellipse_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { IDUtils } from '../id_utils.js';

// Note: turf is globally available as window.turf
const turf = window.turf;

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

        // ✅ PERFORMANCE OPTIMIZATION: RAF & Debouncing (same pattern as circle)
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;

        // ✅ EDIT PERFORMANCE: Same pattern as circle
        this.editRafId = null;
        this.pendingEditUpdate = false;
        this.lastEditPosition = null;
        this.lastEditHandleType = null;
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

    exitSelectedState = () => { }

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

        // ✅ CLEANUP: Cancel pending operations
        this.cancelPendingUpdates();
    }

    // ✅ PERFORMANCE: Cancel pending RAF/debouncing operations
    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;

        // ✅ EDIT RAF cleanup (same as circle)
        if (this.editRafId) {
            cancelAnimationFrame(this.editRafId);
            this.editRafId = null;
        }
        this.pendingEditUpdate = false;
        this.lastEditPosition = null;
        this.lastEditHandleType = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        const featureId = feature.properties.id;
        const isSameFeature = this.selectedFeature && this.selectedFeature.properties.id === featureId;

        if (isSameFeature && this.currentState === 'selected') {
            // Same feature selected again: SELECTED → EDITING
            this.transitionToState('editing', feature);
        } else {
            // New feature or first selection: → SELECTED
            this.transitionToState('selected', feature);
        }
    }

    onFeatureDeselected = (feature) => {
        const featureId = feature.properties.id;

        if (this.selectedFeature && this.selectedFeature.properties.id === featureId) {
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

    // ✅ OPTIMIZED: RAF-based preview (same pattern as circle)
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            this.lastPreviewCenter = this.drawPoints[0];
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate.bind(this));
            }
        }
    }

    // ✅ PERFORMANCE: RAF callback for smooth preview
    performPreviewUpdate = () => {
        if (!this.lastPreviewCenter || !this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        // Calculate using same logic as original
        const majorRadius = this.calculateDistance(this.lastPreviewCenter, this.lastPreviewPosition, { units: 'kilometers' });
        const bearing = this.calculateBearing(this.lastPreviewCenter, this.lastPreviewPosition);

        if (majorRadius >= 0.01) { // Minimum 10 meters
            // Light debouncing for geometry generation (same as circle)
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                const previewGeometry = this.generateEllipseGeometry(
                    this.lastPreviewCenter,
                    majorRadius,
                    majorRadius * 0.6, // Initial minor radius
                    bearing
                );
                this.showPreview(previewGeometry);
            }, 8); // Same 8ms as circle for consistency
        }

        this.pendingPreviewUpdate = false;
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
        this.cancelPendingUpdates();
        this.map.getSource('ellipse-preview').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    createFeature = async () => {
        const center = this.drawPoints[0];
        const majorAxisEnd = this.drawPoints[1];

        // Use same calculations as HTML file
        const majorRadius = this.calculateDistance(center, majorAxisEnd, { units: 'kilometers' });
        const bearing = this.calculateBearing(center, majorAxisEnd);

        if (majorRadius < 0.01) { // 10 meters minimum (0.01 km)
            alert('Raio mínimo: 10 metros');
            this.drawPoints = [];
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
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
            this.selectionManager.toggleFeatureSelection('ellipse', featureId, feature);
            this.selectionManager.updateUI();
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

        // CRITICAL FIX: Use original values (no swap) for handles like HTML example
        // The swap only affects the geometry, not the handle positions
        const majorRadius = feature.properties.majorRadius;
        const minorRadius = feature.properties.minorRadius;
        const bearing = feature.properties.bearing;

        // Major axis handle (red) - follow HTML logic exactly
        const majorAxisEnd = turf.destination(center, majorRadius, bearing, { units: 'kilometers' });

        const majorHandleId = `ellipse-handle-${feature.properties.id}-major`;
        this.editHandleIds.add(majorHandleId);

        handles.push({
            type: 'Feature',
            id: majorHandleId,
            geometry: {
                type: 'Point',
                coordinates: majorAxisEnd.geometry.coordinates
            },
            properties: {
                role: 'handle',
                handleType: 'vertex', // RED color in map.js
                handleId: 'major-axis',
                featureId: feature.properties.id,
                mode: 'ellipse_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Minor axis handle (blue) - perpendicular to major axis
        const perpendicularBearing = bearing + 90;
        const minorAxisEnd = turf.destination(center, minorRadius, perpendicularBearing, { units: 'kilometers' });

        const minorHandleId = `ellipse-handle-${feature.properties.id}-minor`;
        this.editHandleIds.add(minorHandleId);

        handles.push({
            type: 'Feature',
            id: minorHandleId,
            geometry: {
                type: 'Point',
                coordinates: minorAxisEnd.geometry.coordinates
            },
            properties: {
                role: 'handle',
                handleType: 'eccentricity', // BLUE color in map.js
                handleId: 'minor-axis',
                featureId: feature.properties.id,
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

        // Major handle at current position (RED)
        if (majorHandlePosition) {
            const majorHandleId = `ellipse-handle-${feature.properties.id}-major`;
            handles.push({
                type: 'Feature',
                id: majorHandleId,
                geometry: {
                    type: 'Point',
                    coordinates: majorHandlePosition
                },
                properties: {
                    role: 'handle',
                    handleType: 'vertex', // RED color in map.js
                    handleId: 'major-axis',
                    featureId: feature.properties.id,
                    mode: 'ellipse_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        // Minor handle at current position (BLUE)
        if (minorHandlePosition) {
            const minorHandleId = `ellipse-handle-${feature.properties.id}-minor`;
            handles.push({
                type: 'Feature',
                id: minorHandleId,
                geometry: {
                    type: 'Point',
                    coordinates: minorHandlePosition
                },
                properties: {
                    role: 'handle',
                    handleType: 'eccentricity', // BLUE color in map.js
                    handleId: 'minor-axis',
                    featureId: feature.properties.id,
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

            if (handle.properties.handleType === 'vertex' || handle.properties.handleType === 'eccentricity') {
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

    // ✅ OPTIMIZED: RAF-based edit updates (same pattern as circle)
    onEditMouseMove = (e) => {
        if (!this.isDraggingHandle || !this.activeHandle || !this.selectedFeature) return;

        this.lastEditPosition = [e.lngLat.lng, e.lngLat.lat];
        this.lastEditHandleType = this.activeHandle.properties.handleType;

        if (!this.pendingEditUpdate) {
            this.pendingEditUpdate = true;
            this.editRafId = requestAnimationFrame(this.performEditUpdate.bind(this));
        }
    }

    // ✅ PERFORMANCE: RAF callback for smooth edit updates
    performEditUpdate = () => {
        if (!this.lastEditPosition || !this.lastEditHandleType || !this.previewFeature) {
            this.pendingEditUpdate = false;
            return;
        }

        // Light debouncing for turf.js operations (same as circle)
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            if (this.lastEditHandleType === 'vertex') {
                this.updateMajorAxisPreview(this.lastEditPosition);
            } else if (this.lastEditHandleType === 'eccentricity') {
                this.updateMinorAxisPreview(this.lastEditPosition);
            }
        }, 8); // Same 8ms as circle for consistency

        this.pendingEditUpdate = false;
    }

    onEditMouseUp = () => {
        if (this.isDraggingHandle && this.previewFeature) {
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
        }
    }

    updateMajorAxisPreview = (newPosition) => {
        if (!this.previewFeature) return;

        const center = this.normalizeCenter(this.previewFeature.properties.center);

        if (!center) {
            console.error('Center inválido, não é possível atualizar preview');
            return;
        }

        // Follow HTML logic exactly - use turf functions
        const newMajorRadius = turf.distance(center, newPosition, { units: 'kilometers' });
        const newBearing = turf.bearing(center, newPosition);

        if (newMajorRadius > 0.01) { // Minimum radius (0.01 km = 10 meters)
            this.previewFeature.properties.majorRadius = newMajorRadius;
            this.previewFeature.properties.bearing = newBearing;
            this.previewFeature.geometry = this.generateEllipseGeometry(
                center,
                newMajorRadius,
                this.previewFeature.properties.minorRadius,
                newBearing
            );

            // Calculate minor handle position using original values (no swap)
            const perpendicularBearing = newBearing + 90;
            const minorHandlePosition = turf.destination(center, this.previewFeature.properties.minorRadius, perpendicularBearing, { units: 'kilometers' });

            this.showEditPreview(this.previewFeature, newPosition, minorHandlePosition.geometry.coordinates);
        }
    }

    updateMinorAxisPreview = (newPosition) => {
        if (!this.previewFeature) return;

        const center = this.normalizeCenter(this.previewFeature.properties.center);

        if (!center) {
            console.error('Center inválido, não é possível atualizar preview');
            return;
        }

        // Follow HTML logic exactly - use turf functions
        const newMinorRadius = turf.distance(center, newPosition, { units: 'kilometers' });

        if (newMinorRadius > 0.01) { // Minimum radius (0.01 km = 10 meters)
            this.previewFeature.properties.minorRadius = newMinorRadius;
            this.previewFeature.geometry = this.generateEllipseGeometry(
                center,
                this.previewFeature.properties.majorRadius,
                newMinorRadius,
                this.previewFeature.properties.bearing
            );

            // CRITICAL FIX: Calculate where the minor handle SHOULD be (not where mouse is)
            // Minor handle should always be at bearing + 90° from center
            const majorHandlePosition = turf.destination(center, this.previewFeature.properties.majorRadius, this.previewFeature.properties.bearing, { units: 'kilometers' });
            const perpendicularBearing = this.previewFeature.properties.bearing + 90;
            const minorHandlePosition = turf.destination(center, newMinorRadius, perpendicularBearing, { units: 'kilometers' });

            this.showEditPreview(this.previewFeature, majorHandlePosition.geometry.coordinates, minorHandlePosition.geometry.coordinates);
        }
    }

    // ===== EVENT LISTENER MANAGEMENT =====

    setupBaseEventListeners = () => {
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        // ✅ CLEANUP: Cancel all pending operations
        this.cancelPendingUpdates();
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

    // Use turf.ellipse exactly like the HTML example
    generateEllipseGeometry = (center, majorRadius, minorRadius, bearing) => {
        // Handle case where minor radius is larger than major radius (same as HTML)
        let actualMajorRadius = majorRadius;
        let actualMinorRadius = minorRadius;
        let actualBearing = bearing;

        if (minorRadius > majorRadius) {
            actualMajorRadius = minorRadius;
            actualMinorRadius = majorRadius;
            actualBearing = bearing + 90; // Rotate 90 degrees
        }

        const options = {
            angle: actualBearing - 90, // Align major axis with bearing direction (same as HTML)
            steps: 64,
            units: 'kilometers'
        };

        // Use turf.ellipse exactly like the HTML example
        const ellipsePolygon = turf.ellipse(center, actualMajorRadius, actualMinorRadius, options);

        return ellipsePolygon.geometry;
    }

    // Corrected distance calculation following turf.distance logic
    calculateDistance = (point1, point2, options = {}) => {
        return turf.distance(point1, point2, options);
    }

    // Corrected bearing calculation following turf.bearing logic
    calculateBearing = (start, end) => {
        return turf.bearing(start, end);
    }

    // Corrected destination calculation following turf.destination logic
    calculateDestination = (origin, distance, bearing, options = {}) => {
        return turf.destination(origin, distance, bearing, options);
    }

    forceUpdateMainSource = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
        const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('ellipses').setData(data);
        } else {
            console.error(`Feature ${feature.properties.id} not found in ellipses source for forced update`);
        }
    }

    updateSelectionAfterEdit = () => {
        const featureId = this.selectedFeature.properties.id;
        const type = this.selectedFeature.properties.source; // 'circle', 'ellipse', etc.
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
            await updateFeature('ellipses', feature);
        } catch (error) {
            console.error('Erro ao salvar mudanças:', error);
        }
    }

    // ===== SELECTION SYSTEM INTERFACE METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));

        for (const feature of features) {
            feature.properties.id = feature.properties.id;

            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
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
    }

    hasUnsavedChanges = (features, initialPropertiesMap) => {
        return features.some(feature => {
            const initialProperties = initialPropertiesMap.get(feature.properties.id);
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
        const currentData = this.map.getSource('ellipses')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('ellipses', featureToSave);
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));

            // Regenerar geometria com propriedades originais
            f.geometry = this.generateEllipseGeometry(
                f.properties.center,
                f.properties.majorRadius,
                f.properties.minorRadius,
                f.properties.bearing
            );
        });

        // Usar o método updateFeatures que já existe e funciona corretamente
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('ellipses', featureId);
            } catch (error) {
                console.error(`Error removing ellipse ${featureId}:`, error);
            }
        }

        const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
        const idsToDelete = new Set(features.map(f => String(f.properties.id || f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
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

    updateFeaturesCenterProperty = (features, newCenter) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));

        for (const feature of features) {
            feature.properties.id = feature.properties.id;

            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties.center = newCenter;
                feature.properties.center = newCenter;

                const newGeometry = this.generateEllipseGeometry(
                    newCenter,
                    sourceFeature.properties.majorRadius,
                    sourceFeature.properties.minorRadius,
                    sourceFeature.properties.bearing
                );
                sourceFeature.geometry = newGeometry;
                feature.geometry = newGeometry;
            }
        }

        this.map.getSource('ellipses').setData(data);
    }

    updateFeatureFromUI = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
        const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);

        if (sourceFeature) {
            Object.assign(sourceFeature.properties, feature.properties);

            const newGeometry = this.generateEllipseGeometry(
                sourceFeature.properties.center,
                sourceFeature.properties.majorRadius,
                sourceFeature.properties.minorRadius,
                sourceFeature.properties.bearing
            );
            sourceFeature.geometry = newGeometry;
            this.map.getSource('ellipses').setData(data);
        }
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));

            for (const feature of features) {
                feature.properties.id = feature.properties.id;

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
                        await updateFeature('ellipses', featureToUpdate);
                    }
                }
            }

            this.map.getSource('ellipses').setData(data);
        }
    }
}

export default AddEllipseControl;
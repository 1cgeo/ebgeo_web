// Path: js\controls_sig\ellipse_tool\add_ellipse_control.js
import { addFeature, updateFeature, removeFeature } from '../store/store.js';
import { IDUtils } from '../id_utils.js';

// Note: turf is globally available as window.turf
const turf = window.turf;

class AddEllipseControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;

        this.isActive = false;
        this.selectedFeature = null;           // Substitui currentState system
        this.drawPoints = [];
        this.isDraggingHandle = false;         // Estado de drag único

        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;
        this.activeHandleType = null;
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        fillColor: '#3f4fb5',
        lineWidth: 2,
        opacity: 0.5,
        source: 'ellipse',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
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
            './images/icon_ellipse_red.svg' :
            './images/icon_ellipse_black.svg';
        $("#ellipse-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="ELLIPSE" />`);
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
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    // ✅ CLEANUP - cancelar operações pendentes
    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;     // ✅ Reset cache do centro
        this.activeHandleType = null;      // ✅ Reset handle type
        
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
            f.source === 'ellipse-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        if (!this.selectedFeature) return false;
        return features.some(f =>
            f.source === 'ellipses' &&
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

    // ✅ RAF-based preview (com cache do centro)
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            this.lastPreviewCenter = this.drawPoints[0];  // ✅ Cache do centro
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
            }
        }
    }

    // ✅ CONSOLIDATED RAF - handles both preview and edit
    performPreviewUpdate = () => {
        if (!this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        // Edit mode - updating ellipse via handle drag
        if (this.isDraggingHandle && this.selectedFeature) {
            this.updateEllipsePreview(this.lastPreviewPosition);
        }
        // Drawing mode - showing ellipse preview
        else if (this.drawPoints.length === 1 && this.lastPreviewCenter) {
            const center = this.lastPreviewCenter;  // ✅ Usar cache
            const majorRadius = this.calculateDistance(center, this.lastPreviewPosition, { units: 'kilometers' });
            const bearing = this.calculateBearing(center, this.lastPreviewPosition);

            if (majorRadius >= 0.01) { // Minimum 10 meters
                // ✅ Light debounce para operações turf.js pesadas
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const previewGeometry = this.generateEllipseGeometry(
                        center,
                        majorRadius,
                        majorRadius * 0.6, // Initial minor radius
                        bearing
                    );
                    this.showPreview(previewGeometry);
                }, 8); // 8ms como no Circle Control
            }
        }

        this.pendingPreviewUpdate = false;
    }

    // ✅ UPDATED - uses consolidated feedback source
    showPreview = (geometry) => {
        this.map.getSource('ellipse-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                lineColor: AddEllipseControl.DEFAULT_PROPERTIES.lineColor,
                fillColor: AddEllipseControl.DEFAULT_PROPERTIES.fillColor,
                opacity: 0.5
            }
        });
    }

    // ✅ UPDATED - clears consolidated feedback source
    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        this.map.getSource('ellipse-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    createFeature = async () => {
        const center = this.drawPoints[0];
        const majorAxisEnd = this.drawPoints[1];

        const majorRadius = this.calculateDistance(center, majorAxisEnd, { units: 'kilometers' });
        const bearing = this.calculateBearing(center, majorAxisEnd);

        if (majorRadius < 0.01) { // 10 meters minimum (0.01 km)
            alert('Raio mínimo: 10 metros');
            this.drawPoints = [];
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('ellipse', this.map);

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddEllipseControl.DEFAULT_PROPERTIES,
                center: center,
                majorRadius: majorRadius,
                minorRadius: majorRadius * 0.6, // Initial minor radius
                bearing: bearing,
                id: featureId,
                nome: featureName
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

        const majorRadius = feature.properties.majorRadius;
        const minorRadius = feature.properties.minorRadius;
        const bearing = feature.properties.bearing;

        // Major axis handle (red)
        const majorAxisEnd = turf.destination(center, majorRadius, bearing, { units: 'kilometers' });

        handles.push({
            type: 'Feature',
            id: `ellipse-handle-${feature.properties.id}-major`,
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

        handles.push({
            type: 'Feature',
            id: `ellipse-handle-${feature.properties.id}-minor`,
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

        // Show selection feedback using consolidated source
        this.map.getSource('ellipse-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        // Show handles
        this.map.getSource('ellipse-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('ellipse-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('ellipse-feedback').setData({
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

    // ✅ SIMPLIFIED - mas track do handle específico
    onEditMouseDown = (e) => {
        if (!this.selectedFeature) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['ellipse-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandleType = handle.properties.handleType; // ✅ Track qual handle
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
            e.preventDefault();
        }
    }

    // ✅ SIMPLIFIED - uses consolidated RAF
    onEditMouseMove = (e) => {
        if (!this.isDraggingHandle || !this.selectedFeature) return;

        this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    onEditMouseUp = () => {
        if (this.isDraggingHandle && this.selectedFeature) {
            const center = this.normalizeCenter(this.selectedFeature.properties.center);
            
            if (center && this.lastPreviewPosition) {
                if (this.activeHandleType === 'vertex') {
                    // Major axis handle
                    const newMajorRadius = turf.distance(center, this.lastPreviewPosition, { units: 'kilometers' });
                    const newBearing = turf.bearing(center, this.lastPreviewPosition);
                    
                    if (newMajorRadius > 0.01) {
                        this.selectedFeature.properties.majorRadius = newMajorRadius;
                        this.selectedFeature.properties.bearing = newBearing;
                    }
                } else if (this.activeHandleType === 'eccentricity') {
                    // Minor axis handle
                    const newMinorRadius = turf.distance(center, this.lastPreviewPosition, { units: 'kilometers' });
                    
                    if (newMinorRadius > 0.01) {
                        this.selectedFeature.properties.minorRadius = newMinorRadius;
                    }
                }

                // Regenerate geometry
                this.selectedFeature.geometry = this.generateEllipseGeometry(
                    center,
                    this.selectedFeature.properties.majorRadius,
                    this.selectedFeature.properties.minorRadius,
                    this.selectedFeature.properties.bearing
                );

                this.forceUpdateMainSource(this.selectedFeature);
                this.createEditHandles(this.selectedFeature);
                this.updateSelectionAfterEdit();
                this.updateUIAfterEdit();
                this.saveFeatureChanges(this.selectedFeature);
            }
        }

        this.isDraggingHandle = false;
        this.activeHandleType = null;       // ✅ Reset handle type
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateEllipsePreview = (newPosition) => {
        if (!this.selectedFeature || !this.activeHandleType) return;

        const center = this.normalizeCenter(this.selectedFeature.properties.center);
        if (!center) return;

        // ✅ Debounce para operações turf.js pesadas
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            if (this.activeHandleType === 'vertex') {
                this.updateMajorAxisPreview(newPosition);
            } else if (this.activeHandleType === 'eccentricity') {
                this.updateMinorAxisPreview(newPosition);
            }
        }, 8); // 8ms como no Circle Control
    }

    updateMajorAxisPreview = (newPosition) => {
        if (!this.selectedFeature) return;

        const center = this.normalizeCenter(this.selectedFeature.properties.center);
        if (!center) return;

        // Follow HTML logic exactly - use turf functions
        const newMajorRadius = turf.distance(center, newPosition, { units: 'kilometers' });
        const newBearing = turf.bearing(center, newPosition);

        if (newMajorRadius > 0.01) { // Minimum radius (0.01 km = 10 meters)
            const previewGeometry = this.generateEllipseGeometry(
                center,
                newMajorRadius,
                this.selectedFeature.properties.minorRadius,
                newBearing
            );

            // Calculate minor handle position using original values (no swap)
            const perpendicularBearing = newBearing + 90;
            const minorHandlePosition = turf.destination(center, this.selectedFeature.properties.minorRadius, perpendicularBearing, { units: 'kilometers' });

            this.showEditPreview(previewGeometry, newPosition, minorHandlePosition.geometry.coordinates);
        }
    }

    updateMinorAxisPreview = (newPosition) => {
        if (!this.selectedFeature) return;

        const center = this.normalizeCenter(this.selectedFeature.properties.center);
        if (!center) return;

        // Follow HTML logic exactly - use turf functions
        const newMinorRadius = turf.distance(center, newPosition, { units: 'kilometers' });

        if (newMinorRadius > 0.01) { // Minimum radius (0.01 km = 10 meters)
            const previewGeometry = this.generateEllipseGeometry(
                center,
                this.selectedFeature.properties.majorRadius,
                newMinorRadius,
                this.selectedFeature.properties.bearing
            );

            // CRITICAL FIX: Calculate where the minor handle SHOULD be (not where mouse is)
            // Minor handle should always be at bearing + 90° from center
            const majorHandlePosition = turf.destination(center, this.selectedFeature.properties.majorRadius, this.selectedFeature.properties.bearing, { units: 'kilometers' });
            const perpendicularBearing = this.selectedFeature.properties.bearing + 90;
            const minorHandlePosition = turf.destination(center, newMinorRadius, perpendicularBearing, { units: 'kilometers' });

            this.showEditPreview(previewGeometry, majorHandlePosition.geometry.coordinates, minorHandlePosition.geometry.coordinates);
        }
    }

    showEditPreview = (geometry, majorHandlePosition, minorHandlePosition) => {
        // Show updated selection feedback
        this.map.getSource('ellipse-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                ...this.selectedFeature.properties,
                isSelected: true
            }
        });

        // Update handles
        const handles = [
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: majorHandlePosition },
                properties: {
                    role: 'handle',
                    handleType: 'vertex', // RED color
                    user_isEditingHandle: true
                }
            },
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: minorHandlePosition },
                properties: {
                    role: 'handle',
                    handleType: 'eccentricity', // BLUE color
                    user_isEditingHandle: true
                }
            }
        ];

        this.map.getSource('ellipse-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    // ===== EVENT LISTENER MANAGEMENT =====

    setupBaseEventListeners = () => {
        // Base listeners setup if needed
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
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

    // MANTER: Use turf.ellipse exactly like the HTML example
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

    calculateDistance = (point1, point2, options = {}) => {
        return turf.distance(point1, point2, options);
    }

    calculateBearing = (start, end) => {
        return turf.bearing(start, end);
    }

    forceUpdateMainSource = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
        const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('ellipses').setData(data);
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
            await updateFeature('ellipses', feature);
        } catch (error) {
            console.error('Erro ao salvar mudanças:', error);
        }
    }

    // ===== SELECTION SYSTEM INTERFACE METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));

        for (const feature of features) {
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

        if (this.selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(this.selectedFeature);
        }
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
            f.geometry = this.generateEllipseGeometry(
                f.properties.center,
                f.properties.majorRadius,
                f.properties.minorRadius,
                f.properties.bearing
            );
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('ellipses', featureId);
                const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('ellipses').setData(data);
            } catch (error) {
                console.error(`Error removing ellipse ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddEllipseControl.DEFAULT_PROPERTIES, properties);
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
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.center) !== JSON.stringify(initialProperties.center)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
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
                        await updateFeature('ellipses', featureToUpdate);
                    }
                }
            }

            this.map.getSource('ellipses').setData(data);
        }
    }
}

export default AddEllipseControl;
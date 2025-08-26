// Path: js\controls_sig\circle_tool\add_circle_control.js
import { addFeature, updateFeature, removeFeature } from '../store/store.js';
import { IDUtils } from '../id_utils.js';

class AddCircleControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;

        this.isActive = false;
        this.drawPoints = [];
        this.selectedFeature = null;           // replaces currentState system
        this.isDraggingHandle = false;         // single drag state

        // ✅ MAINTAIN RAF - but consolidate for both preview and edit
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;         // ✅ Cache do centro durante preview
        this.geometryDebounceTimer = null;     // ✅ Debounce para operações de geometria
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        fillColor: '#3f4fb5',
        lineWidth: 2,
        opacity: 0.5,
        source: 'circle',
        coordinationPoint: false,
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
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
            './images/icon_circle_red.svg' :
            './images/icon_circle_black.svg';
        $("#circle-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="CIRCLE" />`);
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

    // ✅ MAINTAIN RAF - but cleanup consolidated
    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;         // ✅ Reset cache do centro
        
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
            f.source === 'circle-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        if (!this.selectedFeature) return false;
        return features.some(f =>
            f.source === 'circles' &&
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

    // ✅ MAINTAIN RAF - com cache do centro
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

        // Edit mode - updating radius
        if (this.isDraggingHandle && this.selectedFeature) {
            this.updateRadiusPreview(this.lastPreviewPosition);
        }
        // Drawing mode - showing preview
        else if (this.drawPoints.length === 1 && this.lastPreviewCenter) {
            const center = this.lastPreviewCenter;  // ✅ Usar cache
            const radius = this.calculateDistance(center, this.lastPreviewPosition);

            if (radius >= 10) {
                // ✅ Light debounce para consistência com outros controls
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const previewGeometry = this.generateCircleGeometry(center, radius);
                    this.showPreview(previewGeometry);
                }, 8); // 8ms como na Ellipse para consistência
            }
        }

        this.pendingPreviewUpdate = false;
    }

    // ✅ UPDATED - uses consolidated feedback source
    showPreview = (geometry) => {
        this.map.getSource('circle-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                lineColor: AddCircleControl.DEFAULT_PROPERTIES.lineColor,
                fillColor: AddCircleControl.DEFAULT_PROPERTIES.fillColor,
                opacity: 0.5
            }
        });
    }

    // ✅ UPDATED - clears consolidated feedback source
    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        this.map.getSource('circle-feedback').setData({
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

        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('circle', this.map);

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddCircleControl.DEFAULT_PROPERTIES,
                center: center,
                radius: radius,
                id: featureId,
                nome: featureName
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
            this.selectionManager.toggleFeatureSelection('circle', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Erro ao criar círculo:', error);
        }
    }

    // ===== X-MARKS SYSTEM - MAINTAINED ===== 

    generateXGeometry = (center, radius) => {
        const radiusInDegrees = radius / 111320;
        const cosLat = Math.cos(center[1] * Math.PI / 180);

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

    updateXMarks = () => {
        const circleSource = this.map.getSource('circles')
        if (!circleSource) return
        const circleData = circleSource._data;
        const xFeatures = [];

        circleData.features.forEach(feature => {
            if (feature.properties.coordinationPoint) {
                const center = this.normalizeCenter(feature.properties.center);
                if (center) {
                    const xGeometries = this.generateXGeometry(center, feature.properties.radius);

                    xGeometries.forEach((geometry, index) => {
                        xFeatures.push({
                            type: 'Feature',
                            id: `x-mark-${feature.properties.id}-${index}`,
                            geometry: geometry,
                            properties: {
                                parentId: feature.properties.id,
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
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            console.error('Não foi possível criar handles - center inválido');
            return;
        }

        const radius = feature.properties.radius;
        const radiusInDegrees = radius / 111320;

        // Single radius handle
        const handlePoint = [
            center[0] + (radiusInDegrees / Math.cos(center[1] * Math.PI / 180)),
            center[1]
        ];

        const handleFeature = {
            type: 'Feature',
            id: `circle-handle-${feature.properties.id}-radius`,
            geometry: {
                type: 'Point',
                coordinates: handlePoint
            },
            properties: {
                role: 'handle',
                handleType: 'radius',
                handleId: 'radius-main',
                featureId: feature.properties.id,
                mode: 'circle_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        };

        // Show selection feedback
        this.map.getSource('circle-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        // Show handle
        this.map.getSource('circle-edit-handles').setData({
            type: 'FeatureCollection',
            features: [handleFeature]
        });
    }

    clearEditHandles = () => {
        this.map.getSource('circle-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('circle-feedback').setData({
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

    // ✅ SIMPLIFIED - less variables
    onEditMouseDown = (e) => {
        if (!this.selectedFeature) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['circle-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            this.isDraggingHandle = true;
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
            // Apply changes to selected feature
            const center = this.normalizeCenter(this.selectedFeature.properties.center);
            const newRadius = this.calculateDistance(center, this.lastPreviewPosition);

            if (newRadius > 10) {
                this.selectedFeature.properties.radius = newRadius;
                this.selectedFeature.geometry = this.generateCircleGeometry(center, newRadius);

                this.forceUpdateMainSource(this.selectedFeature);
                this.createEditHandles(this.selectedFeature);
                this.updateSelectionAfterEdit();
                this.updateUIAfterEdit();
                this.saveFeatureChanges(this.selectedFeature);
                this.updateXMarks();
            }
        }

        this.isDraggingHandle = false;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateRadiusPreview = (newPosition) => {
        if (!this.selectedFeature) return;

        const center = this.normalizeCenter(this.selectedFeature.properties.center);
        if (!center) return;

        const newRadius = this.calculateDistance(center, newPosition);
        if (newRadius > 10) {
            // ✅ Debounce para consistência com outros controls
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                const previewGeometry = this.generateCircleGeometry(center, newRadius);

                // Update handle position
                const radiusInDegrees = newRadius / 111320;
                const handlePoint = [
                    center[0] + (radiusInDegrees / Math.cos(center[1] * Math.PI / 180)),
                    center[1]
                ];

                // Show updated selection
                this.map.getSource('circle-feedback').setData({
                    type: 'Feature',
                    geometry: previewGeometry,
                    properties: {
                        ...this.selectedFeature.properties,
                        isSelected: true
                    }
                });

                // Update handle
                this.map.getSource('circle-edit-handles').setData({
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: handlePoint },
                        properties: {
                            role: 'handle',
                            handleType: 'radius',
                            user_isEditingHandle: true
                        }
                    }]
                });
            }, 8); // 8ms como na Ellipse para consistência
        }
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
        const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('circles').setData(data);
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
            await updateFeature('circles', feature);
        } catch (error) {
            console.error('Erro ao salvar mudanças:', error);
        }
    }

    // ===== SELECTION SYSTEM INTERFACE METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
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

        if (this.selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(this.selectedFeature);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('circles')._data;
        let hasChanges = false;
        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };

                    await updateFeature('circles', featureToSave);
                    hasChanges = true;
                }
            }
        }

        if (hasChanges) {
            this.updateXMarks();
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            f.geometry = this.generateCircleGeometry(
                f.properties.center,
                f.properties.radius
            );
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('circles', featureId);
                const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('circles').setData(data);
            } catch (error) {
                console.error(`Error removing circle ${feature.properties.id}:`, error);
            }
        }
        this.updateXMarks();
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddCircleControl.DEFAULT_PROPERTIES, properties);
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
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.center) !== JSON.stringify(initialProperties.center)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
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
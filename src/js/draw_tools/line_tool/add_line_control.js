// Path: js/draw_tools/line_tool/add_line_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils } from '../../utilities';
import { addLineAttributesToPanel } from './line_attributes_panel.js';
import { getTerrainElevation } from '../../terrain';
import AddLineGeometry from './add_line_geometry.js';
import { BaseControl } from '../../tool_manager';

class AddLineControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;

        this.geometry = new AddLineGeometry();

        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.geometryDebounceTimer = null;

        this.isCalculatingProfile = false;

        this.dragRecalculateTimeout = null;
        this._name = 'AddLineControl';
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        lineWidth: 5,
        opacity: 0.7,
        lineStyle: 'solid',
        measure: false,
        profile: false,
        profileData: null,
        source: 'line',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== SINGLE SOURCE OF TRUTH =====

    /**
     * Get currently selected line feature from SelectionManager
     * @param {void}
     * @returns {Object|null} Selected line feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('line');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected line features from SelectionManager
     * @param {void}
     * @returns {Array} Array of selected line features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('line')
            .map(item => item.feature);
    }

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
            this.selectionManager.uiManager.removeControl(this.container);
            this.deactivate();
            this.removeAllEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddLineControl:', error);
            throw error;
        }
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'line-attributes-section';

        try {
            addLineAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating line attribute panel:', error);
        }
    }

    getDragSources() {
        return ['lines'];
    }

    getEditHandleSources() {
        return ['line-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating line selection box:', error);
            return null;
        }
    }

    getSelectionBoxStrategy() {
        return 'bbox';
    }

    getSelectionBoxPadding() {
        return 8;
    }

    getLayerIds() {
        return ['line-layer'];
    }

    getSourceNames() {
        return ['lines'];
    }

    getEditHandleSource() {
        return 'line-edit-handles';
    }

    canCopy(feature) {
        return true;
    }

    canPaste(feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const coordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const newCoordinates = this.geometry.applyOffset(coordinates, offset.dx, offset.dy);

        return {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newCoordinates
            },
            geometry: this.geometry.generate(newCoordinates)
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const centerPoint = this.geometry.getCenter(
            this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates)
        );
        if (!centerPoint) {
            return [0, 0];
        }

        return [
            centerPoint[0] - referencePoint.lng,
            centerPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const coordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const newCoordinates = this.geometry.applyOffset(coordinates, dx, dy);

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newCoordinates
            },
            geometry: this.geometry.generate(newCoordinates)
        };

        return updatedFeature;
    }

    canMove(feature) {
        return !feature.properties?.bloqueado;
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
        this.setupRightClickListener();
    }

    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.clearPreview();
        this.removeRightClickListener();
        this.deselectFeature();
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_line_red.svg' :
            './images/icon_line_black.svg';
        const btn = document.getElementById('line-tool');
        if (btn) btn.innerHTML = `<img class="icon-sig-tool" src="${iconSrc}" alt="LINE" />`;
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        this.selectFeature(feature);
    }

    onFeatureDeselected = (feature) => {
        const selectedFeature = this.getSelectedFeature();
        const featureId = feature.properties.id;
        if (selectedFeature && selectedFeature.properties.id === featureId) {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature) {
            this.deselectFeature();
        }
    }

    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (featureId) => {
        const selectedFeature = this.getSelectedFeature();
        return selectedFeature && selectedFeature.properties.id === featureId;
    }

    /**
     * Recalculate line profiles asynchronously after drag operation
     * Ensures profile panel is updated with fresh data after recalculation
     * @param {Array} movedFeatures - Features that were moved
     * @returns {Promise<void>}
     */
    syncEditHandlesAfterDrag = async (movedFeatures) => {
        const lineFeatures = movedFeatures.filter(f => f.properties.source === 'line');

        if (lineFeatures.length === 0) {
            const selectedFeature = this.getSelectedFeature();
            if (selectedFeature && !this.isDraggingHandle) {
                this.createEditHandles(selectedFeature);
            }
            return;
        }

        clearTimeout(this.dragRecalculateTimeout);
        this.dragRecalculateTimeout = setTimeout(async () => {
            this.showRecalculatingState();

            try {
                const updatedFeatures = await this.recalculateMovedLineFeatures(lineFeatures);

                this.updateSelectionManagerFeatures(updatedFeatures);

                this.selectionManager.updateUI();

                const selectedFeature = this.getSelectedFeature();
                if (selectedFeature && !this.isDraggingHandle) {
                    this.createEditHandles(selectedFeature);
                }

            } catch (error) {
                console.error('Error recalculating Line profile after drag:', error);
            } finally {
                this.hideRecalculatingState();
            }
        }, 50);
    }

    /**
     * Show recalculation state with visual feedback
     */
    showRecalculatingState() {
        this.map.getCanvas().style.cursor = 'wait';

        this.map.off('click', this.handleMapClick);

        if (this.container) {
            this.container.classList.add('recalculating');
        }
    }

    /**
     * Hide recalculation state and restore normal interaction
     */
    hideRecalculatingState() {
        this.map.getCanvas().style.cursor = this.isActive ? 'crosshair' : '';

        if (this.isActive) {
            this.map.on('click', this.handleMapClick);
        }

        if (this.container) {
            this.container.classList.remove('recalculating');
        }
    }

    /**
     * Recalculate line profiles after movement
     * @param {Array} movedFeatures - Array of moved line features
     * @returns {Promise<Array>} Array of updated features
     */
    async recalculateMovedLineFeatures(movedFeatures) {
        const updatedFeatures = [];

        for (const movedFeature of movedFeatures) {
            if (movedFeature.properties.source === 'line') {
                try {
                    const coordinates = this.geometry.normalizeBaseCoordinates(movedFeature.properties.baseCoordinates);
                    if (coordinates && coordinates.length >= 2) {

                        if (movedFeature.properties.profile) {
                            const newProfileData = await this.calculateProfile(coordinates);
                            movedFeature.properties.profileData = JSON.stringify(newProfileData);
                        }

                        await updateFeature('lines', movedFeature);

                        if (movedFeature.properties.measure) {
                            this.updateFeatureMeasurement(movedFeature);
                        }

                        updatedFeatures.push(movedFeature);
                    }
                } catch (error) {
                    console.error('Error recalculating Line profile after movement:', error);
                    updatedFeatures.push(movedFeature);
                }
            }
        }

        return updatedFeatures;
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for line');
            return;
        }

        const newPoint = [e.lngLat.lng, e.lngLat.lat];

        if (this.geometry.isPointTooClose(newPoint, this.drawPoints)) {
            return;
        }

        this.drawPoints.push(newPoint);

        if (this.drawPoints.length === 1) {
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length >= 2) {
            this.updateDrawingPreview();
        }
    }

    setupRightClickListener = () => {
        this.map.getCanvas().addEventListener('contextmenu', this.handleRightClick);
    }

    removeRightClickListener = () => {
        this.map.getCanvas().removeEventListener('contextmenu', this.handleRightClick);
    }

    handleRightClick = async (e) => {
        if (!this.isActive || this.drawPoints.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        const coordinates = this.map.unproject([e.offsetX, e.offsetY]);
        const finalPoint = [coordinates.lng, coordinates.lat];

        if (!this.geometry.isPointTooClose(finalPoint, this.drawPoints)) {
            this.drawPoints.push(finalPoint);
        }

        if (this.drawPoints.length >= 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
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

        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature) {
            this.updateLinePreview(this.lastPreviewPosition);
        } else if (this.drawPoints.length >= 1) {
            this.updateDrawingPreview();
        }

        this.pendingPreviewUpdate = false;
    }

    updateDrawingPreview = () => {
        if (this.drawPoints.length === 0) return;

        const previewCoords = [...this.drawPoints];
        if (this.lastPreviewPosition) {
            previewCoords.push(this.lastPreviewPosition);
        }

        if (previewCoords.length >= 2) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                const previewGeometry = this.geometry.generate(previewCoords);
                this.showPreview(previewGeometry);
            }, 8);
        }
    }

    showPreview = (geometry) => {
        this.map.getSource('line-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                lineColor: AddLineControl.DEFAULT_PROPERTIES.lineColor,
                lineWidth: AddLineControl.DEFAULT_PROPERTIES.lineWidth,
                opacity: 0.7
            }
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

    createFeature = async () => {
        if (!this.geometry.validate(this.drawPoints)) {
            alert('Linha deve ter pelo menos 2 pontos válidos');
            this.drawPoints = [];
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = await IDUtils.generateFeatureName('line', this.map);
        const coordinates = [...this.drawPoints];

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddLineControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                id: featureId,
                nome: featureName,
                baseCoordinates: coordinates,
                profileData: JSON.stringify(await this.calculateProfile(coordinates))
            },
            geometry: this.geometry.generate(coordinates)
        };

        try {
            await addFeature('lines', feature);

            const data = await this.map.getSource('lines').getData();
            data.features.push(feature);
            this.map.getSource('lines').setData(data);

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('line', featureId, feature);
            this.selectionManager.updateUI();

            this.updateFeatureMeasurement(feature);
        } catch (error) {
            console.error('Error creating line:', error);
        }
    }

    // ===== EDIT HANDLES SYSTEM =====

    selectFeature = (feature) => {
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupHoverListeners();
    }

    deselectFeature = () => {
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    createEditHandles = (feature) => {
        const handles = this.geometry.createHandles(feature);
        if (!handles || handles.length === 0) return;

        this.map.getSource('line-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        this.map.getSource('line-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('line-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('line-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

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
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['line-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandle = handle;
            // Extract type and index separately (like boundary tool)
            this.activeHandleType = handle.properties.handleType;
            this.activeHandleIndex = handle.properties.index;
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
            e.preventDefault();
        }
    }

    onEditMouseMove = (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    /**
     * Complete edit operation and recalculate profile if enabled
     */
    onEditMouseUp = async () => {
        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature && this.activeHandleType && this.lastPreviewPosition) {
            try {
                // Use geometry.updateFromHandle with separate type and index (like boundary tool)
                const result = this.geometry.updateFromHandle(
                    this.activeHandleType,
                    this.lastPreviewPosition,
                    selectedFeature,
                    this.activeHandleIndex
                );

                if (result) {
                    const updatedFeature = {
                        ...selectedFeature,
                        properties: {
                            ...selectedFeature.properties,
                            baseCoordinates: result.baseCoordinates
                        },
                        geometry: result.geometry
                    };

                    if (updatedFeature.properties.profile && !this.isCalculatingProfile) {
                        try {
                            this.isCalculatingProfile = true;

                            const newProfileData = await this.calculateProfile(result.baseCoordinates);
                            updatedFeature.properties.profileData = JSON.stringify(newProfileData);

                        } catch (error) {
                            console.error('Error recalculating profile:', error);
                        } finally {
                            this.isCalculatingProfile = false;
                        }
                    }

                    await this.forceUpdateMainSource(updatedFeature);
                    this.updateSelectionManagerFeature(updatedFeature);
                    this.createEditHandles(updatedFeature);

                    this.updateUIAfterEdit();

                    this.saveFeatureChanges(updatedFeature);
                    this.updateFeatureMeasurement(updatedFeature);
                }
            } catch (error) {
                console.error('Error during edit completion:', error);
            }
        }

        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateLinePreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType || !this.isDraggingHandle) {
            return;
        }

        // Use calculatePreview with separate type and index (like boundary tool)
        // No mutation of selectedFeature during drag - only visual preview
        const preview = this.geometry.calculatePreview(
            this.activeHandleType,
            newPosition,
            selectedFeature,
            this.activeHandleIndex
        );

        if (preview) {
            this.map.getSource('line-feedback').setData({
                type: 'Feature',
                geometry: preview.geometry,
                properties: {
                    ...selectedFeature.properties,
                    isSelected: true
                }
            });

            this.map.getSource('line-edit-handles').setData({
                type: 'FeatureCollection',
                features: preview.handles
            });
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
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

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
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'lines' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== PROFILE CALCULATION =====

    /**
     * Calculate terrain elevation profile for line
     * @param {Array} coordinates - Line coordinates
     * @returns {Promise<Array>} Profile data with distance and elevation
     */
    async calculateProfile(coordinates) {
        const line = turf.lineString(coordinates);
        const length = turf.length(line, { units: 'meters' });
        const steps = 25;
        const stepLength = length / steps;

        const profileData = [];

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

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('lines').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (property === 'baseCoordinates') {
                    const newGeometry = this.geometry.generate(sourceFeature.properties.baseCoordinates);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }

                if (property === 'profile' && value === true) {
                    try {
                        const coordinates = this.geometry.normalizeBaseCoordinates(sourceFeature.properties.baseCoordinates);
                        const newProfileData = await this.calculateProfile(coordinates);
                        sourceFeature.properties.profileData = JSON.stringify(newProfileData);
                        feature.properties.profileData = JSON.stringify(newProfileData);
                    } catch (error) {
                        console.error('Error recalculating profile for property change:', error);
                    }
                }
            }
        }

        this.map.getSource('lines').setData(data);

        if (property === 'measure') {
            features.forEach(f => {
                if (value) {
                    this.updateFeatureMeasurement(f);
                } else {
                    this.removeFeatureMeasurement(f.properties.id);
                }
            });
        }

        if (property === 'profile' && this.selectionManager) {
            setTimeout(() => {
                this.selectionManager.updateProfile();
            }, 100);
        }

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            return sourceFeature || feature;
        });
        this.updateSelectionManagerFeatures(freshFeatures);

        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('lines').getData();
        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('lines', currentFeature);
                    hasChanges = true;
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            const coordinates = this.geometry.normalizeBaseCoordinates(f.properties.baseCoordinates);
            f.geometry = this.geometry.generate(coordinates);
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
                const data = await this.map.getSource('lines').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('lines').setData(data);
            } catch (error) {
                console.error(`Error removing line ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddLineControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.opacity !== initialProperties.opacity ||
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

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('lines').getData();
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
                        await updateFeature('lines', featureToUpdate);
                    }
                }
            }

            this.map.getSource('lines').setData(data);
            this.updateSelectionManagerFeatures(features);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('line', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'line') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    // ===== UTILITY METHODS =====

    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;

        if (!this.isDraggingHandle) {
            this.activeHandle = null;
            this.activeHandleType = null;
        }

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }

        if (this.dragRecalculateTimeout) {
            clearTimeout(this.dragRecalculateTimeout);
            this.dragRecalculateTimeout = null;
        }
    }

    forceUpdateMainSource = async (feature) => {
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const data = await this.map.getSource('lines').getData();
        const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = {
                ...feature.properties,
                baseCoordinates: feature.properties.baseCoordinates
            };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('lines').setData(data);
        }
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
            console.error('Error saving line changes:', error);
        }
    }

    setupBaseEventListeners = () => {
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeRightClickListener();
        this.cancelPendingUpdates();
    }
}

export default AddLineControl;

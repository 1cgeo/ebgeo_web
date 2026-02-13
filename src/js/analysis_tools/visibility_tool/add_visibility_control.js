// Path: js/analysis_tools/visibility_tool/add_visibility_control.js

import { addFeature, removeFeature, getCurrentMapFeatures, batchUpdateVisibilityFeatures, getActiveLayerIdSync } from '../../store';
import { IDUtils } from '../../utilities';
import { getPointerPosition } from '../../utilities/pointer-utils';
import { addVisibilityAttributesToPanel, addVisibilityParametersToPanel } from './visibility_attributes_panel.js';
import AddVisibilityGeometry from './add_visibility_geometry.js';
import { BaseControl } from '../../tool_manager';

/**
 * Visibility (Viewshed) analysis tool control.
 *
 * Sector-style construction: first click sets observer, second defines radius/bearing.
 * Edit handles: radius (red) + aperture (blue) like sector tool.
 * After handle edit, full viewshed recalculation runs with progress modal.
 */
class AddVisibilityControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        this.startPoint = null;
        this.geometry = new AddVisibilityGeometry();

        // Drawing preview state
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;

        // Edit handle state
        this.isDraggingHandle = false;
        this.activeHandleId = null;
        this._activePointerId = null;

        // Recalculation queue and debounce
        this.recalculateQueue = Promise.resolve();
        this.parameterDebounceTimer = null;
        this.PARAMETER_DEBOUNCE_DELAY = 1000;

        // Progress modal elements
        this.progressModal = null;
        this.progressBar = null;
        this.progressText = null;
        this.progressPercentage = null;

        // Bind pointer event handlers
        this._onEditPointerDown = this._onEditPointerDown.bind(this);
        this._onEditPointerMove = this._onEditPointerMove.bind(this);
        this._onEditPointerUp = this._onEditPointerUp.bind(this);

        this.toolManager.visibilityControl = this;
    }

    static DEFAULT_PROPERTIES = {
        opacity: 0.5,
        source: 'visibility',
        observerHeight: 2,
        targetHeight: 0,
        aperture: 60,
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== SINGLE SOURCE OF TRUTH =====

    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('visibility');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('visibility')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.setupBaseEventListeners();
        this.createProgressModal();
    }

    onRemove = () => {
        this.deactivate();
        this.removeAllEventListeners();

        if (this.progressModal && this.progressModal.parentNode) {
            this.progressModal.parentNode.removeChild(this.progressModal);
        }

        this.map = undefined;
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'visibility-attributes-section';
        try {
            addVisibilityAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating visibility attribute panel:', error);
        }
    }

    createParametersPanel(container, features, _selectionManager, _uiManager) {
        try {
            addVisibilityParametersToPanel(container, features, this);
        } catch (error) {
            console.error('Error creating visibility parameters panel:', error);
        }
    }

    getDragSources() {
        return ['visibility'];
    }

    getEditHandleSources() {
        return ['visibility-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(), this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating visibility selection box:', error);
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
        return ['visibility-visible-layer', 'visibility-obstructed-layer'];
    }

    getSourceNames() {
        return ['visibility'];
    }

    getEditHandleSource() {
        return 'visibility-edit-handles';
    }

    canCopy(_feature) {
        return true;
    }

    canPaste(_feature) {
        return true;
    }

    async prepareForPaste(feature, offset) {
        const oldCenter = this.geometry.normalizeCenter(feature.properties.center);
        if (!oldCenter) return feature;

        const newCenter = [oldCenter[0] + offset.dx, oldCenter[1] + offset.dy];

        try {
            const result = await this.geometry.recalculateFromCoordinates(newCenter, feature, this.map);
            return {
                ...feature,
                properties: {
                    ...feature.properties,
                    center: newCenter,
                    cellData: result.cellData
                },
                geometry: result.geometry
            };
        } catch (error) {
            console.error('Error preparing visibility for paste:', error);
            return feature;
        }
    }

    calculateMoveOffset(feature, referencePoint) {
        const center = this.geometry.normalizeCenter(feature.properties.center);
        if (!center) return [0, 0];
        return [
            center[0] - referencePoint.lng,
            center[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const newCenter = [newCoords.lng, newCoords.lat];
        const translatedGeometry = this.geometry.translateGeometry(feature.geometry, dx, dy);
        return {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: translatedGeometry
        };
    }

    canMove(feature) {
        return !feature.properties?.bloqueado && this.geometry.isTerrainAvailable(this.map);
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        if (!this.geometry.isTerrainAvailable(this.map)) {
            return false;
        }
        this.isActive = true;
        this.startPoint = null;
        this.map.getCanvas().style.cursor = 'crosshair';
    }

    deactivate = () => {
        this.isActive = false;
        this.startPoint = null;
        this.map.getCanvas().style.cursor = '';
        this.clearPreview();
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

    syncEditHandlesAfterDrag = async (movedFeatures) => {
        this.recalculateQueue = this.recalculateQueue.then(async () => {
            await this.recalculateMovedVisibilityFeatures(movedFeatures);
        });
    }

    // ===== EDIT HANDLES SYSTEM =====

    selectFeature = (feature) => {
        this.setupHoverListeners();

        if (this._mapLocked) return;

        // Only show edit handles when terrain is available
        if (!this.geometry.isTerrainAvailable(this.map)) return;

        this.createEditHandles(feature);
        this.setupEditEventListeners();
    }

    deselectFeature = () => {
        this.isDraggingHandle = false;
        this.activeHandleId = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    createEditHandles = (feature) => {
        const props = this.geometry.normalizeFeatureProperties(feature.properties);
        const normalizedFeature = { ...feature, properties: { ...feature.properties, ...props } };

        const handles = this.geometry.createHandles(normalizedFeature);
        if (!handles) return;

        this.map.getSource('visibility-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        if (this.map.getSource('visibility-edit-handles')) {
            this.map.getSource('visibility-edit-handles').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
        if (this.map.getSource('visibility-feedback')) {
            this.map.getSource('visibility-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    setupEditEventListeners = () => {
        const canvas = this.map.getCanvasContainer();
        canvas.addEventListener('pointerdown', this._onEditPointerDown);
    }

    removeEditEventListeners = () => {
        const canvas = this.map.getCanvasContainer();
        canvas.removeEventListener('pointerdown', this._onEditPointerDown);
        canvas.removeEventListener('pointermove', this._onEditPointerMove);
        canvas.removeEventListener('pointerup', this._onEditPointerUp);
        canvas.removeEventListener('pointercancel', this._onEditPointerUp);

        if (this._activePointerId !== null) {
            try {
                canvas.releasePointerCapture(this._activePointerId);
            } catch (_err) {
                // Pointer may have already been released
            }
            this._activePointerId = null;
        }
    }

    _onEditPointerDown(e) {
        if (!e.isPrimary) return;

        // Block handle editing when terrain is off
        if (!this.geometry.isTerrainAvailable(this.map)) return;

        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);

        const handleFeatures = this.map.queryRenderedFeatures([point.x, point.y], {
            layers: ['visibility-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            this.isDraggingHandle = true;
            this.activeHandleId = handleFeatures[0].properties.handleId;
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';

            this._activePointerId = e.pointerId;
            canvas.setPointerCapture(e.pointerId);

            canvas.addEventListener('pointermove', this._onEditPointerMove);
            canvas.addEventListener('pointerup', this._onEditPointerUp);
            canvas.addEventListener('pointercancel', this._onEditPointerUp);

            e.preventDefault();
        }
    }

    _onEditPointerMove(e) {
        if (!e.isPrimary) return;

        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);
        const lngLat = this.map.unproject([point.x, point.y]);

        this.lastPreviewPosition = [lngLat.lng, lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    _onEditPointerUp(_e) {
        const canvas = this.map.getCanvasContainer();

        canvas.removeEventListener('pointermove', this._onEditPointerMove);
        canvas.removeEventListener('pointerup', this._onEditPointerUp);
        canvas.removeEventListener('pointercancel', this._onEditPointerUp);

        if (this._activePointerId !== null) {
            try {
                canvas.releasePointerCapture(this._activePointerId);
            } catch (_err) {
                // Pointer may have already been released
            }
            this._activePointerId = null;
        }

        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature && this.lastPreviewPosition) {
            const normalizedFeature = {
                ...selectedFeature,
                properties: this.geometry.normalizeFeatureProperties(selectedFeature.properties)
            };

            const result = this.geometry.updateFromHandle(this.activeHandleId, this.lastPreviewPosition, normalizedFeature);
            if (result) {
                const center = this.geometry.normalizeCenter(selectedFeature.properties.center);

                // Persist all three geometry params to the map source before recalculation
                selectedFeature.properties.radius = result.radius;
                selectedFeature.properties.bearing = result.bearing;
                selectedFeature.properties.aperture = result.aperture;

                this.updateHandlePropertiesToSource(selectedFeature, result);

                // Trigger full viewshed recalculation
                this.recalculateQueue = this.recalculateQueue.then(async () => {
                    await this.recalculateAfterParameterChange([selectedFeature], center);
                });
            }
        }

        this.isDraggingHandle = false;
        this.activeHandleId = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateHandlePreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleId) return;

        const normalizedFeature = {
            ...selectedFeature,
            properties: this.geometry.normalizeFeatureProperties(selectedFeature.properties)
        };

        const preview = this.geometry.calculatePreview(this.activeHandleId, newPosition, normalizedFeature);
        if (!preview) return;

        // Update directly — already inside RAF via performPreviewUpdate
        this.map.getSource('visibility-feedback').setData({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: preview.geometry,
                properties: { isSelected: true }
            }]
        });

        const [radiusPoint, aperturePoint, centerPoint] = preview.handles;
        this.map.getSource('visibility-edit-handles').setData({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: radiusPoint },
                    properties: {
                        role: 'handle',
                        handleType: 'vertex',
                        handleId: 'radius',
                        user_isEditingHandle: true
                    }
                },
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: aperturePoint },
                    properties: {
                        role: 'handle',
                        handleType: 'eccentricity',
                        handleId: 'aperture',
                        user_isEditingHandle: true
                    }
                },
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: centerPoint },
                    properties: {
                        role: 'handle',
                        handleType: 'center',
                        handleId: 'center',
                        user_isEditingHandle: false
                    }
                }
            ]
        });
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
        const hasHandle = features.some(f =>
            f.source === 'visibility-edit-handles' && f.properties.user_isEditingHandle
        );
        const hasFeature = features.some(f =>
            (f.source === 'processed-visibility' || f.source === 'visibility') &&
            (f.properties.id === selectedFeature.properties.id ||
             f.properties.id?.startsWith(selectedFeature.properties.id + '-'))
        );
        if (hasHandle) {
            this.map.getCanvas().style.cursor = 'crosshair';
        } else if (hasFeature) {
            this.map.getCanvas().style.cursor = 'move';
        } else {
            this.map.getCanvas().style.cursor = '';
        }
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = async (e) => {
        if (!this.isActive || !this.geometry.isTerrainAvailable(this.map)) return;

        const { lng, lat } = e.lngLat;

        if (!this.startPoint) {
            this.startPoint = [lng, lat];
            this.lastPreviewCenter = this.startPoint;
            this.map.on('mousemove', this.handleMouseMove);
        } else {
            const endPoint = [lng, lat];
            this.map.off('mousemove', this.handleMouseMove);
            await this.createFeature(this.startPoint, endPoint);
            this.toolManager.deactivateCurrentTool();
        }
    }

    handleMouseMove = (e) => {
        if (!this.isActive || !this.startPoint) return;

        this.lastPreviewCenter = this.startPoint;
        this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    performPreviewUpdate = () => {
        if (!this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature) {
            this.updateHandlePreview(this.lastPreviewPosition);
        } else if (this.startPoint && this.lastPreviewCenter) {
            // Update directly — already inside RAF
            const aperture = AddVisibilityControl.DEFAULT_PROPERTIES.aperture;
            const previewCoordinates = this.geometry.calculateSectorPreview(
                this.lastPreviewCenter, this.lastPreviewPosition, aperture
            );
            this.showPreview(previewCoordinates);
        }

        this.pendingPreviewUpdate = false;
    }

    showPreview = (coordinates) => {
        this.map.getSource('visibility-feedback').setData({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates]
                },
                properties: { isPreview: true }
            }]
        });
    }

    clearPreview = () => {
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('visibility-feedback')) {
            this.map.getSource('visibility-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async (startPoint, endPoint) => {
        try {
            this.showProgressModal();

            const featureId = IDUtils.generateUniqueId();
            const featureName = await IDUtils.generateFeatureName('visibility', this.map);

            const properties = {
                ...AddVisibilityControl.DEFAULT_PROPERTIES,
                id: featureId,
                nome: featureName,
                layerId: getActiveLayerIdSync(),
            };

            const visibilityFeature = await this.geometry.createVisibilityFeature(
                startPoint,
                endPoint,
                properties,
                this.map,
                (progress, text) => this.updateProgress(progress, text)
            );

            this.updateProgress(85, 'Preparando features processadas...');
            await this.geometry.delay(50);

            const processedFeatures = this.geometry.generateProcessedFeatures(visibilityFeature);

            this.updateProgress(88, 'Salvando no banco de dados...');
            await this.geometry.delay(50);

            await addFeature('visibility', visibilityFeature);
            await batchUpdateVisibilityFeatures(visibilityFeature, processedFeatures);

            this.updateProgress(92, 'Atualizando mapa...');
            await this.geometry.delay(50);

            const data = await this.map.getSource('visibility').getData();
            data.features.push(visibilityFeature);
            this.map.getSource('visibility').setData(data);

            const processedData = await this.map.getSource('processed-visibility').getData();
            processedFeatures.forEach(pf => processedData.features.push(pf));
            this.map.getSource('processed-visibility').setData(processedData);

            this.updateProgress(100, 'Concluído!');
            await this.geometry.delay(300);

            await this.selectionManager.toggleFeatureSelection('visibility', visibilityFeature.properties.id, visibilityFeature);
            this.selectionManager.updateUI();

            this.hideProgressModal();
        } catch (error) {
            console.error('Error creating visibility feature:', error);
            this.hideProgressModal();
        } finally {
            this.startPoint = null;
        }
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = (features, property, value) => {
        const recalcProperties = ['observerHeight', 'targetHeight', 'radius', 'aperture'];

        if (recalcProperties.includes(property)) {
            // Update UI immediately
            this.updatePropertyImmediately(features, property, value);

            // For geometry properties, also update sector outline + handles
            if (property === 'radius' || property === 'aperture') {
                this.updateSectorOutlineFromProperty(features, property, value);
            }

            // Debounce full recalculation
            if (this.parameterDebounceTimer) {
                clearTimeout(this.parameterDebounceTimer);
            }
            this.parameterDebounceTimer = setTimeout(() => {
                this.recalculateAfterParameterChange(features);
            }, this.PARAMETER_DEBOUNCE_DELAY);

            return;
        }

        this.updatePropertyImmediately(features, property, value);
    }

    /**
     * Update sector outline and edit handles when radius or aperture change via slider.
     */
    updateSectorOutlineFromProperty = (features, property, value) => {
        const feature = features[0];
        if (!feature) return;

        const props = this.geometry.normalizeFeatureProperties(feature.properties);
        if (property === 'radius') props.radius = value;
        if (property === 'aperture') props.aperture = value;

        const center = this.geometry.normalizeCenter(props.center);
        if (!center) return;

        const sectorGeometry = this.geometry.generateSectorGeometry(center, props.radius, props.bearing, props.aperture);
        this.map.getSource('visibility-feedback').setData({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: sectorGeometry,
                properties: { isSelected: true }
            }]
        });

        // Update handle positions
        const normalizedFeature = { ...feature, properties: props };
        const handles = this.geometry.createHandles(normalizedFeature);
        if (handles) {
            this.map.getSource('visibility-edit-handles').setData({
                type: 'FeatureCollection',
                features: handles
            });
        }
    }

    /**
     * Persist radius, bearing and aperture from a handle edit into the map source.
     * Must be called synchronously after handle drag so recalculation reads fresh values.
     */
    updateHandlePropertiesToSource = async (feature, result) => {
        const data = await this.map.getSource('visibility').getData();
        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties.radius = result.radius;
            sourceFeature.properties.bearing = result.bearing;
            sourceFeature.properties.aperture = result.aperture;
        }
        this.map.getSource('visibility').setData(data);
        this.updateSelectionManagerFeature(feature);
    }

    updatePropertyImmediately = async (features, property, value) => {
        const data = await this.map.getSource('visibility').getData();
        const processedData = await this.map.getSource('processed-visibility').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                const processedFeatures = processedData.features.filter(f =>
                    f.properties.id.startsWith(feature.properties.id + '-')
                );
                processedFeatures.forEach(pf => {
                    if (property !== 'color') {
                        pf.properties[property] = value;
                    }
                });
            }
        }

        this.map.getSource('visibility').setData(data);
        this.map.getSource('processed-visibility').setData(processedData);

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            return sourceFeature || feature;
        });
        this.updateSelectionManagerFeatures(freshFeatures);
    }

    // ===== RECALCULATION =====

    /**
     * Recalculate viewshed after parameter change (height, divisions, radius, aperture).
     */
    recalculateAfterParameterChange = async (features, overrideCenter = null) => {
        try {
            this.showProgressModal();
            this.updateProgress(5, 'Preparando recálculo...');
            await this.geometry.delay(50);

            const data = await this.map.getSource('visibility').getData();
            const processedData = await this.map.getSource('processed-visibility').getData();

            for (const feature of features) {
                const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
                if (!sourceFeature) continue;

                try {
                    const center = overrideCenter || this.geometry.normalizeCenter(sourceFeature.properties.center);
                    if (!center) continue;

                    const result = await this.geometry.recalculateFromCoordinates(
                        center,
                        sourceFeature,
                        this.map,
                        (progress, text) => this.updateProgress(progress, text)
                    );

                    this.updateProgress(85, 'Atualizando geometria...');
                    await this.geometry.delay(50);

                    sourceFeature.geometry = result.geometry;
                    sourceFeature.properties.cellData = result.cellData;
                    sourceFeature.properties.center = result.center;
                    feature.geometry = result.geometry;
                    feature.properties.cellData = result.cellData;
                    feature.properties.center = result.center;

                    const newProcessedFeatures = this.geometry.generateProcessedFeatures(sourceFeature);

                    this.updateProgress(88, 'Salvando no banco de dados...');
                    await this.geometry.delay(50);

                    await batchUpdateVisibilityFeatures(sourceFeature, newProcessedFeatures);

                    // Update processed source
                    processedData.features = processedData.features.filter(f =>
                        !f.properties.id.startsWith(feature.properties.id + '-')
                    );
                    newProcessedFeatures.forEach(pf => processedData.features.push(pf));

                } catch (error) {
                    console.error('Error recalculating visibility:', error);
                }
            }

            this.updateProgress(95, 'Atualizando mapa...');
            await this.geometry.delay(50);

            this.map.getSource('visibility').setData(data);
            this.map.getSource('processed-visibility').setData(processedData);

            // Clear temporary sector outline from slider interaction
            this.map.getSource('visibility-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });

            const freshFeatures = features.map(feature => {
                const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
                return sourceFeature || feature;
            });
            this.updateSelectionManagerFeatures(freshFeatures);

            // Refresh edit handles
            const selectedFeature = this.getSelectedFeature();
            if (selectedFeature) {
                this.createEditHandles(selectedFeature);
            }

            this.updateProgress(100, 'Recálculo concluído!');
            await this.geometry.delay(300);

        } catch (error) {
            console.error('Error in parameter change recalculation:', error);
        } finally {
            this.hideProgressModal();
            this.parameterDebounceTimer = null;
        }
    }

    /**
     * Recalculate visibility features after movement.
     */
    async recalculateMovedVisibilityFeatures(movedFeatures) {
        for (const movedFeature of movedFeatures) {
            if (movedFeature.properties.source === 'visibility') {
                try {
                    this.showProgressModal();
                    this.updateProgress(5, 'Detectando nova posição...');
                    await this.geometry.delay(50);

                    const newCenter = this.geometry.normalizeCenter(movedFeature.properties.center);
                    if (!newCenter) continue;

                    this.updateProgress(10, 'Preparando recálculo...');
                    await this.geometry.delay(50);

                    const result = await this.geometry.recalculateFromCoordinates(
                        newCenter,
                        movedFeature,
                        this.map,
                        (progress, text) => this.updateProgress(progress, text)
                    );

                    this.updateProgress(85, 'Atualizando geometria...');
                    await this.geometry.delay(50);

                    movedFeature.geometry = result.geometry;
                    movedFeature.properties.center = result.center;
                    movedFeature.properties.cellData = result.cellData;

                    const newProcessedFeatures = this.geometry.generateProcessedFeatures(movedFeature);

                    this.updateProgress(90, 'Salvando no banco de dados...');
                    await this.geometry.delay(50);

                    await batchUpdateVisibilityFeatures(movedFeature, newProcessedFeatures);

                    this.updateProgress(95, 'Atualizando fontes do mapa...');
                    await this.geometry.delay(50);

                    await this.updateProcessedFeaturesAfterMove(movedFeature, newProcessedFeatures);

                    // Refresh edit handles
                    const selectedFeature = this.getSelectedFeature();
                    if (selectedFeature && selectedFeature.properties.id === movedFeature.properties.id) {
                        this.createEditHandles(movedFeature);
                    }

                    this.updateProgress(100, 'Recálculo concluído!');
                    await this.geometry.delay(300);

                } catch (error) {
                    console.error('Error during visibility recalculation:', error);
                } finally {
                    this.hideProgressModal();
                }
            }
        }
    }

    async updateProcessedFeaturesAfterMove(mainFeature, newProcessedFeatures = null) {
        const processedData = await this.map.getSource('processed-visibility').getData();

        processedData.features = processedData.features.filter(f =>
            !f.properties.id.startsWith(mainFeature.properties.id + '-')
        );

        const processedFeatures = newProcessedFeatures || this.geometry.generateProcessedFeatures(mainFeature);
        processedFeatures.forEach(pf => processedData.features.push(pf));

        this.map.getSource('processed-visibility').setData(processedData);
    }

    // ===== SAVE / DISCARD / DELETE =====

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('visibility').getData();
        const processedData = await this.map.getSource('processed-visibility').getData();

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: {
                            ...currentFeature.properties,
                            ...selectedFeature.properties
                        }
                    };

                    const processedFeatures = processedData.features.filter(pf =>
                        pf.properties.id.startsWith(selectedFeature.properties.id + '-')
                    ).map(pf => ({
                        ...pf,
                        properties: {
                            ...pf.properties,
                            ...selectedFeature.properties,
                            id: pf.properties.id,
                            color: pf.properties.color
                        }
                    }));

                    try {
                        await batchUpdateVisibilityFeatures(featureToSave, processedFeatures);
                    } catch (error) {
                        console.error('Error saving visibility features:', error);
                        throw error;
                    }
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
        });
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                await removeFeature('visibility', feature.properties.id);
            } catch (error) {
                console.error(`Error removing visibility feature ${feature.properties.id}:`, error);
            }
        }

        const currentMapFeatures = await getCurrentMapFeatures();

        this.map.getSource('visibility').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.visibility
        });

        this.map.getSource('processed-visibility').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.processed_visibility
        });
    }

    setDefaultProperties = (properties) => {
        const {
            id: _id, nome: _nome, cellData: _cellData,
            center: _center, radius: _radius, bearing: _bearing,
            ...styleProperties
        } = properties;
        Object.assign(AddVisibilityControl.DEFAULT_PROPERTIES, styleProperties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;
        return (
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.observerHeight !== initialProperties.observerHeight ||
            feature.properties.targetHeight !== initialProperties.targetHeight ||
            feature.properties.radius !== initialProperties.radius ||
            feature.properties.aperture !== initialProperties.aperture ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length === 0) return;

        const data = await this.map.getSource('visibility').getData();
        const processedData = await this.map.getSource('processed-visibility').getData();

        for (const feature of features) {
            const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
            if (featureIndex !== -1) {
                if (onlyUpdateProperties) {
                    Object.assign(data.features[featureIndex].properties, feature.properties);

                    const processedFeatures = processedData.features.filter(f =>
                        f.properties.id.startsWith(feature.properties.id + '-')
                    );
                    processedFeatures.forEach(pf => {
                        Object.keys(feature.properties).forEach(key => {
                            if (key !== 'color') {
                                pf.properties[key] = feature.properties[key];
                            }
                        });
                    });
                } else {
                    data.features[featureIndex] = feature;
                }

                if (save) {
                    const processedFeatures = processedData.features.filter(f =>
                        f.properties.id.startsWith(feature.properties.id + '-')
                    );
                    await batchUpdateVisibilityFeatures(data.features[featureIndex], processedFeatures);
                }
            }
        }

        this.map.getSource('visibility').setData(data);
        this.map.getSource('processed-visibility').setData(processedData);
        this.updateSelectionManagerFeatures(features);
    }

    // ===== PROGRESS MODAL SYSTEM =====

    createProgressModal = () => {
        this.progressModal = document.createElement('div');
        this.progressModal.className = 'visibility-progress-modal';

        const modalContent = document.createElement('div');
        modalContent.className = 'visibility-progress-modal__content';

        const title = document.createElement('h3');
        title.className = 'visibility-progress-modal__title';
        title.textContent = 'Calculando Visibilidade';

        this.progressText = document.createElement('p');
        this.progressText.className = 'visibility-progress-modal__text';
        this.progressText.textContent = 'Analisando terreno...';

        const progressContainer = document.createElement('div');
        progressContainer.className = 'visibility-progress-modal__bar-container';

        this.progressBar = document.createElement('div');
        this.progressBar.className = 'visibility-progress-modal__bar';

        this.progressPercentage = document.createElement('div');
        this.progressPercentage.className = 'visibility-progress-modal__percentage';
        this.progressPercentage.textContent = '0%';

        progressContainer.appendChild(this.progressBar);
        modalContent.appendChild(title);
        modalContent.appendChild(this.progressText);
        modalContent.appendChild(progressContainer);
        modalContent.appendChild(this.progressPercentage);
        this.progressModal.appendChild(modalContent);
        document.body.appendChild(this.progressModal);
    }

    showProgressModal = () => {
        this.progressModal.classList.add('visibility-progress-modal--visible');
        this.updateProgress(0, 'Iniciando análise...');
    }

    updateProgress = (percentage, text = null) => {
        this.progressBar.style.width = `${percentage}%`;
        this.progressPercentage.textContent = `${Math.round(percentage)}%`;

        if (text) {
            this.progressText.textContent = text;
        }
    }

    hideProgressModal = () => {
        this.progressModal.classList.remove('visibility-progress-modal--visible');
        this.updateProgress(0, 'Analisando terreno...');
    }

    // ===== TERRAIN INTEGRATION =====

    setupBaseEventListeners = () => {
        this.map.on('terrain', this._onTerrainChange);
        this._onTerrainChange();
    }

    _onTerrainChange = () => {
        const terrainAvailable = this.geometry.isTerrainAvailable(this.map);

        // If tool is active and terrain is off, deactivate tool
        if (this.isActive && !terrainAvailable) {
            this.toolManager.deactivateCurrentTool();
        }

        // Reactively show/hide handles based on terrain state
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature) {
            if (terrainAvailable) {
                this.createEditHandles(selectedFeature);
                this.setupEditEventListeners();
            } else {
                this.clearEditHandles();
                this.removeEditEventListeners();
            }
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('visibility', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'visibility') {
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
        this.lastPreviewCenter = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }

        if (this.parameterDebounceTimer) {
            clearTimeout(this.parameterDebounceTimer);
            this.parameterDebounceTimer = null;
        }
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handleMouseMove);
        this.map.off('terrain', this._onTerrainChange);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
    }
}

export default AddVisibilityControl;

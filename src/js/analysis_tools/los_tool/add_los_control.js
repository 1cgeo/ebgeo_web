// Path: js/analysis_tools/los_tool/add_los_control.js

import { queryFeaturesAtPoint } from '@tools/helpers/feature-hit-test.helpers.js';
import { addFeature, updateFeature, removeFeature, getCurrentMapFeatures, batchUpdateLOSFeatures, getActiveLayerIdSync } from '@store';
import { IDUtils } from '@utils';
import { getPointerPosition } from '@utils/pointer-utils';
import { addLOSAttributesToPanel, createLOSInfoSection, addLOSParametersToPanel } from './los_attributes_panel.js';
import AddLOSGeometry from './add_los_geometry.js';
import { BaseControl } from '@tools';
import { createPreviewScheduler } from '@tools/helpers/preview-scheduler.js';
import { getSnappingService } from '@js/snapping';

/**
 * Layers onHoverMove needs: the handle layer plus the two layers that draw the
 * LOS itself ('processed-los-layer' carries the green/red halves, 'los-layer' the
 * invisible full line that keeps the feature pickable).
 */
const HOVER_LAYER_IDS = ['los-edit-handles-layer', 'los-layer', 'processed-los-layer'];

class AddLOSControl extends BaseControl {
    featureType = 'los';
    constructor(toolManager) {
        super(toolManager);

        this.startPoint = null;
        this.endPoint = null;
        this.geometry = new AddLOSGeometry();
        // ONE rAF gate for the segment preview: the raw `mousemove` parks a
        // pointer, the frame resolves the snap once and draws once.
        this._previewScheduler = createPreviewScheduler({
            raf: (callback) => requestAnimationFrame(callback),
            caf: (id) => cancelAnimationFrame(id),
            onFrame: (pointer) => this.performPreviewUpdate(pointer),
        });
        // The indicator BEFORE the first click gets its own gate: it is armed by
        // `activate()` and swapped for the drawing preview on that first click.
        this._preClickScheduler = createPreviewScheduler({
            raf: (callback) => requestAnimationFrame(callback),
            caf: (id) => cancelAnimationFrame(id),
            onFrame: (pointer) => this._updatePreClickSnap(pointer),
        });
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        // Edit handle state: dragging the observer or the target node.
        this.isDraggingHandle = false;
        this.activeHandleId = null;
        this._activePointerId = null;

        // Third gate, same pattern as the two above: the handle drag resolves
        // the snap once per frame and redraws the preview once.
        this._handleScheduler = createPreviewScheduler({
            raf: (callback) => requestAnimationFrame(callback),
            caf: (id) => cancelAnimationFrame(id),
            onFrame: (pointer) => this.performHandlePreviewUpdate(pointer),
        });

        this._onEditPointerDown = this._onEditPointerDown.bind(this);
        this._onEditPointerMove = this._onEditPointerMove.bind(this);
        this._onEditPointerUp = this._onEditPointerUp.bind(this);

        this.toolManager.losControl = this;
        this._name = 'AddLOSControl';
    }

    static DEFAULT_PROPERTIES = {
        opacity: 1,
        width: 5,
        profile: true,
        measure: false,
        source: 'los',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false,
        observerHeight: 1.5,
        targetHeight: 0,
        samplePoints: 100
    };

    onAdd = (map) => {
        this.map = map;
        this.setupBaseEventListeners();
    }

    onRemove = () => {
        this.deactivate();
        this.removeAllEventListeners();
        this.map = undefined;
    }

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'los-attributes-section';

        try {
            addLOSAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating LOS attribute panel:', error);
        }
    }

    /**
     * Creates the info section displayed before tabs (shows length information)
     * @param {Object} feature - The selected LOS feature
     * @returns {HTMLElement|null} Info section element or null
     */
    createInfoSection(feature) {
        if (!feature || !feature.properties) {
            return null;
        }
        return createLOSInfoSection(feature);
    }

    /**
     * Updates the info section in the sidebar without rebuilding the entire panel.
     * Called after recalculation to refresh lengths and coordinates.
     * @param {Object} feature - Updated LOS feature
     */
    updateInfoSection(feature) {
        if (!feature || !feature.properties) return;

        const existingSection = document.querySelector('.los-info-section');
        if (!existingSection) return;

        const newSection = createLOSInfoSection(feature);
        existingSection.replaceWith(newSection);
    }

    createParametersPanel(container, features, _selectionManager, _uiManager) {
        try {
            addLOSParametersToPanel(container, features, this);
        } catch (error) {
            console.error('Error creating LOS parameters panel:', error);
        }
    }

    getDragSources() {
        return [];
    }

    getEditHandleSources() {
        return ['los-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const coordinates = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
            if (coordinates && coordinates.length === 2) {
                const bbox = this.geometry.getBoundingBox(coordinates);
                const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
                return turf.bboxPolygon(expandedBbox);
            }
            return turf.bbox(feature);
        } catch (error) {
            console.warn('Error creating LOS selection box:', error);
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
        return ['los-visible-layer', 'los-obstructed-layer'];
    }

    getSourceNames() {
        return ['los'];
    }

    getEditHandleSource() {
        return 'los-edit-handles';
    }

    canCopy(_feature) {
        return true;
    }

    canPaste(_feature) {
        return true;
    }

    async prepareForPaste(feature, offset) {
        const oldCoords = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
        if (!oldCoords) return feature;

        const newCoords = oldCoords.map(coord => [
            coord[0] + offset.dx,
            coord[1] + offset.dy
        ]);

        try {
            const options = {
                observerHeight: feature.properties.observerHeight ?? 1.5,
                targetHeight: feature.properties.targetHeight ?? 0,
                samplePoints: feature.properties.samplePoints ?? 100
            };

            const result = await this.geometry.recalculateFromCoordinates(newCoords, this.map, options);

            return {
                ...feature,
                properties: {
                    ...feature.properties,
                    profileData: JSON.stringify(result.profileData),
                    visibleLength: result.visibleLength,
                    obstructedLength: result.obstructedLength,
                    totalLength: result.totalLength
                },
                geometry: result.geometry
            };
        } catch (error) {
            console.error('Error preparing LOS for paste:', error);
            return feature;
        }
    }

    /**
     * A LOS is never dragged. Dragging translates the line without re-reading the
     * terrain under it, so the green/red split and the profile stay from the old
     * position until the drag ends. The observer and the target move by their own
     * handles, which recalculate on release.
     * @returns {boolean} Always false
     */
    canMove(_feature) {
        return false;
    }

    activate = () => {
        if (!this.geometry.isTerrainAvailable(this.map)) {
            return false;
        }
        this.isActive = true;
        this.startPoint = null;
        this.endPoint = null;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('mousemove', this._onPreClickMouseMove);
    }

    deactivate = () => {
        this.isActive = false;
        this.startPoint = null;
        this.endPoint = null;
        this.map.getCanvas().style.cursor = '';
        this.map.off('mousemove', this._onPreClickMouseMove);
        getSnappingService()?.hideIndicator(this.map);
        this.clearPreview();
    }

    onFeatureSelected = (feature) => {
        this.selectFeature(feature);
    }

    onFeatureDeselected = (feature) => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && selectedFeature.properties.id === feature.properties.id) {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        if (this.getSelectedFeature()) {
            this.deselectFeature();
        }
    }

    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (featureId) => {
        const selectedFeature = this.getSelectedFeature();
        return Boolean(selectedFeature && selectedFeature.properties.id === featureId);
    }

    // =========================================================================
    // EDIT HANDLES (observer / target)
    // =========================================================================

    selectFeature = (feature) => {
        this.setupHoverListeners();

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
        const handles = this.geometry.createHandles(feature);
        if (!handles) return;

        this.map.getSource('los-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        if (this.map.getSource('los-edit-handles')) {
            this.map.getSource('los-edit-handles').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
        this.clearPreview();
    }

    setupEditEventListeners = () => {
        this.map.getCanvasContainer().addEventListener('pointerdown', this._onEditPointerDown);
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
        if (!this.geometry.isTerrainAvailable(this.map)) return;
        if (!this.getSelectedFeature()) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);

        const handleFeatures = this.map.queryRenderedFeatures([point.x, point.y], {
            layers: ['los-edit-handles-layer']
        });
        if (handleFeatures.length === 0) return;

        this.isDraggingHandle = true;
        this.activeHandleId = handleFeatures[0].properties.handleId;
        this.lastPreviewPosition = null;
        this.map.dragPan.disable();
        this.map.getCanvas().style.cursor = 'grabbing';

        this._activePointerId = e.pointerId;
        canvas.setPointerCapture(e.pointerId);

        canvas.addEventListener('pointermove', this._onEditPointerMove);
        canvas.addEventListener('pointerup', this._onEditPointerUp);
        canvas.addEventListener('pointercancel', this._onEditPointerUp);

        e.preventDefault();
    }

    _onEditPointerMove(e) {
        if (!e.isPrimary) return;

        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);
        this._handleScheduler.request({ point, lngLat: this.map.unproject([point.x, point.y]) });
    }

    performHandlePreviewUpdate = (pointer) => {
        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature || !pointer) return;

        // The snap is resolved ONCE per frame, here, and never on the raw motion
        // event: a mousemove fires several times per frame and each resolve costs
        // a feature query.
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, pointer.point, pointer.lngLat, selectedFeature.properties?.id) ?? pointer.lngLat;
        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }
        this.lastPreviewPosition = [snap.lng, snap.lat];

        const result = this.geometry.updateFromHandle(this.activeHandleId, this.lastPreviewPosition, selectedFeature);
        if (!result) return;

        this.showPreview(this.geometry.generate(result.coordinates));
        this.updateHandlePositions(result.coordinates);
    }

    /**
     * Redraw both handles at the given endpoints, keeping their roles.
     * @param {Array} coordinates - [start, end]
     */
    updateHandlePositions = (coordinates) => {
        const source = this.map.getSource('los-edit-handles');
        if (!source) return;

        source.setData({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: coordinates[0] },
                    properties: { role: 'handle', handleType: 'observer', handleId: 'start', user_isEditingHandle: true }
                },
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: coordinates[1] },
                    properties: { role: 'handle', handleType: 'target', handleId: 'end', user_isEditingHandle: true }
                }
            ]
        });
    }

    _onEditPointerUp(_e) {
        // A drag whose down, move and up land in the SAME frame still has its
        // pointer parked: without the flush the edit would be dropped.
        this._handleScheduler.flush();
        getSnappingService()?.hideIndicator(this.map);

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
        const wasDragging = this.isDraggingHandle;
        const handleId = this.activeHandleId;
        const position = this.lastPreviewPosition;

        this.isDraggingHandle = false;
        this.activeHandleId = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';

        if (!wasDragging || !selectedFeature || !position) return;

        const result = this.geometry.updateFromHandle(handleId, position, selectedFeature);
        if (!result) {
            this.clearPreview();
            this.createEditHandles(selectedFeature);
            return;
        }

        this.applyHandleEdit(selectedFeature, result.coordinates);
    }

    /**
     * Re-run the full analysis on the endpoints the handle just dropped. Reuses
     * the parameter-change path, which rebuilds the processed halves, writes both
     * sources, persists, and refreshes the info section and the profile chart.
     * The endpoints are PASSED, not read back from the source, so nothing depends
     * on a setData landing before the next getData.
     * @param {Object} feature - Selected LOS feature
     * @param {Array} coordinates - [start, end]
     */
    applyHandleEdit = async (feature, coordinates) => {
        try {
            feature.geometry = this.geometry.generate(coordinates);

            await this._performRecalculation([feature], coordinates);

            this.clearPreview();

            const refreshed = this.getSelectedFeature();
            if (refreshed) {
                this.createEditHandles(refreshed);
            }

            // The bbox moved with the endpoint; the highlight has to follow it.
            this.selectionManager.uiManager?.updateSelectionHighlight?.();
        } catch (error) {
            console.error('Error applying LOS handle edit:', error);
            this.clearPreview();
        }
    }

    setupHoverListeners = () => {
        this.map.on('mousemove', this.onHoverMove);
    }

    removeHoverListeners = () => {
        this.map.off('mousemove', this.onHoverMove);
    }

    onHoverMove = (e) => {
        if (this.isDraggingHandle) return;
        if (!this.getSelectedFeature()) return;

        const features = queryFeaturesAtPoint(this.map, e.point, { layers: HOVER_LAYER_IDS });
        const hasHandle = features.some(f =>
            f.source === 'los-edit-handles' && f.properties.user_isEditingHandle
        );
        this.map.getCanvas().style.cursor = hasHandle ? 'crosshair' : '';
    }

    /**
     * Show recalculating state visual feedback
     */
    showRecalculatingState() {
        this.map.getCanvas().style.cursor = 'wait';
        this.map.off('click', this.handleMapClick);

        if (this.container) {
            this.container.classList.add('recalculating');
        }
    }

    /**
     * Hide recalculating state visual feedback
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

    _onPreClickMouseMove = (e) => {
        this._preClickScheduler.request({ point: e.point, lngLat: e.lngLat });
    }

    /**
     * @param {Object} pointer - The frame's last `{ point, lngLat }`
     * @private
     */
    _updatePreClickSnap = (pointer) => {
        if (!pointer || !this.map) return;

        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, pointer.point, pointer.lngLat);
        if (snap?.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }
    }

    handleMapClick = async (e) => {
        if (!this.isActive || !this.geometry.isTerrainAvailable(this.map)) return;

        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;

        if (!this.startPoint) {
            this.startPoint = [snap.lng, snap.lat];
            this.lastPreviewCenter = this.startPoint;
            snapping?.hideIndicator(this.map);
            this.map.off('mousemove', this._onPreClickMouseMove);
            this.map.on('mousemove', this.handleMouseMove);
        } else {
            this.endPoint = [snap.lng, snap.lat];
            snapping?.hideIndicator(this.map);
            this.map.off('mousemove', this.handleMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    /**
     * Park the pointer and ask for a frame. The snap is resolved inside the
     * gate's callback, once per frame, for the reason on `_onPreClickMouseMove`.
     */
    handleMouseMove = (e) => {
        if (!this.isActive || !this.startPoint) return;

        this._previewScheduler.request({ point: e.point, lngLat: e.lngLat });
    }

    /**
     * The frame callback: resolve the snap ONCE, move the indicator, then draw.
     * @param {Object} [pointer] - The frame's last `{ point, lngLat }`, when a
     *   pointer event parked one.
     */
    performPreviewUpdate = (pointer) => {
        if (pointer) {
            const snapping = getSnappingService();
            const snap = snapping?.resolve(this.map, pointer.point, pointer.lngLat) ?? pointer.lngLat;

            if (snap.snapped) {
                snapping.showIndicator(this.map, snap, snap.snapType);
            } else {
                snapping?.hideIndicator(this.map);
            }

            this.lastPreviewCenter = this.startPoint;
            this.lastPreviewPosition = [snap.lng, snap.lat];
        }

        if (!this.lastPreviewCenter || !this.lastPreviewPosition) return;

        // No timer: this already runs at most once per frame, and the 8 ms
        // debounce it used to carry coalesced nothing (8 ms is under the 16.7 ms
        // of a frame). Removed 2026-09-04.
        const previewGeometry = this.geometry.generate([this.lastPreviewCenter, this.lastPreviewPosition]);
        this.showPreview(previewGeometry);
    }

    showPreview = (geometry) => {
        this.map.getSource('los-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {}
        });
    }

    clearPreview = () => {
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('los-feedback')) {
            this.map.getSource('los-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        if (!this.startPoint || !this.endPoint) return;

        try {
            const coordinates = [this.startPoint, this.endPoint];
            const featureId = IDUtils.generateUniqueId();
            const featureName = await IDUtils.generateFeatureName('los', this.map);

            const properties = {
                ...AddLOSControl.DEFAULT_PROPERTIES,
                id: featureId,
                nome: featureName,
                layerId: getActiveLayerIdSync(),
            };

            const losFeature = await this.geometry.createLOSFeature(coordinates, properties, this.map);
            await addFeature('los', losFeature);
            this.updateFeatureMeasurement(losFeature);

            const data = await this.map.getSource('los').getData();
            data.features.push(losFeature);
            this.map.getSource('los').setData(data);

            const processedFeatures = this.geometry.generateProcessedFeatures(losFeature);
            const processedData = await this.map.getSource('processed-los').getData();

            for (const processedFeature of processedFeatures) {
                await addFeature('processed_los', processedFeature);
                processedData.features.push(processedFeature);
            }

            this.map.getSource('processed-los').setData(processedData);

            await this.selectionManager.toggleFeatureSelection('los', losFeature.properties.id, losFeature);
            this.selectionManager.updateUI();

        } catch (error) {
            console.error('Error creating LOS feature:', error);
        } finally {
            this.startPoint = null;
            this.endPoint = null;
        }
    }

    updateFeaturesProperty = async (features, property, value) => {
        const requiresRecalculation = ['observerHeight', 'targetHeight', 'samplePoints'].includes(property);

        if (requiresRecalculation) {
            await this.updateFeaturesWithRecalculation(features, property, value);
            return;
        }

        const data = await this.map.getSource('los').getData();
        const processedData = await this.map.getSource('processed-los').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (property === 'measure') {
                    this.updateFeatureMeasurement(feature);
                }

                const processedFeatures = processedData.features.filter(f =>
                    f.properties.id === feature.properties.id + '-visible' ||
                    f.properties.id === feature.properties.id + '-obstructed'
                );
                processedFeatures.forEach(processedFeature => {
                    if (property !== 'color') {
                        processedFeature.properties[property] = value;
                    }
                });
            }
        }

        this.map.getSource('los').setData(data);
        this.map.getSource('processed-los').setData(processedData);

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            return sourceFeature || feature;
        });

        this.updateSelectionManagerFeatures(freshFeatures);
    }

    /**
     * Update features with recalculation (for observer height, target height, sample points)
     * Uses debounce to wait for user to finish dragging slider before recalculating
     * @param {Array} features - Features to update
     * @param {string} property - Property being changed
     * @param {*} value - New property value
     */
    updateFeaturesWithRecalculation = async (features, property, value) => {
        if (!this._pendingRecalculation) {
            this._pendingRecalculation = new Map();
        }

        for (const feature of features) {
            const featureId = feature.properties.id;
            if (!this._pendingRecalculation.has(featureId)) {
                this._pendingRecalculation.set(featureId, {});
            }
            this._pendingRecalculation.get(featureId)[property] = value;

            feature.properties[property] = value;
        }

        clearTimeout(this._recalculationDebounceTimer);
        this._recalculationDebounceTimer = setTimeout(async () => {
            await this._performRecalculation(features);
        }, 500);
    }

    /**
     * Perform the actual recalculation after debounce
     * @private
     */
    _performRecalculation = async (features, overrideCoordinates = null) => {
        this.showRecalculatingState();

        try {
            const data = await this.map.getSource('los').getData();
            const processedData = await this.map.getSource('processed-los').getData();

            for (const feature of features) {
                const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
                if (sourceFeature) {
                    const pendingChanges = this._pendingRecalculation?.get(feature.properties.id) || {};
                    Object.assign(sourceFeature.properties, pendingChanges);
                    Object.assign(feature.properties, pendingChanges);

                    // The handle path passes the endpoints it just dropped, instead
                    // of trusting that this getData() already sees the setData() that
                    // wrote them.
                    const coordinates = overrideCoordinates
                        || this.geometry.extractCoordinatesFromGeometry(sourceFeature.geometry);
                    if (coordinates) {
                        const options = {
                            observerHeight: sourceFeature.properties.observerHeight,
                            targetHeight: sourceFeature.properties.targetHeight,
                            samplePoints: sourceFeature.properties.samplePoints
                        };

                        const result = await this.geometry.recalculateFromCoordinates(coordinates, this.map, options);

                        sourceFeature.geometry = result.geometry;
                        sourceFeature.properties.profileData = JSON.stringify(result.profileData);
                        sourceFeature.properties.visibleLength = result.visibleLength;
                        sourceFeature.properties.obstructedLength = result.obstructedLength;
                        sourceFeature.properties.totalLength = result.totalLength;

                        feature.geometry = result.geometry;
                        feature.properties.profileData = sourceFeature.properties.profileData;
                        feature.properties.visibleLength = result.visibleLength;
                        feature.properties.obstructedLength = result.obstructedLength;
                        feature.properties.totalLength = result.totalLength;

                        processedData.features = processedData.features.filter(f =>
                            f.properties.id !== feature.properties.id + '-visible' &&
                            f.properties.id !== feature.properties.id + '-obstructed'
                        );

                        const newProcessedFeatures = this.geometry.generateProcessedFeatures(sourceFeature);
                        processedData.features.push(...newProcessedFeatures);

                        if (sourceFeature.properties.measure) {
                            this.updateFeatureMeasurement(sourceFeature);
                        }

                        if (typeof batchUpdateLOSFeatures === 'function') {
                            await batchUpdateLOSFeatures(sourceFeature, newProcessedFeatures);
                        } else {
                            await updateFeature('los', sourceFeature);
                            for (const processedFeature of newProcessedFeatures) {
                                await updateFeature('processed_los', processedFeature);
                            }
                        }
                    }
                }
            }

            this.map.getSource('los').setData(data);
            this.map.getSource('processed-los').setData(processedData);

            const freshFeatures = features.map(feature => {
                const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
                return sourceFeature || feature;
            });

            this.updateSelectionManagerFeatures(freshFeatures);

            // Update info section + profile only; a full updateUI() would reset the active tab
            if (freshFeatures.length > 0) {
                this.updateInfoSection(freshFeatures[0]);
            }
            this.selectionManager.updateProfile();

            this._pendingRecalculation?.clear();
        } catch (error) {
            console.error('Error recalculating LOS:', error);
        } finally {
            this.hideRecalculatingState();
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('los').getData();
        const processedData = await this.map.getSource('processed-los').getData();

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
                        pf.properties.id === selectedFeature.properties.id + '-visible' ||
                        pf.properties.id === selectedFeature.properties.id + '-obstructed'
                    );

                    const updatedProcessedFeatures = processedFeatures.map(pf => ({
                        ...pf,
                        properties: {
                            ...pf.properties,
                            ...selectedFeature.properties,
                            id: pf.properties.id,
                            color: pf.properties.color
                        }
                    }));

                    try {
                        if (typeof batchUpdateLOSFeatures === 'function') {
                            await batchUpdateLOSFeatures(featureToSave, updatedProcessedFeatures);
                        } else {
                            await updateFeature('los', featureToSave);
                            for (const processedFeature of updatedProcessedFeatures) {
                                await updateFeature('processed_los', processedFeature);
                            }
                        }
                    } catch (error) {
                        console.error('Error saving LOS features:', error);
                        await updateFeature('los', featureToSave);
                        for (const processedFeature of updatedProcessedFeatures) {
                            await updateFeature('processed_los', processedFeature);
                        }
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
                const featureId = feature.properties.id;

                this.removeFeatureMeasurement(featureId);
                await removeFeature('los', featureId);

            } catch (error) {
                console.error(`Error removing LOS feature ${feature.properties.id}:`, error);
            }
        }

        const currentMapFeatures = await getCurrentMapFeatures();

        this.map.getSource('los').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.los
        });

        this.map.getSource('processed-los').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.processed_los
        });
    }

    setDefaultProperties = (properties) => {
        const {
            id: _id,
            nome: _nome,
            profileData: _profileData,
            ...styleProperties
        } = properties;

        Object.assign(AddLOSControl.DEFAULT_PROPERTIES, styleProperties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.profile !== initialProperties.profile ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.width !== initialProperties.width ||
            feature.properties.measure !== initialProperties.measure ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            feature.properties.observerHeight !== initialProperties.observerHeight ||
            feature.properties.targetHeight !== initialProperties.targetHeight ||
            feature.properties.samplePoints !== initialProperties.samplePoints
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length === 0) return;

        const data = await this.map.getSource('los').getData();
        const processedData = await this.map.getSource('processed-los').getData();

        for (const feature of features) {
            const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
            if (featureIndex !== -1) {
                if (onlyUpdateProperties) {
                    Object.assign(data.features[featureIndex].properties, feature.properties);

                    const processedFeatures = processedData.features.filter(f =>
                        f.properties.id === feature.properties.id + '-visible' ||
                        f.properties.id === feature.properties.id + '-obstructed'
                    );
                    processedFeatures.forEach(processedFeature => {
                        Object.keys(feature.properties).forEach(key => {
                            if (key !== 'color') {
                                processedFeature.properties[key] = feature.properties[key];
                            }
                        });
                    });
                } else {
                    data.features[featureIndex] = feature;
                }

                if (save) {
                    const processedFeatures = processedData.features.filter(f =>
                        f.properties.id === feature.properties.id + '-visible' ||
                        f.properties.id === feature.properties.id + '-obstructed'
                    );

                    if (typeof batchUpdateLOSFeatures === 'function') {
                        await batchUpdateLOSFeatures(data.features[featureIndex], processedFeatures);
                    } else {
                        await updateFeature('los', data.features[featureIndex]);
                        for (const pf of processedFeatures) {
                            await updateFeature('processed_los', pf);
                        }
                    }

                    this.updateFeatureMeasurement(data.features[featureIndex]);
                }
            }
        }

        this.map.getSource('los').setData(data);
        this.map.getSource('processed-los').setData(processedData);
        this.updateSelectionManagerFeatures(features);
    }

    updateFeatureMeasurement = (feature) => {
        this.removeFeatureMeasurement(feature.properties.id);

        if (feature.properties.measure) {
            const coordinates = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
            if (coordinates) {
                const distance = this.geometry.calculateLOSDistance(coordinates);
                const formattedDistance = this.geometry.formatDistance(distance);
                const midpoint = this.geometry.getMidpoint(coordinates);

                this.displayMeasurement(midpoint, formattedDistance, feature.properties.id, feature.properties.layerId);
            }
        }
    }

    removeFeatureMeasurement = (featureId) => {
        // Marker.addTo() registers map listeners that only Marker.remove() detaches;
        // removing just the DOM element leaks them. Track and remove the marker.
        if (!this._measurementMarkers) this._measurementMarkers = new Map();
        const marker = this._measurementMarkers.get(featureId);
        if (marker) {
            marker.remove();
            this._measurementMarkers.delete(featureId);
            return;
        }
        const measurementLabel = document.querySelector(`.measurement-label[data-feature-id="${featureId}"]`);
        if (measurementLabel) {
            measurementLabel.remove();
        }
    }

    displayMeasurement = (coordinates, measurement, featureId, layerId) => {
        if (!this._measurementMarkers) this._measurementMarkers = new Map();
        const existing = this._measurementMarkers.get(featureId);
        if (existing) {
            existing.remove();
            this._measurementMarkers.delete(featureId);
        }
        const markerElement = this.createMeasurementLabel(measurement, featureId, layerId);
        const marker = new maplibregl.Marker({ element: markerElement })
            .setLngLat(coordinates)
            .addTo(this.map);
        this._measurementMarkers.set(featureId, marker);
    }

    createMeasurementLabel = (measurement, featureId, layerId) => {
        const label = document.createElement('div');
        label.className = 'measurement-label';
        label.innerText = measurement;
        label.dataset.featureId = featureId;
        label.dataset.layerId = layerId || 'default';

        return label;
    }

    setupBaseEventListeners = () => {
        this.map.on('terrain', this._onTerrainChange);
        this._onTerrainChange(); // Initial check
    }

    _onTerrainChange = () => {
        const terrainAvailable = this.geometry.isTerrainAvailable(this.map);

        if (this.isActive && !terrainAvailable) {
            this.toolManager.deactivateCurrentTool();
        }

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

    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('los', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'los') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    cancelPendingUpdates = () => {
        // Both gates: the drawing preview and the pre-click indicator.
        this._previewScheduler.cancel();
        this._preClickScheduler.cancel();
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;

        this._handleScheduler.cancel();

        if (this._recalculationDebounceTimer) {
            clearTimeout(this._recalculationDebounceTimer);
            this._recalculationDebounceTimer = null;
        }
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handleMouseMove);
        this.map.off('terrain', this._onTerrainChange);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
    }
}

export default AddLOSControl;

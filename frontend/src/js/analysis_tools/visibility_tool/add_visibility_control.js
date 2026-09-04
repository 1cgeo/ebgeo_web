// Path: js/analysis_tools/visibility_tool/add_visibility_control.js

import { addFeature, removeFeature, getCurrentMapFeatures, batchUpdateVisibilityFeatures, getActiveLayerIdSync } from '@store';
import { IDUtils } from '@utils';
import { getPointerPosition } from '@utils/pointer-utils';
import { addVisibilityAttributesToPanel, addVisibilityParametersToPanel } from './visibility_attributes_panel.js';
import AddVisibilityGeometry from './add_visibility_geometry.js';
import { BaseControl } from '@tools';
import { createPreviewScheduler } from '@tools/helpers/preview-scheduler.js';
import { getSnappingService } from '@js/snapping';
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';

/**
 * The two dispatchers that own the persistent viewshed sources.
 *
 * EVERY write this file makes to `visibility` and `processed-visibility` goes through them. The
 * reason is not style: a raw `source.setData()` issued while a diff is queued replaces MapLibre's
 * pending-update slot and the diff disappears with no error at all.
 *
 * Each awaited method ends in `flush()`, for the same reason the point tool does: both sources
 * still have co-writers outside this file (the generic by-storageType paths of the attribute table,
 * the features tab, import, the clipboard and the context menu, plus `setOrCreateSource` on every
 * redraw), and they all do read-modify-write with a raw `setData`.
 *
 * The two ephemeral sources stay on raw `setData` on purpose: `visibility-feedback` and
 * `visibility-edit-handles` are rebuilt whole per pointermove, hold at most three transient
 * features with no `properties.id`, and are declared without `promoteId`, so a diff has nothing to
 * key on and nothing to save.
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `visibility` source
 */
function visibilitySource(map) {
    return getGeoJsonDispatcher(map, 'visibility');
}

/**
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `processed-visibility` source
 */
function processedVisibilitySource(map) {
    return getGeoJsonDispatcher(map, 'processed-visibility');
}

/**
 * The two derived ids a viewshed owns in `processed-visibility`.
 *
 * They are deterministic (`add_visibility_geometry.js` mints exactly these two suffixes), which is
 * what lets the removals and the patches below skip the collection read entirely. A `remove` or an
 * `update` of an id that is not in the source is a documented silent no-op in MapLibre, so naming
 * the half a fully visible viewshed never produced costs nothing.
 * @param {string} featureId - Parent viewshed feature id
 * @returns {Array<string>} derived ids
 */
function processedIdsOf(featureId) {
    return [`${featureId}-visible`, `${featureId}-obstructed`];
}

/**
 * Visibility (Viewshed) analysis tool control.
 *
 * Sector-style construction: first click sets observer, second defines radius/bearing.
 * Edit handles: radius (red) + aperture (blue) like sector tool.
 * After handle edit, full viewshed recalculation runs with progress modal.
 */
class AddVisibilityControl extends BaseControl {
    featureType = 'visibility';
    constructor(toolManager) {
        super(toolManager);

        this.startPoint = null;
        this.geometry = new AddVisibilityGeometry();

        // Drawing preview state. ONE rAF gate for the whole preview: the sector
        // being drawn and the handle drag are never live together, and already
        // shared this state, so they share the gate. The raw event parks a
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

        // Edit handle state
        this.isDraggingHandle = false;
        this.activeHandleId = null;
        this._activePointerId = null;

        // Recalculation queue and debounce
        this.recalculateQueue = Promise.resolve();
        this.parameterDebounceTimer = null;
        this.PARAMETER_DEBOUNCE_DELAY = 1000;

        // Progress modal elements
        this._progressDepth = 0;
        this.progressModal = null;
        this.progressBar = null;
        this.progressText = null;
        this.progressPercentage = null;

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

        if (this.map) {
            // Releases both queues, their settle timers and the map listeners the dispatchers open
            // per dispatch. Dropping a batch here cannot lose a viewshed: the store write always
            // precedes the source write, so the redraw that follows a style switch repopulates both
            // sources from persistence.
            destroyGeoJsonDispatcher(this.map, 'visibility');
            destroyGeoJsonDispatcher(this.map, 'processed-visibility');
        }

        this.map = undefined;
    }


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


    activate = () => {
        if (!this.geometry.isTerrainAvailable(this.map)) {
            return false;
        }
        this.isActive = true;
        this.startPoint = null;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('mousemove', this._onPreClickMouseMove);
    }

    deactivate = () => {
        this.isActive = false;
        this.startPoint = null;
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


    selectFeature = (feature) => {
        this.setupHoverListeners();

        if (this._mapLocked) return;

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

    /**
     * The handle drag rides the SAME gate as the drawing preview: the pointer is
     * parked here and the snap is resolved once per frame in
     * `performPreviewUpdate`, which excludes the dragged feature itself.
     */
    _onEditPointerMove(e) {
        if (!e.isPrimary) return;

        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);
        const lngLat = this.map.unproject([point.x, point.y]);

        this._previewScheduler.request({ point: { x: point.x, y: point.y }, lngLat });
    }

    /**
     * End of the handle drag.
     *
     * The FIRST thing here is the gate's `flush()`, because the code below reads
     * `this.lastPreviewPosition`, which only the frame callback writes. A drag
     * whose `pointerdown`, `pointermove` and `pointerup` all land inside ONE
     * frame parks a pointer the scheduled callback never got to deliver, so that
     * position would still be null and the edit would be dropped without a word.
     * `flush` delivers the parked pointer now and cancels the frame it was
     * waiting for; with nothing parked it is a redraw of what is already there.
     */
    _onEditPointerUp(_e) {
        this._previewScheduler.flush();

        const snapping = getSnappingService();
        snapping?.hideIndicator(this.map);

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

                selectedFeature.properties.radius = result.radius;
                selectedFeature.properties.bearing = result.bearing;
                selectedFeature.properties.aperture = result.aperture;

                this.updateHandlePropertiesToSource(selectedFeature, result);

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


    /**
     * Snap indicator before the first click, when there is nothing to preview yet.
     *
     * The raw `mousemove` only PARKS the pointer: `snapping.resolve` is a
     * rendered-feature query, and a mouse fires several moves inside one frame,
     * so it runs once per frame from the gate's callback below. The indicator
     * lands on the same pixel either way, since only the last position of the
     * frame is ever drawn.
     */
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
            const endPoint = [snap.lng, snap.lat];
            snapping?.hideIndicator(this.map);
            this.map.off('mousemove', this.handleMouseMove);
            await this.createFeature(this.startPoint, endPoint);
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
        const selectedFeature = this.getSelectedFeature();
        const draggingHandle = Boolean(this.isDraggingHandle && selectedFeature);

        if (pointer) {
            const snapping = getSnappingService();
            // Exclude the feature itself while dragging one of its own handles:
            // its own vertices would otherwise capture every move.
            const excludeId = draggingHandle ? selectedFeature.properties?.id : null;
            const snap = snapping?.resolve(this.map, pointer.point, pointer.lngLat, excludeId) ?? pointer.lngLat;

            if (snap.snapped) {
                snapping.showIndicator(this.map, snap, snap.snapType);
            } else {
                snapping?.hideIndicator(this.map);
            }

            this.lastPreviewPosition = [snap.lng, snap.lat];
            // The drawing centre is the first click, never a drag's own state.
            if (!draggingHandle) this.lastPreviewCenter = this.startPoint;
        }

        if (!this.lastPreviewPosition) return;

        if (draggingHandle) {
            this.updateHandlePreview(this.lastPreviewPosition);
        } else if (this.startPoint && this.lastPreviewCenter) {
            const aperture = AddVisibilityControl.DEFAULT_PROPERTIES.aperture;
            const previewCoordinates = this.geometry.calculateSectorPreview(
                this.lastPreviewCenter, this.lastPreviewPosition, aperture
            );
            this.showPreview(previewCoordinates);
        }
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

            const dispatcher = visibilitySource(this.map);
            const processedDispatcher = processedVisibilitySource(this.map);
            dispatcher.add(visibilityFeature);
            processedDispatcher.add(processedFeatures);
            await dispatcher.flush();
            await processedDispatcher.flush();

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


    updateFeaturesProperty = (features, property, value) => {
        const recalcProperties = ['observerHeight', 'targetHeight', 'radius', 'aperture'];

        if (recalcProperties.includes(property)) {
            this.updatePropertyImmediately(features, property, value);

            if (property === 'radius' || property === 'aperture') {
                this.updateSectorOutlineFromProperty(features, property, value);
            }

            if (this.parameterDebounceTimer) {
                clearTimeout(this.parameterDebounceTimer);
            }
            // Go through the same queue as the drag/move recalculations: a debounced
            // slider change and a handle drag can otherwise run concurrently and
            // overwrite each other's setData on the very sources they both read.
            this.parameterDebounceTimer = setTimeout(() => {
                this.parameterDebounceTimer = null;
                this.recalculateQueue = this.recalculateQueue
                    .then(() => this.recalculateAfterParameterChange(features))
                    .catch(error => console.error('Error in parameter recalculation:', error));
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
     * The queued patch is what the recalculation reads back, so the values reach it in order.
     * @param {Object} feature - Selected viewshed feature
     * @param {Object} result - Handle edit result carrying radius, bearing and aperture
     */
    updateHandlePropertiesToSource = async (feature, result) => {
        // The three values leave as a patch and the collection read is gone, which also closes a
        // race this method used to lose. The caller does not await it: it fires this and then
        // chains the recalculation, which reads the source back. The read-modify-write here landed
        // one microtask later than the old header comment promised ("call it synchronously"), so
        // the recalculation could still read the pre-drag radius. The patch is now enqueued
        // SYNCHRONOUSLY, and the recalculation drains the queue before its own read, so the fresh
        // values are guaranteed to be there.
        const dispatcher = visibilitySource(this.map);
        dispatcher.patch(feature.properties.id, {
            setProps: {
                radius: result.radius,
                bearing: result.bearing,
                aperture: result.aperture,
            },
        });
        await dispatcher.flush();
        this.updateSelectionManagerFeature(feature);
    }

    updatePropertyImmediately = async (features, property, value) => {
        const dispatcher = visibilitySource(this.map);
        const processedDispatcher = processedVisibilitySource(this.map);

        // The `visibility` read survives: the guard below skips a feature the source does not hold,
        // and the selection manager is handed the SOURCE copy afterwards, neither of which a diff
        // returns. The `processed-visibility` read is gone: the derived ids are deterministic, so
        // the property travels as a two-key patch instead of a whole-collection rewrite.
        await dispatcher.flush();
        const data = await this.map.getSource('visibility').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                dispatcher.patch(feature.properties.id, { setProps: { [property]: value } });

                if (property !== 'color') {
                    for (const processedId of processedIdsOf(feature.properties.id)) {
                        processedDispatcher.patch(processedId, { setProps: { [property]: value } });
                    }
                }
            }
        }

        await dispatcher.flush();
        await processedDispatcher.flush();

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            return sourceFeature || feature;
        });
        this.updateSelectionManagerFeatures(freshFeatures);
    }


    /**
     * Recalculate viewshed after parameter change (height, divisions, radius, aperture).
     */
    recalculateAfterParameterChange = async (features, overrideCenter = null) => {
        try {
            this.showProgressModal();
            this.updateProgress(5, 'Preparando recálculo...');
            await this.geometry.delay(50);

            // Acquired INSIDE the try: with no map (tool removed mid-recalculation) the registry
            // lookup throws, and outside the try that throw would skip the `finally` that closes
            // the progress modal and would escape a method whose contract is to bail quietly.
            const dispatcher = visibilitySource(this.map);
            const processedDispatcher = processedVisibilitySource(this.map);

            // The `visibility` read survives: the recalculation starts from the SOURCE centre and
            // geometry, which a diff cannot hand back, and draining first is what guarantees the
            // radius/bearing/aperture a handle drag just patched are already in it. The
            // `processed-visibility` read is gone, replaced by a removal of the derived pair plus an
            // upsert of the regenerated one.
            await dispatcher.flush();
            const data = await this.map.getSource('visibility').getData();

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

                    // Total replacement of this one feature, with the same object the whole
                    // collection write used to carry.
                    dispatcher.add(sourceFeature);

                    processedDispatcher.remove(processedIdsOf(feature.properties.id));
                    processedDispatcher.add(newProcessedFeatures);

                } catch (error) {
                    console.error('Error recalculating visibility:', error);
                }
            }

            this.updateProgress(95, 'Atualizando mapa...');
            await this.geometry.delay(50);

            await dispatcher.flush();
            await processedDispatcher.flush();

            this.map.getSource('visibility-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });

            const freshFeatures = features.map(feature => {
                const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
                return sourceFeature || feature;
            });
            this.updateSelectionManagerFeatures(freshFeatures);

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
        // Remove the old pair, then upsert the regenerated one. The read is gone: the ids are
        // derived, and inside one batch `remove` followed by `add` on the same key coalesces into
        // the `add` alone (a total replacement), while the half that is not regenerated keeps its
        // removal.
        const dispatcher = processedVisibilitySource(this.map);
        dispatcher.remove(processedIdsOf(mainFeature.properties.id));

        const processedFeatures = newProcessedFeatures || this.geometry.generateProcessedFeatures(mainFeature);
        dispatcher.add(processedFeatures);

        await dispatcher.flush();
    }


    saveFeatures = async (features, initialPropertiesMap) => {
        // Reads only, and it persists the SOURCE's version of each feature rather than the selected
        // one, so both queues have to be drained before the collections come back.
        await visibilitySource(this.map).flush();
        await processedVisibilitySource(this.map).flush();
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

        // NOT a diff, on purpose, and the one place in this file where the whole collection is
        // still written. The rebuild comes from the STORE, which is authoritative about the
        // cascade: `removeFeature('visibility', id)` also drops every processed feature whose id
        // starts with `<id>-`, and reading the survivors back resyncs the source with persistence
        // instead of trusting this file's idea of which derived ids exist. It goes through the
        // dispatchers only for ownership: a raw `setData` here would silently discard whatever is
        // queued.
        const currentMapFeatures = await getCurrentMapFeatures();

        const dispatcher = visibilitySource(this.map);
        const processedDispatcher = processedVisibilitySource(this.map);
        dispatcher.setData(currentMapFeatures.visibility);
        processedDispatcher.setData(currentMapFeatures.processed_visibility);
        await dispatcher.flush();
        await processedDispatcher.flush();
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

        const dispatcher = visibilitySource(this.map);
        const processedDispatcher = processedVisibilitySource(this.map);

        // BOTH reads survive here, and each for its own reason: `visibility` because an unknown id
        // must be skipped rather than created (`add` would create it) and because the save path
        // persists the merged SOURCE copy, `processed-visibility` because the save path persists the
        // EXISTING derived features with the incoming properties folded in, and no diff hands those
        // back.
        await dispatcher.flush();
        await processedDispatcher.flush();
        const data = await this.map.getSource('visibility').getData();
        const processedData = await this.map.getSource('processed-visibility').getData();

        for (const feature of features) {
            const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
            if (featureIndex !== -1) {
                if (onlyUpdateProperties) {
                    Object.assign(data.features[featureIndex].properties, feature.properties);
                    dispatcher.patch(feature.properties.id, { setProps: feature.properties });

                    const processedFeatures = processedData.features.filter(f =>
                        f.properties.id.startsWith(feature.properties.id + '-')
                    );
                    processedFeatures.forEach(pf => {
                        Object.keys(feature.properties).forEach(key => {
                            if (key !== 'color') {
                                pf.properties[key] = feature.properties[key];
                            }
                        });
                        processedDispatcher.add(pf);
                    });
                } else {
                    data.features[featureIndex] = feature;
                    dispatcher.add(feature);
                }

                if (save) {
                    const processedFeatures = processedData.features.filter(f =>
                        f.properties.id.startsWith(feature.properties.id + '-')
                    );
                    await batchUpdateVisibilityFeatures(data.features[featureIndex], processedFeatures);
                }
            }
        }

        await dispatcher.flush();
        await processedDispatcher.flush();
        this.updateSelectionManagerFeatures(features);
    }


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
        // Ref-counted: whoever finishes first must not close the modal of a
        // recalculation still running.
        this._progressDepth += 1;
        if (this._progressDepth > 1) return;

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
        this._progressDepth = Math.max(0, this._progressDepth - 1);
        if (this._progressDepth > 0) return;

        this.progressModal.classList.remove('visibility-progress-modal--visible');
        this.updateProgress(0, 'Analisando terreno...');
    }


    setupBaseEventListeners = () => {
        this.map.on('terrain', this._onTerrainChange);
        this._onTerrainChange();
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
        this.selectionManager.updateSelectedFeature('visibility', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'visibility') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }


    cancelPendingUpdates = () => {
        // Both gates: the drawing/drag preview and the pre-click indicator.
        this._previewScheduler.cancel();
        this._preClickScheduler.cancel();
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;

        if (this.parameterDebounceTimer) {
            clearTimeout(this.parameterDebounceTimer);
            this.parameterDebounceTimer = null;
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

export default AddVisibilityControl;

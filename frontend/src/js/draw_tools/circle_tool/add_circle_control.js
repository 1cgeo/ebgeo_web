// Path: js/draw_tools/circle_tool/add_circle_control.js
import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils, showWarning } from '../../utilities';
import { getPointerPosition } from '../../utilities/pointer-utils';
import { addCircleAttributesToPanel } from './circle_attributes_panel.js';
import AddCircleGeometry from './add_circle_geometry.js';
import { BaseControl, HatchPatternGenerator } from '../../tool_manager';
import { LABEL_DEFAULT_PROPERTIES, hasLabelChanged, LABEL_ZOOM_PROPERTIES, recalcLabelSize, createLabelZoomHandler, syncLabelSource } from '../../tool_manager/helpers/label-tab.helpers.js';
import { getSnappingService } from '../../snapping/snapping.service.js';
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { queryHoverFeatures } from '@tools/helpers/hover-query.helpers.js';

/**
 * Layers onHoverMove needs: the edit handles (hasHandleAtPoint, source 'circle-edit-handles')
 * and everything drawn from the 'circles' source (hasSelectedFeatureAtPoint): solid fill,
 * hatch fill and outline. Ids built by `setupShapeType` in layers/styles/shape.layers.js
 * with prefix 'circle'.
 */
const HOVER_LAYER_IDS = ['circle-edit-handles-layer', 'circle-fill-layer', 'circle-fill-pattern-layer', 'circle-layer'];

/**
 * The dispatcher that owns the `circles` source.
 *
 * EVERY write to `circles` made in this file goes through it, and every migrated method awaits
 * `flush()` before returning. A raw `source.setData()` issued while a diff is queued replaces
 * MapLibre's pending-update slot and the diff disappears with no error, so draining inside the
 * awaited method keeps the queue empty between gestures and leaves the co-writers that still use
 * `setData` (the shared label zoom handler in `tool_manager/helpers/label-tab.helpers.js`, and the
 * generic `storageType` paths: attribute table, features tab, import, clipboard, processing)
 * reading a collection that already carries what this tool wrote.
 *
 * WHY THE COLLECTION READ SURVIVES IN MOST METHODS, unlike the point pilot: `circle-labels` and
 * the hatch pattern registry are both functions of the WHOLE collection, and `syncLabelSource`
 * rebuilds the label source from it after every write. Only the write side becomes a diff here;
 * the read is eliminated just where nothing whole-collection depends on it (creation and removal
 * of features that carry no label).
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `circles` source
 */
function circlesSource(map) {
    return getGeoJsonDispatcher(map, 'circles');
}

/**
 * Whether a feature contributes a rendered entry to the derived label source.
 * `syncLabelSource` skips anything without both flags, so adding or removing such a feature leaves
 * the label collection identical and the whole-collection read can be skipped with it.
 * @param {Object} feature - GeoJSON feature
 * @returns {boolean}
 */
function affectsLabelSource(feature) {
    return Boolean(feature?.properties?.showLabel && feature?.properties?.labelText);
}

class AddCircleControl extends BaseControl {
    featureType = 'circle';

    constructor(toolManager) {
        super(toolManager);
        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.geometry = new AddCircleGeometry();
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;
        this.hatchGenerator = new HatchPatternGenerator();

        // Pointer event state for edit handles
        this._activePointerId = null;

        // Bind pointer event handlers
        this._onEditPointerDown = this._onEditPointerDown.bind(this);
        this._onEditPointerMove = this._onEditPointerMove.bind(this);
        this._onEditPointerUp = this._onEditPointerUp.bind(this);
    }
    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        fillColor: '#3f4fb5',
        lineWidth: 2,
        lineStyle: 'solid',
        opacity: 0.5,
        source: 'circle',
        coordinationPoint: false,
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false,
        hatchEnabled: false,
        hatchType: 'none',
        hatchColor: '#000000',
        hatchSpacing: 8,
        hatchLineWidth: 2,
        ...LABEL_DEFAULT_PROPERTIES,
    };
    // ===== MAPBOX CONTROL INTERFACE =====
    onAdd = (map) => {
        this.map = map;
        // zoomend, not zoom: the label size is painted by a style expression
        // (layers/styles/zoom-expression.js), so this pass only refreshes the stored
        // labelCalculatedSize once the gesture is over. See createLabelZoomHandler.
        map.on('zoomend', this._onZoomForLabels);
    }
    onRemove = () => {
        this.deactivate();
        this.removeAllEventListeners();
        if (this.map) {
            this.map.off('zoomend', this._onZoomForLabels);
            // Releases the queue, its settle timers and the two map listeners the dispatcher opens
            // per dispatch. Dropping a batch here cannot lose a circle: the store write always
            // precedes the source write, so the redraw that follows a style switch repopulates
            // `circles` from persistence.
            destroyGeoJsonDispatcher(this.map, 'circles');
        }
        this.#labelZoom.cleanup();
        this.map = undefined;
    }
    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====
    hasAttributePanel() {
        return true;
    }
    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'circle-attributes-section';
        try {
            addCircleAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating circle attribute panel:', error);
        }
    }
    getDragSources() {
        return ['circles'];
    }
    getEditHandleSources() {
        return ['circle-edit-handles'];
    }
    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating circle selection box:', error);
            return null;
        }
    }
    getSelectionBoxStrategy() {
        return 'bbox';
    }
    getSelectionBoxPadding() {
        return 5;
    }
    getLayerIds() {
        return ['circle-fill-layer', 'circle-layer', 'circle-label-layer'];
    }
    getSourceNames() {
        return ['circles'];
    }
    getEditHandleSource() {
        return 'circle-edit-handles';
    }
    canCopy(_feature) {
        return true;
    }
    canPaste(_feature) {
        return true;
    }
    prepareForPaste(feature, offset) {
        const oldCenter = this.geometry.normalizeCenter(feature.properties.center);
        const newCenter = [oldCenter[0] + offset.dx, oldCenter[1] + offset.dy];
        return {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: this.geometry.generate(newCenter, feature.properties.radius)
        };
    }
    calculateMoveOffset(feature, referencePoint) {
        const center = this.geometry.normalizeCenter(feature.properties.center);
        return [
            center[0] - referencePoint.lng,
            center[1] - referencePoint.lat
        ];
    }
    updateFeatureForMove(feature, dx, dy, newCoords) {
        const newCenter = [newCoords.lng, newCoords.lat];
        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: this.geometry.generate(newCenter, feature.properties.radius)
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
        this.setupRightClickListener();
        this.map.on('mousemove', this._onPreClickMouseMove);
    }
    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.map.off('mousemove', this._onPreClickMouseMove);
        getSnappingService()?.hideIndicator(this.map);
        this.clearPreview();
        this.deselectFeature();
        this.removeRightClickListener();
    }
    // ===== RIGHT-CLICK FINISH SUPPORT =====
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

        const screenPoint = { x: e.offsetX, y: e.offsetY };
        const coordinates = this.map.unproject([screenPoint.x, screenPoint.y]);
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, screenPoint, coordinates) ?? coordinates;
        const finalPoint = [snap.lng, snap.lat];

        this.drawPoints.push(finalPoint);

        if (this.drawPoints.length === 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
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
    syncEditHandlesAfterDrag = (_movedFeatures) => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }
    // ===== DRAWING SYSTEM =====
    _onPreClickMouseMove = (e) => {
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }
    }
    handleMapClick = async (e) => {
        if (!this.isActive) return;
        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for circle');
            return;
        }
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
        this.drawPoints.push([snap.lng, snap.lat]);
        if (this.drawPoints.length === 1) {
            this.map.off('mousemove', this._onPreClickMouseMove);
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length === 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            this.lastPreviewCenter = this.drawPoints[0];

            const snapping = getSnappingService();
            const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
            this.lastPreviewPosition = [snap.lng, snap.lat];

            if (snap.snapped) {
                snapping.showIndicator(this.map, snap, snap.snapType);
            } else {
                snapping?.hideIndicator(this.map);
            }

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
            this.updateRadiusPreview(this.lastPreviewPosition);
        } else if (this.drawPoints.length === 1 && this.lastPreviewCenter) {
            const center = this.lastPreviewCenter;
            const radius = this.geometry.calculateDistance(center, this.lastPreviewPosition);
            if (radius >= 10) {
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const previewGeometry = this.geometry.generate(center, radius);
                    this.showPreview(previewGeometry);
                }, 8);
            }
        }
        this.pendingPreviewUpdate = false;
    }
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
        const radius = this.geometry.calculateDistance(center, endPoint);
        if (!this.geometry.validate(center, radius)) {
            showWarning('Raio mínimo: 10 metros');
            this.drawPoints = [];
            return;
        }
        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('circle', this.map);
        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...AddCircleControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                center: center,
                radius: radius,
                id: featureId,
                nome: featureName,
                labelCreatedAtZoom: this.map.getZoom(),
            },
            geometry: this.geometry.generate(center, radius)
        };
        try {
            await addFeature('circles', feature);

            // Only the new feature needs a pattern registered: every circle already in the source
            // registered its own when it was drawn, edited or loaded, and the id is a pure function
            // of the feature's own hatch properties.
            if (feature.properties.hatchEnabled) {
                this.updateHatchPatterns({ features: [feature] });
            }

            const dispatcher = circlesSource(this.map);
            dispatcher.add(feature);
            await dispatcher.flush();

            // The label source is a pure function of the collection, so a circle that carries no
            // label leaves it identical and the whole-collection read is skipped with it.
            if (affectsLabelSource(feature)) {
                syncLabelSource(this.map, 'circle-labels', await this.map.getSource('circles').getData());
            }

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('circle', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating circle:', error);
        }
    }
    // ===== EDIT HANDLES SYSTEM =====
    selectFeature = (feature) => {
        this.setupHoverListeners();

        // Skip edit handles and edit listeners when map is locked (read-only)
        if (this._mapLocked) return;

        this.createEditHandles(feature);
        this.setupEditEventListeners();
    }
    deselectFeature = () => {
        this.isDraggingHandle = false;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }
    createEditHandles = (feature) => {
        const handleFeature = this.geometry.createHandles(feature);
        if (!handleFeature) return;
        this.map.getSource('circle-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });
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

        // Release any captured pointer
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
        if (!e.isPrimary) return; // Only handle primary pointer

        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);

        const handleFeatures = this.map.queryRenderedFeatures([point.x, point.y], {
            layers: ['circle-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            this.isDraggingHandle = true;
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';

            // Capture pointer for reliable tracking
            this._activePointerId = e.pointerId;
            canvas.setPointerCapture(e.pointerId);

            // Add move/up listeners only when dragging starts
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

        const snapping = getSnappingService();
        const excludeId = selectedFeature.properties?.id;
        const snap = snapping?.resolve(this.map, point, lngLat, excludeId) ?? lngLat;

        this.lastPreviewPosition = [snap.lng, snap.lat];

        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }
    async _onEditPointerUp(_e) {
        const canvas = this.map.getCanvasContainer();

        // Remove move/up listeners
        canvas.removeEventListener('pointermove', this._onEditPointerMove);
        canvas.removeEventListener('pointerup', this._onEditPointerUp);
        canvas.removeEventListener('pointercancel', this._onEditPointerUp);

        // Release pointer capture
        if (this._activePointerId !== null) {
            try {
                canvas.releasePointerCapture(this._activePointerId);
            } catch (_err) {
                // Pointer may have already been released
            }
            this._activePointerId = null;
        }

        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature) {
            const center = this.geometry.normalizeCenter(selectedFeature.properties.center);
            const result = this.geometry.updateFromHandle('radius', this.lastPreviewPosition, selectedFeature);
            if (result && result.radius > 10) {
                const updatedFeature = {
                    ...selectedFeature,
                    properties: {
                        ...selectedFeature.properties,
                        radius: result.radius,
                        center: center
                    },
                    geometry: result.geometry
                };
                await this.forceUpdateMainSource(updatedFeature);
                this.updateSelectionManagerFeature(updatedFeature);
                this.createEditHandles(updatedFeature);
                this.updateUIAfterEdit();
                await this.saveFeatureChanges(updatedFeature);
            }
        }
        getSnappingService()?.hideIndicator(this.map);
        this.isDraggingHandle = false;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }
    updateRadiusPreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;
        const center = this.geometry.normalizeCenter(selectedFeature.properties.center);
        if (!center) return;
        const preview = this.geometry.calculatePreview(center, newPosition);
        if (!preview) return;
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            this.map.getSource('circle-feedback').setData({
                type: 'Feature',
                geometry: preview.geometry,
                properties: {
                    ...selectedFeature.properties,
                    isSelected: true
                }
            });
            this.map.getSource('circle-edit-handles').setData({
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: preview.handlePosition },
                    properties: {
                        role: 'handle',
                        handleType: 'radius',
                        user_isEditingHandle: true
                    }
                }]
            });
        }, 8);
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
        const features = queryHoverFeatures(this.map, e.point, HOVER_LAYER_IDS);
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
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'circles' &&
            f.properties.id === selectedFeature.properties.id
        );
    }
    // ===== LABEL ZOOM CORRECTION =====
    #labelZoom = createLabelZoomHandler(() => this.map, 'circles', 'circle-labels');
    _onZoomForLabels = this.#labelZoom.handler;

    // ===== FEATURE MANAGEMENT INTERFACE =====
    updateFeaturesProperty = async (features, property, value) => {
        // The read stays: `syncLabelSource` and the hatch registry below both need the whole
        // collection. Draining first keeps it from being stale. Only the WRITE becomes a diff.
        const dispatcher = circlesSource(this.map);
        await dispatcher.flush();
        const data = await this.map.getSource('circles').getData();
        const touched = [];
        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                touched.push(sourceFeature);
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;
                if (property === 'radius' || property === 'center') {
                    const center = this.geometry.normalizeCenter(sourceFeature.properties.center);
                    const newGeometry = this.geometry.generate(center, sourceFeature.properties.radius);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }

                if (LABEL_ZOOM_PROPERTIES.has(property)) {
                    recalcLabelSize(sourceFeature, feature, this.map.getZoom());
                }
            }
        }

        // Regenerate hatch patterns if hatch property changes or if fillColor changes (hatch uses fill color)
        if (property.startsWith('hatch') || (property === 'fillColor' && features.some(f => f.properties.hatchEnabled))) {
            this.updateHatchPatterns(data);
        }

        // `add` is a TOTAL replacement, which is what "write the mutated source feature back"
        // means, and it is also what drops `hatchPatternId` in the hatch-disable branch. The hatch
        // call above runs FIRST because it stamps `hatchPatternId`, which has to travel with the
        // feature; the stamps it also puts on untouched features no longer reach the source, and
        // that loses nothing, since the id is a pure function of each feature's own hatch
        // properties, unchanged for anyone outside `touched`.
        dispatcher.add(touched);
        await dispatcher.flush();
        syncLabelSource(this.map, 'circle-labels', data);
        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            return sourceFeature || feature;
        });
        this.updateSelectionManagerFeatures(freshFeatures);
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }
    updateHatchPatterns = (data) => {
        if (!data || !data.features) {
            return;
        }
        const features = data.features.filter(f => f.properties.hatchEnabled);
        this.hatchGenerator.loadPatternsToMap(this.map, features);
    }

    /**
     * Update hatch type and enabled status together
     * This ensures proper pattern generation when enabling/disabling hatch
     */
    updateHatchType = async (features, type) => {
        // Same reason as `updateFeaturesProperty`: the hatch registry and the label source are
        // functions of the whole collection, so the read stays and only the write becomes a diff.
        const dispatcher = circlesSource(this.map);
        await dispatcher.flush();
        const data = await this.map.getSource('circles').getData();
        const isEnabled = type !== 'none';
        const touched = [];

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                touched.push(sourceFeature);
                // Update both properties together
                sourceFeature.properties.hatchType = type;
                sourceFeature.properties.hatchEnabled = isEnabled;
                feature.properties.hatchType = type;
                feature.properties.hatchEnabled = isEnabled;

                // Clear hatchPatternId when disabling
                if (!isEnabled) {
                    delete sourceFeature.properties.hatchPatternId;
                    delete feature.properties.hatchPatternId;
                }
            }
        }

        // Generate patterns after both properties are set
        if (isEnabled) {
            this.updateHatchPatterns(data);
        }

        // `add` is a TOTAL replacement, which is what "write the mutated source feature back"
        // means, and it is also what drops `hatchPatternId` in the hatch-disable branch. The hatch
        // call above runs FIRST because it stamps `hatchPatternId`, which has to travel with the
        // feature; the stamps it also puts on untouched features no longer reach the source, and
        // that loses nothing, since the id is a pure function of each feature's own hatch
        // properties, unchanged for anyone outside `touched`.
        dispatcher.add(touched);
        await dispatcher.flush();
        syncLabelSource(this.map, 'circle-labels', data);

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            return sourceFeature || feature;
        });
        this.updateSelectionManagerFeatures(freshFeatures);

        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        // Reads only, and it persists the SOURCE's version of each feature rather than the selected
        // one, so the queue has to be drained before the collection comes back.
        await circlesSource(this.map).flush();
        const currentData = await this.map.getSource('circles').getData();
        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);
                if (currentFeature) {
                    await updateFeature('circles', currentFeature);
                }
            }
        }
    }
    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            const center = this.geometry.normalizeCenter(f.properties.center);
            f.geometry = this.geometry.generate(center, f.properties.radius);
        });
        // Full update (onlyUpdateProperties=false) so the reverted GEOMETRY is written,
        // not just properties — the onlyUpdateProperties path drops the regenerated geometry.
        await this.updateFeatures(features, true, false);
    }
    deleteFeatures = async (features) => {
        if (features.length === 0) return;
        for (const feature of features) {
            try {
                await removeFeature('circles', feature.properties.id);
            } catch (error) {
                console.error(`Error removing circle ${feature.properties.id}:`, error);
            }
        }

        // Removal by promoted key, with no collection read (the read used to sit INSIDE the loop,
        // so it cost one full round-trip per deleted feature). The keys go in raw, never coerced:
        // MapLibre keyed the feature by the very value in `properties.id`, so a `String()` around
        // it would miss a numeric key instead of protecting anything.
        const dispatcher = circlesSource(this.map);
        dispatcher.remove(features.map(f => f.properties.id));
        await dispatcher.flush();

        // Removing circles that carry no label leaves the derived label source identical, so the
        // whole-collection read is only paid when at least one of them was labelled.
        if (features.some(affectsLabelSource)) {
            syncLabelSource(this.map, 'circle-labels', await this.map.getSource('circles').getData());
        }
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
            // lineStyle is offered by the attributes panel and rendered via line-dasharray;
            // without it here the change never reached the store (lost on reload).
            feature.properties.lineStyle !== initialProperties.lineStyle ||
            feature.properties.radius !== initialProperties.radius ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            feature.properties.hatchEnabled !== initialProperties.hatchEnabled ||
            feature.properties.hatchType !== initialProperties.hatchType ||
            feature.properties.hatchColor !== initialProperties.hatchColor ||
            feature.properties.hatchSpacing !== initialProperties.hatchSpacing ||
            feature.properties.hatchLineWidth !== initialProperties.hatchLineWidth ||
            hasLabelChanged(feature, initialProperties) ||
            JSON.stringify(feature.properties.center) !== JSON.stringify(initialProperties.center)
        );
    }
    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            // The collection read survives here for three reasons, and no diff answers any of them:
            // whether the feature exists at all (an unknown id must be skipped, not created), the
            // previous `labelCalculatedSize` carried over when the incoming feature lacks it, and
            // the whole collection `syncLabelSource` needs. Draining first keeps it from being stale.
            const dispatcher = circlesSource(this.map);
            await dispatcher.flush();
            const data = await this.map.getSource('circles').getData();
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                        dispatcher.patch(feature.properties.id, { setProps: feature.properties });
                    } else {
                        const prevCalcSize = data.features[featureIndex].properties.labelCalculatedSize;
                        data.features[featureIndex] = feature;
                        if (prevCalcSize !== undefined) {
                            feature.properties.labelCalculatedSize = prevCalcSize;
                        }
                        // Queued only after the carry-over above, because `add` is a TOTAL
                        // replacement: whatever is missing from this object is missing from the
                        // source too.
                        dispatcher.add(feature);
                    }
                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('circles', featureToUpdate);
                    }
                }
            }
            await dispatcher.flush();
            syncLabelSource(this.map, 'circle-labels', data);
            this.updateSelectionManagerFeatures(features);
        }
    }
    // ===== SELECTION MANAGER INTEGRATION =====
    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('circle', feature.properties.id, feature);
    }
    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'circle') {
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
    }
    /**
     * Write ONE feature's properties and geometry straight into the source.
     *
     * No drag guard. The one that stood here tested `this.uiManager`, which a
     * control is never handed, so it never fired; and the measure that replaced
     * it found nothing for it to protect. A feature drag keeps its position in
     * the selection boxes (`move_handler.js` `_performDragUpdate`) and hands the
     * geometry over only in `_endDrag`, after `isDragging` is already false, so
     * the source never holds a partial position and a guard on the live path
     * would drop a write that nothing reapplies. Removed 2026-09-04, measured by
     * tests/unit/force-update-during-drag-draw.test.js.
     *
     * @param {Object} feature - Feature to write
     * @returns {Promise<void>} Resolves once the source is written
     */
    forceUpdateMainSource = async (feature) => {
        // The read stays for the existence guard and for `syncLabelSource`: an id absent from the
        // source must be left alone, and `add` would CREATE it. Draining first keeps it fresh.
        const dispatcher = circlesSource(this.map);
        await dispatcher.flush();
        const data = await this.map.getSource('circles').getData();
        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            // `add` is a TOTAL replacement, which is exactly what the two lines above expressed.
            dispatcher.add(sourceFeature);
            await dispatcher.flush();
            syncLabelSource(this.map, 'circle-labels', data);
        }
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
            console.error('Error saving changes:', error);
        }
    }
    setupBaseEventListeners = () => {
    }
    removeAllEventListeners = () => {
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeRightClickListener();
        this.cancelPendingUpdates();
    }
}
export default AddCircleControl;

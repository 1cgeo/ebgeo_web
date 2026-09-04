// Path: js/draw_tools/brush_tool/add_brush_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils } from '../../utilities';
import { getPointerPosition, preventDefaultGestures, restoreDefaultGestures } from '../../utilities/pointer-utils';
import { readGeoJSONSourceDataAsync } from '../../utilities/geojson-source.js';
import { addBrushAttributesToPanel } from './brush_attributes_panel.js';
import AddBrushGeometry from './add_brush_geometry.js';
import { BaseControl } from '../../tool_manager';
import { createPreviewScheduler } from '../../tool_manager/helpers/preview-scheduler.js';
import {
    applyZoomCorrections as applyZoomCorrectionsUtil,
    calculateZoomCorrectedValue,
    syncZoomCorrectedProperty,
} from '../../tool_manager/helpers/zoom-correction.helpers.js';

/**
 * Brush Tool Control
 * Manages freehand drawing for brush/pencil features with zoom-adaptive scaling
 */
class AddBrushControl extends BaseControl {
    featureType = 'brush';

    constructor(toolManager) {
        super(toolManager);

        this.isDrawing = false;
        this.points = [];
        this.lastPixelPoint = null;

        this.geometry = new AddBrushGeometry();

        // One rAF gate for the feedback DRAWING only. The stroke itself is built
        // on the raw pointer event on purpose (see `_onPointerMove`), so this
        // gate parks no pointer: it coalesces the `setData` alone.
        this._previewScheduler = createPreviewScheduler({
            raf: (callback) => requestAnimationFrame(callback),
            caf: (id) => cancelAnimationFrame(id),
            onFrame: () => this.updatePreview(),
        });

        this.zoomRafId = null;
        this.pendingZoomUpdate = false;
        this.zoomCorrectionEnabled = true;
        this._name = 'AddBrushControl';

        // Pointer event state
        this._activePointerId = null;

        // Bind pointer event handlers
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onPointerLeave = this._onPointerLeave.bind(this);
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        lineWidth: 10,
        createdAtZoom: 0,
        calculatedLineWidth: 10,
        zoomCorrectionEnabled: true,
        source: 'brush',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.setupZoomListener();
    }

    onRemove = () => {
        this.map.off('zoomend', this.handleZoomChange);
        if (this.zoomRafId) {
            cancelAnimationFrame(this.zoomRafId);
            this.zoomRafId = null;
        }
        this.pendingZoomUpdate = false;
        this.deactivate();
        this.removeAllEventListeners();
        this.map = undefined;
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'brush-attributes-section';

        try {
            addBrushAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating brush attribute panel:', error);
        }
    }

    getDragSources() {
        return ['brushes'];
    }

    getEditHandleSources() {
        return [];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating brush selection box:', error);
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
        return ['brush-layer'];
    }

    getSourceNames() {
        return ['brushes'];
    }

    getEditHandleSource() {
        return null;
    }

    canCopy(_feature) {
        return true;
    }

    canPaste(_feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const newCoordinates = this.geometry.applyOffset(
            feature.geometry.coordinates,
            offset.dx,
            offset.dy
        );

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            }
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const centerPoint = this.geometry.getCenter(feature.geometry.coordinates);
        if (!centerPoint) {
            return [0, 0];
        }

        return [
            centerPoint[0] - referencePoint.lng,
            centerPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, _newCoords) {
        const newCoordinates = this.geometry.applyOffset(
            feature.geometry.coordinates,
            dx,
            dy
        );

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            }
        };
    }

    canMove(feature) {
        return !feature.properties?.bloqueado;
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.isDrawing = false;
        this.points = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.setupDrawingEventListeners();
    }

    deactivate = async () => {
        this.isActive = false;
        await this.finishDrawing();
        this.map.getCanvas().style.cursor = '';
        this.removeDrawingEventListeners();
        this.clearPreview();
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (_feature) => {
    }

    onFeatureDeselected = (_feature) => {
    }

    onGlobalDeselect = () => {
    }

    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (_featureId) => {
        return false;
    }

    syncEditHandlesAfterDrag = (_movedFeatures) => {
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (_e) => {
    }

    /**
     * Setup drawing event listeners using pointer events for unified mouse/touch
     */
    setupDrawingEventListeners = () => {
        const canvas = this.map.getCanvasContainer();

        // Prevent default touch gestures during drawing
        preventDefaultGestures(canvas);

        canvas.addEventListener('pointerdown', this._onPointerDown);
        canvas.addEventListener('pointermove', this._onPointerMove);
        canvas.addEventListener('pointerup', this._onPointerUp);
        canvas.addEventListener('pointerleave', this._onPointerLeave);
        canvas.addEventListener('pointercancel', this._onPointerUp);
    }

    /**
     * Remove drawing event listeners
     */
    removeDrawingEventListeners = () => {
        const canvas = this.map.getCanvasContainer();

        restoreDefaultGestures(canvas);

        canvas.removeEventListener('pointerdown', this._onPointerDown);
        canvas.removeEventListener('pointermove', this._onPointerMove);
        canvas.removeEventListener('pointerup', this._onPointerUp);
        canvas.removeEventListener('pointerleave', this._onPointerLeave);
        canvas.removeEventListener('pointercancel', this._onPointerUp);

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

    /**
     * Handle pointer down - start drawing
     * @param {PointerEvent} e
     */
    _onPointerDown(e) {
        if (!this.isActive) return;
        if (!e.isPrimary) return; // Only handle primary pointer

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);
        const lngLat = this.map.unproject([point.x, point.y]);

        this.isDrawing = true;
        this.points = [[lngLat.lng, lngLat.lat]];
        this.lastPixelPoint = point;
        this.map.dragPan.disable();
        this.map.getCanvas().style.cursor = 'crosshair';

        // Capture pointer for reliable tracking
        this._activePointerId = e.pointerId;
        canvas.setPointerCapture(e.pointerId);

        e.preventDefault();
    }

    /**
     * Handle pointer move - add points while drawing
     *
     * The point ACCUMULATION stays on the raw event, unlike every other tool
     * here: a brush stroke IS the sequence of positions the pointer passed
     * through, and keeping only the last one of each frame would sand the curve
     * down to one segment per frame. Only the DRAWING of the feedback is
     * coalesced by the gate, so a burst inside one frame appends every point it
     * carries and writes the source once, with all of them.
     *
     * @param {PointerEvent} e
     */
    _onPointerMove(e) {
        if (!this.isActive || !this.isDrawing) return;
        if (!e.isPrimary) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);

        if (!this.geometry.isPixelDistanceSufficient(this.lastPixelPoint, point)) {
            return;
        }

        const lngLat = this.map.unproject([point.x, point.y]);
        this.points.push([lngLat.lng, lngLat.lat]);
        this.lastPixelPoint = point;

        // No pointer parked: the frame reads `this.points`, which the line above
        // has already grown.
        this._previewScheduler.request();
    }

    /**
     * Handle pointer up - finish drawing
     * @param {PointerEvent} e
     */
    async _onPointerUp(_e) {
        if (!this.isActive || !this.isDrawing) return;

        // Release pointer capture
        if (this._activePointerId !== null) {
            const canvas = this.map.getCanvasContainer();
            try {
                canvas.releasePointerCapture(this._activePointerId);
            } catch (_err) {
                // Pointer may have already been released
            }
            this._activePointerId = null;
        }

        await this.finishDrawing();
    }

    /**
     * Handle pointer leave - finish drawing if active
     * @param {PointerEvent} e
     */
    async _onPointerLeave(_e) {
        if (this.isDrawing) {
            await this.finishDrawing();
        }
    }

    finishDrawing = async () => {
        if (!this.isDrawing) return;

        this.isDrawing = false;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = 'crosshair';

        if (this.points.length >= 2) {
            await this.createFeature();
        }

        this.points = [];
        this.lastPixelPoint = null;
        this.clearPreview();
    }

    /** The frame callback: ONE write of the stroke as it stands. */
    updatePreview = () => {
        if (this.points.length > 1) {
            this.map.getSource('brush-feedback').setData({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [...this.points]
                },
                properties: {
                    isPreview: true,
                    lineColor: AddBrushControl.DEFAULT_PROPERTIES.lineColor,
                    lineWidth: AddBrushControl.DEFAULT_PROPERTIES.lineWidth
                }
            });
        }
    }

    clearPreview = () => {
        this._previewScheduler.cancel();

        if (this.map && this.map.getSource('brush-feedback')) {
            this.map.getSource('brush-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        if (!this.geometry.validate(this.points)) {
            console.warn('Line must have at least 2 valid points');
            return;
        }

        const currentZoom = this.map.getZoom();
        const calculatedLineWidth = AddBrushControl.DEFAULT_PROPERTIES.lineWidth;

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('brush', this.map);

        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...AddBrushControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                id: featureId,
                nome: featureName,
                createdAtZoom: currentZoom,
                calculatedLineWidth: calculatedLineWidth
            },
            geometry: this.geometry.generate(this.points)
        };

        try {
            await addFeature('brushes', feature);

            const data = await this.map.getSource('brushes').getData();
            data.features.push(feature);
            this.map.getSource('brushes').setData(data);

            this.points = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('brush', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Erro ao criar pincel:', error);
        }
    }

    // ===== ZOOM HANDLING =====

    // The brush layer paints the zoom-scaled line width with a style expression
    // (layers/styles/zoom-expression.js), so this pass no longer feeds the
    // drawing: it refreshes the stored `calculatedLineWidth` for the consumers
    // that read it, once at the end of the gesture.
    setupZoomListener = () => {
        this.map.on('zoomend', this.handleZoomChange);
    }

    handleZoomChange = () => {
        if (!this.pendingZoomUpdate) {
            this.pendingZoomUpdate = true;
            this.zoomRafId = requestAnimationFrame(this.performZoomUpdate);
        }
    }

    performZoomUpdate = async () => {
        // The flag reset sat inside the `if (source)` branch: a style swap drops
        // every source, so a frame that found none left `pendingZoomUpdate` true
        // forever and `handleZoomChange` never scheduled another pass again.
        const source = this.map?.getSource('brushes');
        if (!source) { this.pendingZoomUpdate = false; return; }

        const data = await readGeoJSONSourceDataAsync(source);
        if (!data?.features?.length) { this.pendingZoomUpdate = false; return; }

        const currentZoom = this.map.getZoom();
        let hasChanges = false;

        for (const feature of data.features) {
            const newLineWidth = calculateZoomCorrectedValue(feature.properties, currentZoom, {
                sourceProperty: 'lineWidth',
                calculatedProperty: 'calculatedLineWidth',
            });
            if (feature.properties.calculatedLineWidth !== newLineWidth) {
                feature.properties.calculatedLineWidth = newLineWidth;
                hasChanges = true;
            }
        }

        // The only one of the fifteen zoom passes that used to write on every
        // frame, empty collection included: a `setData` re-parses the collection,
        // rebuilds the geojson-vt index and drops every loaded tile of the source.
        if (hasChanges) {
            source.setData(data);
        }
        this.pendingZoomUpdate = false;
    }

    applyZoomCorrections = (features) => {
        return applyZoomCorrectionsUtil(features, this.map.getZoom(), {
            sourceProperty: 'lineWidth',
            calculatedProperty: 'calculatedLineWidth',
        });
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('brushes').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                syncZoomCorrectedProperty(
                    sourceFeature, feature, property, value, this.map.getZoom(),
                    { sourceProperty: 'lineWidth', calculatedProperty: 'calculatedLineWidth' }
                );
            }
        }

        this.map.getSource('brushes').setData(data);

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            return sourceFeature || feature;
        });

        this.updateSelectionManagerFeatures(freshFeatures);
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const correctedFeatures = this.applyZoomCorrections(features);

        const currentData = await this.map.getSource('brushes').getData();
        let _hasChanges = false;

        for (const selectedFeature of correctedFeatures) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('brushes', currentFeature);
                    _hasChanges = true;
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
                await removeFeature('brushes', featureId);
                const data = await this.map.getSource('brushes').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('brushes').setData(data);
            } catch (error) {
                console.error(`Error removing brush ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddBrushControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            feature.properties.createdAtZoom !== initialProperties.createdAtZoom
        );
    }

    updateFeatures = async (featuresBeforeZoomFix, save = false, onlyUpdateProperties = false) => {
        const features = this.applyZoomCorrections(featuresBeforeZoomFix);

        if (features.length > 0) {
            const data = await this.map.getSource('brushes').getData();
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('brushes', featureToUpdate);
                    }
                }
            }

            this.map.getSource('brushes').setData(data);

            this.updateSelectionManagerFeatures(features);
        }
    }

    /**
     * Update SelectionManager with current feature data
     * @param {Object} feature - Feature to update
     */
    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('brush', feature.properties.id, feature);
    }

    /**
     * Update SelectionManager with multiple features
     * @param {Array} features - Features to update
     */
    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'brush') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    // ===== UTILITY METHODS =====

    setupBaseEventListeners = () => {
        // Base listeners setup if needed
    }

    removeAllEventListeners = () => {
        this.removeDrawingEventListeners();
        this.clearPreview();
        this.map.off('zoomend', this.handleZoomChange);
        if (this.zoomRafId) {
            cancelAnimationFrame(this.zoomRafId);
            this.zoomRafId = null;
        }
    }
}

export default AddBrushControl;

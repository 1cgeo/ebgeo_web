// Path: js/military_tools/occupied_front_tool/add_occupied_front_control.js

import { queryHoverFeatures } from '../../tool_manager/helpers/hover-query.helpers.js';
import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '@store';
import { IDUtils, showWarning } from '@utils';
import { getPointerPosition } from '@utils/pointer-utils';
import { addOccupiedFrontAttributesToPanel } from './occupied_front_attributes_panel.js';
import AddOccupiedFrontGeometry from './add_occupied_front_geometry.js';
import { BaseControl } from '@tools';
import { createPreviewScheduler } from '../../tool_manager/helpers/preview-scheduler.js';

/**
 * Layers onHoverMove needs: 'occupied-front-edit-handles' (hasHandleAtPoint) and
 * 'occupied_fronts' (hasSelectedFeatureAtPoint).
 * Ids confirmed in layers/styles/tactical.layers.js:187 and :174.
 */
const HOVER_LAYER_IDS = ['occupied-front-edit-handles-layer', 'occupied-front-layer'];

class AddOccupiedFrontControl extends BaseControl {
    featureType = 'occupied_front';
    constructor(toolManager) {
        super(toolManager);

        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandleType = null;

        this.geometry = new AddOccupiedFrontGeometry();

        // ONE rAF gate for the whole preview, shared by the drawing and the
        // handle drag (never live together: a drag needs a selected feature),
        // which already shared this state. The occupied front does not snap, so
        // the frame only rebuilds the geometry; what the gate removes is the
        // 12/8 ms timer that used to sit INSIDE the frame.
        this._previewScheduler = createPreviewScheduler({
            raf: (callback) => requestAnimationFrame(callback),
            caf: (id) => cancelAnimationFrame(id),
            onFrame: (pointer) => this.performPreviewUpdate(pointer),
        });
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;

        // Pointer event state for edit handles
        this._activePointerId = null;

        // Bind pointer event handlers
        this._onEditPointerDown = this._onEditPointerDown.bind(this);
        this._onEditPointerMove = this._onEditPointerMove.bind(this);
        this._onEditPointerUp = this._onEditPointerUp.bind(this);
    }

    static DEFAULT_PROPERTIES = {
        color: '#000000',
        lineWidth: 4,
        opacity: 1.0,
        source: 'occupied_front',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== SINGLE SOURCE OF TRUTH =====

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
    }

    onRemove = () => {
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
        sectionPanel.className = 'occupied-front-attributes-section';

        try {
            addOccupiedFrontAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating occupied front attribute panel:', error);
        }
    }

    getDragSources() {
        return ['occupied_fronts'];
    }

    getEditHandleSources() {
        return ['occupied-front-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating occupied front selection box:', error);
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
        return ['occupied-front-layer'];
    }

    getSourceNames() {
        return ['occupied_fronts'];
    }

    getEditHandleSource() {
        return 'occupied-front-edit-handles';
    }

    canCopy(_feature) {
        return true;
    }

    canPaste(_feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const oldCoords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);

        const newCoords = oldCoords.map(coord => [
            coord[0] + offset.dx,
            coord[1] + offset.dy
        ]);

        return {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newCoords
            },
            geometry: this.geometry.generate(newCoords)
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const coords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coords || coords.length < 1) {
            return [0, 0];
        }

        const origin = coords[0];
        return [
            origin[0] - referencePoint.lng,
            origin[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, _newCoords) {
        const coords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coords || coords.length < 3) {
            return feature;
        }

        const newBaseCoords = coords.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newBaseCoords
            },
            geometry: this.geometry.generate(newBaseCoords)
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
    }

    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.clearPreview();
        this.deselectFeature();
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

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for occupied front');
            return;
        }

        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);

        if (this.drawPoints.length === 1) {
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length === 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    /**
     * Park the pointer and ask for a frame. A mouse fires several moves inside
     * one frame and only the last one is ever drawn, so the geometry is built in
     * the frame callback, not here.
     */
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length !== 1) return;

        this._previewScheduler.request({ point: e.point, lngLat: e.lngLat });
    }

    /**
     * The frame callback: take the frame's last position and redraw once.
     * @param {Object} [pointer] - The frame's last `{ point, lngLat }`, when a
     *   pointer event parked one.
     */
    performPreviewUpdate = (pointer) => {
        if (pointer) {
            this.lastPreviewPosition = [pointer.lngLat.lng, pointer.lngLat.lat];
            // The centre is the FIRST clicked point, so it belongs to the drawing
            // path only; the handle drag never touched it.
            if (!this.isDraggingHandle && this.drawPoints.length === 1) {
                this.lastPreviewCenter = this.drawPoints[0];
            }
        }

        if (!this.lastPreviewPosition) return;

        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature) {
            this.updateOccupiedFrontPreview(this.lastPreviewPosition);
        } else if (this.drawPoints.length === 1 && this.lastPreviewCenter) {
            const p1 = this.lastPreviewCenter;
            const p2 = this.lastPreviewPosition;

            const distance = this.geometry.calculateDistance(p1, p2);
            const bearing = this.geometry.calculateBearing(p1, p2);
            const p3 = this.geometry.destination(p1, distance, bearing + 50);

            if (distance >= 10) {
                // No 12 ms debounce any more: this runs inside the frame gate,
                // and 12 ms is under the 16.7 ms of a frame, so it coalesced
                // nothing and only pushed the drawing one timer late.
                // Removed 2026-09-04.
                const previewGeometry = this.geometry.generate([p1, p2, p3]);
                this.showPreview(previewGeometry);
            }
        }
    }

    showPreview = (geometry) => {
        this.map.getSource('occupied-front-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                color: AddOccupiedFrontControl.DEFAULT_PROPERTIES.color,
                lineWidth: AddOccupiedFrontControl.DEFAULT_PROPERTIES.lineWidth,
                opacity: 0.7
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('occupied-front-feedback')) {
            this.map.getSource('occupied-front-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        const p1 = this.drawPoints[0];
        const p2 = this.drawPoints[1];

        const distance = this.geometry.calculateDistance(p1, p2);
        const bearing = this.geometry.calculateBearing(p1, p2);
        const p3 = this.geometry.destination(p1, distance, bearing + 50);

        if (distance < 10) {
            showWarning('Distância mínima: 10 metros');
            this.drawPoints = [];
            return;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('occupied_front', this.map);
        const coordinates = [p1, p2, p3];

        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...AddOccupiedFrontControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                id: featureId,
                nome: featureName,
                baseCoordinates: coordinates
            },
            geometry: this.geometry.generate(coordinates)
        };

        try {
            await addFeature('occupied_fronts', feature);

            const data = await this.map.getSource('occupied_fronts').getData();
            data.features.push(feature);
            this.map.getSource('occupied_fronts').setData(data);

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('occupied_front', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating occupied front:', error);
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
        this.activeHandleType = null;
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

        this.map.getSource('occupied-front-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        this.map.getSource('occupied-front-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('occupied-front-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('occupied-front-feedback').setData({
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
            layers: ['occupied-front-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandleType = handle.properties.handleId;
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

        // Same gate as the drawing preview: the geometry is rebuilt once per
        // frame, from the last position of that frame.
        this._previewScheduler.request({ point, lngLat });
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
            if (this.lastPreviewPosition && this.activeHandleType) {
                const coords = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);

                if (coords && coords.length >= 3) {
                    if (this.activeHandleType === 'p1') coords[0] = this.lastPreviewPosition;
                    else if (this.activeHandleType === 'p2') coords[1] = this.lastPreviewPosition;
                    else if (this.activeHandleType === 'p3') coords[2] = this.lastPreviewPosition;

                    const updatedFeature = {
                        ...selectedFeature,
                        properties: {
                            ...selectedFeature.properties,
                            baseCoordinates: coords
                        },
                        geometry: this.geometry.generate(coords)
                    };

                    await this.forceUpdateMainSource(updatedFeature);
                    this.updateSelectionManagerFeature(updatedFeature);
                    this.createEditHandles(updatedFeature);
                    this.updateUIAfterEdit();
                    await this.saveFeatureChanges(updatedFeature);
                }
            }
        }

        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    /**
     * Draw the handle-drag preview. Called from inside the frame gate, so it
     * already runs at most once per frame; the 8 ms debounce it used to carry
     * coalesced nothing (8 ms is under the 16.7 ms of a frame) and only pushed
     * the drawing one timer late. The "recapture the state to avoid a stale
     * closure" step went with the timer: nothing can change between the guard
     * below and the drawing now. Removed 2026-09-04.
     * @param {Array} newPosition - The `[lng, lat]` under the cursor
     */
    updateOccupiedFrontPreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType) return;

        const result = this.geometry.updateFromHandle(
            this.activeHandleType,
            newPosition,
            selectedFeature
        );

        if (!result) return;

        const previewFeature = {
            ...selectedFeature,
            properties: { ...selectedFeature.properties, baseCoordinates: result.baseCoordinates },
            geometry: result.geometry
        };

        this.map.getSource('occupied-front-feedback').setData({
            type: 'Feature',
            geometry: result.geometry,
            properties: {
                ...selectedFeature.properties,
                isSelected: true
            }
        });

        const previewHandles = this.geometry.createHandles(previewFeature);
        this.map.getSource('occupied-front-edit-handles').setData({
            type: 'FeatureCollection',
            features: previewHandles
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
            f.source === 'occupied-front-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'occupied_fronts' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('occupied_fronts').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (property === 'baseCoordinates') {
                    const newGeometry = this.geometry.generate(sourceFeature.properties.baseCoordinates);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        this.map.getSource('occupied_fronts').setData(data);

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
        const currentData = await this.map.getSource('occupied_fronts').getData();

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('occupied_fronts', currentFeature);
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            f.geometry = this.geometry.generate(f.properties.baseCoordinates);
        });

        // Use full update (onlyUpdateProperties=false) so the reverted GEOMETRY is
        // written too; the onlyUpdateProperties path copies only properties, leaving
        // the rendered/persisted shape at the edited geometry.
        await this.updateFeatures(features, true, false);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('occupied_fronts', featureId);
                const data = await this.map.getSource('occupied_fronts').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('occupied_fronts').setData(data);
            } catch (error) {
                console.error(`Error removing occupied front ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddOccupiedFrontControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('occupied_fronts').getData();
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
                        await updateFeature('occupied_fronts', featureToUpdate);
                    }
                }
            }

            this.map.getSource('occupied_fronts').setData(data);

            this.updateSelectionManagerFeatures(features);
        }
    }
    /**
     * Update SelectionManager with current feature data
     * @param {Object} feature - Feature to update in SelectionManager
     */
    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('occupied_front', feature.properties.id, feature);
    }

    /**
     * Update SelectionManager with multiple features
     * @param {Array} features - Array of features to update
     */
    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'occupied_front') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    // ===== UTILITY METHODS =====

    cancelPendingUpdates = () => {
        this._previewScheduler.cancel();
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.activeHandleType = null;
    }

    forceUpdateMainSource = async (feature) => {
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const data = await this.map.getSource('occupied_fronts').getData();
        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('occupied_fronts').setData(data);
        }
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('occupied_fronts', feature);
        } catch (error) {
            console.error('Error saving changes:', error);
        }
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
    }
}

export default AddOccupiedFrontControl;

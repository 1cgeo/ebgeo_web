// Path: js/military_tools/occupied_front_tool/add_occupied_front_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '@store';
import { IDUtils, showWarning } from '@utils';
import { getPointerPosition } from '@utils/pointer-utils';
import { addOccupiedFrontAttributesToPanel } from './occupied_front_attributes_panel.js';
import AddOccupiedFrontGeometry from './add_occupied_front_geometry.js';
import { BaseControl } from '@tools';
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';

/**
 * The dispatcher that owns the `occupied_fronts` source.
 *
 * EVERY write to `occupied_fronts` made in this file goes through it. The reason is not style: a
 * raw `source.setData()` issued while a diff is queued replaces MapLibre's pending-update slot and
 * the diff disappears with no error at all.
 *
 * Each public method here also awaits `flush()` before it returns. Two reasons, and the second is
 * the one that matters:
 * - the deferred write would otherwise land one animation frame after the caller resumed;
 * - `occupied_fronts` still has co-writers outside this file (the generic by-storageType writers:
 *   attribute table, features tab, import, clipboard, multi-selection actions, context menu, phone
 *   layout), and they all do read-modify-write with a raw `setData`. Draining inside the awaited
 *   method keeps the queue empty between gestures, so no co-writer can read a collection that is
 *   missing what this tool just wrote.
 *
 * NOTE the sources this does NOT own: `occupied-front-feedback` and `occupied-front-edit-handles`
 * keep their plain `setData`. They are rebuilt whole on every mousemove, hold a handful of features
 * with no stable `properties.id` (so they are declared without `promoteId` and are not diffable),
 * and a dropped frame there is a visibly stuttering rubber band.
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `occupied_fronts` source
 */
function occupiedFrontsSource(map) {
    return getGeoJsonDispatcher(map, 'occupied_fronts');
}

class AddOccupiedFrontControl extends BaseControl {
    featureType = 'occupied_front';
    constructor(toolManager) {
        super(toolManager);

        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandleType = null;

        this.geometry = new AddOccupiedFrontGeometry();

        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;

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
        // Releases the queue, its settle timers and the two map listeners the dispatcher opens per
        // dispatch. Dropping a batch here cannot lose a front: the store write always precedes the
        // source write, so the redraw that follows a style switch repopulates `occupied_fronts`
        // from persistence.
        destroyGeoJsonDispatcher(this.map, 'occupied_fronts');
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

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            this.lastPreviewCenter = this.drawPoints[0];
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
            this.updateOccupiedFrontPreview(this.lastPreviewPosition);
        } else if (this.drawPoints.length === 1 && this.lastPreviewCenter) {
            const p1 = this.lastPreviewCenter;
            const p2 = this.lastPreviewPosition;

            const distance = this.geometry.calculateDistance(p1, p2);
            const bearing = this.geometry.calculateBearing(p1, p2);
            const p3 = this.geometry.destination(p1, distance, bearing + 50);

            if (distance >= 10) {
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const previewGeometry = this.geometry.generate([p1, p2, p3]);
                    this.showPreview(previewGeometry);
                }, 12);
            }
        }

        this.pendingPreviewUpdate = false;
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

            const dispatcher = occupiedFrontsSource(this.map);
            dispatcher.add(feature);
            await dispatcher.flush();

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

        this.lastPreviewPosition = [lngLat.lng, lngLat.lat];

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

    updateOccupiedFrontPreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType) return;

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            // Recapture state inside setTimeout to avoid stale closures
            const currentHandleType = this.activeHandleType;
            const currentFeature = this.getSelectedFeature();

            if (!currentHandleType || !currentFeature) return;

            const result = this.geometry.updateFromHandle(
                currentHandleType,
                newPosition,
                currentFeature
            );

            if (!result) return;

            const previewFeature = {
                ...currentFeature,
                properties: { ...currentFeature.properties, baseCoordinates: result.baseCoordinates },
                geometry: result.geometry
            };

            this.map.getSource('occupied-front-feedback').setData({
                type: 'Feature',
                geometry: result.geometry,
                properties: {
                    ...currentFeature.properties,
                    isSelected: true
                }
            });

            const previewHandles = this.geometry.createHandles(previewFeature);
            this.map.getSource('occupied-front-edit-handles').setData({
                type: 'FeatureCollection',
                features: previewHandles
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
        // The collection read survives here on purpose. Two things below need the PREVIOUS source
        // feature and no diff hands them back: whether the feature exists at all (an unknown id
        // must be skipped, not created) and its `baseCoordinates`, which `geometry.generate`
        // consumes to rebuild the shape. Draining first keeps that read from being stale.
        const dispatcher = occupiedFrontsSource(this.map);
        await dispatcher.flush();
        const data = await this.map.getSource('occupied_fronts').getData();
        const upserts = [];

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                upserts.push(sourceFeature);
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (property === 'baseCoordinates') {
                    const newGeometry = this.geometry.generate(sourceFeature.properties.baseCoordinates);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        // An upsert, not a property patch: a `baseCoordinates` change also rewrites the geometry,
        // so the honest delta is the whole feature. `add` is a total replacement in MapLibre,
        // which is what the whole-collection write did to this entry, minus the other N-1.
        dispatcher.add(upserts);
        await dispatcher.flush();

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
        // Reads only, and it persists the SOURCE's version of each feature rather than the
        // selected one, so the queue has to be drained before the collection comes back.
        await occupiedFrontsSource(this.map).flush();
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
                await removeFeature('occupied_fronts', feature.properties.id);
            } catch (error) {
                console.error(`Error removing occupied front ${feature.properties.id}:`, error);
            }
        }

        // Removal by promoted key, with no collection read, and once for the whole batch instead
        // of once per feature. The keys go in raw, never coerced: MapLibre keyed the feature by
        // the very value that sits in `properties.id`, so a `String()` around it would miss a
        // numeric key instead of protecting anything.
        const dispatcher = occupiedFrontsSource(this.map);
        dispatcher.remove(features.map(f => f.properties.id));
        await dispatcher.flush();
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
            // The collection read survives here too: an unknown id must be skipped rather than
            // created, and the merge branch (`onlyUpdateProperties`) needs the previous source
            // properties to merge ONTO. Draining first keeps that read from being stale.
            const dispatcher = occupiedFrontsSource(this.map);
            await dispatcher.flush();
            const data = await this.map.getSource('occupied_fronts').getData();
            const upserts = [];

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    // The merged/replaced entry is a COMPLETE feature, so it ships as an upsert
                    // (`add` is a total replacement in MapLibre) rather than as a property patch:
                    // the same result the whole-collection write produced, without the other N-1
                    // features riding along.
                    upserts.push(data.features[featureIndex]);

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('occupied_fronts', featureToUpdate);
                    }
                }
            }

            dispatcher.add(upserts);
            await dispatcher.flush();

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
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.activeHandleType = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    /**
     * Writes one edited front back into the source, unless a drag owns the screen.
     *
     * The read is kept, and only for the existence check: this is called from the handle-drag path
     * with a feature derived from the SELECTION, and `add` would CREATE an id the source no longer
     * has instead of the silent skip the old `if (sourceFeature)` produced. The write itself is
     * now a one-feature upsert rather than the whole collection.
     * @param {Object} feature - Edited occupied-front feature
     */
    forceUpdateMainSource = async (feature) => {
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const dispatcher = occupiedFrontsSource(this.map);
        await dispatcher.flush();
        const data = await this.map.getSource('occupied_fronts').getData();
        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
        if (sourceFeature) {
            dispatcher.add({
                ...sourceFeature,
                properties: { ...feature.properties },
                geometry: { ...feature.geometry },
            });
            await dispatcher.flush();
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

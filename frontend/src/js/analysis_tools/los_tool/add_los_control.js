// Path: js/analysis_tools/los_tool/add_los_control.js

import { addFeature, updateFeature, removeFeature, getCurrentMapFeatures, batchUpdateLOSFeatures, getActiveLayerIdSync } from '@store';
import { IDUtils } from '@utils';
import { addLOSAttributesToPanel, createLOSInfoSection, addLOSParametersToPanel } from './los_attributes_panel.js';
import AddLOSGeometry from './add_los_geometry.js';
import { BaseControl } from '@tools';
import { getSnappingService } from '@js/snapping';
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';

/**
 * The two dispatchers that own the persistent LOS sources.
 *
 * EVERY write this file makes to `los` and `processed-los` goes through them. The reason is not
 * style: a raw `source.setData()` issued while a diff is queued replaces MapLibre's pending-update
 * slot and the diff disappears with no error at all.
 *
 * Each awaited method here ends in `flush()`, for the same reason the point tool does: both sources
 * still have co-writers outside this file (the generic by-storageType paths of the attribute table,
 * the features tab, import, the clipboard and the context menu, plus `setOrCreateSource` on every
 * redraw), and they all do read-modify-write with a raw `setData`. Draining inside the awaited
 * method keeps the queue empty between gestures, so no co-writer reads a collection missing what
 * this tool just wrote.
 *
 * The two ephemeral sources are deliberately NOT dispatched: `los-feedback` is rebuilt whole per
 * mousemove, holds one transient geometry with no `properties.id` and is declared without
 * `promoteId`, so a diff has nothing to key on and nothing to save.
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `los` source
 */
function losSource(map) {
    return getGeoJsonDispatcher(map, 'los');
}

/**
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `processed-los` source
 */
function processedLosSource(map) {
    return getGeoJsonDispatcher(map, 'processed-los');
}

/**
 * The two derived ids a LOS feature owns in `processed-los`.
 *
 * They are deterministic (`add_los_geometry.js` mints exactly these two suffixes), which is what
 * lets the removals and the patches below skip the collection read entirely. A `remove` or an
 * `update` of an id that is not in the source is a documented silent no-op in MapLibre, so naming
 * the `-obstructed` half when a straight-line LOS never produced one costs nothing.
 * @param {string} featureId - Parent LOS feature id
 * @returns {Array<string>} derived ids
 */
function processedIdsOf(featureId) {
    return [`${featureId}-visible`, `${featureId}-obstructed`];
}

class AddLOSControl extends BaseControl {
    featureType = 'los';
    constructor(toolManager) {
        super(toolManager);

        this.startPoint = null;
        this.endPoint = null;
        this.geometry = new AddLOSGeometry();
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;
        this.dragRecalculateTimeout = null;
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
        if (this.map) {
            // Releases both queues, their settle timers and the map listeners the dispatchers open
            // per dispatch. Dropping a batch here cannot lose a LOS: the store write always
            // precedes the source write, so the redraw that follows a style switch repopulates
            // both sources from persistence.
            destroyGeoJsonDispatcher(this.map, 'los');
            destroyGeoJsonDispatcher(this.map, 'processed-los');
        }
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
        return ['los'];
    }

    getEditHandleSources() {
        return [];
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
        return null;
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

    calculateMoveOffset(feature, referencePoint) {
        const coordinates = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
        if (!coordinates || coordinates.length === 0) {
            return [0, 0];
        }

        const firstPoint = coordinates[0];
        return [
            firstPoint[0] - referencePoint.lng,
            firstPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, _newCoords) {
        const oldCoords = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
        if (!oldCoords) return feature;

        const newLOSCoords = oldCoords.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        return {
            ...feature,
            geometry: {
                type: 'LineString',
                coordinates: newLOSCoords
            }
        };
    }

    async recalculateLOSAfterMove(movedFeatures) {
        for (const feature of movedFeatures) {
            const coordinates = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
            const options = {
                observerHeight: feature.properties.observerHeight ?? 1.5,
                targetHeight: feature.properties.targetHeight ?? 0,
                samplePoints: feature.properties.samplePoints ?? 100
            };
            const result = await this.geometry.recalculateFromCoordinates(coordinates, this.map, options);

            this.updateMainSourceAfterRecalculation(feature, result);
            this.updateProcessedSourcesAfterRecalculation(feature, result);
        }
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

    /**
     * Synchronize edit handles after drag operation
     * Ensures profile panel is updated after complete recalculation
     * @param {Array} movedFeatures - Array of moved features
     */
    syncEditHandlesAfterDrag = async (movedFeatures) => {
        const losFeatures = movedFeatures.filter(f => f.properties.source === 'los');

        if (losFeatures.length === 0) return;

        clearTimeout(this.dragRecalculateTimeout);
        this.dragRecalculateTimeout = setTimeout(async () => {
            this.showRecalculatingState();

            try {
                const updatedFeatures = await this.recalculateMovedLOSFeatures(losFeatures);
                this.updateSelectionManagerFeatures(updatedFeatures);
                this.selectionManager.updateUI();
            } catch (error) {
                console.error('Error recalculating LOS after drag:', error);
            } finally {
                this.hideRecalculatingState();
            }
        }, 50);
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

    /**
     * Recalculate LOS features after movement
     * @param {Array} movedFeatures - Array of moved LOS features
     * @returns {Array} Array of updated features
     */
    async recalculateMovedLOSFeatures(movedFeatures) {
        const updatedFeatures = [];

        for (const movedFeature of movedFeatures) {
            if (movedFeature.properties.source === 'los') {
                try {
                    const coordinates = this.geometry.extractCoordinatesFromGeometry(movedFeature.geometry);
                    if (coordinates) {
                        const options = {
                            observerHeight: movedFeature.properties.observerHeight ?? 1.5,
                            targetHeight: movedFeature.properties.targetHeight ?? 0,
                            samplePoints: movedFeature.properties.samplePoints ?? 100
                        };

                        const result = await this.geometry.recalculateFromCoordinates(coordinates, this.map, options);

                        movedFeature.geometry = result.geometry;
                        movedFeature.properties.profileData = JSON.stringify(result.profileData);
                        movedFeature.properties.visibleLength = result.visibleLength;
                        movedFeature.properties.obstructedLength = result.obstructedLength;
                        movedFeature.properties.totalLength = result.totalLength;

                        await updateFeature('los', movedFeature);

                        if (movedFeature.properties.measure) {
                            this.updateFeatureMeasurement(movedFeature);
                        }

                        await this.updateProcessedFeaturesAfterMove(movedFeature);

                        updatedFeatures.push(movedFeature);
                    }
                } catch (error) {
                    console.error('Error recalculating LOS after movement:', error);
                }
            }
        }

        return updatedFeatures;
    }

    /**
     * Update processed features after main feature movement
     * @param {Object} mainFeature - Updated main LOS feature
     */
    async updateProcessedFeaturesAfterMove(mainFeature) {
        // Remove the old pair, then upsert the regenerated one. The read is gone: the ids are
        // derived, and inside one batch `remove` followed by `add` on the same key coalesces into
        // the `add` alone (a total replacement), while the half that is not regenerated keeps its
        // removal. Both are enqueued only after persistence, which is where the whole-collection
        // write sat.
        const newProcessedFeatures = this.geometry.generateProcessedFeatures(mainFeature);
        for (const processedFeature of newProcessedFeatures) {
            await updateFeature('processed_los', processedFeature);
        }

        const dispatcher = processedLosSource(this.map);
        dispatcher.remove(processedIdsOf(mainFeature.properties.id));
        dispatcher.add(newProcessedFeatures);

        await dispatcher.flush();
    }

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

    handleMouseMove = (e) => {
        if (!this.isActive || !this.startPoint) return;

        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;

        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }

        this.lastPreviewCenter = this.startPoint;
        this.lastPreviewPosition = [snap.lng, snap.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate.bind(this));
        }
    }

    performPreviewUpdate = () => {
        if (!this.lastPreviewCenter || !this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            const previewGeometry = this.geometry.generate([this.lastPreviewCenter, this.lastPreviewPosition]);
            this.showPreview(previewGeometry);
        }, 8);

        this.pendingPreviewUpdate = false;
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

            const dispatcher = losSource(this.map);
            dispatcher.add(losFeature);
            await dispatcher.flush();

            const processedFeatures = this.geometry.generateProcessedFeatures(losFeature);
            const processedDispatcher = processedLosSource(this.map);

            for (const processedFeature of processedFeatures) {
                await addFeature('processed_los', processedFeature);
                processedDispatcher.add(processedFeature);
            }

            await processedDispatcher.flush();

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

        const dispatcher = losSource(this.map);
        const processedDispatcher = processedLosSource(this.map);

        // The `los` read survives: the guard below skips a feature the source does not hold, and
        // the selection manager is handed the SOURCE copy afterwards, neither of which a diff
        // returns. The `processed-los` read is gone: the derived ids are deterministic, so the
        // property travels as a two-key patch instead of a whole-collection rewrite.
        await dispatcher.flush();
        const data = await this.map.getSource('los').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (property === 'measure') {
                    this.updateFeatureMeasurement(feature);
                }

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
    _performRecalculation = async (features) => {
        this.showRecalculatingState();

        try {
            // Acquired INSIDE the try: with no map (tool removed mid-recalculation) the registry
            // lookup throws, and outside the try that throw would skip the `finally` that clears
            // the recalculating cursor.
            const dispatcher = losSource(this.map);
            const processedDispatcher = processedLosSource(this.map);

            // The `los` read survives: the recalculation starts from the SOURCE geometry, which is
            // the one carrying the coordinates a diff cannot hand back. The `processed-los` read is
            // gone, replaced by a removal of the derived pair plus an upsert of the regenerated one.
            await dispatcher.flush();
            const data = await this.map.getSource('los').getData();

            for (const feature of features) {
                const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
                if (sourceFeature) {
                    const pendingChanges = this._pendingRecalculation?.get(feature.properties.id) || {};
                    Object.assign(sourceFeature.properties, pendingChanges);
                    Object.assign(feature.properties, pendingChanges);

                    const coordinates = this.geometry.extractCoordinatesFromGeometry(sourceFeature.geometry);
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

                        const newProcessedFeatures = this.geometry.generateProcessedFeatures(sourceFeature);

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

                        // Enqueued only after persistence, which is where the whole-collection
                        // write sat: a store failure must not leave the recalculated geometry on
                        // screen. Total replacement of this one feature, with the same object the
                        // collection write used to carry, plus the derived pair swapped out.
                        dispatcher.add(sourceFeature);
                        processedDispatcher.remove(processedIdsOf(feature.properties.id));
                        processedDispatcher.add(newProcessedFeatures);
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
        // Reads only, and it persists the SOURCE's version of each feature rather than the selected
        // one, so both queues have to be drained before the collections come back.
        await losSource(this.map).flush();
        await processedLosSource(this.map).flush();
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

        // NOT a diff, on purpose, and the one place in this file where the whole collection is
        // still written. The rebuild comes from the STORE, which is authoritative about the
        // cascade: `removeFeature('los', id)` also drops every processed feature whose id starts
        // with `<id>-`, and reading the survivors back resyncs the source with persistence instead
        // of trusting this file's idea of which derived ids exist. It goes through the dispatchers
        // only for ownership: a raw `setData` here would silently discard whatever is queued.
        const currentMapFeatures = await getCurrentMapFeatures();

        const dispatcher = losSource(this.map);
        const processedDispatcher = processedLosSource(this.map);
        dispatcher.setData(currentMapFeatures.los);
        processedDispatcher.setData(currentMapFeatures.processed_los);
        await dispatcher.flush();
        await processedDispatcher.flush();
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

        const dispatcher = losSource(this.map);
        const processedDispatcher = processedLosSource(this.map);

        // BOTH reads survive here, and each for its own reason: `los` because an unknown id must be
        // skipped rather than created (`add` would create it) and because the save path persists the
        // merged SOURCE copy, `processed-los` because the save path persists the EXISTING derived
        // features with the incoming properties folded in, and no diff hands those back.
        await dispatcher.flush();
        await processedDispatcher.flush();
        const data = await this.map.getSource('los').getData();
        const processedData = await this.map.getSource('processed-los').getData();

        for (const feature of features) {
            const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
            if (featureIndex !== -1) {
                if (onlyUpdateProperties) {
                    Object.assign(data.features[featureIndex].properties, feature.properties);
                    dispatcher.patch(feature.properties.id, { setProps: feature.properties });

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
                        processedDispatcher.add(processedFeature);
                    });
                } else {
                    data.features[featureIndex] = feature;
                    dispatcher.add(feature);
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

        await dispatcher.flush();
        await processedDispatcher.flush();
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
        if (this.isActive && !this.geometry.isTerrainAvailable(this.map)) {
            this.toolManager.deactivateCurrentTool();
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

        if (this.dragRecalculateTimeout) {
            clearTimeout(this.dragRecalculateTimeout);
            this.dragRecalculateTimeout = null;
        }

        if (this._recalculationDebounceTimer) {
            clearTimeout(this._recalculationDebounceTimer);
            this._recalculationDebounceTimer = null;
        }
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handleMouseMove);
        this.map.off('terrain', this._onTerrainChange);
        this.cancelPendingUpdates();
    }
}

export default AddLOSControl;

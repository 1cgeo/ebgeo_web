// Path: js/analysis_tools/los_tool/add_los_control.js

import { addFeature, updateFeature, removeFeature, getCurrentMapFeatures, batchUpdateLOSFeatures, getActiveLayerIdSync } from '@store';
import { IDUtils } from '@utils';
import { addLOSAttributesToPanel, createLOSInfoSection, addLOSParametersToPanel } from './los_attributes_panel.js';
import AddLOSGeometry from './add_los_geometry.js';
import { BaseControl } from '@tools';
import { createPreviewScheduler } from '@tools/helpers/preview-scheduler.js';
import { getSnappingService } from '@js/snapping';

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
        const processedData = await this.map.getSource('processed-los').getData();

        processedData.features = processedData.features.filter(f =>
            f.properties.id !== mainFeature.properties.id + '-visible' &&
            f.properties.id !== mainFeature.properties.id + '-obstructed'
        );

        const newProcessedFeatures = this.geometry.generateProcessedFeatures(mainFeature);
        for (const processedFeature of newProcessedFeatures) {
            await updateFeature('processed_los', processedFeature);
            processedData.features.push(processedFeature);
        }

        this.map.getSource('processed-los').setData(processedData);
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
    _performRecalculation = async (features) => {
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
        // Both gates: the drawing preview and the pre-click indicator.
        this._previewScheduler.cancel();
        this._preClickScheduler.cancel();
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;

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

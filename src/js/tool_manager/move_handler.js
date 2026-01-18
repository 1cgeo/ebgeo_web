// Path: js/tool_manager/move_handler.js

/**
 * @fileoverview Handler for dragging/moving selected features on the map.
 * Implements tool-centric architecture for feature movement calculations.
 */

import { getStateManager } from '../store';

class MoveHandler {
    /**
     * @param {Object} map - MapLibre map instance
     * @param {Object} selectionManager - Selection manager instance
     * @param {Object} uiManager - UI manager instance
     */
    constructor(map, selectionManager, uiManager) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.uiManager = uiManager;

        // Drag state - now delegated to StateManager via getter/setter
        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;

        // Animation frame management
        this.rafId = null;
        this.pendingUpdate = false;
        this.mouseMoveHandler = null;
        this.mouseUpHandler = null;

        // Cached position objects for performance (avoids object allocation during drag)
        this.cachedPosition = { lng: 0, lat: 0 };
        this.cachedDelta = { dx: 0, dy: 0 };
        this.coordsPool = { lng: 0, lat: 0 };
        this.tempCoords = { lng: 0, lat: 0 };

        this._setupEventListeners();
    }

    // =========================================================================
    // STATE MANAGER INTEGRATION
    // =========================================================================

    /**
     * Get dragging state from StateManager.
     * @returns {boolean}
     */
    get isDragging() {
        try {
            return getStateManager().get('ui.isDragging') || false;
        } catch (e) {
            return false;
        }
    }

    /**
     * Set dragging state in StateManager.
     * @param {boolean} value
     */
    set isDragging(value) {
        try {
            getStateManager().set('ui.isDragging', value);
        } catch (e) {
            // StateManager not available
        }
    }

    // =========================================================================
    // DYNAMIC SOURCE MANAGEMENT
    // =========================================================================

    /**
     * Get valid drag sources from all registered tools.
     * @returns {Array<string>} Array of valid drag source names
     */
    getValidDragSources() {
        const sources = new Set();

        for (const control of this.selectionManager.controls.values()) {
            const toolSources = control.getSourceNames();
            toolSources.forEach(source => sources.add(source));
        }

        return Array.from(sources);
    }

    /**
     * Get edit handle sources from all registered tools.
     * @returns {Array<string>} Array of edit handle source names
     */
    getEditHandleSources() {
        const sources = new Set();

        for (const control of this.selectionManager.controls.values()) {
            const editHandleSource = control.getEditHandleSource();
            if (editHandleSource) {
                sources.add(editHandleSource);
            }
        }

        return Array.from(sources);
    }

    // =========================================================================
    // TOOL-CENTRIC HELPER METHODS
    // =========================================================================

    /**
     * Get control for feature type.
     * @param {string} type
     * @returns {Object|undefined}
     */
    getControl(type) {
        return this.selectionManager.controls.get(type);
    }

    /**
     * Check if control supports tool-centric move interface.
     * @param {Object} control
     * @returns {boolean}
     */
    supportsToolCentricInterface(control) {
        return control &&
            typeof control.calculateMoveOffset === 'function' &&
            typeof control.updateFeatureForMove === 'function';
    }

    // =========================================================================
    // EVENT HANDLING
    // =========================================================================

    /**
     * Setup map event listeners.
     * @private
     */
    _setupEventListeners() {
        this.map.on('mousedown', this._onMouseDown.bind(this));
    }

    /**
     * Handle mouse down event.
     * @private
     */
    _onMouseDown(e) {
        this._startDrag(e);

        this._cleanupDragListeners();

        this.mouseMoveHandler = this._onMouseMove.bind(this);
        this.mouseUpHandler = this._onMouseUp.bind(this);

        this.map.on('mousemove', this.mouseMoveHandler);
        this.map.once('mouseup', this.mouseUpHandler);
    }

    /**
     * Cleanup drag event listeners.
     * @private
     */
    _cleanupDragListeners() {
        if (this.mouseMoveHandler) {
            this.map.off('mousemove', this.mouseMoveHandler);
            this.mouseMoveHandler = null;
        }
        if (this.mouseUpHandler) {
            this.map.off('mouseup', this.mouseUpHandler);
            this.mouseUpHandler = null;
        }
    }

    /**
     * Start drag operation.
     * @private
     */
    _startDrag(e) {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();
        if (allSelectedFeatures.length === 0) return;

        const clickedFeatures = this.map.queryRenderedFeatures(e.point);
        const validDragSources = this.getValidDragSources();
        const filteredFeatures = clickedFeatures.filter(feature =>
            validDragSources.includes(feature.source)
        );

        if (filteredFeatures.length === 0 || this._isClickOnEditHandle(e.point)) {
            return;
        }

        const isFeatureSelected = filteredFeatures.some(clickedFeature => {
            const clickedFeatureId = clickedFeature.properties.id;

            if (clickedFeatureId === null) {
                return false;
            }

            return allSelectedFeatures.some(selectedFeature => {
                const selectedFeatureId = selectedFeature.properties.id;
                return selectedFeatureId == clickedFeatureId;
            });
        });

        if (!isFeatureSelected) return;

        const movableFeatures = allSelectedFeatures.filter(feature => {
            const control = this.getControl(feature.properties.source);
            if (!control || !control.canMove) {
                console.warn(`Tool ${feature.properties.source} does not implement canMove interface`);
                return false;
            }
            return control.canMove(feature);
        });

        if (movableFeatures.length === 0) return;

        // Start dragging
        this.isDragging = true;
        this.map.dragPan.disable();
        this.uiManager.setDragging(true);
        this._setCursorStyle('grabbing');

        this.initialCoordinates = e.lngLat;
        this.cachedPosition.lng = e.lngLat.lng;
        this.cachedPosition.lat = e.lngLat.lat;
        this.cachedDelta.dx = 0;
        this.cachedDelta.dy = 0;

        this.selectedFeatures = movableFeatures;
        this.offsets = this._calculateOffsetsToolCentric(movableFeatures, this.initialCoordinates);
    }

    /**
     * Check if click is on edit handle.
     * @private
     */
    _isClickOnEditHandle(point) {
        const features = this.map.queryRenderedFeatures(point);
        const editHandleSources = this.getEditHandleSources();

        return features.some(f =>
            editHandleSources.includes(f.source) &&
            f.properties.user_isEditingHandle
        );
    }

    /**
     * Handle mouse move during drag.
     * @private
     */
    _onMouseMove(e) {
        if (!this.isDragging) return;

        this.cachedPosition.lng = e.lngLat.lng;
        this.cachedPosition.lat = e.lngLat.lat;
        this.cachedDelta.dx = this.cachedPosition.lng - this.initialCoordinates.lng;
        this.cachedDelta.dy = this.cachedPosition.lat - this.initialCoordinates.lat;

        if (!this.pendingUpdate) {
            this.pendingUpdate = true;
            this.rafId = requestAnimationFrame(this._performDragUpdate.bind(this));
        }
    }

    /**
     * Perform drag update in animation frame.
     * @private
     */
    _performDragUpdate() {
        if (!this.isDragging) {
            this.pendingUpdate = false;
            return;
        }

        this.uiManager.shiftSelectionBoxes(this.cachedDelta.dx, this.cachedDelta.dy);

        this.pendingUpdate = false;
    }

    /**
     * Handle mouse up - end drag.
     * @private
     */
    _onMouseUp = async (e) => {
        if (!this.isDragging) return;

        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingUpdate = false;

        this.isDragging = false;
        this.map.dragPan.enable();
        this.uiManager.setDragging(false);
        this._setCursorStyle('');

        this._cleanupDragListeners();

        const dx = this.cachedDelta.dx;
        const dy = this.cachedDelta.dy;
        const distanceMoved = Math.sqrt(dx * dx + dy * dy);
        const tolerance = 2 / Math.pow(2, this.map.getZoom());

        if (distanceMoved > tolerance) {
            this.tempCoords.lng = e.lngLat.lng;
            this.tempCoords.lat = e.lngLat.lat;

            const updatedFeatures = this._batchUpdateFeaturesToolCentric(this.selectedFeatures, dx, dy, this.tempCoords);

            this.uiManager.shiftSelectionBoxes(dx, dy, true);

            this._updateSelectionManagerFeatures(updatedFeatures);

            await this.selectionManager.updateSelectedFeatures();

            this.selectionManager.updateProfile();
            this._syncEditHandlesForMovedFeatures(updatedFeatures);
            this._updateMeasurementsForMovedFeatures(updatedFeatures);

            this.uiManager.updatePanels();
        }

        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;
    }

    // =========================================================================
    // TOOL-CENTRIC FEATURE CALCULATION
    // =========================================================================

    /**
     * Calculate offsets using tool-centric approach.
     * @private
     */
    _calculateOffsetsToolCentric(features, referencePoint) {
        const offsets = new Map();

        for (const feature of features) {
            const featureId = feature.properties.id;
            if (featureId !== null) {
                const control = this.getControl(feature.properties.source);

                if (!this.supportsToolCentricInterface(control)) {
                    console.warn(`Tool ${feature.properties.source} does not implement tool-centric move interface`);
                    continue;
                }

                const offset = control.calculateMoveOffset(feature, referencePoint);

                offsets.set(featureId, {
                    feature: feature,
                    source: feature.properties.source,
                    offset: offset
                });
            }
        }

        return offsets;
    }

    /**
     * Batch update features using tool-centric approach.
     * @private
     */
    _batchUpdateFeaturesToolCentric(features, dx, dy, newPos) {
        const updatedFeatures = new Array(features.length);

        for (let i = 0; i < features.length; i++) {
            const feature = features[i];
            const featureId = feature.properties.id;

            if (featureId !== null && this.offsets.has(featureId)) {
                const { offset } = this.offsets.get(featureId);

                this.coordsPool.lng = newPos.lng + offset[0];
                this.coordsPool.lat = newPos.lat + offset[1];

                const control = this.getControl(feature.properties.source);
                if (!this.supportsToolCentricInterface(control)) {
                    console.warn(`Tool ${feature.properties.source} does not implement tool-centric update interface`);
                    updatedFeatures[i] = feature;
                    continue;
                }

                const updatedFeature = control.updateFeatureForMove(feature, dx, dy, this.coordsPool);
                updatedFeatures[i] = { ...updatedFeature, source: feature.properties.source };
            } else {
                updatedFeatures[i] = feature;
            }
        }

        return updatedFeatures;
    }

    // =========================================================================
    // SELECTION MANAGER INTEGRATION
    // =========================================================================

    /**
     * Update StateManager with moved features.
     * @private
     */
    _updateSelectionManagerFeatures(updatedFeatures) {
        try {
            const stateManager = getStateManager();

            // Clear and re-add with updated features
            stateManager.batchUpdate(() => {
                stateManager.clearSelection();

                for (const feature of updatedFeatures) {
                    const type = feature.properties.source;
                    const featureId = feature.properties.id;
                    if (featureId) {
                        stateManager.addToSelection(type, String(featureId), feature);
                    }
                }
            });
        } catch (e) {
            console.warn('Could not update StateManager after move:', e);
        }
    }

    // =========================================================================
    // POST-MOVE UPDATES
    // =========================================================================

    /**
     * Update measurements for moved features.
     * @private
     */
    _updateMeasurementsForMovedFeatures(updatedFeatures) {
        for (const feature of updatedFeatures) {
            const type = feature.properties.source;

            if (type === 'line' && feature.properties.measure) {
                const lineControl = this.getControl('line');
                if (lineControl?.updateFeatureMeasurement) {
                    lineControl.updateFeatureMeasurement(feature);
                }
            } else if (type === 'polygon' && feature.properties.measure) {
                const polygonControl = this.getControl('polygon');
                if (polygonControl?.updateFeatureMeasurement) {
                    polygonControl.updateFeatureMeasurement(feature);
                }
            } else if (type === 'los' && feature.properties.measure) {
                const losControl = this.getControl('los');
                if (losControl?.updateFeatureMeasurement) {
                    losControl.updateFeatureMeasurement(feature);
                }
            }
        }
    }

    /**
     * Sync edit handles using tool-centric approach.
     * @private
     */
    _syncEditHandlesForMovedFeatures(updatedFeatures) {
        const featuresByType = new Map();

        for (const feature of updatedFeatures) {
            const type = feature.properties.source;
            if (!featuresByType.has(type)) {
                featuresByType.set(type, []);
            }
            featuresByType.get(type).push(feature);
        }

        featuresByType.forEach((features, type) => {
            const control = this.getControl(type);

            if (control && typeof control.syncEditHandlesAfterDrag === 'function') {
                control.syncEditHandlesAfterDrag(features);
            } else if (control) {
                console.warn(`Tool ${type} does not implement syncEditHandlesAfterDrag interface`);
            }
        });
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    /**
     * Set cursor style.
     * @private
     */
    _setCursorStyle(style) {
        this.map.getCanvas().style.cursor = style;
    }

    /**
     * Cleanup resources.
     * Call when component is destroyed.
     */
    destroy() {
        this._cleanupDragListeners();

        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;
    }
}

export default MoveHandler;

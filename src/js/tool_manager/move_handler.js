// Path: js/tool_manager/move_handler.js

/**
 * @fileoverview Handler for dragging/moving selected features on the map.
 * Implements tool-centric architecture for feature movement calculations.
 */

import { getStateManager, isCurrentMapLockedSync } from '../store';

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

        // Cached position objects for performance (avoids object allocation during drag)
        this.cachedPosition = { lng: 0, lat: 0 };
        this.cachedDelta = { dx: 0, dy: 0 };
        this.coordsPool = { lng: 0, lat: 0 };
        this.tempCoords = { lng: 0, lat: 0 };

        // Performance: Cached StateManager reference
        /** @type {import('../state/state_manager.js').StateManager|null} */
        this._stateManagerRef = null;

        // Performance: Cached drag sources (invalidated when controls change)
        /** @type {Array<string>|null} */
        this._cachedValidDragSources = null;
        /** @type {Array<string>|null} */
        this._cachedEditHandleSources = null;
        /** @type {number} Last controls count for cache invalidation */
        this._lastControlsCount = 0;

        // Bound handlers for cleanup
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchMove = this._onTouchMove.bind(this);
        this._onTouchEnd = this._onTouchEnd.bind(this);

        this._setupEventListeners();
    }

    // =========================================================================
    // PERFORMANCE: CACHED STATE MANAGER ACCESS
    // =========================================================================

    /**
     * Get cached StateManager reference.
     * @returns {import('../state/state_manager.js').StateManager|null}
     * @private
     */
    _getStateManager() {
        if (!this._stateManagerRef) {
            try {
                this._stateManagerRef = getStateManager();
            } catch (_e) {
                return null;
            }
        }
        return this._stateManagerRef;
    }

    // =========================================================================
    // STATE MANAGER INTEGRATION
    // =========================================================================

    /**
     * Get dragging state from StateManager.
     * Uses getUnsafe() for performance in hot path.
     * @returns {boolean}
     */
    get isDragging() {
        const sm = this._getStateManager();
        if (!sm) return false;
        return sm.getUnsafe('ui.isDragging') || false;
    }

    /**
     * Set dragging state in StateManager.
     * @param {boolean} value
     */
    set isDragging(value) {
        const sm = this._getStateManager();
        if (sm) {
            sm.set('ui.isDragging', value);
        }
    }

    // =========================================================================
    // DYNAMIC SOURCE MANAGEMENT (with caching)
    // =========================================================================

    /**
     * Check if cached sources need invalidation.
     * Invalidates cache when controls count changes.
     * @private
     */
    _invalidateCacheIfNeeded() {
        const currentCount = this.selectionManager.controls.size;
        if (currentCount !== this._lastControlsCount) {
            this._cachedValidDragSources = null;
            this._cachedEditHandleSources = null;
            this._lastControlsCount = currentCount;
        }
    }

    /**
     * Get valid drag sources from all registered tools.
     * Uses caching to avoid Set/Array creation on each call.
     * @returns {Array<string>} Array of valid drag source names
     */
    getValidDragSources() {
        this._invalidateCacheIfNeeded();

        if (this._cachedValidDragSources) {
            return this._cachedValidDragSources;
        }

        const sources = new Set();

        for (const control of this.selectionManager.controls.values()) {
            const toolSources = control.getSourceNames();
            toolSources.forEach(source => sources.add(source));
        }

        this._cachedValidDragSources = Array.from(sources);
        return this._cachedValidDragSources;
    }

    /**
     * Get edit handle sources from all registered tools.
     * Uses caching to avoid Set/Array creation on each call.
     * @returns {Array<string>} Array of edit handle source names
     */
    getEditHandleSources() {
        this._invalidateCacheIfNeeded();

        if (this._cachedEditHandleSources) {
            return this._cachedEditHandleSources;
        }

        const sources = new Set();

        for (const control of this.selectionManager.controls.values()) {
            const editHandleSource = control.getEditHandleSource();
            if (editHandleSource) {
                sources.add(editHandleSource);
            }
        }

        this._cachedEditHandleSources = Array.from(sources);
        return this._cachedEditHandleSources;
    }

    /**
     * Manually invalidate source caches.
     * Call this when controls are added/removed.
     */
    invalidateSourceCache() {
        this._cachedValidDragSources = null;
        this._cachedEditHandleSources = null;
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
     * Uses MapLibre events for mouse and direct touch events for touch support.
     * @private
     */
    _setupEventListeners() {
        // Use MapLibre map events for mouse (works reliably with MapLibre)
        this.map.on('mousedown', this._onMouseDown);

        // Add touch events directly on canvas for touch support
        const canvas = this.map.getCanvasContainer();
        canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    }

    /**
     * Handle mouse down event via MapLibre.
     * @private
     */
    _onMouseDown(e) {
        // Only handle left mouse button
        if (e.originalEvent.button !== 0) return;

        // Ctrl/Meta and Shift belong to the camera gesture (pitch/bearing).
        // Without this guard the feature moves while the map rotates, and
        // _endDrag re-enables dragPan in the middle of the rotation.
        if (e.originalEvent.ctrlKey || e.originalEvent.metaKey || e.originalEvent.shiftKey) return;

        this._startDrag(e);

        if (this.isDragging) {
            this.map.on('mousemove', this._onMouseMove);
            this.map.on('mouseup', this._onMouseUp);
        }
    }

    /**
     * Handle mouse move during drag.
     * @private
     */
    _onMouseMove(e) {
        if (!this.isDragging || !this.initialCoordinates) return;
        this._scheduleDragUpdate(e.lngLat);
    }

    /**
     * Handle mouse up - end drag.
     * @private
     */
    async _onMouseUp(e) {
        if (!this.isDragging) return;

        this.map.off('mousemove', this._onMouseMove);
        this.map.off('mouseup', this._onMouseUp);

        await this._endDrag(e.lngLat);
    }

    /**
     * Handle touch start event.
     * @private
     */
    _onTouchStart(e) {
        // Only handle single touch
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        const canvas = this.map.getCanvasContainer();
        const rect = canvas.getBoundingClientRect();
        const point = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
        const lngLat = this.map.unproject([point.x, point.y]);

        // Create map event-like object
        const mapEvent = {
            point,
            lngLat,
            originalEvent: e
        };

        this._startDrag(mapEvent);

        if (this.isDragging) {
            // Store start position for threshold check
            this._touchStartPoint = { x: touch.clientX, y: touch.clientY };
            this._touchDragConfirmed = false;

            canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
            canvas.addEventListener('touchend', this._onTouchEnd);
            canvas.addEventListener('touchcancel', this._onTouchEnd);

            e.preventDefault();
        }
    }

    /**
     * Handle touch move during drag.
     * @private
     */
    _onTouchMove(e) {
        if (!this.isDragging || !this.initialCoordinates || e.touches.length !== 1) return;

        const touch = e.touches[0];

        // Require 10px movement to confirm drag (prevents accidental moves)
        if (!this._touchDragConfirmed && this._touchStartPoint) {
            const dist = Math.hypot(
                touch.clientX - this._touchStartPoint.x,
                touch.clientY - this._touchStartPoint.y
            );
            if (dist < 10) return;
            this._touchDragConfirmed = true;
        }

        const canvas = this.map.getCanvasContainer();
        const rect = canvas.getBoundingClientRect();
        const point = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
        const lngLat = this.map.unproject([point.x, point.y]);

        this._scheduleDragUpdate(lngLat);

        e.preventDefault();
    }

    /**
     * Handle touch end - end drag.
     * @private
     */
    async _onTouchEnd(_e) {
        if (!this.isDragging) return;

        const canvas = this.map.getCanvasContainer();
        canvas.removeEventListener('touchmove', this._onTouchMove);
        canvas.removeEventListener('touchend', this._onTouchEnd);
        canvas.removeEventListener('touchcancel', this._onTouchEnd);

        // Only apply changes if drag was confirmed (moved > 10px)
        if (this._touchDragConfirmed) {
            await this._endDrag(this.cachedPosition);
        } else {
            // Cancel drag without applying changes
            this._cancelDrag();
        }

        this._touchStartPoint = null;
        this._touchDragConfirmed = false;
    }

    /**
     * Cleanup drag event listeners.
     * @private
     */
    _cleanupDragListeners() {
        this.map.off('mousemove', this._onMouseMove);
        this.map.off('mouseup', this._onMouseUp);

        const canvas = this.map.getCanvasContainer();
        canvas.removeEventListener('touchmove', this._onTouchMove);
        canvas.removeEventListener('touchend', this._onTouchEnd);
        canvas.removeEventListener('touchcancel', this._onTouchEnd);
    }

    /**
     * Start drag operation.
     * @private
     */
    _startDrag(e) {
        if (isCurrentMapLockedSync()) return;

        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();
        if (allSelectedFeatures.length === 0) return;

        // Performance: Query features once and reuse for both checks
        const clickedFeatures = this.map.queryRenderedFeatures(e.point);

        const validDragSources = this.getValidDragSources();
        const filteredFeatures = clickedFeatures.filter(feature =>
            validDragSources.includes(feature.source)
        );

        // Performance: Check edit handle using already-queried features
        if (filteredFeatures.length === 0 || this._isClickOnEditHandleCached(clickedFeatures)) {
            return;
        }

        const isFeatureSelected = filteredFeatures.some(clickedFeature => {
            const clickedFeatureId = clickedFeature.properties.id;

            if (clickedFeatureId === null) {
                return false;
            }

            return allSelectedFeatures.some(selectedFeature => {
                const selectedFeatureId = selectedFeature.properties.id;
                return selectedFeatureId === clickedFeatureId;
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
     * Check if click is on edit handle using pre-queried features.
     * Performance optimization to avoid duplicate queryRenderedFeatures calls.
     * @param {Array} features - Pre-queried features from queryRenderedFeatures
     * @returns {boolean}
     * @private
     */
    _isClickOnEditHandleCached(features) {
        const editHandleSources = this.getEditHandleSources();

        return features.some(f =>
            editHandleSources.includes(f.source) &&
            f.properties.user_isEditingHandle
        );
    }

    /**
     * Update cached position/delta and schedule a rAF drag update.
     * Shared by mouse and touch move handlers.
     * @param {Object} lngLat - { lng, lat } position
     * @private
     */
    _scheduleDragUpdate(lngLat) {
        this.cachedPosition.lng = lngLat.lng;
        this.cachedPosition.lat = lngLat.lat;
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
     * End drag operation and apply changes.
     * @private
     */
    async _endDrag(finalPosition) {
        // Guard against duplicate calls (race between mouse/touch events)
        if (!this.selectedFeatures) return;

        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingUpdate = false;

        this.isDragging = false;
        this.map.dragPan.enable();
        this.uiManager.setDragging(false);
        this._setCursorStyle('');

        const dx = this.cachedDelta.dx;
        const dy = this.cachedDelta.dy;
        const distanceMoved = Math.sqrt(dx * dx + dy * dy);
        const tolerance = 2 / Math.pow(2, this.map.getZoom());

        if (distanceMoved > tolerance) {
            this.tempCoords.lng = finalPosition.lng;
            this.tempCoords.lat = finalPosition.lat;

            const updatedFeatures = this._batchUpdateFeaturesToolCentric(this.selectedFeatures, dx, dy, this.tempCoords);

            this.uiManager.shiftSelectionBoxes(dx, dy, true);

            this._updateSelectionManagerFeatures(updatedFeatures);

            await this.selectionManager.updateSelectedFeatures();

            this.selectionManager.updateProfile();
            await this._syncEditHandlesForMovedFeatures(updatedFeatures);
            this._updateMeasurementsForMovedFeatures(updatedFeatures);

            this.uiManager.updatePanels();
        }

        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;
    }

    /**
     * Cancel drag operation without applying changes.
     * @private
     */
    _cancelDrag() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingUpdate = false;

        this.isDragging = false;
        this.map.dragPan.enable();
        this.uiManager.setDragging(false);
        this._setCursorStyle('');

        // Reset selection boxes to original position
        this.uiManager.shiftSelectionBoxes(0, 0, true);

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
                    feature,
                    source: feature.properties.source,
                    offset
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
        const stateManager = this._getStateManager();
        if (!stateManager) {
            console.warn('Could not update StateManager after move: StateManager unavailable');
            return;
        }

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
    }

    // =========================================================================
    // POST-MOVE UPDATES
    // =========================================================================

    /**
     * Update measurements for moved features.
     * Only line, polygon, and los types support measurements.
     * @private
     */
    _updateMeasurementsForMovedFeatures(updatedFeatures) {
        const measurableTypes = ['line', 'polygon', 'los'];

        for (const feature of updatedFeatures) {
            const type = feature.properties.source;

            if (measurableTypes.includes(type) && feature.properties.measure) {
                const control = this.getControl(type);
                control?.updateFeatureMeasurement?.(feature);
            }
        }
    }

    /**
     * Sync edit handles using tool-centric approach.
     * @private
     */
    async _syncEditHandlesForMovedFeatures(updatedFeatures) {
        const featuresByType = new Map();

        for (const feature of updatedFeatures) {
            const type = feature.properties.source;
            if (!featuresByType.has(type)) {
                featuresByType.set(type, []);
            }
            featuresByType.get(type).push(feature);
        }

        for (const [type, features] of featuresByType) {
            const control = this.getControl(type);

            if (control && typeof control.syncEditHandlesAfterDrag === 'function') {
                await control.syncEditHandlesAfterDrag(features);
            } else if (control) {
                console.warn(`Tool ${type} does not implement syncEditHandlesAfterDrag interface`);
            }
        }
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

        // Remove main event listeners
        this.map.off('mousedown', this._onMouseDown);

        const canvas = this.map.getCanvasContainer();
        canvas.removeEventListener('touchstart', this._onTouchStart);

        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;
    }
}

export default MoveHandler;

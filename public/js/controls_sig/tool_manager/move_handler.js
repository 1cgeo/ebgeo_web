// Path: js\controls_sig\tool_manager\move_handler.js

class MoveHandler {
    constructor(map, selectionManager, uiManager) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.uiManager = uiManager;

        // Core state
        this.isDragging = false;
        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;

        // Performance optimization properties
        this.rafId = null;
        this.pendingUpdate = false;
        this.mouseMoveHandler = null;
        this.mouseUpHandler = null;

        // Coordinate caching and pooling
        this.cachedPosition = { lng: 0, lat: 0 };
        this.cachedDelta = { dx: 0, dy: 0 };
        this.coordsPool = { lng: 0, lat: 0 };
        this.tempCoords = { lng: 0, lat: 0 };

        this.setupEventListeners();
    }

    // ===== DYNAMIC SOURCE MANAGEMENT =====

    /**
     * Get valid drag sources from all registered tools
     * @returns {Array} Array of valid drag source names
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
     * Get edit handle sources from all registered tools
     * @returns {Array} Array of edit handle source names
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

    // ===== TOOL-CENTRIC HELPER METHODS =====

    /**
     * Get control for feature type - compatible with new SelectionManager
     */
    getControl(type) {
        return this.selectionManager.controls.get(type);
    }

    /**
     * Check if control supports tool-centric interface
     */
    supportsToolCentricInterface(control) {
        return control &&
            typeof control.calculateMoveOffset === 'function' &&
            typeof control.updateFeatureForMove === 'function';
    }

    // ===== INITIALIZATION =====

    setupEventListeners() {
        this.map.on('mousedown', this.onMouseDown.bind(this));
    }

    // ===== EVENT HANDLING =====

    onMouseDown(e) {
        this.startDrag(e);

        // Setup drag event listeners - clean previous ones if any
        this.cleanupDragListeners();

        // Create bound handlers for proper cleanup
        this.mouseMoveHandler = this.onMouseMove.bind(this);
        this.mouseUpHandler = this.onMouseUp.bind(this);

        this.map.on('mousemove', this.mouseMoveHandler);
        this.map.once('mouseup', this.mouseUpHandler);
    }

    cleanupDragListeners() {
        if (this.mouseMoveHandler) {
            this.map.off('mousemove', this.mouseMoveHandler);
            this.mouseMoveHandler = null;
        }
        if (this.mouseUpHandler) {
            this.map.off('mouseup', this.mouseUpHandler);
            this.mouseUpHandler = null;
        }
    }

    startDrag(e) {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();
        if (allSelectedFeatures.length === 0) return;

        const clickedFeatures = this.map.queryRenderedFeatures(e.point);
        const validDragSources = this.getValidDragSources();
        const filteredFeatures = clickedFeatures.filter(feature =>
            validDragSources.includes(feature.source)
        );

        // Early exit if clicking on ANY edit handle
        if (filteredFeatures.length === 0 || this.isClickOnEditHandle(e.point)) {
            return; // Let edit handlers take control
        }

        // Check if clicked feature is selected
        const isFeatureSelected = filteredFeatures.some(clickedFeature => {
            const clickedFeatureId = clickedFeature.properties.id;

            if (clickedFeatureId === null) {
                return false;
            }

            return allSelectedFeatures.some(selectedFeature => {
                const selectedFeatureId = selectedFeature.properties.id;
                return selectedFeatureId == clickedFeatureId; // Use loose equality for type coercion
            });
        });

        if (!isFeatureSelected) return;

        // Check if features can be moved using tool-centric approach ONLY
        const movableFeatures = allSelectedFeatures.filter(feature => {
            const control = this.getControl(feature.properties.source);
            if (!control || !control.canMove) {
                console.warn(`Tool ${feature.properties.source} does not implement canMove interface`);
                return false; // No fallback - must implement interface
            }
            return control.canMove(feature);
        });

        if (movableFeatures.length === 0) return;

        // Initialize drag state
        this.isDragging = true;
        this.map.dragPan.disable();
        this.uiManager.setDragging(true);
        this.setCursorStyle('grabbing');

        // Cache initial coordinates
        this.initialCoordinates = e.lngLat;
        this.cachedPosition.lng = e.lngLat.lng;
        this.cachedPosition.lat = e.lngLat.lat;
        this.cachedDelta.dx = 0;
        this.cachedDelta.dy = 0;

        // Cache selected features and calculate offsets using tool-centric approach ONLY
        this.selectedFeatures = movableFeatures;
        this.offsets = this.calculateOffsetsToolCentric(movableFeatures, this.initialCoordinates);
    }

    //Single method to check edit handles
    isClickOnEditHandle = (point) => {
        const features = this.map.queryRenderedFeatures(point);
        const editHandleSources = this.getEditHandleSources();

        return features.some(f =>
            editHandleSources.includes(f.source) &&
            f.properties.user_isEditingHandle
        );
    }

    onMouseMove(e) {
        if (!this.isDragging) return;

        // Update cached position and delta
        this.cachedPosition.lng = e.lngLat.lng;
        this.cachedPosition.lat = e.lngLat.lat;
        this.cachedDelta.dx = this.cachedPosition.lng - this.initialCoordinates.lng;
        this.cachedDelta.dy = this.cachedPosition.lat - this.initialCoordinates.lat;

        // Use requestAnimationFrame for smooth updates
        if (!this.pendingUpdate) {
            this.pendingUpdate = true;
            this.rafId = requestAnimationFrame(this.performDragUpdate.bind(this));
        }
    }

    performDragUpdate() {
        if (!this.isDragging) {
            this.pendingUpdate = false;
            return;
        }

        // Perform the actual UI update
        this.uiManager.shiftSelectionBoxes(this.cachedDelta.dx, this.cachedDelta.dy);

        this.pendingUpdate = false;
    }

    onMouseUp = async (e) => {
        if (!this.isDragging) return;

        // Cancel any pending RAF updates
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingUpdate = false;

        // Reset drag state
        this.isDragging = false;
        this.map.dragPan.enable();
        this.uiManager.setDragging(false);
        this.setCursorStyle('');

        // Clean up event listeners
        this.cleanupDragListeners();

        // Calculate final position using cached values
        const dx = this.cachedDelta.dx;
        const dy = this.cachedDelta.dy;
        const distanceMoved = Math.sqrt(dx * dx + dy * dy);
        const tolerance = 2 / Math.pow(2, this.map.getZoom());

        if (distanceMoved > tolerance) {
            // Reuse coordinate object
            this.tempCoords.lng = e.lngLat.lng;
            this.tempCoords.lat = e.lngLat.lat;

            // Batch update features using tool-centric approach ONLY
            const updatedFeatures = this.batchUpdateFeaturesToolCentric(this.selectedFeatures, dx, dy, this.tempCoords);

            // Final UI update
            this.uiManager.shiftSelectionBoxes(dx, dy, true);

            // Update SelectionManager with new features
            this.updateSelectionManagerFeatures(updatedFeatures);

            await this.selectionManager.updateSelectedFeatures();

            this.selectionManager.updateProfile();
            this.syncEditHandlesForMovedFeatures(updatedFeatures);
            this.updateMeasurementsForMovedFeatures(updatedFeatures);
            
            this.uiManager.updatePanels();
        }

        // Reset state
        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;
    }

    // ===== TOOL-CENTRIC FEATURE CALCULATION =====

    /**
     * Calculate offsets using tool-centric approach ONLY
     */
    calculateOffsetsToolCentric(features, referencePoint) {
        const offsets = new Map();

        for (const feature of features) {
            const featureId = feature.properties.id;
            if (featureId !== null) {
                const control = this.getControl(feature.properties.source);

                if (!this.supportsToolCentricInterface(control)) {
                    console.warn(`Tool ${feature.properties.source} does not implement tool-centric move interface`);
                    continue; // Skip feature - no fallback
                }

                // Use tool-centric method ONLY
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
     * Batch update features using tool-centric approach ONLY
     */
    batchUpdateFeaturesToolCentric(features, dx, dy, newPos) {
        const updatedFeatures = new Array(features.length);

        for (let i = 0; i < features.length; i++) {
            const feature = features[i];
            const featureId = feature.properties.id;

            if (featureId !== null && this.offsets.has(featureId)) {
                const { offset } = this.offsets.get(featureId);

                // Reuse coordinate object
                this.coordsPool.lng = newPos.lng + offset[0];
                this.coordsPool.lat = newPos.lat + offset[1];

                const control = this.getControl(feature.properties.source);
                if (!this.supportsToolCentricInterface(control)) {
                    console.warn(`Tool ${feature.properties.source} does not implement tool-centric update interface`);
                    updatedFeatures[i] = feature; // Keep original if no implementation
                    continue;
                }

                // Use tool-centric method ONLY
                const updatedFeature = control.updateFeatureForMove(feature, dx, dy, this.coordsPool);
                updatedFeatures[i] = { ...updatedFeature, source: feature.properties.source };
            } else {
                updatedFeatures[i] = feature; // Keep original if no offset found
            }
        }

        return updatedFeatures;
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    /**
     * Update SelectionManager with moved features
     */
    updateSelectionManagerFeatures(updatedFeatures) {
        // Clear existing selections using new API
        this.selectionManager.selectedFeatures.clear();

        // Add updated features using new API
        for (const feature of updatedFeatures) {
            const type = feature.properties.source;
            const featureId = feature.properties.id;
            if (featureId) {
                const key = `${type}:${featureId}`;
                this.selectionManager.selectedFeatures.set(key, { type, feature });
            }
        }
    }

    // ===== POST-MOVE UPDATES =====

    /**
     * Update measurements for moved features
     */
    updateMeasurementsForMovedFeatures = (updatedFeatures) => {
        for (const feature of updatedFeatures) {
            const type = feature.properties.source;

            // Update line measurements
            if (type === 'line' && feature.properties.measure) {
                const lineControl = this.getControl('line');
                if (lineControl && lineControl.updateFeatureMeasurement) {
                    lineControl.updateFeatureMeasurement(feature);
                }
            }

            // Update polygon measurements  
            else if (type === 'polygon' && feature.properties.measure) {
                const polygonControl = this.getControl('polygon');
                if (polygonControl && polygonControl.updateFeatureMeasurement) {
                    polygonControl.updateFeatureMeasurement(feature);
                }
            }

            // Update LOS measurements (if they have measure property)
            else if (type === 'los' && feature.properties.measure) {
                const losControl = this.getControl('los');
                if (losControl && losControl.updateFeatureMeasurement) {
                    losControl.updateFeatureMeasurement(feature);
                }
            }
        }
    }

    /**
     * Sync edit handles using tool-centric approach ONLY
     */
    syncEditHandlesForMovedFeatures = (updatedFeatures) => {
        // Group features by type for efficient processing
        const featuresByType = new Map();

        for (const feature of updatedFeatures) {
            const type = feature.properties.source;
            if (!featuresByType.has(type)) {
                featuresByType.set(type, []);
            }
            featuresByType.get(type).push(feature);
        }

        // Sync handles for each type using tool-centric approach ONLY
        featuresByType.forEach((features, type) => {
            const control = this.getControl(type);

            if (control && typeof control.syncEditHandlesAfterDrag === 'function') {
                control.syncEditHandlesAfterDrag(features);
            } else if (control) {
                console.warn(`Tool ${type} does not implement syncEditHandlesAfterDrag interface`);
            }
        });
    }

    // ===== UTILITY METHODS =====

    setCursorStyle(style) {
        this.map.getCanvas().style.cursor = style;
    }

    // Cleanup method for proper disposal
    destroy() {
        this.cleanupDragListeners();

        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        // Clear references
        this.selectedFeatures = null;
        this.offsets = null;
        this.initialCoordinates = null;
    }
}

export default MoveHandler;
// Path: js/controls_sig/tool_manager/base_control.js

/**
 * Base Control class with expanded tool-centric interface
 * Each tool should extend this and implement the methods they need
 */
class BaseControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = toolManager?.selectionManager;
        this.isActive = false;
    }

    // ===== CORE INTERFACE =====

    /**
     * Activate the tool
     */
    activate() {
        this.isActive = true;
    }

    /**
     * Deactivate the tool
     */
    deactivate() {
        this.isActive = false;
    }

    /**
     * Handle map click events
     * @param {Object} e - MapLibre click event
     */
    handleMapClick(e) {
    }

    // ===== SELECTION INTERFACE =====

    /**
     * Called when a feature of this type is selected
     * @param {Object} feature - Selected feature
     */
    onFeatureSelected(feature) {
    }

    /**
     * Called when a feature of this type is deselected
     * @param {Object} feature - Deselected feature
     */
    onFeatureDeselected(feature) {
    }

    /**
     * Called when all features are deselected
     */
    onGlobalDeselect() {
    }

    /**
     * Check if this tool is in editing mode
     * @returns {boolean}
     */
    isEditingMode() {
        return false;
    }

    /**
     * Check if feature has edit handles
     * @param {string} featureId - Feature ID
     * @returns {boolean}
     */
    hasEditHandle(featureId) {
        return false;
    }

    /**
     * Sync edit handles after feature is moved
     * @param {Array} movedFeatures - Array of moved features
     */
    syncEditHandlesAfterDrag(movedFeatures) {
    }

    // ===== MOVEMENT INTERFACE =====

    /**
     * Check if feature can be moved
     * @param {Object} feature - Feature to check
     * @returns {boolean}
     */
    canMove(feature) {
        return !feature.properties?.bloqueado;
    }

    /**
     * Calculate offset for drag operations
     * @param {Object} feature - Feature being moved
     * @param {Object} referencePoint - Reference point {lng, lat}
     * @returns {Array} [offsetX, offsetY]
     */
    calculateMoveOffset(feature, referencePoint) {
        const coords = feature.geometry.coordinates;
        if (feature.geometry.type === 'Point') {
            return [
                coords[0] - referencePoint.lng,
                coords[1] - referencePoint.lat
            ];
        }
        return [0, 0];
    }

    /**
     * Update feature geometry for move operation
     * @param {Object} feature - Feature to update
     * @param {number} dx - Delta X in geographic coordinates
     * @param {number} dy - Delta Y in geographic coordinates
     * @param {Object} newCoords - New coordinates {lng, lat}
     * @returns {Object} Updated feature
     */
    updateFeatureForMove(feature, dx, dy, newCoords) {
        if (feature.geometry.type === 'Point') {
            return {
                ...feature,
                geometry: {
                    ...feature.geometry,
                    coordinates: [newCoords.lng, newCoords.lat]
                }
            };
        }
        return feature;
    }

    /**
     * Validate if move operation is allowed
     * @param {Object} feature - Feature being moved
     * @param {Object} newPosition - New position {lng, lat}
     * @returns {boolean}
     */
    validateMove(feature, newPosition) {
        return true;
    }

    // ===== SELECTION BOX INTERFACE =====

    /**
     * Create selection box for feature
     * @param {Object} feature - Feature to create selection box for
     * @returns {Object} GeoJSON Polygon feature or null
     */
    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding());
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating selection box:', error);
            return null;
        }
    }

    /**
     * Get selection box strategy for this feature type
     * @returns {string} Strategy name ('bbox', 'preCalculated', 'custom')
     */
    getSelectionBoxStrategy() {
        return 'bbox';
    }

    /**
     * Get padding for selection box in pixels
     * @returns {number} Padding in pixels
     */
    getSelectionBoxPadding() {
        return 5;
    }

    /**
     * Expand bbox with padding
     * @param {Array} bbox - Bounding box [minX, minY, maxX, maxY]
     * @param {number} paddingPixels - Padding in pixels
     * @param {Object} map - Map instance
     * @returns {Array} Expanded bbox
     */
    expandBboxWithPadding(bbox, paddingPixels, map) {
        const centerLat = (bbox[1] + bbox[3]) / 2;
        const zoom = map.getZoom();
        const paddingDegrees = this.pixelsToDegrees(paddingPixels, centerLat, zoom);

        return [
            bbox[0] - paddingDegrees,
            bbox[1] - paddingDegrees,
            bbox[2] + paddingDegrees,
            bbox[3] + paddingDegrees
        ];
    }

    // ===== CLIPBOARD INTERFACE =====

    /**
     * Check if feature can be copied
     * @param {Object} feature - Feature to check
     * @returns {boolean}
     */
    canCopy(feature) {
        return true;
    }

    /**
     * Check if feature can be pasted
     * @param {Object} feature - Feature to check
     * @returns {boolean}
     */
    canPaste(feature) {
        return true;
    }

    /**
     * Prepare feature for copying
     * @param {Object} feature - Feature to prepare
     * @returns {Object} Cleaned feature
     */
    prepareForCopy(feature) {
        const cleaned = JSON.parse(JSON.stringify(feature));

        delete cleaned.properties.isSelected;
        delete cleaned.properties.isPreview;
        delete cleaned.properties.user_isEditingHandle;

        return cleaned;
    }

    /**
     * Prepare feature for pasting
     * @param {Object} feature - Feature to paste
     * @param {Object} offset - Offset {dx, dy} in geographic coordinates
     * @returns {Object} Updated feature with offset applied
     */
    prepareForPaste(feature, offset) {
        if (feature.geometry.type === 'Point') {
            return {
                ...feature,
                geometry: {
                    ...feature.geometry,
                    coordinates: [
                        feature.geometry.coordinates[0] + offset.dx,
                        feature.geometry.coordinates[1] + offset.dy
                    ]
                }
            };
        }
        return feature;
    }

    // ===== ATTRIBUTE PANEL INTERFACE =====

    /**
     * Check if this tool has an attribute panel
     * @returns {boolean}
     */
    hasAttributePanel() {
        return false;
    }

    /**
     * Create attribute panel content for this tool
     * @param {HTMLElement} container - Container element to add content to
     * @param {Array} features - Selected features of this type
     * @param {Object} selectionManager - Selection manager instance
     * @param {Object} uiManager - UI manager instance
     */
    createAttributePanel(container, features, selectionManager, uiManager) {
    }

    // ===== DRAG AND HANDLE SOURCES INTERFACE =====

    /**
     * Get drag sources this tool handles
     * @returns {Array} Array of source names for drag operations
     */
    getDragSources() {
        return [];
    }

    /**
     * Get edit handle sources this tool uses
     * @returns {Array} Array of edit handle source names
     */
    getEditHandleSources() {
        return [];
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    /**
     * Update properties of multiple features
     * @param {Array} features - Features to update
     * @param {string} property - Property name
     * @param {*} value - Property value
     */
    updateFeaturesProperty(features, property, value) {
    }

    /**
     * Save multiple features
     * @param {Array} features - Features to save
     * @param {Map} initialPropertiesMap - Initial properties for comparison
     */
    async saveFeatures(features, initialPropertiesMap) {
    }

    /**
     * Update multiple features
     * @param {Array} features - Features to update
     * @param {boolean} save - Whether to save to storage
     * @param {boolean} onlyUpdateProperties - Only update properties, not geometry
     */
    async updateFeatures(features, save = false, onlyUpdateProperties = false) {
    }

    /**
     * Delete multiple features
     * @param {Array} features - Features to delete
     */
    async deleteFeatures(features) {
    }

    /**
     * Discard changes to features
     * @param {Array} features - Features to revert
     * @param {Map} initialPropertiesMap - Initial properties
     */
    async discardChangeFeatures(features, initialPropertiesMap) {
    }

    /**
     * Set default properties for this tool
     * @param {Object} properties - Default properties
     */
    setDefaultProperties(properties) {
    }

    /**
     * Check if feature has changed
     * @param {Object} feature - Current feature
     * @param {Object} initialProperties - Initial properties
     * @returns {boolean}
     */
    hasFeatureChanged(feature, initialProperties) {
        return true;
    }

    // ===== UTILITY METHODS =====

    /**
     * Convert pixels to degrees at given latitude and zoom
     * @param {number} pixels - Pixels
     * @param {number} latitude - Latitude
     * @param {number} zoom - Zoom level
     * @returns {number} Degrees
     */
    pixelsToDegrees(pixels, latitude, zoom) {
        const earthCircumference = 40075017;
        const metersPerPixel = earthCircumference * Math.cos(latitude * Math.PI / 180) / Math.pow(2, zoom + 8);
        const degreesPerMeter = 360 / earthCircumference;
        return pixels * metersPerPixel * degreesPerMeter;
    }

    /**
     * Get layer IDs this tool handles
     * @returns {Array} Array of layer IDs
     */
    getLayerIds() {
        return [];
    }

    /**
     * Get source names this tool handles
     * @returns {Array} Array of source names
     */
    getSourceNames() {
        return [];
    }

    /**
     * Get edit handle source name
     * @returns {string|null} Edit handle source name or null
     */
    getEditHandleSource() {
        return null;
    }

    /**
     * Normalize coordinates from various formats
     * @param {string|Array} coordinates - Coordinates to normalize
     * @returns {Array|null} Normalized coordinates or null if invalid
     */
    normalizeCoordinates(coordinates) {
        if (typeof coordinates === 'string') {
            try {
                coordinates = JSON.parse(coordinates);
            } catch (e) {
                console.warn('Error parsing coordinates:', coordinates);
                return null;
            }
        }
        return Array.isArray(coordinates) ? coordinates : null;
    }
}

export default BaseControl;

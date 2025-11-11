// Path: js\controls_sig\coordination_measure_tool\add_coordination_measure_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';

/**
 * Coordination Measure Geometry Operations
 * Handles geometric calculations for coordination measure features (Point-based with generated symbols)
 */
class AddCoordinationMeasureGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
    }

    /**
     * Generate point geometry for coordination measure placement
     * @param {Array} coordinates - Position coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    generate(coordinates) {
        return this.generatePointGeometry(coordinates);
    }

    /**
     * Generate Point geometry for coordination measure
     * @param {Array} coordinates - Position coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    generatePointGeometry(coordinates) {
        return {
            type: 'Point',
            coordinates: [coordinates[0], coordinates[1]]
        };
    }

    /**
     * Coordination measures don't have edit handles - they're edited through attribute panel
     * @param {Object} feature - Coordination measure feature
     * @returns {Array} Empty array (no handles)
     */
    createHandles(feature) {
        return []; // Coordination measures don't have edit handles
    }

    /**
     * Coordination measures don't support handle-based editing
     * @param {string} handleType - Type of handle
     * @param {Array} newPosition - New position
     * @param {Object} feature - Feature being edited
     * @returns {null} Always null (not supported)
     */
    updateFromHandle(handleType, newPosition, feature) {
        return null; // Coordination measures don't have edit handles
    }

    /**
     * Calculate selection box geometry for coordination measure with zoom-invariant sizing
     * @param {Array} coordinates - Symbol position [lng, lat]
     * @param {number} width - Symbol width in pixels
     * @param {number} height - Symbol height in pixels
     * @param {number} createdAtZoom - Zoom level when symbol was created
     * @param {Object} uiManager - UI manager for utility functions
     * @returns {Object} GeoJSON Polygon geometry for selection box
     */
    calculateSelectionBoxGeometry(coordinates, width, height, createdAtZoom, uiManager) {
        // Apply size scaling with 50% correction factor (consistent with military symbols)
        const scaledWidth = width * 0.5;
        const scaledHeight = height * 0.5;
        
        const padding = 5;
        const centerLat = coordinates[1];
        
        // Use creation zoom level for degree conversion (zoom-invariant)
        const widthDegrees = uiManager.pixelsToDegrees(
            scaledWidth + (padding * 2), 
            centerLat, 
            createdAtZoom
        );
        const heightDegrees = uiManager.pixelsToDegrees(
            scaledHeight + (padding * 2), 
            centerLat, 
            createdAtZoom
        );
        
        return this.createSelectionBoxFromDegrees(coordinates, widthDegrees, heightDegrees);
    }

    /**
     * Create selection box polygon from degree measurements
     * @param {Array} coordinates - Center coordinates [lng, lat]
     * @param {number} widthDegrees - Width in degrees
     * @param {number} heightDegrees - Height in degrees
     * @returns {Object} GeoJSON Polygon geometry
     */
    createSelectionBoxFromDegrees(coordinates, widthDegrees, heightDegrees) {
        const [lng, lat] = coordinates;
        const halfWidth = widthDegrees / 2;
        const halfHeight = heightDegrees / 2;
        
        return {
            type: 'Polygon',
            coordinates: [[
                [lng - halfWidth, lat - halfHeight], // bottom-left
                [lng + halfWidth, lat - halfHeight], // bottom-right
                [lng + halfWidth, lat + halfHeight], // top-right
                [lng - halfWidth, lat + halfHeight], // top-left
                [lng - halfWidth, lat - halfHeight]  // close polygon
            ]]
        };
    }

    /**
     * Update coordination measure position for move operation
     * @param {Array} currentCoordinates - Current position
     * @param {number} dx - Delta X in geographic coordinates
     * @param {number} dy - Delta Y in geographic coordinates
     * @returns {Array} New coordinates
     */
    moveSymbol(currentCoordinates, dx, dy) {
        return [
            currentCoordinates[0] + dx,
            currentCoordinates[1] + dy
        ];
    }

    /**
     * Recalculate selection box for feature
     * @param {Object} feature - Coordination measure feature
     * @param {Object} uiManager - UI manager instance
     * @returns {Object} Updated selection box geometry
     */
    recalculateSelectionBox(feature, uiManager) {
        return this.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.width,
            feature.properties.height,
            feature.properties.createdAtZoom,
            uiManager
        );
    }

    /**
     * Get bounding box for coordination measure (for spatial queries)
     * @param {Array} coordinates - Symbol position
     * @param {number} width - Symbol width in pixels
     * @param {number} height - Symbol height in pixels
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates, width, height) {
        // Approximate bounding box using scaled dimensions
        // Using 0.5 scale factor for consistency with selection box
        const scaledWidth = width * 0.5;
        const scaledHeight = height * 0.5;
        
        // Convert pixels to rough degree approximation
        const widthDegrees = scaledWidth / 111320; // Rough conversion at equator
        const heightDegrees = scaledHeight / 111320;
        
        const halfWidth = widthDegrees / 2;
        const halfHeight = heightDegrees / 2;

        return [
            coordinates[0] - halfWidth, // minLng
            coordinates[1] - halfHeight, // minLat
            coordinates[0] + halfWidth,  // maxLng
            coordinates[1] + halfHeight  // maxLat
        ];
    }

    /**
     * Validate coordination measure coordinates
     * @param {Array} coordinates - Position coordinates
     * @returns {boolean} True if valid
     */
    validate(coordinates) {
        return coordinates && 
               Array.isArray(coordinates) && 
               coordinates.length >= 2 &&
               typeof coordinates[0] === 'number' && 
               typeof coordinates[1] === 'number' &&
               !isNaN(coordinates[0]) && 
               !isNaN(coordinates[1]);
    }

    /**
     * Check if coordinates represent a valid position
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid position
     */
    isValidPosition(coordinates) {
        return this.validate(coordinates);
    }
}

export default AddCoordinationMeasureGeometry;
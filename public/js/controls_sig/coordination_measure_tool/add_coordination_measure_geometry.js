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

    // ===== CORE INTERFACE (Required) =====

    /**
     * Generate point geometry for coordination measure placement
     * @param {Array} coordinates - Position coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    generate(coordinates) {
        return this.generatePointGeometry(coordinates);
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

    // ===== GEOMETRY GENERATION =====

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

    // ===== SELECTION BOX OPERATIONS =====

    /**
     * Calculate selection box geometry for coordination measure with zoom-invariant sizing
     * @param {Array} coordinates - Symbol position [lng, lat]
     * @param {number} width - Symbol width in pixels
     * @param {number} height - Symbol height in pixels
     * @param {number} size - Size multiplier
     * @param {number} rotation - Rotation in degrees
     * @param {number} createdAtZoom - Zoom level when symbol was created
     * @param {Object} uiManager - UI manager for utility functions
     * @returns {Object} GeoJSON Polygon geometry for selection box
     */
    calculateSelectionBoxGeometry(coordinates, width, height, size, rotation, createdAtZoom, uiManager) {
        // Apply size scaling with 50% correction factor (consistent with image tool)
        const scaledWidth = width * size * 0.5;
        const scaledHeight = height * size * 0.5;
        
        // Calculate expanded dimensions accounting for rotation
        const expandedDimensions = uiManager.calculateExpandedDimensions(scaledWidth, scaledHeight, rotation);
        const padding = 5;
        
        // Use creation zoom level for degree conversion (zoom-invariant)
        const centerLat = coordinates[1];
        const widthDegrees = uiManager.pixelsToDegrees(
            expandedDimensions.width + (padding * 2), 
            centerLat, 
            createdAtZoom
        );
        const heightDegrees = uiManager.pixelsToDegrees(
            expandedDimensions.height + (padding * 2), 
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
            feature.properties.size || 1,
            feature.properties.rotation || 0,
            feature.properties.createdAtZoom,
            uiManager
        );
    }

    // ===== MOVEMENT OPERATIONS =====

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

    // ===== ZOOM OPERATIONS =====

    /**
     * Calculate zoom-adjusted size
     * @param {number} baseSize - Base size multiplier
     * @param {number} createdAtZoom - Zoom when symbol was created
     * @param {number} currentZoom - Current zoom level
     * @returns {number} Calculated size with zoom adjustment (max 10x)
     */
    calculateZoomAdjustedSize(baseSize, createdAtZoom, currentZoom) {
        const zoomDifference = currentZoom - createdAtZoom;
        const scaleFactor = Math.pow(2, zoomDifference);
        return Math.min(baseSize * scaleFactor, 10); // Maximum 10x scaling
    }

    // ===== SPATIAL QUERIES =====

    /**
     * Get bounding box for coordination measure (for spatial queries)
     * @param {Array} coordinates - Symbol position
     * @param {number} width - Symbol width in pixels
     * @param {number} height - Symbol height in pixels
     * @param {number} size - Size multiplier
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates, width, height, size) {
        // Approximate bounding box using scaled dimensions
        const scaledWidth = width * size * 0.5;
        const scaledHeight = height * size * 0.5;
        
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

    // ===== VALIDATION HELPERS =====

    /**
     * Check if coordinates represent a valid position
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid position
     */
    isValidPosition(coordinates) {
        return this.validate(coordinates);
    }

    // ===== PROPERTY CHANGE DETECTION =====

    /**
     * Check if property affects visual rendering (selection box recalculation needed)
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property affects visual rendering
     */
    affectsVisuals(property) {
        const visualProperties = ['size', 'rotation', 'width', 'height'];
        return visualProperties.includes(property);
    }

    /**
     * Check if property requires symbol regeneration
     * Text modifiers and point code changes require regeneration
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property requires regeneration
     */
    requiresRegeneration(property) {
        const regenerationProperties = [
            'pointCode', 'echelonCode',
            'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
            'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
        ];
        
        return regenerationProperties.includes(property);
    }
}

export default AddCoordinationMeasureGeometry;
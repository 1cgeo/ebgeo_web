// Path: js\controls_sig\text_tool\add_text_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';

/**
 * Text Geometry Operations
 * Handles geometric calculations for text features (Point-based with measured selection boxes)
 */
class AddTextGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
        
        // Canvas for text measurement
        this.measurementCanvas = null;
        this.measurementContext = null;
    }

    /**
     * Generate point geometry for text placement
     * @param {Array} coordinates - Position coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    generate(coordinates) {
        return this.generatePointGeometry(coordinates);
    }

    /**
     * Validate text coordinates
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
     * Normalize coordinates from various formats
     * @param {string|Array} coordinates - Coordinates to normalize
     * @returns {Array|null} Normalized coordinates or null if invalid
     */
    normalizeCoordinates(coordinates) {
        if (typeof coordinates === 'string') {
            try {
                coordinates = JSON.parse(coordinates);
            } catch (e) {
                console.error('Error parsing coordinates:', coordinates, e);
                return null;
            }
        }

        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            console.error('Invalid coordinates:', coordinates);
            return null;
        }

        return coordinates;
    }

    /**
     * Generate Point geometry for text
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
     * Text features don't have edit handles - they're edited through attribute panel
     * @param {Object} feature - Text feature
     * @returns {Array} Empty array (no handles)
     */
    createHandles(feature) {
        return []; // Text features don't have edit handles
    }

    /**
     * Text features don't support handle-based editing
     * @param {string} handleType - Type of handle
     * @param {Array} newPosition - New position
     * @param {Object} feature - Feature being edited
     * @returns {null} Always null (not supported)
     */
    updateFromHandle(handleType, newPosition, feature) {
        return null; // Text features don't have edit handles
    }

    /**
     * Measure text dimensions using canvas context
     * @param {string} text - Text content
     * @param {number} fontSize - Font size in pixels
     * @param {string} fontFamily - Font family name
     * @returns {Object} {width, height} dimensions in pixels
     */
    measureTextSize(text, fontSize, fontFamily = 'Arial') {
        // Lazy initialization of canvas
        if (!this.measurementCanvas) {
            this.measurementCanvas = document.createElement('canvas');
            this.measurementContext = this.measurementCanvas.getContext('2d');
        }

        this.measurementContext.font = `${fontSize}px ${fontFamily}`;
        const lines = text.split('\n');
        const width = Math.max(...lines.map(line => this.measurementContext.measureText(line).width));
        const height = (fontSize - 8) * lines.length; // Line height calculation
        
        return { width, height };
    }

    /**
     * Calculate selection box geometry for text with zoom-invariant sizing and background consideration
     * @param {Array} coordinates - Text position [lng, lat]
     * @param {string} text - Text content
     * @param {number} size - Font size
     * @param {number} rotation - Rotation in degrees
     * @param {number} createdAtZoom - Zoom level when text was created
     * @param {Object} uiManager - UI manager for utility functions
     * @param {boolean} showBackground - Whether background box is shown
     * @param {number} backgroundBorderWidth - Border width in pixels (if background is shown)
     * @returns {Object} GeoJSON Polygon geometry for selection box
     */
    calculateSelectionBoxGeometry(coordinates, text, size, rotation, createdAtZoom, uiManager, showBackground = false, backgroundBorderWidth = 1) {
        const { width, height } = this.measureTextSize(text, size, 'Arial');
        
        // Base padding
        let padding = 5;
        
        // Add border width to padding if background is shown
        if (showBackground && backgroundBorderWidth > 0) {
            padding += backgroundBorderWidth;
        }
        
        const expandedDimensions = uiManager.calculateExpandedDimensions(width, height, rotation);
        
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
     * Update text position for move operation
     * @param {Array} currentCoordinates - Current position
     * @param {number} dx - Delta X in geographic coordinates
     * @param {number} dy - Delta Y in geographic coordinates
     * @returns {Array} New coordinates
     */
    moveText(currentCoordinates, dx, dy) {
        return [
            currentCoordinates[0] + dx,
            currentCoordinates[1] + dy
        ];
    }

    /**
     * Recalculate selection box for feature
     * @param {Object} feature - Text feature
     * @param {Object} uiManager - UI manager instance
     * @returns {Object} Updated selection box geometry
     */
    recalculateSelectionBox(feature, uiManager) {
        return this.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.text,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            uiManager,
            feature.properties.showBackground,
            feature.properties.backgroundBorderWidth
        );
    }

    /**
     * Calculate zoom-adjusted size
     * @param {number} baseSize - Base font size
     * @param {number} createdAtZoom - Zoom when text was created
     * @param {number} currentZoom - Current zoom level
     * @returns {number} Calculated size with zoom adjustment (max 255px)
     */
    calculateZoomAdjustedSize(baseSize, createdAtZoom, currentZoom) {
        const zoomDifference = currentZoom - createdAtZoom;
        const scaleFactor = Math.pow(2, zoomDifference);
        return Math.min(baseSize * scaleFactor, 255); // Maximum 255px font size
    }

    /**
     * Check if coordinates represent a valid text position
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid position
     */
    isValidPosition(coordinates) {
        return coordinates && 
               Array.isArray(coordinates) && 
               coordinates.length >= 2 && 
               typeof coordinates[0] === 'number' && 
               typeof coordinates[1] === 'number' &&
               !isNaN(coordinates[0]) && 
               !isNaN(coordinates[1]);
    }

    /**
     * Validate text content
     * @param {string} text - Text content to validate
     * @returns {boolean} True if valid text
     */
    validateText(text) {
        return typeof text === 'string' && text.trim().length > 0;
    }

    /**
     * Get bounding box for text (for spatial queries)
     * @param {Array} coordinates - Text position
     * @param {string} text - Text content
     * @param {number} size - Font size
     * @param {number} rotation - Rotation in degrees
     * @param {boolean} showBackground - Whether background is shown
     * @param {number} backgroundBorderWidth - Border width
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates, text, size, rotation = 0, showBackground = false, backgroundBorderWidth = 1) {
        const { width, height } = this.measureTextSize(text, size, 'Arial');
        
        // Account for rotation by using the larger dimension
        let maxDimension = rotation === 0 ? 
            Math.max(width, height) : 
            Math.sqrt(width * width + height * height);
        
        // Add border consideration if background is shown
        if (showBackground && backgroundBorderWidth > 0) {
            maxDimension += (backgroundBorderWidth * 2);
        }
        
        // Convert pixels to rough degree approximation
        const dimensionDegrees = maxDimension / 111320; // Rough conversion
        const halfDimension = dimensionDegrees / 2;

        return [
            coordinates[0] - halfDimension, // minLng
            coordinates[1] - halfDimension, // minLat
            coordinates[0] + halfDimension, // maxLng
            coordinates[1] + halfDimension  // maxLat
        ];
    }

    /**
     * Check if property affects visual rendering (selection box recalculation needed)
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property affects visual rendering
     */
    affectsVisuals(property) {
        const visualProperties = ['text', 'size', 'rotation', 'showBackground', 'backgroundBorderWidth'];
        return visualProperties.includes(property);
    }

    /**
     * Clean up resources when geometry handler is destroyed
     */
    destroy() {
        this.measurementCanvas = null;
        this.measurementContext = null;
    }
}

export default AddTextGeometry;
// Path: js/draw_tools/text_tool/add_text_geometry.js

import { BaseGeometry } from '../../tool_manager';

/**
 * Text Geometry Operations
 * Handles geometric calculations for text features including point-based positioning and measured selection boxes
 */
class AddTextGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);

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
    createHandles(_feature) {
        return [];
    }

    /**
     * Text features don't support handle-based editing
     * @param {string} handleType - Type of handle
     * @param {Array} newPosition - New position
     * @param {Object} feature - Feature being edited
     * @returns {null} Always null (not supported)
     */
    updateFromHandle(_handleType, _newPosition, _feature) {
        return null;
    }

    /**
     * Measure text dimensions using canvas context
     * @param {string} text - Text content
     * @param {number} fontSize - Font size in pixels
     * @param {string} fontFamily - Font family name
     * @returns {Object} {width, height} dimensions in pixels
     */
    measureTextSize(text, fontSize, fontFamily = 'Arial') {
        if (!this.measurementCanvas) {
            this.measurementCanvas = document.createElement('canvas');
            this.measurementContext = this.measurementCanvas.getContext('2d');
        }

        this.measurementContext.font = `${fontSize}px ${fontFamily}`;
        const lines = text.split('\n');
        const width = Math.max(...lines.map(line => this.measurementContext.measureText(line).width));
        const height = (fontSize - 8) * lines.length;

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
     * @param {number} [effectiveZoom] - Optional zoom to use for calculations (overrides createdAtZoom when zoom correction is disabled)
     * @returns {Object} GeoJSON Polygon geometry for selection box
     */
    calculateSelectionBoxGeometry(coordinates, text, size, rotation, createdAtZoom, uiManager, showBackground = false, backgroundBorderWidth = 1, effectiveZoom = null) {
        const { width, height } = this.measureTextSize(text, size, 'Arial');

        let padding = 5;

        if (showBackground && backgroundBorderWidth > 0) {
            padding += backgroundBorderWidth;
        }

        const expandedDimensions = uiManager.calculateExpandedDimensions(width, height, rotation);

        const centerLat = coordinates[1];
        const zoomForCalculation = effectiveZoom !== null ? effectiveZoom : createdAtZoom;
        const widthDegrees = uiManager.pixelsToDegrees(
            expandedDimensions.width + (padding * 2),
            centerLat,
            zoomForCalculation
        );
        const heightDegrees = uiManager.pixelsToDegrees(
            expandedDimensions.height + (padding * 2),
            centerLat,
            zoomForCalculation
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
                [lng - halfWidth, lat - halfHeight],
                [lng + halfWidth, lat - halfHeight],
                [lng + halfWidth, lat + halfHeight],
                [lng - halfWidth, lat + halfHeight],
                [lng - halfWidth, lat - halfHeight]
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
     * @param {number} [currentZoom] - Current map zoom (used when zoom correction is disabled)
     * @returns {Object} Updated selection box geometry
     */
    recalculateSelectionBox(feature, uiManager, currentZoom = null) {
        const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? currentZoom : null;
        return this.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.text,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            uiManager,
            feature.properties.showBackground,
            feature.properties.backgroundBorderWidth,
            effectiveZoom
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
        return Math.min(baseSize * scaleFactor, 255);
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

        let maxDimension = rotation === 0 ?
            Math.max(width, height) :
            Math.sqrt(width * width + height * height);

        if (showBackground && backgroundBorderWidth > 0) {
            maxDimension += (backgroundBorderWidth * 2);
        }

        const dimensionDegrees = maxDimension / 111320;
        const halfDimension = dimensionDegrees / 2;

        return [
            coordinates[0] - halfDimension,
            coordinates[1] - halfDimension,
            coordinates[0] + halfDimension,
            coordinates[1] + halfDimension
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

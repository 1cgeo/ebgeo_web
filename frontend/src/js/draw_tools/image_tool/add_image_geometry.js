// Path: js/draw_tools/image_tool/add_image_geometry.js

import { BaseGeometry } from '../../tool_manager';

/**
 * Image Geometry Operations
 * Handles geometric calculations for image features (Point-based with selection boxes)
 */
class AddImageGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
    }

    /**
     * Generate point geometry for image placement
     * @param {Array} coordinates - Position coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    generate(coordinates) {
        return this.generatePointGeometry(coordinates);
    }

    /**
     * Validate image coordinates
     * @param {Array} coordinates - Position coordinates
     * @returns {boolean} True if valid
     */
    validate(coordinates) {
        // Number.isFinite rejects NaN AND +/-Infinity, and it already implies the
        // number type, so a string coordinate is refused too. Matches the guard the
        // circle/line/polygon/ellipse tools use.
        return coordinates &&
               Array.isArray(coordinates) &&
               coordinates.length >= 2 &&
               Number.isFinite(coordinates[0]) &&
               Number.isFinite(coordinates[1]);
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
     * Generate Point geometry for image
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
     * Images don't have edit handles - they're moved as whole units
     * @param {Object} feature - Image feature
     * @returns {Array} Empty array (no handles)
     */
    createHandles(_feature) {
        return [];
    }

    /**
     * Images don't support handle-based editing
     * @param {string} handleType - Type of handle
     * @param {Array} newPosition - New position
     * @param {Object} feature - Feature being edited
     * @returns {null} Always null (not supported)
     */
    updateFromHandle(_handleType, _newPosition, _feature) {
        return null;
    }

    /**
     * Calculate selection box geometry for image with zoom-invariant sizing
     * @param {Array} coordinates - Image position [lng, lat]
     * @param {number} width - Image width in pixels
     * @param {number} height - Image height in pixels
     * @param {number} size - Size multiplier
     * @param {number} rotation - Rotation in degrees
     * @param {number} createdAtZoom - Zoom level when image was created
     * @param {Object} uiManager - UI manager for utility functions
     * @param {number} [effectiveZoom] - Optional zoom to use for calculations (overrides createdAtZoom when zoom correction is disabled)
     * @returns {Object} GeoJSON Polygon geometry for selection box
     */
    calculateSelectionBoxGeometry(coordinates, width, height, size, rotation, createdAtZoom, uiManager, effectiveZoom = null) {
        const scaledWidth = width * size * 0.625;
        const scaledHeight = height * size * 0.625;

        const expandedDimensions = uiManager.calculateExpandedDimensions(scaledWidth, scaledHeight, rotation);
        const padding = 5;

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
                [lng - halfWidth, lat + halfHeight], // top-left
                [lng + halfWidth, lat + halfHeight], // top-right
                [lng + halfWidth, lat - halfHeight], // bottom-right
                [lng - halfWidth, lat - halfHeight], // bottom-left
                [lng - halfWidth, lat + halfHeight]  // close polygon
            ]]
        };
    }

    /**
     * Update image position for move operation
     * @param {Array} currentCoordinates - Current position
     * @param {number} dx - Delta X in geographic coordinates
     * @param {number} dy - Delta Y in geographic coordinates
     * @returns {Array} New coordinates
     */
    moveImage(currentCoordinates, dx, dy) {
        return [
            currentCoordinates[0] + dx,
            currentCoordinates[1] + dy
        ];
    }

    /**
     * Recalculate selection box for feature
     * @param {Object} feature - Image feature
     * @param {Object} uiManager - UI manager instance
     * @param {number} [currentZoom] - Current map zoom (used when zoom correction is disabled)
     * @returns {Object} Updated selection box geometry
     */
    recalculateSelectionBox(feature, uiManager, currentZoom = null) {
        const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? currentZoom : null;
        return this.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.width,
            feature.properties.height,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            uiManager,
            effectiveZoom
        );
    }

    /**
     * Calculate zoom-adjusted size
     * @param {number} baseSize - Base size multiplier
     * @param {number} createdAtZoom - Zoom when image was created
     * @param {number} currentZoom - Current zoom level
     * @returns {number} Calculated size with zoom adjustment
     */
    calculateZoomAdjustedSize(baseSize, createdAtZoom, currentZoom) {
        const zoomDifference = currentZoom - createdAtZoom;
        const scaleFactor = Math.pow(2, zoomDifference);
        return Math.min(baseSize * scaleFactor, 10); // Maximum 10x scaling
    }

    /**
     * Check if coordinates represent a valid image position
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid position
     */
    isValidPosition(coordinates) {
        return this.validate(coordinates);
    }

    /**
     * Get bounding box for image (for spatial queries)
     * @param {Array} coordinates - Image position
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @param {number} size - Size multiplier
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates, width, height, size) {
        const scaledWidth = width * size * 0.625;
        const scaledHeight = height * size * 0.625;

        const widthDegrees = scaledWidth / 111320;
        const heightDegrees = scaledHeight / 111320;

        const halfWidth = widthDegrees / 2;
        const halfHeight = heightDegrees / 2;

        return [
            coordinates[0] - halfWidth,
            coordinates[1] - halfHeight,
            coordinates[0] + halfWidth,
            coordinates[1] + halfHeight
        ];
    }
}

export default AddImageGeometry;

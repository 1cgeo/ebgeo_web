// Path: js/draw_tools/point_tool/add_point_geometry.js

import { BaseGeometry } from '../../tool_manager';
import { pixelsToDegrees } from '../../utilities/geometry-utils.js';

/** Scale factor for point visual diameter in pixels (circle-radius → diameter). */
const POINT_DIAMETER_SCALE = 2;

/** Default padding around selection box in pixels. */
const SELECTION_BOX_PADDING = 2;

/**
 * Point Geometry Operations
 * Handles all geometric calculations for point features
 */
class AddPointGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
    }

    /**
     * Generate point geometry from coordinates
     * @param {Array} coordinates - Point coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    generate(coordinates) {
        return this.createPointGeometry(coordinates);
    }

    /**
     * Validate point parameters
     * @param {Array} coordinates - Point coordinates [lng, lat]
     * @returns {boolean} True if valid
     */
    validate(coordinates) {
        if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
            return false;
        }

        if (typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') {
            return false;
        }

        if (isNaN(coordinates[0]) || isNaN(coordinates[1])) {
            return false;
        }

        return true;
    }

    /**
     * Create Point geometry from coordinates
     * @param {Array} coordinates - Point coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    createPointGeometry(coordinates) {
        if (!this.validate(coordinates)) {
            throw new Error('Invalid coordinates for point geometry');
        }

        return {
            type: 'Point',
            coordinates: [...coordinates]
        };
    }

    /**
     * Create edit handles for point (none - point features don't have handles)
     * @param {Object} feature - Point feature
     * @returns {Array} Empty array (point features don't have edit handles)
     */
    createHandles(_feature) {
        return [];
    }

    /**
     * Update geometry based on handle movement (not applicable for point)
     * @param {string} handleType - Type of handle
     * @param {Array} newPosition - New handle position
     * @param {Object} feature - Feature being edited
     * @returns {null} Always null (point doesn't support handle editing)
     */
    updateFromHandle(_handleType, _newPosition, _feature) {
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
                console.error('Error parsing point coordinates:', coordinates, e);
                return null;
            }
        }

        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            console.error('Invalid point coordinates:', coordinates);
            return null;
        }

        return coordinates;
    }

    /**
     * Check if coordinates represent a valid point
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid point
     */
    isValidPoint(coordinates) {
        return this.validate(coordinates);
    }

    /**
     * Get center point (same as coordinates for point features)
     * @param {Array} coordinates - Point coordinates
     * @returns {Array|null} Center point [lng, lat] or null if invalid
     */
    getCenter(coordinates) {
        if (!this.validate(coordinates)) {
            return null;
        }
        return coordinates;
    }

    /**
     * Apply offset to point coordinates
     * @param {Array} coordinates - Original coordinates
     * @param {number} dx - Delta longitude
     * @param {number} dy - Delta latitude
     * @returns {Array} Offset coordinates
     */
    applyOffset(coordinates, dx, dy) {
        if (!this.validate(coordinates)) {
            return coordinates;
        }

        return [
            coordinates[0] + dx,
            coordinates[1] + dy
        ];
    }

    /**
     * Get bounding box for point (single point, so min=max)
     * @param {Array} coordinates - Point coordinates
     * @returns {Array|null} Bounding box [lng, lat, lng, lat] or null if invalid
     */
    getBoundingBox(coordinates) {
        if (!this.validate(coordinates)) {
            return null;
        }

        return [
            coordinates[0],
            coordinates[1],
            coordinates[0],
            coordinates[1]
        ];
    }

    /**
     * Calculate selection box geometry for a point using the same approach as
     * image/military symbol: convert base pixel dimensions at createdAtZoom
     * so the geographic box scales in sync with zoom-corrected rendering.
     * @param {Array} coordinates - Point coordinates [lng, lat]
     * @param {number} size - Base point size (circle-radius in pixels)
     * @param {number} lineWidth - Border width in pixels
     * @param {number} createdAtZoom - Zoom level when point was created
     * @param {number} [effectiveZoom] - Optional zoom override (used when zoom correction is disabled)
     * @returns {Object|null} GeoJSON Polygon geometry for selection box or null if invalid
     */
    calculateSelectionBoxGeometry(coordinates, size, lineWidth, createdAtZoom, effectiveZoom = null) {
        if (!this.validate(coordinates)) {
            return null;
        }

        const diameter = size * POINT_DIAMETER_SCALE + (lineWidth || 0);
        const totalSize = diameter + SELECTION_BOX_PADDING * 2;

        const centerLat = coordinates[1];
        const zoomForCalculation = effectiveZoom !== null ? effectiveZoom : createdAtZoom;
        const halfExtent = pixelsToDegrees(totalSize, centerLat, zoomForCalculation) / 2;

        return {
            type: 'Polygon',
            coordinates: [[
                [coordinates[0] - halfExtent, coordinates[1] + halfExtent],
                [coordinates[0] + halfExtent, coordinates[1] + halfExtent],
                [coordinates[0] + halfExtent, coordinates[1] - halfExtent],
                [coordinates[0] - halfExtent, coordinates[1] - halfExtent],
                [coordinates[0] - halfExtent, coordinates[1] + halfExtent]
            ]]
        };
    }

    /**
     * Recalculate selection box for a point feature.
     * @param {Object} feature - Point feature
     * @param {number} [currentZoom] - Current map zoom (used when zoom correction is disabled)
     * @returns {Object|null} Updated selection box geometry
     */
    recalculateSelectionBox(feature, currentZoom = null) {
        const effectiveZoom = feature.properties.sizeZoomCorrectionEnabled === false ? currentZoom : null;
        return this.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.size || 10,
            feature.properties.lineWidth || 0,
            feature.properties.sizeCreatedAtZoom || 0,
            effectiveZoom
        );
    }

}

export default AddPointGeometry;

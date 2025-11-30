// Path: js/controls_sig/circle_tool/add_circle_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';

/**
 * Circle Geometry Operations
 * Handles all geometric calculations and handle management for circle features
 */
class AddCircleGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
    }

    /**
     * Generate circle geometry from center and radius
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} radius - Radius in meters
     * @returns {Object} GeoJSON Polygon geometry
     */
    generate(center, radius) {
        return this.generateCircleGeometry(center, radius);
    }

    /**
     * Validate circle parameters
     * @param {Array} center - Center coordinates
     * @param {number} radius - Radius in meters
     * @returns {boolean} True if valid
     */
    validate(center, radius) {
        if (!center || !Array.isArray(center) || center.length < 2) {
            return false;
        }

        if (typeof radius !== 'number' || radius < 10) {
            return false;
        }

        return true;
    }

    /**
     * Normalize center coordinates from various formats
     * @param {string|Array} center - Center coordinates
     * @returns {Array|null} Normalized center or null if invalid
     */
    normalizeCenter(center) {
        if (typeof center === 'string') {
            try {
                center = JSON.parse(center);
            } catch (e) {
                console.error('Error parsing center:', center, e);
                return null;
            }
        }

        if (!Array.isArray(center) || center.length < 2) {
            console.error('Invalid center:', center);
            return null;
        }

        return center;
    }

    /**
     * Generate circle polygon geometry
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} radius - Radius in meters
     * @returns {Object} GeoJSON Polygon geometry
     */
    generateCircleGeometry(center, radius) {
        const points = 64;
        const coords = [];

        for (let i = 0; i <= points; i++) {
            const angle = (i * 360 / points) * Math.PI / 180;
            const dx = radius * Math.cos(angle);
            const dy = radius * Math.sin(angle);

            const lng = center[0] + (dx / 111320) / Math.cos(center[1] * Math.PI / 180);
            const lat = center[1] + (dy / 111320);

            coords.push([lng, lat]);
        }

        return {
            type: 'Polygon',
            coordinates: [coords]
        };
    }

    /**
     * Create edit handles for circle
     * @param {Object} feature - Circle feature
     * @returns {Object} Handle feature for radius editing
     */
    createHandles(feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            console.error('Cannot create handles - invalid center');
            return null;
        }

        const radius = feature.properties.radius;
        const radiusInDegrees = radius / 111320;

        const handlePoint = [
            center[0] + (radiusInDegrees / Math.cos(center[1] * Math.PI / 180)),
            center[1]
        ];

        const handleFeature = {
            type: 'Feature',
            id: `circle-handle-${feature.properties.id}-radius`,
            geometry: {
                type: 'Point',
                coordinates: handlePoint
            },
            properties: {
                role: 'handle',
                handleType: 'radius',
                handleId: 'radius-main',
                featureId: feature.properties.id,
                mode: 'circle_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        };

        return handleFeature;
    }

    /**
     * Update circle geometry based on handle movement
     * @param {string} handleType - Type of handle ('radius')
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Circle feature being edited
     * @returns {Object} Updated geometry and radius
     */
    updateFromHandle(handleType, newPosition, feature) {
        if (handleType !== 'radius') {
            console.warn('Unknown handle type for circle:', handleType);
            return null;
        }

        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            console.error('Cannot update - invalid center');
            return null;
        }

        const newRadius = this.calculateDistance(center, newPosition);

        if (newRadius < 10) {
            console.warn('Radius too small:', newRadius);
            return null;
        }

        const updatedGeometry = this.generateCircleGeometry(center, newRadius);

        return {
            geometry: updatedGeometry,
            radius: newRadius
        };
    }

    /**
     * Calculate preview geometry during radius dragging
     * @param {Array} center - Circle center
     * @param {Array} newPosition - New handle position
     * @returns {Object} Preview geometry and handle position
     */
    calculatePreview(center, newPosition) {
        const newRadius = this.calculateDistance(center, newPosition);

        if (newRadius < 10) {
            return null;
        }

        const previewGeometry = this.generateCircleGeometry(center, newRadius);

        const radiusInDegrees = newRadius / 111320;
        const handlePoint = [
            center[0] + (radiusInDegrees / Math.cos(center[1] * Math.PI / 180)),
            center[1]
        ];

        return {
            geometry: previewGeometry,
            handlePosition: handlePoint,
            radius: newRadius
        };
    }

    /**
     * Check if coordinates represent a valid circle center
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid center
     */
    isValidCenter(coordinates) {
        return coordinates &&
               Array.isArray(coordinates) &&
               coordinates.length >= 2 &&
               typeof coordinates[0] === 'number' &&
               typeof coordinates[1] === 'number' &&
               !isNaN(coordinates[0]) &&
               !isNaN(coordinates[1]);
    }

    /**
     * Get bounding box for circle
     * @param {Array} center - Circle center
     * @param {number} radius - Circle radius in meters
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(center, radius) {
        const radiusInDegrees = radius / 111320;
        const cosLat = Math.cos(center[1] * Math.PI / 180);

        return [
            center[0] - (radiusInDegrees / cosLat),
            center[1] - radiusInDegrees,
            center[0] + (radiusInDegrees / cosLat),
            center[1] + radiusInDegrees
        ];
    }
}

export default AddCircleGeometry;

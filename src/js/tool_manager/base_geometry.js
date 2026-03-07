// Path: js/tool_manager/base_geometry.js
import { calculateDistance as haversineDistance } from '../utilities/geometry-utils.js';

/**
 * Base class for all geometry operations
 * Provides common interface and utilities for geometric calculations
 */
class BaseGeometry {
    constructor(properties = {}) {
        this.properties = { ...properties };
    }

    /**
     * Generate the main geometry for the feature
     * @param {*} coordinates - Input coordinates
     * @returns {Object} GeoJSON geometry
     */
    generate(_coordinates) {
        throw new Error('Must implement generate() method');
    }

    /**
     * Create edit handles for the feature
     * @param {Object} feature - The feature to create handles for
     * @returns {Array} Array of handle features
     */
    createHandles(_feature) {
        throw new Error('Must implement createHandles() method');
    }

    /**
     * Update geometry based on handle interaction
     * @param {string} handleType - Type of handle being moved
     * @param {Array} newPosition - New position [lng, lat]
     * @param {Object} feature - Feature being edited
     * @returns {Object} Updated geometry
     */
    updateFromHandle(_handleType, _newPosition, _feature) {
        throw new Error('Must implement updateFromHandle() method');
    }

    /**
     * Validate input data
     * @param {*} data - Data to validate
     * @returns {boolean} True if valid
     */
    validate(_data) {
        return true;
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
     * Calculate distance between two points using Haversine formula
     * @param {Array} point1 - First point [lng, lat]
     * @param {Array} point2 - Second point [lng, lat]
     * @returns {number} Distance in meters
     */
    calculateDistance(point1, point2) {
        return haversineDistance(point1, point2);
    }

    /**
     * Update properties
     * @param {Object} newProperties - Properties to update
     */
    updateProperties(newProperties) {
        this.properties = { ...this.properties, ...newProperties };
    }

    /**
     * Get current properties
     * @returns {Object} Current properties
     */
    getProperties() {
        return { ...this.properties };
    }
}

export default BaseGeometry;

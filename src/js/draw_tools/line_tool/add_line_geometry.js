// Path: js/draw_tools/line_tool/add_line_geometry.js

import { BaseGeometry } from '../../tool_manager';

/**
 * Line Geometry Operations
 * Handles all geometric calculations and handle management for line features
 */
class AddLineGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
        this.MIN_DISTANCE_METERS = 5;
    }

    /**
     * Generate line geometry from coordinates array
     * @param {Array} coordinates - Array of coordinate points [[lng, lat], ...]
     * @returns {Object} GeoJSON LineString geometry
     */
    generate(coordinates) {
        return this.createLineStringGeometry(coordinates);
    }

    /**
     * Validate line parameters
     * @param {Array} coordinates - Array of coordinate points
     * @returns {boolean} True if valid
     */
    validate(coordinates) {
        if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
            return false;
        }

        return coordinates.every(point =>
            Array.isArray(point) &&
            point.length >= 2 &&
            typeof point[0] === 'number' &&
            typeof point[1] === 'number' &&
            !isNaN(point[0]) &&
            !isNaN(point[1])
        );
    }

    /**
     * Create LineString geometry from coordinates
     * @param {Array} coordinates - Array of coordinate points
     * @returns {Object} GeoJSON LineString geometry
     */
    createLineStringGeometry(coordinates) {
        if (!this.validate(coordinates)) {
            throw new Error('Invalid coordinates for line geometry');
        }

        return {
            type: 'LineString',
            coordinates: [...coordinates]
        };
    }

    /**
     * Create edit handles for line (vertices + midpoints)
     * @param {Object} feature - Line feature
     * @returns {Array} Array of handle features
     */
    createHandles(feature) {
        const coordinates = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coordinates || coordinates.length < 2) {
            console.warn('Invalid coordinates for creating line handles');
            return [];
        }

        const handles = [];

        coordinates.forEach((coord, index) => {
            handles.push({
                type: 'Feature',
                id: `line-handle-${feature.properties.id}-vertex-${index}`,
                geometry: {
                    type: 'Point',
                    coordinates: coord
                },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: `vertex-${index}`,
                    index: index,
                    featureId: feature.properties.id,
                    mode: 'line_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        for (let i = 0; i < coordinates.length - 1; i++) {
            const midpoint = this.calculateMidpoint(coordinates[i], coordinates[i + 1]);
            handles.push({
                type: 'Feature',
                id: `line-handle-${feature.properties.id}-midpoint-${i}`,
                geometry: {
                    type: 'Point',
                    coordinates: midpoint
                },
                properties: {
                    role: 'handle',
                    handleType: 'midpoint',
                    handleId: `midpoint-${i}`,
                    index: i,
                    featureId: feature.properties.id,
                    mode: 'line_editing',
                    meta: 'midpoint',
                    user_isEditingHandle: true
                }
            });
        }

        return handles;
    }

    /**
     * Update line geometry based on handle movement
     * @param {string} handleType - Type of handle ('vertex' or 'midpoint')
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Line feature being edited
     * @param {number} handleIndex - Index of the handle being moved
     * @returns {Object|null} Updated geometry and base coordinates or null if invalid
     */
    updateFromHandle(handleType, newPosition, feature, handleIndex = null) {
        const coordinates = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coordinates) {
            console.error('Cannot update - invalid base coordinates');
            return null;
        }

        if (!handleType || typeof handleType !== 'string') {
            console.error('Invalid handleType:', handleType);
            return null;
        }

        const newCoordinates = [...coordinates];

        // Support both formats: 'vertex'/'midpoint' with separate index, or legacy 'vertex-X'/'midpoint-X'
        if (handleType === 'vertex' && handleIndex !== null) {
            if (handleIndex >= 0 && handleIndex < newCoordinates.length) {
                newCoordinates[handleIndex] = newPosition;
            }
        } else if (handleType === 'midpoint' && handleIndex !== null) {
            // For midpoint, index is the segment index, insert at index + 1
            const insertIndex = handleIndex + 1;
            if (handleIndex >= 0 && handleIndex < newCoordinates.length - 1) {
                newCoordinates.splice(insertIndex, 0, newPosition);
            }
        } else if (handleType.startsWith('vertex-')) {
            // Legacy format support
            const index = parseInt(handleType.split('-')[1], 10);
            if (index >= 0 && index < newCoordinates.length) {
                newCoordinates[index] = newPosition;
            }
        } else if (handleType.startsWith('midpoint-')) {
            // Legacy format support
            const segmentIndex = parseInt(handleType.split('-')[1], 10);
            if (segmentIndex >= 0 && segmentIndex < newCoordinates.length - 1) {
                const insertIndex = segmentIndex + 1;
                newCoordinates.splice(insertIndex, 0, newPosition);
            }
        }

        if (!this.validateMinimumDistances(newCoordinates)) {
            console.warn('Line segments too short');
            return null;
        }

        const updatedGeometry = this.createLineStringGeometry(newCoordinates);

        return {
            geometry: updatedGeometry,
            baseCoordinates: newCoordinates
        };
    }

    /**
     * Calculate preview geometry during handle dragging
     * @param {string} handleType - Type of handle being moved
     * @param {Array} newPosition - New handle position
     * @param {Object} feature - Line feature
     * @param {number} handleIndex - Index of the handle being moved
     * @returns {Object|null} Preview geometry and handle positions or null if invalid
     */
    calculatePreview(handleType, newPosition, feature, handleIndex = null) {
        const result = this.updateFromHandle(handleType, newPosition, feature, handleIndex);
        if (!result) return null;

        return {
            geometry: result.geometry,
            baseCoordinates: result.baseCoordinates,
            handles: this.createHandles({
                ...feature,
                properties: { ...feature.properties, baseCoordinates: result.baseCoordinates }
            })
        };
    }

    /**
     * Normalize base coordinates from various formats
     * @param {string|Array} coordinates - Base coordinates
     * @returns {Array|null} Normalized coordinates or null if invalid
     */
    normalizeBaseCoordinates(coordinates) {
        if (typeof coordinates === 'string') {
            try {
                coordinates = JSON.parse(coordinates);
            } catch (e) {
                console.error('Error parsing baseCoordinates:', coordinates, e);
                return null;
            }
        }

        if (!Array.isArray(coordinates)) {
            console.error('Invalid baseCoordinates:', coordinates);
            return null;
        }

        return coordinates;
    }

    /**
     * Calculate midpoint between two coordinates
     * @param {Array} coord1 - First coordinate [lng, lat]
     * @param {Array} coord2 - Second coordinate [lng, lat]
     * @returns {Array} Midpoint [lng, lat]
     */
    calculateMidpoint(coord1, coord2) {
        return [
            (coord1[0] + coord2[0]) / 2,
            (coord1[1] + coord2[1]) / 2
        ];
    }

    /**
     * Validate minimum distances between consecutive points
     * @param {Array} coordinates - Array of coordinates
     * @returns {boolean} True if all segments meet minimum distance
     */
    validateMinimumDistances(coordinates) {
        for (let i = 0; i < coordinates.length - 1; i++) {
            const distance = this.calculateDistance(coordinates[i], coordinates[i + 1]);
            if (distance < this.MIN_DISTANCE_METERS) {
                return false;
            }
        }
        return true;
    }

    /**
     * Check if new point is too close to existing points
     * @param {Array} newPoint - New point [lng, lat]
     * @param {Array} existingPoints - Array of existing points
     * @returns {boolean} True if too close
     */
    isPointTooClose(newPoint, existingPoints) {
        if (existingPoints.length === 0) return false;

        const lastPoint = existingPoints[existingPoints.length - 1];
        const distance = this.calculateDistance(lastPoint, newPoint);
        return distance < this.MIN_DISTANCE_METERS;
    }

    /**
     * Calculate total length of line
     * @param {Array} coordinates - Array of coordinate points
     * @returns {number} Total length in meters
     */
    calculateTotalLength(coordinates) {
        if (!this.validate(coordinates)) {
            return 0;
        }

        let totalDistance = 0;
        for (let i = 0; i < coordinates.length - 1; i++) {
            totalDistance += this.calculateDistance(coordinates[i], coordinates[i + 1]);
        }

        return totalDistance;
    }

    /**
     * Get center point of line (for move operations)
     * @param {Array} coordinates - Array of coordinate points
     * @returns {Array|null} Center point [lng, lat] or null if invalid
     */
    getCenter(coordinates) {
        if (!this.validate(coordinates)) {
            return null;
        }

        return coordinates[0];
    }

    /**
     * Apply offset to all points in line
     * @param {Array} coordinates - Original coordinates
     * @param {number} dx - Delta longitude
     * @param {number} dy - Delta latitude
     * @returns {Array} Offset coordinates
     */
    applyOffset(coordinates, dx, dy) {
        if (!this.validate(coordinates)) {
            return coordinates;
        }

        return coordinates.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);
    }

    /**
     * Get bounding box for line
     * @param {Array} coordinates - Array of coordinate points
     * @returns {Array|null} Bounding box [minLng, minLat, maxLng, maxLat] or null if invalid
     */
    getBoundingBox(coordinates) {
        if (!this.validate(coordinates)) {
            return null;
        }

        const lngs = coordinates.map(p => p[0]);
        const lats = coordinates.map(p => p[1]);

        return [
            Math.min(...lngs),
            Math.min(...lats),
            Math.max(...lngs),
            Math.max(...lats)
        ];
    }

    /**
     * Check if coordinates represent a valid line
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid line
     */
    isValidLine(coordinates) {
        return this.validate(coordinates);
    }

    /**
     * Remove vertex at specific index
     * @param {Array} coordinates - Current coordinates
     * @param {number} index - Index to remove
     * @returns {Array|null} New coordinates or null if invalid
     */
    removeVertexAtIndex(coordinates, index) {
        if (!coordinates || index < 0 || index >= coordinates.length) {
            return null;
        }

        const newCoordinates = [...coordinates];
        newCoordinates.splice(index, 1);

        if (newCoordinates.length < 2) {
            return null;
        }

        return newCoordinates;
    }

    /**
     * Insert vertex at specific position
     * @param {Array} coordinates - Current coordinates
     * @param {number} index - Position to insert at
     * @param {Array} newPoint - New point to insert
     * @returns {Array} Updated coordinates
     */
    insertVertexAtIndex(coordinates, index, newPoint) {
        const newCoordinates = [...coordinates];
        newCoordinates.splice(index, 0, newPoint);
        return newCoordinates;
    }
}

export default AddLineGeometry;

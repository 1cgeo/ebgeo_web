// Path: js\controls_sig\draw_tools\add_polygon_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';

/**
 * Polygon Geometry Operations
 * Handles all geometric calculations and handle management for polygon features
 */
class AddPolygonGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
        this.MIN_DISTANCE_METERS = 5; // Minimum distance between points
        this.MIN_POINTS = 3; // Minimum points for polygon
    }

    /**
     * Generate polygon geometry from coordinates array
     * @param {Array} coordinates - Array of coordinate points [[lng, lat], ...]
     * @returns {Object} GeoJSON Polygon geometry
     */
    generate(coordinates) {
        return this.createPolygonGeometry(coordinates);
    }

    /**
     * Validate polygon parameters
     * @param {Array} coordinates - Array of coordinate points
     * @returns {boolean} True if valid
     */
    validate(coordinates) {
        if (!coordinates || !Array.isArray(coordinates) || coordinates.length < this.MIN_POINTS) {
            return false;
        }

        // Check that all points are valid coordinates
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
     * Create Polygon geometry from coordinates (auto-closes)
     * @param {Array} coordinates - Array of coordinate points
     * @returns {Object} GeoJSON Polygon geometry
     */
    createPolygonGeometry(coordinates) {
        if (!this.validate(coordinates)) {
            throw new Error('Invalid coordinates for polygon geometry');
        }

        // Auto-close polygon by adding first point at the end
        const closedCoordinates = [...coordinates];
        if (!this.isPolygonClosed(coordinates)) {
            closedCoordinates.push(coordinates[0]);
        }

        return {
            type: 'Polygon',
            coordinates: [closedCoordinates] // Polygon requires array of rings
        };
    }

    /**
     * Check if polygon is already closed
     * @param {Array} coordinates - Array of coordinates
     * @returns {boolean} True if closed
     */
    isPolygonClosed(coordinates) {
        if (coordinates.length < 2) return false;
        const first = coordinates[0];
        const last = coordinates[coordinates.length - 1];
        return first[0] === last[0] && first[1] === last[1];
    }

    /**
     * Create edit handles for polygon (vertices + midpoints)
     * @param {Object} feature - Polygon feature
     * @returns {Array} Array of handle features
     */
    createHandles(feature) {
        const coordinates = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coordinates || coordinates.length < this.MIN_POINTS) {
            console.warn('Invalid coordinates for creating polygon handles');
            return [];
        }

        const handles = [];

        // Create vertex handles (red)
        coordinates.forEach((coord, index) => {
            handles.push({
                type: 'Feature',
                id: `polygon-handle-${feature.properties.id}-vertex-${index}`,
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
                    mode: 'polygon_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        // Create midpoint handles (orange) - including between last and first point
        for (let i = 0; i < coordinates.length; i++) {
            const nextIndex = (i + 1) % coordinates.length;
            const midpoint = this.calculateMidpoint(coordinates[i], coordinates[nextIndex]);

            handles.push({
                type: 'Feature',
                id: `polygon-handle-${feature.properties.id}-midpoint-${i}`,
                geometry: {
                    type: 'Point',
                    coordinates: midpoint
                },
                properties: {
                    role: 'handle',
                    handleType: 'midpoint',
                    handleId: `midpoint-${i}`,
                    insertIndex: nextIndex, // Where to insert new vertex
                    featureId: feature.properties.id,
                    mode: 'polygon_editing',
                    meta: 'midpoint',
                    user_isEditingHandle: true
                }
            });
        }

        return handles;
    }

    /**
     * Update polygon geometry based on handle movement
     * @param {string} handleType - Type of handle ('vertex-X' or 'midpoint-X')
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Polygon feature being edited
     * @returns {Object} Updated geometry and base coordinates
     */
    updateFromHandle(handleType, newPosition, feature) {
        const coordinates = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coordinates) {
            console.error('Cannot update - invalid base coordinates');
            return null;
        }

        // Safety check for handleType
        if (!handleType || typeof handleType !== 'string') {
            console.error('Invalid handleType:', handleType);
            return null;
        }

        const newCoordinates = [...coordinates];

        if (handleType.startsWith('vertex-')) {
            // Move existing vertex
            const index = parseInt(handleType.split('-')[1]);
            if (index >= 0 && index < newCoordinates.length) {
                newCoordinates[index] = newPosition;
            }
        } else if (handleType.startsWith('midpoint-')) {
            // Insert new vertex at midpoint
            const segmentIndex = parseInt(handleType.split('-')[1]);
            const insertIndex = (segmentIndex + 1) % coordinates.length;
            newCoordinates.splice(insertIndex, 0, newPosition);
        }

        // Validate minimum points and distances
        if (newCoordinates.length < this.MIN_POINTS) {
            console.warn('Polygon must have at least 3 points');
            return null;
        }

        if (!this.validateMinimumDistances(newCoordinates)) {
            console.warn('Polygon segments too short');
            return null;
        }

        const updatedGeometry = this.createPolygonGeometry(newCoordinates);

        return {
            geometry: updatedGeometry,
            baseCoordinates: newCoordinates
        };
    }

    /**
     * Calculate preview geometry during handle dragging
     * @param {string} handleType - Type of handle being moved
     * @param {Array} newPosition - New handle position
     * @param {Object} feature - Polygon feature
     * @returns {Object} Preview geometry and handle positions
     */
    calculatePreview(handleType, newPosition, feature) {
        const result = this.updateFromHandle(handleType, newPosition, feature);
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
        for (let i = 0; i < coordinates.length; i++) {
            const nextIndex = (i + 1) % coordinates.length;
            const distance = this.calculateDistance(coordinates[i], coordinates[nextIndex]);
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
     * Calculate area of polygon
     * @param {Array} coordinates - Array of coordinate points
     * @returns {number} Area in square meters
     */
    calculateArea(coordinates) {
        if (!this.validate(coordinates)) {
            return 0;
        }

        try {
            // CRITICAL FIX: Ensure coordinates are closed for turf operations
            const closedCoordinates = [...coordinates];
            if (!this.isPolygonClosed(coordinates)) {
                closedCoordinates.push(coordinates[0]);
            }

            const polygon = turf.polygon([closedCoordinates]);
            return turf.area(polygon);
        } catch (error) {
            console.warn('Error calculating polygon area:', error);
            return 0;
        }
    }

    /**
     * Calculate perimeter of polygon
     * @param {Array} coordinates - Array of coordinate points
     * @returns {number} Perimeter in meters
     */
    calculatePerimeter(coordinates) {
        if (!this.validate(coordinates)) {
            return 0;
        }

        let totalDistance = 0;
        for (let i = 0; i < coordinates.length; i++) {
            const nextIndex = (i + 1) % coordinates.length;
            totalDistance += this.calculateDistance(coordinates[i], coordinates[nextIndex]);
        }

        return totalDistance;
    }

    /**
 * Get center point of polygon (centroid for move operations)
 * @param {Array} coordinates - Array of coordinate points
 * @returns {Array} Center point [lng, lat]
 */
    getCenter(coordinates) {
        if (!this.validate(coordinates)) {
            return null;
        }

        try {
            // CRITICAL FIX: Ensure polygon is closed before passing to turf
            const closedCoordinates = [...coordinates];
            if (!this.isPolygonClosed(coordinates)) {
                closedCoordinates.push(coordinates[0]);
            }

            const polygon = turf.polygon([closedCoordinates]);
            const centroid = turf.centroid(polygon);
            return centroid.geometry.coordinates;
        } catch (error) {
            console.warn('Error calculating polygon center:', error);
            // Fallback: use first point
            return coordinates[0];
        }
    }

    /**
     * Apply offset to all points in polygon
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
     * Get bounding box for polygon
     * @param {Array} coordinates - Array of coordinate points
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates) {
        if (!this.validate(coordinates)) {
            return null;
        }

        const lngs = coordinates.map(p => p[0]);
        const lats = coordinates.map(p => p[1]);

        return [
            Math.min(...lngs), // minLng
            Math.min(...lats), // minLat
            Math.max(...lngs), // maxLng
            Math.max(...lats)  // maxLat
        ];
    }

    /**
     * Check if coordinates represent a valid polygon
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid polygon
     */
    isValidPolygon(coordinates) {
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

        // Must have at least 3 points for a polygon
        if (newCoordinates.length < this.MIN_POINTS) {
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

    /**
 * Calculate polygon centroid for measurements
 * @param {Array} coordinates - Array of coordinate points
 * @returns {Array|null} Centroid coordinates or null if error
 */
    calculateCentroid(coordinates) {
        if (!this.validate(coordinates)) {
            return null;
        }

        try {
            // CRITICAL FIX: Apply same auto-closing logic
            const closedCoordinates = [...coordinates];
            if (!this.isPolygonClosed(coordinates)) {
                closedCoordinates.push(coordinates[0]);
            }

            const polygon = turf.polygon([closedCoordinates]);
            const centroid = turf.centroid(polygon);
            return centroid.geometry.coordinates;
        } catch (error) {
            console.warn('Error calculating centroid:', error);
            return this.getCenter(coordinates); // Fallback to getCenter
        }
    }


    /**
     * Format area measurement for display
     * @param {number} areaInSquareMeters - Area in square meters
     * @returns {string} Formatted area string
     */
    formatArea(areaInSquareMeters) {
        if (areaInSquareMeters >= 100000) {
            return `${(areaInSquareMeters / 1000000).toFixed(2)} km²`;
        } else {
            return `${areaInSquareMeters.toFixed(2)} m²`;
        }
    }

    /**
     * Check if polygon is self-intersecting
     * @param {Array} coordinates - Array of coordinate points
     * @returns {boolean} True if self-intersecting
     */
    isSelfIntersecting(coordinates) {
        if (!this.validate(coordinates)) {
            return false;
        }

        try {
            // CRITICAL FIX: Ensure coordinates are closed for turf operations
            const closedCoordinates = [...coordinates];
            if (!this.isPolygonClosed(coordinates)) {
                closedCoordinates.push(coordinates[0]);
            }

            const polygon = turf.polygon([closedCoordinates]);
            // Use turf's kinks to detect self-intersections
            const kinks = turf.kinks(polygon);
            return kinks.features.length > 0;
        } catch (error) {
            console.warn('Error checking self-intersection:', error);
            return false;
        }
    }

    /**
     * Simplify polygon by removing redundant vertices
     * @param {Array} coordinates - Array of coordinate points
     * @param {number} tolerance - Simplification tolerance in degrees
     * @returns {Array} Simplified coordinates
     */
    simplifyPolygon(coordinates, tolerance = 0.00001) {
        if (coordinates.length <= this.MIN_POINTS) return coordinates;

        try {
            // CRITICAL FIX: Ensure coordinates are closed for turf operations
            const closedCoordinates = [...coordinates];
            if (!this.isPolygonClosed(coordinates)) {
                closedCoordinates.push(coordinates[0]);
            }

            const polygon = turf.polygon([closedCoordinates]);
            const simplified = turf.simplify(polygon, { tolerance });

            // Extract coordinates and ensure minimum points
            const simplifiedCoords = simplified.geometry.coordinates[0];
            // Remove last point if it's the same as first (auto-closing will handle this)
            const coords = this.isPolygonClosed(simplifiedCoords)
                ? simplifiedCoords.slice(0, -1)
                : simplifiedCoords;

            return coords.length >= this.MIN_POINTS ? coords : coordinates;
        } catch (error) {
            console.warn('Error simplifying polygon:', error);
            return coordinates;
        }
    }
}

export default AddPolygonGeometry;
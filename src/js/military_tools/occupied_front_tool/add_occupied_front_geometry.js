// Path: js/military_tools/occupied_front_tool/add_occupied_front_geometry.js
import { BaseGeometry } from '@tools';

/**
 * Occupied Front Geometry Operations
 * Handles all geometric calculations and handle management for occupied front features
 */
class AddOccupiedFrontGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
    }

    /**
     * Generate occupied front geometry from base coordinates
     * @param {Array} baseCoordinates - Array of 3 points [p1, p2, p3]
     * @returns {Object} GeoJSON MultiLineString geometry
     */
    generate(baseCoordinates) {
        return this.createOccupiedFrontGeometry(baseCoordinates);
    }

    /**
     * Validate occupied front parameters
     * @param {Array} baseCoordinates - Array of base coordinates
     * @returns {boolean} True if valid
     */
    validate(baseCoordinates) {
        if (!baseCoordinates || !Array.isArray(baseCoordinates) || baseCoordinates.length < 3) {
            return false;
        }

        // Check that we have valid coordinates
        for (const coord of baseCoordinates) {
            if (!Array.isArray(coord) || coord.length < 2) {
                return false;
            }
        }

        // Check minimum distance between p1 and p2
        const distance = this.calculateDistance(baseCoordinates[0], baseCoordinates[1]);
        return distance >= 10;
    }

    /**
     * Normalize base coordinates from various formats
     * @param {string|Array} coords - Base coordinates
     * @returns {Array} Normalized coordinates array
     */
    normalizeBaseCoordinates(coords) {
        if (typeof coords === 'string') {
            try {
                coords = JSON.parse(coords);
            } catch (e) {
                console.error('Error parsing baseCoordinates:', coords, e);
                return [];
            }
        }

        if (!Array.isArray(coords)) {
            console.error('Invalid baseCoordinates:', coords);
            return [];
        }

        return coords;
    }

    /**
     * Create the MultiLineString geometry for occupied front
     * @param {Array} coords - Array of 3 base coordinates [p1, p2, p3]
     * @returns {Object} GeoJSON MultiLineString geometry
     */
    createOccupiedFrontGeometry(coords) {
        if (!coords || coords.length < 3) return null;

        const p1 = coords[0]; // Origin
        const p2 = coords[1]; // Upper arm
        const p3 = coords[2]; // Lower arm

        const multiLine = {
            type: 'MultiLineString',
            coordinates: []
        };

        // Create both arms independently using createRay
        const upperArm = this.createRay(p1, p2, -1); // Upper arm (curve right)
        const lowerArm = this.createRay(p1, p3, 1);  // Lower arm (curve left)

        multiLine.coordinates.push(...upperArm);
        multiLine.coordinates.push(...lowerArm);

        return multiLine;
    }

    /**
     * Create geometry for a single arm of the occupied front
     * @param {Array} startPoint - Origin point (P1)
     * @param {Array} endPoint - End point (P2 or P3)
     * @param {number} turnDirection - Curve direction: -1 for right, 1 for left
     * @returns {Array} Array of line coordinates forming the arm
     */
    createRay(startPoint, endPoint, turnDirection) {
        const rayLines = [];
        const initialBearing = this.calculateBearing(startPoint, endPoint);
        const distance = this.calculateDistance(startPoint, endPoint);

        if (distance < 1) return [];

        // 1. Curve start point (60% of the way)
        const p_turn1 = this.destination(startPoint, distance * 0.6, initialBearing);

        // 2. Curve end point
        // The curve has a 225 degree angle and length of 10% of total radius
        const turnBearing = initialBearing + (225 * turnDirection);
        const turnLength = distance * 0.1;
        const p_turn2 = this.destination(p_turn1, turnLength, turnBearing);

        // 3. Assemble the 3 line segments of the arm
        rayLines.push([startPoint, p_turn1]);
        rayLines.push([p_turn1, p_turn2]);
        rayLines.push([p_turn2, endPoint]);

        // 4. Arrow head - TWO COMPLETE LINES
        const headLength = distance * 0.1;
        const finalBearing = this.calculateBearing(p_turn2, endPoint);
        const headPoint1 = this.destination(endPoint, headLength, finalBearing + 150);
        const headPoint2 = this.destination(endPoint, headLength, finalBearing - 150);

        // Two separate lines to form complete arrow
        rayLines.push([headPoint1, endPoint]);
        rayLines.push([headPoint2, endPoint]);

        return rayLines;
    }

    /**
     * Create edit handles for occupied front
     * @param {Object} feature - Occupied front feature
     * @returns {Array} Array of handle features for all 3 control points
     */
    createHandles(feature) {
        const coords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);

        if (coords.length < 3) {
            console.warn('Insufficient coordinates to create handles:', coords);
            return [];
        }

        const handles = [
            // Handle P1 - origin (center)
            {
                type: 'Feature',
                id: `occupied-front-handle-${feature.properties.id}-p1`,
                geometry: { type: 'Point', coordinates: coords[0] },
                properties: {
                    role: 'handle',
                    handleType: 'center',
                    handleId: 'p1',
                    index: 0,
                    featureId: feature.properties.id,
                    mode: 'occupied_front_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            },
            // Handle P2 - upper arm (primary)
            {
                type: 'Feature',
                id: `occupied-front-handle-${feature.properties.id}-p2`,
                geometry: { type: 'Point', coordinates: coords[1] },
                properties: {
                    role: 'handle',
                    handleType: 'primary',
                    handleId: 'p2',
                    index: 1,
                    featureId: feature.properties.id,
                    mode: 'occupied_front_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            },
            // Handle P3 - lower arm (secondary)
            {
                type: 'Feature',
                id: `occupied-front-handle-${feature.properties.id}-p3`,
                geometry: { type: 'Point', coordinates: coords[2] },
                properties: {
                    role: 'handle',
                    handleType: 'secondary',
                    handleId: 'p3',
                    index: 2,
                    featureId: feature.properties.id,
                    mode: 'occupied_front_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            }
        ];

        return handles;
    }

    /**
     * Update occupied front geometry based on handle movement
     * @param {string} handleType - Type of handle ('p1', 'p2', or 'p3')
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Occupied front feature being edited
     * @returns {Object} Updated geometry and base coordinates
     */
    updateFromHandle(handleType, newPosition, feature) {
        if (!['p1', 'p2', 'p3'].includes(handleType)) {
            console.warn('Unknown handle type for occupied front:', handleType);
            return null;
        }

        const currentCoords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!currentCoords || currentCoords.length < 3) {
            console.error('Cannot update - invalid base coordinates');
            return null;
        }

        // Update the moved point
        const newCoords = [...currentCoords];
        if (handleType === 'p1') newCoords[0] = newPosition;
        else if (handleType === 'p2') newCoords[1] = newPosition;
        else if (handleType === 'p3') newCoords[2] = newPosition;

        // Validate minimum distance (only check p1-p2 since p3 is derived)
        if (handleType === 'p1' || handleType === 'p2') {
            const distance = this.calculateDistance(newCoords[0], newCoords[1]);
            if (distance < 10) {
                console.warn('Occupied front distance too small:', distance);
                return null;
            }
        }

        const updatedGeometry = this.createOccupiedFrontGeometry(newCoords);

        return {
            geometry: updatedGeometry,
            baseCoordinates: newCoords
        };
    }

    /**
     * Calculate preview geometry during handle dragging
     * @param {string} handleType - Type of handle being moved
     * @param {Array} newPosition - New handle position
     * @param {Object} feature - Occupied front feature
     * @returns {Object} Preview geometry and handle positions
     */
    calculatePreview(handleType, newPosition, feature) {
        const currentCoords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!currentCoords || currentCoords.length < 3) {
            return null;
        }

        const previewCoords = [...currentCoords];
        if (handleType === 'p1') previewCoords[0] = newPosition;
        else if (handleType === 'p2') previewCoords[1] = newPosition;
        else if (handleType === 'p3') previewCoords[2] = newPosition;

        // Validate minimum distance
        if (handleType === 'p1' || handleType === 'p2') {
            const distance = this.calculateDistance(previewCoords[0], previewCoords[1]);
            if (distance < 10) {
                return null;
            }
        }

        const previewGeometry = this.createOccupiedFrontGeometry(previewCoords);

        return {
            geometry: previewGeometry,
            baseCoordinates: previewCoords,
            handlePositions: previewCoords
        };
    }

    /**
     * Check if base coordinates are valid
     * @param {Array} coords - Base coordinates to check
     * @returns {boolean} True if valid
     */
    areValidBaseCoordinates(coords) {
        if (!coords || !Array.isArray(coords) || coords.length < 3) {
            return false;
        }

        return coords.every(coord =>
            Array.isArray(coord) &&
            coord.length >= 2 &&
            typeof coord[0] === 'number' &&
            typeof coord[1] === 'number' &&
            !isNaN(coord[0]) &&
            !isNaN(coord[1])
        );
    }

    /**
     * Get bounding box for occupied front
     * @param {Array} baseCoordinates - Base coordinates
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(baseCoordinates) {
        if (!this.areValidBaseCoordinates(baseCoordinates)) {
            return null;
        }

        const allLngs = baseCoordinates.map(coord => coord[0]);
        const allLats = baseCoordinates.map(coord => coord[1]);

        return [
            Math.min(...allLngs), // minLng
            Math.min(...allLats), // minLat
            Math.max(...allLngs), // maxLng
            Math.max(...allLats)  // maxLat
        ];
    }

    /**
     * Calculate center point from base coordinates (for move operations)
     * @param {Array} baseCoordinates - Base coordinates
     * @returns {Array} Center point [lng, lat]
     */
    calculateCenter(baseCoordinates) {
        if (!this.areValidBaseCoordinates(baseCoordinates)) {
            return null;
        }

        // Use p1 (origin) as the reference center for movement
        return baseCoordinates[0];
    }

    /**
     * Calculate bearing between two points
     * @param {Array} point1 - Start point [lng, lat]
     * @param {Array} point2 - End point [lng, lat]
     * @returns {number} Bearing in degrees
     */
    calculateBearing(point1, point2) {
        const lat1 = point1[1] * Math.PI / 180;
        const lat2 = point2[1] * Math.PI / 180;
        const deltaLng = (point2[0] - point1[0]) * Math.PI / 180;

        const y = Math.sin(deltaLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    /**
     * Calculate destination point given distance and bearing
     * @param {Array} point - Start point [lng, lat]
     * @param {number} distance - Distance in meters
     * @param {number} bearing - Bearing in degrees
     * @returns {Array} Destination point [lng, lat]
     */
    destination(point, distance, bearing) {
        const R = 6371000; // Earth's radius in meters
        const lat1 = point[1] * Math.PI / 180;
        const lng1 = point[0] * Math.PI / 180;
        const bearingRad = bearing * Math.PI / 180;

        const lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(distance / R) +
            Math.cos(lat1) * Math.sin(distance / R) * Math.cos(bearingRad)
        );

        const lng2 = lng1 + Math.atan2(
            Math.sin(bearingRad) * Math.sin(distance / R) * Math.cos(lat1),
            Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2)
        );

        return [lng2 * 180 / Math.PI, lat2 * 180 / Math.PI];
    }

    /**
     * Normalize center coordinates (for backward compatibility with move operations)
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
     * Get the origin point (p1) for compatibility
     * @param {Array} baseCoordinates - Base coordinates
     * @returns {Array|null} Origin point or null if invalid
     */
    getOriginPoint(baseCoordinates) {
        const coords = this.normalizeBaseCoordinates(baseCoordinates);
        return coords.length > 0 ? coords[0] : null;
    }
}

export default AddOccupiedFrontGeometry;

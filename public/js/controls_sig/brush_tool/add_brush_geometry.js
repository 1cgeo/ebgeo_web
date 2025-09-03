// Path: js\controls_sig\brush_tool\add_brush_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';

/**
 * Brush Geometry Operations
 * Handles all geometric calculations for brush features (LineString)
 */
class AddBrushGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
        this.MIN_DISTANCE_PX = 3; // Minimum pixel distance between points
    }

    /**
     * Generate brush LineString geometry from points array
     * @param {Array} points - Array of coordinate points [[lng, lat], ...]
     * @returns {Object} GeoJSON LineString geometry
     */
    generate(points) {
        return this.createLineStringGeometry(points);
    }

    /**
     * Validate brush parameters
     * @param {Array} points - Array of coordinate points
     * @returns {boolean} True if valid
     */
    validate(points) {
        if (!points || !Array.isArray(points) || points.length < 2) {
            return false;
        }

        // Check that all points are valid coordinates
        return points.every(point => 
            Array.isArray(point) && 
            point.length >= 2 &&
            typeof point[0] === 'number' && 
            typeof point[1] === 'number' &&
            !isNaN(point[0]) && 
            !isNaN(point[1])
        );
    }

    /**
     * Create LineString geometry from points
     * @param {Array} points - Array of coordinate points
     * @returns {Object} GeoJSON LineString geometry
     */
    createLineStringGeometry(points) {
        if (!this.validate(points)) {
            throw new Error('Invalid points for brush geometry');
        }

        return {
            type: 'LineString',
            coordinates: [...points] // Create copy to avoid mutation
        };
    }

    /**
     * Create edit handles for brush (none - brush features don't have handles)
     * @param {Object} feature - Brush feature
     * @returns {Array} Empty array (brush features don't have edit handles)
     */
    createHandles(feature) {
        return []; // Brush features don't have edit handles
    }

    /**
     * Update geometry based on handle movement (not applicable for brush)
     * @param {string} handleType - Type of handle
     * @param {Array} newPosition - New handle position
     * @param {Object} feature - Feature being edited
     * @returns {null} Always null (brush doesn't support handle editing)
     */
    updateFromHandle(handleType, newPosition, feature) {
        return null; // Brush features don't support handle editing
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
                console.error('Error parsing brush coordinates:', coordinates, e);
                return null;
            }
        }

        if (!Array.isArray(coordinates)) {
            console.error('Invalid brush coordinates:', coordinates);
            return null;
        }

        return coordinates;
    }

    /**
     * Check if pixel distance is sufficient for adding new point
     * @param {Object} lastPixelPoint - Last pixel point {x, y}
     * @param {Object} newPixelPoint - New pixel point {x, y}
     * @returns {boolean} True if distance is sufficient
     */
    isPixelDistanceSufficient(lastPixelPoint, newPixelPoint) {
        if (!lastPixelPoint) return true;

        const distance = Math.sqrt(
            Math.pow(newPixelPoint.x - lastPixelPoint.x, 2) +
            Math.pow(newPixelPoint.y - lastPixelPoint.y, 2)
        );

        return distance >= this.MIN_DISTANCE_PX;
    }

    /**
     * Optimize brush line by removing redundant points
     * @param {Array} points - Array of coordinate points
     * @param {number} tolerance - Simplification tolerance in degrees
     * @returns {Array} Simplified points array
     */
    simplifyLine(points, tolerance = 0.00001) {
        if (points.length <= 2) return points;

        const simplified = [points[0]]; // Always keep first point

        for (let i = 1; i < points.length - 1; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const next = points[i + 1];

            // Check if current point deviates significantly from straight line
            const deviation = this.calculatePointLineDistance(curr, prev, next);
            
            if (deviation > tolerance) {
                simplified.push(curr);
            }
        }

        simplified.push(points[points.length - 1]); // Always keep last point
        return simplified;
    }

    /**
     * Calculate distance from point to line segment
     * @param {Array} point - Point [lng, lat]
     * @param {Array} lineStart - Line start [lng, lat]
     * @param {Array} lineEnd - Line end [lng, lat]
     * @returns {number} Distance in degrees
     */
    calculatePointLineDistance(point, lineStart, lineEnd) {
        const [px, py] = point;
        const [x1, y1] = lineStart;
        const [x2, y2] = lineEnd;

        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        
        if (lenSq === 0) return Math.sqrt(A * A + B * B);

        const param = dot / lenSq;
        
        let xx, yy;
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Get bounding box for brush line
     * @param {Array} points - Array of coordinate points
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(points) {
        if (!this.validate(points)) {
            return null;
        }

        const lngs = points.map(p => p[0]);
        const lats = points.map(p => p[1]);

        return [
            Math.min(...lngs), // minLng
            Math.min(...lats), // minLat
            Math.max(...lngs), // maxLng
            Math.max(...lats)  // maxLat
        ];
    }

    /**
     * Calculate total length of brush line
     * @param {Array} points - Array of coordinate points
     * @returns {number} Total length in meters
     */
    calculateTotalLength(points) {
        if (!this.validate(points)) {
            return 0;
        }

        let totalDistance = 0;
        for (let i = 0; i < points.length - 1; i++) {
            totalDistance += this.calculateDistance(points[i], points[i + 1]);
        }

        return totalDistance;
    }

    /**
     * Get center point of brush line (for move operations)
     * @param {Array} points - Array of coordinate points
     * @returns {Array} Center point [lng, lat]
     */
    getCenter(points) {
        if (!this.validate(points)) {
            return null;
        }

        // Use first point as reference for movement operations
        return points[0];
    }

    /**
     * Apply offset to all points in brush line
     * @param {Array} points - Original points
     * @param {number} dx - Delta longitude
     * @param {number} dy - Delta latitude
     * @returns {Array} Offset points
     */
    applyOffset(points, dx, dy) {
        if (!this.validate(points)) {
            return points;
        }

        return points.map(point => [
            point[0] + dx,
            point[1] + dy
        ]);
    }

    /**
     * Check if coordinates represent a valid brush line
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid brush line
     */
    isValidBrushLine(coordinates) {
        return this.validate(coordinates);
    }
}

export default AddBrushGeometry;
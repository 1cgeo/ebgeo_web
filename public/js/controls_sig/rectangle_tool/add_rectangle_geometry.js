// Path: js\controls_sig\rectangle_tool\add_rectangle_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';

/**
 * Rectangle Geometry Operations
 * Handles all geometric calculations and handle management for rectangle features
 */
class AddRectangleGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
    }

    /**
     * Generate rectangle geometry from two opposite corners
     * @param {Array} corner1 - First corner coordinates [lng, lat]
     * @param {Array} corner2 - Opposite corner coordinates [lng, lat]
     * @returns {Object} GeoJSON Polygon geometry
     */
    generate(corner1, corner2) {
        return this.generateRectangleGeometry(corner1, corner2);
    }

    /**
     * Validate rectangle parameters
     * @param {Array} corner1 - First corner coordinates
     * @param {Array} corner2 - Second corner coordinates
     * @returns {boolean} True if valid
     */
    validate(corner1, corner2) {
        if (!corner1 || !Array.isArray(corner1) || corner1.length < 2) {
            return false;
        }

        if (!corner2 || !Array.isArray(corner2) || corner2.length < 2) {
            return false;
        }

        const { width, height } = this.calculateDimensionsFromCorners(corner1, corner2);
        return width >= 10 && height >= 10;
    }

    /**
     * Normalize corner coordinates from various formats
     * @param {string|Array} corner - Corner coordinates
     * @returns {Array|null} Normalized corner or null if invalid
     */
    normalizeCorner(corner) {
        if (typeof corner === 'string') {
            try {
                corner = JSON.parse(corner);
            } catch (e) {
                console.error('Error parsing corner:', corner, e);
                return null;
            }
        }

        if (!Array.isArray(corner) || corner.length < 2) {
            console.error('Invalid corner:', corner);
            return null;
        }

        return corner;
    }

    /**
     * Normalize center coordinates (for backward compatibility)
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
     * Generate rectangle polygon geometry from two opposite corners
     * @param {Array} corner1 - First corner coordinates [lng, lat]
     * @param {Array} corner2 - Opposite corner coordinates [lng, lat]
     * @returns {Object} GeoJSON Polygon geometry
     */
    generateRectangleGeometry(corner1, corner2) {
        // Create rectangle from any two opposite corners
        const minLng = Math.min(corner1[0], corner2[0]);
        const maxLng = Math.max(corner1[0], corner2[0]);
        const minLat = Math.min(corner1[1], corner2[1]);
        const maxLat = Math.max(corner1[1], corner2[1]);
        
        return {
            type: 'Polygon',
            coordinates: [[
                [minLng, maxLat], // top-left
                [maxLng, maxLat], // top-right
                [maxLng, minLat], // bottom-right
                [minLng, minLat], // bottom-left
                [minLng, maxLat]  // close polygon
            ]]
        };
    }

    /**
     * CRITICAL FIX: Extract normalized corners from actual geometry
     * This ensures preview and final geometry use the same corner positions
     * @param {Object} geometry - GeoJSON Polygon geometry
     * @returns {Object} {corner1, corner2} - Normalized corner coordinates
     */
    extractCornersFromGeometry(geometry) {
        if (!geometry || !geometry.coordinates || !geometry.coordinates[0]) {
            console.error('Invalid geometry for corner extraction');
            return { corner1: null, corner2: null };
        }

        const coords = geometry.coordinates[0];
        
        // Extract coordinates from the normalized polygon
        // Based on generateRectangleGeometry structure:
        // [minLng, maxLat], [maxLng, maxLat], [maxLng, minLat], [minLng, minLat]
        const minLng = coords[0][0]; // or coords[3][0]
        const maxLng = coords[1][0]; // or coords[2][0] 
        const minLat = coords[2][1]; // or coords[3][1]
        const maxLat = coords[0][1]; // or coords[1][1]

        // Return as two opposite corners (consistent with how geometry is generated)
        return {
            corner1: [minLng, minLat], // bottom-left
            corner2: [maxLng, maxLat]  // top-right
        };
    }

    /**
     * CRITICAL FIX: Create handles from actual geometry instead of stored properties
     * This ensures handles are positioned exactly where the geometry indicates
     * @param {Object} geometry - GeoJSON Polygon geometry
     * @param {string} featureId - Feature ID for handle identification
     * @returns {Array} Array of handle features for both corners
     */
    createHandlesFromGeometry(geometry, featureId) {
        const corners = this.extractCornersFromGeometry(geometry);
        
        if (!corners.corner1 || !corners.corner2) {
            console.error('Cannot create handles - invalid geometry corners');
            return [];
        }

        const handles = [
            {
                type: 'Feature',
                id: `rectangle-handle-${featureId}-corner1`,
                geometry: {
                    type: 'Point',
                    coordinates: corners.corner1
                },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: 'corner1',
                    featureId: featureId,
                    mode: 'rectangle_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            },
            {
                type: 'Feature',
                id: `rectangle-handle-${featureId}-corner2`,
                geometry: {
                    type: 'Point',
                    coordinates: corners.corner2
                },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: 'corner2',
                    featureId: featureId,
                    mode: 'rectangle_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            }
        ];

        return handles;
    }

    /**
     * Calculate dimensions and center from two corners
     * @param {Array} corner1 - First corner coordinates [lng, lat]
     * @param {Array} corner2 - Second corner coordinates [lng, lat]
     * @returns {Object} {center, width, height} all calculated from corners
     */
    calculateDimensionsFromCorners(corner1, corner2) {
        // Calculate center
        const center = [
            (corner1[0] + corner2[0]) / 2,
            (corner1[1] + corner2[1]) / 2
        ];
        
        // Calculate dimensions in meters using Haversine formula
        const width = this.calculateDistance([corner1[0], center[1]], [corner2[0], center[1]]);
        const height = this.calculateDistance([center[0], corner1[1]], [center[0], corner2[1]]);
        
        return { center, width, height };
    }

    /**
     * LEGACY METHOD: Create edit handles for rectangle (backward compatibility)
     * @param {Object} feature - Rectangle feature
     * @returns {Array} Array of handle features for both corners
     * @deprecated Use createHandlesFromGeometry for consistency
     */
    createHandles(feature) {
        console.warn('createHandles is deprecated, use createHandlesFromGeometry for better consistency');
        return this.createHandlesFromGeometry(feature.geometry, feature.properties.id);
    }

    /**
     * Update rectangle geometry based on handle movement
     * @param {string} handleType - Type of handle ('corner1' or 'corner2')
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Rectangle feature being edited
     * @returns {Object} Updated geometry, corners and dimensions
     */
    updateFromHandle(handleType, newPosition, feature) {
        if (!['corner1', 'corner2'].includes(handleType)) {
            console.warn('Unknown handle type for rectangle:', handleType);
            return null;
        }

        // CRITICAL FIX: Use geometry extraction instead of properties
        const currentCorners = this.extractCornersFromGeometry(feature.geometry);
        
        if (!currentCorners.corner1 || !currentCorners.corner2) {
            console.error('Cannot update - invalid geometry corners');
            return null;
        }

        // Update the moved corner
        const newCorner1 = handleType === 'corner1' ? newPosition : currentCorners.corner1;
        const newCorner2 = handleType === 'corner2' ? newPosition : currentCorners.corner2;

        // Validate minimum dimensions
        const { width, height, center } = this.calculateDimensionsFromCorners(newCorner1, newCorner2);
        
        if (width < 10 || height < 10) {
            console.warn('Rectangle dimensions too small:', { width, height });
            return null;
        }

        const updatedGeometry = this.generateRectangleGeometry(newCorner1, newCorner2);

        return {
            geometry: updatedGeometry,
            corner1: newCorner1,
            corner2: newCorner2,
            center: center,
            width: width,
            height: height
        };
    }

    /**
     * Calculate preview geometry during corner dragging
     * @param {string} handleType - Type of handle being moved
     * @param {Array} newPosition - New handle position
     * @param {Object} feature - Rectangle feature
     * @returns {Object} Preview geometry and handle positions
     */
    calculatePreview(handleType, newPosition, feature) {
        // CRITICAL FIX: Use geometry extraction for consistency
        const currentCorners = this.extractCornersFromGeometry(feature.geometry);
        
        if (!currentCorners.corner1 || !currentCorners.corner2) {
            return null;
        }

        const previewCorner1 = handleType === 'corner1' ? newPosition : currentCorners.corner1;
        const previewCorner2 = handleType === 'corner2' ? newPosition : currentCorners.corner2;

        const { width, height } = this.calculateDimensionsFromCorners(previewCorner1, previewCorner2);
        
        if (width < 10 || height < 10) {
            return null;
        }

        const previewGeometry = this.generateRectangleGeometry(previewCorner1, previewCorner2);

        // CRITICAL FIX: Return normalized corners from geometry, not input corners
        const normalizedCorners = this.extractCornersFromGeometry(previewGeometry);

        return {
            geometry: previewGeometry,
            corner1: normalizedCorners.corner1,
            corner2: normalizedCorners.corner2,
            handlePositions: [normalizedCorners.corner1, normalizedCorners.corner2]
        };
    }

    /**
     * Check if coordinates represent valid rectangle corners
     * @param {Array} corner1 - First corner coordinates
     * @param {Array} corner2 - Second corner coordinates
     * @returns {boolean} True if valid corners
     */
    areValidCorners(corner1, corner2) {
        return this.isValidCoordinate(corner1) && 
               this.isValidCoordinate(corner2) &&
               corner1[0] !== corner2[0] && 
               corner1[1] !== corner2[1];
    }

    /**
     * Check if coordinates are valid
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid
     */
    isValidCoordinate(coordinates) {
        return coordinates && 
               Array.isArray(coordinates) && 
               coordinates.length >= 2 && 
               typeof coordinates[0] === 'number' && 
               typeof coordinates[1] === 'number' &&
               !isNaN(coordinates[0]) && 
               !isNaN(coordinates[1]);
    }

    /**
     * Get bounding box for rectangle
     * @param {Array} corner1 - First corner
     * @param {Array} corner2 - Second corner
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(corner1, corner2) {
        return [
            Math.min(corner1[0], corner2[0]), // minLng
            Math.min(corner1[1], corner2[1]), // minLat
            Math.max(corner1[0], corner2[0]), // maxLng
            Math.max(corner1[1], corner2[1])  // maxLat
        ];
    }

    /**
     * Convert center and dimensions back to corners (for move operations)
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} width - Width in meters
     * @param {number} height - Height in meters
     * @returns {Object} {corner1, corner2} coordinates
     */
    calculateCornersFromCenterAndDimensions(center, width, height) {
        // Convert dimensions from meters to degrees (approximate)
        const widthInDegrees = width / 111320; // rough conversion at equator
        const heightInDegrees = height / 111320;
        
        // Account for latitude distortion for width
        const cosLat = Math.cos(center[1] * Math.PI / 180);
        const adjustedWidthInDegrees = widthInDegrees / cosLat;

        const halfWidth = adjustedWidthInDegrees / 2;
        const halfHeight = heightInDegrees / 2;

        const corner1 = [center[0] - halfWidth, center[1] - halfHeight];
        const corner2 = [center[0] + halfWidth, center[1] + halfHeight];

        return { corner1, corner2 };
    }

    /**
     * CRITICAL FIX: Synchronize properties with actual geometry
     * Updates feature properties to match the normalized geometry
     * @param {Object} feature - Rectangle feature to sync
     * @returns {Object} Feature with synchronized properties
     */
    synchronizePropertiesWithGeometry(feature) {
        const corners = this.extractCornersFromGeometry(feature.geometry);
        const { center, width, height } = this.calculateDimensionsFromCorners(corners.corner1, corners.corner2);

        return {
            ...feature,
            properties: {
                ...feature.properties,
                corner1: corners.corner1,
                corner2: corners.corner2,
                center: center,
                width: width,
                height: height
            }
        };
    }
}

export default AddRectangleGeometry;
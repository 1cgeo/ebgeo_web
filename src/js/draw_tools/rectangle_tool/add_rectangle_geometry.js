// Path: js/draw_tools/rectangle_tool/add_rectangle_geometry.js
import { BaseGeometry } from '../../tool_manager';

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
     * @param {number} borderRadius - Corner radius (0-10 scale, 0 = no rounding)
     * @param {number} bearing - Rotation angle in degrees (0 = aligned with lat/lng, optional)
     * @param {number|null} width - Optional width in meters (avoids recalculation if provided)
     * @param {number|null} height - Optional height in meters (avoids recalculation if provided)
     * @returns {Object} GeoJSON Polygon geometry
     */
    generate(corner1, corner2, borderRadius = 0, bearing = 0, width = null, height = null) {
        if (bearing && bearing !== 0) {
            const center = [
                (corner1[0] + corner2[0]) / 2,
                (corner1[1] + corner2[1]) / 2
            ];

            // Use provided dimensions if available (more reliable due to swap conventions)
            // Otherwise fall back to calculation from corners
            let finalWidth = width;
            let finalHeight = height;

            if (finalWidth === null || finalHeight === null) {
                const calculated = this.calculateDimensionsFromRotatedCorners(corner1, corner2, bearing);
                finalWidth = finalWidth ?? calculated.width;
                finalHeight = finalHeight ?? calculated.height;
            }

            return this.generateRotatedRectangleGeometry(center, finalWidth, finalHeight, borderRadius, bearing);
        }

        // Original behavior for rectangles without rotation
        return this.generateRectangleGeometry(corner1, corner2, borderRadius);
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
     * @param {number} borderRadius - Corner radius (0-10 scale, 0 = no rounding)
     * @returns {Object} GeoJSON Polygon geometry
     */
    generateRectangleGeometry(corner1, corner2, borderRadius = 0) {
        const minLng = Math.min(corner1[0], corner2[0]);
        const maxLng = Math.max(corner1[0], corner2[0]);
        const minLat = Math.min(corner1[1], corner2[1]);
        const maxLat = Math.max(corner1[1], corner2[1]);

        if (!borderRadius || borderRadius <= 0) {
            return {
                type: 'Polygon',
                coordinates: [[
                    [minLng, maxLat],
                    [maxLng, maxLat],
                    [maxLng, minLat],
                    [minLng, minLat],
                    [minLng, maxLat]
                ]]
            };
        }

        return this.generateRoundedRectangleGeometry(minLng, minLat, maxLng, maxLat, borderRadius);
    }

    /**
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} width - Width in meters
     * @param {number} height - Height in meters
     * @param {number} borderRadius - Corner radius (0-10 scale)
     * @param {number} bearing - Rotation angle in degrees
     * @returns {Object} GeoJSON Polygon geometry with rotation applied
     */
    generateRotatedRectangleGeometry(center, width, height, borderRadius, bearing) {
        // Calculate 4 corners of non-rotated rectangle (in local offsets)
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        // Corners in local coordinates (meters)
        const localCorners = [
            { x: halfWidth, y: halfHeight },
            { x: -halfWidth, y: halfHeight },
            { x: -halfWidth, y: -halfHeight },
            { x: halfWidth, y: -halfHeight }
        ];

        // Rotate and convert to geographic coordinates
        const rotatedCorners = localCorners.map(corner =>
            this.rotateAndTranslate(corner.x, corner.y, center, bearing)
        );

        // If borderRadius > 0, add rounded arcs at corners
        if (borderRadius && borderRadius > 0) {
            return this.generateRoundedRotatedRectangle(center, width, height, borderRadius, bearing);
        }

        // Simple rotated rectangle
        rotatedCorners.push(rotatedCorners[0]);

        return {
            type: 'Polygon',
            coordinates: [rotatedCorners]
        };
    }

    /**
     * Rotate point and translate to geographic coordinates
     * @param {number} x - Local X offset in meters
     * @param {number} y - Local Y offset in meters
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} bearing - Rotation angle in degrees
     * @returns {Array} Rotated geographic coordinates [lng, lat]
     */
    rotateAndTranslate(x, y, center, bearing) {
        // Calculate distance and angle from local offset
        const distance = Math.sqrt(x * x + y * y) / 1000;
        const localAngle = Math.atan2(y, x) * 180 / Math.PI;

        // Adjust angle: 0 degrees = east, 90 degrees = north
        const adjustedAngle = localAngle + bearing;

        return turf.destination(center, distance, adjustedAngle, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * Generate rounded corners for rotated rectangle
     * All calculations are done in local coordinates (meters) then projected to geographic
     * @param {Array} center - Center of rectangle [lng, lat]
     * @param {number} width - Rectangle width in meters
     * @param {number} height - Rectangle height in meters
     * @param {number} borderRadius - Border radius (0-10 scale)
     * @param {number} bearing - Rotation angle in degrees
     * @returns {Object} GeoJSON Polygon with rounded corners
     */
    generateRoundedRotatedRectangle(center, width, height, borderRadius, bearing) {
        const segmentsPerCorner = 8;
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        // Calculate effective radius
        const minDimension = Math.min(width, height);
        const radiusScale = borderRadius / 10;
        const radius = Math.min(minDimension * radiusScale * 0.5, minDimension / 2);

        // Corner definitions in local coordinates (meters, centered at origin)
        // Each corner has an arc center offset inward by radius, and sweep angles
        const cornerDefinitions = [
            {
                // C0: top-right corner
                arcCenter: { x: halfWidth - radius, y: halfHeight - radius },
                startAngle: 0,
                endAngle: Math.PI / 2
            },
            {
                // C1: top-left corner
                arcCenter: { x: -(halfWidth - radius), y: halfHeight - radius },
                startAngle: Math.PI / 2,
                endAngle: Math.PI
            },
            {
                // C2: bottom-left corner
                arcCenter: { x: -(halfWidth - radius), y: -(halfHeight - radius) },
                startAngle: Math.PI,
                endAngle: 3 * Math.PI / 2
            },
            {
                // C3: bottom-right corner
                arcCenter: { x: halfWidth - radius, y: -(halfHeight - radius) },
                startAngle: 3 * Math.PI / 2,
                endAngle: 2 * Math.PI
            }
        ];

        const localPoints = [];

        // Generate arc points for each corner in local coordinates
        for (const def of cornerDefinitions) {
            for (let i = 0; i <= segmentsPerCorner; i++) {
                const t = i / segmentsPerCorner;
                const angle = def.startAngle + t * (def.endAngle - def.startAngle);

                // Arc point in local coordinates (meters from center)
                const x = def.arcCenter.x + radius * Math.cos(angle);
                const y = def.arcCenter.y + radius * Math.sin(angle);

                localPoints.push({ x, y });
            }
        }

        // Project all local points to geographic coordinates with rotation
        const geoCoordinates = localPoints.map(p =>
            this.rotateAndTranslate(p.x, p.y, center, bearing)
        );

        // Close the polygon
        geoCoordinates.push(geoCoordinates[0]);

        return {
            type: 'Polygon',
            coordinates: [geoCoordinates]
        };
    }

    /**
     * Generate rounded rectangle geometry
     * @param {number} minLng - Minimum longitude
     * @param {number} minLat - Minimum latitude
     * @param {number} maxLng - Maximum longitude
     * @param {number} maxLat - Maximum latitude
     * @param {number} borderRadius - Corner radius (0-10 scale)
     * @returns {Object} GeoJSON Polygon with rounded corners
     */
    generateRoundedRectangleGeometry(minLng, minLat, maxLng, maxLat, borderRadius) {
        const segmentsPerCorner = 8;

        const centerLat = (minLat + maxLat) / 2;
        const rectWidth = maxLng - minLng;
        const rectHeight = maxLat - minLat;

        const minDimension = Math.min(rectWidth, rectHeight);
        const radiusScale = borderRadius / 10;
        const effectiveRadius = minDimension * radiusScale * 0.5;

        const maxRadius = minDimension / 2;
        const radius = Math.min(effectiveRadius, maxRadius);

        const coordinates = [];

        this.addRoundedCorner(
            coordinates,
            maxLng - radius, maxLat - radius,
            radius, radius,
            0, Math.PI / 2,
            segmentsPerCorner
        );

        this.addRoundedCorner(
            coordinates,
            minLng + radius, maxLat - radius,
            radius, radius,
            Math.PI / 2, Math.PI,
            segmentsPerCorner
        );

        this.addRoundedCorner(
            coordinates,
            minLng + radius, minLat + radius,
            radius, radius,
            Math.PI, 3 * Math.PI / 2,
            segmentsPerCorner
        );

        this.addRoundedCorner(
            coordinates,
            maxLng - radius, minLat + radius,
            radius, radius,
            3 * Math.PI / 2, 2 * Math.PI,
            segmentsPerCorner
        );

        coordinates.push(coordinates[0]);

        return {
            type: 'Polygon',
            coordinates: [coordinates]
        };
    }

    /**
     * Add corner arc points to coordinates array
     * @param {Array} coordinates - Array to append coordinates to
     * @param {number} centerLng - Center longitude of the arc
     * @param {number} centerLat - Center latitude of the arc
     * @param {number} radiusLng - Radius in longitude direction
     * @param {number} radiusLat - Radius in latitude direction
     * @param {number} startAngle - Start angle in radians
     * @param {number} endAngle - End angle in radians
     * @param {number} segments - Number of segments in the arc
     */
    addRoundedCorner(coordinates, centerLng, centerLat, radiusLng, radiusLat, startAngle, endAngle, segments) {
        for (let i = 0; i <= segments; i++) {
            const angle = startAngle + (endAngle - startAngle) * (i / segments);
            const lng = centerLng + radiusLng * Math.cos(angle);
            const lat = centerLat + radiusLat * Math.sin(angle);
            coordinates.push([lng, lat]);
        }
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

        const lngs = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);

        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);

        return {
            corner1: [minLng, minLat],
            corner2: [maxLng, maxLat]
        };
    }

    /**
     * Create edit handles using width-resize and height-resize (similar to ellipse)
     * @param {Object} geometry - Rectangle geometry
     * @param {string} featureId - Feature ID
     * @param {number} bearing - Current bearing (rotation angle)
     * @param {Object} properties - Feature properties (used when bearing exists)
     * @returns {Array} Array of handle features
     */
    createHandlesFromGeometry(geometry, featureId, bearing = 0, properties = null) {
        if (!properties || !properties.center || !properties.width || !properties.height) {
            console.error('Cannot create handles - missing properties (center, width, height)');
            return [];
        }

        const center = this.normalizeCenter(properties.center);
        const width = properties.width;
        const height = properties.height;

        if (!center || !width || !height) {
            console.error('Cannot create handles - invalid dimensions');
            return [];
        }

        const handles = [];

        // Handle 1: Width resize - in bearing direction
        const widthHandlePos = this.calculateWidthHandlePosition(center, width, bearing);
        handles.push({
            type: 'Feature',
            id: `rectangle-handle-${featureId}-width`,
            geometry: {
                type: 'Point',
                coordinates: widthHandlePos
            },
            properties: {
                role: 'handle',
                handleType: 'vertex',
                handleId: 'width-resize',
                featureId: featureId,
                mode: 'rectangle_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Handle 2: Height resize - perpendicular to bearing (bearing + 90 degrees)
        const heightHandlePos = this.calculateHeightHandlePosition(center, height, bearing);
        handles.push({
            type: 'Feature',
            id: `rectangle-handle-${featureId}-height`,
            geometry: {
                type: 'Point',
                coordinates: heightHandlePos
            },
            properties: {
                role: 'handle',
                handleType: 'vertex',
                handleId: 'height-resize',
                featureId: featureId,
                mode: 'rectangle_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Handle 3: Rotation - opposite to height handle
        const rotationHandlePos = this.calculateRotationHandlePosition(center, height, bearing);
        handles.push({
            type: 'Feature',
            id: `rectangle-handle-${featureId}-rotation`,
            geometry: {
                type: 'Point',
                coordinates: rotationHandlePos
            },
            properties: {
                role: 'handle',
                handleType: 'eccentricity',
                handleId: 'rotation',
                featureId: featureId,
                mode: 'rectangle_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        return handles;
    }

    /**
     * Calculate width handle position (in bearing direction)
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} width - Width in meters
     * @param {number} bearing - Current bearing
     * @returns {Array} Handle position coordinates
     */
    calculateWidthHandlePosition(center, width, bearing) {
        const distance = (width / 2) / 1000;
        return turf.destination(center, distance, bearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * Calculate height handle position (perpendicular to bearing - bearing + 90 degrees)
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} height - Height in meters
     * @param {number} bearing - Current bearing
     * @returns {Array} Handle position coordinates
     */
    calculateHeightHandlePosition(center, height, bearing) {
        const heightBearing = bearing + 90;
        const distance = (height / 2) / 1000;
        return turf.destination(center, distance, heightBearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * Calculate rotation handle position
     * Positioned opposite to height handle (bearing - 90 degrees)
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} height - Height in meters
     * @param {number} bearing - Current bearing
     * @returns {Array} Handle position coordinates
     */
    calculateRotationHandlePosition(center, height, bearing) {
        const rotationBearing = bearing - 90;
        const distance = (height / 2) / 1000;

        return turf.destination(center, distance, rotationBearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * Calculate dimensions and center from two corners
     * @param {Array} corner1 - First corner coordinates [lng, lat]
     * @param {Array} corner2 - Second corner coordinates [lng, lat]
     * @returns {Object} {center, width, height} all calculated from corners
     */
    calculateDimensionsFromCorners(corner1, corner2) {
        const center = [
            (corner1[0] + corner2[0]) / 2,
            (corner1[1] + corner2[1]) / 2
        ];

        const width = this.calculateDistance([corner1[0], center[1]], [corner2[0], center[1]]);
        const height = this.calculateDistance([center[0], corner1[1]], [center[0], corner2[1]]);

        return { center, width, height };
    }

    /**
     * Calculate dimensions from corners considering rotation
     * For rotated rectangles, uses diagonal and bearing to calculate correct dimensions
     * @param {Array} corner1 - First corner (opposite diagonal from corner2)
     * @param {Array} corner2 - Second corner (opposite diagonal from corner1)
     * @param {number} bearing - Current rotation bearing in degrees
     * @returns {Object} {center, width, height}
     */
    calculateDimensionsFromRotatedCorners(corner1, corner2, bearing) {
        const center = [
            (corner1[0] + corner2[0]) / 2,
            (corner1[1] + corner2[1]) / 2
        ];

        // Calculate diagonal distance between corners (in meters)
        const diagonalDistance = turf.distance(corner1, corner2, { units: 'kilometers' }) * 1000;

        // Calculate diagonal angle
        const diagonalBearing = turf.bearing(corner2, corner1);

        // Difference between diagonal bearing and rectangle bearing gives internal angle
        const angleDiff = (diagonalBearing - bearing) * Math.PI / 180;

        // Calculate width and height from diagonal and angle
        const width = Math.abs(diagonalDistance * Math.cos(angleDiff));
        const height = Math.abs(diagonalDistance * Math.sin(angleDiff));

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
        return this.createHandlesFromGeometry(
            feature.geometry,
            feature.properties.id,
            feature.properties.bearing,
            feature.properties
        );
    }

    /**
     * Update rectangle geometry based on handle movement
     * Uses width-resize, height-resize and rotation (similar to ellipse)
     * @param {string} handleType - Type of handle ('width-resize', 'height-resize', 'rotation')
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Rectangle feature being edited
     * @returns {Object} Updated geometry, corners, dimensions and bearing
     */
    updateFromHandle(handleType, newPosition, feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            console.error('Cannot update - invalid center');
            return null;
        }

        let { width, height, bearing } = feature.properties;

        switch (handleType) {
            case 'width-resize':
                // Update
                width = this.calculateWidthFromHandle(center, newPosition, bearing) * 2;
                break;

            case 'height-resize':
                // Update
                height = this.calculateHeightFromHandle(center, newPosition, bearing) * 2;
                break;

            case 'rotation':
                // Update
                bearing = this.calculateBearingFromRotationHandle(center, newPosition);
                break;

            default:
                console.warn('Unknown handle type for rectangle:', handleType);
                return null;
        }

        // Validate minimum dimensions
        if (width < 10 || height < 10) {
            console.warn('Rectangle dimensions too small:', { width, height });
            return null;
        }

        // Recalculate corners with new dimensions
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const newCorner1 = this.rotateAndTranslate(halfWidth, halfHeight, center, bearing);
        const newCorner2 = this.rotateAndTranslate(-halfWidth, -halfHeight, center, bearing);

        const updatedGeometry = this.generateRotatedRectangleGeometry(
            center,
            width,
            height,
            feature.properties.borderRadius || 0,
            bearing
        );

        return {
            geometry: updatedGeometry,
            corner1: newCorner1,
            corner2: newCorner2,
            center: center,
            width: width,
            height: height,
            bearing: bearing
        };
    }

    /**
     * Calculate width from handle position
     * @param {Array} center - Center coordinates
     * @param {Array} newPosition - New handle position
     * @param {number} bearing - Current bearing (not used, handle defines directly)
     * @returns {number} New half-width in meters (distance from center to handle)
     */
    calculateWidthFromHandle(center, newPosition, bearing) {
        // Distance from center to handle is half the width
        return turf.distance(center, newPosition, { units: 'kilometers' }) * 1000;
    }

    /**
     * Calculate height from handle position
     * @param {Array} center - Center coordinates
     * @param {Array} newPosition - New handle position
     * @param {number} bearing - Current bearing (not used, handle defines directly)
     * @returns {number} New half-height in meters (distance from center to handle)
     */
    calculateHeightFromHandle(center, newPosition, bearing) {
        // Distance from center to handle is half the height
        return turf.distance(center, newPosition, { units: 'kilometers' }) * 1000;
    }

    /**
     * Calculate bearing from rotation handle position
     * Handle is positioned at bearing-90, so compensate by adding 90
     * @param {Array} center - Center coordinates
     * @param {Array} handlePosition - Rotation handle position
     * @returns {number} New bearing in degrees
     */
    calculateBearingFromRotationHandle(center, handlePosition) {
        const handleBearing = turf.bearing(center, handlePosition);
        return handleBearing + 90;
    }

    /**
     * Calculate preview geometry during handle dragging
     * Uses width-resize, height-resize and rotation
     * @param {string} handleType - Type of handle being moved
     * @param {Array} newPosition - New handle position
     * @param {Object} feature - Rectangle feature
     * @returns {Object} Preview geometry and handle positions
     */
    calculatePreview(handleType, newPosition, feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            return null;
        }

        let { width, height, bearing } = feature.properties;

        // Update
        switch (handleType) {
            case 'width-resize':
                width = this.calculateWidthFromHandle(center, newPosition, bearing) * 2;
                break;
            case 'height-resize':
                height = this.calculateHeightFromHandle(center, newPosition, bearing) * 2;
                break;
            case 'rotation':
                bearing = this.calculateBearingFromRotationHandle(center, newPosition);
                break;
            default:
                return null;
        }

        // Validate minimum dimensions
        if (width < 10 || height < 10) {
            return null;
        }

        const previewGeometry = this.generateRotatedRectangleGeometry(
            center,
            width,
            height,
            feature.properties.borderRadius || 0,
            bearing
        );

        // Calculate new handle positions for preview
        const widthHandlePos = this.calculateWidthHandlePosition(center, width, bearing);
        const heightHandlePos = this.calculateHeightHandlePosition(center, height, bearing);
        const rotationHandlePos = this.calculateRotationHandlePosition(center, height, bearing);

        // Recalculate corners for compatibility
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const previewCorner1 = this.rotateAndTranslate(halfWidth, halfHeight, center, bearing);
        const previewCorner2 = this.rotateAndTranslate(-halfWidth, -halfHeight, center, bearing);

        return {
            geometry: previewGeometry,
            corner1: previewCorner1,
            corner2: previewCorner2,
            width: width,
            height: height,
            bearing: bearing,
            handlePositions: {
                width: widthHandlePos,
                height: heightHandlePos,
                rotation: rotationHandlePos
            }
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
            Math.min(corner1[0], corner2[0]),
            Math.min(corner1[1], corner2[1]),
            Math.max(corner1[0], corner2[0]),
            Math.max(corner1[1], corner2[1])
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
        const widthInDegrees = width / 111320;
        const heightInDegrees = height / 111320;

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

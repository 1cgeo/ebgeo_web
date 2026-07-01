// Path: js/draw_tools/ellipse_tool/add_ellipse_geometry.js

import { BaseGeometry } from '../../tool_manager';

/**
 * Ellipse Geometry Operations
 * Handles all geometric calculations and handle management for ellipse features
 */
class AddEllipseGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
    }

    /**
     * Generate ellipse geometry from center, radii and bearing
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} majorRadius - Major radius in kilometers
     * @param {number} minorRadius - Minor radius in kilometers
     * @param {number} bearing - Bearing in degrees
     * @returns {Object} GeoJSON Polygon geometry
     */
    generate(center, majorRadius, minorRadius, bearing) {
        return this.generateEllipseGeometry(center, majorRadius, minorRadius, bearing);
    }

    /**
     * Validate ellipse parameters
     * @param {Array} center - Center coordinates
     * @param {number} majorRadius - Major radius in kilometers
     * @param {number} minorRadius - Minor radius in kilometers
     * @param {number} bearing - Bearing in degrees
     * @returns {boolean} True if valid
     */
    validate(center, majorRadius, minorRadius, bearing) {
        if (!center || !Array.isArray(center) || center.length < 2) {
            return false;
        }

        if (!Number.isFinite(majorRadius) || majorRadius < 0.01) {
            return false;
        }

        if (!Number.isFinite(minorRadius) || minorRadius < 0.01) {
            return false;
        }

        if (!Number.isFinite(bearing)) {
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
     * Generate ellipse polygon geometry using turf.ellipse
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} majorRadius - Major radius in kilometers
     * @param {number} minorRadius - Minor radius in kilometers
     * @param {number} bearing - Bearing in degrees
     * @returns {Object} GeoJSON Polygon geometry
     */
    generateEllipseGeometry(center, majorRadius, minorRadius, bearing) {
        const options = {
            angle: bearing - 90,
            steps: 64,
            units: 'kilometers'
        };

        const ellipsePolygon = turf.ellipse(center, majorRadius, minorRadius, options);
        return ellipsePolygon.geometry;
    }

    /**
     * Create 3 edit handles (2 red resize + 1 blue rotation)
     * @param {Object} feature - Ellipse feature
     * @returns {Array} Array of handle features
     */
    createHandles(feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            console.error('Cannot create handles - invalid center');
            return [];
        }

        const { majorRadius, minorRadius, bearing } = feature.properties;
        const handles = [];

        const horizontalHandlePos = this.calculateHorizontalHandlePosition(center, majorRadius, minorRadius, bearing);
        handles.push({
            type: 'Feature',
            id: `ellipse-handle-${feature.properties.id}-horizontal`,
            geometry: {
                type: 'Point',
                coordinates: horizontalHandlePos
            },
            properties: {
                role: 'handle',
                handleType: 'vertex',
                handleId: 'horizontal-resize',
                featureId: feature.properties.id,
                mode: 'ellipse_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        const verticalHandlePos = this.calculateVerticalHandlePosition(center, majorRadius, minorRadius, bearing);
        handles.push({
            type: 'Feature',
            id: `ellipse-handle-${feature.properties.id}-vertical`,
            geometry: {
                type: 'Point',
                coordinates: verticalHandlePos
            },
            properties: {
                role: 'handle',
                handleType: 'vertex',
                handleId: 'vertical-resize',
                featureId: feature.properties.id,
                mode: 'ellipse_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        const rotationHandlePos = this.calculateRotationHandlePosition(center, majorRadius, minorRadius, bearing);
        handles.push({
            type: 'Feature',
            id: `ellipse-handle-${feature.properties.id}-rotation`,
            geometry: {
                type: 'Point',
                coordinates: rotationHandlePos
            },
            properties: {
                role: 'handle',
                handleType: 'eccentricity',
                handleId: 'rotation',
                featureId: feature.properties.id,
                mode: 'ellipse_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        return handles;
    }

    /**
     * Calculate horizontal resize handle position
     * @param {Array} center - Center coordinates
     * @param {number} majorRadius - Major radius in kilometers
     * @param {number} minorRadius - Minor radius in kilometers
     * @param {number} bearing - Bearing in degrees
     * @returns {Array} Handle position coordinates
     */
    calculateHorizontalHandlePosition(center, majorRadius, minorRadius, bearing) {
        return turf.destination(center, majorRadius, bearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * Calculate vertical resize handle position
     * @param {Array} center - Center coordinates
     * @param {number} majorRadius - Major radius in kilometers
     * @param {number} minorRadius - Minor radius in kilometers
     * @param {number} bearing - Bearing in degrees
     * @returns {Array} Handle position coordinates
     */
    calculateVerticalHandlePosition(center, majorRadius, minorRadius, bearing) {
        const verticalBearing = bearing + 90;
        return turf.destination(center, minorRadius, verticalBearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * Calculate rotation handle position
     * @param {Array} center - Center coordinates
     * @param {number} majorRadius - Major radius in kilometers
     * @param {number} minorRadius - Minor radius in kilometers
     * @param {number} bearing - Bearing in degrees
     * @returns {Array} Handle position coordinates
     */
    calculateRotationHandlePosition(center, majorRadius, minorRadius, bearing) {
        const rotationBearing = bearing - 90;
        return turf.destination(center, minorRadius, rotationBearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * Update ellipse geometry based on handle movement
     * @param {string} handleType - Type of handle
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Ellipse feature being edited
     * @returns {Object} Updated geometry, radii and bearing
     */
    updateFromHandle(handleType, newPosition, feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            console.error('Cannot update - invalid center');
            return null;
        }

        let { majorRadius, minorRadius, bearing } = feature.properties;

        switch (handleType) {
            case 'horizontal-resize':
                majorRadius = this.calculateHorizontalRadius(center, newPosition, bearing);
                break;

            case 'vertical-resize':
                minorRadius = this.calculateVerticalRadius(center, newPosition, bearing);
                break;

            case 'rotation':
                bearing = this.calculateRotationBearing(center, newPosition);
                break;

            default:
                console.warn('Unknown handle type for ellipse:', handleType);
                return null;
        }

        if (majorRadius < 0.01 || minorRadius < 0.01) {
            console.warn('Ellipse radius too small:', { majorRadius, minorRadius });
            return null;
        }

        const updatedGeometry = this.generateEllipseGeometry(center, majorRadius, minorRadius, bearing);

        return {
            geometry: updatedGeometry,
            majorRadius,
            minorRadius,
            bearing
        };
    }

    /**
     * Calculate new horizontal radius based on handle position
     * @param {Array} center - Center coordinates
     * @param {Array} newPosition - New handle position
     * @param {number} bearing - Current bearing
     * @returns {number} New major radius
     */
    calculateHorizontalRadius(center, newPosition, _bearing) {
        return turf.distance(center, newPosition, { units: 'kilometers' });
    }

    /**
     * Calculate new vertical radius based on handle position
     * @param {Array} center - Center coordinates
     * @param {Array} newPosition - New handle position
     * @param {number} bearing - Current bearing
     * @returns {number} New minor radius
     */
    calculateVerticalRadius(center, newPosition, _bearing) {
        return turf.distance(center, newPosition, { units: 'kilometers' });
    }

    /**
     * Calculate new bearing based on rotation handle position
     * @param {Array} center - Center coordinates
     * @param {Array} newPosition - New rotation handle position
     * @returns {number} New bearing in degrees
     */
    calculateRotationBearing(center, newPosition) {
        const handleBearing = turf.bearing(center, newPosition);
        return handleBearing + 90;
    }

    /**
     * Calculate preview geometry during handle dragging
     * @param {string} handleType - Type of handle being moved
     * @param {Array} newPosition - New handle position
     * @param {Object} feature - Ellipse feature
     * @returns {Object} Preview geometry and handle positions
     */
    calculatePreview(handleType, newPosition, feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            return null;
        }

        let { majorRadius, minorRadius, bearing } = feature.properties;

        switch (handleType) {
            case 'horizontal-resize':
                majorRadius = this.calculateHorizontalRadius(center, newPosition, bearing);
                break;
            case 'vertical-resize':
                minorRadius = this.calculateVerticalRadius(center, newPosition, bearing);
                break;
            case 'rotation':
                bearing = this.calculateRotationBearing(center, newPosition);
                break;
            default:
                return null;
        }

        if (majorRadius < 0.01 || minorRadius < 0.01) {
            return null;
        }

        const previewGeometry = this.generateEllipseGeometry(center, majorRadius, minorRadius, bearing);

        const horizontalHandlePos = this.calculateHorizontalHandlePosition(center, majorRadius, minorRadius, bearing);
        const verticalHandlePos = this.calculateVerticalHandlePosition(center, majorRadius, minorRadius, bearing);
        const rotationHandlePos = this.calculateRotationHandlePosition(center, majorRadius, minorRadius, bearing);

        return {
            geometry: previewGeometry,
            majorRadius,
            minorRadius,
            bearing,
            handlePositions: {
                horizontal: horizontalHandlePos,
                vertical: verticalHandlePos,
                rotation: rotationHandlePos
            }
        };
    }

    /**
     * Calculate ellipse dimensions from two points (always horizontal)
     * @param {Array} center - Center coordinates
     * @param {Array} endPoint - End point for major axis
     * @returns {Object} {majorRadius, bearing, minorRadius}
     */
    calculateInitialDimensions(center, endPoint) {
        const majorRadius = turf.distance(center, endPoint, { units: 'kilometers' });
        const bearing = 90;

        return {
            majorRadius,
            bearing,
            minorRadius: majorRadius * 0.6
        };
    }

    /**
     * Check if coordinates represent a valid ellipse center
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
     * Get bounding box for ellipse
     * @param {Array} center - Ellipse center
     * @param {number} majorRadius - Major radius in kilometers
     * @param {number} minorRadius - Minor radius in kilometers
     * @param {number} bearing - Bearing in degrees
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(center, majorRadius, minorRadius, _bearing) {
        const maxRadius = Math.max(majorRadius, minorRadius);
        const radiusInDegrees = (maxRadius * 1000) / 111320;
        const cosLat = Math.cos(center[1] * Math.PI / 180);

        return [
            center[0] - (radiusInDegrees / cosLat),
            center[1] - radiusInDegrees,
            center[0] + (radiusInDegrees / cosLat),
            center[1] + radiusInDegrees
        ];
    }

    /**
     * Convert ellipse properties for move operation
     * @param {Array} center - Current center
     * @param {number} majorRadius - Major radius
     * @param {number} minorRadius - Minor radius
     * @param {number} bearing - Current bearing
     * @param {number} dx - Delta X in degrees
     * @param {number} dy - Delta Y in degrees
     * @returns {Object} New ellipse properties
     */
    moveEllipse(center, majorRadius, minorRadius, bearing, dx, dy) {
        const newCenter = [center[0] + dx, center[1] + dy];

        return {
            center: newCenter,
            majorRadius,
            minorRadius,
            bearing,
            geometry: this.generateEllipseGeometry(newCenter, majorRadius, minorRadius, bearing)
        };
    }
}

export default AddEllipseGeometry;

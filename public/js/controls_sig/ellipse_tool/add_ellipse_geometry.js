// Path: js\controls_sig\ellipse_tool\add_ellipse_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';

/**
 * Ellipse Geometry Operations
 * Handles all geometric calculations and handle management for ellipse features
 * 
 * ✅ CORREÇÃO: Inversão de eixos consistente em toda a cadeia
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

        if (typeof majorRadius !== 'number' || majorRadius < 0.01) { // 10 meters minimum
            return false;
        }

        if (typeof minorRadius !== 'number' || minorRadius < 0.01) {
            return false;
        }

        if (typeof bearing !== 'number' || isNaN(bearing)) {
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
     * ✅ NOVO: Normalizar parâmetros da ellipse para consistência
     * Sempre retorna valores onde majorRadius >= minorRadius
     */
    normalizeEllipseParams(majorRadius, minorRadius, bearing) {
        if (minorRadius > majorRadius) {
            return {
                majorRadius: minorRadius,
                minorRadius: majorRadius,
                bearing: bearing + 90
            };
        }
        return {
            majorRadius,
            minorRadius,
            bearing
        };
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
        // ✅ CORREÇÃO: Usar parâmetros normalizados consistentemente
        const normalized = this.normalizeEllipseParams(majorRadius, minorRadius, bearing);
        
        const options = {
            angle: normalized.bearing - 90, // Align major axis with bearing direction
            steps: 64,
            units: 'kilometers'
        };

        // Use turf.ellipse for accurate geodesic ellipse
        const ellipsePolygon = turf.ellipse(center, normalized.majorRadius, normalized.minorRadius, options);
        return ellipsePolygon.geometry;
    }

    /**
     * ✅ CORRIGIDO: Create edit handles usando parâmetros normalizados
     * @param {Object} feature - Ellipse feature
     * @returns {Array} Array of handle features [majorHandle, minorHandle]
     */
    createHandles(feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            console.error('Cannot create handles - invalid center');
            return [];
        }

        // ✅ CORREÇÃO: Usar parâmetros normalizados para consistência
        const normalized = this.normalizeEllipseParams(
            feature.properties.majorRadius,
            feature.properties.minorRadius,
            feature.properties.bearing
        );

        const handles = [];

        // Major axis handle (red) - positioned at normalized bearing direction from center
        const majorAxisEnd = turf.destination(center, normalized.majorRadius, normalized.bearing, { units: 'kilometers' });
        
        handles.push({
            type: 'Feature',
            id: `ellipse-handle-${feature.properties.id}-major`,
            geometry: {
                type: 'Point',
                coordinates: majorAxisEnd.geometry.coordinates
            },
            properties: {
                role: 'handle',
                handleType: 'vertex', // RED color in styling
                handleId: 'major-axis',
                featureId: feature.properties.id,
                mode: 'ellipse_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Minor axis handle (blue) - perpendicular to major axis
        const perpendicularBearing = normalized.bearing + 90;
        const minorAxisEnd = turf.destination(center, normalized.minorRadius, perpendicularBearing, { units: 'kilometers' });

        handles.push({
            type: 'Feature',
            id: `ellipse-handle-${feature.properties.id}-minor`,
            geometry: {
                type: 'Point',
                coordinates: minorAxisEnd.geometry.coordinates
            },
            properties: {
                role: 'handle',
                handleType: 'eccentricity', // BLUE color in styling
                handleId: 'minor-axis',
                featureId: feature.properties.id,
                mode: 'ellipse_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        return handles;
    }

    /**
     * ✅ CORRIGIDO: Update ellipse geometry based on handle movement
     * @param {string} handleType - Type of handle ('major-axis' or 'minor-axis')
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

        // ✅ CORREÇÃO: Trabalhar com parâmetros normalizados
        const currentNormalized = this.normalizeEllipseParams(
            feature.properties.majorRadius,
            feature.properties.minorRadius,
            feature.properties.bearing
        );

        let newMajorRadius = currentNormalized.majorRadius;
        let newMinorRadius = currentNormalized.minorRadius;
        let newBearing = currentNormalized.bearing;

        if (handleType === 'major-axis') {
            // Update major radius and bearing using normalized values
            newMajorRadius = turf.distance(center, newPosition, { units: 'kilometers' });
            newBearing = turf.bearing(center, newPosition);
        } else if (handleType === 'minor-axis') {
            // Update minor radius only
            newMinorRadius = turf.distance(center, newPosition, { units: 'kilometers' });
        } else {
            console.warn('Unknown handle type for ellipse:', handleType);
            return null;
        }

        // Validate minimum radii
        if (newMajorRadius < 0.01 || newMinorRadius < 0.01) {
            console.warn('Ellipse radius too small:', { newMajorRadius, newMinorRadius });
            return null;
        }

        // ✅ CORREÇÃO: Retornar valores não-normalizados para storage
        // mas usar valores normalizados para geometria
        const finalNormalized = this.normalizeEllipseParams(newMajorRadius, newMinorRadius, newBearing);
        const updatedGeometry = this.generateEllipseGeometry(center, newMajorRadius, newMinorRadius, newBearing);

        // ✅ IMPORTANTE: Retornar os valores originais (não normalizados) para armazenamento
        return {
            geometry: updatedGeometry,
            majorRadius: newMajorRadius,
            minorRadius: newMinorRadius,
            bearing: newBearing
        };
    }

    /**
     * ✅ CORRIGIDO: Calculate preview geometry during handle dragging
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

        // ✅ CORREÇÃO: Trabalhar com valores normalizados
        const currentNormalized = this.normalizeEllipseParams(
            feature.properties.majorRadius,
            feature.properties.minorRadius,
            feature.properties.bearing
        );

        let previewMajorRadius = currentNormalized.majorRadius;
        let previewMinorRadius = currentNormalized.minorRadius;
        let previewBearing = currentNormalized.bearing;

        if (handleType === 'major-axis') {
            previewMajorRadius = turf.distance(center, newPosition, { units: 'kilometers' });
            previewBearing = turf.bearing(center, newPosition);
        } else if (handleType === 'minor-axis') {
            previewMinorRadius = turf.distance(center, newPosition, { units: 'kilometers' });
        }

        // Validate minimum radii
        if (previewMajorRadius < 0.01 || previewMinorRadius < 0.01) {
            return null;
        }

        // ✅ CORREÇÃO: Normalizar para consistência na geração
        const previewNormalized = this.normalizeEllipseParams(previewMajorRadius, previewMinorRadius, previewBearing);
        const previewGeometry = this.generateEllipseGeometry(center, previewMajorRadius, previewMinorRadius, previewBearing);

        // ✅ CORREÇÃO: Calcular posições dos handles usando valores normalizados
        const majorHandlePosition = turf.destination(center, previewNormalized.majorRadius, previewNormalized.bearing, { units: 'kilometers' });
        const minorHandlePosition = turf.destination(center, previewNormalized.minorRadius, previewNormalized.bearing + 90, { units: 'kilometers' });

        return {
            geometry: previewGeometry,
            majorRadius: previewMajorRadius, // Retorna valores originais
            minorRadius: previewMinorRadius,
            bearing: previewBearing,
            handlePositions: {
                major: majorHandlePosition.geometry.coordinates,
                minor: minorHandlePosition.geometry.coordinates
            }
        };
    }

    /**
     * Calculate ellipse dimensions from two points
     * @param {Array} center - Center coordinates
     * @param {Array} endPoint - End point for major axis
     * @returns {Object} {majorRadius, bearing}
     */
    calculateInitialDimensions(center, endPoint) {
        const majorRadius = turf.distance(center, endPoint, { units: 'kilometers' });
        const bearing = turf.bearing(center, endPoint);
        
        return {
            majorRadius,
            bearing,
            minorRadius: majorRadius * 0.6 // Default ratio
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
    getBoundingBox(center, majorRadius, minorRadius, bearing) {
        // For simplicity, use the larger radius as approximate bounding box
        const maxRadius = Math.max(majorRadius, minorRadius);
        const radiusInDegrees = (maxRadius * 1000) / 111320; // Convert km to degrees
        const cosLat = Math.cos(center[1] * Math.PI / 180);

        return [
            center[0] - (radiusInDegrees / cosLat), // minLng
            center[1] - radiusInDegrees,            // minLat
            center[0] + (radiusInDegrees / cosLat), // maxLng
            center[1] + radiusInDegrees             // maxLat
        ];
    }

    /**
     * Calculate distance between two points using turf
     * @param {Array} point1 - First point [lng, lat]
     * @param {Array} point2 - Second point [lng, lat]
     * @param {Object} options - Turf distance options
     * @returns {number} Distance in specified units
     */
    calculateDistance(point1, point2, options = { units: 'kilometers' }) {
        return turf.distance(point1, point2, options);
    }

    /**
     * Calculate bearing between two points using turf
     * @param {Array} start - Start point [lng, lat]
     * @param {Array} end - End point [lng, lat]
     * @returns {number} Bearing in degrees
     */
    calculateBearing(start, end) {
        return turf.bearing(start, end);
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
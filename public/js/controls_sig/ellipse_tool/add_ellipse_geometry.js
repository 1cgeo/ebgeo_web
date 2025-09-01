// Path: js\controls_sig\ellipse_tool\add_ellipse_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';

/**
 * Ellipse Geometry Operations
 * Handles all geometric calculations and handle management for ellipse features
 * 
 * ✅ NOVO SISTEMA: 3 handles independentes - 2 para resize + 1 para rotação
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
     * Generate ellipse polygon geometry using turf.ellipse
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} majorRadius - Major radius in kilometers
     * @param {number} minorRadius - Minor radius in kilometers
     * @param {number} bearing - Bearing in degrees
     * @returns {Object} GeoJSON Polygon geometry
     */
    generateEllipseGeometry(center, majorRadius, minorRadius, bearing) {
        const options = {
            angle: bearing - 90, // Align major axis with bearing direction
            steps: 64,
            units: 'kilometers'
        };

        // Use turf.ellipse for accurate geodesic ellipse
        const ellipsePolygon = turf.ellipse(center, majorRadius, minorRadius, options);
        return ellipsePolygon.geometry;
    }

    /**
     * ✅ NOVO SISTEMA: Create 3 edit handles (2 red resize + 1 blue rotation)
     * @param {Object} feature - Ellipse feature
     * @returns {Array} Array of handle features [horizontalHandle, verticalHandle, rotationHandle]
     */
    createHandles(feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            console.error('Cannot create handles - invalid center');
            return [];
        }

        const { majorRadius, minorRadius, bearing } = feature.properties;
        const handles = [];

        // Handle 1: Horizontal Resize (Red) - extremidade direita da elipse
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
                handleType: 'vertex', // RED color in styling
                handleId: 'horizontal-resize',
                featureId: feature.properties.id,
                mode: 'ellipse_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Handle 2: Vertical Resize (Red) - extremidade superior da elipse
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
                handleType: 'vertex', // RED color in styling
                handleId: 'vertical-resize',
                featureId: feature.properties.id,
                mode: 'ellipse_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Handle 3: Rotation (Blue) - ponto intermediário para rotação
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
                handleType: 'eccentricity', // BLUE color in styling
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
     * ✅ CORRIGIDO: Calculate horizontal resize handle position (extremidade do eixo maior)
     * @param {Array} center - Center coordinates
     * @param {number} majorRadius - Major radius in kilometers
     * @param {number} minorRadius - Minor radius in kilometers
     * @param {number} bearing - Bearing in degrees
     * @returns {Array} Handle position coordinates
     */
    calculateHorizontalHandlePosition(center, majorRadius, minorRadius, bearing) {
        // Handle horizontal na direção do eixo maior da elipse
        return turf.destination(center, majorRadius, bearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * ✅ CORRIGIDO: Calculate vertical resize handle position (extremidade do eixo menor)
     * @param {Array} center - Center coordinates
     * @param {number} majorRadius - Major radius in kilometers
     * @param {number} minorRadius - Minor radius in kilometers
     * @param {number} bearing - Bearing in degrees
     * @returns {Array} Handle position coordinates
     */
    calculateVerticalHandlePosition(center, majorRadius, minorRadius, bearing) {
        // Handle vertical perpendicular ao eixo maior (bearing + 90°)
        const verticalBearing = bearing + 90;
        return turf.destination(center, minorRadius, verticalBearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * ✅ CORRIGIDO: Calculate rotation handle position (posicionado no eixo menor oposto)
     * @param {Array} center - Center coordinates
     * @param {number} majorRadius - Major radius in kilometers
     * @param {number} minorRadius - Minor radius in kilometers
     * @param {number} bearing - Bearing in degrees
     * @returns {Array} Handle position coordinates
     */
    calculateRotationHandlePosition(center, majorRadius, minorRadius, bearing) {
        // Handle de rotação posicionado no eixo menor, direção oposta ao handle vertical
        const rotationBearing = bearing - 90;
        return turf.destination(center, minorRadius, rotationBearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * ✅ MODIFICADO: Update ellipse geometry based on handle movement
     * @param {string} handleType - Type of handle ('horizontal-resize', 'vertical-resize', 'rotation')
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
                // Atualizar apenas a largura (majorRadius quando bearing = 0, ou calcular baseado na orientação)
                majorRadius = this.calculateHorizontalRadius(center, newPosition, bearing);
                break;

            case 'vertical-resize':
                // Atualizar apenas a altura (minorRadius quando bearing = 0, ou calcular baseado na orientação)
                minorRadius = this.calculateVerticalRadius(center, newPosition, bearing);
                break;

            case 'rotation':
                // Atualizar apenas o bearing, mantendo dimensões
                bearing = this.calculateRotationBearing(center, newPosition);
                break;

            default:
                console.warn('Unknown handle type for ellipse:', handleType);
                return null;
        }

        // Validate minimum radii
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
     * ✅ CORRIGIDO: Calculate new horizontal radius based on handle position
     * @param {Array} center - Center coordinates
     * @param {Array} newPosition - New handle position
     * @param {number} bearing - Current bearing (não usado, handle define diretamente)
     * @returns {number} New major radius
     */
    calculateHorizontalRadius(center, newPosition, bearing) {
        // Handle horizontal controla o majorRadius diretamente
        // A distância do centro ao handle é o novo majorRadius
        return turf.distance(center, newPosition, { units: 'kilometers' });
    }

    /**
     * ✅ CORRIGIDO: Calculate new vertical radius based on handle position
     * @param {Array} center - Center coordinates
     * @param {Array} newPosition - New handle position
     * @param {number} bearing - Current bearing (não usado, handle define diretamente)
     * @returns {number} New minor radius
     */
    calculateVerticalRadius(center, newPosition, bearing) {
        // Handle vertical controla o minorRadius diretamente
        // A distância do centro ao handle é o novo minorRadius
        return turf.distance(center, newPosition, { units: 'kilometers' });
    }

    /**
     * ✅ CORRIGIDO: Calculate new bearing based on rotation handle position
     * @param {Array} center - Center coordinates
     * @param {Array} newPosition - New rotation handle position
     * @returns {number} New bearing in degrees
     */
    calculateRotationBearing(center, newPosition) {
        // Como o handle está posicionado na direção bearing - 90°,
        // o bearing real é o ângulo do handle + 90°
        const handleBearing = turf.bearing(center, newPosition);
        return handleBearing + 90;
    }

    /**
     * ✅ MODIFICADO: Calculate preview geometry during handle dragging
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

        // Atualizar parâmetro baseado no tipo de handle
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

        // Validate minimum radii
        if (majorRadius < 0.01 || minorRadius < 0.01) {
            return null;
        }

        const previewGeometry = this.generateEllipseGeometry(center, majorRadius, minorRadius, bearing);

        // Calcular novas posições dos handles para o preview
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
     * ✅ MODIFICADO: Calculate ellipse dimensions from two points (always horizontal)
     * @param {Array} center - Center coordinates
     * @param {Array} endPoint - End point for major axis
     * @returns {Object} {majorRadius, bearing, minorRadius}
     */
    calculateInitialDimensions(center, endPoint) {
        const majorRadius = turf.distance(center, endPoint, { units: 'kilometers' });
        
        // ✅ CORREÇÃO: Bearing = 90° para elipse horizontal (leste-oeste)
        const bearing = 90;
        
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
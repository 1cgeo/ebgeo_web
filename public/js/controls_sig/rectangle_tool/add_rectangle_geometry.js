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
     * @param {number} borderRadius - Corner radius (0-10 scale, 0 = no rounding)
     * @param {number} bearing - Rotation angle in degrees (0 = aligned with lat/lng, optional)
     * @returns {Object} GeoJSON Polygon geometry
     */
    generate(corner1, corner2, borderRadius = 0, bearing = 0) {
        if (bearing && bearing !== 0) {
            const { center, width, height } = this.calculateDimensionsFromCorners(corner1, corner2);
            return this.generateRotatedRectangleGeometry(center, width, height, borderRadius, bearing);
        }
        
        // Comportamento original para retângulos sem rotação
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
        // Calcular os 4 cantos do retângulo não rotacionado (em offsets locais)
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        
        // Cantos em coordenadas locais (metros)
        const localCorners = [
            { x: halfWidth, y: halfHeight },    // Top-right
            { x: -halfWidth, y: halfHeight },   // Top-left
            { x: -halfWidth, y: -halfHeight },  // Bottom-left
            { x: halfWidth, y: -halfHeight }    // Bottom-right
        ];
        
        // Rotacionar e converter para coordenadas geográficas
        const rotatedCorners = localCorners.map(corner => 
            this.rotateAndTranslate(corner.x, corner.y, center, bearing)
        );
        
        // Se borderRadius > 0, adicionar arcos arredondados nos cantos
        if (borderRadius && borderRadius > 0) {
            return this.generateRoundedRotatedRectangle(rotatedCorners, center, borderRadius, width, height);
        }
        
        // Retângulo simples rotacionado
        rotatedCorners.push(rotatedCorners[0]); // Fechar o polígono
        
        return {
            type: 'Polygon',
            coordinates: [rotatedCorners]
        };
    }

    /**
     * ✅ NOVO: Rotate point and translate to geographic coordinates
     * @param {number} x - Local X offset in meters
     * @param {number} y - Local Y offset in meters
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} bearing - Rotation angle in degrees
     * @returns {Array} Rotated geographic coordinates [lng, lat]
     */
    rotateAndTranslate(x, y, center, bearing) {
        // Calcular distância e ângulo do offset local
        const distance = Math.sqrt(x * x + y * y) / 1000; // Converter para km
        const localAngle = Math.atan2(y, x) * 180 / Math.PI;
        
        // Ajustar ângulo: 0° = leste, 90° = norte (sistema de coordenadas do mapa)
        // bearing = 0° deve resultar em retângulo alinhado norte-sul
        const adjustedAngle = localAngle + bearing;
        
        // Usar turf.destination para precisão geodésica
        return turf.destination(center, distance, adjustedAngle, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * ✅ NOVO: Generate rounded corners for rotated rectangle
     * @param {Array} corners - Array of 4 corner coordinates
     * @param {Array} center - Center of rectangle
     * @param {number} borderRadius - Border radius (0-10 scale)
     * @param {number} width - Rectangle width in meters
     * @param {number} height - Rectangle height in meters
     * @returns {Object} GeoJSON Polygon with rounded corners
     */
    generateRoundedRotatedRectangle(corners, center, borderRadius, width, height) {
        const segmentsPerCorner = 8;
        const minDimension = Math.min(width, height);
        const radiusScale = borderRadius / 10;
        const effectiveRadius = minDimension * radiusScale * 0.5;
        const maxRadius = minDimension / 2;
        const radius = Math.min(effectiveRadius, maxRadius);
        
        const coordinates = [];
        
        // Para cada canto, adicionar arco arredondado
        for (let i = 0; i < corners.length; i++) {
            const corner = corners[i];
            const prevCorner = corners[(i + 3) % 4];
            const nextCorner = corners[(i + 1) % 4];
            
            // Calcular direções para os lados adjacentes
            const prevDir = this.normalizeDirection(prevCorner, corner);
            const nextDir = this.normalizeDirection(corner, nextCorner);
            
            // Ponto inicial do arco (deslocado do canto)
            const arcStart = this.offsetPoint(corner, prevDir, radius);
            coordinates.push(arcStart);
            
            // Adicionar arco arredondado
            const arcPoints = this.createArcPoints(corner, arcStart, nextDir, radius, segmentsPerCorner);
            coordinates.push(...arcPoints);
        }
        
        coordinates.push(coordinates[0]); // Fechar polígono
        
        return {
            type: 'Polygon',
            coordinates: [coordinates]
        };
    }

    /**
     * ✅ NOVO: Helper to normalize direction vector
     */
    normalizeDirection(from, to) {
        const dx = to[0] - from[0];
        const dy = to[1] - from[1];
        const length = Math.sqrt(dx * dx + dy * dy);
        return [dx / length, dy / length];
    }

    /**
     * ✅ NOVO: Helper to offset point
     */
    offsetPoint(point, direction, distance) {
        // Converter distância de metros para graus (aproximado)
        const distInDegrees = distance / 111320;
        return [
            point[0] + direction[0] * distInDegrees,
            point[1] + direction[1] * distInDegrees
        ];
    }

    /**
     * ✅ NOVO: Helper to create arc points for rounded corner
     */
    createArcPoints(corner, start, direction, radius, segments) {
        const points = [];
        const distInDegrees = radius / 111320;
        
        for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const angle = t * Math.PI / 2; // 90 graus
            const x = Math.cos(angle) * distInDegrees;
            const y = Math.sin(angle) * distInDegrees;
            
            points.push([
                start[0] + direction[0] * x,
                start[1] + direction[1] * y
            ]);
        }
        
        return points;
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
     * ✅ REFATORADO: Create edit handles - agora usa width-resize e height-resize (similar à elipse)
     * @param {Object} geometry - Rectangle geometry
     * @param {string} featureId - Feature ID
     * @param {number} bearing - Current bearing (rotation angle)
     * @param {Object} properties - Feature properties (usado quando há bearing)
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

        // Handle 1: Width resize (RED) - na direção do bearing
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
                handleType: 'vertex', // RED
                handleId: 'width-resize',
                featureId: featureId,
                mode: 'rectangle_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Handle 2: Height resize (RED) - perpendicular ao bearing (bearing + 90°)
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
                handleType: 'vertex', // RED
                handleId: 'height-resize',
                featureId: featureId,
                mode: 'rectangle_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Handle 3: Rotation (BLUE) - oposto ao height handle
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
                handleType: 'eccentricity', // BLUE
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
     * ✅ NOVO: Calculate width handle position (na direção do bearing)
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} width - Width in meters
     * @param {number} bearing - Current bearing
     * @returns {Array} Handle position coordinates
     */
    calculateWidthHandlePosition(center, width, bearing) {
        const distance = (width / 2) / 1000; // Converter para km
        return turf.destination(center, distance, bearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * ✅ NOVO: Calculate height handle position (perpendicular ao bearing - bearing + 90°)
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} height - Height in meters
     * @param {number} bearing - Current bearing
     * @returns {Array} Handle position coordinates
     */
    calculateHeightHandlePosition(center, height, bearing) {
        const heightBearing = bearing + 90;
        const distance = (height / 2) / 1000; // Converter para km
        return turf.destination(center, distance, heightBearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * ✅ CORRIGIDO: Calculate rotation handle position
     * Posicionado no lado OPOSTO ao height handle
     * Height está em bearing+90, então rotation em bearing-90 (ou bearing+270)
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} height - Height in meters
     * @param {number} bearing - Current bearing
     * @returns {Array} Handle position coordinates
     */
    calculateRotationHandlePosition(center, height, bearing) {
        // Rotation no lado OPOSTO ao height: bearing - 90 (ou bearing + 270)
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
     * ✅ NOVO: Calculate dimensions from corners considering rotation
     * Para retângulos rotacionados, usa a diagonal e o bearing para calcular dimensões corretas
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
        
        // Calcular a distância diagonal entre os corners
        const diagonalDistance = turf.distance(corner1, corner2, { units: 'kilometers' }) * 1000; // em metros
        
        // Calcular o ângulo da diagonal
        const diagonalBearing = turf.bearing(corner2, corner1);
        
        // A diferença entre o bearing da diagonal e o bearing do retângulo nos dá o ângulo interno
        const angleDiff = (diagonalBearing - bearing) * Math.PI / 180;
        
        // Com a diagonal e o ângulo, calcular width e height
        // diagonal² = width² + height²
        // tan(angle) = height / width
        // Portanto: width = diagonal * cos(angle), height = diagonal * sin(angle)
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
     * ✅ REFATORADO: Update rectangle geometry based on handle movement
     * Agora usa width-resize, height-resize e rotation (similar à elipse)
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
                // Atualizar apenas a largura, mantendo altura e bearing
                width = this.calculateWidthFromHandle(center, newPosition, bearing) * 2;
                break;

            case 'height-resize':
                // Atualizar apenas a altura, mantendo largura e bearing
                height = this.calculateHeightFromHandle(center, newPosition, bearing) * 2;
                break;

            case 'rotation':
                // Atualizar apenas o bearing, mantendo dimensões
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

        // Recalcular corners com as novas dimensões
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
     * ✅ NOVO: Calculate width from handle position
     * @param {Array} center - Center coordinates
     * @param {Array} newPosition - New handle position
     * @param {number} bearing - Current bearing (não usado, handle define diretamente)
     * @returns {number} New half-width (distance from center to handle)
     */
    calculateWidthFromHandle(center, newPosition, bearing) {
        // A distância do centro ao handle é metade da largura
        return turf.distance(center, newPosition, { units: 'kilometers' }) * 1000; // em metros
    }

    /**
     * ✅ NOVO: Calculate height from handle position
     * @param {Array} center - Center coordinates
     * @param {Array} newPosition - New handle position
     * @param {number} bearing - Current bearing (não usado, handle define diretamente)
     * @returns {number} New half-height (distance from center to handle)
     */
    calculateHeightFromHandle(center, newPosition, bearing) {
        // A distância do centro ao handle é metade da altura
        return turf.distance(center, newPosition, { units: 'kilometers' }) * 1000; // em metros
    }

    /**
     * ✅ CORRIGIDO: Calculate bearing from rotation handle position
     * Handle está posicionado em bearing-90, então precisa compensar adicionando 90
     * @param {Array} center - Center coordinates
     * @param {Array} handlePosition - Rotation handle position
     * @returns {number} New bearing in degrees
     */
    calculateBearingFromRotationHandle(center, handlePosition) {
        const handleBearing = turf.bearing(center, handlePosition);
        // Handle foi posicionado em bearing-90, então compensar adicionando 90
        return handleBearing + 90;
    }

    /**
     * ✅ REFATORADO: Calculate preview geometry during handle dragging
     * Agora usa width-resize, height-resize e rotation
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

        // Atualizar parâmetro baseado no tipo de handle
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

        // Calcular novas posições dos handles para o preview
        const widthHandlePos = this.calculateWidthHandlePosition(center, width, bearing);
        const heightHandlePos = this.calculateHeightHandlePosition(center, height, bearing);
        const rotationHandlePos = this.calculateRotationHandlePosition(center, height, bearing);

        // Recalcular corners para manter compatibilidade
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
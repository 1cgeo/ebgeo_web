// Path: js/military_tools/boundary_tool/add_boundary_geometry.js

import { BaseGeometry } from '../../tool_manager';

/**
 * Boundary Geometry Operations
 * Handles all geometric calculations for boundary features including:
 * - Complex multi-line geometry with gaps for symbols
 * - Echelon symbols (X, I, o combinations)
 * - Multiple handle types (vertex, midpoint, symbol, size, text distance)
 * - Dependent features (circles, texts)
 */
class AddBoundaryGeometry extends BaseGeometry {
    // ===== GEOMETRY CONSTANTS =====
    static GEOMETRY_CONSTANTS = {
        MIN_DISTANCE_METERS: 5,
        MIN_LENGTH_KM: 0.001,           // Minimum line length for processing
        MIN_SIZE_KM: 0.05,              // Minimum symbol size (matches control)
        SYMBOL_WIDTH_MULTIPLIER: 1.5,   // Symbol width = numSymbols * size * this
        GAP_WIDTH_MULTIPLIER: 1.2,      // Gap width = symbolWidth * this
        SYMBOL_SPACING_MULTIPLIER: 1.5, // Spacing between symbols
        VERTICAL_OFFSET_DIVISOR: 1.5,   // For I symbol positioning
        SYMBOL_POSITION_EPSILON: 0.01,  // Small distance for handle placement
        TEXT_DISTANCE_MIN: 0.1,         // Minimum text distance ratio
        TEXT_DISTANCE_MAX: 3.0,         // Maximum text distance ratio
        POSITION_RATIO_MIN: 0.01,       // Minimum position ratio
        POSITION_RATIO_MAX: 0.99        // Maximum position ratio
    };

    constructor(properties = {}) {
        super(properties);
        this.MIN_DISTANCE_METERS = AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_DISTANCE_METERS;
    }

    /**
     * Generate boundary geometry with symbols and gaps
     * @param {Object} properties - Boundary properties including baseCoordinates
     * @returns {Object} GeoJSON MultiLineString geometry
     */
    generate(properties) {
        return this.generateBoundaryGeometry(properties);
    }

    /**
     * Validate boundary parameters
     * @param {Array} coordinates - Base coordinates array
     * @returns {boolean} True if valid
     */
    validate(coordinates) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            return false;
        }

        const validCoords = coordinates.filter(coord =>
            Array.isArray(coord) &&
            coord.length >= 2 &&
            typeof coord[0] === 'number' &&
            typeof coord[1] === 'number' &&
            !isNaN(coord[0]) &&
            !isNaN(coord[1])
        );

        return validCoords.length >= 2;
    }

    /**
     * Normalize base coordinates from various formats
     * @param {string|Array} coords - Coordinates to normalize
     * @returns {Array|null} Normalized coordinates or null if invalid
     */
    normalizeBaseCoordinates(coords) {
        if (!coords) {
            console.warn('baseCoordinates is null or undefined');
            return null;
        }

        if (Array.isArray(coords)) {
            const isValidArray = coords.every(coord =>
                Array.isArray(coord) &&
                coord.length >= 2 &&
                typeof coord[0] === 'number' &&
                typeof coord[1] === 'number' &&
                !isNaN(coord[0]) &&
                !isNaN(coord[1])
            );

            if (isValidArray) {
                return coords;
            } else {
                console.warn('baseCoordinates array contains invalid coordinates:', coords);
                return null;
            }
        }

        if (typeof coords === 'string') {
            try {
                const parsed = JSON.parse(coords);
                if (Array.isArray(parsed)) {
                    return this.normalizeBaseCoordinates(parsed);
                } else {
                    console.warn('Parsed baseCoordinates is not an array:', parsed);
                    return null;
                }
            } catch (e) {
                console.error('Error parsing baseCoordinates string:', coords, e);
                return null;
            }
        }

        console.warn('baseCoordinates is neither array nor string:', typeof coords, coords);
        return null;
    }

    /**
     * Check if point is too close to existing points
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
     * Generate main boundary geometry with gaps for symbols
     * @param {Object} properties - Feature properties
     * @returns {Object} GeoJSON MultiLineString geometry
     */
    generateBoundaryGeometry(properties) {
        let { baseCoordinates, symbol_position_ratio, symbol_size, echelon } = properties;

        baseCoordinates = this.normalizeBaseCoordinates(baseCoordinates);

        if (!baseCoordinates || baseCoordinates.length < 2) {
            console.warn('Invalid baseCoordinates for boundary:', baseCoordinates);
            return {
                type: 'LineString',
                coordinates: baseCoordinates || [[0, 0], [0, 0]]
            };
        }

        const hasValidCoords = baseCoordinates.every(coord =>
            Array.isArray(coord) &&
            coord.length >= 2 &&
            typeof coord[0] === 'number' &&
            typeof coord[1] === 'number' &&
            !isNaN(coord[0]) &&
            !isNaN(coord[1])
        );

        if (!hasValidCoords) {
            console.warn('Invalid coordinates detected in boundary:', baseCoordinates);
            return {
                type: 'LineString',
                coordinates: [[0, 0], [1, 1]]
            };
        }

        try {
            const lineWithGap = this.createLineWithGap(baseCoordinates, symbol_position_ratio, symbol_size, echelon);
            const symbolLines = this.createEchelonSymbolLines(baseCoordinates, symbol_position_ratio, symbol_size, echelon);
            const allLines = [...lineWithGap, ...symbolLines];

            if (allLines.length === 0) {
                return {
                    type: 'LineString',
                    coordinates: baseCoordinates
                };
            }

            return {
                type: 'MultiLineString',
                coordinates: allLines
            };

        } catch (error) {
            console.warn('Error generating boundary geometry:', error);
            return {
                type: 'LineString',
                coordinates: baseCoordinates
            };
        }
    }

    /**
     * Create line segments with gap for symbol placement
     * @param {Array} coordinates - Base coordinates
     * @param {number} ratio - Symbol position ratio
     * @param {number} symbolSize - Symbol size
     * @param {string} echelon - Echelon string
     * @returns {Array} Array of line coordinate arrays
     */
    createLineWithGap(coordinates, ratio, symbolSize, echelon) {
        if (coordinates.length < 2) return [];

        const validCoords = coordinates.filter(coord =>
            Array.isArray(coord) && coord.length >= 2 &&
            !isNaN(coord[0]) && !isNaN(coord[1])
        );

        if (validCoords.length < 2) {
            console.warn('Insufficient valid coordinates for line with gap');
            return [coordinates];
        }

        try {
            const line = turf.lineString(validCoords);
            const totalLength = turf.length(line, { units: 'kilometers' });

            if (totalLength < AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_LENGTH_KM) {
                return [validCoords];
            }

            const numSymbols = (echelon && echelon.length > 0) ? echelon.length : 3;
            const symbolWidth = numSymbols * symbolSize * AddBoundaryGeometry.GEOMETRY_CONSTANTS.SYMBOL_WIDTH_MULTIPLIER;
            const gapWidth = symbolWidth * AddBoundaryGeometry.GEOMETRY_CONSTANTS.GAP_WIDTH_MULTIPLIER;
            const centerDistance = totalLength * ratio;

            const gapStartDistance = Math.max(0, centerDistance - (gapWidth / 2));
            const gapEndDistance = Math.min(totalLength, centerDistance + (gapWidth / 2));

            const segments = [];

            if (gapStartDistance > AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_LENGTH_KM) {
                const startPoint = turf.point(validCoords[0]);
                const gapStartPoint = turf.along(line, gapStartDistance, { units: 'kilometers' });
                const segment1 = turf.lineSlice(startPoint, gapStartPoint, line);

                if (segment1.geometry.coordinates.length >= 2) {
                    segments.push(segment1.geometry.coordinates);
                }
            }

            if (gapEndDistance < totalLength - AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_LENGTH_KM) {
                const gapEndPoint = turf.along(line, gapEndDistance, { units: 'kilometers' });
                const endPoint = turf.point(validCoords[validCoords.length - 1]);
                const segment2 = turf.lineSlice(gapEndPoint, endPoint, line);

                if (segment2.geometry.coordinates.length >= 2) {
                    segments.push(segment2.geometry.coordinates);
                }
            }

            return segments.length > 0 ? segments : [validCoords];
        } catch (error) {
            console.warn('Error creating line with gap:', error);
            return [validCoords];
        }
    }

    /**
     * Create symbol lines for echelon
     * @param {Array} coordinates - Base coordinates
     * @param {number} ratio - Symbol position ratio
     * @param {number} size - Symbol size
     * @param {string} echelon - Echelon string
     * @returns {Array} Array of symbol line coordinate arrays
     */
    createEchelonSymbolLines(coordinates, ratio, size, echelon) {
        if (coordinates.length < 2) return [];

        const validCoords = coordinates.filter(coord =>
            Array.isArray(coord) && coord.length >= 2 &&
            !isNaN(coord[0]) && !isNaN(coord[1])
        );

        if (validCoords.length < 2) {
            console.warn('Insufficient valid coordinates for echelon symbols');
            return [];
        }

        try {
            const line = turf.lineString(validCoords);
            const totalLength = turf.length(line, { units: 'kilometers' });

            if (totalLength < AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_LENGTH_KM) {
                return [];
            }

            const centerPoint = turf.along(line, totalLength * ratio, { units: 'kilometers' });

            const distance1 = Math.max(AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_LENGTH_KM, totalLength * ratio - AddBoundaryGeometry.GEOMETRY_CONSTANTS.SYMBOL_POSITION_EPSILON);
            const distance2 = Math.min(totalLength - AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_LENGTH_KM, totalLength * ratio + AddBoundaryGeometry.GEOMETRY_CONSTANTS.SYMBOL_POSITION_EPSILON);

            const p1 = turf.along(line, distance1, { units: 'kilometers' });
            const p2 = turf.along(line, distance2, { units: 'kilometers' });
            const localBearing = turf.bearing(p1, p2);

            const { lines } = this.createEchelonSymbol(echelon, centerPoint, size, localBearing);
            return lines;
        } catch (error) {
            console.warn('Error creating echelon symbol lines:', error);
            return [];
        }
    }

    /**
     * Create individual echelon symbol
     * @param {string} echelon - Echelon string (X, I, o combinations)
     * @param {Object} centerPoint - Center point feature
     * @param {number} size - Symbol size
     * @param {number} bearing - Local bearing in degrees
     * @returns {Object} Object with lines and polygons arrays
     */
    createEchelonSymbol(echelon, centerPoint, size, bearing) {
        const symbolLines = [];
        const polygons = [];
        const numSymbols = echelon.length;
        const spacing = size * AddBoundaryGeometry.GEOMETRY_CONSTANTS.SYMBOL_SPACING_MULTIPLIER;
        const totalWidth = (numSymbols - 1) * spacing;
        const firstSymbolBearing = bearing;
        const firstSymbolCenter = turf.destination(centerPoint, -totalWidth / 2, firstSymbolBearing, { units: 'kilometers' });

        for (let i = 0; i < numSymbols; i++) {
            const currentCenter = turf.destination(firstSymbolCenter, i * spacing, firstSymbolBearing, { units: 'kilometers' });
            const symbolType = echelon.charAt(i);

            switch (symbolType) {
                case 'X': {
                    const xAngle1 = 45;
                    const p1_start = turf.destination(currentCenter, size / 2, bearing + xAngle1, { units: 'kilometers' });
                    const p1_end = turf.destination(currentCenter, size / 2, bearing + xAngle1 + 180, { units: 'kilometers' });
                    symbolLines.push([p1_start.geometry.coordinates, p1_end.geometry.coordinates]);

                    const xAngle2 = -45;
                    const p2_start = turf.destination(currentCenter, size / 2, bearing + xAngle2, { units: 'kilometers' });
                    const p2_end = turf.destination(currentCenter, size / 2, bearing + xAngle2 + 180, { units: 'kilometers' });
                    symbolLines.push([p2_start.geometry.coordinates, p2_end.geometry.coordinates]);
                    break;
                }
                case 'I': {
                    const iAngle = bearing - 90;
                    const p_top = turf.destination(currentCenter, size / AddBoundaryGeometry.GEOMETRY_CONSTANTS.VERTICAL_OFFSET_DIVISOR, iAngle, { units: 'kilometers' });
                    const p_bottom = turf.destination(currentCenter, -size / AddBoundaryGeometry.GEOMETRY_CONSTANTS.VERTICAL_OFFSET_DIVISOR, iAngle, { units: 'kilometers' });
                    symbolLines.push([p_top.geometry.coordinates, p_bottom.geometry.coordinates]);
                    break;
                }
                case 'o': {
                    const circle = turf.circle(currentCenter, size / 4, { steps: 32, units: 'kilometers' });
                    polygons.push(circle);
                    break;
                }
            }
        }
        return { lines: symbolLines, polygons: polygons };
    }

    /**
     * Generate circles for 'o' symbols in echelon
     * @param {Object} boundaryFeature - Boundary feature
     * @returns {Array} Array of circle features
     */
    generateBoundaryCircles(boundaryFeature) {
        const circles = [];
        const { echelon, symbol_position_ratio, symbol_size } = boundaryFeature.properties;

        // Normalize baseCoordinates to handle string format from persistence
        const baseCoordinates = this.normalizeBaseCoordinates(boundaryFeature.properties.baseCoordinates);

        if (!echelon || !echelon.includes('o') || !baseCoordinates || baseCoordinates.length < 2) {
            return circles;
        }

        try {
            const line = turf.lineString(baseCoordinates);
            const totalLength = turf.length(line, { units: 'kilometers' });
            const centerPoint = turf.along(line, totalLength * symbol_position_ratio, { units: 'kilometers' });

            const p1 = turf.along(line, totalLength * symbol_position_ratio - 0.01, { units: 'kilometers' });
            const p2 = turf.along(line, totalLength * symbol_position_ratio + 0.01, { units: 'kilometers' });
            const localBearing = turf.bearing(p1, p2);

            const { polygons } = this.createEchelonSymbol(echelon, centerPoint, symbol_size, localBearing);

            polygons.forEach((polygon, index) => {
                circles.push({
                    type: 'Feature',
                    id: `${boundaryFeature.properties.id}-circle-${index}`,
                    geometry: polygon.geometry,
                    properties: {
                        parent: boundaryFeature.properties.id,
                        color: boundaryFeature.properties.color,
                        opacity: boundaryFeature.properties.opacity,
                        source: 'boundary-circle'
                    }
                });
            });
        } catch (error) {
            console.warn('Error generating boundary circles:', error);
        }

        return circles;
    }

    /**
     * Generate text features for boundary
     * @param {Object} boundaryFeature - Boundary feature
     * @returns {Array} Array of text features
     */
    generateBoundaryTexts(boundaryFeature) {
        const textFeatures = [];
        const { text_top, text_bottom, text_size, symbol_position_ratio, symbol_size, text_distance_ratio } = boundaryFeature.properties;

        // Normalize baseCoordinates to handle string format from persistence
        const baseCoordinates = this.normalizeBaseCoordinates(boundaryFeature.properties.baseCoordinates);

        if ((!text_top && !text_bottom) || !baseCoordinates || baseCoordinates.length < 2) {
            return textFeatures;
        }

        try {
            const line = turf.lineString(baseCoordinates);
            const totalLength = turf.length(line, { units: 'kilometers' });
            const centerPoint = turf.along(line, totalLength * symbol_position_ratio, { units: 'kilometers' });

            const p1 = turf.along(line, totalLength * symbol_position_ratio - 0.01, { units: 'kilometers' });
            const p2 = turf.along(line, totalLength * symbol_position_ratio + 0.01, { units: 'kilometers' });
            const localBearing = turf.bearing(p1, p2);

            const labelOffset = symbol_size * (text_distance_ratio || 0.9);
            const textPlacementBearing = localBearing - 90;
            const textRotation = (localBearing <= 0 || localBearing >= 180) ? localBearing + 90 : localBearing - 90;

            if (text_top) {
                const pTop = turf.destination(centerPoint, labelOffset, textPlacementBearing, { units: 'kilometers' });
                textFeatures.push({
                    type: 'Feature',
                    id: `${boundaryFeature.properties.id}-text-top`,
                    geometry: {
                        type: 'Point',
                        coordinates: pTop.geometry.coordinates
                    },
                    properties: {
                        parent: boundaryFeature.properties.id,
                        text: text_top,
                        rotation: textRotation,
                        text_size: text_size,
                        color: boundaryFeature.properties.color,
                        source: 'boundary-text'
                    }
                });
            }

            if (text_bottom) {
                const pBottom = turf.destination(centerPoint, -labelOffset, textPlacementBearing, { units: 'kilometers' });
                textFeatures.push({
                    type: 'Feature',
                    id: `${boundaryFeature.properties.id}-text-bottom`,
                    geometry: {
                        type: 'Point',
                        coordinates: pBottom.geometry.coordinates
                    },
                    properties: {
                        parent: boundaryFeature.properties.id,
                        text: text_bottom,
                        rotation: textRotation,
                        text_size: text_size,
                        color: boundaryFeature.properties.color,
                        source: 'boundary-text'
                    }
                });
            }
        } catch (error) {
            console.warn('Error generating boundary texts:', error);
        }

        return textFeatures;
    }

    /**
     * Create edit handles for boundary
     * @param {Object} feature - Boundary feature
     * @returns {Array} Array of handle features
     */
    createHandles(feature) {
        const handles = [];
        if (!feature || !feature.properties.baseCoordinates) return handles;

        const coordinates = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const id = feature.properties.id;

        if (!coordinates || coordinates.length < 2) {
            console.warn('Invalid coordinates for control points:', coordinates);
            return [];
        }

        const validCoords = coordinates.filter(coord =>
            Array.isArray(coord) &&
            coord.length >= 2 &&
            !isNaN(coord[0]) &&
            !isNaN(coord[1])
        );

        if (validCoords.length < 2) {
            console.warn('Insufficient valid coordinates for control points');
            return [];
        }

        validCoords.forEach((coord, index) => {
            const handleId = `boundary-handle-${id}-vertex-${index}`;
            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: {
                    type: 'Point',
                    coordinates: coord
                },
                properties: {
                    parent: id,
                    index: index,
                    type: 'vertex',
                    role: 'handle',
                    handleType: 'vertex',
                    featureId: id,
                    mode: 'boundary_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        for (let i = 0; i < validCoords.length - 1; i++) {
            try {
                const midpoint = turf.midpoint(turf.point(validCoords[i]), turf.point(validCoords[i + 1]));
                const handleId = `boundary-handle-${id}-midpoint-${i}`;
                handles.push({
                    type: 'Feature',
                    id: handleId,
                    geometry: midpoint.geometry,
                    properties: {
                        parent: id,
                        index: i + 1,
                        type: 'midpoint',
                        role: 'handle',
                        handleType: 'midpoint',
                        featureId: id,
                        mode: 'boundary_editing',
                        meta: 'midpoint',
                        user_isEditingHandle: true
                    }
                });
            } catch (error) {
                console.warn(`Error creating midpoint handle ${i}:`, error);
            }
        }

        try {
            const ratio = feature.properties.symbol_position_ratio || 0.5;
            const line = turf.lineString(validCoords);
            const totalLength = turf.length(line, { units: 'kilometers' });

            if (totalLength > AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_LENGTH_KM) {
                const symbolPoint = turf.along(line, totalLength * ratio, { units: 'kilometers' });
                const symbolHandleId = `boundary-handle-${id}-symbol`;
                handles.push({
                    type: 'Feature',
                    id: symbolHandleId,
                    geometry: {
                        type: 'Point',
                        coordinates: symbolPoint.geometry.coordinates
                    },
                    properties: {
                        parent: id,
                        type: 'symbol_handle',
                        role: 'handle',
                        handleType: 'symbol_handle',
                        featureId: id,
                        mode: 'boundary_editing',
                        meta: 'vertex',
                        user_isEditingHandle: true
                    }
                });

                const size = feature.properties.symbol_size || 2;
                const distance1 = Math.max(AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_LENGTH_KM, totalLength * ratio - AddBoundaryGeometry.GEOMETRY_CONSTANTS.SYMBOL_POSITION_EPSILON);
                const distance2 = Math.min(totalLength - AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_LENGTH_KM, totalLength * ratio + AddBoundaryGeometry.GEOMETRY_CONSTANTS.SYMBOL_POSITION_EPSILON);

                const p1 = turf.along(line, distance1, { units: 'kilometers' });
                const p2 = turf.along(line, distance2, { units: 'kilometers' });
                const localBearing = turf.bearing(p1, p2);
                const sizeHandlePoint = turf.destination(symbolPoint, size / 2, localBearing + 45, { units: 'kilometers' });
                const sizeHandleId = `boundary-handle-${id}-size`;
                handles.push({
                    type: 'Feature',
                    id: sizeHandleId,
                    geometry: {
                        type: 'Point',
                        coordinates: sizeHandlePoint.geometry.coordinates
                    },
                    properties: {
                        parent: id,
                        type: 'size_handle',
                        role: 'handle',
                        handleType: 'size_handle',
                        featureId: id,
                        mode: 'boundary_editing',
                        meta: 'vertex',
                        user_isEditingHandle: true
                    }
                });

                const hasText = (feature.properties.text_top || feature.properties.text_bottom);
                if (hasText) {
                    const textDistanceRatio = feature.properties.text_distance_ratio || 0.8;
                    const textOffset = (feature.properties.symbol_size || 2) * textDistanceRatio;
                    const textPlacementBearing = localBearing - 90;
                    const textDistanceHandlePoint = turf.destination(symbolPoint, textOffset, textPlacementBearing, { units: 'kilometers' });
                    const textDistanceHandleId = `boundary-handle-${id}-text-distance`;
                    handles.push({
                        type: 'Feature',
                        id: textDistanceHandleId,
                        geometry: {
                            type: 'Point',
                            coordinates: textDistanceHandlePoint.geometry.coordinates
                        },
                        properties: {
                            parent: id,
                            type: 'text_distance_handle',
                            role: 'handle',
                            handleType: 'text_distance_handle',
                            featureId: id,
                            mode: 'boundary_editing',
                            meta: 'vertex',
                            user_isEditingHandle: true
                        }
                    });
                }
            }
        } catch (error) {
            console.warn('Error creating symbol handles:', error);
        }

        return handles;
    }

    /**
     * Update boundary geometry from handle interaction
     * @param {string} handleType - Type of handle being moved
     * @param {Array} newPosition - New position [lng, lat]
     * @param {Object} feature - Feature being edited
     * @param {number} handleIndex - Index for vertex/midpoint handles
     * @returns {Object} Updated properties and geometry
     */
    updateFromHandle(handleType, newPosition, feature, handleIndex = null) {
        if (!newPosition || !Array.isArray(newPosition) || newPosition.length < 2 ||
            typeof newPosition[0] !== 'number' || typeof newPosition[1] !== 'number' ||
            isNaN(newPosition[0]) || isNaN(newPosition[1])) {
            console.warn('Invalid newPosition for handle update:', newPosition);
            return null;
        }

        if (!feature || !feature.properties) {
            console.warn('Invalid feature for handle update');
            return null;
        }

        if (!handleType) {
            console.warn('Invalid handleType for boundary update:', handleType);
            return null;
        }

        let coordinates = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coordinates || coordinates.length < 2) {
            console.warn('Invalid coordinates for handle update:', feature.properties.baseCoordinates);
            return null;
        }

        coordinates = [...coordinates];
        const updatedProperties = { ...feature.properties };

        switch (handleType) {
            case 'size_handle': {
                const ratio = feature.properties.symbol_position_ratio || 0.5;
                const line = turf.lineString(coordinates);
                const totalLength = turf.length(line, { units: 'kilometers' });
                const centerPoint = turf.along(line, totalLength * ratio, { units: 'kilometers' });
                const newSize = turf.distance(centerPoint, turf.point(newPosition), { units: 'kilometers' }) * 2;
                updatedProperties.symbol_size = Math.max(AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_SIZE_KM, newSize);
                break;
            }

            case 'symbol_handle': {
                const symbolLine = turf.lineString(coordinates);
                const pointOnLine = turf.nearestPointOnLine(symbolLine, turf.point(newPosition), { units: 'kilometers' });
                const distance = pointOnLine.properties.location;
                const symbolTotalLength = turf.length(symbolLine, { units: 'kilometers' });
                updatedProperties.symbol_position_ratio = Math.max(AddBoundaryGeometry.GEOMETRY_CONSTANTS.POSITION_RATIO_MIN, Math.min(AddBoundaryGeometry.GEOMETRY_CONSTANTS.POSITION_RATIO_MAX, distance / symbolTotalLength));
                break;
            }

            case 'text_distance_handle': {
                const textRatio = feature.properties.symbol_position_ratio || 0.5;
                const textLine = turf.lineString(coordinates);
                const textTotalLength = turf.length(textLine, { units: 'kilometers' });
                const textCenterPoint = turf.along(textLine, textTotalLength * textRatio, { units: 'kilometers' });
                const newDistance = turf.distance(textCenterPoint, turf.point(newPosition), { units: 'kilometers' });
                const symbolSize = feature.properties.symbol_size || 2;
                const newRatio = newDistance / symbolSize;
                updatedProperties.text_distance_ratio = Math.max(AddBoundaryGeometry.GEOMETRY_CONSTANTS.TEXT_DISTANCE_MIN, Math.min(AddBoundaryGeometry.GEOMETRY_CONSTANTS.TEXT_DISTANCE_MAX, newRatio));
                break;
            }

            case 'vertex':
                if (handleIndex !== null && handleIndex < coordinates.length) {
                    coordinates[handleIndex] = newPosition;
                    updatedProperties.baseCoordinates = coordinates;
                }
                break;

            case 'midpoint':
                if (handleIndex !== null && handleIndex <= coordinates.length) {
                    coordinates.splice(handleIndex, 0, newPosition);
                    updatedProperties.baseCoordinates = coordinates;
                }
                break;

            default:
                console.warn('Unknown handle type for boundary:', handleType);
                return null;
        }

        const updatedGeometry = this.generateBoundaryGeometry(updatedProperties);

        return {
            properties: updatedProperties,
            geometry: updatedGeometry
        };
    }

    /**
     * Get bounding box for boundary
     * @param {Array} coordinates - Base coordinates
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates) {
        if (!coordinates || coordinates.length === 0) {
            return [0, 0, 0, 0];
        }

        const validCoords = coordinates.filter(coord =>
            Array.isArray(coord) && coord.length >= 2 &&
            !isNaN(coord[0]) && !isNaN(coord[1])
        );

        if (validCoords.length === 0) {
            return [0, 0, 0, 0];
        }

        const lngs = validCoords.map(coord => coord[0]);
        const lats = validCoords.map(coord => coord[1]);

        return [
            Math.min(...lngs),
            Math.min(...lats),
            Math.max(...lngs),
            Math.max(...lats)
        ];
    }

    /**
     * Check if coordinates represent a valid boundary
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid boundary
     */
    isValidBoundary(coordinates) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            return false;
        }

        return coordinates.every(coord =>
            Array.isArray(coord) &&
            coord.length >= 2 &&
            typeof coord[0] === 'number' &&
            typeof coord[1] === 'number' &&
            !isNaN(coord[0]) &&
            !isNaN(coord[1])
        );
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

        // Boundaries must have at least 2 vertices
        if (newCoordinates.length < 2) {
            return null;
        }

        return newCoordinates;
    }
}

export default AddBoundaryGeometry;

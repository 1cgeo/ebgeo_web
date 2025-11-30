// Path: js/controls_sig/arrow_tool/add_arrow_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';

/**
 * Arrow Geometry Operations
 * Handles all geometric calculations and handle management for arrow features
 */
class AddArrowGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
        this.MIN_DISTANCE_METERS = 10;
    }

    /**
     * Generate arrow geometry from base coordinates and properties
     * @param {Array} baseCoordinates - Array of [lng, lat] coordinates
     * @param {Object} properties - Arrow properties (width, headLength, etc.)
     * @returns {Object} GeoJSON geometry (Polygon or MultiPolygon)
     */
    generate(baseCoordinates, properties = {}) {
        const coords = this.normalizeBaseCoordinates(baseCoordinates);
        const width = properties.width || 1000;
        const headLengthRatio = properties.headLengthRatio || 1.5;
        const showArrowHead = properties.showArrowHead !== false;
        const airmobile = properties.airmobile || false;
        const airmobilePosition = properties.airmobilePosition || 0.7;

        if (coords.length < 2) {
            console.warn('Insufficient coordinates for arrow:', coords);
            return null;
        }

        const absHalfBodyWidth = Math.abs(width / 2);

        try {
            const mainLine = turf.lineString(coords);

            if (airmobile) {
                return this.generateAirmobileArrowGeometry(
                    mainLine, width, headLengthRatio, airmobilePosition, showArrowHead
                );
            }

            return this.generateNormalArrowGeometry(
                mainLine, width, headLengthRatio, absHalfBodyWidth, showArrowHead
            );

        } catch (error) {
            console.warn('Error generating arrow geometry:', error);
            return {
                type: 'LineString',
                coordinates: coords
            };
        }
    }

    /**
     * Generate normal (non-airmobile) arrow geometry
     */
    generateNormalArrowGeometry(mainLine, width, headLengthRatio, absHalfBodyWidth, showArrowHead) {
        const coords = mainLine.geometry.coordinates;
        
        // Create body offset lines
        const leftLine = turf.lineOffset(mainLine, absHalfBodyWidth, { units: 'meters' });
        const rightLine = turf.lineOffset(mainLine, -absHalfBodyWidth, { units: 'meters' });

        const p_last = coords[coords.length - 1];
        const p_second_last = coords[coords.length - 2];
        const bearing = turf.bearing(p_second_last, p_last);

        // If no arrow head, return rectangular body
        if (!showArrowHead) {
            const arrowPolygonCoords = [];
            
            arrowPolygonCoords.push(...leftLine.geometry.coordinates);
            const rightLineReversed = [...rightLine.geometry.coordinates].reverse();
            arrowPolygonCoords.push(...rightLineReversed);
            arrowPolygonCoords.push(arrowPolygonCoords[0]);

            return {
                type: 'Polygon',
                coordinates: [arrowPolygonCoords]
            };
        }

        // Calculate arrow head dimensions
        const absHeadBaseWidth = Math.abs(width * 2.5);
        const headLength = absHeadBaseWidth * headLengthRatio;

        // Calculate head corner points
        const perpendicularBearingLeft = bearing - 90;
        const perpendicularBearingRight = bearing + 90;
        const headCornerLeft = turf.destination(p_last, absHeadBaseWidth / 2, perpendicularBearingLeft, { units: 'meters' });
        const headCornerRight = turf.destination(p_last, absHeadBaseWidth / 2, perpendicularBearingRight, { units: 'meters' });
        const headTip = turf.destination(p_last, headLength, bearing, { units: 'meters' });

        // Create polygon with arrow head
        const arrowPolygonCoords = [];
        
        arrowPolygonCoords.push(...leftLine.geometry.coordinates);
        arrowPolygonCoords.push(headCornerRight.geometry.coordinates);
        arrowPolygonCoords.push(headTip.geometry.coordinates);
        arrowPolygonCoords.push(headCornerLeft.geometry.coordinates);
        
        const rightLineReversed = [...rightLine.geometry.coordinates].reverse();
        arrowPolygonCoords.push(...rightLineReversed);
        arrowPolygonCoords.push(arrowPolygonCoords[0]);

        return {
            type: 'Polygon',
            coordinates: [arrowPolygonCoords]
        };
    }

    /**
     * Generate airmobile arrow geometry (crossed pattern)
     */
    generateAirmobileArrowGeometry(mainLine, width, headLengthRatio, airmobilePosition, showArrowHead) {
        const coords = mainLine.geometry.coordinates;
        const absHalfBodyWidth = Math.abs(width / 2);
        const mainLineLength = turf.length(mainLine, { units: 'meters' });

        try {
            // Create full offset lines
            const fullLeftLine = turf.lineOffset(mainLine, absHalfBodyWidth, { units: 'meters' });
            const fullRightLine = turf.lineOffset(mainLine, -absHalfBodyWidth, { units: 'meters' });

            // Find crossover point
            const pointOnMainLine = turf.along(mainLine, mainLineLength * airmobilePosition, { units: 'meters' });
            const crossoverLeftPoint = turf.nearestPointOnLine(fullLeftLine, pointOnMainLine, { units: 'meters' });
            const crossoverRightPoint = turf.nearestPointOnLine(fullRightLine, pointOnMainLine, { units: 'meters' });

            // Slice lines at crossover points
            const left1 = turf.lineSlice(turf.point(fullLeftLine.geometry.coordinates[0]), crossoverLeftPoint, fullLeftLine);
            const left2 = turf.lineSlice(crossoverLeftPoint, turf.point(fullLeftLine.geometry.coordinates[fullLeftLine.geometry.coordinates.length - 1]), fullLeftLine);
            const right1 = turf.lineSlice(turf.point(fullRightLine.geometry.coordinates[0]), crossoverRightPoint, fullRightLine);
            const right2 = turf.lineSlice(crossoverRightPoint, turf.point(fullRightLine.geometry.coordinates[fullRightLine.geometry.coordinates.length - 1]), fullRightLine);

            const finalBodyLine1 = turf.lineString([...left1.geometry.coordinates, ...right2.geometry.coordinates.slice(1)]);
            const finalBodyLine2 = turf.lineString([...right1.geometry.coordinates, ...left2.geometry.coordinates.slice(1)]);

            const intersection = turf.lineIntersect(finalBodyLine1, finalBodyLine2);

            let handleCoord;
            if (intersection.features.length > 0) {
                handleCoord = intersection.features[0].geometry.coordinates;
            } else {
                handleCoord = pointOnMainLine.geometry.coordinates;
            }

            // If no arrow head, return crossed body only
            if (!showArrowHead) {
                return this.createCrossedPolygons(left1, left2, right1, right2, handleCoord);
            }

            // Calculate arrow head for airmobile
            const p_last = coords[coords.length - 1];
            const p_second_last = coords[coords.length - 2];
            const bearing = turf.bearing(p_second_last, p_last);
            const absHeadBaseWidth = Math.abs(width * 2.5);
            const headLength = absHeadBaseWidth * headLengthRatio;

            const perpendicularBearingLeft = bearing - 90;
            const perpendicularBearingRight = bearing + 90;
            const headCornerLeft = turf.destination(p_last, absHeadBaseWidth / 2, perpendicularBearingLeft, { units: 'meters' });
            const headCornerRight = turf.destination(p_last, absHeadBaseWidth / 2, perpendicularBearingRight, { units: 'meters' });
            const headTip = turf.destination(p_last, headLength, bearing, { units: 'meters' });

            return this.createCrossedPolygonsWithHead(
                left1, left2, right1, right2, handleCoord,
                headCornerLeft, headCornerRight, headTip
            );

        } catch (error) {
            console.warn('Error in airmobile geometry, using normal:', error);
            return this.generateNormalArrowGeometry(mainLine, width, headLengthRatio, absHalfBodyWidth, showArrowHead);
        }
    }

    /**
     * Create crossed polygons without arrow head
     */
    createCrossedPolygons(left1, left2, right1, right2, handleCoord) {
        // First polygon: start to crossover
        const polygon1Coords = [];
        polygon1Coords.push(...[...left1.geometry.coordinates].slice(0, -1));
        polygon1Coords.push(handleCoord);
        const right1Reversed = [...right1.geometry.coordinates].reverse();
        polygon1Coords.push(...right1Reversed.slice(1));
        polygon1Coords.push(polygon1Coords[0]);

        // Second polygon: crossover to end (no head)
        const polygon2Coords = [];
        polygon2Coords.push(...[...left2.geometry.coordinates].slice(1));
        const right2Reversed = [...right2.geometry.coordinates].reverse();
        polygon2Coords.push(...right2Reversed.slice(0, -1));
        polygon2Coords.push(handleCoord);
        polygon2Coords.push(polygon2Coords[0]);

        return {
            type: 'MultiPolygon',
            coordinates: [
                [polygon1Coords],
                [polygon2Coords]
            ]
        };
    }

    /**
     * Create crossed polygons with arrow head
     */
    createCrossedPolygonsWithHead(left1, left2, right1, right2, handleCoord, headCornerLeft, headCornerRight, headTip) {
        // First polygon: start to crossover
        const polygon1Coords = [];
        polygon1Coords.push(...[...left1.geometry.coordinates].slice(0, -1));
        polygon1Coords.push(handleCoord);
        const right1Reversed = [...right1.geometry.coordinates].reverse();
        polygon1Coords.push(...right1Reversed.slice(1));
        polygon1Coords.push(polygon1Coords[0]);

        // Second polygon: crossover to end with arrow head
        const polygon2Coords = [];
        polygon2Coords.push(...[...left2.geometry.coordinates].slice(1));
        polygon2Coords.push(headCornerRight.geometry.coordinates);
        polygon2Coords.push(headTip.geometry.coordinates);
        polygon2Coords.push(headCornerLeft.geometry.coordinates);
        const right2Reversed = [...right2.geometry.coordinates].reverse();
        polygon2Coords.push(...right2Reversed.slice(0, -1));
        polygon2Coords.push(handleCoord);
        polygon2Coords.push(polygon2Coords[0]);

        return {
            type: 'MultiPolygon',
            coordinates: [
                [polygon1Coords],
                [polygon2Coords]
            ]
        };
    }

    /**
     * Create edit handles for arrow
     * @param {Object} feature - Arrow feature
     * @returns {Array} Array of handle features
     */
    createHandles(feature) {
        const handles = [];
        const coords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);

        if (coords.length < 2) {
            console.warn('Insufficient coordinates for handles:', coords);
            return [];
        }

        // 1. Vertex handles (red)
        coords.forEach((coord, index) => {
            handles.push({
                type: 'Feature',
                id: `arrow-handle-${feature.properties.id}-vertex-${index}`,
                geometry: { type: 'Point', coordinates: coord },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: `vertex-${index}`,
                    index: index,
                    featureId: feature.properties.id,
                    mode: 'arrow_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        // 2. Midpoint handles (orange)
        for (let i = 0; i < coords.length - 1; i++) {
            const midpoint = turf.midpoint(turf.point(coords[i]), turf.point(coords[i + 1]));
            handles.push({
                type: 'Feature',
                id: `arrow-handle-${feature.properties.id}-midpoint-${i}`,
                geometry: midpoint.geometry,
                properties: {
                    role: 'handle',
                    handleType: 'midpoint',
                    handleId: `midpoint-${i}`,
                    insertIndex: i + 1,
                    featureId: feature.properties.id,
                    mode: 'arrow_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        // 3. Width handle (blue)
        const width = feature.properties.width;
        const lastPoint = coords[coords.length - 1];
        const secondLastPoint = coords[coords.length - 2];
        const bearing = turf.bearing(secondLastPoint, lastPoint);
        const sign = Math.sign(width || 1);
        const perpendicularBearing = bearing - (90 * sign);
        const headBaseWidth = Math.abs(width * 2.5);
        const widthHandlePoint = turf.destination(lastPoint, headBaseWidth / 2, perpendicularBearing, { units: 'meters' });

        handles.push({
            type: 'Feature',
            id: `arrow-handle-${feature.properties.id}-width`,
            geometry: { type: 'Point', coordinates: widthHandlePoint.geometry.coordinates },
            properties: {
                role: 'handle',
                handleType: 'width',
                handleId: 'width',
                featureId: feature.properties.id,
                mode: 'arrow_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // 4. Head length handle (green) - only if showArrowHead = true
        const showArrowHead = feature.properties.showArrowHead !== false;
        if (showArrowHead) {
            const headLengthRatio = feature.properties.headLengthRatio || 1.5;
            const headLength = headBaseWidth * headLengthRatio;
            const headTipPoint = turf.destination(lastPoint, headLength, bearing, { units: 'meters' });

            handles.push({
                type: 'Feature',
                id: `arrow-handle-${feature.properties.id}-headlength`,
                geometry: { type: 'Point', coordinates: headTipPoint.geometry.coordinates },
                properties: {
                    role: 'handle',
                    handleType: 'headLength',
                    handleId: 'headLength',
                    featureId: feature.properties.id,
                    mode: 'arrow_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        // 5. Airmobile position handle (purple)
        const airmobile = feature.properties.airmobile || false;
        if (airmobile) {
            const airmobileHandle = this.createAirmobileHandle(feature, coords);
            if (airmobileHandle) {
                handles.push(airmobileHandle);
            }
        }

        return handles;
    }

    /**
     * Create airmobile position handle
     */
    createAirmobileHandle(feature, coords) {
        const airmobilePosition = feature.properties.airmobilePosition || 0.5;
        
        if (coords.length >= 2) {
            const absHalfBodyWidth = Math.abs((feature.properties.width || 1000) / 2);
            const mainLine = turf.lineString(coords);
            const mainLineLength = turf.length(mainLine, { units: 'meters' });

            try {
                const fullLeftLine = turf.lineOffset(mainLine, absHalfBodyWidth, { units: 'meters' });
                const fullRightLine = turf.lineOffset(mainLine, -absHalfBodyWidth, { units: 'meters' });
                const pointOnMainLine = turf.along(mainLine, mainLineLength * airmobilePosition, { units: 'meters' });

                const crossoverLeftPoint = turf.nearestPointOnLine(fullLeftLine, pointOnMainLine);
                const crossoverRightPoint = turf.nearestPointOnLine(fullRightLine, pointOnMainLine);

                const left1 = turf.lineSlice(turf.point(fullLeftLine.geometry.coordinates[0]), crossoverLeftPoint, fullLeftLine);
                const left2 = turf.lineSlice(crossoverLeftPoint, turf.point(fullLeftLine.geometry.coordinates[fullLeftLine.geometry.coordinates.length - 1]), fullLeftLine);
                const right1 = turf.lineSlice(turf.point(fullRightLine.geometry.coordinates[0]), crossoverRightPoint, fullRightLine);
                const right2 = turf.lineSlice(crossoverRightPoint, turf.point(fullRightLine.geometry.coordinates[fullRightLine.geometry.coordinates.length - 1]), fullRightLine);

                const finalBodyLine1 = turf.lineString([...left1.geometry.coordinates, ...right2.geometry.coordinates.slice(1)]);
                const finalBodyLine2 = turf.lineString([...right1.geometry.coordinates, ...left2.geometry.coordinates.slice(1)]);

                const intersection = turf.lineIntersect(finalBodyLine1, finalBodyLine2);

                let handleCoord;
                if (intersection.features.length > 0) {
                    handleCoord = intersection.features[0].geometry.coordinates;
                } else {
                    handleCoord = pointOnMainLine.geometry.coordinates;
                }

                return {
                    type: 'Feature',
                    id: `arrow-handle-${feature.properties.id}-airmobile`,
                    geometry: { type: 'Point', coordinates: handleCoord },
                    properties: {
                        role: 'handle',
                        handleType: 'airmobile',
                        handleId: 'airmobile',
                        featureId: feature.properties.id,
                        mode: 'arrow_editing',
                        meta: 'vertex',
                        user_isEditingHandle: true
                    }
                };
            } catch (error) {
                console.warn('Error creating airmobile handle:', error);
                return null;
            }
        }
        return null;
    }

    /**
     * Update arrow geometry based on handle movement
     * @param {string} handleType - Type of handle being moved
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Arrow feature being edited
     * @returns {Object} Updated properties and geometry
     */
    updateFromHandle(handleType, newPosition, feature, activeHandle = null) {
        let coords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (coords.length < 2) {
            console.warn('Insufficient coordinates to update geometry:', coords);
            return null;
        }

        coords = [...coords]; // Create copy
        const updatedProperties = { ...feature.properties };
        let convertedHandleType = handleType; // Track handle type conversion

        if (handleType.startsWith('vertex-')) {
            // Move existing vertex
            const index = parseInt(handleType.split('-')[1]);
            coords[index] = newPosition;
            updatedProperties.baseCoordinates = coords;
        } 
        else if (handleType.startsWith('midpoint-')) {
            // Add new vertex at midpoint position
            const insertIndex = parseInt(handleType.split('-')[1]) + 1;
            coords.splice(insertIndex, 0, newPosition);
            updatedProperties.baseCoordinates = coords;

            // CRITICAL: Convert midpoint handle to vertex handle during drag
            convertedHandleType = `vertex-${insertIndex}`;
            
            // Update the active handle object if provided
            if (activeHandle && activeHandle.properties) {
                activeHandle.properties.handleType = 'vertex';
                activeHandle.properties.handleId = convertedHandleType;
                activeHandle.properties.index = insertIndex;
            }
        } 
        else if (handleType === 'width') {
            // Update width based on perpendicular distance
            const lastPoint = coords[coords.length - 1];
            const secondLastPoint = coords[coords.length - 2];
            const line = turf.lineString([secondLastPoint, lastPoint]);

            let newWidth = turf.pointToLineDistance(turf.point(newPosition), line, { units: 'meters' });

            // Determine sign based on line side
            const x1 = secondLastPoint[0], y1 = secondLastPoint[1];
            const x2 = lastPoint[0], y2 = lastPoint[1];
            const x = newPosition[0], y = newPosition[1];
            if ((x - x1) * (y2 - y1) - (y - y1) * (x2 - x1) > 0) {
                newWidth = -newWidth;
            }

            updatedProperties.width = newWidth;
        } 
        else if (handleType === 'headLength') {
            // Update head length ratio
            const lastPoint = coords[coords.length - 1];
            const secondLastPoint = coords[coords.length - 2];
            const bearing = turf.bearing(secondLastPoint, lastPoint);

            const line = turf.lineString([lastPoint, newPosition]);
            const distance = turf.length(line, { units: 'meters' });

            const tipBearing = turf.bearing(lastPoint, newPosition);
            const angleDiff = Math.abs(bearing - tipBearing);
            const isForward = angleDiff < 90 || angleDiff > 270;

            if (isForward && distance > 100) {
                const width = updatedProperties.width || 500;
                const headBaseWidth = Math.abs(width * 2.5);
                const newHeadLengthRatio = Math.max(0.5, distance / headBaseWidth);
                updatedProperties.headLengthRatio = newHeadLengthRatio;
            }
        } 
        else if (handleType === 'airmobile') {
            // Update airmobile position
            const line = turf.lineString(coords);
            const lineLength = turf.length(line, { units: 'meters' });

            const snappedPoint = turf.nearestPointOnLine(line, turf.point(newPosition), { units: 'meters' });
            const newDistance = snappedPoint.properties.location;

            let newPositionNormalized = newDistance / lineLength;
            newPositionNormalized = Math.max(0.01, Math.min(0.99, newPositionNormalized));

            updatedProperties.airmobilePosition = newPositionNormalized;
        }

        // Generate new geometry with updated properties
        const newGeometry = this.generate(updatedProperties.baseCoordinates, updatedProperties);

        return {
            properties: updatedProperties,
            geometry: newGeometry,
            convertedHandleType: convertedHandleType // Return the converted handle type
        };
    }

    /**
     * Validate arrow data
     * @param {Array} baseCoordinates - Base coordinates
     * @param {Object} properties - Arrow properties
     * @returns {boolean} True if valid
     */
    validate(baseCoordinates, properties = {}) {
        const coords = this.normalizeBaseCoordinates(baseCoordinates);
        
        if (coords.length < 2) {
            return false;
        }

        // Check minimum distance between consecutive points
        for (let i = 1; i < coords.length; i++) {
            const distance = this.calculateDistance(coords[i-1], coords[i]);
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
        const distance = turf.distance(
            turf.point(lastPoint),
            turf.point(newPoint),
            { units: 'meters' }
        );

        return distance < this.MIN_DISTANCE_METERS;
    }

    /**
     * Normalize base coordinates from various formats
     * @param {string|Array} baseCoordinates - Base coordinates
     * @returns {Array} Normalized coordinates array
     */
    normalizeBaseCoordinates(baseCoordinates) {
        if (typeof baseCoordinates === 'string') {
            try {
                return JSON.parse(baseCoordinates);
            } catch (e) {
                console.error('Error parsing baseCoordinates:', e);
                return [];
            }
        }

        if (!Array.isArray(baseCoordinates)) {
            console.warn('baseCoordinates is not an array:', baseCoordinates);
            return [];
        }

        return baseCoordinates;
    }

    /**
     * Get bounding box for arrow
     * @param {Array} baseCoordinates - Base coordinates  
     * @param {Object} properties - Arrow properties
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(baseCoordinates, properties = {}) {
        const coords = this.normalizeBaseCoordinates(baseCoordinates);
        if (coords.length === 0) return [0, 0, 0, 0];

        const geometry = this.generate(coords, properties);
        if (!geometry) return [0, 0, 0, 0];

        try {
            return turf.bbox({ type: 'Feature', geometry });
        } catch (error) {
            console.warn('Error calculating bbox:', error);
            return [0, 0, 0, 0];
        }
    }
}

export default AddArrowGeometry;
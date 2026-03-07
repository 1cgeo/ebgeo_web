// Path: js/military_tools/arrow_tool/add_arrow_geometry.js

import { BaseGeometry } from '@tools';

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
        // Merged arrow: generate union of all branch polygons
        if (properties.isMerged && Array.isArray(properties.branches) && properties.branches.length > 1) {
            return this.generateMergedGeometry(properties);
        }

        return this.generateSingleArrow(baseCoordinates, properties);
    }

    /**
     * Generate a single (non-merged) arrow polygon
     * @param {Array} baseCoordinates - Array of [lng, lat] coordinates
     * @param {Object} properties - Arrow properties
     * @returns {Object} GeoJSON geometry
     */
    generateSingleArrow(baseCoordinates, properties = {}) {
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
     * Generate merged geometry by computing turf.union of all branch polygons
     * @param {Object} properties - Merged arrow properties (must contain branches array)
     * @returns {Object|null} GeoJSON geometry (Polygon or MultiPolygon)
     */
    generateMergedGeometry(properties) {
        const branchFeatures = [];

        for (const branch of properties.branches) {
            const branchGeom = this.generateSingleArrow(branch.baseCoordinates, {
                width: branch.width || properties.width || 1000,
                headLengthRatio: branch.headLengthRatio || properties.headLengthRatio || 1.5,
                showArrowHead: branch.showArrowHead !== false,
                airmobile: branch.airmobile || false,
                airmobilePosition: branch.airmobilePosition || 0.7
            });

            if (branchGeom && branchGeom.type !== 'LineString') {
                branchFeatures.push(turf.feature(branchGeom));
            }
        }

        if (branchFeatures.length === 0) return null;
        if (branchFeatures.length === 1) return branchFeatures[0].geometry;

        try {
            let merged = branchFeatures[0];
            for (let i = 1; i < branchFeatures.length; i++) {
                merged = turf.union(
                    turf.featureCollection([merged, branchFeatures[i]])
                );
            }
            return merged.geometry;
        } catch (error) {
            console.warn('Error computing union for merged arrow:', error);
            // Fallback: return MultiPolygon of all branches
            const polygons = branchFeatures
                .filter(f => f.geometry.type === 'Polygon')
                .map(f => f.geometry.coordinates);
            if (polygons.length === 0) return null;
            return { type: 'MultiPolygon', coordinates: polygons };
        }
    }

    /**
     * Generate normal (non-airmobile) arrow geometry
     */
    generateNormalArrowGeometry(mainLine, width, headLengthRatio, absHalfBodyWidth, showArrowHead) {
        const coords = mainLine.geometry.coordinates;

        const leftLine = turf.lineOffset(mainLine, absHalfBodyWidth, { units: 'meters' });
        const rightLine = turf.lineOffset(mainLine, -absHalfBodyWidth, { units: 'meters' });

        const p_last = coords[coords.length - 1];
        const p_second_last = coords[coords.length - 2];
        const bearing = turf.bearing(p_second_last, p_last);

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

        const absHeadBaseWidth = Math.abs(width * 2.5);
        const headLength = absHeadBaseWidth * headLengthRatio;

        const perpendicularBearingLeft = bearing - 90;
        const perpendicularBearingRight = bearing + 90;
        const headCornerLeft = turf.destination(p_last, absHeadBaseWidth / 2, perpendicularBearingLeft, { units: 'meters' });
        const headCornerRight = turf.destination(p_last, absHeadBaseWidth / 2, perpendicularBearingRight, { units: 'meters' });
        const headTip = turf.destination(p_last, headLength, bearing, { units: 'meters' });

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
            const fullLeftLine = turf.lineOffset(mainLine, absHalfBodyWidth, { units: 'meters' });
            const fullRightLine = turf.lineOffset(mainLine, -absHalfBodyWidth, { units: 'meters' });

            const pointOnMainLine = turf.along(mainLine, mainLineLength * airmobilePosition, { units: 'meters' });
            const crossoverLeftPoint = turf.nearestPointOnLine(fullLeftLine, pointOnMainLine, { units: 'meters' });
            const crossoverRightPoint = turf.nearestPointOnLine(fullRightLine, pointOnMainLine, { units: 'meters' });

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

            if (!showArrowHead) {
                return this.createCrossedPolygons(left1, left2, right1, right2, handleCoord);
            }

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
        const polygon1Coords = [];
        polygon1Coords.push(...[...left1.geometry.coordinates].slice(0, -1));
        polygon1Coords.push(handleCoord);
        const right1Reversed = [...right1.geometry.coordinates].reverse();
        polygon1Coords.push(...right1Reversed.slice(1));
        polygon1Coords.push(polygon1Coords[0]);

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
        const polygon1Coords = [];
        polygon1Coords.push(...[...left1.geometry.coordinates].slice(0, -1));
        polygon1Coords.push(handleCoord);
        const right1Reversed = [...right1.geometry.coordinates].reverse();
        polygon1Coords.push(...right1Reversed.slice(1));
        polygon1Coords.push(polygon1Coords[0]);

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
        if (feature.properties.isMerged && Array.isArray(feature.properties.branches)) {
            return this.createMergedHandles(feature);
        }

        return this.createSingleHandles(feature);
    }

    /**
     * Create handles for a single (non-merged) arrow
     * @param {Object} feature - Arrow feature
     * @param {number|null} [branchIndex=null] - Branch index (for merged arrows)
     * @returns {Array} Array of handle features
     */
    createSingleHandles(feature, branchIndex = null) {
        const handles = [];
        const branchProps = branchIndex !== null && feature.properties.branches
            ? feature.properties.branches[branchIndex]
            : feature.properties;
        const coords = this.normalizeBaseCoordinates(branchProps.baseCoordinates);
        const prefix = branchIndex !== null ? `b${branchIndex}-` : '';

        if (coords.length < 2) {
            console.warn('Insufficient coordinates for handles:', coords);
            return [];
        }

        coords.forEach((coord, index) => {
            handles.push({
                type: 'Feature',
                id: `arrow-handle-${feature.properties.id}-${prefix}vertex-${index}`,
                geometry: { type: 'Point', coordinates: coord },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: `${prefix}vertex-${index}`,
                    index: index,
                    branchIndex: branchIndex,
                    featureId: feature.properties.id,
                    mode: 'arrow_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        for (let i = 0; i < coords.length - 1; i++) {
            const midpoint = turf.midpoint(turf.point(coords[i]), turf.point(coords[i + 1]));
            handles.push({
                type: 'Feature',
                id: `arrow-handle-${feature.properties.id}-${prefix}midpoint-${i}`,
                geometry: midpoint.geometry,
                properties: {
                    role: 'handle',
                    handleType: 'midpoint',
                    handleId: `${prefix}midpoint-${i}`,
                    index: i,
                    insertIndex: i + 1,
                    branchIndex: branchIndex,
                    featureId: feature.properties.id,
                    mode: 'arrow_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        const width = branchProps.width || feature.properties.width;
        const lastPoint = coords[coords.length - 1];
        const secondLastPoint = coords[coords.length - 2];
        const bearing = turf.bearing(secondLastPoint, lastPoint);
        const sign = Math.sign(width || 1);
        const perpendicularBearing = bearing - (90 * sign);
        const headBaseWidth = Math.abs(width * 2.5);
        const widthHandlePoint = turf.destination(lastPoint, headBaseWidth / 2, perpendicularBearing, { units: 'meters' });

        handles.push({
            type: 'Feature',
            id: `arrow-handle-${feature.properties.id}-${prefix}width`,
            geometry: { type: 'Point', coordinates: widthHandlePoint.geometry.coordinates },
            properties: {
                role: 'handle',
                handleType: 'width',
                handleId: `${prefix}width`,
                branchIndex: branchIndex,
                featureId: feature.properties.id,
                mode: 'arrow_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        const showArrowHead = branchProps.showArrowHead !== false;
        if (showArrowHead) {
            const headLengthRatio = branchProps.headLengthRatio || 1.5;
            const headLength = headBaseWidth * headLengthRatio;
            const headTipPoint = turf.destination(lastPoint, headLength, bearing, { units: 'meters' });

            handles.push({
                type: 'Feature',
                id: `arrow-handle-${feature.properties.id}-${prefix}headlength`,
                geometry: { type: 'Point', coordinates: headTipPoint.geometry.coordinates },
                properties: {
                    role: 'handle',
                    handleType: 'headLength',
                    handleId: `${prefix}headLength`,
                    branchIndex: branchIndex,
                    featureId: feature.properties.id,
                    mode: 'arrow_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        const airmobile = branchProps.airmobile || false;
        if (airmobile) {
            const airmobileFeature = branchIndex !== null
                ? { properties: { ...feature.properties, ...branchProps, id: feature.properties.id } }
                : feature;
            const airmobileHandle = this.createAirmobileHandle(airmobileFeature, coords);
            if (airmobileHandle) {
                airmobileHandle.properties.branchIndex = branchIndex;
                airmobileHandle.id = `arrow-handle-${feature.properties.id}-${prefix}airmobile`;
                airmobileHandle.properties.handleId = `${prefix}airmobile`;
                handles.push(airmobileHandle);
            }
        }

        return handles;
    }

    /**
     * Create handles for all branches of a merged arrow
     * @param {Object} feature - Merged arrow feature
     * @returns {Array} Array of handle features for all branches
     */
    createMergedHandles(feature) {
        const handles = [];

        feature.properties.branches.forEach((_branch, branchIdx) => {
            handles.push(...this.createSingleHandles(feature, branchIdx));
        });

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
     * @param {string} handleType - Type of handle being moved ('vertex', 'midpoint', 'width', 'headLength', 'airmobile')
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Arrow feature being edited
     * @param {number} handleIndex - Index of the handle being moved (for vertex/midpoint types)
     * @param {number|null} branchIndex - Branch index for merged arrows
     * @returns {Object} Updated properties and geometry
     */
    updateFromHandle(handleType, newPosition, feature, handleIndex = null, branchIndex = null) {
        if (!handleType) {
            console.warn('handleType is null or undefined');
            return null;
        }

        const updatedProperties = { ...feature.properties };

        // For merged arrows, update the specific branch
        if (updatedProperties.isMerged && branchIndex !== null && Array.isArray(updatedProperties.branches)) {
            updatedProperties.branches = updatedProperties.branches.map(b => ({ ...b }));
            const branch = updatedProperties.branches[branchIndex];
            if (!branch) return null;

            const branchResult = this._updateBranchFromHandle(
                handleType, newPosition, branch, handleIndex
            );
            if (!branchResult) return null;

            updatedProperties.branches[branchIndex] = branchResult;

            // Sync top-level compat props with first branch
            if (branchIndex === 0) {
                updatedProperties.baseCoordinates = branchResult.baseCoordinates;
                updatedProperties.width = branchResult.width;
                updatedProperties.headLengthRatio = branchResult.headLengthRatio;
                updatedProperties.airmobilePosition = branchResult.airmobilePosition;
            }

            const newGeometry = this.generate(updatedProperties.baseCoordinates, updatedProperties);
            return { properties: updatedProperties, geometry: newGeometry };
        }

        // Single arrow path
        let coords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (coords.length < 2) {
            console.warn('Insufficient coordinates to update geometry:', coords);
            return null;
        }

        coords = [...coords];

        // Support both formats: 'vertex'/'midpoint' with separate index, or legacy 'vertex-X'/'midpoint-X'
        if (handleType === 'vertex' && handleIndex !== null) {
            if (handleIndex >= 0 && handleIndex < coords.length) {
                coords[handleIndex] = newPosition;
                updatedProperties.baseCoordinates = coords;
            }
        } else if (handleType === 'midpoint' && handleIndex !== null) {
            const insertIndex = handleIndex + 1;
            if (handleIndex >= 0 && handleIndex < coords.length - 1) {
                coords.splice(insertIndex, 0, newPosition);
                updatedProperties.baseCoordinates = coords;
            }
        } else if (handleType.startsWith('vertex-')) {
            const index = parseInt(handleType.split('-')[1], 10);
            coords[index] = newPosition;
            updatedProperties.baseCoordinates = coords;
        } else if (handleType.startsWith('midpoint-')) {
            const insertIndex = parseInt(handleType.split('-')[1], 10) + 1;
            coords.splice(insertIndex, 0, newPosition);
            updatedProperties.baseCoordinates = coords;
        } else if (handleType === 'width') {
            this._applyWidthFromHandle(updatedProperties, coords, newPosition);
        } else if (handleType === 'headLength') {
            this._applyHeadLengthFromHandle(updatedProperties, coords, newPosition);
        } else if (handleType === 'airmobile') {
            this._applyAirmobileFromHandle(updatedProperties, coords, newPosition);
        }

        const newGeometry = this.generate(updatedProperties.baseCoordinates, updatedProperties);

        return {
            properties: updatedProperties,
            geometry: newGeometry
        };
    }

    /**
     * Update a single branch's properties from handle movement
     * @param {string} handleType
     * @param {Array} newPosition
     * @param {Object} branch - Branch data object
     * @param {number|null} handleIndex
     * @returns {Object|null} Updated branch data
     */
    _updateBranchFromHandle(handleType, newPosition, branch, handleIndex) {
        const updated = { ...branch };
        let coords = this.normalizeBaseCoordinates(updated.baseCoordinates);
        if (coords.length < 2) return null;
        coords = [...coords];

        if (handleType === 'vertex' && handleIndex !== null) {
            if (handleIndex >= 0 && handleIndex < coords.length) {
                coords[handleIndex] = newPosition;
                updated.baseCoordinates = coords;
            }
        } else if (handleType === 'midpoint' && handleIndex !== null) {
            const insertIndex = handleIndex + 1;
            if (handleIndex >= 0 && handleIndex < coords.length - 1) {
                coords.splice(insertIndex, 0, newPosition);
                updated.baseCoordinates = coords;
            }
        } else if (handleType === 'width') {
            this._applyWidthFromHandle(updated, coords, newPosition);
        } else if (handleType === 'headLength') {
            this._applyHeadLengthFromHandle(updated, coords, newPosition);
        } else if (handleType === 'airmobile') {
            this._applyAirmobileFromHandle(updated, coords, newPosition);
        }

        return updated;
    }

    /**
     * Apply width change from handle position
     */
    _applyWidthFromHandle(props, coords, newPosition) {
        const lastPoint = coords[coords.length - 1];
        const secondLastPoint = coords[coords.length - 2];
        const line = turf.lineString([secondLastPoint, lastPoint]);

        let newWidth = turf.pointToLineDistance(turf.point(newPosition), line, { units: 'meters' });

        const x1 = secondLastPoint[0], y1 = secondLastPoint[1];
        const x2 = lastPoint[0], y2 = lastPoint[1];
        const x = newPosition[0], y = newPosition[1];
        if ((x - x1) * (y2 - y1) - (y - y1) * (x2 - x1) > 0) {
            newWidth = -newWidth;
        }

        props.width = newWidth;
    }

    /**
     * Apply head length change from handle position
     */
    _applyHeadLengthFromHandle(props, coords, newPosition) {
        const lastPoint = coords[coords.length - 1];
        const secondLastPoint = coords[coords.length - 2];
        const bearing = turf.bearing(secondLastPoint, lastPoint);

        const line = turf.lineString([lastPoint, newPosition]);
        const distance = turf.length(line, { units: 'meters' });

        const tipBearing = turf.bearing(lastPoint, newPosition);
        const angleDiff = Math.abs(bearing - tipBearing);
        const isForward = angleDiff < 90 || angleDiff > 270;

        if (isForward && distance > 100) {
            const width = props.width || 500;
            const headBaseWidth = Math.abs(width * 2.5);
            const newHeadLengthRatio = Math.max(0.5, distance / headBaseWidth);
            props.headLengthRatio = newHeadLengthRatio;
        }
    }

    /**
     * Apply airmobile position change from handle position
     */
    _applyAirmobileFromHandle(props, coords, newPosition) {
        const line = turf.lineString(coords);
        const lineLength = turf.length(line, { units: 'meters' });

        const snappedPoint = turf.nearestPointOnLine(line, turf.point(newPosition), { units: 'meters' });
        const newDistance = snappedPoint.properties.location;

        let newPositionNormalized = newDistance / lineLength;
        newPositionNormalized = Math.max(0.01, Math.min(0.99, newPositionNormalized));

        props.airmobilePosition = newPositionNormalized;
    }

    /**
     * Calculate preview geometry during handle dragging
     * @param {string} handleType - Type of handle being moved
     * @param {Array} newPosition - New handle position
     * @param {Object} feature - Arrow feature
     * @param {number} handleIndex - Index of the handle being moved
     * @param {number|null} branchIndex - Branch index for merged arrows
     * @returns {Object|null} Preview geometry and handle positions or null if invalid
     */
    calculatePreview(handleType, newPosition, feature, handleIndex = null, branchIndex = null) {
        const result = this.updateFromHandle(handleType, newPosition, feature, handleIndex, branchIndex);
        if (!result) return null;

        return {
            geometry: result.geometry,
            properties: result.properties,
            handles: this.createHandles({
                ...feature,
                properties: result.properties
            })
        };
    }

    /**
     * Validate arrow data
     * @param {Array} baseCoordinates - Base coordinates
     * @param {Object} properties - Arrow properties
     * @returns {boolean} True if valid
     */
    validate(baseCoordinates, _properties = {}) {
        const coords = this.normalizeBaseCoordinates(baseCoordinates);

        if (coords.length < 2) {
            return false;
        }

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

        // Arrows must have at least 2 vertices
        if (newCoordinates.length < 2) {
            return null;
        }

        return newCoordinates;
    }

    /**
     * Remove vertex in a specific branch of a merged arrow
     * @param {Object} properties - Merged feature properties
     * @param {number} branchIndex - Branch index
     * @param {number} vertexIndex - Vertex index within the branch
     * @returns {Object|null} Updated properties or null if invalid
     */
    removeVertexInBranch(properties, branchIndex, vertexIndex) {
        if (!properties.isMerged || !Array.isArray(properties.branches)) return null;

        const branch = properties.branches[branchIndex];
        if (!branch) return null;

        const coords = this.normalizeBaseCoordinates(branch.baseCoordinates);
        const newCoords = this.removeVertexAtIndex(coords, vertexIndex);
        if (!newCoords) return null;

        const updatedProperties = { ...properties };
        updatedProperties.branches = updatedProperties.branches.map(b => ({ ...b }));
        updatedProperties.branches[branchIndex] = {
            ...updatedProperties.branches[branchIndex],
            baseCoordinates: newCoords
        };

        // Sync top-level compat props
        if (branchIndex === 0) {
            updatedProperties.baseCoordinates = newCoords;
        }

        return updatedProperties;
    }
}

export default AddArrowGeometry;

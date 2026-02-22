// Path: js/analysis_tools/visibility_tool/add_visibility_geometry.js

import { BaseGeometry } from '../../tool_manager';
import { getTerrainElevation } from '../../terrain';

/**
 * Visibility Geometry Operations
 *
 * Handles sector-style geometry (preview, edit handles) and viewshed calculation
 * using a ray-marching maximum-angle sweep algorithm.
 *
 * Grid: angular step fixed at 1°. Distance step is auto-calculated as a
 * multiple of 30m (raster resolution) to keep total points in reasonable range.
 *
 * Angles follow geographic convention: 0 = North, clockwise.
 */
class AddVisibilityGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);

        this.VISIBLE_COLOR = '#00FF00';
        this.OBSTRUCTED_COLOR = '#FF0000';
    }

    // ========================================================================
    // SECTOR GEOMETRY (preview and outline)
    // ========================================================================

    /**
     * Generate sector polygon geometry for preview / feedback.
     * @param {Array} center - [lng, lat]
     * @param {number} radius - Radius in meters
     * @param {number} bearing - Central axis in degrees (0=North, clockwise)
     * @param {number} aperture - Opening angle in degrees (1-359)
     * @returns {Object} GeoJSON Polygon geometry
     */
    generate(center, radius, bearing, aperture) {
        return this.generateSectorGeometry(center, radius, bearing, aperture);
    }

    /**
     * Generate sector polygon geometry.
     * Arc sweeps from (bearing - aperture/2) to (bearing + aperture/2).
     * @param {Array} center - [lng, lat]
     * @param {number} radius - Radius in meters
     * @param {number} bearing - Central axis in degrees
     * @param {number} aperture - Opening angle in degrees
     * @returns {Object} GeoJSON Polygon geometry
     */
    generateSectorGeometry(center, radius, bearing, aperture) {
        const numArcPoints = Math.max(16, Math.round(64 * aperture / 360));
        const startAngle = bearing - aperture / 2;
        const endAngle = bearing + aperture / 2;

        const coords = [];
        coords.push([center[0], center[1]]);

        for (let i = 0; i <= numArcPoints; i++) {
            const angle = startAngle + (i * (endAngle - startAngle) / numArcPoints);
            const pt = this.pointAtBearing(center, radius, angle);
            coords.push(pt);
        }

        coords.push([center[0], center[1]]);

        return {
            type: 'Polygon',
            coordinates: [coords]
        };
    }

    /**
     * Calculate sector coordinates for preview during drawing.
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {Array} edgePoint - Edge point coordinates [lng, lat]
     * @param {number} aperture - Aperture in degrees
     * @returns {Array} Sector coordinates array (closed ring)
     */
    calculateSectorPreview(center, edgePoint, aperture) {
        const radius = this.calculateDistance(center, edgePoint);
        const bearing = this.calculateBearing(center, edgePoint);
        const geometry = this.generateSectorGeometry(center, radius, bearing, aperture);
        return geometry.coordinates[0];
    }

    // ========================================================================
    // BEARING / DISTANCE HELPERS
    // ========================================================================

    /**
     * Calculate bearing from center to a point (geographic: 0=N, clockwise).
     * @param {Array} center - [lng, lat]
     * @param {Array} point - [lng, lat]
     * @returns {number} Bearing in degrees [0, 360)
     */
    calculateBearing(center, point) {
        const dLng = point[0] - center[0];
        const dLat = point[1] - center[1];
        const cosLat = Math.cos(center[1] * Math.PI / 180);
        const dx = dLng * cosLat;
        const dy = dLat;
        let bearing = Math.atan2(dx, dy) * 180 / Math.PI;
        if (bearing < 0) bearing += 360;
        return bearing;
    }

    /**
     * Compute a point at given distance and bearing from center.
     * @param {Array} center - [lng, lat]
     * @param {number} radius - Distance in meters
     * @param {number} bearing - Bearing in degrees (geographic: 0=N, clockwise)
     * @returns {Array} [lng, lat]
     */
    pointAtBearing(center, radius, bearing) {
        const bearingRad = bearing * Math.PI / 180;
        const cosLat = Math.cos(center[1] * Math.PI / 180);
        const dx = radius * Math.sin(bearingRad);
        const dy = radius * Math.cos(bearingRad);
        const lng = center[0] + (dx / 111320) / cosLat;
        const lat = center[1] + (dy / 111320);
        return [lng, lat];
    }

    // ========================================================================
    // EDIT HANDLES
    // ========================================================================

    /**
     * Create edit handles for visibility sector.
     * - radius handle (red): on the central axis at arc edge
     * - aperture handle (blue): at one edge of the arc
     * @param {Object} feature - Visibility feature
     * @returns {Array|null} Array of handle features or null
     */
    createHandles(feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) return null;

        const { radius, bearing, aperture } = feature.properties;
        const featureId = feature.properties.id;

        const radiusPoint = this.pointAtBearing(center, radius, bearing);
        const radiusHandle = {
            type: 'Feature',
            id: `visibility-handle-${featureId}-radius`,
            geometry: { type: 'Point', coordinates: radiusPoint },
            properties: {
                role: 'handle',
                handleType: 'vertex',
                handleId: 'radius',
                featureId,
                mode: 'visibility_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        };

        const aperturePoint = this.pointAtBearing(center, radius, bearing + aperture / 2);
        const apertureHandle = {
            type: 'Feature',
            id: `visibility-handle-${featureId}-aperture`,
            geometry: { type: 'Point', coordinates: aperturePoint },
            properties: {
                role: 'handle',
                handleType: 'eccentricity',
                handleId: 'aperture',
                featureId,
                mode: 'visibility_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        };

        const centerHandle = {
            type: 'Feature',
            id: `visibility-handle-${featureId}-center`,
            geometry: { type: 'Point', coordinates: center },
            properties: {
                role: 'handle',
                handleType: 'center',
                handleId: 'center',
                featureId,
                mode: 'visibility_editing',
                meta: 'vertex',
                user_isEditingHandle: false
            }
        };

        return [radiusHandle, apertureHandle, centerHandle];
    }

    /**
     * Update sector geometry based on handle movement.
     * @param {string} handleId - 'radius' or 'aperture'
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Visibility feature being edited
     * @returns {Object|null} Updated { geometry, radius, bearing, aperture } or null
     */
    updateFromHandle(handleId, newPosition, feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) return null;

        const { bearing, aperture, radius } = feature.properties;

        if (handleId === 'radius') {
            const newRadius = this.calculateDistance(center, newPosition);
            if (newRadius < 10) return null;
            const newBearing = this.calculateBearing(center, newPosition);
            const geometry = this.generateSectorGeometry(center, newRadius, newBearing, aperture);
            return { geometry, radius: newRadius, bearing: newBearing, aperture };
        }

        if (handleId === 'aperture') {
            const handleBearing = this.calculateBearing(center, newPosition);
            let angleDiff = handleBearing - bearing;
            if (angleDiff < 0) angleDiff += 360;
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            let newAperture = Math.round(angleDiff * 2);
            newAperture = Math.max(1, Math.min(359, newAperture));
            const geometry = this.generateSectorGeometry(center, radius, bearing, newAperture);
            return { geometry, radius, bearing, aperture: newAperture };
        }

        return null;
    }

    /**
     * Calculate preview geometry during handle dragging.
     * @param {string} handleId - 'radius' or 'aperture'
     * @param {Array} newPosition - Current mouse position [lng, lat]
     * @param {Object} feature - Visibility feature
     * @returns {Object|null} Preview { geometry, handles, radius, bearing, aperture }
     */
    calculatePreview(handleId, newPosition, feature) {
        const result = this.updateFromHandle(handleId, newPosition, feature);
        if (!result) return null;

        const center = this.normalizeCenter(feature.properties.center);
        const { radius, bearing, aperture } = result;

        const radiusPoint = this.pointAtBearing(center, radius, bearing);
        const aperturePoint = this.pointAtBearing(center, radius, bearing + aperture / 2);

        return {
            geometry: result.geometry,
            handles: [radiusPoint, aperturePoint, center],
            radius,
            bearing,
            aperture
        };
    }

    // ========================================================================
    // VIEWSHED CALCULATION
    // ========================================================================

    /**
     * Calculate optimal distance step as a multiple of 30m (raster resolution).
     * Targets ~5.000-15.000 total points for reasonable performance.
     * @param {number} radius - Radius in meters
     * @param {number} aperture - Aperture in degrees
     * @returns {number} Distance step in meters (multiple of 30)
     */
    calculateDistanceStep(radius, aperture) {
        const ANGULAR_STEP = 1;
        const MIN_STEP = 30;
        const TARGET_POINTS = 10000;

        const numRays = Math.ceil(aperture / ANGULAR_STEP);
        // Ideal points per ray to hit target total
        const idealPointsPerRay = Math.max(1, Math.round(TARGET_POINTS / Math.max(1, numRays)));
        const idealStep = radius / idealPointsPerRay;
        // Round up to nearest multiple of 30m
        const step = Math.max(MIN_STEP, Math.ceil(idealStep / MIN_STEP) * MIN_STEP);
        return step;
    }

    /**
     * Calculate viewshed using ray-marching maximum-angle sweep.
     *
     * Angular step is fixed at 1°. Distance step is auto-calculated from radius.
     * For each ray: batch-collect elevations first, then resolve LOS in-memory.
     *
     * targetHeight is only added to the point being evaluated for visibility,
     * NOT to intermediate points that update the max elevation angle barrier.
     *
     * @param {Array} center - Observer coordinates [lng, lat]
     * @param {number} radius - Analysis radius in meters
     * @param {number} bearing - Central bearing in degrees
     * @param {number} aperture - Opening angle in degrees
     * @param {number} observerHeight - Observer height above terrain in meters
     * @param {number} targetHeight - Target height above terrain in meters
     * @param {Object} map - MapLibre map instance
     * @param {Function} [progressCallback] - Progress callback(percentage, text)
     * @returns {Promise<Array>} Array of { coordinates, isVisible } cells
     */
    async calculateViewshed(center, radius, bearing, aperture,
        observerHeight, targetHeight, map, progressCallback = null) {

        const ANGULAR_STEP = 1;
        const distanceStep = this.calculateDistanceStep(radius, aperture);

        if (progressCallback) {
            progressCallback(5, 'Obtendo elevação do observador...');
            await this.delay(50);
        }

        const observerElev = await getTerrainElevation(map, center) + observerHeight;
        const startAngle = bearing - aperture / 2;
        const numRays = Math.ceil(aperture / ANGULAR_STEP);
        const numPointsPerRay = Math.ceil(radius / distanceStep);

        const elevationCache = new Map();
        const resultGrid = [];

        if (progressCallback) {
            progressCallback(10, 'Iniciando análise do terreno...');
            await this.delay(50);
        }

        for (let rayIdx = 0; rayIdx <= numRays; rayIdx++) {
            const angle = startAngle + rayIdx * ANGULAR_STEP;

            // Phase 1: Batch-collect elevations for this ray
            const rayElevations = [];
            for (let ptIdx = 1; ptIdx <= numPointsPerRay; ptIdx++) {
                const dist = ptIdx * distanceStep;
                const coord = this.pointAtBearing(center, dist, angle);
                const elev = await this.getCachedElevation(map, coord, elevationCache);
                rayElevations.push({ dist, terrainElev: elev });
            }

            // Phase 2: Resolve LOS using maximum-angle sweep (pure CPU, no I/O)
            // maxElevAngle tracks the terrain-only barrier (no targetHeight).
            // Each point is evaluated with targetHeight added for visibility check,
            // but the barrier is updated using terrain-only elevation.
            const rayResult = [];
            let maxElevAngle = -Infinity;

            for (let ptIdx = 0; ptIdx < rayElevations.length; ptIdx++) {
                const { dist, terrainElev } = rayElevations[ptIdx];

                // Visibility check: can we see an object of targetHeight at this point?
                const targetElev = terrainElev + targetHeight;
                const targetElevAngle = Math.atan2(targetElev - observerElev, dist);

                // Terrain-only angle for barrier tracking
                const terrainElevAngle = Math.atan2(terrainElev - observerElev, dist);

                if (targetElevAngle > maxElevAngle) {
                    rayResult.push({ visible: true });
                } else {
                    rayResult.push({ visible: false });
                }

                // Update barrier using terrain only (not target object height)
                if (terrainElevAngle > maxElevAngle) {
                    maxElevAngle = terrainElevAngle;
                }
            }

            resultGrid.push(rayResult);

            // Yield to event loop for UI responsiveness
            if (rayIdx % 5 === 0 && progressCallback) {
                const pct = 10 + 60 * (rayIdx / numRays);
                progressCallback(pct, `Processando raio ${rayIdx + 1}/${numRays + 1}...`);
                await this.delay(0);
            }
        }

        if (progressCallback) {
            progressCallback(72, 'Gerando células...');
            await this.delay(50);
        }

        // Phase 3: Convert result grid to wedge polygon cells
        const cells = this.generateWedgeCells(
            resultGrid, center, startAngle, ANGULAR_STEP, distanceStep, numPointsPerRay
        );

        if (progressCallback) {
            progressCallback(78, 'Otimizando geometrias...');
            await this.delay(50);
        }

        // Phase 4: Dissolve adjacent same-visibility cells
        const optimizedCells = this.dissolveVisibilityCells(cells);

        return optimizedCells;
    }

    /**
     * Get terrain elevation with per-session cache.
     * @param {Object} map - MapLibre map instance
     * @param {Array} coord - [lng, lat]
     * @param {Map} cache - Elevation cache
     * @returns {Promise<number>} Elevation in meters
     */
    async getCachedElevation(map, coord, cache) {
        // Round to ~1m precision for cache key
        const key = `${coord[0].toFixed(5)},${coord[1].toFixed(5)}`;
        if (cache.has(key)) return cache.get(key);
        const elev = await getTerrainElevation(map, coord);
        cache.set(key, elev);
        return elev;
    }

    /**
     * Convert result grid to wedge polygon cells.
     * @param {Array} resultGrid - [rayIdx][ptIdx] = { visible }
     * @param {Array} center - [lng, lat]
     * @param {number} startAngle - Start angle in degrees
     * @param {number} angleDivisions - Degrees between rays
     * @param {number} distanceDivisions - Meters between points
     * @param {number} numPointsPerRay - Points per ray
     * @returns {Array} Array of { coordinates, isVisible }
     */
    generateWedgeCells(resultGrid, center, startAngle, angleDivisions, distanceDivisions, numPointsPerRay) {
        const cells = [];

        for (let rayIdx = 0; rayIdx < resultGrid.length - 1; rayIdx++) {
            const angleStart = startAngle + rayIdx * angleDivisions;
            const angleEnd = startAngle + (rayIdx + 1) * angleDivisions;

            for (let ptIdx = 0; ptIdx < numPointsPerRay; ptIdx++) {
                const innerDist = ptIdx * distanceDivisions;
                const outerDist = (ptIdx + 1) * distanceDivisions;

                const coords = this.generateWedgePolygon(center, innerDist, outerDist, angleStart, angleEnd);

                // Use the visibility result from the current ray at this point
                const isVisible = resultGrid[rayIdx][ptIdx].visible;

                cells.push({ coordinates: coords, isVisible });
            }
        }

        return cells;
    }

    /**
     * Generate a wedge-shaped polygon between two radii and two angles.
     * @param {Array} center - [lng, lat]
     * @param {number} innerDist - Inner radius in meters
     * @param {number} outerDist - Outer radius in meters
     * @param {number} startAngle - Start angle in degrees
     * @param {number} endAngle - End angle in degrees
     * @returns {Array} Closed coordinate ring
     */
    generateWedgePolygon(center, innerDist, outerDist, startAngle, endAngle) {
        const angularWidth = Math.abs(endAngle - startAngle);
        const arcPoints = Math.max(2, Math.ceil(angularWidth / 2));
        const coords = [];

        // Inner arc (from startAngle to endAngle)
        if (innerDist > 0) {
            for (let i = 0; i <= arcPoints; i++) {
                const a = startAngle + (endAngle - startAngle) * (i / arcPoints);
                coords.push(this.pointAtBearing(center, innerDist, a));
            }
        } else {
            // Innermost ring: single center point
            coords.push([center[0], center[1]]);
        }

        // Outer arc (from endAngle back to startAngle)
        for (let i = arcPoints; i >= 0; i--) {
            const a = startAngle + (endAngle - startAngle) * (i / arcPoints);
            coords.push(this.pointAtBearing(center, outerDist, a));
        }

        // Close ring
        coords.push(coords[0]);
        return coords;
    }

    // ========================================================================
    // DISSOLVE AND PROCESSED FEATURES
    // ========================================================================

    /**
     * Group cells by visibility. No dissolve — wedge cells from the polar grid
     * are adjacent without overlap, so grouping into two MultiPolygons
     * (one per color) is enough to prevent alpha-blending artifacts.
     * @param {Array} cells - Array of { coordinates, isVisible }
     * @returns {Array} Grouped cells array
     */
    dissolveVisibilityCells(cells) {
        return cells;
    }

    /**
     * Generate processed features for visual display (green/red cells).
     *
     * Produces exactly two MultiPolygon features: one visible, one obstructed.
     * Grouping all same-visibility polygons into a single feature prevents
     * alpha-blending artifacts when MapLibre renders overlapping polygons
     * with semi-transparent fill-opacity.
     *
     * @param {Object} mainFeature - Main visibility feature
     * @returns {Array} Array of processed features with colors
     */
    generateProcessedFeatures(mainFeature) {
        const properties = mainFeature.properties;

        if (mainFeature.geometry.type !== 'MultiPolygon') {
            return [];
        }

        const visibleCoords = [];
        const obstructedCoords = [];

        mainFeature.geometry.coordinates.forEach((polygonCoords, index) => {
            const cellData = properties.cellData[index];
            if (cellData.isVisible) {
                visibleCoords.push(polygonCoords);
            } else {
                obstructedCoords.push(polygonCoords);
            }
        });

        const processedFeatures = [];

        if (visibleCoords.length > 0) {
            processedFeatures.push({
                type: 'Feature',
                id: `${properties.id}-visible`,
                properties: {
                    ...properties,
                    id: `${properties.id}-visible`,
                    color: this.VISIBLE_COLOR
                },
                geometry: {
                    type: 'MultiPolygon',
                    coordinates: visibleCoords
                }
            });
        }

        if (obstructedCoords.length > 0) {
            processedFeatures.push({
                type: 'Feature',
                id: `${properties.id}-obstructed`,
                properties: {
                    ...properties,
                    id: `${properties.id}-obstructed`,
                    color: this.OBSTRUCTED_COLOR
                },
                geometry: {
                    type: 'MultiPolygon',
                    coordinates: obstructedCoords
                }
            });
        }

        return processedFeatures;
    }

    // ========================================================================
    // FEATURE CREATION AND RECALCULATION
    // ========================================================================

    /**
     * Create complete visibility feature from two click points.
     * @param {Array} startPoint - Observer position [lng, lat]
     * @param {Array} endPoint - Direction/radius reference point [lng, lat]
     * @param {Object} properties - Feature properties
     * @param {Object} map - MapLibre map instance
     * @param {Function} [progressCallback] - Progress callback
     * @returns {Promise<Object>} Complete visibility feature
     */
    async createVisibilityFeature(startPoint, endPoint, properties, map, progressCallback = null) {
        const radius = turf.distance(startPoint, endPoint, { units: 'meters' });
        const bearing = this.calculateBearing(startPoint, endPoint);
        const aperture = properties.aperture ?? 60;
        const observerHeight = properties.observerHeight ?? 2;
        const targetHeight = properties.targetHeight ?? 0;

        const optimizedCells = await this.calculateViewshed(
            startPoint, radius, bearing, aperture,
            observerHeight, targetHeight,
            map, progressCallback
        );

        if (progressCallback) {
            progressCallback(82, 'Criando feature...');
            await this.delay(50);
        }

        return {
            type: 'Feature',
            id: properties.id,
            properties: {
                ...properties,
                center: startPoint,
                radius,
                bearing,
                aperture,
                cellData: optimizedCells.map(cell => ({ isVisible: cell.isVisible }))
            },
            geometry: {
                type: 'MultiPolygon',
                coordinates: optimizedCells.map(cell => [cell.coordinates])
            }
        };
    }

    /**
     * Recalculate viewshed from new parameters or position.
     * @param {Array} newCenter - New center coordinates [lng, lat]
     * @param {Object} feature - Original feature with properties
     * @param {Object} map - MapLibre map instance
     * @param {Function} [progressCallback] - Progress callback
     * @returns {Promise<Object>} { geometry, cellData, center }
     */
    async recalculateFromCoordinates(newCenter, feature, map, progressCallback = null) {
        const props = this.normalizeFeatureProperties(feature.properties);

        if (!this.validate(newCenter, props.radius, props.aperture)) {
            throw new Error('Invalid parameters for visibility recalculation');
        }

        const optimizedCells = await this.calculateViewshed(
            newCenter, props.radius, props.bearing, props.aperture,
            props.observerHeight, props.targetHeight,
            map, progressCallback
        );

        if (progressCallback) {
            progressCallback(82, 'Criando geometria...');
            await this.delay(50);
        }

        return {
            geometry: {
                type: 'MultiPolygon',
                coordinates: optimizedCells.map(cell => [cell.coordinates])
            },
            cellData: optimizedCells.map(cell => ({ isVisible: cell.isVisible })),
            center: newCenter
        };
    }

    // ========================================================================
    // VALIDATION AND NORMALIZATION
    // ========================================================================

    /**
     * Validate viewshed parameters.
     * @param {Array} center - Center coordinates
     * @param {number} radius - Radius in meters
     * @param {number} aperture - Aperture in degrees
     * @returns {boolean} True if valid
     */
    validate(center, radius, aperture) {
        if (!center || !Array.isArray(center) || center.length < 2) return false;
        if (typeof radius !== 'number' || radius <= 0) return false;
        if (typeof aperture !== 'number' || aperture < 1 || aperture > 359) return false;
        return true;
    }

    /**
     * Normalize feature properties, providing defaults for missing fields.
     * Handles backward compatibility with old visibility features.
     * @param {Object} props - Feature properties
     * @returns {Object} Normalized properties
     */
    normalizeFeatureProperties(props) {
        return {
            ...props,
            bearing: props.bearing ?? props.angle ?? 0,
            aperture: props.aperture ?? 60,
            targetHeight: props.targetHeight ?? 0,
            observerHeight: props.observerHeight ?? 2
        };
    }

    /**
     * Normalize center coordinates from various formats.
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
     * Check if coordinates represent a valid center.
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

    // ========================================================================
    // GEOMETRY OPERATIONS (move, translate, bbox)
    // ========================================================================

    /**
     * Translate visibility geometry by offset for immediate drag preview.
     * @param {Object} geometry - MultiPolygon geometry
     * @param {number} dx - Longitude offset
     * @param {number} dy - Latitude offset
     * @returns {Object} Translated geometry
     */
    translateGeometry(geometry, dx, dy) {
        try {
            if (geometry.type === 'MultiPolygon') {
                return {
                    type: 'MultiPolygon',
                    coordinates: geometry.coordinates.map(polygonCoords =>
                        polygonCoords.map(ring =>
                            ring.map(coord => [coord[0] + dx, coord[1] + dy])
                        )
                    )
                };
            } else if (geometry.type === 'Polygon') {
                return {
                    type: 'Polygon',
                    coordinates: geometry.coordinates.map(ring =>
                        ring.map(coord => [coord[0] + dx, coord[1] + dy])
                    )
                };
            }
            return geometry;
        } catch (error) {
            console.error('Error translating visibility geometry:', error);
            return geometry;
        }
    }

    /**
     * Extract center from moved geometry (centroid of all coordinates).
     * @param {Object} geometry - GeoJSON geometry
     * @returns {Array|null} Center coordinates or null
     */
    extractCenterFromGeometry(geometry) {
        try {
            if (geometry.type === 'MultiPolygon') {
                const allCoordinates = [];
                geometry.coordinates.forEach(polygonCoords => {
                    polygonCoords.forEach(ring => {
                        ring.forEach(coord => {
                            if (coord.length >= 2) allCoordinates.push(coord);
                        });
                    });
                });
                if (allCoordinates.length === 0) return null;
                const sumLng = allCoordinates.reduce((sum, c) => sum + c[0], 0);
                const sumLat = allCoordinates.reduce((sum, c) => sum + c[1], 0);
                return [sumLng / allCoordinates.length, sumLat / allCoordinates.length];
            } else if (geometry.type === 'Polygon') {
                const centroid = turf.centroid(turf.polygon(geometry.coordinates));
                return centroid.geometry.coordinates;
            }
            return null;
        } catch (error) {
            console.error('Error extracting center from moved geometry:', error);
            return null;
        }
    }

    /**
     * Get coordinates from geometry for movement operations.
     * @param {Object} geometry - GeoJSON geometry
     * @returns {Array} Center coordinates
     */
    getCoordinatesForMovement(geometry) {
        return this.extractCenterFromGeometry(geometry);
    }

    /**
     * Get bounding box for visibility feature.
     * @param {Object} feature - Visibility feature
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(feature) {
        try {
            return turf.bbox(feature);
        } catch (error) {
            console.warn('Error calculating visibility bounding box:', error);
            return [0, 0, 0, 0];
        }
    }

    /**
     * Determine if terrain is available.
     * @param {Object} map - MapLibre map instance
     * @returns {boolean} True if terrain is available
     */
    isTerrainAvailable(map) {
        return map.getTerrain() !== null;
    }

    /**
     * Utility delay function for async operations.
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise} Resolves after delay
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default AddVisibilityGeometry;

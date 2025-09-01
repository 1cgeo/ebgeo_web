// Path: js\controls_sig\visibility_tool\add_visibility_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';
import { getTerrainElevation } from '../terrain_control.js';

/**
 * Visibility Geometry Operations
 * Handles all geometric calculations for visibility/viewshed features including:
 * - Viewshed calculation with adaptive polar grid
 * - Cell dissolution and optimization
 * - Processed features generation (visible/obstructed cells)
 * - Async movement recalculations
 */
class AddVisibilityGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
        
        // Visibility specific constants
        this.VISIBLE_COLOR = '#00FF00';
        this.OBSTRUCTED_COLOR = '#FF0000';
        this.OBSERVER_HEIGHT = 2; // meters above ground
        
        // Adaptive polar grid configuration
        this.VIEWSHED_CONFIG = {
            RINGS: 20,                    // Concentric rings
            MIN_RAYS_PER_RING: 4,        // Minimum angular subdivisions
            MAX_RAYS_PER_RING: 20        // Maximum angular subdivisions
        };
    }

    /**
     * Generate visibility geometry (not directly applicable - uses calculateViewshed)
     * @param {Array} coordinates - Center and edge point
     * @returns {Object} GeoJSON geometry
     */
    generate(coordinates) {
        // Visibility geometry is generated through calculateViewshed
        return {
            type: 'Polygon',
            coordinates: [coordinates]
        };
    }

    /**
     * Validate viewshed parameters
     * @param {Array} center - Center coordinates
     * @param {number} radius - Radius in meters
     * @param {number} angle - Bearing angle in degrees
     * @returns {boolean} True if valid
     */
    validate(center, radius, angle) {
        if (!center || !Array.isArray(center) || center.length < 2) {
            return false;
        }

        if (typeof radius !== 'number' || radius <= 0) {
            return false;
        }

        if (typeof angle !== 'number') {
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
     * Calculate viewshed with adaptive polar grid
     * @param {Object} center - Turf point with observer coordinates
     * @param {number} radius - Analysis radius in meters
     * @param {number} angle - Central bearing angle in degrees
     * @param {Object} map - MapLibre map instance for terrain queries
     * @param {Function} progressCallback - Optional progress callback
     * @returns {Array} Array of visibility cells
     */
    async calculateViewshed(center, radius, angle, map, progressCallback = null) {
        try {
            const sectorStart = angle - 22.5; // 45-degree sector
            const sectorEnd = angle + 22.5;

            if (progressCallback) {
                progressCallback(5, 'Obtendo elevação do observador...');
                await this.delay(50);
            }

            const observerHeight = center.properties?.observerHeight || this.OBSERVER_HEIGHT;
            const observerElevation = await getTerrainElevation(map, center.geometry.coordinates) + observerHeight;
            const observer = {
                coord: center.geometry.coordinates,
                elevation: observerElevation
            };

            const cells = [];

            if (progressCallback) {
                progressCallback(10, 'Iniciando análise do terreno...');
                await this.delay(50);
            }

            for (let ring = 0; ring < this.VIEWSHED_CONFIG.RINGS; ring++) {
                const innerRadius = (ring / this.VIEWSHED_CONFIG.RINGS) * radius;
                const outerRadius = ((ring + 1) / this.VIEWSHED_CONFIG.RINGS) * radius;

                const raysInRing = Math.floor(
                    this.VIEWSHED_CONFIG.MIN_RAYS_PER_RING +
                    (ring / (this.VIEWSHED_CONFIG.RINGS - 1)) *
                    (this.VIEWSHED_CONFIG.MAX_RAYS_PER_RING - this.VIEWSHED_CONFIG.MIN_RAYS_PER_RING)
                );

                const angleStep = 45 / raysInRing;

                for (let ray = 0; ray < raysInRing; ray++) {
                    const startAngle = sectorStart + (ray * angleStep);
                    const endAngle = sectorStart + ((ray + 1) * angleStep);

                    const cell = await this.createSectorCell(center, innerRadius, outerRadius, startAngle, endAngle, observer, map);
                    cells.push(cell);
                }

                if (progressCallback) {
                    const ringProgress = 10 + (60 * (ring + 1) / this.VIEWSHED_CONFIG.RINGS);
                    progressCallback(ringProgress, `Processando anel ${ring + 1}/${this.VIEWSHED_CONFIG.RINGS}...`);
                    await this.delay(30);
                }
            }

            return cells;

        } catch (error) {
            console.error('Error calculating viewshed:', error);
            throw error;
        }
    }

    /**
     * Create individual sector cell for viewshed analysis
     * @param {Object} center - Center point
     * @param {number} innerRadius - Inner radius in meters
     * @param {number} outerRadius - Outer radius in meters
     * @param {number} startAngle - Start angle in degrees
     * @param {number} endAngle - End angle in degrees
     * @param {Object} observer - Observer data {coord, elevation}
     * @param {Object} map - MapLibre map instance for terrain queries
     * @returns {Object} Cell data with coordinates and visibility
     */
    async createSectorCell(center, innerRadius, outerRadius, startAngle, endAngle, observer, map) {
        const p1 = turf.destination(center, innerRadius, startAngle, { units: 'meters' }).geometry.coordinates;
        const p2 = turf.destination(center, outerRadius, startAngle, { units: 'meters' }).geometry.coordinates;
        const p3 = turf.destination(center, outerRadius, endAngle, { units: 'meters' }).geometry.coordinates;
        const p4 = turf.destination(center, innerRadius, endAngle, { units: 'meters' }).geometry.coordinates;

        const midAngle = (startAngle + endAngle) / 2;
        const testPoint = turf.destination(center, outerRadius, midAngle, { units: 'meters' });

        const line = turf.lineString([observer.coord, testPoint.geometry.coordinates]);
        const length = turf.length(line, { units: 'meters' });
        const steps = Math.ceil(length / 60); // 60m per step
        const stepLength = length / steps;

        const testElevation = await getTerrainElevation(map, testPoint.geometry.coordinates);

        let isVisible = true;

        for (let i = 1; i <= steps; i++) {
            const segment = turf.along(line, i * stepLength, { units: 'meters' });
            const segmentCoordinates = segment.geometry.coordinates;

            const expectedElevation = observer.elevation + (testElevation - observer.elevation) * (i / steps);
            const actualElevation = await getTerrainElevation(map, segmentCoordinates);

            if (actualElevation > expectedElevation) {
                isVisible = false;
                break;
            }
        }

        return {
            coordinates: [p1, p2, p3, p4, p1],
            isVisible: isVisible
        };
    }

    /**
     * Dissolve visibility cells for optimization
     * @param {Array} cells - Array of visibility cells
     * @returns {Array} Optimized cells array
     */
    dissolveVisibilityCells(cells) {
        try {
            const visibleCells = [];
            const obstructedCells = [];

            cells.forEach(cell => {
                const polygon = turf.polygon([cell.coordinates]);
                polygon.properties = { isVisible: cell.isVisible };

                if (cell.isVisible) {
                    visibleCells.push(polygon);
                } else {
                    obstructedCells.push(polygon);
                }
            });

            const optimizedCells = [];

            if (visibleCells.length > 0) {
                const visibleCollection = turf.featureCollection(visibleCells);
                const dissolvedVisible = turf.dissolve(visibleCollection, { propertyName: 'isVisible' });

                dissolvedVisible.features.forEach(feature => {
                    optimizedCells.push({
                        coordinates: feature.geometry.coordinates[0],
                        isVisible: true
                    });
                });
            }

            if (obstructedCells.length > 0) {
                const obstructedCollection = turf.featureCollection(obstructedCells);
                const dissolvedObstructed = turf.dissolve(obstructedCollection, { propertyName: 'isVisible' });

                dissolvedObstructed.features.forEach(feature => {
                    optimizedCells.push({
                        coordinates: feature.geometry.coordinates[0],
                        isVisible: false
                    });
                });
            }

            return optimizedCells;

        } catch (error) {
            console.warn('Error in dissolve, using original geometries:', error);
            return cells;
        }
    }

    /**
     * Create viewshed feature from cell data
     * @param {Array} cellsData - Array of cell data
     * @param {number} radius - Radius in meters
     * @param {number} angle - Angle in degrees
     * @param {number} observerHeight - Observer height in meters
     * @returns {Object} Complete viewshed feature
     */
    createViewshedFeature(cellsData, radius, angle, observerHeight = 2) {
        return {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                radius: radius,
                angle: angle,
                observerHeight: observerHeight,
                cellData: cellsData.map(cell => ({ isVisible: cell.isVisible }))
            },
            geometry: {
                type: 'MultiPolygon',
                coordinates: cellsData.map(cell => [cell.coordinates])
            }
        };
    }

    /**
     * Generate processed features for visual display (green/red cells)
     * @param {Object} mainFeature - Main visibility feature
     * @returns {Array} Array of processed features with colors
     */
    generateProcessedFeatures(mainFeature) {
        const properties = mainFeature.properties;
        const processedFeatures = [];

        if (mainFeature.geometry.type === 'MultiPolygon') {
            mainFeature.geometry.coordinates.forEach((polygonCoords, index) => {
                const cellData = properties.cellData[index];
                
                processedFeatures.push({
                    type: 'Feature',
                    id: `${properties.id}-${index}`,
                    properties: {
                        ...properties,
                        id: `${properties.id}-${index}`,
                        color: cellData.isVisible ? this.VISIBLE_COLOR : this.OBSTRUCTED_COLOR
                    },
                    geometry: {
                        type: 'Polygon',
                        coordinates: polygonCoords
                    }
                });
            });
        }

        return processedFeatures;
    }

    /**
     * Extract center from moved geometry
     * @param {Object} geometry - Moved MultiPolygon geometry
     * @returns {Array|null} Center coordinates or null
     */
    extractCenterFromGeometry(geometry) {
        try {
            if (geometry.type === 'MultiPolygon') {
                // Calculate centroid of first cell (approximation of original center)
                const firstPolygon = geometry.coordinates[0];
                const polygon = turf.polygon(firstPolygon);
                const centroid = turf.centroid(polygon);
                return centroid.geometry.coordinates;
            } else if (geometry.type === 'Polygon') {
                const polygon = turf.polygon(geometry.coordinates);
                const centroid = turf.centroid(polygon);
                return centroid.geometry.coordinates;
            }
            return null;
        } catch (error) {
            console.error('Error extracting center from moved geometry:', error);
            return null;
        }
    }

    /**
     * Recalculate viewshed from moved coordinates
     * @param {Array} newCenter - New center coordinates
     * @param {Object} feature - Original feature with properties
     * @param {Object} map - MapLibre map instance
     * @param {Function} progressCallback - Optional progress callback
     * @returns {Object} New geometry and cell data
     */
    async recalculateFromCoordinates(newCenter, feature, map, progressCallback = null) {
        if (!this.validate(newCenter, feature.properties.radius, feature.properties.angle)) {
            throw new Error('Invalid parameters for visibility recalculation');
        }

        try {
            // Create center point with observer height
            const center = turf.point(newCenter);
            center.properties = { observerHeight: feature.properties.observerHeight };

            // Recalculate viewshed
            const viewshedResult = await this.calculateViewshed(
                center, 
                feature.properties.radius, 
                feature.properties.angle,
                map,
                progressCallback
            );

            if (progressCallback) {
                progressCallback(72, 'Otimizando geometrias...');
                await this.delay(100);
            }

            // Optimize cells
            const optimizedCells = this.dissolveVisibilityCells(viewshedResult);

            if (progressCallback) {
                progressCallback(75, 'Criando geometria...');
                await this.delay(100);
            }

            // Create new geometry
            const newGeometry = {
                type: 'MultiPolygon',
                coordinates: optimizedCells.map(cell => [cell.coordinates])
            };

            return {
                geometry: newGeometry,
                cellData: optimizedCells.map(cell => ({ isVisible: cell.isVisible })),
                center: newCenter
            };
        } catch (error) {
            console.error('Error recalculating visibility:', error);
            throw error;
        }
    }

    /**
     * Create complete visibility feature from coordinates
     * @param {Array} startPoint - Observer position
     * @param {Array} endPoint - Direction/radius reference point
     * @param {Object} properties - Feature properties
     * @param {Object} map - MapLibre map instance
     * @param {Function} progressCallback - Optional progress callback
     * @returns {Object} Complete visibility feature
     */
    async createVisibilityFeature(startPoint, endPoint, properties, map, progressCallback = null) {
        const center = turf.point(startPoint);
        const radius = turf.distance(startPoint, endPoint, { units: 'meters' });
        const angle = turf.bearing(startPoint, endPoint);
        
        center.properties = { observerHeight: properties.observerHeight };

        const viewshedResult = await this.calculateViewshed(center, radius, angle, map, progressCallback);

        if (progressCallback) {
            progressCallback(72, 'Otimizando geometrias...');
            await this.delay(100);
        }

        const optimizedCells = this.dissolveVisibilityCells(viewshedResult);

        if (progressCallback) {
            progressCallback(75, 'Criando feature...');
            await this.delay(100);
        }

        const feature = this.createViewshedFeature(optimizedCells, radius, angle, properties.observerHeight);
        
        return {
            ...feature,
            properties: {
                ...properties,
                ...feature.properties,
                center: startPoint // Preserve original center
            }
        };
    }

    /**
     * Calculate sector coordinates for preview
     * @param {Array} center - Center coordinates
     * @param {Array} edgePoint - Edge point coordinates
     * @returns {Array} Sector coordinates for preview
     */
    calculateSectorCoordinates(center, edgePoint) {
        const [cx, cy] = center;
        const radius = Math.sqrt((edgePoint[0] - cx) ** 2 + (edgePoint[1] - cy) ** 2);
        const sectorAngle = Math.PI / 4; // 45 degrees in radians
        const angleStep = sectorAngle / 45;
        const startAngle = Math.atan2(edgePoint[1] - cy, edgePoint[0] - cx) - sectorAngle / 2;

        const coordinates = [center];
        for (let i = 0; i <= 45; i++) {
            const angle = startAngle + angleStep * i;
            coordinates.push([
                cx + radius * Math.cos(angle),
                cy + radius * Math.sin(angle)
            ]);
        }
        coordinates.push(center);

        return coordinates;
    }

    /**
     * No edit handles for visibility (implements BaseGeometry interface)
     * @param {Object} feature - Visibility feature
     * @returns {Array} Empty array (no handles)
     */
    createHandles(feature) {
        return []; // Visibility doesn't have interactive handles
    }

    /**
     * No handle updates for visibility (implements BaseGeometry interface)
     * @param {string} handleType - Handle type (not applicable)
     * @param {Array} newPosition - New position (not applicable)
     * @param {Object} feature - Feature (not applicable)
     * @returns {null} Not applicable for visibility
     */
    updateFromHandle(handleType, newPosition, feature) {
        console.warn('Visibility features do not support handle-based editing');
        return null;
    }

    /**
     * Get bounding box for visibility feature
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
     * Determine if terrain is available for visibility calculation
     * @param {Object} map - MapLibre map instance
     * @returns {boolean} True if terrain is available
     */
    isTerrainAvailable(map) {
        return map.getTerrain() !== null;
    }

    /**
     * Utility delay function for async operations
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise} Promise that resolves after delay
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check if coordinates represent a valid visibility center
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
}

export default AddVisibilityGeometry;
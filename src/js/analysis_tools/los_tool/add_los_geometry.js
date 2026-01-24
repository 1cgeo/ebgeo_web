// Path: js/analysis_tools/los_tool/add_los_geometry.js

import { BaseGeometry } from '../../tool_manager';
import { getTerrainElevation } from '../../terrain';

/**
 * Line of Sight Geometry Operations
 * Handles all geometric calculations for LOS features including terrain-based
 * line of sight calculations, elevation profile generation, and processed features
 */
class AddLOSGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);

        this.VISIBLE_COLOR = '#00FF00';
        this.OBSTRUCTED_COLOR = '#FF0000';
        this.SAMPLE_DISTANCE = 60;
        this.OBSERVER_HEIGHT = 2;
        this.PROFILE_STEPS = 25;
    }

    /**
     * Generate LOS geometry (simple LineString for preview)
     * @param {Array} coordinates - Line coordinates
     * @returns {Object} GeoJSON geometry
     */
    generate(coordinates) {
        return {
            type: 'LineString',
            coordinates: coordinates
        };
    }

    /**
     * Validate LOS coordinates
     * @param {Array} coordinates - Coordinates to validate
     * @returns {boolean} True if valid
     */
    validate(coordinates) {
        if (!Array.isArray(coordinates) || coordinates.length !== 2) {
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
     * Extract coordinates from LOS geometry
     * @param {Object} geometry - GeoJSON geometry (MultiLineString or LineString)
     * @returns {Array} [startPoint, endPoint]
     */
    extractCoordinatesFromGeometry(geometry) {
        if (geometry.type === 'MultiLineString') {
            const firstLine = geometry.coordinates[0];
            const secondLine = geometry.coordinates[1];
            return [firstLine[0], secondLine[secondLine.length - 1]];
        } else if (geometry.type === 'LineString') {
            const coords = geometry.coordinates;
            return [coords[0], coords[coords.length - 1]];
        }

        console.warn('Unknown LOS geometry type:', geometry.type);
        return null;
    }

    /**
     * Calculate Line of Sight with terrain obstruction analysis
     * @param {Array} coordinates - [startPoint, endPoint]
     * @param {Object} map - MapLibre map instance for terrain queries
     * @returns {Object} {visible: Feature, obstructed: Feature|null}
     */
    async calculateLOS(coordinates, map) {
        if (!this.validate(coordinates)) {
            throw new Error('Invalid coordinates for LOS calculation');
        }

        const [startCoordinates, endCoordinates] = coordinates;
        const line = turf.lineString(coordinates);
        const length = turf.length(line, { units: 'meters' });
        const steps = Math.ceil(length / this.SAMPLE_DISTANCE);
        const stepLength = length / steps;

        const startElevation = await getTerrainElevation(map, startCoordinates) + this.OBSERVER_HEIGHT;
        const endElevation = await getTerrainElevation(map, endCoordinates);

        let firstObstructedPoint = null;

        for (let i = 1; i <= steps; i++) {
            const segment = turf.along(line, i * stepLength, { units: 'meters' });
            const segmentCoordinates = segment.geometry.coordinates;

            const expectedElevation = startElevation + (endElevation - startElevation) * (i / steps);
            const actualElevation = await getTerrainElevation(map, segmentCoordinates);

            if (actualElevation > expectedElevation) {
                firstObstructedPoint = segmentCoordinates;
                break;
            }
        }

        const visibleLine = firstObstructedPoint
            ? turf.lineString([startCoordinates, firstObstructedPoint])
            : turf.lineString([startCoordinates, endCoordinates]);

        const obstructedLine = firstObstructedPoint
            ? turf.lineString([firstObstructedPoint, endCoordinates])
            : null;

        return {
            visible: visibleLine,
            obstructed: obstructedLine
        };
    }

    /**
     * Calculate elevation profile along coordinates with slope percentage
     * @param {Array} coordinates - [startPoint, endPoint]
     * @param {Object} map - MapLibre map instance for terrain queries
     * @returns {Array} Array of {distance, elevation, slope} objects
     */
    async calculateProfile(coordinates, map) {
        if (!this.validate(coordinates)) {
            throw new Error('Invalid coordinates for profile calculation');
        }

        const line = turf.lineString(coordinates);
        const length = turf.length(line, { units: 'meters' });
        const stepLength = length / this.PROFILE_STEPS;

        const profileData = [];

        for (let i = 0; i <= this.PROFILE_STEPS; i++) {
            const point = turf.along(line, i * stepLength, { units: 'meters' });
            const elevation = await getTerrainElevation(map, point.geometry.coordinates);

            profileData.push({
                distance: i * stepLength,
                elevation: elevation,
                slope: 0 // Will be calculated after all elevations are collected
            });
        }

        // Calculate slope percentage between consecutive points
        for (let i = 1; i < profileData.length; i++) {
            const deltaElevation = profileData[i].elevation - profileData[i - 1].elevation;
            const deltaDistance = profileData[i].distance - profileData[i - 1].distance;

            if (deltaDistance > 0) {
                // Slope as percentage: (rise / run) * 100
                profileData[i].slope = (deltaElevation / deltaDistance) * 100;
            }
        }

        // First point inherits slope from second point for display continuity
        if (profileData.length > 1) {
            profileData[0].slope = profileData[1].slope;
        }

        return profileData;
    }

    /**
     * Generate processed features for visual display
     * @param {Object} mainFeature - Main LOS feature
     * @returns {Array} Array of processed features with colors (green for visible, red for obstructed)
     */
    generateProcessedFeatures(mainFeature) {
        const properties = mainFeature.properties;
        const processedFeatures = [];

        if (mainFeature.geometry.type === 'MultiLineString') {
            processedFeatures.push({
                type: 'Feature',
                id: properties.id + '-visible',
                properties: {
                    ...properties,
                    id: properties.id + '-visible',
                    color: this.VISIBLE_COLOR
                },
                geometry: {
                    type: 'LineString',
                    coordinates: mainFeature.geometry.coordinates[0]
                }
            });

            processedFeatures.push({
                type: 'Feature',
                id: properties.id + '-obstructed',
                properties: {
                    ...properties,
                    id: properties.id + '-obstructed',
                    color: this.OBSTRUCTED_COLOR
                },
                geometry: {
                    type: 'LineString',
                    coordinates: mainFeature.geometry.coordinates[1]
                }
            });
        } else {
            processedFeatures.push({
                type: 'Feature',
                id: properties.id + '-visible',
                properties: {
                    ...properties,
                    id: properties.id + '-visible',
                    color: this.VISIBLE_COLOR
                },
                geometry: mainFeature.geometry
            });
        }

        return processedFeatures;
    }

    /**
     * Recalculate LOS from moved coordinates
     * @param {Array} newCoordinates - New [startPoint, endPoint]
     * @param {Object} map - MapLibre map instance
     * @returns {Object} New geometry and profile data
     */
    async recalculateFromCoordinates(newCoordinates, map) {
        if (!this.validate(newCoordinates)) {
            throw new Error('Invalid coordinates for LOS recalculation');
        }

        try {
            const losResult = await this.calculateLOS(newCoordinates, map);

            let newGeometry;
            if (losResult.obstructed) {
                newGeometry = {
                    type: 'MultiLineString',
                    coordinates: [
                        losResult.visible.geometry.coordinates,
                        losResult.obstructed.geometry.coordinates
                    ]
                };
            } else {
                newGeometry = {
                    type: 'LineString',
                    coordinates: losResult.visible.geometry.coordinates
                };
            }

            const profileData = await this.calculateProfile(newCoordinates, map);

            return {
                geometry: newGeometry,
                profileData: profileData
            };
        } catch (error) {
            console.error('Error recalculating LOS:', error);
            throw error;
        }
    }

    /**
     * Create complete LOS feature from coordinates
     * @param {Array} coordinates - [startPoint, endPoint]
     * @param {Object} properties - Feature properties
     * @param {Object} map - MapLibre map instance
     * @returns {Object} Complete LOS feature with geometry and profile
     */
    async createLOSFeature(coordinates, properties, map) {
        if (!this.validate(coordinates)) {
            throw new Error('Invalid coordinates for LOS feature creation');
        }

        const losResult = await this.calculateLOS(coordinates, map);
        const profileData = await this.calculateProfile(coordinates, map);

        let geometry;
        if (losResult.obstructed) {
            geometry = {
                type: 'MultiLineString',
                coordinates: [
                    losResult.visible.geometry.coordinates,
                    losResult.obstructed.geometry.coordinates
                ]
            };
        } else {
            geometry = {
                type: 'LineString',
                coordinates: losResult.visible.geometry.coordinates
            };
        }

        return {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...properties,
                profileData: JSON.stringify(profileData)
            },
            geometry: geometry
        };
    }

    /**
     * No edit handles for LOS
     * @param {Object} feature - LOS feature
     * @returns {Array} Empty array
     */
    createHandles(feature) {
        return [];
    }

    /**
     * No handle updates for LOS
     * @param {string} handleType - Handle type
     * @param {Array} newPosition - New position
     * @param {Object} feature - Feature
     * @returns {null} Not applicable for LOS
     */
    updateFromHandle(handleType, newPosition, feature) {
        console.warn('LOS features do not support handle-based editing');
        return null;
    }

    /**
     * Get bounding box for LOS coordinates
     * @param {Array} coordinates - [startPoint, endPoint]
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates) {
        if (!this.validate(coordinates)) {
            return [0, 0, 0, 0];
        }

        const [start, end] = coordinates;
        const lngs = [start[0], end[0]];
        const lats = [start[1], end[1]];

        return [
            Math.min(...lngs),
            Math.min(...lats),
            Math.max(...lngs),
            Math.max(...lats)
        ];
    }

    /**
     * Calculate distance for LOS measurement
     * @param {Array} coordinates - [startPoint, endPoint]
     * @returns {number} Distance in meters
     */
    calculateLOSDistance(coordinates) {
        if (!this.validate(coordinates)) {
            return 0;
        }

        return this.calculateDistance(coordinates[0], coordinates[1]);
    }

    /**
     * Format distance for display
     * @param {number} distanceMeters - Distance in meters
     * @returns {string} Formatted distance string
     */
    formatDistance(distanceMeters) {
        return distanceMeters >= 1000
            ? `${(distanceMeters / 1000).toFixed(2)} km`
            : `${distanceMeters.toFixed(2)} m`;
    }

    /**
     * Get midpoint coordinates for measurement display
     * @param {Array} coordinates - [startPoint, endPoint]
     * @returns {Array} Midpoint coordinates
     */
    getMidpoint(coordinates) {
        if (!this.validate(coordinates)) {
            return [0, 0];
        }

        const line = turf.lineString(coordinates);
        const distance = turf.length(line, { units: 'meters' });
        const midpoint = turf.along(line, distance / 2, { units: 'meters' });

        return midpoint.geometry.coordinates;
    }

    /**
     * Check if coordinates represent a valid LOS
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid LOS
     */
    isValidLOS(coordinates) {
        return this.validate(coordinates);
    }

    /**
     * Determine if terrain is available for LOS calculation
     * @param {Object} map - MapLibre map instance
     * @returns {boolean} True if terrain is available
     */
    isTerrainAvailable(map) {
        return map.getTerrain() !== null;
    }

    /**
     * Get coordinates from geometry for movement operations
     * @param {Object} geometry - GeoJSON geometry
     * @returns {Array} Coordinates array
     */
    getCoordinatesForMovement(geometry) {
        return this.extractCoordinatesFromGeometry(geometry);
    }
}

export default AddLOSGeometry;

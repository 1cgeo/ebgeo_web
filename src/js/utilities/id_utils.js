// Path: js/utilities/id_utils.js
import { getFeatureDisplayName, getStorageTypeFromSource, hasImageResource as storeHasImageResource } from '../store';

/**
 * Utilities for generating unique IDs and feature names
 */
export class IDUtils {

    /**
     * Generate unique ID
     * @returns {string} Unique ID based on timestamp and random string
     */
    static generateUniqueId() {
        return Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Generate feature name based on type and count
     * @param {string} source - Feature source ('circle', 'ellipse', 'arrow', etc.)
     * @param {Object} map - MapLibre map instance
     * @returns {Promise<string>} Generated name ('Circle #3', 'Arrow #1', etc.)
     */
    static async generateFeatureName(source, map) {
        try {
            const displayName = getFeatureDisplayName(source);
            const mapSourceName = getStorageTypeFromSource(source);

            let featureCount = 0;

            if (mapSourceName) {
                const mapSource = map.getSource(mapSourceName);
                if (mapSource) {
                    const data = await mapSource.getData();
                    if (data && data.features) {
                        featureCount = data.features.length;
                    }
                }
            }

            const nextNumber = featureCount + 1;

            return `${displayName} #${nextNumber}`;

        } catch (error) {
            console.warn('Error generating feature name:', error);
            return `Feição #1`;
        }
    }

    /**
     * Regenerate IDs for all features in mapData and duplicate resources
     * Phase separation to avoid timing conflicts
     *
     * @param {Object} mapData - Map data object
     * @param {string} mapName - New map name
     * @returns {Object} Object containing newMapData and idMapping
     */
    static async regenerateMapIds(mapData, mapName) {
        const idMapping = new Map();
        const newMapData = JSON.parse(JSON.stringify(mapData));

        // PHASE 1: Collect resource operations WITHOUT changing feature IDs
        const resourceOperations = [];

        for (const [featureType, features] of Object.entries(newMapData.features)) {
            if (!Array.isArray(features)) continue;

            for (const feature of features) {
                const oldId = feature.properties.id;
                const newId = this.generateUniqueId();

                idMapping.set(oldId, newId);

                if (this.hasImageResource(featureType)) {
                    resourceOperations.push({
                        oldId,
                        newId,
                        featureType
                    });
                }
            }
        }

        // PHASE 2: Duplicate resources using original IDs
        for (const operation of resourceOperations) {
            await this.duplicateImageResource(
                operation.oldId,
                operation.newId,
                operation.featureType
            );
        }

        // PHASE 3: Apply new IDs to features
        for (const [featureType, features] of Object.entries(newMapData.features)) {
            if (!Array.isArray(features)) continue;

            for (const feature of features) {
                const oldId = feature.properties.id;
                const newId = idMapping.get(oldId);

                if (newId) {
                    feature.properties.id = newId;
                    feature.id = this.generateGeoJSONId();
                }
            }
        }

        newMapData.nome = mapName;

        return { newMapData, idMapping };
    }

    /**
     * Generate unique ID for GeoJSON features (integers only)
     * @returns {number} Unique integer ID
     */
    static generateGeoJSONId() {
        return Date.now() + Math.floor(Math.random() * 10000);
    }

    /**
     * Check if feature type has associated image resources
     * @param {string} featureType - Feature type to check
     * @returns {boolean} True if feature has image resources
     */
    static hasImageResource(featureType) {
        const sourceType = featureType.endsWith('s') ? featureType.slice(0, -1) : featureType;
        return storeHasImageResource(sourceType);
    }

    /**
     * Duplicate image resource in imageStore
     * @param {string} oldId - Original resource ID
     * @param {string} newId - New resource ID
     * @param {string} featureType - Feature type
     */
    static async duplicateImageResource(oldId, newId, featureType) {
        try {
            const { getImage, storeImage } = await import('../store/store.js');

            const oldBlob = await getImage(oldId);
            if (oldBlob) {
                await storeImage(newId, oldBlob);
            } else {
                console.warn(`Resource not found for duplication: ${oldId} (${featureType})`);
            }
        } catch (error) {
            console.error(`Error duplicating resource ${oldId}:`, error);
        }
    }

    /**
     * Convert coordinates from string to array if necessary
     * @param {string|Array} coordinates - Coordinates to normalize
     * @returns {Array} Normalized coordinates array
     */
    static normalizeCoordinates(coordinates) {
        if (typeof coordinates === 'string') {
            try {
                return JSON.parse(coordinates);
            } catch (e) {
                console.warn('Error parsing coordinates:', coordinates);
                return [];
            }
        }
        return Array.isArray(coordinates) ? coordinates : [];
    }

    /**
     * Validate if coordinates are valid
     * @param {Array} coord - Coordinate to validate
     * @returns {boolean} True if coordinate is valid
     */
    static isValidCoordinate(coord) {
        return Array.isArray(coord) &&
            coord.length >= 2 &&
            typeof coord[0] === 'number' &&
            typeof coord[1] === 'number' &&
            !isNaN(coord[0]) &&
            !isNaN(coord[1]);
    }

    /**
     * Filter valid coordinates from an array
     * @param {Array} coordinates - Coordinates array to filter
     * @returns {Array} Filtered array of valid coordinates
     */
    static filterValidCoordinates(coordinates) {
        if (!Array.isArray(coordinates)) return [];

        return coordinates.filter(coord => this.isValidCoordinate(coord));
    }
}

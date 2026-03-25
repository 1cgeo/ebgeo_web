// Path: js/utilities/id_utils.js
import { getFeatureDisplayName, getStorageTypeFromSource, hasImageResource as storeHasImageResource, getImage, storeImage } from '../store';
import { generateUUID } from './uuid.js';
import { deepClone } from './deep-utils.js';

/**
 * Find the next available numbered name given a base name and existing names.
 * Returns baseName if unused, otherwise "baseName #N" where N is the lowest
 * available integer >= 2.
 *
 * @param {string[]} existingNames - Names already in use
 * @param {string} baseName - Base name to derive from
 * @returns {string} Unique name
 */
function findNextAvailableName(existingNames, baseName) {
    if (!existingNames || existingNames.length === 0) {
        return baseName;
    }

    const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}(?: #(\\d+))?$`);
    const usedNumbers = new Set();

    for (const name of existingNames) {
        const match = name.match(pattern);
        if (match) {
            const num = match[1] ? parseInt(match[1], 10) : 1;
            usedNumbers.add(num);
        }
    }

    if (!usedNumbers.has(1)) {
        return baseName;
    }

    let nextNumber = 2;
    while (usedNumbers.has(nextNumber)) {
        nextNumber++;
    }

    return `${baseName} #${nextNumber}`;
}

/**
 * Utilities for generating unique IDs and feature names
 */
export class IDUtils {

    /**
     * Generate unique ID using UUID v4.
     * @returns {string} UUID v4 string
     */
    static generateUniqueId() {
        return generateUUID();
    }

    /**
     * Generate both IDs needed for a GeoJSON feature.
     * - `id`: UUID v4 for properties.id (primary identifier for sync/backend)
     * - `geoJsonId`: Timestamp-based for GeoJSON id field (MapLibre compatibility)
     *
     * @returns {{id: string, geoJsonId: number}} Object with both IDs
     */
    static generateFeatureIds() {
        return {
            id: generateUUID(),
            geoJsonId: this.generateGeoJSONId()
        };
    }

    /**
     * Generate unique layer name based on existing layers
     * @param {Array<{name: string}>} existingLayers - Array of existing layer objects with 'name' property
     * @param {string} baseName - Base name for the layer (default: 'Nova Camada')
     * @returns {string} Unique layer name (e.g., 'Nova Camada #2')
     */
    static generateUniqueLayerName(existingLayers = [], baseName = 'Nova Camada') {
        const names = (existingLayers || []).map(layer => layer.name);
        return findNextAvailableName(names, baseName);
    }

    /**
     * Generate unique map name based on existing maps
     * @param {string[]} existingMapNames - Array of existing map names
     * @param {string} baseName - Base name for the map (default: 'Novo Mapa')
     * @returns {string} Unique map name (e.g., 'Novo Mapa #2')
     */
    static generateUniqueMapName(existingMapNames = [], baseName = 'Novo Mapa') {
        return findNextAvailableName(existingMapNames || [], baseName);
    }

    /**
     * Generate feature name based on type and count
     * @param {string} source - Feature source ('circle', 'ellipse', 'arrow', etc.)
     * @param {Object} map - MapLibre map instance
     * @returns {Promise<string>} Generated name ('Circle #3', 'Arrow #1', etc.)
     */
    static async generateFeatureName(source, map) {
        const displayName = getFeatureDisplayName(source);
        const mapSourceName = getStorageTypeFromSource(source);

        const mapSource = mapSourceName ? map.getSource(mapSourceName) : null;
        const data = mapSource ? await mapSource.getData() : null;
        const featureCount = data?.features?.length ?? 0;

        return `${displayName} #${featureCount + 1}`;
    }

    /**
     * Regenerate IDs for all features in mapData and duplicate resources.
     * Uses phase separation to avoid timing conflicts:
     *   Phase 1 - Collect ID mappings and resource operations
     *   Phase 2 - Duplicate resources using original IDs
     *   Phase 3 - Apply new IDs and update layerId references
     *
     * @param {Object} mapData - Map data object
     * @param {string} mapName - New map name
     * @param {Map} [layerIdMapping=null] - Optional layer ID mapping (oldLayerId -> newLayerId)
     * @returns {Promise<{newMapData: Object, idMapping: Map}>}
     */
    static async regenerateMapIds(mapData, mapName, layerIdMapping = null) {
        const idMapping = new Map();
        const newMapData = deepClone(mapData);

        // PHASE 1: Collect resource operations WITHOUT changing feature IDs
        const resourceOperations = [];

        for (const [featureType, features] of Object.entries(newMapData.features)) {
            if (!Array.isArray(features)) continue;

            for (const feature of features) {
                const oldId = feature.properties.id;
                const newId = generateUUID();

                idMapping.set(oldId, newId);

                if (this.hasImageResource(featureType)) {
                    resourceOperations.push({ oldId, newId, featureType });
                }
            }
        }

        // PHASE 2: Duplicate resources using original IDs
        for (const { oldId, newId, featureType } of resourceOperations) {
            await this.duplicateImageResource(oldId, newId, featureType);
        }

        // PHASE 3: Apply new IDs to features and update layerId if mapping provided
        for (const features of Object.values(newMapData.features)) {
            if (!Array.isArray(features)) continue;

            for (const feature of features) {
                const newId = idMapping.get(feature.properties.id);

                if (newId) {
                    feature.properties.id = newId;
                    feature.id = this.generateGeoJSONId();
                }

                if (layerIdMapping && feature.properties.layerId) {
                    const newLayerId = layerIdMapping.get(feature.properties.layerId);
                    if (newLayerId) {
                        feature.properties.layerId = newLayerId;
                    }
                }
            }
        }

        newMapData.nome = mapName;
        newMapData.name = mapName;
        newMapData.id = null;

        return { newMapData, idMapping };
    }

    /**
     * Generate unique ID for GeoJSON features (timestamp-based integers for MapLibre)
     * @returns {number} Unique integer ID
     */
    static generateGeoJSONId() {
        return Date.now() + Math.floor(Math.random() * 10000);
    }

    /**
     * Check if feature type has associated image resources.
     * Handles plural storage type keys (e.g., 'images' -> 'image').
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
     * @param {string} featureType - Feature type (for logging only)
     */
    static async duplicateImageResource(oldId, newId, featureType) {
        try {
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
}
